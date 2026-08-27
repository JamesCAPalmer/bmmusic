/**
 * Reading the music department's workbook.
 *
 * **A stub, deliberately, and the shape of the thing is the deliverable.** The
 * real workbook has not been seen by this code; its sheets, its headings and
 * its conventions will change before the real import happens. So what is built
 * here is the pipeline — upload, read, show a person, wait, apply — and a
 * reader that copes with the shape the addendum describes and says plainly
 * when it meets something else.
 *
 * **Nothing is written to `person` by parsing.** An upload lands in
 * `import_batch` / `import_row` and stays there until somebody accepts it. That
 * is not caution for its own sake: the workbook is a working document, with
 * blank cells, two spellings of the same child, and adults mixed in with
 * children, and none of that is the app's to decide.
 *
 * Everything above `saveBatch` is pure, so the reading can be put every
 * awkward sheet without a database.
 *
 * Privacy: this holds children's names for as long as a batch is pending, and
 * a discarded batch is **deleted** rather than kept — an unapplied upload is a
 * copy of personal data with no purpose. The audit line is the record.
 */

import { CHOIRS, isChoir, type PersonRow } from "./people";
import { serialToDate, type Sheet } from "./xlsx";

// ---------------------------------------------------------------------------
// Recognising a sheet
// ---------------------------------------------------------------------------

/**
 * Which choir a sheet is about, from its tab name.
 *
 * The department names tabs after the group — "Girls", "Boys register",
 * "Consort & Girls". A tab this cannot place is read as a person sheet and
 * every row flagged, rather than being guessed at or skipped: a sheet silently
 * ignored is a sheet nobody notices is missing.
 */
export function choirOfSheet(name: string): string | null {
  const text = name.toLowerCase();
  if (/\bjc\b|junior/.test(text)) return "jc";
  for (const choir of CHOIRS) {
    if (choir.value !== "jc" && text.includes(choir.value)) return choir.value;
  }
  if (/\badults?\b|\bteam\b/.test(text)) return "satb";
  return null;
}

/** A header row's headings, lower-cased and trimmed, by column index. */
function headings(row: readonly string[]): string[] {
  return row.map((cell) => cell.trim().toLowerCase());
}

/** The index of the first heading matching any of these words, or -1. */
function columnFor(headers: readonly string[], ...words: string[]): number {
  return headers.findIndex((header) => header && words.some((word) => header.includes(word)));
}

/**
 * The header row of a sheet: the first row that has a name column in it.
 *
 * Workbooks have a title, a blank line and sometimes a note above the headings,
 * so the header is found rather than assumed to be row 1.
 */
export function findHeaderRow(rows: readonly (readonly string[])[]): number {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const headers = headings(rows[i] ?? []);
    if (columnFor(headers, "name", "chorister", "surname") >= 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// What a row parses to
// ---------------------------------------------------------------------------

export interface ProposedPerson {
  displayName: string;
  choir: string;
  schoolYear: number | null;
  joinedOn: string | null;
  surpliceAwardedOn: string | null;
  deansAwardOn: string | null;
  archbishopsAwardOn: string | null;
  goldAwardOn: string | null;
  /** Parents' numbers, kept apart from the person from the very first moment. */
  contacts: Array<{ label: string | null; name: string | null; phone: string }>;
}

export interface ParsedRow {
  sheet: string;
  rowNumber: number;
  kind: "person";
  person: ProposedPerson;
  /** What could not be settled. Null when the row is clean. */
  issue: string | null;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Sheets that were read, and what was made of each. */
  sheets: Array<{ name: string; choir: string | null; rows: number; skipped: string | null }>;
}

/** "Year 6", "Y6", "6", "Reception", "R" → a school year, or null. */
export function schoolYearFrom(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (/^(r|rec|reception)$/.test(text)) return 0;
  const match = /^(?:year\s*|yr\s*|y)?(\d{1,2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 0 && year <= 13 ? year : null;
}

/**
 * A date cell, however the workbook wrote it.
 *
 * Excel gives a serial number; a person typing into the cell gives
 * "12/09/2019" or "2019-09-12". British order for the slashed form, because
 * this is a British workbook — and a value it cannot place comes back null and
 * is flagged rather than being read the American way and quietly wrong.
 */
export function dateFrom(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  if (/^\d+(\.\d+)?$/.test(text)) return serialToDate(Number(text));

  const slashed = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (slashed) {
    const day = Number(slashed[1]);
    const month = Number(slashed[2]);
    let year = Number(slashed[3]);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

/** A telephone number, or null. Kept as written — formatting is the owner's. */
export function phoneFrom(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  // At least seven digits somewhere in it. Anything less is a note, not a
  // number, and putting a note in a telephone field helps nobody at half past
  // eight on a Thursday.
  return (text.match(/\d/g) ?? []).length >= 7 ? text : null;
}

/**
 * Read one workbook into proposed people.
 *
 * Every row keeps the sheet and the row number it came from, so a problem can
 * be pointed at rather than described. Nothing is merged, nothing is deduped
 * against the existing choir here beyond flagging a name that already exists —
 * deciding that two spellings are one child is a person's job.
 */
export function parseWorkbook(sheets: readonly Sheet[], existing: readonly PersonRow[]): ParseResult {
  const knownNames = new Set(existing.map((p) => p.display_name.trim().toLowerCase()));
  const result: ParseResult = { rows: [], sheets: [] };

  for (const sheet of sheets) {
    const choir = choirOfSheet(sheet.name);
    const headerRow = findHeaderRow(sheet.rows);

    if (headerRow < 0) {
      result.sheets.push({
        name: sheet.name,
        choir,
        rows: 0,
        skipped: "No column headed “Name”, so there was nothing to read.",
      });
      continue;
    }

    const headers = headings(sheet.rows[headerRow] ?? []);
    const nameAt = columnFor(headers, "name", "chorister", "surname");
    const yearAt = columnFor(headers, "year", "school");
    const joinedAt = columnFor(headers, "joined", "start");
    const surpliceAt = columnFor(headers, "surplice");
    const deansAt = columnFor(headers, "dean");
    const archbishopsAt = columnFor(headers, "archbishop");
    const goldAt = columnFor(headers, "gold");
    const phoneColumns = headers
      .map((header, i) => ({ header, i }))
      .filter(({ header }) => /phone|mobile|tel|contact/.test(header))
      .map(({ header, i }) => ({ label: header, i }));

    let read = 0;

    for (let i = headerRow + 1; i < sheet.rows.length; i++) {
      const cells = sheet.rows[i] ?? [];
      const displayName = (cells[nameAt] ?? "").trim();
      if (!displayName) continue;

      const at = (index: number) => (index >= 0 ? (cells[index] ?? "").trim() : "");

      const issues: string[] = [];

      let schoolYear: number | null = null;
      const rawYear = at(yearAt);
      if (rawYear) {
        schoolYear = schoolYearFrom(rawYear);
        if (schoolYear === null) issues.push(`school year "${rawYear}" was not understood`);
      }

      const readDate = (index: number, what: string): string | null => {
        const raw = at(index);
        if (!raw) return null;
        const date = dateFrom(raw);
        if (date === null) issues.push(`${what} "${raw}" was not understood as a date`);
        return date;
      };

      const contacts: ProposedPerson["contacts"] = [];
      for (const column of phoneColumns) {
        const phone = phoneFrom(at(column.i));
        if (phone) contacts.push({ label: column.label, name: null, phone });
      }

      if (!choir) issues.push("this sheet does not say which choir it is for");
      if (knownNames.has(displayName.toLowerCase())) {
        issues.push("somebody of this name is already on the choir list");
      }

      result.rows.push({
        sheet: sheet.name,
        rowNumber: i + 1,
        kind: "person",
        person: {
          displayName,
          choir: choir && isChoir(choir) ? choir : "",
          schoolYear,
          joinedOn: readDate(joinedAt, "joined"),
          surpliceAwardedOn: readDate(surpliceAt, "surpliced"),
          deansAwardOn: readDate(deansAt, "Dean's award"),
          archbishopsAwardOn: readDate(archbishopsAt, "Archbishop's award"),
          goldAwardOn: readDate(goldAt, "gold award"),
          contacts,
        },
        issue: issues.length ? issues.join("; ") : null,
      });
      read += 1;
    }

    result.sheets.push({ name: sheet.name, choir, rows: read, skipped: null });
  }

  return result;
}

// ---------------------------------------------------------------------------
// The pending state
// ---------------------------------------------------------------------------

export interface BatchRow {
  id: number;
  filename: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  status: string;
  decided_at: string | null;
  decided_by: string | null;
  note: string | null;
}

export interface StoredRow {
  id: number;
  batch_id: number;
  sheet: string | null;
  row_number: number | null;
  kind: string;
  payload: string;
  issue: string | null;
  applied_at: string | null;
}

export async function saveBatch(
  db: D1Database,
  filename: string,
  by: string,
  parsed: ParseResult
): Promise<number> {
  const batch = await db
    .prepare(`INSERT INTO import_batch (filename, uploaded_by) VALUES (?, ?) RETURNING id`)
    .bind(filename, by)
    .first<{ id: number }>();
  if (!batch) throw new Error("That upload could not be saved.");

  // Batched, because a workbook is hundreds of rows and one statement each
  // would be hundreds of round trips.
  const statements = parsed.rows.map((row) =>
    db
      .prepare(
        `INSERT INTO import_row (batch_id, sheet, row_number, kind, payload, issue)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(batch.id, row.sheet, row.rowNumber, row.kind, JSON.stringify(row.person), row.issue)
  );
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }

  return batch.id;
}

export async function listBatches(db: D1Database, limit = 20): Promise<BatchRow[]> {
  const rows = await db
    .prepare(`SELECT * FROM import_batch ORDER BY uploaded_at DESC, id DESC LIMIT ?`)
    .bind(limit)
    .all<BatchRow>();
  return rows.results ?? [];
}

export async function getBatch(db: D1Database, id: number): Promise<BatchRow | null> {
  return (await db.prepare(`SELECT * FROM import_batch WHERE id = ?`).bind(id).first<BatchRow>()) ?? null;
}

export async function batchRows(db: D1Database, batchId: number): Promise<StoredRow[]> {
  const rows = await db
    .prepare(`SELECT * FROM import_row WHERE batch_id = ? ORDER BY sheet, row_number, id`)
    .bind(batchId)
    .all<StoredRow>();
  return rows.results ?? [];
}

/**
 * A discarded batch is deleted, not marked.
 *
 * Keeping the rows would leave a copy of children's names in the database with
 * no purpose it could be justified by. The audit line saying a batch was
 * discarded, and by whom, is the record that is actually wanted.
 */
export async function discardBatch(db: D1Database, id: number, by: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM import_row WHERE batch_id = ?`).bind(id),
    db
      .prepare(
        `UPDATE import_batch
            SET status = 'discarded', decided_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), decided_by = ?
          WHERE id = ?`
      )
      .bind(by, id),
  ]);
}

export interface ApplyResult {
  added: number;
  contacts: number;
  skipped: number;
}

/**
 * Write the rows somebody accepted, and only those.
 *
 * Row by row rather than in one statement, because each person's contacts hang
 * off the id the insert returns. A row already applied is skipped, so pressing
 * the button twice adds nobody twice — the workbook will be re-uploaded when a
 * better cut of it arrives, and that must be safe.
 *
 * A row with no choir is never written. The sheet did not say which group it
 * was for, and putting somebody in the wrong choir is worse than leaving them
 * out of a list somebody is looking at anyway.
 */
export async function applyBatch(
  db: D1Database,
  batchId: number,
  acceptedIds: readonly number[],
  by: string
): Promise<ApplyResult> {
  const accepted = new Set(acceptedIds);
  const rows = (await batchRows(db, batchId)).filter(
    (row) => accepted.has(row.id) && row.applied_at === null
  );

  const result: ApplyResult = { added: 0, contacts: 0, skipped: 0 };

  for (const row of rows) {
    let person: ProposedPerson;
    try {
      person = JSON.parse(row.payload) as ProposedPerson;
    } catch {
      result.skipped += 1;
      continue;
    }

    if (!person.displayName || !isChoir(person.choir)) {
      result.skipped += 1;
      continue;
    }

    const inserted = await db
      .prepare(
        `INSERT INTO person (display_name, choir, school_year, joined_on,
                             surplice_awarded_on, deans_award_on, archbishops_award_on, gold_award_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .bind(
        person.displayName,
        person.choir,
        person.schoolYear,
        person.joinedOn,
        person.surpliceAwardedOn,
        person.deansAwardOn,
        person.archbishopsAwardOn,
        person.goldAwardOn
      )
      .first<{ id: number }>();
    if (!inserted) {
      result.skipped += 1;
      continue;
    }

    for (const contact of person.contacts ?? []) {
      await db
        .prepare(`INSERT INTO parent_contact (person_id, label, name, phone) VALUES (?, ?, ?, ?)`)
        .bind(inserted.id, contact.label, contact.name, contact.phone)
        .run();
      result.contacts += 1;
    }

    await db
      .prepare(`UPDATE import_row SET applied_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .bind(row.id)
      .run();
    result.added += 1;
  }

  // **Applying finishes the batch, whatever was left unticked.**
  //
  // The alternative — keeping the rest pending — leaves a batch that can never
  // close: a row with no choir cannot be written however many times the button
  // is pressed, so it would sit there holding a child's name indefinitely while
  // looking like work outstanding. Pressing the button is a decision about the
  // whole upload; anything not added was not wanted, and the file can be read
  // again if it was. So the rows go, and the audit line is the record.
  await db.batch([
    db.prepare(`DELETE FROM import_row WHERE batch_id = ?`).bind(batchId),
    db
      .prepare(
        `UPDATE import_batch
            SET status = 'applied', decided_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), decided_by = ?
          WHERE id = ?`
      )
      .bind(by, batchId),
  ]);

  return result;
}
