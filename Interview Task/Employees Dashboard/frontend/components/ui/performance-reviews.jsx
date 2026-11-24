"use client";

import { Alert, Button, Chip, ComboBox, Input, Label, ListBox, Select, Skeleton, Table, Tabs, Typography } from "@heroui/react";
import { useEffect, useState } from "react";
import { fetchEmployeeJson } from "../../app/employee-request";
import { formatPromotionMonth, quarterLabel } from "../../app/period-labels";
import { Charts } from "./charts";
import { CopyAnalysisKeys } from "./copy-analysis-keys";

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

function groupBy(reviews, field) {
  const groups = new Map();
  for (const review of reviews) {
    const key = review[field];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(review);
  }
  return groups;
}

function readiness(ready) {
  if (ready === null) return "Not recorded";
  return ready ? "Ready" : "Not ready";
}

function countWithShare(count, total) {
  return `${count} (${percent.format(total ? count / total : 0)})`;
}

export function PerformanceReviews() {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchEmployeeJson("/performance-reviews", controller.signal)
      .then((reviews) => {
        if (!controller.signal.aborted) setResult({ reviews });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ error: error.message });
      });
    return () => controller.abort();
  }, [attempt]);

  if (result === null) {
    return (
      <div className="loading-lines monthly-loading" role="status" aria-label="Loading performance reviews">
        <Skeleton /><Skeleton /><Skeleton />
      </div>
    );
  }
  if (result.error) {
    return (
      <Alert status="danger" className="search-alert">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>Could not load performance reviews. {result.error}</Alert.Description>
          <Button size="sm" variant="secondary" onPress={() => {
            setResult(null);
            setAttempt((value) => value + 1);
          }}>Retry</Button>
        </Alert.Content>
      </Alert>
    );
  }
  if (!result.reviews.length) {
    return <Typography.Paragraph className="search-hint">The workbook has no performance reviews.</Typography.Paragraph>;
  }

  const quarters = [...new Set(result.reviews.map(({ review_quarter }) => review_quarter))].sort();
  return (
    <div className="performance-dashboard">
      <ReviewBreakdown reviews={result.reviews} quarters={quarters} />
      <EmployeeReviewHistory reviews={result.reviews} quarters={quarters} />
    </div>
  );
}

function ReviewBreakdown({ reviews, quarters }) {
  const [quarter, setQuarter] = useState(() => quarters.at(-1));
  const scoped = quarter === ALL_QUARTERS ? reviews : reviews.filter((review) => review.review_quarter === quarter);

  return (
    <section aria-labelledby="review-breakdown-heading">
      <div className="survey-section-header">
        <div className="survey-section-heading">
          <Typography.Heading level={2} id="review-breakdown-heading">Review breakdown</Typography.Heading>
          <Typography.Paragraph className="search-hint" role="status">
            {scoped.length} {scoped.length === 1 ? "review" : "reviews"}{quarter === ALL_QUARTERS ? " across all quarters" : ` in ${quarterLabel(quarter)}`}
          </Typography.Paragraph>
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

      <Tabs className="monthly-views performance-views" defaultSelectedKey="department">
        <Tabs.ListContainer>
          <Tabs.List aria-label="Review grouping">
            {GROUPINGS.map(({ key, label }) => <Tabs.Tab key={key} id={key}>{label}<Tabs.Indicator /></Tabs.Tab>)}
          </Tabs.List>
        </Tabs.ListContainer>
        {GROUPINGS.map(({ key, column }) => (
          <Tabs.Panel className="performance-breakdown-panel" id={key} key={key}>
            <ReviewGroups reviews={scoped} field={key} column={column} />
          </Tabs.Panel>
        ))}
      </Tabs>
    </section>
  );
}

function ReviewGroups({ reviews, field, column }) {
  const groups = [...groupBy(reviews, field)].sort(([left], [right]) => left.localeCompare(right));
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
        <CopyAnalysisKeys rows={reviews} dates={[["review_date", "Review date"]]} />
        <ReadinessTable groups={groups} column={column} />
      </section>
    </>
  );
}

function ScoreDistribution({ groups, metric }) {
  const data = groups.map(([group, reviews]) => {
    const counts = [0, 0, 0, 0];
    for (const review of reviews) {
      const score = review[metric.key];
      if (Number.isFinite(score) && score >= 1 && score <= 5) counts[Math.min(Math.floor(score) - 1, 3)]++;
    }
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
  const data = groups.map(([group, reviews]) => {
    const ready = reviews.filter(({ promotion_ready }) => promotion_ready === true).length;
    const notReady = reviews.filter(({ promotion_ready }) => promotion_ready === false).length;
    return { group, total: reviews.length, ready, notReady, unknown: reviews.length - ready - notReady };
  });
  const hasUnknown = data.some(({ unknown }) => unknown > 0);
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
          <Table.Body items={data}>
            {({ group, total, ready, notReady, unknown }) => (
              <Table.Row id={group}>
                <Table.Cell>{group}</Table.Cell>
                <Table.Cell>{total}</Table.Cell>
                <Table.Cell>{countWithShare(ready, total)}</Table.Cell>
                <Table.Cell>{countWithShare(notReady, total)}</Table.Cell>
                {hasUnknown && <Table.Cell>{countWithShare(unknown, total)}</Table.Cell>}
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function EmployeeReviewHistory({ reviews, quarters }) {
  const employees = groupBy(reviews, "employee_id");
  const ids = [...employees.keys()].sort((a, b) => a - b);
  const [employeeId, setEmployeeId] = useState(() => ids.find((id) => employees.get(id).length === quarters.length) ?? ids[0]);
  const history = employees.get(employeeId) ?? [];
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
          <Typography.Paragraph className="search-hint" role="status">
            {history.length} {history.length === 1 ? "review" : "reviews"} for the selected employee
          </Typography.Paragraph>
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

      {latest ? (
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
        <Typography.Paragraph className="search-hint">Select an employee ID to see their reviews.</Typography.Paragraph>
      )}
    </section>
  );
}
