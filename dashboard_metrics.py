"""Calculations used by the worksheet views."""

from collections import Counter, defaultdict
from math import isfinite
from statistics import fmean


SURVEY_FIELDS = (
    "compensation_benefits", "growth_opportunities", "work_culture", "work_life_balance",
    "management_style", "overall_satisfaction", "recommend_to_friend",
)
REVIEW_FIELDS = ("performance_rating", "skills_gap_score")


def scores_for(rows, field):
    return [value for row in rows if isinstance(value := row[field], (int, float)) and isfinite(value)]


def survey_averages(rows):
    return {field: fmean(scores) if (scores := scores_for(rows, field)) else None for field in SURVEY_FIELDS}


def survey_summary(rows, quarter, department, employee_id, include_history):
    quarters = sorted({row["survey_quarter"] for row in rows})
    departments = sorted({row["department"] for row in rows})
    quarter = quarter or (quarters[-1] if quarters else None)
    periods = [period for period in quarters if quarter is not None and period <= quarter]
    grouped = defaultdict(list)
    histories = defaultdict(list)
    for row in rows:
        if row["response_status"] != "Responded":
            continue
        grouped[row["department"], row["survey_quarter"]].append(row)
        if row["survey_quarter"] in periods and (department is None or row["department"] == department):
            histories[row["employee_id"]].append(row)

    employee_ids = sorted(histories)
    selected_id = employee_id
    if not include_history:
        selected_id = None
    elif selected_id is None and employee_ids:
        selected_id = next(
            (key for key in employee_ids if len({row["survey_quarter"] for row in histories[key]}) == len(periods)),
            employee_ids[0],
        )
    history = histories.get(selected_id, [])
    by_period = defaultdict(list)
    for row in history:
        by_period[row["survey_quarter"]].append(row)

    return {
        "quarters": quarters,
        "quarter": quarter,
        "departments": [
            {
                "name": name,
                "trend": [survey_averages(grouped[name, period]) for period in quarters],
                "overall_satisfaction": survey_averages(grouped[name, quarter])["overall_satisfaction"],
            }
            for name in departments
        ],
        "employee_ids": employee_ids,
        "employee_id": selected_id,
        "employee_records": history,
        "timeline": [
            {
                "quarter": period,
                "date": entries[0]["survey_date"] if (entries := by_period[period]) else None,
                "averages": survey_averages(entries),
            }
            for period in periods
        ],
    }


def review_groups(rows, group_by):
    groups = defaultdict(list)
    for row in rows:
        groups[row[group_by]].append(row)
    result = []
    for group, reviews in sorted(groups.items()):
        outcomes = Counter(row["promotion_ready"] for row in reviews)
        distributions = {}
        for field in REVIEW_FIELDS:
            bands = [0, 0, 0, 0]
            for score in scores_for(reviews, field):
                if 1 <= score <= 5:
                    bands[min(int(score) - 1, 3)] += 1
            distributions[field] = bands
        result.append({
            "group": group,
            "total": len(reviews),
            "ready": outcomes[True],
            "not_ready": outcomes[False],
            "unknown": outcomes[None],
            "distributions": distributions,
        })
    return result


def recruitment_summary(openings):
    hires = [row for row in openings if row["hire_date"] is not None]
    outcomes = Counter(row["offer_accepted"] for row in openings)
    offers = scores_for(openings, "offers_made")

    def average(field):
        values = scores_for(hires, field)
        return {"count": len(values), "average": fmean(values) if values else None}

    return {
        "openings": openings,
        "offers": sum(offers) if offers else None,
        "accepted": outcomes[True],
        "not_accepted": outcomes[False],
        "unknown": outcomes[None],
        "hires": len(hires),
        "cost_per_hire": average("cost_per_hire"),
        "quality_of_hire_90d": average("quality_of_hire_90d"),
        "manager_satisfaction_90d": average("manager_satisfaction_90d"),
    }
