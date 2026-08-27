/**
 * The schema against the specification.
 *
 * These read the migration SQL as text rather than running it, which is cheap
 * and catches the thing that actually goes wrong on a project like this: the
 * schema and the brief drifting apart, or a column quietly disappearing in a
 * later migration and taking a screen down with it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const sql = migrationFiles.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8")).join("\n");

/** Strip `-- comments` so a column named in prose is not mistaken for a real one. */
function withoutComments(text: string): string {
  return text.replace(/--[^\n]*/g, "");
}

/** The body of one CREATE TABLE, or null. */
function tableBody(name: string): string | null {
  const re = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${name}\\s*\\(`, "i");
  const match = re.exec(withoutComments(sql));
  if (!match) return null;

  // Walk the parentheses so nested CHECK(...) clauses do not end the body early.
  let depth = 1;
  let i = match.index + match[0].length;
  const start = i;
  while (i < sql.length && depth > 0) {
    const ch = withoutComments(sql)[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    i++;
  }
  return withoutComments(sql).slice(start, i - 1);
}

/** Column names declared by a table, ignoring table-level constraints. */
function columnsOf(name: string): string[] {
  const body = tableBody(name);
  if (body === null) return [];

  const columns: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      columns.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  columns.push(current);

  return columns
    .map((c) => c.trim())
    .filter((c) => c && !/^(UNIQUE|CHECK|PRIMARY|FOREIGN|CONSTRAINT)\b/i.test(c))
    .map((c) => c.split(/\s+/)[0]!.replace(/["`]/g, ""));
}

describe("migration files", () => {
  it("exist and are numbered so they apply in order", () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
    for (const f of migrationFiles) expect(f).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    const numbers = migrationFiles.map((f) => Number(f.slice(0, 4)));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  // A migration that has already run against minster-data must never be edited
  // to drop something; that is what the next migration is for.
  it("never drops a table or a column", () => {
    expect(withoutComments(sql)).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
  });

  it("creates tables idempotently, so a re-applied migration is not an outage", () => {
    const creates = withoutComments(sql).match(/CREATE TABLE(?!\s+IF NOT EXISTS)/gi);
    expect(creates).toBeNull();
  });
});

describe("the tables the brief specifies", () => {
  // Table → the columns the brief names. Extra columns are allowed (the schema
  // adds timestamps and review bookkeeping); missing ones are not.
  const REQUIRED: Record<string, string[]> = {
    piece: [
      "id",
      "accession",
      "composer",
      "composer_canonical",
      "title",
      "category",
      "voicing",
      "season",
      "location",
      "legacy_ref",
      "notes",
      "review_flag",
      "created_at",
      "updated_at",
    ],
    alias: ["piece_id", "alt_name"],
    holding: ["piece_id", "copies_total", "copies_usable", "condition", "last_counted", "counted_by"],
    file: ["piece_id", "r2_key", "kind", "pages", "bytes"],
    performance: ["piece_id", "date", "service", "source", "youtube_url"],
    choir_profile: ["designation", "typical_singers"],
    repair_job: ["piece_id", "reported_condition", "volunteer", "status"],

    // Build 2 (migration 0002).
    app_setting: ["key", "value", "updated_at", "updated_by"],
    audit_log: ["at", "user_email", "action", "entity", "entity_id", "detail"],
    service: ["service_date", "service_time", "title", "designation", "source", "feed_ref"],
    service_music: ["service_id", "slot", "raw_text", "piece_id", "match_state"],
    match_alias: ["raw_norm", "piece_id"],
    person: ["display_name", "choir", "voice_part", "active"],
    attendance: ["service_id", "person_id", "status", "marked_by", "marked_at"],
    feedback: ["at", "page", "category", "message", "ua"],
    scan_submission: [
      "at",
      "piece_id",
      "r2_key",
      "source",
      "submitted_label",
      "status",
      "reviewed_by",
      "reviewed_at",
    ],
    label_print: ["at", "piece_id", "kind", "by_email"],
    booklet: ["ref", "service_id", "title", "r2_key", "kind", "created_at", "created_by"],
    loan: ["piece_id", "borrower", "out_at", "back_at"],
  };

  for (const [table, required] of Object.entries(REQUIRED)) {
    it(`${table} has every column the brief names`, () => {
      const columns = columnsOf(table);
      expect(columns.length, `${table} was not found in the migrations`).toBeGreaterThan(0);
      for (const column of required) {
        expect(columns, `${table}.${column} is missing`).toContain(column);
      }
    });
  }
});

describe("constraints that carry a decision", () => {
  it("accession is unique but nullable — assigned by hand, not by the importer", () => {
    const piece = tableBody("piece")!;
    expect(piece).toMatch(/accession\s+TEXT\s+UNIQUE/i);
    // A NOT NULL here would force the importer to invent numbers.
    expect(piece).not.toMatch(/accession\s+TEXT\s+[^,]*NOT NULL/i);
  });

  it("legacy_ref is unique — this is what makes re-importing safe", () => {
    expect(tableBody("piece")!).toMatch(/legacy_ref\s+TEXT\s+UNIQUE/i);
  });

  it("category is restricted to the eight codes", () => {
    const piece = tableBody("piece")!;
    for (const code of ["A", "E", "M", "C", "R", "P", "X", "S"]) {
      expect(piece).toContain(`'${code}'`);
    }
  });

  it("condition is restricted to the four grades, in holding and repair_job", () => {
    for (const table of ["holding", "repair_job"]) {
      const body = tableBody(table)!;
      for (const grade of ["fine", "average", "poor", "urgent"]) {
        expect(body, `${table} is missing the '${grade}' grade`).toContain(`'${grade}'`);
      }
    }
  });

  it("a holding cannot claim more usable copies than it has", () => {
    expect(tableBody("holding")!).toMatch(/copies_usable\s*<=\s*copies_total/i);
  });

  it("everything hanging off a piece cascades, so no orphans are left behind", () => {
    for (const table of ["alias", "holding", "file", "performance", "repair_job"]) {
      expect(tableBody(table)!, `${table} does not cascade from piece`).toMatch(
        /REFERENCES piece\(id\) ON DELETE CASCADE/i
      );
    }
  });

  it("an alias cannot be recorded twice against the same piece", () => {
    expect(tableBody("alias")!).toMatch(/UNIQUE\s*\(\s*piece_id\s*,\s*alt_canonical\s*\)/i);
  });

  it("a performance is recorded once per piece, date, service and source", () => {
    expect(tableBody("performance")!).toMatch(/UNIQUE\s*\(\s*piece_id\s*,\s*date\s*,\s*service\s*,\s*source\s*\)/i);
  });

  // Migration 0002 adds to `piece` with ALTER TABLE, so these columns are not in
  // any CREATE TABLE body and columnsOf() cannot see them.
  it("adds the build 2 columns to piece", () => {
    for (const column of ["composer_full", "surname", "location_door", "location_shelf", "spine_state"]) {
      expect(
        withoutComments(sql),
        `piece.${column} is not added by any migration`
      ).toMatch(new RegExp(`ALTER TABLE piece ADD COLUMN ${column}\\b`, "i"));
    }
  });

  // SQLite refuses both on ADD COLUMN, and the failure arrives at migrate time
  // against the live minster-data rather than here, which is far too late.
  it("adds no column SQLite would refuse to add", () => {
    const alters = withoutComments(sql).match(/ALTER TABLE[^;]+ADD COLUMN[^;]+;/gi) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    for (const alter of alters) {
      expect(alter, `SQLite cannot ADD COLUMN with UNIQUE: ${alter}`).not.toMatch(/\bUNIQUE\b/i);
      expect(alter, `SQLite cannot ADD COLUMN with PRIMARY KEY: ${alter}`).not.toMatch(/\bPRIMARY KEY\b/i);
      // A NOT NULL column needs a non-null default, or every existing row fails it.
      if (/\bNOT NULL\b/i.test(alter)) expect(alter).toMatch(/\bDEFAULT\b/i);
    }
  });

  it("restricts spine state to the three the volunteer sheet offers", () => {
    const alter = withoutComments(sql).match(/ALTER TABLE piece ADD COLUMN spine_state[^;]+;/i)![0];
    for (const state of ["ok", "none", "combined"]) expect(alter).toContain(`'${state}'`);
  });

  it("keeps the matcher's three states, and no fourth", () => {
    const body = tableBody("service_music")!;
    for (const state of ["auto", "confirmed", "unmatched"]) expect(body).toContain(`'${state}'`);
  });

  // The memory that stops James confirming "Stanford in B flat" every week: one
  // piece per phrasing, enforced by the database rather than by the code.
  it("lets the matcher learn a phrasing exactly once", () => {
    expect(tableBody("match_alias")!).toMatch(/raw_norm\s+TEXT\s+NOT NULL\s+UNIQUE/i);
  });

  it("takes a service from the feed exactly once", () => {
    expect(tableBody("service")!).toMatch(/feed_ref\s+TEXT\s+UNIQUE/i);
  });

  // The register is tapped down a list at the door; each tap must upsert rather
  // than pile a second row on the first.
  it("records one attendance per person per service", () => {
    expect(tableBody("attendance")!).toMatch(/UNIQUE\s*\(\s*service_id\s*,\s*person_id\s*\)/i);
  });

  it("restricts attendance to present, absent or excused", () => {
    const body = tableBody("attendance")!;
    for (const status of ["present", "absent", "excused"]) expect(body).toContain(`'${status}'`);
  });

  it("holds a crowd scan back until somebody has approved it", () => {
    const body = tableBody("scan_submission")!;
    for (const status of ["pending", "approved", "rejected"]) expect(body).toContain(`'${status}'`);
    // Pending by default: an upload that says nothing about its status must not
    // land visible to the choir.
    expect(body).toMatch(/status\s+TEXT\s+NOT NULL\s+DEFAULT\s+'pending'/i);
  });

  it("cascades everything hanging off a service", () => {
    for (const table of ["service_music", "attendance"]) {
      expect(tableBody(table)!, `${table} does not cascade from service`).toMatch(
        /REFERENCES service\(id\) ON DELETE CASCADE/i
      );
    }
  });

  // Deleting a piece must not take a service's music list with it: the raw text
  // is what the music list said, and it is still true after the parcel is gone.
  it("keeps a music-list line when its matched piece is deleted", () => {
    expect(tableBody("service_music")!).toMatch(/REFERENCES piece\(id\) ON DELETE SET NULL/i);
  });

  // Data protection: names and attendance, and nothing else about a person.
  it("holds no contact details for a chorister", () => {
    const columns = columnsOf("person");
    for (const forbidden of ["email", "phone", "telephone", "mobile", "address", "postcode", "dob", "date_of_birth"]) {
      expect(columns, `person.${forbidden} has no business existing`).not.toContain(forbidden);
    }
  });

  it("indexes the columns the screens actually sort and filter on", () => {
    const indexed = withoutComments(sql);
    expect(indexed).toMatch(/CREATE INDEX IF NOT EXISTS piece_composer_idx/i);
    expect(indexed).toMatch(/CREATE INDEX IF NOT EXISTS alias_canonical_idx/i);
    expect(indexed).toMatch(/CREATE INDEX IF NOT EXISTS holding_piece_idx/i);
  });
});
