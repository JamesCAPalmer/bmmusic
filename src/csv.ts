/**
 * A small RFC 4180 CSV reader.
 *
 * Written rather than depended on: the estate keeps this app to Hono and
 * wrangler, and the one file it has to read is a well-formed export. It handles
 * what that file actually contains — quoted fields with commas inside
 * ("Come, let's rejoice"), doubled quotes, and CRLF line endings.
 */

export class CsvError extends Error {}

/** Parse CSV text into rows of raw cell strings. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  // A byte-order mark on the front of the first header would hide the "ref"
  // column behind an invisible character, and the failure would be baffling.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    // A trailing newline produces one empty field; that is not a row.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      // CRLF: the \n does the work. A bare \r is a line ending too.
      if (src[i + 1] !== "\n") endRow();
    } else {
      field += ch;
    }
  }

  if (inQuotes) throw new CsvError("The file ends inside a quoted value — it looks truncated.");
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

/**
 * Parse CSV text into objects keyed by the header row.
 *
 * Rows with fewer cells than the header get empty strings for the missing tail,
 * which is what a spreadsheet export does when the last columns are blank.
 */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header || header.length === 0) throw new CsvError("The file has no header row.");

  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    header.forEach((name, i) => {
      obj[name] = cells[i] ?? "";
    });
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * One CSV cell, quoted when it has to be.
 *
 * A leading `=`, `+`, `-` or `@` is prefixed with an apostrophe. Excel reads
 * such a cell as a formula, and a name or a note that begins with one is a
 * formula-injection hole in any file somebody else opens. The apostrophe is
 * invisible in the cell and makes it text.
 */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Rows to CSV text, with a byte-order mark.
 *
 * The BOM is there because Excel on Windows reads a UTF-8 CSV as Windows-1252
 * without one, and the first chorister with an accent in their name comes out
 * mangled. CRLF for the same reason: it is what Excel writes and what every
 * other reader copes with.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [header.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
