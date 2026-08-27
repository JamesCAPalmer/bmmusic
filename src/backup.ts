/**
 * The nightly backup.
 *
 * D1 Time Travel gives thirty days of point-in-time restore and is the first
 * line: it is instant, it needs nothing set up, and it covers the failure that
 * actually happens — somebody deleting the wrong thing at four o'clock. What it
 * does not cover is the account itself going wrong, a migration applied to the
 * wrong database, or wanting last month's numbers in a spreadsheet. So every
 * table is also dumped to R2 as JSONL, one object per row, under
 * `backups/YYYY-MM-DD/`, with a manifest of row counts and thirty-five days of
 * rolling retention.
 *
 * Thirty-five and not thirty: a fortnight away and a fortnight of not noticing
 * still leaves a week to act in, and the gap between Time Travel's thirty days
 * and this is exactly the interval where a backup earns its keep.
 *
 * **This dumps personal data.** Choristers' names, their attendance, and their
 * parents' telephone numbers all end up in the bucket. That is the point of a
 * backup and it is why:
 *
 *   - the bucket is `bmmusic-scans`, EU jurisdiction, Minster-side, with no
 *     public access and no signed public URLs — the same bucket the scans are
 *     in and under the same rules;
 *   - nothing about a backup is logged beyond counts. Not a name, not a number,
 *     not a sample row. The audit line says how many rows and how many bytes;
 *   - a restore is a deliberate act by a person, documented in `docs/RESTORE.md`
 *     and not automated. There is no route in this app that reads a backup
 *     object, because a route that streams the whole database out is exactly
 *     the thing the rest of this repository is arranged to prevent.
 */

/**
 * Every table this app owns, in an order a restore can replay.
 *
 * Parents before children: `piece` before `alias`, `person` and `service`
 * before `attendance` and `duty`. Restoring in this order means the foreign
 * keys resolve as the rows land, so a restore does not need them switched off
 * — and if a later migration adds a table, adding it here in the right place
 * is the whole of the work.
 */
export const BACKUP_TABLES = [
  "app_setting",
  "admin_role",
  "audit_log",
  "choir_profile",
  "rate",
  "piece",
  "alias",
  "holding",
  "file",
  "performance",
  "repair_job",
  "loan",
  "label_print",
  "person",
  "parent_contact",
  "service",
  "service_music",
  "match_alias",
  "attendance",
  "duty",
  "booklet",
  "feedback",
  "scan_submission",
] as const;

export interface TableDump {
  table: string;
  rows: number;
  bytes: number;
  /** Set when a table could not be read — a missing table, usually. */
  error?: string;
}

export interface BackupManifest {
  /** "YYYY-MM-DD". */
  date: string;
  takenAt: string;
  tables: TableDump[];
  totalRows: number;
  totalBytes: number;
}

/** `backups/2026-08-27/person.jsonl`. */
export function objectKey(date: string, table: string): string {
  return `backups/${date}/${table}.jsonl`;
}

export function manifestKey(date: string): string {
  return `backups/${date}/manifest.json`;
}

/**
 * The date a backup key is for, or null if the key is not one of ours.
 *
 * Retention deletes on this and nothing else. A key that does not parse is
 * left alone: something that is not a backup is not this function's to remove,
 * and deleting an unrecognised object out of a bucket that also holds every
 * scan of the library would be an unforced disaster.
 */
export function dateOfBackupKey(key: string): string | null {
  const match = /^backups\/(\d{4}-\d{2}-\d{2})\//.exec(key);
  return match ? match[1]! : null;
}

/** Which backup keys are old enough to delete. */
export function expiredKeys(
  keys: readonly string[],
  today: string,
  retentionDays: number
): string[] {
  const cutoff = addDays(today, -retentionDays);
  return keys.filter((key) => {
    const date = dateOfBackupKey(key);
    return date !== null && date < cutoff;
  });
}

/** "YYYY-MM-DD" plus (or minus) a number of days, without a Date library. */
export function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** One JSON object per line. Newline-terminated, so appending is trivial. */
export function toJsonl(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

export const RETENTION_DAYS = 35;

/**
 * Dump every table to R2 and delete what has aged out.
 *
 * Never throws. A backup that fails must not take the cron down with it — the
 * feed read runs off the same schedule, and losing the month's music list
 * because a bucket was briefly unreachable would be a worse outcome than a
 * missing night's backup. Failures go in the manifest and the log, and the run
 * carries on to the next table.
 */
export async function runBackup(
  db: D1Database,
  bucket: R2Bucket,
  date: string,
  now: string
): Promise<BackupManifest> {
  const tables: TableDump[] = [];

  for (const table of BACKUP_TABLES) {
    try {
      const result = await db.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
      const rows = result.results ?? [];
      const jsonl = toJsonl(rows);
      const bytes = new TextEncoder().encode(jsonl).length;

      await bucket.put(objectKey(date, table), jsonl, {
        httpMetadata: { contentType: "application/x-ndjson" },
      });
      tables.push({ table, rows: rows.length, bytes });
    } catch (e) {
      // The message and nothing else. A D1 error can quote the statement that
      // failed, and a statement can quote a row.
      tables.push({
        table,
        rows: 0,
        bytes: 0,
        error: e instanceof Error ? e.message.slice(0, 200) : "unknown error",
      });
    }
  }

  const manifest: BackupManifest = {
    date,
    takenAt: now,
    tables,
    totalRows: tables.reduce((sum, t) => sum + t.rows, 0),
    totalBytes: tables.reduce((sum, t) => sum + t.bytes, 0),
  };

  await bucket.put(manifestKey(date), JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });

  return manifest;
}

/**
 * Delete backups older than the retention window.
 *
 * Returns how many objects went, for the audit line. Listing is paged because
 * a bucket that also holds every scan in the library has far more than a
 * thousand objects in it, and `backups/` is used as a prefix so nothing else
 * is ever even considered.
 */
export async function pruneBackups(
  bucket: R2Bucket,
  today: string,
  retentionDays = RETENTION_DAYS
): Promise<number> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ prefix: "backups/", cursor, limit: 1000 });
    for (const object of listed.objects) keys.push(object.key);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  const doomed = expiredKeys(keys, today, retentionDays);
  // In batches: R2's delete takes up to a thousand keys at a time.
  for (let i = 0; i < doomed.length; i += 1000) {
    await bucket.delete(doomed.slice(i, i + 1000));
  }
  return doomed.length;
}
