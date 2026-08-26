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

  it("indexes the columns the screens actually sort and filter on", () => {
    const indexed = withoutComments(sql);
    expect(indexed).toMatch(/CREATE INDEX IF NOT EXISTS piece_composer_idx/i);
    expect(indexed).toMatch(/CREATE INDEX IF NOT EXISTS alias_canonical_idx/i);
    expect(indexed).toMatch(/CREATE INDEX IF NOT EXISTS holding_piece_idx/i);
  });
});
