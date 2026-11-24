function readId(value) {
  const id = /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function readPeriod(value) {
  if (!/^(?!0000)\d{4}-\d{2}(-\d{2})?$/.test(value)) return null;
  const day = value.length === 7 ? `${value}-01` : value;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? value : null;
}

export function parseAnalysisKeys(text) {
  const keys = new Map();
  const errors = [];
  let seenValue = false;
  text.split(/\r\n?|\n/).forEach((line, index) => {
    const values = line.split(/[\t,]/).map((value) => value.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
    if (!values.length) return;
    const isHeader = values.every((value) => /^(employee\s*id|(?:[\w ]+ )?date|month)$/i.test(value));
    if (!seenValue && isHeader) return;
    seenValue = true;

    const id = values.map(readId).find((value) => value !== null);
    const date = values.map(readPeriod).find((value) => value !== null);
    if (!(values.length === 1 && (id || date)) && !(values.length === 2 && id && date)) {
      errors.push(index + 1);
      return;
    }
    keys.set(`${id ?? ""}/${date ?? ""}`, { employee_id: id ?? null, date: date ?? null });
  });
  return { keys: [...keys.values()], errors };
}
