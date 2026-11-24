import json
import sqlite3
from dataclasses import dataclass
from datetime import date
from typing import Annotated, get_args

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator


FIELD_LABELS = {
    "employee_id": "Employee ID",
    "manager_id": "Manager ID",
    "review_id": "Review ID",
    "survey_id": "Survey ID",
    "exit_id": "Exit ID",
    "recruitment_id": "Recruitment ID",
    "compensation_benefits": "Compensation & benefits",
    "quality_of_hire_90d": "Quality of hire (90 days)",
    "manager_satisfaction_90d": "Manager satisfaction (90 days)",
}


@dataclass(frozen=True)
class Worksheet:
    label: str
    table: str
    model: type[BaseModel]
    date_columns: tuple[str, ...]
    default_columns: tuple[str, ...]
    row_key: str = "employee_id"


class AnalysisKey(BaseModel):
    employee_id: int | None = Field(default=None, gt=0, le=9_007_199_254_740_991)
    date: Annotated[str, Field(pattern=r"^\d{4}-\d{2}(-\d{2})?$")] | None = None

    @model_validator(mode="after")
    def validate_key(self):
        if self.employee_id is None and self.date is None:
            raise ValueError("Each key needs an employee ID, a date, or both.")
        if self.date is not None:
            date.fromisoformat(self.date if len(self.date) == 10 else f"{self.date}-01")
        return self


class WorksheetSelection(BaseModel):
    id: str
    columns: list[str] = Field(min_length=1)
    date_column: str | None = None


class AnalysisRequest(BaseModel):
    sources: list[WorksheetSelection] = Field(min_length=1, max_length=3)
    keys: list[AnalysisKey] = Field(min_length=1)


def worksheet_options(worksheets):
    return [
        {
            "id": key,
            "label": sheet.label,
            "columns": [
                {"id": column, "label": FIELD_LABELS.get(column, column.replace("_", " ").capitalize())}
                for column in sheet.model.model_fields
            ],
            "date_columns": sheet.date_columns,
            "default_columns": sheet.default_columns,
        }
        for key, sheet in worksheets.items()
    ]


def read_analysis(database: sqlite3.Connection, worksheets: dict[str, Worksheet], request: AnalysisRequest):
    if len({source.id for source in request.sources}) != len(request.sources):
        raise HTTPException(422, "Choose each worksheet only once.")

    keys = list(dict.fromkeys((key.employee_id, key.date) for key in request.keys))
    encoded_keys = json.dumps([{"employee_id": employee, "date": period} for employee, period in keys])
    matches = [{employee: {}} if employee is not None else {} for employee, _ in keys]

    for source in request.sources:
        sheet = worksheets.get(source.id)
        if sheet is None:
            raise HTTPException(422, "Unknown worksheet.")

        columns = list(dict.fromkeys(source.columns))
        date_column = source.date_column or sheet.date_columns[0]
        if date_column not in sheet.date_columns or any(column not in sheet.model.model_fields for column in columns):
            raise HTTPException(422, f"Invalid column selection for {sheet.label}.")

        boolean_columns = {
            column for column in columns
            if sheet.model.model_fields[column].annotation is bool
            or bool in get_args(sheet.model.model_fields[column].annotation)
        }
        # SQL identifiers come from the worksheet registry. Pasted criteria are bound as JSON.
        selected_columns = ", ".join(f'records."{column}"' for column in columns)
        period = f'records."{date_column}"'
        date_matches = (
            f"{period} = substr(inputs.lookup_date, 1, 7)"
            if date_column == "month"
            else f"{period} = inputs.lookup_date OR substr({period}, 1, 7) = inputs.lookup_date"
        )
        rows = database.execute(f"""
            WITH inputs AS (
                SELECT CAST(key AS INTEGER) AS input_index,
                       json_extract(value, '$.employee_id') AS employee_id,
                       json_extract(value, '$.date') AS lookup_date
                FROM json_each(?)
            )
            SELECT inputs.input_index, records.employee_id AS matched_employee,
                   {period} AS matched_date, {selected_columns}
            FROM inputs
            JOIN "{sheet.table}" AS records
              ON (inputs.employee_id IS NULL OR records.employee_id = inputs.employee_id)
             AND (inputs.lookup_date IS NULL OR {date_matches})
            ORDER BY inputs.input_index, records.employee_id, {period}, records."{sheet.row_key}"
        """, (encoded_keys,))
        for row in rows:
            employee_matches = matches[row["input_index"]].setdefault(row["matched_employee"], {})
            employee_matches.setdefault(source.id, []).append({
                "date": row["matched_date"],
                "values": {
                    column: bool(row[column]) if column in boolean_columns and row[column] is not None else row[column]
                    for column in columns
                },
            })

    return {
        "rows": [
            {"employee_id": employee, "date": period, "matches": employee_matches}
            for (_, period), by_employee in zip(keys, matches)
            for employee, employee_matches in (by_employee or {None: {}}).items()
        ]
    }
