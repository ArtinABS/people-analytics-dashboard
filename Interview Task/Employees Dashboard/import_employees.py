import argparse
import sqlite3
from contextlib import closing
from datetime import date, datetime, timezone
from pathlib import Path

from openpyxl import load_workbook


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_WORKBOOK = PROJECT_DIR.parent / "Given Files" / "PA Task.xlsx"
DEFAULT_DATABASE = PROJECT_DIR / "employees.sqlite3"
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


def read_sheet_rows(sheet, headers):
    values = iter(sheet.values)
    header_row = next(values)
    positions = [header_row.index(header) for header in headers]
    for row in values:
        if any(value is not None for value in row):
            yield tuple(
                value.date().isoformat() if isinstance(value, datetime) else value
                for value in (row[index] for index in positions)
            )


def import_employees(workbook_path: Path, database_path: Path) -> int:
    workbook = load_workbook(workbook_path, read_only=True, data_only=True)
    try:
        employees = list(read_sheet_rows(workbook[SOURCE_SHEET], HEADERS))
        monthly_rows = []
        if MONTHLY_SHEET in workbook:
            monthly_rows = [
                (date.fromisoformat(month).isoformat()[:7], *fields)
                for month, *fields in read_sheet_rows(workbook[MONTHLY_SHEET], MONTHLY_HEADERS)
            ]
        attrition_rows = (
            list(read_sheet_rows(workbook[ATTRITION_SHEET], ATTRITION_HEADERS))
            if ATTRITION_SHEET in workbook else []
        )
        survey_rows = (
            list(read_sheet_rows(workbook[ENGAGEMENT_SHEET], ENGAGEMENT_HEADERS))
            if ENGAGEMENT_SHEET in workbook else []
        )
        review_rows = (
            list(read_sheet_rows(workbook[PERFORMANCE_SHEET], PERFORMANCE_HEADERS))
            if PERFORMANCE_SHEET in workbook else []
        )
        recruitment_rows = (
            list(read_sheet_rows(workbook[RECRUITMENT_SHEET], RECRUITMENT_HEADERS))
            if RECRUITMENT_SHEET in workbook else []
        )
    finally:
        workbook.close()

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
        """, (workbook_path.name, SOURCE_SHEET, datetime.now(timezone.utc).isoformat(), len(employees)))
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
