import json
import sqlite3
from collections import Counter
from contextlib import closing, contextmanager
from datetime import date
from pathlib import Path, PureWindowsPath
from time import perf_counter
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, StringConstraints, ValidationError, model_validator

from advanced_analysis import AnalysisRequest, AnalysisResult, AnalysisSources, Worksheet, read_analysis, worksheet_options
from dashboard_metrics import recruitment_summary, review_groups, survey_summary
from import_employees import DEFAULT_DATABASE, WorkbookFormatError, import_employees

DASHBOARD_ORIGINS = ["http://127.0.0.1:3000", "http://localhost:3000"]
MAX_WORKBOOK_SIZE = 20 * 1024 * 1024

DATE_RANGE_FILTERS = {
    "hire_date_from": ("hire_date", ">="),
    "hire_date_to": ("hire_date", "<="),
    "date_of_birth_from": ("date_of_birth", ">="),
    "date_of_birth_to": ("date_of_birth", "<="),
}


class Employee(BaseModel):
    employee_id: int
    department: str
    employment_type: str
    work_location: str
    initial_salary_grade: str
    hire_date: date


class EmployeeResponse(BaseModel):
    total: int
    departments: list[str]
    employees: list[Employee]


class EmployeeDetail(Employee):
    manager_id: str
    date_of_birth: date
    tenure_months: int


class WorkbookImportResponse(BaseModel):
    workbook: str
    total: int


class EmployeeSearch(BaseModel):
    trace: bool = False
    employee_id: str | None = Field(default=None, pattern=r"^[0-9]{1,12}$")
    department: str | None = None
    manager_id: str | None = None
    hire_date: date | None = None
    hire_date_from: date | None = None
    hire_date_to: date | None = None
    initial_salary_grade: str | None = None
    employment_type: str | None = None
    work_location: str | None = None
    date_of_birth: date | None = None
    date_of_birth_from: date | None = None
    date_of_birth_to: date | None = None
    tenure_months: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_date_ranges(self):
        for label, start, end in (
            ("Hire date", self.hire_date_from, self.hire_date_to),
            ("Date of birth", self.date_of_birth_from, self.date_of_birth_to),
        ):
            if start is not None and end is not None and start > end:
                raise ValueError(f"{label} start must be on or before the end.")
        return self


class EmployeeFilterOptions(BaseModel):
    department: list[str]
    manager_id: list[str]
    initial_salary_grade: list[str]
    employment_type: list[str]
    work_location: list[str]


class MonthlyEmployeeOptions(BaseModel):
    months: list[str]
    employee_ids: list[int]
    default_employee_id: int | None


class MonthlyEmployeeRecord(BaseModel):
    month: str
    employee_id: int
    department: str
    manager_id: str
    employment_status: str
    tenure_months: int
    performance_rating: float | None
    engagement_score: float | None
    skills_gap_score: float | None
    salary_grade: str
    months_since_last_promotion: int


class AttritionEvent(BaseModel):
    exit_id: str
    employee_id: int
    exit_date: date
    exit_type: str
    exit_reason: str
    eligible_for_rehire: bool
    exit_interview_completed: bool


class EngagementSurvey(BaseModel):
    survey_id: str
    survey_date: date
    survey_quarter: str
    employee_id: int
    department: str
    compensation_benefits: float | None
    growth_opportunities: float | None
    work_culture: float | None
    work_life_balance: float | None
    management_style: float | None
    overall_satisfaction: float | None
    recommend_to_friend: float | None
    response_status: str


class PerformanceReview(BaseModel):
    review_id: str
    review_date: date
    review_quarter: str
    employee_id: int
    department: str
    manager_id: str
    performance_rating: float | None
    skills_gap_score: float | None
    promotion_ready: bool | None
    months_since_last_promotion: int | None


class RecruitmentOpening(BaseModel):
    recruitment_id: str
    position: str
    department: str
    opening_date: date
    offer_date: date | None
    hire_date: date | None
    employee_id: int | None
    days_to_fill: int | None
    offer_accepted: bool | None
    offers_made: int | None
    cost_per_hire: float | None
    quality_of_hire_90d: float | None
    manager_satisfaction_90d: float | None


Quarter = Annotated[str, StringConstraints(pattern=r"^[0-9]{4}-Q[1-4]$")]
Month = Annotated[str, StringConstraints(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")]
Category = Annotated[str, StringConstraints(min_length=1)]


class MonthlySelection(BaseModel):
    latest: MonthlyEmployeeRecord | None
    records: list[MonthlyEmployeeRecord]


class AttritionFilters(BaseModel):
    exit_date_from: date | None = None
    exit_date_to: date | None = None
    exit_reason: list[Category] = Field(default_factory=list, max_length=100)
    exit_type: list[Category] = Field(default_factory=list, max_length=100)
    eligible_for_rehire: bool | None = None
    exit_interview_completed: bool | None = None


class AttritionSummary(BaseModel):
    first_date: date | None
    last_date: date | None
    total: int
    reason_counts: dict[str, int]
    type_counts: dict[str, int]
    eligible_for_rehire: int
    exit_interview_completed: int
    records: list[AttritionEvent]


class SurveyOptions(BaseModel):
    quarters: list[str]
    departments: list[str]


class SurveyDepartment(BaseModel):
    name: str
    trend: list[dict[str, float | None]]
    overall_satisfaction: float | None


class SurveyTimelinePoint(BaseModel):
    quarter: str
    date: date | None
    averages: dict[str, float | None]


class SurveySummary(BaseModel):
    quarters: list[str]
    quarter: str | None
    departments: list[SurveyDepartment]
    employee_ids: list[int]
    employee_id: int | None
    employee_records: list[EngagementSurvey]
    timeline: list[SurveyTimelinePoint]


class ReviewOptions(BaseModel):
    quarters: list[str]
    employee_ids: list[int]
    default_employee_id: int | None


class ReviewGroup(BaseModel):
    group: str
    total: int
    ready: int
    not_ready: int
    unknown: int
    distributions: dict[str, tuple[int, int, int, int]]


class ReviewSummary(BaseModel):
    total: int
    groups: list[ReviewGroup]
    records: list[PerformanceReview]


class RecruitmentPosition(BaseModel):
    department: str
    position: str


class HireMetric(BaseModel):
    count: int
    average: float | None


class RecruitmentSummary(BaseModel):
    openings: list[RecruitmentOpening]
    offers: int | None
    accepted: int
    not_accepted: int
    unknown: int
    hires: int
    cost_per_hire: HireMetric
    quality_of_hire_90d: HireMetric
    manager_satisfaction_90d: HireMetric


ANALYSIS_WORKSHEETS = {
    "employees": Worksheet("Employees", "employees", EmployeeDetail,
                           ("hire_date", "date_of_birth"), ("department", "hire_date")),
    "monthly-employee-data": Worksheet("Monthly Employee Data", "monthly_employee_data", MonthlyEmployeeRecord,
                                       ("month",), ("month", "engagement_score")),
    "attrition-events": Worksheet("Attrition Events", "attrition_events", AttritionEvent,
                                  ("exit_date",), ("exit_date", "exit_reason"), "exit_id"),
    "engagement-surveys": Worksheet("Engagement Surveys", "engagement_surveys", EngagementSurvey,
                                    ("survey_date",), ("survey_date", "overall_satisfaction"), "survey_id"),
    "performance-reviews": Worksheet("Performance Reviews", "performance_reviews", PerformanceReview,
                                     ("review_date",), ("review_date", "performance_rating"), "review_id"),
    "recruitment": Worksheet("Recruitment", "recruitment", RecruitmentOpening,
                             ("opening_date", "offer_date", "hire_date"), ("opening_date", "position"), "recruitment_id"),
}


@contextmanager
def open_employee_database(database_path: Path):
    database_uri = database_path.resolve().as_uri() + "?mode=ro"
    try:
        with closing(sqlite3.connect(database_uri, uri=True)) as database:
            database.row_factory = sqlite3.Row
            database.execute("BEGIN")
            yield database
    except sqlite3.Error as error:
        raise HTTPException(status_code=503, detail="The employee database is unavailable.") from error


def attrition_rows(database, start, end):
    if start is not None and end is not None and start > end:
        raise HTTPException(status_code=422, detail="Exit date start must be on or before the end.")
    return [dict(row) for row in database.execute("""
        SELECT * FROM attrition_events
        WHERE (:start IS NULL OR exit_date >= :start) AND (:end IS NULL OR exit_date <= :end)
        ORDER BY exit_date DESC, exit_id
    """, {"start": start.isoformat() if start else None, "end": end.isoformat() if end else None})]


def survey_rows(database):
    return [dict(row) for row in database.execute("""
        SELECT * FROM engagement_surveys ORDER BY survey_quarter, survey_date, employee_id, survey_id
    """)]


def review_rows(database, *, employee_id=None, quarter=None):
    return [dict(row) for row in database.execute("""
        SELECT * FROM performance_reviews
        WHERE (:employee_id IS NULL OR employee_id = :employee_id)
          AND (:quarter IS NULL OR review_quarter = :quarter)
        ORDER BY review_date, review_quarter, employee_id, review_id
    """, {"employee_id": employee_id, "quarter": quarter})]


def recruitment_rows(database, *, department=None, position=None):
    return [dict(row) for row in database.execute("""
        SELECT * FROM recruitment
        WHERE (:department IS NULL OR department = :department) AND (:position IS NULL OR position = :position)
        ORDER BY opening_date DESC, recruitment_id
    """, {"department": department, "position": position})]


def read_employees(database_path: Path, search: EmployeeSearch, *, include_import: bool = False):
    # The model supplies column names. User-provided values are SQL parameters.
    filters = search.model_dump(mode="json", exclude_none=True, exclude={"trace", "employee_id"})
    conditions = []
    for name in filters:
        column, operator = DATE_RANGE_FILTERS.get(name, (name, "="))
        conditions.append(f"{column} {operator} ?")
    values = list(filters.values())
    if search.employee_id is not None:
        conditions.append("CAST(employee_id AS TEXT) LIKE ?")
        values.append(f"{search.employee_id}%")
    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    import_info = None
    with open_employee_database(database_path) as database:
        departments = [row[0] for row in database.execute("SELECT DISTINCT department FROM employees ORDER BY department")]
        if search.department is not None and search.department not in departments:
            raise HTTPException(status_code=422, detail="Unknown department.")
        employees = [
            dict(row)
            for row in database.execute(f"""
                SELECT employee_id, department, employment_type, work_location,
                       initial_salary_grade, hire_date
                FROM employees
                {where}
                ORDER BY employee_id
            """, values)
        ]
        if include_import:
            # Older databases can still serve the roster without import metadata.
            has_import_table = database.execute("""
                SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'employee_import'
            """).fetchone()
            if has_import_table:
                snapshot = database.execute("""
                    SELECT workbook, sheet, imported_at, total FROM employee_import WHERE id = 1
                """).fetchone()
                import_info = dict(snapshot) if snapshot is not None else None

    return {"total": len(employees), "departments": departments, "employees": employees}, import_info


def trace_employees(database_path: Path, search: EmployeeSearch):
    def event(kind, **details):
        return json.dumps({"event": kind, **details}) + "\n"

    yield event("api_received")
    yield event("sqlite_reading")
    started = perf_counter()
    try:
        data, import_info = read_employees(database_path, search, include_import=True)
    except HTTPException as error:
        stage = "sqlite" if error.status_code == 503 else "api"
        yield event("error", stage=stage, status=error.status_code, detail=error.detail)
        return

    yield event(
        "sqlite_complete",
        total=data["total"],
        elapsed_ms=round((perf_counter() - started) * 1000, 2),
        import_info=import_info,
    )
    yield event("api_encoding")
    try:
        response = EmployeeResponse.model_validate(data).model_dump(mode="json")
    except ValidationError:
        yield event("error", stage="api", status=500, detail="The API could not format the employee response.")
        return
    yield event("result", data=response)


def create_app(database_path: Path = DEFAULT_DATABASE) -> FastAPI:
    app = FastAPI(title="Employees Dashboard API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=DASHBOARD_ORIGINS,
        allow_methods=["GET", "POST"],
    )

    @app.post("/imports/workbook", response_model=WorkbookImportResponse)
    def upload_workbook(request: Request, file: UploadFile):
        """Replace dashboard data with a workbook in the supplied assignment format."""
        origin = request.headers.get("origin")
        if origin is not None and origin not in DASHBOARD_ORIGINS:
            raise HTTPException(status_code=403, detail="Upload from the local dashboard or a local API client.")
        name = PureWindowsPath(file.filename or "").name
        if Path(name).suffix.lower() != ".xlsx":
            raise HTTPException(status_code=400, detail="Choose an .xlsx workbook.")
        if file.size is not None and file.size > MAX_WORKBOOK_SIZE:
            raise HTTPException(status_code=413, detail="Choose an .xlsx workbook of 20 MB or less.")
        try:
            total = import_employees(file.file, database_path, workbook_name=name, require_full_workbook=True)
        except WorkbookFormatError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except (TypeError, ValueError, OverflowError, sqlite3.IntegrityError) as error:
            raise HTTPException(
                status_code=422,
                detail="The workbook contains a missing required value, invalid cell, or duplicate record ID.",
            ) from error
        except (OSError, sqlite3.Error) as error:
            raise HTTPException(status_code=503, detail="Could not write the employee database. Try again.") from error
        return {"workbook": name, "total": total}

    @app.get(
        "/employees",
        response_model=EmployeeResponse,
        responses={200: {"content": {"application/x-ndjson": {"schema": {"type": "string"}}}}},
    )
    def get_employees(search: Annotated[EmployeeSearch, Query()]):
        """Read the employee roster. Set trace=true to stream request events and the result."""
        if search.trace:
            return StreamingResponse(
                trace_employees(database_path, search),
                media_type="application/x-ndjson",
                headers={"Cache-Control": "no-store"},
            )
        data, _ = read_employees(database_path, search)
        return data

    @app.get("/employees/filters", response_model=EmployeeFilterOptions)
    def get_employee_filter_options():
        with open_employee_database(database_path) as database:
            return {
                column: [row[0] for row in database.execute(f"SELECT DISTINCT {column} FROM employees ORDER BY {column}")]
                for column in EmployeeFilterOptions.model_fields
            }

    @app.get("/employees/{employee_id}", response_model=EmployeeDetail)
    def get_employee(employee_id: int):
        with open_employee_database(database_path) as database:
            row = database.execute("""
                SELECT employee_id, department, manager_id, hire_date, initial_salary_grade,
                       employment_type, work_location, date_of_birth, tenure_months
                FROM employees WHERE employee_id = ?
            """, (employee_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Employee not found.")
        return dict(row)

    @app.get("/monthly-employees/options", response_model=MonthlyEmployeeOptions)
    def get_monthly_employee_options():
        with open_employee_database(database_path) as database:
            months = [row[0] for row in database.execute("SELECT DISTINCT month FROM monthly_employee_data ORDER BY month")]
            employee_ids = [
                row[0]
                for row in database.execute("SELECT DISTINCT employee_id FROM monthly_employee_data ORDER BY employee_id")
            ]
            default_employee = database.execute("""
                SELECT employee_id FROM monthly_employee_data ORDER BY month DESC, employee_id LIMIT 1
            """).fetchone()
        return {
            "months": months,
            "employee_ids": employee_ids,
            "default_employee_id": default_employee[0] if default_employee else None,
        }

    @app.get("/monthly-employees/{employee_id}", response_model=list[MonthlyEmployeeRecord])
    def get_monthly_employee_records(employee_id: int):
        with open_employee_database(database_path) as database:
            rows = database.execute("""
                SELECT month, employee_id, department, manager_id, employment_status, tenure_months,
                       performance_rating, engagement_score, skills_gap_score, salary_grade,
                       months_since_last_promotion
                FROM monthly_employee_data WHERE employee_id = ? ORDER BY month
            """, (employee_id,))
            return [dict(row) for row in rows]

    @app.get("/monthly-employees/{employee_id}/selection", response_model=MonthlySelection)
    def get_monthly_selection(
        employee_id: int,
        month: Annotated[list[Month] | None, Query(max_length=120)] = None,
    ):
        with open_employee_database(database_path) as database:
            latest = database.execute("""
                SELECT * FROM monthly_employee_data WHERE employee_id = ? ORDER BY month DESC LIMIT 1
            """, (employee_id,)).fetchone()
            records = []
            if month:
                placeholders = ", ".join("?" for _ in month)
                records = [dict(row) for row in database.execute(f"""
                    SELECT * FROM monthly_employee_data WHERE employee_id = ? AND month IN ({placeholders})
                    ORDER BY month
                """, (employee_id, *month))]
        return {"latest": dict(latest) if latest is not None else None, "records": records}

    @app.get("/attrition-events", response_model=list[AttritionEvent])
    def get_attrition_events(exit_date_from: date | None = None, exit_date_to: date | None = None):
        """Read exit events within optional inclusive date bounds."""
        with open_employee_database(database_path) as database:
            return attrition_rows(database, exit_date_from, exit_date_to)

    @app.get("/attrition-events/summary", response_model=AttritionSummary)
    def get_attrition_summary(filters: Annotated[AttritionFilters, Query()]):
        with open_employee_database(database_path) as database:
            rows = attrition_rows(database, filters.exit_date_from, filters.exit_date_to)
        reasons = set(filters.exit_reason)
        types = set(filters.exit_type)
        return {
            "first_date": rows[-1]["exit_date"] if rows else None,
            "last_date": rows[0]["exit_date"] if rows else None,
            "total": len(rows),
            "reason_counts": dict(Counter(row["exit_reason"] for row in rows)),
            "type_counts": dict(Counter(row["exit_type"] for row in rows)),
            "eligible_for_rehire": sum(bool(row["eligible_for_rehire"]) for row in rows),
            "exit_interview_completed": sum(bool(row["exit_interview_completed"]) for row in rows),
            "records": [
                row for row in rows
                if (not reasons or row["exit_reason"] in reasons)
                and (not types or row["exit_type"] in types)
                and (filters.eligible_for_rehire is None or row["eligible_for_rehire"] == filters.eligible_for_rehire)
                and (filters.exit_interview_completed is None or row["exit_interview_completed"] == filters.exit_interview_completed)
            ],
        }

    @app.get("/engagement-surveys", response_model=list[EngagementSurvey])
    def get_engagement_surveys():
        with open_employee_database(database_path) as database:
            return survey_rows(database)

    @app.get("/engagement-surveys/options", response_model=SurveyOptions)
    def get_survey_options():
        with open_employee_database(database_path) as database:
            return {
                "quarters": [row[0] for row in database.execute(
                    "SELECT DISTINCT survey_quarter FROM engagement_surveys ORDER BY survey_quarter"
                )],
                "departments": [row[0] for row in database.execute(
                    "SELECT DISTINCT department FROM engagement_surveys ORDER BY department"
                )],
            }

    @app.get("/engagement-surveys/summary", response_model=SurveySummary)
    def get_survey_summary(
        survey_quarter: Quarter | None = None,
        department: Category | None = None,
        employee_id: int | None = None,
        include_history: bool = True,
    ):
        with open_employee_database(database_path) as database:
            return survey_summary(survey_rows(database), survey_quarter, department, employee_id, include_history)

    @app.get("/performance-reviews", response_model=list[PerformanceReview])
    def get_performance_reviews(employee_id: int | None = None):
        with open_employee_database(database_path) as database:
            return review_rows(database, employee_id=employee_id)

    @app.get("/performance-reviews/options", response_model=ReviewOptions)
    def get_review_options():
        with open_employee_database(database_path) as database:
            quarters = [row[0] for row in database.execute(
                "SELECT DISTINCT review_quarter FROM performance_reviews ORDER BY review_quarter"
            )]
            coverage = list(database.execute("""
                SELECT employee_id, COUNT(DISTINCT review_quarter)
                FROM performance_reviews GROUP BY employee_id ORDER BY employee_id
            """))
        ids = [row[0] for row in coverage]
        default = next((key for key, count in coverage if count == len(quarters)), ids[0] if ids else None)
        return {"quarters": quarters, "employee_ids": ids, "default_employee_id": default}

    @app.get("/performance-reviews/summary", response_model=ReviewSummary)
    def get_review_summary(
        review_quarter: Quarter | None = None,
        group_by: Literal["department", "manager_id"] = "department",
    ):
        with open_employee_database(database_path) as database:
            rows = review_rows(database, quarter=review_quarter)
        return {"total": len(rows), "groups": review_groups(rows, group_by), "records": rows}

    @app.get("/recruitment", response_model=list[RecruitmentOpening])
    def get_recruitment():
        with open_employee_database(database_path) as database:
            return recruitment_rows(database)

    @app.get("/recruitment/options", response_model=list[RecruitmentPosition])
    def get_recruitment_options():
        with open_employee_database(database_path) as database:
            return [dict(row) for row in database.execute(
                "SELECT DISTINCT department, position FROM recruitment ORDER BY department, position"
            )]

    @app.get("/recruitment/summary", response_model=RecruitmentSummary)
    def get_recruitment_summary(department: Category, position: Category):
        with open_employee_database(database_path) as database:
            return recruitment_summary(recruitment_rows(database, department=department, position=position))

    @app.get("/advanced-analysis/sources", response_model=AnalysisSources)
    def get_analysis_sources():
        return {"sources": worksheet_options(ANALYSIS_WORKSHEETS)}

    @app.post("/advanced-analysis", response_model=AnalysisResult)
    def run_analysis(request: AnalysisRequest):
        with open_employee_database(database_path) as database:
            return read_analysis(database, ANALYSIS_WORKSHEETS, request)

    return app


app = create_app()
