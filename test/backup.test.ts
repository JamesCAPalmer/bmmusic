/**
 * The nightly backup.
 *
 * Two things can go wrong here and neither announces itself. A table added by
 * a migration and not added to `BACKUP_TABLES` is simply never backed up —
 * the job succeeds every night and the data is not in it. And a retention
 * sweep that misreads a key deletes something it should not, out of a bucket
 * that also holds every scan of the library.
 *
 * So: the table list is checked against the migrations, and the sweep is put
 * every awkward key it might meet.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BACKUP_TABLES,
  RETENTION_DAYS,
  addDays,
  dateOfBackupKey,
  expiredKeys,
  manifestKey,
  objectKey,
  toJsonl,
} from "../src/backup";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");
const sql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n");

/** Every table the migrations end up with, scratch tables excluded. */
function tablesInMigrations(): string[] {
  const created = new Set<string>();
  for (const match of sql.replace(/--[^\n]*/g, "").matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/gi)) {
    created.add(match[1]!);
  }
  // A carry table is created and dropped inside a migration; a rebuild's
  // scratch table is created under one name and renamed into place. Neither
  // name survives, so neither should be here.
  for (const match of sql.matchAll(/DROP TABLE (?:IF EXISTS )?(\w+)/gi)) created.delete(match[1]!);
  for (const match of sql.matchAll(/ALTER TABLE\s+(\w+)\s+RENAME TO\s+(\w+)/gi)) {
    created.delete(match[1]!);
    created.add(match[2]!);
  }
  return [...created];
}

describe("what gets backed up", () => {
  // The failure this catches: a migration adds a table, nobody adds it here,
  // and the job keeps succeeding every night without it.
  it("covers every table the migrations create", () => {
    for (const table of tablesInMigrations()) {
      expect(
        (BACKUP_TABLES as readonly string[]).includes(table),
        `${table} exists in the schema and is not in BACKUP_TABLES — it is not being backed up`
      ).toBe(true);
    }
  });

  it("backs up nothing that does not exist", () => {
    const real = tablesInMigrations();
    for (const table of BACKUP_TABLES) {
      expect(real, `BACKUP_TABLES names ${table}, which no migration creates`).toContain(table);
    }
  });

  it("names each table once", () => {
    expect(new Set(BACKUP_TABLES).size).toBe(BACKUP_TABLES.length);
  });

  // Restoring in this order means foreign keys resolve as the rows land, so a
  // restore does not need them switched off.
  it("lists a table before anything that references it", () => {
    const order = new Map(BACKUP_TABLES.map((t, i) => [t as string, i]));
    const pairs: Array<[string, string]> = [
      ["piece", "alias"],
      ["piece", "holding"],
      ["piece", "file"],
      ["person", "parent_contact"],
      ["person", "attendance"],
      ["person", "duty"],
      ["service", "attendance"],
      ["service", "duty"],
      ["service", "service_music"],
    ];
    for (const [parent, child] of pairs) {
      expect(order.get(parent)!, `${child} is dumped before ${parent}`).toBeLessThan(order.get(child)!);
    }
  });
});

describe("keys", () => {
  it("puts a day's tables together under its date", () => {
    expect(objectKey("2026-08-27", "person")).toBe("backups/2026-08-27/person.jsonl");
    expect(manifestKey("2026-08-27")).toBe("backups/2026-08-27/manifest.json");
  });

  it("reads the date back out of a key", () => {
    expect(dateOfBackupKey("backups/2026-08-27/person.jsonl")).toBe("2026-08-27");
    expect(dateOfBackupKey("backups/2026-08-27/manifest.json")).toBe("2026-08-27");
  });

  // The bucket also holds every scan in the library. Anything that is not
  // recognisably a backup key must come back null, so the sweep leaves it be.
  it("recognises nothing else in the bucket", () => {
    for (const key of [
      "scans/piece-12/front.pdf",
      "booklets/2026-09-06.pdf",
      "backups/manifest.json",
      "backups/not-a-date/person.jsonl",
      "backups/2026-8-27/person.jsonl",
      "Backups/2026-08-27/person.jsonl",
      "",
    ]) {
      expect(dateOfBackupKey(key), key).toBeNull();
    }
  });
});

describe("retention", () => {
  it("keeps 35 days", () => {
    expect(RETENTION_DAYS).toBe(35);
  });

  it("counts days across a month and a year end", () => {
    expect(addDays("2026-08-27", -35)).toBe("2026-07-23");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("deletes what is past the window and keeps what is inside it", () => {
    const keys = [
      "backups/2026-07-22/person.jsonl",
      "backups/2026-07-23/person.jsonl",
      "backups/2026-08-27/person.jsonl",
    ];
    expect(expiredKeys(keys, "2026-08-27", 35)).toEqual(["backups/2026-07-22/person.jsonl"]);
  });

  it("never deletes anything it does not recognise as a backup", () => {
    const keys = [
      "scans/piece-12/front.pdf",
      "booklets/old.pdf",
      "backups/rubbish.json",
      "backups/1999-01-01/person.jsonl",
    ];
    expect(expiredKeys(keys, "2026-08-27", 35)).toEqual(["backups/1999-01-01/person.jsonl"]);
  });

  it("deletes nothing on a bucket that has never been backed up to", () => {
    expect(expiredKeys([], "2026-08-27", 35)).toEqual([]);
  });
});

describe("the dump format", () => {
  it("is one object per line, newline-terminated", () => {
    const jsonl = toJsonl([{ id: 1, name: "A" }, { id: 2, name: "B" }]);
    expect(jsonl).toBe('{"id":1,"name":"A"}\n{"id":2,"name":"B"}\n');
  });

  it("is genuinely empty for an empty table, not a stray newline", () => {
    expect(toJsonl([])).toBe("");
  });

  it("round-trips a row with a newline and a quote in it", () => {
    const row = { note: 'He said "stop"\nthen left', n: null };
    expect(JSON.parse(toJsonl([row]).trim())).toEqual(row);
  });
});

describe("the schedules", () => {
  const wrangler = readFileSync(join(import.meta.dirname, "..", "wrangler.toml"), "utf8");

  // The dispatch in `scheduled()` matches on the expression, so a change here
  // that is not made there silently sends a job down the wrong branch.
  it("are declared in wrangler.toml exactly as the code matches them", () => {
    for (const cron of ["30 * * * *", "15 2 * * *", "0 3 1 9 *"]) {
      expect(wrangler, `wrangler.toml does not declare "${cron}"`).toContain(`"${cron}"`);
    }

    const source = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
    for (const cron of ["30 * * * *", "15 2 * * *", "0 3 1 9 *"]) {
      expect(source, `src/index.ts does not match on "${cron}"`).toContain(`"${cron}"`);
    }
  });

  it("do not put the backup on the same minute as the feed read", () => {
    expect("15 2 * * *".split(" ")[0]).not.toBe("30 * * * *".split(" ")[0]);
  });
});

describe("the restore guide", () => {
  const restore = readFileSync(join(import.meta.dirname, "..", "docs", "RESTORE.md"), "utf8");

  it("documents both layers", () => {
    expect(restore).toMatch(/time.travel/i);
    expect(restore).toContain("backups/");
    expect(restore).toContain("35 days");
  });

  // A restore guide that does not say the dump holds children's names is a
  // guide that will get one emailed to somebody.
  it("says what is in the dump", () => {
    expect(restore).toMatch(/children's names/i);
  });
});
