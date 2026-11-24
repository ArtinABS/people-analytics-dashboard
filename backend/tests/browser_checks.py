"""Opt-in browser tests against the running dashboard and API using PA Task.xlsx."""

import os
import re
from urllib.parse import parse_qs, urlsplit

import pytest
from playwright.sync_api import expect, sync_playwright


DASHBOARD_URL = "http://127.0.0.1:3000"


@pytest.fixture
def page():
    with sync_playwright() as playwright:
        channel = os.environ.get("DASHBOARD_TEST_BROWSER")
        with playwright.chromium.launch(channel=channel) as browser:
            page = browser.new_page(locale="en-US", reduced_motion="reduce", viewport={"width": 1440, "height": 960})
            page.set_default_timeout(10_000)
            yield page


def is_get(response, path, params):
    url = urlsplit(response.url)
    return response.request.method == "GET" and url.path == path and parse_qs(url.query) == params


def test_employee_department_filter_calls_api_and_updates_table(page):
    page.goto(f"{DASHBOARD_URL}/#employee-search")
    search = page.get_by_role("button", name="Search", exact=True)
    with page.expect_response(lambda response: is_get(response, "/employees", {})) as unfiltered:
        search.click()
    assert unfiltered.value.status == 200
    employees = unfiltered.value.json()["employees"]
    assert len(employees) == 360

    page.get_by_role("button", name=re.compile(r"Department")).click()
    page.get_by_role("option", name="Sales", exact=True).click()
    with page.expect_response(lambda response: is_get(response, "/employees", {"department": ["Sales"]})) as filtered:
        search.click()

    assert filtered.value.status == 200
    expected = [employee for employee in employees if employee["department"] == "Sales"]
    assert filtered.value.json()["employees"] == expected
    assert len(expected) == 103
    results = page.get_by_role("region", name="Employee search results")
    expect(results.get_by_text("103 matching records.", exact=False)).to_be_visible()
    table = results.get_by_role("grid", name="Matching employees")
    expect(table.get_by_role("rowheader", name=str(expected[0]["employee_id"]), exact=True)).to_be_visible()

    devtools = page.get_by_role("complementary", name="API DevTools")
    devtools.get_by_role("button", name="DevTools", exact=True).click()
    request = devtools.get_by_role("listitem").filter(has_text="/employees?department=Sales")
    expect(request).to_contain_text("HTTP 200")


def test_exit_date_and_chart_filters_refetch_and_update_table(page):
    endpoint = "/attrition-events/summary"
    with page.expect_response(lambda response: is_get(response, endpoint, {})) as unfiltered:
        page.goto(f"{DASHBOARD_URL}/#attrition-events")
    assert unfiltered.value.status == 200
    events = unfiltered.value.json()["records"]
    assert len(events) == 152

    start, end = "2025-01-12", "2025-01-22"
    params = {"exit_date_from": [start], "exit_date_to": [end]}
    page.get_by_role("button", name="Calendar Exit date range").click()
    calendar = page.get_by_role("application", name=re.compile(r"Exit date range calendar"))
    with page.expect_response(lambda response: is_get(response, endpoint, params)) as filtered:
        calendar.get_by_role("button", name=re.compile(r"Sunday, January 12, 2025")).click()
        calendar.get_by_role("button", name=re.compile(r"Wednesday, January 22, 2025")).click()

    assert filtered.value.status == 200
    expected = [event for event in events if start <= event["exit_date"] <= end]
    assert len(expected) == 3
    assert filtered.value.json()["records"] == expected
    results = page.get_by_role("region", name="Exit records")
    expect(results.get_by_text("3 of 3 exits", exact=True)).to_be_visible()

    chart = page.get_by_role("region", name="Exit types")
    with page.expect_response(lambda response: is_get(response, endpoint, {**params, "exit_type": ["Voluntary"]})) as selected:
        chart.get_by_role("button", name=re.compile(r"^Voluntary")).click()
    assert selected.value.status == 200
    assert selected.value.json()["records"] == [row for row in expected if row["exit_type"] == "Voluntary"]
    expect(results.get_by_text("2 of 3 exits", exact=True)).to_be_visible()


def test_month_selection_refetches_records(page):
    page.goto(f"{DASHBOARD_URL}/#monthly-employee-data")
    expect(page.get_by_role("heading", name="Employee summary", exact=True)).to_be_visible()
    selected = page.get_by_role("combobox", name="Employee ID", exact=True).input_value()
    endpoint = f"/monthly-employees/{selected}/selection"
    page.get_by_role("button", name="December 2025 Months").click()
    with page.expect_response(lambda response: urlsplit(response.url).path == endpoint and
                              sorted(parse_qs(urlsplit(response.url).query).get("month", [])) == ["2025-11", "2025-12"]) as response:
        page.get_by_role("option", name="November 2025", exact=True).click()
    assert response.value.status == 200
    payload = response.value.json()
    assert payload["latest"]["month"] == "2025-12"
    assert [row["month"] for row in payload["records"]] == ["2025-11", "2025-12"]
    expect(page.get_by_role("heading", name="Score trends")).to_be_visible()


def test_survey_quarter_and_department_refetch_averages_and_history(page):
    endpoint = "/engagement-surveys/summary"
    page.goto(f"{DASHBOARD_URL}/#engagement-surveys")
    expect(page.get_by_role("heading", name="Department trends", exact=True)).to_be_visible()
    page.get_by_role("button", name=re.compile(r"Survey quarter")).click()
    with page.expect_response(lambda response: is_get(response, endpoint, {"survey_quarter": ["2025-Q1"]})) as quarter:
        page.get_by_role("option", name="Q1 2025", exact=True).click()
    assert quarter.value.status == 200
    assert quarter.value.json()["quarter"] == "2025-Q1"

    page.get_by_role("button", name="All departments Department", exact=True).click()
    with page.expect_response(lambda response: is_get(response, endpoint, {
        "survey_quarter": ["2025-Q1"], "department": ["Sales"],
    })) as department:
        page.get_by_role("option", name="Sales", exact=True).click()
    assert department.value.status == 200
    payload = department.value.json()
    assert payload["employee_records"]
    assert all(row["department"] == "Sales" and row["survey_quarter"] == "2025-Q1" for row in payload["employee_records"])
    expect(page.get_by_text("1 survey response through Q1 2025", exact=True)).to_be_visible()

    next_id = str(next(key for key in payload["employee_ids"] if key != payload["employee_id"]))
    field = page.get_by_role("combobox", name="Employee ID", exact=True)
    field.evaluate("(element) => element.scrollIntoView({block: 'center'})")
    field.fill(next_id)
    expect(page.get_by_role("option", name=next_id, exact=True)).to_be_visible()
    with page.expect_response(lambda response: is_get(response, endpoint, {
        "survey_quarter": ["2025-Q1"], "department": ["Sales"], "employee_id": [next_id],
    })) as employee:
        field.press("ArrowDown")
        field.press("Enter")
    assert employee.value.status == 200
    assert employee.value.json()["employee_id"] == int(next_id)


def test_review_grouping_and_quarter_refetch_breakdown(page):
    endpoint = "/performance-reviews/summary"
    page.goto(f"{DASHBOARD_URL}/#performance-reviews")
    expect(page.get_by_role("heading", name="Promotion readiness", exact=True)).to_be_visible()
    page.get_by_role("button", name=re.compile(r"Review quarter")).click()
    with page.expect_response(lambda response: is_get(response, endpoint, {
        "review_quarter": ["2025-Q1"], "group_by": ["department"],
    })) as quarter:
        page.get_by_role("option", name="Q1 2025", exact=True).click()
    assert quarter.value.status == 200
    assert all(row["review_quarter"] == "2025-Q1" for row in quarter.value.json()["records"])
    with page.expect_response(lambda response: is_get(response, endpoint, {
        "review_quarter": ["2025-Q1"], "group_by": ["manager_id"],
    })) as grouping:
        page.get_by_role("tab", name="Managers", exact=True).click()
    assert grouping.value.status == 200
    payload = grouping.value.json()
    assert {row["group"] for row in payload["groups"]} == {row["manager_id"] for row in payload["records"]}
    expect(page.get_by_role("grid", name="Promotion readiness by manager id")).to_be_visible()

    history = page.get_by_role("combobox", name="Employee ID", exact=True)
    previous_id = int(history.input_value())
    next_id = str(next(row["employee_id"] for row in payload["records"] if row["employee_id"] != previous_id))
    history.evaluate("(element) => element.scrollIntoView({block: 'center'})")
    history.fill(next_id)
    expect(page.get_by_role("option", name=next_id, exact=True)).to_be_visible()
    with page.expect_response(lambda response: is_get(response, "/performance-reviews", {"employee_id": [next_id]})) as selected:
        history.press("ArrowDown")
        history.press("Enter")
    assert selected.value.status == 200
    assert all(row["employee_id"] == int(next_id) for row in selected.value.json())


def test_recruitment_position_refetches_kpis(page):
    page.goto(f"{DASHBOARD_URL}/#recruitment")
    nav = page.get_by_role("navigation", name="Positions by department")
    expect(nav.get_by_role("button", name="Financial Analyst", exact=True)).to_be_visible()
    with page.expect_response(lambda response: is_get(response, "/recruitment/summary", {
        "department": ["Finance"], "position": ["Financial Analyst"],
    })) as result:
        nav.get_by_role("button", name="Financial Analyst", exact=True).click()
    assert result.value.status == 200
    openings = result.value.json()["openings"]
    assert openings and all(row["position"] == "Financial Analyst" for row in openings)
    expect(page.get_by_role("heading", name="Financial Analyst", exact=True)).to_be_visible()
    expect(page.get_by_role("heading", name="Opening history", exact=True)).to_be_visible()
    expect(page.get_by_role("link", name="Data Dictionary", exact=True)).to_have_count(0)
