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
            page = browser.new_page(locale="en-US", reduced_motion="reduce")
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


def test_exit_date_picker_refetches_and_updates_totals(page):
    with page.expect_response(lambda response: is_get(response, "/attrition-events", {})) as unfiltered:
        page.goto(f"{DASHBOARD_URL}/#attrition-events")
    assert unfiltered.value.status == 200
    events = unfiltered.value.json()
    assert len(events) == 152

    start, end = "2025-01-12", "2025-01-22"
    params = {"exit_date_from": [start], "exit_date_to": [end]}
    page.get_by_role("button", name="Calendar Exit date range").click()
    calendar = page.get_by_role("application", name=re.compile(r"Exit date range calendar"))
    with page.expect_response(lambda response: is_get(response, "/attrition-events", params)) as filtered:
        calendar.get_by_role("button", name=re.compile(r"Sunday, January 12, 2025")).click()
        calendar.get_by_role("button", name=re.compile(r"Wednesday, January 22, 2025")).click()

    assert filtered.value.status == 200
    expected = [event for event in events if start <= event["exit_date"] <= end]
    assert len(expected) == 3
    assert filtered.value.json() == expected
    results = page.get_by_role("region", name="Exit records")
    expect(results.get_by_text("3 of 3 exits", exact=True)).to_be_visible()
