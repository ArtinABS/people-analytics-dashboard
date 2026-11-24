"use client";

import { Alert, Button, Label, ListBox, Select, Skeleton, Table, ToggleButton, Typography } from "@heroui/react";
import { parseDate } from "@internationalized/date";
import { useEffect, useId, useState } from "react";
import { fetchEmployeeJson } from "../../app/employee-request";
import { Charts } from "./charts";
import { CopyAnalysisKeys } from "./copy-analysis-keys";
import { DateRangeFilter } from "./date-range-filter";
import { DonutChart } from "./donut-chart";

const ATTRITION_URL = "/attrition-events";
const CATEGORY_COLORS = [
  "var(--accent)", "var(--indigo)", "var(--attrition-teal)", "var(--attrition-orange)",
  "var(--attrition-plum)", "var(--attrition-blue)", "var(--attrition-olive)",
  "var(--attrition-rust)", "var(--muted)",
];
const FLAG_OPTIONS = [["any", "Any"], ["yes", "Yes"], ["no", "No"]];
const percentFormat = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

function countBy(events, field) {
  const counts = new Map();
  for (const event of events) {
    const label = event[field];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

function toggleCategory(selection, label) {
  const next = new Set(selection);
  if (!next.delete(label)) next.add(label);
  return next;
}

function share(count, total) {
  return total > 0 ? count / total : 0;
}

function useAttritionRequest(request) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (request === null) return;
    const controller = new AbortController();
    fetchEmployeeJson(request.path, controller.signal)
      .then((events) => {
        if (!controller.signal.aborted) setResult({ request, events });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ request, error: error.message });
      });
    return () => controller.abort();
  }, [request]);

  return result?.request === request ? result : null;
}

function AttritionFeedback({ result, onRetry, loadingLabel }) {
  if (result === null) {
    return (
      <div className="loading-lines monthly-loading" role="status" aria-label={loadingLabel}>
        <Skeleton /><Skeleton /><Skeleton />
      </div>
    );
  }

  return (
    <Alert status="danger" className="search-alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>Could not load attrition events. {result.error}</Alert.Description>
        <Button size="sm" variant="secondary" onPress={onRetry}>Retry</Button>
      </Alert.Content>
    </Alert>
  );
}

export function AttritionEvents() {
  const [request, setRequest] = useState({ path: ATTRITION_URL });
  const result = useAttritionRequest(request);

  if (!result?.events) {
    return (
      <AttritionFeedback
        result={result}
        loadingLabel="Loading attrition events"
        onRetry={() => setRequest({ path: ATTRITION_URL })}
      />
    );
  }
  if (!result.events.length) {
    return <Typography.Paragraph className="search-hint">The workbook has no attrition events.</Typography.Paragraph>;
  }
  return <AttritionOverview events={result.events} />;
}

function attritionPath(range) {
  if (!range) return ATTRITION_URL;
  const params = new URLSearchParams({
    exit_date_from: range.start.toString(),
    exit_date_to: range.end.toString(),
  });
  return `${ATTRITION_URL}?${params}`;
}

function AttritionOverview({ events }) {
  const firstDate = events.at(-1).exit_date;
  const lastDate = events[0].exit_date;
  const [range, setRange] = useState(() => ({ start: parseDate(firstDate), end: parseDate(lastDate) }));
  const [rangeRequest, setRangeRequest] = useState(null);
  const [reasons, setReasons] = useState(() => new Set());
  const [types, setTypes] = useState(() => new Set());
  const [rehire, setRehire] = useState("any");
  const [interview, setInterview] = useState("any");

  const rangeResult = useAttritionRequest(rangeRequest);
  const result = rangeRequest === null ? { events } : rangeResult;
  const dateEvents = result?.events ?? [];
  const reasonCounts = countBy(dateEvents, "exit_reason");
  const typeCounts = countBy(dateEvents, "exit_type");
  const rehireCounts = countBy(dateEvents, "eligible_for_rehire");
  const interviewCounts = countBy(dateEvents, "exit_interview_completed");
  const originalReasons = [...countBy(events, "exit_reason")]
    .sort(([labelA, countA], [labelB, countB]) => countB - countA || labelA.localeCompare(labelB))
    .map(([label]) => label);
  const reasonLabels = new Set([...originalReasons, ...reasonCounts.keys()]);
  const reasonSegments = [...reasonLabels].map((label, index) => ({
    label,
    value: reasonCounts.get(label) ?? 0,
    color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
  }));
  const typeLabels = new Set(["Voluntary", "Involuntary", ...events.map(({ exit_type }) => exit_type), ...typeCounts.keys()]);
  const matchingEvents = dateEvents.filter((event) =>
    (!reasons.size || reasons.has(event.exit_reason))
    && (!types.size || types.has(event.exit_type))
    && (rehire === "any" || event.eligible_for_rehire === (rehire === "yes"))
    && (interview === "any" || event.exit_interview_completed === (interview === "yes"))
  );

  function changeRange(value) {
    const path = attritionPath(value);
    setRange(value);
    setRangeRequest((current) => {
      if (path === (current?.path ?? attritionPath(range))) return current;
      return { path };
    });
  }

  return (
    <div className="attrition-overview">
      <div className="attrition-date-controls">
        <DateRangeFilter name="exit_date" label="Exit date range" value={range} onChange={changeRange} />
        <Button
          className="attrition-reset"
          variant="outline"
          size="sm"
          isDisabled={range?.start.toString() === firstDate && range?.end.toString() === lastDate}
          onPress={() => changeRange({ start: parseDate(firstDate), end: parseDate(lastDate) })}
        >
          Reset dates
        </Button>
      </div>

      {!result?.events ? (
        <div className="attrition-range-feedback">
          <AttritionFeedback
            result={result}
            loadingLabel="Loading exits for the selected dates"
            onRetry={() => setRangeRequest({ path: rangeRequest.path })}
          />
        </div>
      ) : (
        <>
          <div className="attrition-charts" aria-describedby="attrition-selection-hint">
            <ExitReasons
              data={reasonSegments}
              total={dateEvents.length}
              selected={reasons}
              onToggle={(label) => setReasons((current) => toggleCategory(current, label))}
            />
            <div className="attrition-comparisons">
              <ExitComparison
                label="Exit types"
                total={dateEvents.length}
                options={[...typeLabels].map((label) => ({
                  label,
                  count: typeCounts.get(label) ?? 0,
                  selected: types.has(label),
                  onToggle: () => setTypes((current) => toggleCategory(current, label)),
                }))}
              />
              <ExitFlagComparison
                label="Eligible for rehire"
                counts={rehireCounts}
                total={dateEvents.length}
                value={rehire}
                onChange={setRehire}
              />
              <ExitFlagComparison
                label="Exit interview completed"
                counts={interviewCounts}
                total={dateEvents.length}
                value={interview}
                onChange={setInterview}
              />
            </div>
          </div>
          <Typography.Paragraph className="search-hint" id="attrition-selection-hint">
            Select chart categories to filter the table.
          </Typography.Paragraph>

          <section className="attrition-results" aria-labelledby="attrition-results-heading">
            <div className="attrition-results-heading">
              <Typography.Heading level={2} id="attrition-results-heading">Exit records</Typography.Heading>
              <Typography.Paragraph className="search-hint" role="status">
                {matchingEvents.length} of {dateEvents.length} exits
              </Typography.Paragraph>
            </div>
            <div className="attrition-table-filters">
              <ExitFlagFilter label="Eligible for rehire" value={rehire} onChange={setRehire} />
              <ExitFlagFilter label="Exit interview completed" value={interview} onChange={setInterview} />
              <Button
                className="attrition-reset"
                variant="outline"
                size="sm"
                isDisabled={!reasons.size && !types.size && rehire === "any" && interview === "any"}
                onPress={() => {
                  setReasons(new Set());
                  setTypes(new Set());
                  setRehire("any");
                  setInterview("any");
                }}
              >
                Clear table filters
              </Button>
            </div>
            {matchingEvents.length ? (
              <>
                <CopyAnalysisKeys rows={matchingEvents} dates={[["exit_date", "Exit date"]]} />
                <ExitTable events={matchingEvents} />
              </>
            ) : (
              <Typography.Paragraph className="search-hint">
                {dateEvents.length ? "No exit records match these filters." : "No exits in this date range."}
              </Typography.Paragraph>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ExitFlagComparison({ label, counts, total, value, onChange }) {
  return (
    <ExitComparison
      label={label}
      total={total}
      options={FLAG_OPTIONS.slice(1).map(([key, label]) => ({
        label,
        count: counts.get(key === "yes") ?? 0,
        selected: value === key,
        onToggle: (selected) => onChange(selected ? key : "any"),
      }))}
    />
  );
}

function ExitComparison({ label, total, options }) {
  const headingId = useId();

  return (
    <section className="attrition-comparison" aria-labelledby={headingId}>
      <Typography.Heading level={2} id={headingId}>{label}</Typography.Heading>
      <ul className="attrition-bars">
        {options.map(({ label, count, selected, onToggle }) => {
          const proportion = share(count, total);
          return (
            <li key={label}>
              <ToggleButton variant="ghost" className="attrition-bar" isSelected={selected} onChange={onToggle}>
                <span className="attrition-bar-label">
                  <span>{label}</span>
                  <span className="attrition-bar-value">
                    <strong>{count}</strong> <span className="attrition-share">({percentFormat.format(proportion)})</span>
                  </span>
                </span>
              </ToggleButton>
              <div className="attrition-bar-track" aria-hidden="true">
                <Charts
                  className="attrition-bar-chart"
                  type="bar"
                  title={label}
                  data={[{ label, proportion }]}
                  xKey="label"
                  domain={[0, 1]}
                  series={[{ key: "proportion", label, color: "var(--category-color)" }]}
                  decorative
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ExitReasons({ data, total, selected, onToggle }) {
  const [hovered, setHovered] = useState(null);
  const active = data.find(({ label }) => label === hovered);

  return (
    <section className="attrition-reasons" aria-labelledby="exit-reasons-heading">
      <Typography.Heading level={2} id="exit-reasons-heading">Exit reasons</Typography.Heading>
      <div className="attrition-reason-chart">
        <DonutChart
          data={data}
          selected={selected}
          hovered={hovered}
          onSegmentHover={setHovered}
          onSegmentPress={onToggle}
          centerContent={(
            <>
              <strong>{active?.value ?? total}</strong>
              <span>{active?.label ?? "Total exits"}</span>
              {active && <span>{percentFormat.format(share(active.value, total))}</span>}
            </>
          )}
        />
        <ul className="attrition-legend">
          {data.map(({ label, value, color }) => (
            <li key={label}>
              <ToggleButton
                variant="ghost"
                className="attrition-reason"
                data-highlighted={hovered === label}
                isSelected={selected.has(label)}
                onChange={() => onToggle(label)}
                onHoverChange={(isHovered) => setHovered(isHovered ? label : null)}
                onFocus={() => setHovered(label)}
                onBlur={() => setHovered(null)}
              >
                <span className="attrition-swatch" style={{ backgroundColor: color }} aria-hidden="true" />
                <span>{label}</span>
                <span className="attrition-count">{value}</span>
                <span className="attrition-share">{percentFormat.format(share(value, total))}</span>
              </ToggleButton>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ExitFlagFilter({ label, value, onChange }) {
  return (
    <Select className="filter" variant="secondary" value={value} onChange={(next) => onChange(next ?? "any")}>
      <Label>{label}</Label>
      <Select.Trigger className="filter-trigger">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="filter-popover">
        <ListBox>
          {FLAG_OPTIONS.map(([id, text]) => (
            <ListBox.Item id={id} key={id} textValue={text}>{text}<ListBox.ItemIndicator /></ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function ExitTable({ events }) {
  return (
    <Table className="employee-table attrition-table" variant="secondary">
      <Table.ScrollContainer className="table-scroll" role="region" aria-label="Scrollable exit records" tabIndex={0}>
        <Table.Content aria-label="Matching exit records">
          <Table.Header>
            <Table.Column isRowHeader>Employee ID</Table.Column>
            <Table.Column>Exit date</Table.Column>
            <Table.Column>Exit type</Table.Column>
            <Table.Column>Exit reason</Table.Column>
            <Table.Column>Eligible for rehire</Table.Column>
            <Table.Column>Exit interview completed</Table.Column>
            <Table.Column>Exit ID</Table.Column>
          </Table.Header>
          <Table.Body items={events}>
            {(event) => (
              <Table.Row id={event.exit_id}>
                <Table.Cell>{event.employee_id}</Table.Cell>
                <Table.Cell><time dateTime={event.exit_date}>{event.exit_date}</time></Table.Cell>
                <Table.Cell>{event.exit_type}</Table.Cell>
                <Table.Cell>{event.exit_reason}</Table.Cell>
                <Table.Cell>{event.eligible_for_rehire ? "Yes" : "No"}</Table.Cell>
                <Table.Cell>{event.exit_interview_completed ? "Yes" : "No"}</Table.Cell>
                <Table.Cell>{event.exit_id}</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
