/** FR-EXP-01 — a small, dependency-free CSV serializer. Columns come from
 * the first row's keys, so callers control shape/order by pre-shaping rows
 * (join in whatever's useful for a human — e.g. judge email, not just
 * judge_user_id) rather than dumping raw table columns. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "";
    }
    let s: string;
    if (value instanceof Date) {
      s = value.toISOString();
    } else if (typeof value === "object") {
      s = JSON.stringify(value);
    } else {
      s = String(value);
    }
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

/** FR-BULK-01's counterpart parser — RFC 4180-ish: quoted fields, "" as an
 * escaped quote, commas/newlines inside quotes. Returns raw string rows
 * (header row split off), not yet validated against any resource's schema —
 * that's the caller's job, one row at a time, so one bad row never stops
 * the rest from being read. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);

  // Drop a trailing blank line (a file ending in a newline parses as one
  // extra all-empty row) so callers don't have to special-case it.
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") {
      rows.pop();
    }
  }
  return rows;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return [];
  }
  const [header, ...dataRows] = rows;
  return dataRows.map((row) =>
    Object.fromEntries(header.map((column, i) => [column.trim(), (row[i] ?? "").trim()])),
  );
}
