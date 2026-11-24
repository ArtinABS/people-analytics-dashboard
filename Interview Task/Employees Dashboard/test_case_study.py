from collections import namedtuple
from datetime import date

import pytest

from case_study import before_exit, build_report, early_retention, review_trends, turnover
from import_employees import DEFAULT_WORKBOOK, import_employees


def exit_event(key, date, reason="Career Development", exit_type="Voluntary"):
    return {"employee_id": key, "exit_date": date, "exit_type": exit_type, "exit_reason": reason}


def test_turnover_accounts_for_headcount_and_time_at_risk():
    employees = {
        1: {"department": "Sales", "hire_date": "2024-01-01"},
        2: {"department": "Sales", "hire_date": "2024-01-01"},
        3: {"department": "Technical", "hire_date": "2025-01-01"},
    }
    exits = {1: exit_event(1, "2025-01-01"), 2: exit_event(2, "2025-10-01", exit_type="Involuntary")}
    snapshots = [
        {"employee_id": key, "month": month}
        for key, month in [(1, "2025-01"), (2, "2025-01"), (2, "2025-02"), (2, "2025-10"), (3, "2025-01")]
    ]
    result = turnover(employees, exits, snapshots)
    assert (result["opening_headcount"], result["hires"], result["total_exits"], result["closing_headcount"]) == (2, 1, 2, 1)
    assert result["headcount_change"] == -0.5
    assert result["voluntary_exits_by_quarter"] == {"2025-Q1": 1, "2025-Q2": 0, "2025-Q3": 0, "2025-Q4": 0}
    assert result["prior_hire_exits_per_100_employee_months"] == {
        "2025-Q1": pytest.approx(100 / 3), "2025-Q2": None, "2025-Q3": None, "2025-Q4": 0,
    }


def test_early_retention_observes_inclusive_90_days_and_excludes_invalid_or_incomplete_dates():
    employees = {
        key: {"hire_date": day} for key, day in {
            1: "2025-01-01", 2: "2025-01-01", 3: "2025-05-01", 4: "2025-10-03",
            5: "2024-12-31", 6: "2025-10-02",
        }.items()
    }
    exits = {
        1: exit_event(1, "2025-04-01"),  # Day 90
        2: exit_event(2, "2025-04-02"),  # Day 91
        3: exit_event(3, "2025-04-30"),  # Before hire
        4: exit_event(4, "2025-10-04"),  # Year-end follow-up is incomplete
        6: exit_event(6, "2025-12-31", "Role Fit", "Involuntary"),  # Day 90 on last day of study
    }
    recruitment = [{"employee_id": 1, "quality_of_hire_90d": 4}, {"employee_id": 6, "quality_of_hire_90d": None}]
    result = early_retention(employees, exits, recruitment)
    assert result == {
        "eligible_hires": 3,
        "incomplete_follow_up": 1,
        "invalid_dates": 1,
        "exits_within_90_days": 2,
        "voluntary_exits_within_90_days": 1,
        "exit_rate": pytest.approx(2 / 3),
        "by_hire_quarter": {
            "2025-Q1": {"hires": 2, "exits": 1},
            "2025-Q2": {"hires": 0, "exits": 0},
            "2025-Q3": {"hires": 0, "exits": 0},
            "2025-Q4": {"hires": 1, "exits": 1},
        },
        "exit_reasons": {"Career Development": 1, "Role Fit": 1},
        "early_exits_with_quality_of_hire_score": 1,
    }
    assert early_retention({}, {}, [])["exit_rate"] is None


def test_pre_exit_comparison_matches_tenure_department_and_survey_date():
    exits = {1: exit_event(1, "2025-04-15"), 3: exit_event(3, "2025-04-10", exit_type="Involuntary")}
    profiles = [
        (1, "Sales", 15, [3, 2.5, 2, 1]),
        (2, "Sales", 17, [4, 4, 3.5, 2]),
        (3, "Sales", 17, [5, 5, 5, 5]),  # Left before the case's exit
        (4, "Sales", 40, [5, 5, 5, 5]),  # Different tenure band
        (5, "Finance", 17, [5, 5, 5, 5]),  # Different department
        (6, "Sales", 17, [4, None, 5, 5]),  # Missing monthly score
    ]
    snapshots = [
        {"employee_id": key, "department": department, "tenure_months": tenure,
         "month": f"2025-{month:02d}", "engagement_score": score}
        for key, department, tenure, scores in profiles for month, score in enumerate(scores, 1)
    ]
    surveys = [
        {"employee_id": key, "department": "Sales", "survey_date": day, "growth_opportunities": score}
        for key, day, score in [
            (1, "2025-03-15", 2), (1, "2025-04-15", 5), (2, "2025-03-15", 4),
            (3, "2025-03-15", 5), (4, "2025-03-15", 5), (6, "2025-03-15", None),
            (6, "2025-03-16", 5),
        ]
    ]
    result = before_exit(exits, snapshots, surveys)
    assert result["engagement_by_month_before_exit"] == {
        -3: {"n": 1, "leavers": 3, "peers": 4},
        -2: {"n": 1, "leavers": 2.5, "peers": 4},
        -1: {"n": 1, "leavers": 2, "peers": 3.5},
    }
    assert result["survey_scores_by_exit_reason"]["Career Development"] == {"n": 1, "leavers": 2, "peers": 4}


def test_review_trends_require_same_people_and_reviews_before_exit():
    Review = namedtuple("Review", "employee_id manager_id scores gap")
    profiles = [
        Review(1, "M01", [4, 3.5, 3, 2.5], [3, 3, 2, 2]),
        Review(2, "M01", [2, 3, 3, 3.5], [None] * 4),
        Review(3, "M01", [5, 5, 5, 5], [1] * 4),  # Q4 review is on the exit date
        Review(4, "M02", [5, None, 5, 5], [1] * 4),  # Missing scored quarter
    ]
    reviews = [
        {"employee_id": profile.employee_id, "department": "Technical", "manager_id": profile.manager_id,
         "review_id": f"{profile.employee_id}-{quarter}", "review_quarter": f"2025-Q{quarter}",
         "review_date": date(2025, quarter * 3, 20).isoformat(), "performance_rating": score, "skills_gap_score": gap}
        for profile in profiles for quarter, (score, gap) in enumerate(zip(profile.scores, profile.gap), 1)
    ]
    result = review_trends(reviews, {3: exit_event(3, "2025-12-20")})
    summary = {
        "employees": 2,
        "average_rating": {"2025-Q1": 3, "2025-Q2": 3.25, "2025-Q3": 3, "2025-Q4": 3},
        "lower_rating_in_q4": 1,
        "below_three": {"2025-Q1": 1, "2025-Q4": 1},
        "average_skills_gap": {"2025-Q1": 3, "2025-Q4": 2},
    }
    assert result == {"departments": {"Technical": summary}, "technical_managers": {"M01": summary}}


@pytest.mark.skipif(not DEFAULT_WORKBOOK.is_file(), reason="The original assignment workbook is absent.")
def test_presentation_figures_reproduce_from_a_fresh_workbook_import(tmp_path):
    database_path = tmp_path / "case-study.sqlite3"
    import_employees(DEFAULT_WORKBOOK, database_path)
    report = build_report(database_path)
    turnover = report["turnover"]
    assert turnover["voluntary_exits_by_quarter"] == {"2025-Q1": 10, "2025-Q2": 27, "2025-Q3": 38, "2025-Q4": 62}
    technical_reasons = turnover["voluntary_exit_reasons_by_department"]["Technical"]
    assert (technical_reasons["Work Pressure"], sum(technical_reasons.values())) == (13, 52)
    assert report["before_exit"]["engagement_by_month_before_exit"][-1] == {
        "n": 109, "leavers": pytest.approx(2.607, abs=0.001), "peers": pytest.approx(3.011, abs=0.001),
    }
    early_exit = report["early_retention"]
    assert (early_exit["eligible_hires"], early_exit["voluntary_exits_within_90_days"], early_exit["invalid_dates"]) == (67, 20, 1)
    assert early_exit["by_hire_quarter"]["2025-Q3"] == {"hires": 21, "exits": 10}
    technical = report["review_trends"]["departments"]["Technical"]
    assert (technical["employees"], technical["lower_rating_in_q4"]) == (65, 49)
    assert technical["average_rating"]["2025-Q4"] == pytest.approx(3.20, abs=0.005)
    assert technical["below_three"] == {"2025-Q1": 18, "2025-Q4": 26}
