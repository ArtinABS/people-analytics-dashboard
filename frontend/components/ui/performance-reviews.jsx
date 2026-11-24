"use client";

import { Chip, ComboBox, Input, Label, ListBox, Select, Table, Tabs, Typography } from "@heroui/react";
import { useState } from "react";
import { formatPromotionMonth, quarterLabel } from "../../app/period-labels";
import { useWorksheetQuery, worksheetPath } from "../../app/worksheet-query";
import { Charts } from "./charts";
import { CopyAnalysisKeys } from "./copy-analysis-keys";
import { WorksheetFeedback } from "./worksheet-feedback";

const ALL_QUARTERS = "__all__";
const GROUPINGS = [
  { key: "department", label: "Departments", column: "Department" },
  { key: "manager_id", label: "Managers", column: "Manager ID" },
];
const SCORE_BANDS = [
  { key: "band_1", label: "1 to <2", color: "var(--performance-band-1)" },
  { key: "band_2", label: "2 to <3", color: "var(--performance-band-2)" },
  { key: "band_3", label: "3 to <4", color: "var(--performance-band-3)" },
  { key: "band_4", label: "4 to 5", color: "var(--performance-band-4)" },
];
const REVIEW_METRICS = [
  { key: "performance_rating", label: "Performance rating" },
  { key: "skills_gap_score", label: "Skills gap score" },
];
const PERCENT_TICKS = [0, 25, 50, 75, 100];
const SCORE_TICKS = [1, 2, 3, 4, 5];
const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });
const reviewDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

function readiness(ready) {
  if (ready === null) return "Not recorded";
  return ready ? "Ready" : "Not ready";
}

function countWithShare(count, total) {
  return `${count} (${percent.format(total ? count / total : 0)})`;
}

export function PerformanceReviews() {
  const options = useWorksheetQuery("/performance-reviews/options");
  if (!options.data) return <WorksheetFeedback request={options} subject="performance review filters" />;
  if (!options.data.quarters.length) {
    return <Typography.Paragraph className="search-hint">The workbook has no performance reviews.</Typography.Paragraph>;
  }

  return (
    <div className="performance-dashboard">
      <ReviewBreakdown quarters={options.data.quarters} />
      <EmployeeReviewHistory {...options.data} />
    </div>
  );
}

function ReviewBreakdown({ quarters }) {
  const [quarter, setQuarter] = useState(() => quarters.at(-1));
  const [grouping, setGrouping] = useState("department");
  const summary = useWorksheetQuery(worksheetPath("/performance-reviews/summary", {
    review_quarter: quarter === ALL_QUARTERS ? null : quarter,
    group_by: grouping,
  }));

  return (
    <section aria-labelledby="review-breakdown-heading">
      <div className="survey-section-header">
        <div className="survey-section-heading">
          <Typography.Heading level={2} id="review-breakdown-heading">Review breakdown</Typography.Heading>
          {summary.data && (
            <Typography.Paragraph className="search-hint" role="status">
              {summary.data.total} {summary.data.total === 1 ? "review" : "reviews"}{quarter === ALL_QUARTERS ? " across all quarters" : ` in ${quarterLabel(quarter)}`}
            </Typography.Paragraph>
          )}
        </div>
        <Select className="filter performance-picker" variant="secondary" value={quarter} onChange={(value) => {
          if (value !== null) setQuarter(value);
        }}>
          <Label>Review quarter</Label>
          <Select.Trigger className="filter-trigger"><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover className="filter-popover">
            <ListBox>
              <ListBox.Item id={ALL_QUARTERS} textValue="All quarters">All quarters<ListBox.ItemIndicator /></ListBox.Item>
              {quarters.toReversed().map((period) => (
                <ListBox.Item id={period} key={period} textValue={quarterLabel(period)}>
                  {quarterLabel(period)}<ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <Tabs className="monthly-views performance-views" selectedKey={grouping} onSelectionChange={setGrouping}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Review grouping">
            {GROUPINGS.map(({ key, label }) => <Tabs.Tab key={key} id={key}>{label}<Tabs.Indicator /></Tabs.Tab>)}
          </Tabs.List>
        </Tabs.ListContainer>
        {GROUPINGS.map(({ key, column }) => (
          <Tabs.Panel className="performance-breakdown-panel" id={key} key={key}>
            {grouping === key && (summary.data ? (
              summary.data.total ? <ReviewGroups summary={summary.data} field={key} column={column} />
                : <Typography.Paragraph className="search-hint">No reviews match these filters.</Typography.Paragraph>
            ) : <WorksheetFeedback request={summary} subject="review breakdown" />)}
          </Tabs.Panel>
        ))}
      </Tabs>
    </section>
  );
}

function ReviewGroups({ summary: { records, groups }, field, column }) {
  const titleId = `score-distributions-${field}`;
  const readinessId = `readiness-${field}`;
  return (
    <>
      <section className="performance-distributions" aria-labelledby={titleId}>
        <div className="survey-section-header">
          <div className="survey-section-heading">
            <Typography.Heading level={2} id={titleId}>Score distributions</Typography.Heading>
            <Typography.Paragraph className="search-hint">Share of scored reviews in each band</Typography.Paragraph>
          </div>
          <ul className="survey-department-legend" aria-label="Score bands">
            {SCORE_BANDS.map(({ key, label, color }) => (
              <li key={key}><span className="performance-band-swatch" style={{ backgroundColor: color }} />{label}</li>
            ))}
          </ul>
        </div>
        <div className="performance-distribution-grid">
          {REVIEW_METRICS.map((metric) => <ScoreDistribution key={metric.key} groups={groups} metric={metric} />)}
        </div>
      </section>
      <section className="performance-readiness" aria-labelledby={readinessId}>
        <div className="survey-section-heading">
          <Typography.Heading level={2} id={readinessId}>Promotion readiness</Typography.Heading>
          <Typography.Paragraph className="search-hint">Counts and percentages of reviews</Typography.Paragraph>
        </div>
        <CopyAnalysisKeys rows={records} dates={[["review_date", "Review date"]]} />
        <ReadinessTable groups={groups} column={column} />
      </section>
    </>
  );
}

function ScoreDistribution({ groups, metric }) {
  const data = groups.map(({ group, distributions }) => {
    const counts = distributions[metric.key];
    const total = counts.reduce((sum, count) => sum + count, 0);
    return {
      group,
      total,
      ...Object.fromEntries(SCORE_BANDS.flatMap(({ key }, index) => [
        [key, total ? counts[index] / total * 100 : null],
        [`${key}_count`, counts[index]],
      ])),
    };
  });
  const description = data.map((row) => (
    `${row.group}: ${row.total
      ? SCORE_BANDS.map(({ key, label }) => `${label}, ${countWithShare(row[`${key}_count`], row.total)}`).join(". ")
      : "No scores"}`
  )).join(". ");

  return (
    <figure className="monthly-trend" style={{ "--distribution-height": `${Math.max(150, 31 * data.length + 36)}px` }}>
      <figcaption>{metric.label}</figcaption>
      <Charts
        type="bar"
        orientation="horizontal"
        className="performance-distribution-chart"
        title={`${metric.label} distribution`}
        description={description}
        data={data}
        xKey="group"
        series={SCORE_BANDS}
        domain={[0, 100]}
        ticks={PERCENT_TICKS}
        formatValueAxis={(value) => percent.format(value / 100)}
        formatTooltipValue={(_, row, key) => countWithShare(row[`${key}_count`], row.total)}
        stacked
      />
    </figure>
  );
}

function ReadinessTable({ groups, column }) {
  const hasUnknown = groups.some(({ unknown }) => unknown > 0);
  return (
    <Table className="employee-table performance-readiness-table" variant="secondary">
      <Table.ScrollContainer className="table-scroll" role="region" aria-label="Scrollable promotion readiness results" tabIndex={0}>
        <Table.Content aria-label={`Promotion readiness by ${column.toLowerCase()}`}>
          <Table.Header>
            <Table.Column isRowHeader>{column}</Table.Column>
            <Table.Column>Reviews</Table.Column>
            <Table.Column>Ready</Table.Column>
            <Table.Column>Not ready</Table.Column>
            {hasUnknown && <Table.Column>Not recorded</Table.Column>}
          </Table.Header>
          <Table.Body items={groups}>
            {({ group, total, ready, not_ready, unknown }) => (
              <Table.Row id={group}>
                <Table.Cell>{group}</Table.Cell>
                <Table.Cell>{total}</Table.Cell>
                <Table.Cell>{countWithShare(ready, total)}</Table.Cell>
                <Table.Cell>{countWithShare(not_ready, total)}</Table.Cell>
                {hasUnknown && <Table.Cell>{countWithShare(unknown, total)}</Table.Cell>}
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function EmployeeReviewHistory({ employee_ids: ids, default_employee_id, quarters }) {
  const [employeeId, setEmployeeId] = useState(default_employee_id);
  const request = useWorksheetQuery(employeeId === null ? null : worksheetPath("/performance-reviews", { employee_id: employeeId }));
  const history = request.data ?? [];
  const latest = history.at(-1);
  const byQuarter = new Map(history.map((review) => [review.review_quarter, review]));
  const data = quarters.map((quarter) => {
    const review = byQuarter.get(quarter);
    return {
      quarter: quarterLabel(quarter),
      rating: review?.performance_rating ?? null,
      readiness: readiness(review?.promotion_ready ?? null),
    };
  });

  return (
    <section className="performance-employee-history" aria-labelledby="performance-employee-heading">
      <div className="survey-section-header">
        <div className="survey-section-heading">
          <Typography.Heading level={2} id="performance-employee-heading">Employee review history</Typography.Heading>
          {request.data && (
            <Typography.Paragraph className="search-hint" role="status">
              {history.length} {history.length === 1 ? "review" : "reviews"} for the selected employee
            </Typography.Paragraph>
          )}
        </div>
        <ComboBox className="filter performance-picker" variant="secondary" selectedKey={employeeId} onSelectionChange={setEmployeeId}>
          <Label>Employee ID</Label>
          <ComboBox.InputGroup className="monthly-combobox">
            <Input placeholder="Find an employee ID" /><ComboBox.Trigger />
          </ComboBox.InputGroup>
          <ComboBox.Popover className="filter-popover">
            <ListBox renderEmptyState={() => "No matching employee IDs."}>
              {ids.map((id) => <ListBox.Item id={id} key={id} textValue={String(id)}>{id}<ListBox.ItemIndicator /></ListBox.Item>)}
            </ListBox>
          </ComboBox.Popover>
        </ComboBox>
      </div>

      {request.loading || request.error ? <WorksheetFeedback request={request} subject="employee review history" /> : latest ? (
        <>
          <dl className="monthly-snapshot performance-review-snapshot">
            <div>
              <dt>Latest review</dt>
              <dd><time dateTime={latest.review_date}>{reviewDate.format(new Date(`${latest.review_date}T00:00:00Z`))}</time></dd>
            </div>
            <div>
              <dt>Latest promotion (estimated)</dt>
              <dd>{formatPromotionMonth(latest.review_date, latest.months_since_last_promotion)}</dd>
            </div>
            <div>
              <dt>Promotion readiness</dt>
              <dd><Chip variant="soft" size="sm" color={latest.promotion_ready ? "success" : "default"}>{readiness(latest.promotion_ready)}</Chip></dd>
            </div>
          </dl>
          <CopyAnalysisKeys rows={history} dates={[["review_date", "Review date"]]} />
          <figure className="monthly-trend">
            <figcaption>Performance rating across reviews</figcaption>
            <Charts
              type="line"
              className="performance-history-chart"
              title="Employee performance rating by quarter"
              description={data.map(({ quarter, rating }) => `${quarter}: ${rating ?? "No score"}`).join(". ")}
              data={data}
              xKey="quarter"
              series={[{ key: "rating", label: "Performance rating", color: "var(--accent)" }]}
              domain={[1, 5]}
              ticks={SCORE_TICKS}
              showValues
              tooltipDetails={(row) => <dl><div><dt>Promotion readiness</dt><dd>{row.readiness}</dd></div></dl>}
            />
          </figure>
        </>
      ) : (
        <Typography.Paragraph className="search-hint">
          {employeeId === null ? "Select an employee ID to see their reviews." : "No reviews were found for this employee."}
        </Typography.Paragraph>
      )}
    </section>
  );
}
