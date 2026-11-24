"use client";

import { ComboBox, Input, Label, ListBox, Select, Typography } from "@heroui/react";
import { useId, useState } from "react";
import { quarterLabel } from "../../app/period-labels";
import { useWorksheetQuery, worksheetPath } from "../../app/worksheet-query";
import { Charts } from "./charts";
import { CopyAnalysisKeys } from "./copy-analysis-keys";
import { DepartmentTrends, SatisfactionBars } from "./survey-department-charts";
import { WorksheetFeedback } from "./worksheet-feedback";

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

export function EngagementSurveys() {
  const options = useWorksheetQuery("/engagement-surveys/options");
  if (!options.data) return <WorksheetFeedback request={options} subject="engagement survey filters" />;
  if (!options.data.quarters.length) {
    return <Typography.Paragraph className="search-hint">The workbook has no engagement surveys.</Typography.Paragraph>;
  }
  return <SurveyDashboard {...options.data} />;
}

function SurveyDashboard({ quarters, departments }) {
  const [department, setDepartment] = useState(ALL);
  const [quarter, setQuarter] = useState(() => quarters.at(-1));
  const [employee, setEmployee] = useState();

  const summary = useWorksheetQuery(worksheetPath("/engagement-surveys/summary", {
    survey_quarter: quarter,
    department: department === ALL ? null : department,
    employee_id: employee,
    include_history: employee === null ? false : undefined,
  }));
  const departmentSeries = (summary.latest?.departments ?? []).map(({ name, trend, overall_satisfaction }, index) => {
    const scores = Object.fromEntries(METRICS.map(({ key }) => [
      key,
      trend.map((period) => period[key]),
    ]));
    return { name, scores, overall_satisfaction, ...DEPARTMENT_SERIES[index % DEPARTMENT_SERIES.length] };
  });
  const ids = summary.latest?.employee_ids ?? [];
  const employeeId = employee === undefined ? summary.latest?.employee_id ?? null : employee;
  const employeeRecords = summary.data?.employee_records ?? [];
  const overallReady = summary.latest?.quarter === quarter;

  return (
    <div className="survey-dashboard">
      <div className="survey-department-overview">
        {summary.latest && <DepartmentTrends departments={departmentSeries} metrics={METRICS} quarters={quarters.map(quarterLabel)} />}
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
          {overallReady ? <SatisfactionBars
            quarter={quarterLabel(quarter)}
            data={departmentSeries.map(({ name, color, overall_satisfaction }) => ({
              name,
              color,
              score: overall_satisfaction,
            }))}
          /> : <WorksheetFeedback request={summary} subject="engagement survey results" />}
        </section>
      </div>

      <section className="survey-section survey-timeline" aria-labelledby="survey-timeline-heading">
        <div className="survey-section-header">
          <div className="survey-section-heading">
            <Typography.Heading level={2} id="survey-timeline-heading">Employee timeline</Typography.Heading>
            {summary.data && (
              <Typography.Paragraph className="search-hint" role="status">
                {employeeRecords.length === 1 ? "1 survey response" : `${employeeRecords.length} survey responses`} through {quarterLabel(quarter)}
              </Typography.Paragraph>
            )}
          </div>
          <div className="survey-timeline-filters">
            <SurveySelect
              label="Department"
              value={department}
              onChange={(value) => {
                setDepartment(value);
                setEmployee(undefined);
              }}
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
        {!summary.data ? overallReady && <WorksheetFeedback request={summary} subject="employee survey timeline" /> : employeeRecords.length ? (
          <>
            <CopyAnalysisKeys rows={employeeRecords} dates={[["survey_date", "Survey date"]]} />
            <div className="survey-timeline-grid">
              {[...METRICS.slice(0, -1), OVERALL, METRICS.at(-1)].map((metric) => (
                <SurveyTrend key={metric.key} metric={metric} timeline={summary.data.timeline} />
              ))}
            </div>
          </>
        ) : (
          <Typography.Paragraph className="search-hint">
            {employee === null && ids.length ? "Select an employee ID to see their scores." : "No survey responses match these filters."}
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

function SurveyTrend({ metric, timeline }) {
  const titleId = useId();
  const color = metric.key === OVERALL.key ? "var(--accent)" : "var(--indigo)";
  const data = timeline.map(({ quarter, date, averages }) => ({
    quarter: quarterLabel(quarter), date, score: averages[metric.key],
  }));
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
        showValues={timeline.length <= 4}
        formatTooltipLabel={formatSurvey}
      />
    </figure>
  );
}
