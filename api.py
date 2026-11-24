import json
import sqlite3
from contextlib import closing, contextmanager
from datetime import date
from pathlib import Path
from time import perf_counter
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError, model_validator

from advanced_analysis import AnalysisRequest, Worksheet, read_analysis, worksheet_options
from import_employees import DEFAULT_DATABASE

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
        allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
        allow_methods=["GET", "POST"],
    )

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

    @app.get("/attrition-events", response_model=list[AttritionEvent])
    def get_attrition_events(exit_date_from: date | None = None, exit_date_to: date | None = None):
        """Read exit events within optional inclusive date bounds."""
        if exit_date_from is not None and exit_date_to is not None and exit_date_from > exit_date_to:
            raise HTTPException(status_code=422, detail="Exit date start must be on or before the end.")

        conditions = []
        values = []
        if exit_date_from is not None:
            conditions.append("exit_date >= ?")
            values.append(exit_date_from.isoformat())
        if exit_date_to is not None:
            conditions.append("exit_date <= ?")
            values.append(exit_date_to.isoformat())
        where = "WHERE " + " AND ".join(conditions) if conditions else ""

        with open_employee_database(database_path) as database:
            rows = database.execute(f"""
                SELECT exit_id, employee_id, exit_date, exit_type, exit_reason,
                       eligible_for_rehire, exit_interview_completed
                FROM attrition_events
                {where}
                ORDER BY exit_date DESC, exit_id
            """, values)
            return [dict(row) for row in rows]

    @app.get("/engagement-surveys", response_model=list[EngagementSurvey])
    def get_engagement_surveys():
        with open_employee_database(database_path) as database:
            rows = database.execute("""
                SELECT survey_id, survey_date, survey_quarter, employee_id, department,
                       compensation_benefits, growth_opportunities, work_culture, work_life_balance,
                       management_style, overall_satisfaction, recommend_to_friend, response_status
                FROM engagement_surveys
                ORDER BY survey_quarter, survey_date, employee_id, survey_id
            """)
            return [dict(row) for row in rows]

    @app.get("/performance-reviews", response_model=list[PerformanceReview])
    def get_performance_reviews():
        with open_employee_database(database_path) as database:
            rows = database.execute("""
                SELECT review_id, review_date, review_quarter, employee_id, department, manager_id,
                       performance_rating, skills_gap_score, promotion_ready, months_since_last_promotion
                FROM performance_reviews
                ORDER BY review_date, review_quarter, employee_id, review_id
            """)
            return [dict(row) for row in rows]

    @app.get("/recruitment", response_model=list[RecruitmentOpening])
    def get_recruitment():
        with open_employee_database(database_path) as database:
            rows = database.execute("""
                SELECT recruitment_id, position, department, opening_date, offer_date, hire_date,
                       employee_id, days_to_fill, offer_accepted, offers_made, cost_per_hire,
                       quality_of_hire_90d, manager_satisfaction_90d
                FROM recruitment
                ORDER BY opening_date DESC, recruitment_id
            """)
            return [dict(row) for row in rows]

    @app.get("/advanced-analysis/sources")
    def get_analysis_sources():
        return {"sources": worksheet_options(ANALYSIS_WORKSHEETS)}

    @app.post("/advanced-analysis")
    def run_analysis(request: AnalysisRequest):
        with open_employee_database(database_path) as database:
            return read_analysis(database, ANALYSIS_WORKSHEETS, request)

    return app


app = create_app()
