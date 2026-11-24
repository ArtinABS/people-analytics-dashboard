import json
import sqlite3
from contextlib import closing
from datetime import date, datetime
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.api import create_app
from app.import_employees import (
    ATTRITION_HEADERS, ATTRITION_SHEET, ENGAGEMENT_HEADERS, ENGAGEMENT_SHEET,
    HEADERS, MONTHLY_HEADERS, MONTHLY_SHEET, PERFORMANCE_HEADERS, PERFORMANCE_SHEET, import_employees,
    RECRUITMENT_HEADERS, RECRUITMENT_SHEET, WORKBOOK_LAYOUT,
)


def test_import_twice_and_filter_employees(tmp_path):
    workbook_path = tmp_path / "fixture.xlsx"
    database_path = tmp_path / "employees.sqlite3"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Employees"
    sheet.append(HEADERS)
    sheet.append((1, "Sales", "M01", date(2025, 1, 2), "A", "Full-time", "HQ", date(1993, 1, 1), 4))
    sheet.append((2, "Technical", "M02", date(2025, 1, 3), "D", "Part-time", "Remote", date(1994, 1, 1), 5))
    workbook.save(workbook_path)
    workbook.close()

    import_employees(workbook_path, database_path)
    import_employees(workbook_path, database_path)

    with TestClient(create_app(database_path)) as client:
        unfiltered = client.get("/employees")
        assert unfiltered.status_code == 200
        assert unfiltered.json()["total"] == 2
        assert unfiltered.json()["departments"] == ["Sales", "Technical"]

        filtered = client.get("/employees", params={"department": "Sales"})
        assert filtered.status_code == 200
        assert filtered.json()["total"] == 1
        assert [employee["employee_id"] for employee in filtered.json()["employees"]] == [1]
        assert client.get("/employees", params={"department": "Unknown"}).status_code == 422

        first_employee = {
            "employee_id": 1,
            "department": "Sales",
            "manager_id": "M01",
            "hire_date": "2025-01-02",
            "initial_salary_grade": "A",
            "employment_type": "Full-time",
            "work_location": "HQ",
            "date_of_birth": "1993-01-01",
            "tenure_months": 4,
        }
        for column, value in first_employee.items():
            assert client.get("/employees", params={column: value}).json() == filtered.json()
        assert client.get("/employees", params=first_employee).json() == filtered.json()
        assert client.get("/employees", params={"department": "Sales", "manager_id": "M02"}).json()["total"] == 0
        assert client.get("/employees", params={"hire_date": "invalid"}).status_code == 422

        date_ranges = {
            "hire_date_from": "2025-01-02",
            "hire_date_to": "2025-01-03",
            "date_of_birth_from": "1993-01-01",
            "date_of_birth_to": "1993-01-01",
        }
        assert client.get("/employees", params=date_ranges).json() == filtered.json()
        assert client.get("/employees", params={"hire_date_to": "2025-01-02"}).json() == filtered.json()
        assert client.get("/employees", params={"date_of_birth_from": "1995-01-01"}).json()["total"] == 0
        for field in ("hire_date", "date_of_birth"):
            params = {f"{field}_from": "2025-01-03", f"{field}_to": "2025-01-02"}
            assert client.get("/employees", params=params).status_code == 422

        assert client.get("/employees/filters").json() == {
            "department": ["Sales", "Technical"],
            "manager_id": ["M01", "M02"],
            "initial_salary_grade": ["A", "D"],
            "employment_type": ["Full-time", "Part-time"],
            "work_location": ["HQ", "Remote"],
        }
        assert client.get("/employees/1").json() == first_employee
        assert client.get("/employees/999").status_code == 404

        with client.stream("GET", "/employees", params={**date_ranges, "department": "Sales", "trace": "true"}) as response:
            assert response.status_code == 200
            assert response.headers["content-type"] == "application/x-ndjson"
            events = [json.loads(line) for line in response.iter_lines()]
        assert [event["event"] for event in events] == [
            "api_received", "sqlite_reading", "sqlite_complete", "api_encoding", "result",
        ]
        assert events[2]["total"] == 1
        assert events[2]["elapsed_ms"] >= 0
        assert events[2]["import_info"]["workbook"] == "fixture.xlsx"
        assert events[2]["import_info"]["sheet"] == "Employees"
        assert events[2]["import_info"]["total"] == 2
        assert datetime.fromisoformat(events[2]["import_info"]["imported_at"]).tzinfo is not None
        assert events[-1]["data"] == filtered.json()

        invalid = client.get("/employees", params={"department": "Unknown", "trace": "true"})
        assert [json.loads(line) for line in invalid.text.splitlines()][-1] == {
            "event": "error", "stage": "api", "status": 422, "detail": "Unknown department.",
        }

        with closing(sqlite3.connect(database_path)) as database, database:
            database.execute("DROP TABLE employee_import")
        legacy = client.get("/employees", params={"trace": "true"})
        legacy_events = [json.loads(line) for line in legacy.text.splitlines()]
        assert legacy_events[2]["import_info"] is None
        assert legacy_events[-1]["data"] == unfiltered.json()


def test_trace_identifies_a_database_failure(tmp_path):
    with TestClient(create_app(tmp_path / "missing.sqlite3")) as client:
        assert client.get("/employees").status_code == 503
        traced = client.get("/employees", params={"trace": "true"})
        events = [json.loads(line) for line in traced.text.splitlines()]
        assert [event["event"] for event in events] == ["api_received", "sqlite_reading", "error"]
        assert events[-1]["stage"] == "sqlite"
        assert events[-1]["status"] == 503


def test_failed_import_preserves_the_previous_database(tmp_path):
    workbook_path = tmp_path / "employees.xlsx"
    database_path = tmp_path / "employees.sqlite3"
    with closing(Workbook()) as workbook:
        sheet = workbook.active
        sheet.title = "Employees"
        sheet.append(HEADERS)
        original = (1, "Sales", "M01", date(2025, 1, 2), "A", "Full-time", "HQ", date(1993, 1, 1), 4)
        sheet.append(original)
        workbook.save(workbook_path)
        import_employees(workbook_path, database_path)

        with TestClient(create_app(database_path)) as client:
            before = client.get("/employees")
            assert before.status_code == 200
            sheet["B2"] = "Finance"
            sheet.append(original)  # Duplicate primary key after the roster has been cleared
            workbook.save(workbook_path)
            with pytest.raises(sqlite3.IntegrityError):
                import_employees(workbook_path, database_path)

            after = client.get("/employees")
            assert after.status_code == 200
            assert after.json() == before.json()


def upload_fixture(department="Sales"):
    workbook = Workbook()
    workbook.active.title = "Employees"
    for name, headers in WORKBOOK_LAYOUT.items():
        sheet = workbook.active if name == "Employees" else workbook.create_sheet(name)
        sheet.append(headers)
    workbook.active.append((1, department, "M01", date(2025, 1, 2), "A", "Full-time", "HQ", date(1993, 1, 1), 4))
    workbook[ATTRITION_SHEET].append(("E01", 1, date(2025, 5, 12), "Voluntary", "Role Fit", True, False))
    return workbook


def post_workbook(client, workbook, filename="import.xlsx", origin="http://127.0.0.1:3000"):
    with BytesIO() as content:
        workbook.save(content)
        return client.post(
            "/imports/workbook", files={"file": (filename, content.getvalue())}, headers={"Origin": origin},
        )


def test_workbook_upload_replaces_data_and_reimport_stays_duplicate_free(tmp_path):
    with TestClient(create_app(tmp_path / "employees.sqlite3")) as client, closing(upload_fixture()) as workbook:
        for _ in range(2):
            response = post_workbook(client, workbook)
            assert response.status_code == 200
            assert response.json() == {"workbook": "import.xlsx", "total": 1}
            assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
            assert client.get("/employees", params={"department": "Sales"}).json()["total"] == 1
            assert len(client.get("/attrition-events").json()) == 1

        workbook.active["B2"] = "Technical"
        workbook[ATTRITION_SHEET].delete_rows(2)
        assert post_workbook(client, workbook, "updated.xlsx").status_code == 200
        employees = client.get("/employees").json()
        assert employees["total"] == 1
        assert employees["departments"] == ["Technical"]
        assert client.get("/attrition-events").json() == []
        timeline = client.get("/employees", params={"trace": "true"}).text.splitlines()
        assert json.loads(timeline[2])["import_info"]["workbook"] == "updated.xlsx"


def test_workbook_upload_rejects_invalid_files_without_changing_current_data(tmp_path):
    with TestClient(create_app(tmp_path / "employees.sqlite3")) as client:
        with closing(upload_fixture()) as valid, closing(upload_fixture("Technical")) as invalid:
            assert post_workbook(client, valid).status_code == 200
            previous = client.get("/employees").json()
            previous_exits = client.get("/attrition-events").json()

            wrong_origin = post_workbook(client, invalid, origin="https://other.example")
            assert wrong_origin.status_code == 403
            wrong_extension = post_workbook(client, invalid, filename="import.csv")
            assert wrong_extension.status_code == 400
            corrupt = client.post("/imports/workbook", files={"file": ("broken.xlsx", b"not a workbook")})
            assert corrupt.status_code == 422
            assert "could not be read" in corrupt.json()["detail"]

            invalid.active["D2"] = "not a date"
            bad_date = post_workbook(client, invalid)
            assert bad_date.status_code == 422
            assert bad_date.json()["detail"] == "Employees, row 2: Hire Date has an invalid value."
            invalid.active["D2"] = date(2025, 1, 2)

            attrition = invalid[ATTRITION_SHEET]
            attrition.append(next(attrition.iter_rows(min_row=2, max_row=2, values_only=True)))
            assert post_workbook(client, invalid).status_code == 422
            attrition.delete_rows(3)

            invalid[MONTHLY_SHEET]["A1"] = "Unexpected column"
            missing_column = post_workbook(client, invalid)
            assert missing_column.status_code == 422
            assert missing_column.json()["detail"] == "Monthly Employee Data is missing columns: Month."
            invalid.remove(invalid[MONTHLY_SHEET])
            missing_sheet = post_workbook(client, invalid)
            assert missing_sheet.status_code == 422
            assert missing_sheet.json()["detail"] == "Missing worksheets: Monthly Employee Data."

        assert client.get("/employees").json() == previous
        assert client.get("/attrition-events").json() == previous_exits


def test_import_and_read_monthly_employee_records(tmp_path):
    workbook_path = tmp_path / "monthly.xlsx"
    database_path = tmp_path / "employees.sqlite3"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Employees"
    sheet.append(HEADERS)
    sheet.append((1, "Sales", "M01", date(2024, 1, 2), "A", "Full-time", "HQ", date(1993, 1, 1), 4))
    sheet.append((2, "Technical", "M02", date(2024, 1, 3), "D", "Part-time", "Remote", date(1994, 1, 1), 5))

    monthly = workbook.create_sheet(MONTHLY_SHEET)
    monthly.append(MONTHLY_HEADERS)
    monthly.append((date(2025, 3, 1), 1, "Finance", "M03", "Exited", 14, 4.25, 3.6, None, "B", 2))
    monthly.append((date(2025, 1, 1), 1, "Sales", "M01", "Active", 12, 3.1, 3.2, 2.75, "A", 0))
    monthly.append((date(2025, 2, 1), 2, "Technical", "M02", "Active", 13, 2.75, 4.1, 2.8, "D", 5))
    workbook.save(workbook_path)

    import_employees(workbook_path, database_path)
    import_employees(workbook_path, database_path)

    with TestClient(create_app(database_path)) as client:
        assert client.get("/monthly-employees/options").json() == {
            "months": ["2025-01", "2025-02", "2025-03"],
            "employee_ids": [1, 2],
            "default_employee_id": 1,
        }
        records = client.get("/monthly-employees/1").json()
        assert [record["month"] for record in records] == ["2025-01", "2025-03"]
        assert records[-1] == {
            "month": "2025-03",
            "employee_id": 1,
            "department": "Finance",
            "manager_id": "M03",
            "employment_status": "Exited",
            "tenure_months": 14,
            "performance_rating": 4.25,
            "engagement_score": 3.6,
            "skills_gap_score": None,
            "salary_grade": "B",
            "months_since_last_promotion": 2,
        }
        assert client.get("/monthly-employees/999").json() == []
        assert client.get("/employees/1").json()["department"] == "Sales"
        selected = client.get("/monthly-employees/1/selection", params=[("month", "2025-02"), ("month", "2025-01")])
        assert selected.status_code == 200
        assert selected.json() == {"latest": records[-1], "records": [records[0]]}
        assert client.get("/monthly-employees/1/selection", params={"month": "2025-13"}).status_code == 422
        assert client.get("/monthly-employees/999/selection").json() == {"latest": None, "records": []}

        workbook.remove(monthly)
        workbook.save(workbook_path)
        workbook.close()
        import_employees(workbook_path, database_path)
        assert client.get("/monthly-employees/1").json() == []


def test_attrition_events_filter_inclusive_dates(tmp_path):
    workbook_path = tmp_path / "attrition.xlsx"
    database_path = tmp_path / "employees.sqlite3"
    workbook = Workbook()
    workbook.active.title = "Employees"
    workbook.active.append(HEADERS)
    attrition = workbook.create_sheet(ATTRITION_SHEET)
    attrition.append(ATTRITION_HEADERS)
    for index in range(1, 5):
        reason = "Compensation" if index % 2 == 0 else "Role Fit"
        attrition.append((f"EXIT-{index}", index, date(2025, 1, index), "Voluntary", reason, index > 2, False))
    workbook.save(workbook_path)
    workbook.close()
    import_employees(workbook_path, database_path)

    with TestClient(create_app(database_path)) as client:
        def exit_ids(**params):
            response = client.get("/attrition-events", params=params)
            assert response.status_code == 200
            return [event["exit_id"] for event in response.json()]

        assert exit_ids() == ["EXIT-4", "EXIT-3", "EXIT-2", "EXIT-1"]
        assert exit_ids(exit_date_from="2025-01-02", exit_date_to="2025-01-03") == ["EXIT-3", "EXIT-2"]
        assert exit_ids(exit_date_from="2025-01-02", exit_date_to="2025-01-02") == ["EXIT-2"]
        assert exit_ids(exit_date_from="2025-01-03") == ["EXIT-4", "EXIT-3"]
        assert exit_ids(exit_date_to="2025-01-02") == ["EXIT-2", "EXIT-1"]
        assert exit_ids(exit_date_from="2025-02-01") == []
        assert client.get("/attrition-events", params={"exit_date_from": "invalid"}).status_code == 422
        reversed_dates = {"exit_date_from": "2025-01-03", "exit_date_to": "2025-01-02"}
        assert client.get("/attrition-events", params=reversed_dates).status_code == 422
        summary = client.get("/attrition-events/summary", params={
            "exit_date_from": "2025-01-02", "exit_reason": "Compensation", "eligible_for_rehire": False,
        })
        assert summary.status_code == 200
        assert summary.json()["total"] == 3
        assert summary.json()["reason_counts"] == {"Compensation": 2, "Role Fit": 1}
        assert summary.json()["eligible_for_rehire"] == 2
        assert [item["exit_id"] for item in summary.json()["records"]] == ["EXIT-2"]
        assert client.get("/attrition-events/summary", params={"exit_type": "Involuntary"}).json()["records"] == []
        assert client.get("/attrition-events/summary", params={"eligible_for_rehire": "unknown"}).status_code == 422
        assert client.get("/attrition-events/summary", params=reversed_dates).status_code == 422


def test_import_and_read_engagement_surveys(tmp_path):
    workbook_path = tmp_path / "surveys.xlsx"
    database_path = tmp_path / "employees.sqlite3"
    workbook = Workbook()
    workbook.active.title = "Employees"
    workbook.active.append(HEADERS)
    sheet = workbook.create_sheet(ENGAGEMENT_SHEET)
    sheet.append(ENGAGEMENT_HEADERS)
    sheet.append(("S2", date(2025, 6, 15), "2025-Q2", 1, "Sales", 3, 4, 5, 2, 4, 3.6, 4, "Responded"))
    sheet.append(("S1", date(2025, 3, 15), "2025-Q1", 1, "Sales", None, 3, 4, 2, 3, 3, 2, "Responded"))
    workbook.save(workbook_path)
    workbook.close()
    import_employees(workbook_path, database_path)
    import_employees(workbook_path, database_path)

    with TestClient(create_app(database_path)) as client:
        response = client.get("/engagement-surveys")
        assert response.status_code == 200
        surveys = response.json()
        assert [survey["survey_id"] for survey in surveys] == ["S1", "S2"]
        assert surveys[0]["compensation_benefits"] is None
        assert surveys[1] == {
            "survey_id": "S2",
            "survey_date": "2025-06-15",
            "survey_quarter": "2025-Q2",
            "employee_id": 1,
            "department": "Sales",
            "compensation_benefits": 3,
            "growth_opportunities": 4,
            "work_culture": 5,
            "work_life_balance": 2,
            "management_style": 4,
            "overall_satisfaction": 3.6,
            "recommend_to_friend": 4,
            "response_status": "Responded",
        }
        assert client.get("/engagement-surveys/options").json() == {
            "quarters": ["2025-Q1", "2025-Q2"], "departments": ["Sales"],
        }
        summary = client.get("/engagement-surveys/summary", params={"survey_quarter": "2025-Q1", "department": "Sales"})
        assert summary.status_code == 200
        data = summary.json()
        assert data["employee_ids"] == [1]
        assert data["departments"][0]["overall_satisfaction"] == 3
        assert [point["overall_satisfaction"] for point in data["departments"][0]["trend"]] == [3, 3.6]
        assert [record["survey_id"] for record in data["employee_records"]] == ["S1"]
        assert data["timeline"][0]["averages"]["compensation_benefits"] is None
        assert client.get("/engagement-surveys/summary", params={"department": "Marketing"}).json()["employee_records"] == []
        assert client.get("/engagement-surveys/summary", params={"survey_quarter": "Q2"}).status_code == 422


def test_import_and_read_performance_reviews(tmp_path):
    workbook_path = tmp_path / "performance.xlsx"
    database_path = tmp_path / "employees.sqlite3"
    workbook = Workbook()
    workbook.active.title = "Employees"
    workbook.active.append(HEADERS)
    sheet = workbook.create_sheet(PERFORMANCE_SHEET)
    sheet.append(PERFORMANCE_HEADERS)
    sheet.append(("R2", date(2025, 6, 20), "2025-Q2", 1, "Sales", "M01", 4.5, 2.2, True, 4))
    sheet.append(("R1", date(2025, 3, 20), "2025-Q1", 1, "Sales", "M01", 3.8, None, False, 1))
    workbook.save(workbook_path)
    workbook.close()
    import_employees(workbook_path, database_path)
    import_employees(workbook_path, database_path)

    with TestClient(create_app(database_path)) as client:
        response = client.get("/performance-reviews")
        assert response.status_code == 200
        reviews = response.json()
        assert [review["review_id"] for review in reviews] == ["R1", "R2"]
        assert reviews[0]["skills_gap_score"] is None
        assert reviews[0]["promotion_ready"] is False
        assert reviews[1] == {
            "review_id": "R2",
            "review_date": "2025-06-20",
            "review_quarter": "2025-Q2",
            "employee_id": 1,
            "department": "Sales",
            "manager_id": "M01",
            "performance_rating": 4.5,
            "skills_gap_score": 2.2,
            "promotion_ready": True,
            "months_since_last_promotion": 4,
        }
        assert client.get("/performance-reviews/options").json()["default_employee_id"] == 1
        summary = client.get("/performance-reviews/summary", params={"review_quarter": "2025-Q2", "group_by": "manager_id"})
        assert summary.status_code == 200
        assert summary.json() == {
            "total": 1,
            "groups": [{
                "group": "M01", "total": 1, "ready": 1, "not_ready": 0, "unknown": 0,
                "distributions": {"performance_rating": [0, 0, 0, 1], "skills_gap_score": [0, 1, 0, 0]},
            }],
            "records": [reviews[1]],
        }
        assert client.get("/performance-reviews", params={"employee_id": 1}).json() == reviews
        assert client.get("/performance-reviews", params={"employee_id": 999}).json() == []
        assert client.get("/performance-reviews/summary", params={"group_by": "salary_grade"}).status_code == 422


def test_import_and_read_recruitment_openings(tmp_path):
    workbook_path = tmp_path / "recruitment.xlsx"
    database_path = tmp_path / "employees.sqlite3"
    workbook = Workbook()
    workbook.active.title = "Employees"
    workbook.active.append(HEADERS)
    sheet = workbook.create_sheet(RECRUITMENT_SHEET)
    sheet.append(RECRUITMENT_HEADERS)
    sheet.append(("H1", "Analyst", "Finance", date(2025, 1, 3), date(2025, 2, 2), date(2025, 2, 3), 5, 31,
                  True, 2, 17000000, 4, 4.25))
    sheet.append(("H2", "Analyst", "Finance", date(2025, 2, 3), date(2025, 3, 3), None, None, 28,
                  False, 3, None, None, None))
    workbook.save(workbook_path)
    workbook.close()
    import_employees(workbook_path, database_path)
    import_employees(workbook_path, database_path)

    with TestClient(create_app(database_path)) as client:
        response = client.get("/recruitment")
        assert response.status_code == 200
        openings = response.json()
        assert [opening["recruitment_id"] for opening in openings] == ["H2", "H1"]
        assert openings[0]["offer_accepted"] is False
        assert openings[0]["offers_made"] == 3
        for field in ("hire_date", "employee_id", "cost_per_hire", "quality_of_hire_90d", "manager_satisfaction_90d"):
            assert openings[0][field] is None
        assert openings[1]["offer_accepted"] is True
        assert openings[1]["hire_date"] == "2025-02-03"
        assert openings[1]["cost_per_hire"] == 17000000
        assert openings[1]["quality_of_hire_90d"] == 4
        assert openings[1]["manager_satisfaction_90d"] == 4.25
        assert client.get("/recruitment/options").json() == [{"department": "Finance", "position": "Analyst"}]
        summary = client.get("/recruitment/summary", params={"department": "Finance", "position": "Analyst"})
        assert summary.status_code == 200
        assert summary.json() == {
            "openings": openings,
            "offers": 5, "accepted": 1, "not_accepted": 1, "unknown": 0, "hires": 1,
            "cost_per_hire": {"count": 1, "average": 17000000},
            "quality_of_hire_90d": {"count": 1, "average": 4},
            "manager_satisfaction_90d": {"count": 1, "average": 4.25},
        }
        assert client.get("/recruitment/summary", params={"department": "Sales", "position": "Analyst"}).json()["openings"] == []
        assert client.get("/recruitment/summary", params={"department": "Finance"}).status_code == 422


def test_cross_worksheet_analysis_preserves_matches_and_keys(tmp_path):
    workbook_path = tmp_path / "analysis.xlsx"
    database_path = tmp_path / "employees.sqlite3"
    workbook = Workbook()
    workbook.active.title = "Employees"
    workbook.active.append(HEADERS)
    workbook.active.append((1, "Sales", "M01", date(2024, 7, 10), "A", "Full-time", "HQ", date(1993, 1, 5), 12))
    monthly = workbook.create_sheet(MONTHLY_SHEET)
    monthly.append(MONTHLY_HEADERS)
    monthly.append((date(2025, 1, 1), 1, "Sales", "M01", "Active", 6, 4, 3.4, 2.5, "A", 1))
    monthly.append((date(2025, 2, 1), 1, "Sales", "M01", "Active", 7, 4, 3.2, 2.5, "A", 2))
    survey = workbook.create_sheet(ENGAGEMENT_SHEET)
    survey.append(ENGAGEMENT_HEADERS)
    survey.append(("S1", date(2025, 2, 12), "2025-Q1", 1, "Sales", 3, 2, 4, 3, 2, 3.0, 3, "Responded"))
    survey.append(("S2", date(2025, 2, 13), "2025-Q1", 2, "Sales", 3, 4, 4, 3, 2, 3.2, 4, "Responded"))
    workbook.save(workbook_path)
    workbook.close()
    import_employees(workbook_path, database_path)

    with TestClient(create_app(database_path)) as client:
        sources = client.get("/advanced-analysis/sources").json()["sources"]
        assert len(sources) == 6
        assert sources[0]["date_columns"] == ["hire_date", "date_of_birth"]
        selections = [
            {"id": "monthly-employee-data", "columns": ["engagement_score"]},
            {"id": "engagement-surveys", "columns": ["growth_opportunities"]},
        ]
        keys = [{"employee_id": 1}, {"employee_id": 1, "date": "2025-02-12"}, {"date": "2025-02"}, {"employee_id": 404}]
        response = client.post("/advanced-analysis", json={"sources": selections, "keys": [*keys, keys[0]]})
        assert response.status_code == 200
        history, day_pair, date_match_1, date_match_2, missing = response.json()["rows"]
        assert history["matches"] == {
            "monthly-employee-data": [
                {"date": "2025-01", "values": {"engagement_score": 3.4}},
                {"date": "2025-02", "values": {"engagement_score": 3.2}},
            ],
            "engagement-surveys": [{"date": "2025-02-12", "values": {"growth_opportunities": 2}}],
        }
        assert len(day_pair["matches"]["monthly-employee-data"]) == 1
        assert day_pair["matches"]["engagement-surveys"] == history["matches"]["engagement-surveys"]
        assert day_pair["date"] == "2025-02-12"
        assert date_match_1["employee_id"] == 1
        assert date_match_2["employee_id"] == 2
        assert date_match_2["matches"] == {"engagement-surveys": [{"date": "2025-02-13", "values": {"growth_opportunities": 4}}]}
        assert missing == {"employee_id": 404, "date": None, "matches": {}}

        birthday = client.post("/advanced-analysis", json={
            "sources": [{"id": "employees", "columns": ["department"], "date_column": "date_of_birth"}],
            "keys": [{"date": "1993-01-05"}],
        }).json()["rows"]
        assert birthday[0]["employee_id"] == 1
        bad_payloads = [
            {"sources": [*selections, *selections], "keys": keys},
            {"sources": [selections[0], selections[0]], "keys": keys},
            {"sources": [{"id": "employees", "columns": ["unknown"]}], "keys": keys},
            {"sources": selections, "keys": [{"date": "2025-02-30"}]},
        ]
        for payload in bad_payloads:
            assert client.post("/advanced-analysis", json=payload).status_code == 422
