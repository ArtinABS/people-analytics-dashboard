"use client";

import { useEffect, useState } from "react";
import {
  Alert, Button, Chip, Disclosure, FieldError, Form, Input, Label, ListBox,
  Select, Skeleton, Table, TextField, Typography,
} from "@heroui/react";
import { fetchEmployeeJson } from "../../app/employee-request";
import { DateRangeFilter } from "./date-range-filter";
import { CopyAnalysisKeys } from "./copy-analysis-keys";

const ANY = "__any__";
const FIELDS = [
  { name: "employee_id", label: "Employee ID", inputMode: "numeric", pattern: "[0-9]{1,12}", placeholder: "ID or first few digits" },
  { name: "department", label: "Department", options: true },
  { name: "manager_id", label: "Manager ID", options: true },
  { name: "initial_salary_grade", label: "Initial salary grade", options: true },
  { name: "employment_type", label: "Employment type", options: true },
  { name: "work_location", label: "Work location", options: true },
  { name: "tenure_months", label: "Tenure in months", type: "number", min: 0, step: 1 },
];
const DATE_FILTERS = [
  { name: "hire_date", label: "Hire date" },
  { name: "date_of_birth", label: "Date of birth" },
];

export function EmployeeSearch({
  isOpen, onOpenChange, onSearch, onClear, result, loading, error, onRetry, onSelectEmployee,
}) {
  const [filters, setFilters] = useState({});
  const [options, setOptions] = useState(null);
  const [optionsError, setOptionsError] = useState(null);
  const [optionsAttempt, setOptionsAttempt] = useState(0);

  useEffect(() => {
    if (!isOpen || options) return;
    const controller = new AbortController();
    setOptionsError(null);
    fetchEmployeeJson("/employees/filters", controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setOptions(data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setOptionsError(failure.message);
      });
    return () => controller.abort();
  }, [isOpen, options, optionsAttempt]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  return (
    <Disclosure id="employee-search" className="employee-search" isExpanded={isOpen} onExpandedChange={onOpenChange}>
      <Disclosure.Heading>
        <Disclosure.Trigger className="employee-search-trigger">
          Search employees
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="employee-search-body">
          {optionsError && (
            <Alert status="danger" className="search-alert">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>Could not load search filters. {optionsError}</Alert.Description>
                <Button size="sm" variant="secondary" onPress={() => setOptionsAttempt((n) => n + 1)}>Retry filters</Button>
              </Alert.Content>
            </Alert>
          )}
          <Form
            className="employee-filter-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const searchFilters = { ...filters };
              for (const { name } of DATE_FILTERS) {
                const start = formData.get(`${name}_from`);
                const end = formData.get(`${name}_to`);
                if (start) searchFilters[`${name}_from`] = start;
                if (end) searchFilters[`${name}_to`] = end;
              }
              onSearch(searchFilters);
            }}
            onReset={() => { setFilters({}); onClear(); }}
          >
            {FIELDS.map(({ name, label, options: useOptions, ...inputProps }) => (
              useOptions ? (
                <Select
                  key={name}
                  className="filter"
                  variant="secondary"
                  value={filters[name] || ANY}
                  placeholder="Any"
                  isDisabled={!options}
                  onChange={(value) => updateFilter(name, value === ANY ? "" : value ?? "")}
                >
                  <Label>{label}</Label>
                  <Select.Trigger className="filter-trigger">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover className="filter-popover">
                    <ListBox>
                      <ListBox.Item id={ANY} textValue="Any">Any<ListBox.ItemIndicator /></ListBox.Item>
                      {options?.[name].map((option) => (
                        <ListBox.Item key={option} id={option} textValue={option}>
                          {option}<ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              ) : (
                <TextField
                  key={name}
                  className="filter"
                  name={name}
                  type={inputProps.type}
                  value={filters[name] ?? ""}
                  onChange={(value) => updateFilter(name, value)}
                >
                  <Label>{label}</Label>
                  <Input className="employee-filter-input" variant="secondary" {...inputProps} />
                </TextField>
              )
            ))}
            <div className="col-span-full grid gap-2">
              <div className="grid items-start gap-3.5 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]">
                {DATE_FILTERS.map(({ name, label }) => <DateRangeFilter key={name} name={name} label={`${label} range`} />)}
              </div>
              <Typography.Paragraph className="text-xs text-muted">
                Enter one date for an open-ended range.
              </Typography.Paragraph>
            </div>
            <div className="employee-search-actions">
              <Button type="submit" isDisabled={!options || loading}>Search</Button>
              <Button type="reset" variant="secondary">Clear filters</Button>
            </div>
          </Form>
          {loading ? (
            <div className="loading-lines" role="status" aria-label="Searching employees">
              <Skeleton /><Skeleton /><Skeleton />
            </div>
          ) : error ? (
            <Alert status="danger" className="search-alert">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{error}</Alert.Description>
                <Button size="sm" variant="secondary" onPress={onRetry}>Retry search</Button>
              </Alert.Content>
            </Alert>
          ) : result ? (
            <EmployeeResults result={result} onSelectEmployee={onSelectEmployee} />
          ) : (
            <Typography.Paragraph className="search-hint">
              Add filters, or search with empty fields to see all employees.
            </Typography.Paragraph>
          )}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

function EmployeeResults({ result, onSelectEmployee }) {
  return (
    <section className="employee-results" aria-label="Employee search results">
      <Typography.Paragraph className="search-hint" role="status">
        {result.total === 0
          ? "No employees match these filters."
          : `${result.total.toLocaleString("en-US")} matching ${result.total === 1 ? "record" : "records"}. Select a row to view details.`}
      </Typography.Paragraph>
      {result.total > 0 && <CopyAnalysisKeys rows={result.employees} dates={[["hire_date", "Hire date"]]} />}
      {result.total > 0 && (
        <Table variant="secondary" className="employee-table">
          <Table.ScrollContainer className="table-scroll" role="region" aria-label="Scrollable employee results" tabIndex={0}>
            <Table.Content aria-label="Matching employees" onRowAction={onSelectEmployee}>
              <Table.Header>
                <Table.Column isRowHeader>Employee ID</Table.Column>
                <Table.Column>Department</Table.Column>
                <Table.Column>Employment type</Table.Column>
                <Table.Column>Work location</Table.Column>
                <Table.Column>Initial salary grade</Table.Column>
                <Table.Column>Hire date</Table.Column>
              </Table.Header>
              <Table.Body items={result.employees}>
                {(employee) => (
                  <Table.Row id={employee.employee_id}>
                    <Table.Cell>{employee.employee_id}</Table.Cell>
                    <Table.Cell>{employee.department}</Table.Cell>
                    <Table.Cell>{employee.employment_type}</Table.Cell>
                    <Table.Cell>
                      <Chip className="location" data-location={employee.work_location} size="sm" variant="soft">
                        {employee.work_location}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>{employee.initial_salary_grade}</Table.Cell>
                    <Table.Cell><time dateTime={employee.hire_date}>{employee.hire_date}</time></Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}
    </section>
  );
}
