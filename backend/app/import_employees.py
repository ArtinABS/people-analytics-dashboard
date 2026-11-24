import argparse
import sqlite3
from contextlib import closing
from datetime import date, datetime, timezone
from pathlib import Path
from typing import BinaryIO
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from pydantic import ConfigDict, TypeAdapter

from .paths import DEFAULT_DATABASE, DEFAULT_WORKBOOK

SOURCE_SHEET = "Employees"
HEADERS = (
    "EmployeeID", "Department", "Manager ID", "Hire Date", "Initial Salary Grade",
    "Employment Type", "Work Location", "Date of Birth", "Tenure Months",
)
MONTHLY_SHEET = "Monthly Employee Data"
MONTHLY_HEADERS = (
    "Month", "EmployeeID", "Department", "Manager ID", "Employment Status", "Tenure Months",
    "Performance Rating", "Engagement Score", "Skills Gap Score", "Salary Grade",
    "Months Since Last Promotion",
)
ATTRITION_SHEET = "Attrition Events"
ATTRITION_HEADERS = (
    "ExitID", "EmployeeID", "Exit Date", "Exit Type", "Exit Reason",
    "Eligible For Rehire", "Exit Interview Completed",
)
ENGAGEMENT_SHEET = "Engagement Surveys"
ENGAGEMENT_HEADERS = (
    "Survey ID", "Survey Date", "Survey Quarter", "EmployeeID", "Department",
    "Compensation Benefits", "Growth Opportunities", "Work Culture", "Work Life Balance",
    "Management Style", "Overall Satisfaction", "Recommend to Friend", "Response Status",
)
PERFORMANCE_SHEET = "Performance Reviews"
PERFORMANCE_HEADERS = (
    "Review ID", "Review Date", "Review Quarter", "EmployeeID", "Department", "Manager ID",
    "Performance Rating", "Skills Gap Score", "Promotion Ready", "Months Since Last Promotion",
)
RECRUITMENT_SHEET = "Recruitment"
RECRUITMENT_HEADERS = (
    "Recruitment_ID", "Position", "Department", "Opening Date", "Offer Date", "Hire Date",
    "EmployeeID", "Days to Fill", "Offer Accepted", "Offers Made", "Cost per Hire",
    "Quality of Hire 90d", "Manager Satisfaction 90d",
)

WORKBOOK_LAYOUT = {
    SOURCE_SHEET: HEADERS,
    MONTHLY_SHEET: MONTHLY_HEADERS,
    ATTRITION_SHEET: ATTRITION_HEADERS,
    ENGAGEMENT_SHEET: ENGAGEMENT_HEADERS,
    PERFORMANCE_SHEET: PERFORMANCE_HEADERS,
    RECRUITMENT_SHEET: RECRUITMENT_HEADERS,
}
INTEGER_CELL = TypeAdapter(int)
NUMERIC_CELL = TypeAdapter(float, config=ConfigDict(allow_inf_nan=False))
BOOLEAN_CELL = TypeAdapter(bool)
INTEGER_HEADERS = {
    "EmployeeID", "Tenure Months", "Months Since Last Promotion", "Days to Fill", "Offers Made",
}
BOOLEAN_HEADERS = {
    "Eligible For Rehire", "Exit Interview Completed", "Promotion Ready", "Offer Accepted",
}
NUMERIC_HEADERS = {
    "Performance Rating", "Engagement Score", "Skills Gap Score",
    *ENGAGEMENT_HEADERS[5:-1], "Cost per Hire", "Quality of Hire 90d", "Manager Satisfaction 90d",
}


class WorkbookFormatError(ValueError):
    """The workbook cannot supply valid dashboard records."""


def normalize_cell(header, value):
    if isinstance(value, datetime):
        value = value.date().isoformat()
    if value is None:
        return None
    if header.endswith(" Date") or header in {"Date of Birth", "Month"}:
        if header == "Month" and isinstance(value, str) and len(value) == 7:
            value += "-01"
        return date.fromisoformat(value).isoformat()
    if header in INTEGER_HEADERS:
        return INTEGER_CELL.validate_python(value)
    if header in BOOLEAN_HEADERS:
        return BOOLEAN_CELL.validate_python(value)
    if header in NUMERIC_HEADERS:
        return NUMERIC_CELL.validate_python(value)
    return value


def read_sheet_rows(sheet, headers, *, validate_cells=False):
    values = iter(sheet.values)
    header_row = next(values, ())
    missing = [header for header in headers if header not in header_row]
    if missing:
        raise WorkbookFormatError(f"{sheet.title} is missing columns: {', '.join(missing)}.")
    duplicates = [header for header in headers if header_row.count(header) > 1]
    if validate_cells and duplicates:
        raise WorkbookFormatError(f"{sheet.title} has duplicate columns: {', '.join(duplicates)}.")
    positions = [header_row.index(header) for header in headers]
    for row_number, row in enumerate(values, start=2):
        if any(value is not None for value in row):
            cells = []
            for header, index in zip(headers, positions):
                value = row[index] if index < len(row) else None
                try:
                    if validate_cells:
                        value = normalize_cell(header, value)
                    elif isinstance(value, datetime):
                        value = value.date().isoformat()
                except (TypeError, ValueError) as error:
                    raise WorkbookFormatError(
                        f"{sheet.title}, row {row_number}: {header} has an invalid value."
                    ) from error
                cells.append(value)
            yield tuple(cells)


def import_employees(
    workbook_path: Path | BinaryIO,
    database_path: Path,
    *,
    workbook_name: str | None = None,
    require_full_workbook: bool = False,
) -> int:
    try:
        with closing(load_workbook(workbook_path, read_only=True, data_only=True, keep_links=False)) as workbook:
            required = WORKBOOK_LAYOUT if require_full_workbook else (SOURCE_SHEET,)
            missing = [sheet for sheet in required if sheet not in workbook]
            if missing:
                raise WorkbookFormatError(f"Missing worksheets: {', '.join(missing)}.")
            rows = {
                sheet: list(read_sheet_rows(workbook[sheet], headers, validate_cells=require_full_workbook))
                for sheet, headers in WORKBOOK_LAYOUT.items() if sheet in workbook
            }
    except (BadZipFile, InvalidFileException, ParseError, KeyError) as error:
        raise WorkbookFormatError("This file could not be read as an .xlsx workbook.") from error

    employees = rows[SOURCE_SHEET]
    monthly_rows = [
        (date.fromisoformat(month).isoformat()[:7], *fields)
        for month, *fields in rows.get(MONTHLY_SHEET, [])
    ]
    attrition_rows = rows.get(ATTRITION_SHEET, [])
    survey_rows = rows.get(ENGAGEMENT_SHEET, [])
    review_rows = rows.get(PERFORMANCE_SHEET, [])
    recruitment_rows = rows.get(RECRUITMENT_SHEET, [])
    if workbook_name is None:
        workbook_name = workbook_path.name if isinstance(workbook_path, Path) else "Workbook.xlsx"

    with closing(sqlite3.connect(database_path)) as database, database:
        database.execute("BEGIN")
        database.execute("""
            CREATE TABLE IF NOT EXISTS employees (
                employee_id INTEGER PRIMARY KEY,
                department TEXT NOT NULL,
                manager_id TEXT NOT NULL,
                hire_date TEXT NOT NULL,
                initial_salary_grade TEXT NOT NULL,
                employment_type TEXT NOT NULL,
                work_location TEXT NOT NULL,
                date_of_birth TEXT NOT NULL,
                tenure_months INTEGER NOT NULL
            )
        """)
        # Replace the roster in one transaction so re-imports preserve one row per ID.
        database.execute("DELETE FROM employees")
        database.executemany("""
            INSERT INTO employees (
                employee_id, department, manager_id, hire_date, initial_salary_grade,
                employment_type, work_location, date_of_birth, tenure_months
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, employees)
        database.execute("""
            CREATE TABLE IF NOT EXISTS monthly_employee_data (
                month TEXT NOT NULL,
                employee_id INTEGER NOT NULL,
                department TEXT NOT NULL,
                manager_id TEXT NOT NULL,
                employment_status TEXT NOT NULL,
                tenure_months INTEGER NOT NULL,
                performance_rating REAL,
                engagement_score REAL,
                skills_gap_score REAL,
                salary_grade TEXT NOT NULL,
                months_since_last_promotion INTEGER NOT NULL,
                PRIMARY KEY (employee_id, month)
            )
        """)
        database.execute("DELETE FROM monthly_employee_data")
        database.executemany("""
            INSERT INTO monthly_employee_data (
                month, employee_id, department, manager_id, employment_status, tenure_months,
                performance_rating, engagement_score, skills_gap_score, salary_grade,
                months_since_last_promotion
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, monthly_rows)
        database.execute("""
            CREATE TABLE IF NOT EXISTS attrition_events (
                exit_id TEXT PRIMARY KEY NOT NULL,
                employee_id INTEGER NOT NULL,
                exit_date TEXT NOT NULL,
                exit_type TEXT NOT NULL,
                exit_reason TEXT NOT NULL,
                eligible_for_rehire INTEGER NOT NULL,
                exit_interview_completed INTEGER NOT NULL
            )
        """)
        database.execute("DELETE FROM attrition_events")
        database.executemany("""
            INSERT INTO attrition_events (
                exit_id, employee_id, exit_date, exit_type, exit_reason,
                eligible_for_rehire, exit_interview_completed
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, attrition_rows)
        database.execute("""
            CREATE TABLE IF NOT EXISTS engagement_surveys (
                survey_id TEXT PRIMARY KEY NOT NULL,
                survey_date TEXT NOT NULL,
                survey_quarter TEXT NOT NULL,
                employee_id INTEGER NOT NULL,
                department TEXT NOT NULL,
                compensation_benefits REAL,
                growth_opportunities REAL,
                work_culture REAL,
                work_life_balance REAL,
                management_style REAL,
                overall_satisfaction REAL,
                recommend_to_friend REAL,
                response_status TEXT NOT NULL
            )
        """)
        database.execute("DELETE FROM engagement_surveys")
        database.executemany("""
            INSERT INTO engagement_surveys (
                survey_id, survey_date, survey_quarter, employee_id, department,
                compensation_benefits, growth_opportunities, work_culture, work_life_balance,
                management_style, overall_satisfaction, recommend_to_friend, response_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, survey_rows)
        database.execute("""
            CREATE TABLE IF NOT EXISTS performance_reviews (
                review_id TEXT PRIMARY KEY NOT NULL,
                review_date TEXT NOT NULL,
                review_quarter TEXT NOT NULL,
                employee_id INTEGER NOT NULL,
                department TEXT NOT NULL,
                manager_id TEXT NOT NULL,
                performance_rating REAL,
                skills_gap_score REAL,
                promotion_ready INTEGER,
                months_since_last_promotion INTEGER
            )
        """)
        database.execute("DELETE FROM performance_reviews")
        database.executemany("""
            INSERT INTO performance_reviews (
                review_id, review_date, review_quarter, employee_id, department, manager_id,
                performance_rating, skills_gap_score, promotion_ready, months_since_last_promotion
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, review_rows)
        database.execute("""
            CREATE TABLE IF NOT EXISTS recruitment (
                recruitment_id TEXT PRIMARY KEY NOT NULL,
                position TEXT NOT NULL,
                department TEXT NOT NULL,
                opening_date TEXT NOT NULL,
                offer_date TEXT,
                hire_date TEXT,
                employee_id INTEGER,
                days_to_fill INTEGER,
                offer_accepted INTEGER,
                offers_made INTEGER,
                cost_per_hire REAL,
                quality_of_hire_90d REAL,
                manager_satisfaction_90d REAL
            )
        """)
        database.execute("DELETE FROM recruitment")
        database.executemany("""
            INSERT INTO recruitment (
                recruitment_id, position, department, opening_date, offer_date, hire_date,
                employee_id, days_to_fill, offer_accepted, offers_made, cost_per_hire,
                quality_of_hire_90d, manager_satisfaction_90d
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, recruitment_rows)
        database.execute("""
            CREATE TABLE IF NOT EXISTS employee_import (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                workbook TEXT NOT NULL,
                sheet TEXT NOT NULL,
                imported_at TEXT NOT NULL,
                total INTEGER NOT NULL
            )
        """)
        database.execute("""
            INSERT OR REPLACE INTO employee_import (id, workbook, sheet, imported_at, total)
            VALUES (1, ?, ?, ?, ?)
        """, (workbook_name, SOURCE_SHEET, datetime.now(timezone.utc).isoformat(), len(employees)))
    return len(employees)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import the Employees sheet into SQLite.")
    parser.add_argument("--workbook", type=Path, default=DEFAULT_WORKBOOK)
    args = parser.parse_args()
    count = import_employees(args.workbook, DEFAULT_DATABASE)
    print(f"Imported {count} employee records into {DEFAULT_DATABASE}")
    with closing(sqlite3.connect(DEFAULT_DATABASE)) as database:
        monthly_count = database.execute("SELECT COUNT(*) FROM monthly_employee_data").fetchone()[0]
        attrition_count = database.execute("SELECT COUNT(*) FROM attrition_events").fetchone()[0]
        survey_count = database.execute("SELECT COUNT(*) FROM engagement_surveys").fetchone()[0]
        review_count = database.execute("SELECT COUNT(*) FROM performance_reviews").fetchone()[0]
        recruitment_count = database.execute("SELECT COUNT(*) FROM recruitment").fetchone()[0]
    print(f"Imported {monthly_count} monthly employee records.")
    print(f"Imported {attrition_count} attrition events.")
    print(f"Imported {survey_count} engagement survey records.")
    print(f"Imported {review_count} performance reviews.")
    print(f"Imported {recruitment_count} recruitment records.")
