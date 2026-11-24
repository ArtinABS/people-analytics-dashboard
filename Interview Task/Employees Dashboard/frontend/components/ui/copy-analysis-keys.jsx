"use client";

import { Button, Dropdown, Label, TextArea } from "@heroui/react";
import { Copy } from "lucide-react";
import { useState } from "react";

export function CopyAnalysisKeys({ rows, dates = [] }) {
  const [message, setMessage] = useState("");
  const [fallback, setFallback] = useState("");
  const unique = (values) => [...new Set(values.filter((value) => value != null && value !== ""))];
  const choices = new Map([["ids", {
    label: "Employee IDs",
    lines: unique(rows.map(({ employee_id }) => employee_id)),
  }]]);
  for (const [field, label, plural] of dates) {
    choices.set(field, { label: plural ?? `${label}s`, lines: unique(rows.map((row) => row[field])) });
    choices.set(`${field}_pairs`, {
      label: `Employee ID + ${label.toLowerCase()}`,
      lines: unique(rows.map((row) => (
        row.employee_id != null && row[field] ? `${row.employee_id}\t${row[field]}` : null
      ))),
    });
  }
  const available = [...choices].filter(([, choice]) => choice.lines.length);
  if (!available.length) return null;

  async function copy(key) {
    const { lines } = choices.get(key);
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setFallback("");
      setMessage(`Copied ${lines.length} ${lines.length === 1 ? "key" : "keys"}.`);
    } catch {
      setFallback(text);
      setMessage("Select and copy the text below.");
    }
  }

  return (
    <div className="copy-analysis-keys">
      <Dropdown>
        <Button variant="outline" size="sm"><Copy size={14} aria-hidden="true" />Copy keys</Button>
        <Dropdown.Popover>
          <Dropdown.Menu aria-label="Keys to copy" onAction={copy}>
            {available.map(([key, { label }]) => (
              <Dropdown.Item id={key} key={key} textValue={label}><Label>{label}</Label></Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <span className="search-hint" role="status">{message}</span>
      {fallback && (
        <TextArea className="copy-analysis-fallback" aria-label="Keys to copy manually" value={fallback} readOnly rows={4}
          onFocus={(event) => event.currentTarget.select()} />
      )}
    </div>
  );
}
