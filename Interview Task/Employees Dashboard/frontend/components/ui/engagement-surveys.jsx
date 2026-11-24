"use client";

import { Alert, Button, ComboBox, Input, Label, ListBox, Select, Skeleton, Typography } from "@heroui/react";
import { useEffect, useId, useState } from "react";
import { fetchEmployeeJson } from "../../app/employee-request";
import { quarterLabel } from "../../app/period-labels";
import { Charts } from "./charts";
import { CopyAnalysisKeys } from "./copy-analysis-keys";
import { DepartmentTrends, SatisfactionBars } from "./survey-department-charts";

const METRICS = [
  { key: "compensation_benefits", label: "Compensation & benefits" },
  { key: "growth_opportunities", label: "Growth opportunities" },
  { key: "work_culture", label: "Work culture" },
  { key: "work_life_balance", label: "Work–life balance" },
  { key: "management_style", label: "Management style" },
  { key: "recommend_to_friend", label: "Recommend to friend" },
];
const OVERALL = { key: "overall_satisfaction", label: "Overall satisfaction" };
const DEPARTMENT_SERIES = [
  { color: "var(--accent)" },
  { color: "var(--indigo)", dash: "5 2" },
  { color: "var(--survey-teal)", dash: "2 2" },
  { color: "var(--survey-amber)", dash: "8 2 2 2" },
];
const ALL = "__all__";
const SCORE_FORMAT = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const DATE_FORMAT = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

function groupBy(records, key) {
  const groups = new Map();
  for (const record of records) {
    const value = record[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(record);
  }
  return groups;
}

function average(records = [], key) {
  const values = records.map((record) => record[key]).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function EngagementSurveys() {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchEmployeeJson("/engagement-surveys", controller.signal)
      .then((surveys) => {
        if (!controller.signal.aborted) setResult({ surveys });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ error: error.message });
      });
    return () => controller.abort();
  }, [attempt]);

  if (result === null) {
    return (
      <div className="loading-lines monthly-loading" role="status" aria-label="Loading engagement surveys">
        <Skeleton /><Skeleton /><Skeleton />
      </div>
    );
  }
  if (result.error) {
    return (
      <Alert status="danger" className="search-alert">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>Could not load engagement surveys. {result.error}</Alert.Description>
          <Button size="sm" variant="secondary" onPress={() => {
            setResult(null);
            setAttempt((value) => value + 1);
          }}>Retry</Button>
        </Alert.Content>
      </Alert>
    );
  }
  if (!result.surveys.length) {
    return <Typography.Paragraph className="search-hint">The workbook has no engagement surveys.</Typography.Paragraph>;
  }
  return <SurveyDashboard surveys={result.surveys} />;
}

function SurveyDashboard({ surveys }) {
  const quarters = [...new Set(surveys.map(({ survey_quarter }) => survey_quarter))].sort();
  const departments = [...new Set(surveys.map(({ department }) => department))].sort();
  const [department, setDepartment] = useState(ALL);
  const [quarter, setQuarter] = useState(() => quarters.at(-1));
  const [employee, setEmployee] = useState();

  const quarterIndex = quarters.indexOf(quarter);
  const periods = quarters.slice(0, quarterIndex + 1);
  const responses = surveys.filter(({ response_status }) => response_status === "Responded");
  const responsesByDepartment = groupBy(responses, "department");
  const departmentSeries = departments.map((name, index) => {
    const byQuarter = groupBy(responsesByDepartment.get(name) ?? [], "survey_quarter");
    const scores = Object.fromEntries([...METRICS, OVERALL].map(({ key }) => [
      key,
      quarters.map((period) => average(byQuarter.get(period), key)),
    ]));
    return { name, scores, ...DEPARTMENT_SERIES[index % DEPARTMENT_SERIES.length] };
  });
  const records = responses.filter((survey) =>
    survey.survey_quarter <= quarter
    && (department === ALL || survey.department === department)
  );
  const byEmployee = groupBy(records, "employee_id");
  const ids = [...byEmployee.keys()].sort((a, b) => a - b);
  const defaultEmployee = ids.find((id) => byEmployee.get(id).length === periods.length) ?? ids[0] ?? null;
  const employeeId = employee === null || byEmployee.has(employee) ? employee : defaultEmployee;
  const employeeRecords = byEmployee.get(employeeId) ?? [];
  const employeeByQuarter = groupBy(employeeRecords, "survey_quarter");

  return (
    <div className="survey-dashboard">
      <div className="survey-department-overview">
        <DepartmentTrends departments={departmentSeries} metrics={METRICS} quarters={quarters.map(quarterLabel)} />
        <section className="survey-overall-panel" aria-labelledby="survey-overall-heading">
          <div className="survey-section-header">
            <div className="survey-section-heading">
              <Typography.Heading level={2} id="survey-overall-heading">Overall satisfaction by department</Typography.Heading>
              <Typography.Paragraph className="search-hint">Average score out of 5</Typography.Paragraph>
            </div>
            <div className="survey-quarter-picker">
              <SurveySelect
                label="Survey quarter"
                value={quarter}
                onChange={setQuarter}
                options={quarters.toReversed().map((period) => [period, quarterLabel(period)])}
              />
            </div>
          </div>
          <SatisfactionBars
            quarter={quarterLabel(quarter)}
            data={departmentSeries.map(({ name, color, scores }) => ({
              name,
              color,
              score: scores.overall_satisfaction[quarterIndex],
            }))}
          />
        </section>
      </div>

      <section className="survey-section survey-timeline" aria-labelledby="survey-timeline-heading">
        <div className="survey-section-header">
          <div className="survey-section-heading">
            <Typography.Heading level={2} id="survey-timeline-heading">Employee timeline</Typography.Heading>
            <Typography.Paragraph className="search-hint" role="status">
              {employeeRecords.length === 1 ? "1 survey response" : `${employeeRecords.length} survey responses`} through {quarterLabel(quarter)}
            </Typography.Paragraph>
          </div>
          <div className="survey-timeline-filters">
            <SurveySelect
              label="Department"
              value={department}
              onChange={setDepartment}
              options={[[ALL, "All departments"], ...departments.map((name) => [name, name])]}
            />
            <ComboBox
              className="filter"
              variant="secondary"
              selectedKey={employeeId}
              onSelectionChange={setEmployee}
              isDisabled={!ids.length}
            >
              <Label>Employee ID</Label>
              <ComboBox.InputGroup className="monthly-combobox">
                <Input placeholder="Find an employee ID" />
                <ComboBox.Trigger />
              </ComboBox.InputGroup>
              <ComboBox.Popover className="filter-popover">
                <ListBox renderEmptyState={() => "No matching employee IDs."}>
                  {ids.map((id) => (
                    <ListBox.Item id={id} key={id} textValue={String(id)}>{id}<ListBox.ItemIndicator /></ListBox.Item>
                  ))}
                </ListBox>
              </ComboBox.Popover>
            </ComboBox>
          </div>
        </div>
        {employeeRecords.length ? (
          <>
            <CopyAnalysisKeys rows={employeeRecords} dates={[["survey_date", "Survey date"]]} />
            <div className="survey-timeline-grid">
              {[...METRICS.slice(0, -1), OVERALL, METRICS.at(-1)].map((metric) => (
                <SurveyTrend key={metric.key} metric={metric} periods={periods} records={employeeByQuarter} />
              ))}
            </div>
          </>
        ) : (
          <Typography.Paragraph className="search-hint">
            {ids.length ? "Select an employee ID to see their scores." : "No survey responses match these filters."}
          </Typography.Paragraph>
        )}
      </section>
    </div>
  );
}

function SurveySelect({ label, value, options, onChange }) {
  return (
    <Select className="filter" variant="secondary" value={value} onChange={(key) => {
      if (key !== null) onChange(key);
    }}>
      <Label>{label}</Label>
      <Select.Trigger className="filter-trigger"><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover className="filter-popover">
        <ListBox>
          {options.map(([id, title]) => (
            <ListBox.Item id={id} key={id} textValue={title}>{title}<ListBox.ItemIndicator /></ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function SurveyTrend({ metric, periods, records }) {
  const titleId = useId();
  const color = metric.key === OVERALL.key ? "var(--accent)" : "var(--indigo)";
  const data = periods.map((period) => {
    const responses = records.get(period);
    return {
      quarter: quarterLabel(period),
      date: responses?.[0].survey_date ?? null,
      score: average(responses, metric.key),
    };
  });
  const formatSurvey = (quarter) => {
    const date = data.find((row) => row.quarter === quarter)?.date;
    return date ? `${quarter} (${DATE_FORMAT.format(new Date(`${date}T00:00:00Z`))})` : quarter;
  };

  return (
    <figure className="monthly-trend survey-trend" aria-labelledby={titleId}>
      <figcaption id={titleId}>{metric.label}</figcaption>
      <Charts
        className="survey-employee-chart"
        type="line"
        title={metric.label}
        description={data.map(({ quarter, score }) => `${formatSurvey(quarter)}: ${score === null ? "No score" : SCORE_FORMAT.format(score) + " out of 5"}`).join(". ")}
        data={data}
        xKey="quarter"
        series={[{ key: "score", label: metric.label, color }]}
        domain={[1, 5]}
        ticks={[1, 3, 5]}
        showValues={periods.length <= 4}
        formatTooltipLabel={formatSurvey}
      />
    </figure>
  );
}
