"use client";

import { Alert, Button, ComboBox, Input, Label, ListBox, Select, Skeleton, Tabs, Typography } from "@heroui/react";
import { useEffect, useState } from "react";
import { fetchEmployeeJson } from "../../app/employee-request";
import { useWorksheetQuery, worksheetPath } from "../../app/worksheet-query";
import { formatMonth, formatPromotionMonth } from "../../app/period-labels";
import { MonthlyGauge, MonthlyTrend, SCORE_METRICS } from "./monthly-score-figures";
import { CopyAnalysisKeys } from "./copy-analysis-keys";

const MONTHLY_URL = "/monthly-employees";
const SNAPSHOT_FIELDS = [
  ["department", "Department"],
  ["manager_id", "Manager ID"],
  ["employment_status", "Employment status"],
  ["tenure_months", "Tenure in months"],
  ["salary_grade", "Salary grade"],
];

export function MonthlyEmployeeData() {
  const [options, setOptions] = useState(null);
  const [optionsError, setOptionsError] = useState(null);
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [employeeId, setEmployeeId] = useState(null);
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [detailMonth, setDetailMonth] = useState(null);
  const history = useWorksheetQuery(employeeId === null ? null : worksheetPath(
    `${MONTHLY_URL}/${employeeId}/selection`, { month: selectedMonths },
  ));

  useEffect(() => {
    const controller = new AbortController();
    fetchEmployeeJson(`${MONTHLY_URL}/options`, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setOptions(data);
        setEmployeeId(data.default_employee_id);
        setSelectedMonths(data.months.slice(-1));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setOptionsError(error.message);
      });
    return () => controller.abort();
  }, [optionsAttempt]);

  return (
    <Tabs className="monthly-views">
      <Tabs.ListContainer>
        <Tabs.List aria-label="Monthly employee data views">
          <Tabs.Tab id="employee">Employee-first<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="months">Months-first<Tabs.Indicator /></Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="employee" className="monthly-view-panel">
        {optionsError ? (
          <MonthlyError
            message={optionsError}
            onRetry={() => {
              setOptionsError(null);
              setOptionsAttempt((value) => value + 1);
            }}
          />
        ) : options === null ? (
          <MonthlyLoading label="Loading employees and months" />
        ) : options.months.length === 0 ? (
          <Typography.Paragraph className="monthly-status">The workbook has no monthly employee records.</Typography.Paragraph>
        ) : (
          <>
            <div className="monthly-filters">
              <ComboBox
                className="filter"
                variant="secondary"
                selectedKey={employeeId}
                onSelectionChange={(id) => {
                  if (id !== employeeId) {
                    setDetailMonth(null);
                  }
                  setEmployeeId(id);
                }}
              >
                <Label>Employee ID</Label>
                <ComboBox.InputGroup className="monthly-combobox">
                  <Input placeholder="Find an employee ID" />
                  <ComboBox.Trigger />
                </ComboBox.InputGroup>
                <ComboBox.Popover className="filter-popover">
                  <ListBox renderEmptyState={() => "No matching employee IDs."}>
                    {options.employee_ids.map((id) => (
                      <ListBox.Item id={id} key={id} textValue={String(id)}>{id}<ListBox.ItemIndicator /></ListBox.Item>
                    ))}
                  </ListBox>
                </ComboBox.Popover>
              </ComboBox>

              <Select
                className="filter"
                variant="secondary"
                selectionMode="multiple"
                value={selectedMonths}
                onChange={(months) => {
                  const nextMonths = months ?? [];
                  setSelectedMonths(nextMonths);
                  setDetailMonth((current) => nextMonths.includes(current) ? current : null);
                }}
              >
                <Label>Months</Label>
                <Select.Trigger className="filter-trigger">
                  <Select.Value>
                    {selectedMonths.length > 1
                      ? `${selectedMonths.length} months selected`
                      : selectedMonths.length === 1 ? formatMonth(selectedMonths[0]) : "Select months"}
                  </Select.Value>
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover className="filter-popover">
                  <ListBox selectionMode="multiple">
                    {options.months.map((month) => (
                      <ListBox.Item id={month} key={month} textValue={formatMonth(month)}>
                        {formatMonth(month)}<ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            {employeeId === null ? (
              <Typography.Paragraph className="monthly-status">Select an employee ID.</Typography.Paragraph>
            ) : history.loading ? (
              <MonthlyLoading label="Loading monthly records" />
            ) : history.error ? (
              <MonthlyError
                message={history.error}
                onRetry={history.retry}
              />
            ) : (
              <>
                <EmployeeSummary record={history.data.latest} />
                {selectedMonths.length === 0 ? (
                  <Typography.Paragraph className="monthly-status">Select at least one month.</Typography.Paragraph>
                ) : (
                  <EmployeeMonths
                    employeeId={employeeId}
                    months={selectedMonths}
                    records={history.data.records}
                    detailMonth={detailMonth}
                    onSelectMonth={setDetailMonth}
                  />
                )}
              </>
            )}
          </>
        )}
      </Tabs.Panel>
      <Tabs.Panel id="months" className="monthly-view-panel">
        <Typography.Paragraph className="monthly-status">The Months-first view is a placeholder.</Typography.Paragraph>
      </Tabs.Panel>
    </Tabs>
  );
}

function MonthlyLoading({ label }) {
  return (
    <div className="loading-lines monthly-loading" role="status" aria-label={label}>
      <Skeleton /><Skeleton /><Skeleton />
    </div>
  );
}

function MonthlyError({ message, onRetry }) {
  return (
    <Alert status="danger" className="search-alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>Could not load monthly employee data. {message}</Alert.Description>
        <Button size="sm" variant="secondary" onPress={onRetry}>Retry</Button>
      </Alert.Content>
    </Alert>
  );
}

function EmployeeSummary({ record }) {
  if (!record) return null;

  const { month, department, manager_id, tenure_months, months_since_last_promotion } = record;
  const latestPromotion = formatPromotionMonth(month, months_since_last_promotion);
  const fields = [
    ["Department", department],
    ["Manager ID", manager_id],
    ["Tenure in months", tenure_months],
    ["Latest promotion date", latestPromotion],
  ];

  return (
    <section className="monthly-employee-summary" aria-labelledby="monthly-summary-heading">
      <div className="monthly-record-heading">
        <Typography.Heading level={2} id="monthly-summary-heading">Employee summary</Typography.Heading>
        <Typography.Paragraph>As of {formatMonth(month)}</Typography.Paragraph>
      </div>
      <dl className="monthly-snapshot">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EmployeeMonths({ employeeId, months, records, detailMonth, onSelectMonth }) {
  const recordsByMonth = new Map(records.map((record) => [record.month, record]));
  const periods = [...months].sort().map((month) => ({ month, record: recordsByMonth.get(month) }));
  const { month, record } = periods.find((period) => period.month === detailMonth)
    ?? periods.findLast((period) => period.record) ?? periods.at(-1);
  const showTrends = periods.length > 1 && periods.some((period) => period.record);

  return (
    <div className="monthly-results">
      <CopyAnalysisKeys rows={periods.flatMap(({ record }) => record ? [record] : [])} dates={[["month", "Month"]]} />
      {showTrends && (
        <section className="monthly-trends" aria-labelledby="monthly-trends-heading">
          <div className="monthly-trends-heading">
            <Typography.Heading level={2} id="monthly-trends-heading">Score trends</Typography.Heading>
            <Typography.Paragraph className="monthly-status">Select a point to view that month’s details.</Typography.Paragraph>
          </div>
          <div className="monthly-chart-grid">
            {SCORE_METRICS.map((metric) => (
              <MonthlyTrend key={metric.key} metric={metric} periods={periods} detailMonth={month} onSelectMonth={onSelectMonth} />
            ))}
          </div>
        </section>
      )}
      <section className="monthly-record" aria-labelledby="monthly-detail-heading">
        <div className="monthly-record-heading">
          <Typography.Heading level={2} id="monthly-detail-heading" aria-live="polite">
            {formatMonth(month)}
          </Typography.Heading>
          <Typography.Paragraph>Employee {employeeId}</Typography.Paragraph>
        </div>
        {record ? (
          <>
            <div className="monthly-gauges">
              {SCORE_METRICS.map((metric) => (
                <MonthlyGauge key={metric.key} metric={metric} value={record[metric.key]} />
              ))}
            </div>
            <dl className="monthly-snapshot">
              {SNAPSHOT_FIELDS.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{record[key]}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <Typography.Paragraph className="monthly-status">
            {periods.length === 1
              ? "No monthly record for this employee."
              : "No monthly records for this employee in the selected months."}
          </Typography.Paragraph>
        )}
      </section>
    </div>
  );
}
