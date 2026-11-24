"use client";

import { Alert, Button, Label, ListBox, Select, Skeleton, Table, TextArea, Typography } from "@heroui/react";
import { ArrowRight, Database, GitMerge } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseAnalysisKeys } from "../../app/analysis-keys";
import { fetchEmployeeJson } from "../../app/employee-request";
import { CopyAnalysisKeys } from "./copy-analysis-keys";

const NONE = "__none__";
const PAGE_SIZE = 25;
const PLACEHOLDER = "1003\n2025-12\n1003\t2025-12-15";

export function AdvancedAnalysis() {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchEmployeeJson("/advanced-analysis/sources", controller.signal)
      .then(({ sources }) => {
        if (!controller.signal.aborted) setResult({ sources });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ error: error.message });
      });
    return () => controller.abort();
  }, [attempt]);

  if (result === null) {
    return (
      <div className="loading-lines monthly-loading" role="status" aria-label="Loading analysis worksheets">
        <Skeleton /><Skeleton /><Skeleton />
      </div>
    );
  }
  if (result.error) {
    return (
      <Alert status="danger" className="search-alert">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>Could not load analysis worksheets. {result.error}</Alert.Description>
          <Button size="sm" variant="secondary" onPress={() => {
            setResult(null);
            setAttempt((value) => value + 1);
          }}>Retry</Button>
        </Alert.Content>
      </Alert>
    );
  }
  return <AnalysisBuilder sources={result.sources} />;
}

function AnalysisBuilder({ sources }) {
  const [slots, setSlots] = useState([null, null, null]);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(null);
  const { keys, errors } = useMemo(() => parseAnalysisKeys(text), [text]);
  const selections = slots.filter(Boolean);
  const hasLayout = selections.length > 0 && selections.every(({ columns }) => columns.length);
  const selectedIds = new Set(selections.map(({ id }) => id));
  const sourceMap = new Map(sources.map((source) => [source.id, source]));

  useEffect(() => () => request.current?.abort(), []);

  function resetPreview() {
    request.current?.abort();
    setBusy(false);
    setPreview(null);
    setError("");
  }

  function changeSlot(index, selection) {
    resetPreview();
    setSlots((previous) => previous.map((slot, position) => position === index ? selection : slot));
  }

  function selectWorksheet(index, id) {
    const source = sourceMap.get(id);
    changeSlot(index, source
      ? { id, columns: source.default_columns, date_column: source.date_columns[0] }
      : null);
  }

  async function showMatches() {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const result = await fetchEmployeeJson("/advanced-analysis", controller.signal, { sources: selections, keys });
      if (!controller.signal.aborted) setPreview(result.rows);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="analysis-workspace">
      <section className="analysis-join" aria-labelledby="analysis-join-heading">
        <Typography.Heading level={2} id="analysis-join-heading">Join builder</Typography.Heading>
        <div className="analysis-flow">
          <div className="analysis-source-slots">
            {slots.map((slot, index) => (
              <Select key={index} className="filter analysis-source-pick" variant="secondary" value={slot?.id ?? NONE}
                onChange={(id) => selectWorksheet(index, id)}>
                <Label>Worksheet {index + 1}</Label>
                <Select.Trigger className="filter-trigger"><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover className="filter-popover">
                  <ListBox>
                    <ListBox.Item id={NONE} textValue="Choose worksheet">Choose worksheet<ListBox.ItemIndicator /></ListBox.Item>
                    {sources.filter(({ id }) => id === slot?.id || !selectedIds.has(id)).map(({ id, label }) => (
                      <ListBox.Item id={id} key={id} textValue={label}>{label}<ListBox.ItemIndicator /></ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            ))}
          </div>
          <svg className="analysis-connectors" aria-hidden="true" viewBox="0 0 72 192" preserveAspectRatio="none">
            {slots.map((slot, index) => (
              <path key={index} data-linked={Boolean(slot)}
                d={`M0 ${32 + 64 * index} C40 ${32 + 64 * index}, 35 96, 72 96`} />
            ))}
          </svg>
          <div className="analysis-node analysis-node-join">
            <GitMerge size={18} aria-hidden="true" />
            <div><strong>Match records</strong><span>Employee ID, date, or both</span></div>
          </div>
          <ArrowRight className="analysis-flow-arrow" size={20} aria-hidden="true" />
          <div className="analysis-node">
            <Database size={18} aria-hidden="true" /><strong>Analysis dataset</strong>
          </div>
        </div>
      </section>

      <div className="analysis-inputs">
        <div className="analysis-paste">
          <label htmlFor="analysis-keys">Paste keys</label>
          <TextArea id="analysis-keys" value={text} variant="secondary" rows={5} placeholder={PLACEHOLDER}
            aria-describedby="analysis-key-hint" aria-invalid={errors.length > 0}
            onChange={(event) => {
              resetPreview();
              setText(event.target.value);
            }} />
          <p className="search-hint" id="analysis-key-hint">
            Paste one ID, date, or ID and date pair per line. Use YYYY-MM-DD or YYYY-MM. Separate pairs with a tab or comma.
          </p>
          {errors.length > 0 ? (
            <p className="analysis-input-error" role="status">
              Check {errors.length === 1 ? "line" : "lines"} {errors.slice(0, 8).join(", ")}{errors.length > 8 ? ", …" : ""}.
            </p>
          ) : keys.length > 0 && <p className="search-hint" role="status">{keys.length} unique {keys.length === 1 ? "key" : "keys"}</p>}
        </div>
        <section className="analysis-column-selects" aria-labelledby="analysis-fields-heading">
          <Typography.Heading level={2} id="analysis-fields-heading">Worksheet columns</Typography.Heading>
          {!selections.length && <p className="search-hint">Choose a worksheet to select its columns.</p>}
          {slots.map((selection, index) => selection && (
            <WorksheetFields key={selection.id} selection={selection} source={sourceMap.get(selection.id)}
              onChange={(next) => changeSlot(index, next)} />
          ))}
        </section>
      </div>

      <div className="analysis-actions">
        <Button variant="primary" isDisabled={!hasLayout || !keys.length || errors.length > 0 || busy} onPress={showMatches}>
          {busy ? "Finding matches…" : "Show matching rows"}
        </Button>
        <p className="search-hint">Month inputs match the whole month. A day matches its month in Monthly Employee Data.</p>
      </div>

      {error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content><Alert.Description>Could not find matching rows. {error}</Alert.Description></Alert.Content>
        </Alert>
      )}
      {preview && <AnalysisPreview rows={preview} sources={selections.map((selection) => ({
        ...sourceMap.get(selection.id),
        fields: selection.columns.map((id) => sourceMap.get(selection.id).columns.find((column) => column.id === id)),
      }))} />}
    </div>
  );
}

function WorksheetFields({ source, selection, onChange }) {
  return (
    <div className="analysis-worksheet-fields">
      <strong>{source.label}</strong>
      <div className="analysis-field-pickers">
        <Select className="filter" variant="secondary" selectionMode="multiple" value={selection.columns}
          onChange={(columns) => onChange({ ...selection, columns: columns ?? [] })}>
          <Label>Columns</Label>
          <Select.Trigger className="filter-trigger">
            <Select.Value>{selection.columns.length
              ? `${selection.columns.length} ${selection.columns.length === 1 ? "column" : "columns"} selected`
              : "Select at least one column"}
            </Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="filter-popover">
            <ListBox selectionMode="multiple">
              {source.columns.map(({ id, label }) => (
                <ListBox.Item id={id} key={id} textValue={label}>{label}<ListBox.ItemIndicator /></ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {source.date_columns.length > 1 && (
          <Select className="filter" variant="secondary" value={selection.date_column} onChange={(date_column) => {
            if (date_column) onChange({ ...selection, date_column });
          }}>
            <Label>Match dates on</Label>
            <Select.Trigger className="filter-trigger"><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover className="filter-popover">
              <ListBox>
                {source.columns.filter(({ id }) => source.date_columns.includes(id)).map(({ id, label }) => (
                  <ListBox.Item id={id} key={id} textValue={label}>{label}<ListBox.ItemIndicator /></ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        )}
      </div>
    </div>
  );
}

function displayValue(value) {
  if (value == null) return "—";
  return typeof value === "boolean" ? value ? "Yes" : "No" : String(value);
}

function AnalysisPreview({ rows, sources }) {
  const [page, setPage] = useState(0);
  const pageStart = page * PAGE_SIZE;
  const matchCount = rows.filter(({ matches }) => Object.keys(matches).length).length;
  const showDate = rows.some(({ date }) => date);
  const tableRows = rows.slice(pageStart, pageStart + PAGE_SIZE).map((row, index) => ({ ...row, id: pageStart + index }));
  const copyRows = rows.flatMap(({ employee_id, date, matches }) => {
    const records = Object.values(matches).flat();
    return records.length ? (date
      ? [{ employee_id, date }]
      : records.map((record) => ({ employee_id, date: record.date }))) : [];
  });

  return (
    <section className="analysis-results" aria-labelledby="analysis-results-heading">
      <div className="survey-section-header">
        <div className="survey-section-heading">
          <Typography.Heading level={2} id="analysis-results-heading">Matched records</Typography.Heading>
          <p className="search-hint" role="status">
            {matchCount} of {rows.length} {rows.length === 1 ? "row" : "rows"} with matches
          </p>
        </div>
        <CopyAnalysisKeys rows={copyRows} dates={[["date", "Date"]]} />
      </div>
      <p className="search-hint">Each worksheet lists its matches in date order. A dash marks a missing value or match.</p>
      <Table className="employee-table analysis-table" variant="secondary">
        <Table.ScrollContainer className="table-scroll" role="region" aria-label="Scrollable matched records" tabIndex={0}>
          <Table.Content aria-label="Analysis matches">
            <Table.Header>
              <Table.Column id="employee_id" isRowHeader>Employee ID</Table.Column>
              {showDate && <Table.Column id="input_date">Input date</Table.Column>}
              {sources.flatMap(({ id, label, fields }) => fields.map((field) => (
                <Table.Column key={`${id}/${field.id}`} id={`${id}/${field.id}`}>
                  <span className="analysis-column-source">{label}</span>{field.label}
                </Table.Column>
              )))}
            </Table.Header>
            <Table.Body items={tableRows}>
              {(row) => (
                <Table.Row id={row.id}>
                  <Table.Cell>{displayValue(row.employee_id)}</Table.Cell>
                  {showDate && <Table.Cell>{displayValue(row.date)}</Table.Cell>}
                  {sources.flatMap(({ id, fields }) => fields.map((field) => (
                    <Table.Cell key={`${id}/${field.id}`}>
                      {row.matches[id]?.length ? (
                        <ul className="analysis-cell-values">
                          {row.matches[id].map((match, index) => (
                            <li key={index} title={match.date ?? undefined}>{displayValue(match.values[field.id])}</li>
                          ))}
                        </ul>
                      ) : "—"}
                    </Table.Cell>
                  )))}
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      {rows.length > PAGE_SIZE && (
        <div className="analysis-pagination">
          <span className="search-hint">{pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, rows.length)} of {rows.length} rows</span>
          <Button size="sm" variant="outline" isDisabled={page === 0} onPress={() => setPage((value) => value - 1)}>Previous</Button>
          <Button size="sm" variant="outline" isDisabled={pageStart + PAGE_SIZE >= rows.length} onPress={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      )}
    </section>
  );
}
