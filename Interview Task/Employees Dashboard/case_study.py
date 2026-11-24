"""Reproduce the 2025 presentation's main calculations from the imported workbook."""

import argparse
import json
import sqlite3
from bisect import bisect_right
from collections import Counter, defaultdict
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path
from statistics import fmean

from import_employees import DEFAULT_DATABASE

START = date(2025, 1, 1)
END = date(2025, 12, 31)
QUARTERS = tuple(f"2025-Q{number}" for number in range(1, 5))
TENURE_BOUNDS = (6, 12, 24, 48)
SURVEY_DIMENSIONS = {
    "Career Development": "growth_opportunities",
    "Work Pressure": "work_life_balance",
    "Compensation": "compensation_benefits",
}


def quarter(day):
    return QUARTERS[(day.month - 1) // 3]


def mean(values):
    scores = [value for value in values if value is not None]
    return fmean(scores) if scores else None


def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def turnover(employees, exits, snapshots):
    start, end = START.isoformat(), END.isoformat()
    opening = sum(row["hire_date"] < start <= exits.get(key, {}).get("exit_date", "9999")
                  for key, row in employees.items())
    closing_count = sum(row["hire_date"] <= end < exits.get(key, {}).get("exit_date", "9999")
                        for key, row in employees.items())
    in_year = [row for row in exits.values() if start <= row["exit_date"] <= end]
    voluntary = [row for row in in_year if row["exit_type"] == "Voluntary"]
    counts = Counter(quarter(date.fromisoformat(row["exit_date"])) for row in voluntary)
    reasons_by_department = defaultdict(Counter)
    for event in voluntary:
        employee = employees.get(event["employee_id"])
        if employee is not None:
            reasons_by_department[employee["department"]][event["exit_reason"]] += 1
    prior_hire_ids = {key for key, row in employees.items() if row["hire_date"] < start}
    prior_counts = Counter(quarter(date.fromisoformat(row["exit_date"])) for row in voluntary
                           if row["employee_id"] in prior_hire_ids)
    exposure = Counter(quarter(date.fromisoformat(row["month"] + "-01")) for row in snapshots
                       if row["employee_id"] in prior_hire_ids and start[:7] <= row["month"] <= end[:7])
    return {
        "opening_headcount": opening,
        "hires": sum(start <= row["hire_date"] <= end for row in employees.values()),
        "total_exits": len(in_year),
        "closing_headcount": closing_count,
        "headcount_change": ratio(closing_count - opening, opening),
        "voluntary_exits": len(voluntary),
        "voluntary_exits_by_quarter": {period: counts[period] for period in QUARTERS},
        "voluntary_exit_reasons_by_department": {
            department: dict(reasons) for department, reasons in reasons_by_department.items()
        },
        "prior_hire_exits_per_100_employee_months": {
            period: ratio(100 * prior_counts[period], exposure[period]) for period in QUARTERS
        },
        "q4_voluntary_exits_by_department": dict(Counter(
            employees[row["employee_id"]]["department"]
            for row in voluntary
            if row["exit_date"] >= "2025-10-01" and row["employee_id"] in employees
        )),
    }


def early_retention(employees, exits, recruitment):
    eligible, incomplete, invalid = Counter(), 0, 0
    early_exits, reasons = Counter(), Counter()
    voluntary, scored = 0, 0
    scored_hires = {row["employee_id"] for row in recruitment if row["quality_of_hire_90d"] is not None}
    for key, employee in employees.items():
        hired = date.fromisoformat(employee["hire_date"])
        if not START <= hired <= END:
            continue
        event = exits.get(key)
        left = date.fromisoformat(event["exit_date"]) if event else None
        if left and left < hired:
            invalid += 1
            continue
        if hired + timedelta(days=90) > END:
            incomplete += 1
            continue
        period = quarter(hired)
        eligible[period] += 1
        if left and left <= hired + timedelta(days=90):
            early_exits[period] += 1
            reasons[event["exit_reason"]] += 1
            voluntary += event["exit_type"] == "Voluntary"
            scored += key in scored_hires

    return {
        "eligible_hires": eligible.total(),
        "incomplete_follow_up": incomplete,
        "invalid_dates": invalid,
        "exits_within_90_days": early_exits.total(),
        "voluntary_exits_within_90_days": voluntary,
        "exit_rate": ratio(early_exits.total(), eligible.total()),
        "by_hire_quarter": {period: {"hires": eligible[period], "exits": early_exits[period]} for period in QUARTERS},
        "exit_reasons": dict(reasons),
        "early_exits_with_quality_of_hire_score": scored,
    }


def before_exit(exits, snapshots, surveys):
    monthly = {(row["employee_id"], int(row["month"][5:])): row for row in snapshots
               if row["month"].startswith("2025-")}
    surveys_by_employee = defaultdict(list)
    surveys_by_day = defaultdict(list)
    for row in sorted(surveys, key=lambda survey: survey["survey_date"]):
        if START.isoformat() <= row["survey_date"] <= END.isoformat():
            surveys_by_employee[row["employee_id"]].append(row)
            surveys_by_day[row["survey_date"]].append(row)

    engagement_pairs = defaultdict(list)
    survey_pairs = defaultdict(list)
    for key, event in exits.items():
        day = event["exit_date"]
        if event["exit_type"] != "Voluntary" or not START.isoformat() <= day <= END.isoformat():
            continue
        month = date.fromisoformat(day).month
        snapshot = monthly.get((key, month))
        if snapshot is None:
            continue
        band = bisect_right(TENURE_BOUNDS, snapshot["tenure_months"])
        peers = {
            peer for (peer, period), row in monthly.items()
            if period == month and peer != key and row["department"] == snapshot["department"]
            and bisect_right(TENURE_BOUNDS, row["tenure_months"]) == band
            and exits.get(peer, {}).get("exit_date", "9999") > day
        }

        offsets = (-3, -2, -1)
        history = [monthly.get((key, month + offset), {}).get("engagement_score") for offset in offsets]
        if all(score is not None for score in history):
            peer_histories = [
                [monthly.get((peer, month + offset), {}).get("engagement_score") for offset in offsets]
                for peer in sorted(peers)
            ]
            complete_peers = [scores for scores in peer_histories if all(score is not None for score in scores)]
            if complete_peers:
                for offset, score, peer_scores in zip(offsets, history, zip(*complete_peers)):
                    engagement_pairs[offset].append((score, fmean(peer_scores)))

        reason = event["exit_reason"]
        if reason in SURVEY_DIMENSIONS:
            field = SURVEY_DIMENSIONS[reason]
            last = next((row for row in reversed(surveys_by_employee[key]) if row["survey_date"] < day), None)
            if last is None or last[field] is None:
                continue
            peers_mean = mean(row[field] for row in surveys_by_day[last["survey_date"]]
                              if row["employee_id"] in peers and row["department"] == last["department"])
            if peers_mean is not None:
                survey_pairs[reason].append((last[field], peers_mean))

    def summarize(pairs):
        return {
            "n": len(pairs),
            "leavers": mean(case for case, _ in pairs),
            "peers": mean(peer for _, peer in pairs),
        }

    return {
        "engagement_by_month_before_exit": {offset: summarize(engagement_pairs[offset]) for offset in (-3, -2, -1)},
        "survey_scores_by_exit_reason": {reason: summarize(survey_pairs[reason]) for reason in SURVEY_DIMENSIONS},
    }


def review_trends(reviews, exits):
    by_employee = defaultdict(dict)
    for row in sorted(reviews, key=lambda review: (review["review_date"], review["review_id"])):
        key = row["employee_id"]
        if (row["review_quarter"] in QUARTERS and row["performance_rating"] is not None
                and row["review_date"] < exits.get(key, {}).get("exit_date", "9999")):
            by_employee[key][row["review_quarter"]] = row

    departments, managers = defaultdict(list), defaultdict(list)
    for periods in by_employee.values():
        if all(period in periods for period in QUARTERS):
            history = [periods[period] for period in QUARTERS]
            departments[history[0]["department"]].append(history)
            if history[0]["department"] == "Technical":
                managers[history[0]["manager_id"]].append(history)

    def summarize(group):
        return {
            "employees": len(group),
            "average_rating": {period: mean(history[index]["performance_rating"] for history in group)
                               for index, period in enumerate(QUARTERS)},
            "lower_rating_in_q4": sum(history[-1]["performance_rating"] < history[0]["performance_rating"]
                                      for history in group),
            "below_three": {QUARTERS[index]: sum(history[index]["performance_rating"] < 3 for history in group)
                            for index in (0, -1)},
            "average_skills_gap": {QUARTERS[index]: mean(history[index]["skills_gap_score"] for history in group)
                                   for index in (0, -1)},
        }

    return {
        "departments": {name: summarize(group) for name, group in departments.items()},
        "technical_managers": {name: summarize(group) for name, group in managers.items()},
    }


def build_report(database_path):
    with closing(sqlite3.connect(f"{Path(database_path).resolve().as_uri()}?mode=ro", uri=True)) as database:
        database.row_factory = sqlite3.Row
        employees = {row["employee_id"]: dict(row) for row in database.execute("SELECT * FROM employees")}
        exits = {row["employee_id"]: dict(row) for row in database.execute("SELECT * FROM attrition_events")}
        snapshots = [dict(row) for row in database.execute("SELECT * FROM monthly_employee_data")]
        surveys = [dict(row) for row in database.execute("SELECT * FROM engagement_surveys")]
        reviews = [dict(row) for row in database.execute("SELECT * FROM performance_reviews")]
        recruitment = [dict(row) for row in database.execute("SELECT * FROM recruitment")]
    return {
        "turnover": turnover(employees, exits, snapshots),
        "before_exit": before_exit(exits, snapshots, surveys),
        "early_retention": early_retention(employees, exits, recruitment),
        "review_trends": review_trends(reviews, exits),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    args = parser.parse_args()
    print(json.dumps(build_report(args.database), indent=2, sort_keys=True))
