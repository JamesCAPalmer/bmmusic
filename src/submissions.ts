/**
 * Crowd scans, feedback and booklets — the three things the choir side writes.
 *
 * The choir side is otherwise read-only, and these are the exceptions, so they
 * live together where the rules governing them can be stated once:
 *
 *   - **A crowd scan is invisible until approved.** It is a photograph of
 *     somebody's marked-up working copy, taken on a phone in a song school.
 *     Nothing surfaces it to another chorister until an admin has looked.
 *   - **Feedback carries no name.** The widget is on a choir-side app used by
 *     children. James wants to know a page is broken, not who noticed.
 *   - **A booklet is a cache entry**, addressed by the content that went into
 *     it, so it can never go stale.
 */

import type { WorkingCopySource } from "./workingcopy";

/** Image types a phone camera actually produces. */
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"]);

/** 20 MB a photo. A modern phone camera lands well under this. */
const MAX_SCAN_BYTES = 20 * 1024 * 1024;

/** At most this many photos in one submission, so one tap cannot fill a bucket. */
const MAX_SCANS_PER_SUBMISSION = 20;

/**
 * Store a chorister's photographs and queue them for approval.
 *
 * Returns how many were stored. Zero means nothing was usable — the caller
 * turns that into a sentence rather than an error, because "your photos were
 * the wrong sort" is something a person can act on and a 500 is not.
 *
 * Objects are written under `pending/` so that an unapproved photograph is
 * distinguishable in the bucket itself, not only in the database.
 */
export async function submitScans(
  db: D1Database,
  bucket: R2Bucket,
  pieceId: number,
  files: File[],
  submittedLabel: string | null
): Promise<number> {
  const usable = files
    .filter((f) => f.size > 0 && f.size <= MAX_SCAN_BYTES)
    .filter((f) => ALLOWED_IMAGE_TYPES.has(f.type.toLowerCase()))
    .slice(0, MAX_SCANS_PER_SUBMISSION);

  if (!usable.length) return 0;

  let stored = 0;
  for (const [index, file] of usable.entries()) {
    // The key carries no user input beyond the extension: a filename off a
    // phone is not something to build an object key out of.
    const extension = extensionFor(file.type);
    const key = `pending/${pieceId}/${crypto.randomUUID()}-${index}${extension}`;

    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });

    await db
      .prepare(
        `INSERT INTO scan_submission (piece_id, r2_key, source, submitted_label, status, bytes, content_type)
         VALUES (?, ?, 'crowd', ?, 'pending', ?, ?)`
      )
      .bind(pieceId, key, submittedLabel, file.size, file.type)
      .run();

    stored++;
  }

  return stored;
}

function extensionFor(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/heic":
      return ".heic";
    case "image/heif":
      return ".heif";
    case "image/webp":
      return ".webp";
    default:
      return ".jpg";
  }
}

export interface ScanSubmissionRow {
  id: number;
  at: string;
  piece_id: number;
  r2_key: string;
  source: string;
  submitted_label: string | null;
  status: string;
  content_type: string | null;
  piece_title: string;
  piece_composer: string;
}

/** The approval queue: crowd scans nobody has looked at yet, oldest first. */
export async function pendingScans(db: D1Database, limit = 50): Promise<ScanSubmissionRow[]> {
  const rows = await db
    .prepare(
      `SELECT s.*, p.title AS piece_title, p.composer AS piece_composer
         FROM scan_submission s
         JOIN piece p ON p.id = s.piece_id
        WHERE s.status = 'pending'
        ORDER BY s.at
        LIMIT ?`
    )
    .bind(Math.min(Math.max(limit, 1), 200))
    .all<ScanSubmissionRow>();
  return rows.results ?? [];
}

export async function getScanSubmission(db: D1Database, id: number): Promise<ScanSubmissionRow | null> {
  return db
    .prepare(
      `SELECT s.*, p.title AS piece_title, p.composer AS piece_composer
         FROM scan_submission s JOIN piece p ON p.id = s.piece_id WHERE s.id = ?`
    )
    .bind(id)
    .first<ScanSubmissionRow>();
}

/**
 * Approve a submission: it becomes a `file` row and so becomes readable.
 *
 * The R2 object is left where it is rather than copied. Moving it would mean
 * two writes and a window where the `file` row points at nothing.
 */
export async function approveScan(db: D1Database, id: number, who: string): Promise<void> {
  const row = await getScanSubmission(db, id);
  if (!row) throw new Error("That submission no longer exists.");

  await db.batch([
    db
      .prepare(
        `INSERT INTO file (piece_id, r2_key, kind, source_ref) VALUES (?, ?, 'reference_scan', ?)
         ON CONFLICT (r2_key) DO NOTHING`
      )
      .bind(row.piece_id, row.r2_key, row.submitted_label ?? "sent in by a chorister"),
    db
      .prepare(
        `UPDATE scan_submission SET status = 'approved', reviewed_by = ?,
                reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
      )
      .bind(who, id),
  ]);
}

/**
 * Reject a submission.
 *
 * The row stays and the object stays: a rejected photograph may be the only
 * record that somebody tried, and deleting it silently would make "did my scan
 * arrive?" unanswerable.
 */
export async function rejectScan(db: D1Database, id: number, who: string): Promise<void> {
  await db
    .prepare(
      `UPDATE scan_submission SET status = 'rejected', reviewed_by = ?,
              reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
    )
    .bind(who, id)
    .run();
}

/**
 * The approved reference scans for a service's music, in service order.
 *
 * Confirmed matches only. An 'auto' guess would put a parcel in a rehearsal
 * booklet on the matcher's say-so, and a chorister turning to page four to find
 * the wrong anthem is exactly the failure the matcher's caution exists to
 * prevent — undoing it here would be perverse.
 */
export async function approvedScansForService(db: D1Database, serviceId: number): Promise<WorkingCopySource[]> {
  const rows = await db
    .prepare(
      `SELECT f.r2_key, p.title
         FROM service_music sm
         JOIN piece p ON p.id = sm.piece_id
         JOIN file f  ON f.piece_id = p.id AND f.kind = 'reference_scan'
        WHERE sm.service_id = ? AND sm.match_state = 'confirmed'
        ORDER BY sm.position, f.id`
    )
    .bind(serviceId)
    .all<{ r2_key: string; title: string }>();

  return (rows.results ?? []).map((r) => ({ r2Key: r.r2_key, title: r.title }));
}

// ---------------------------------------------------------------------------
// Booklets
// ---------------------------------------------------------------------------

export interface BookletRow {
  id: number;
  ref: string;
  service_id: number | null;
  title: string;
  r2_key: string;
  kind: string;
}

export async function getBooklet(db: D1Database, id: number): Promise<BookletRow | null> {
  return db.prepare(`SELECT * FROM booklet WHERE id = ?`).bind(id).first<BookletRow>();
}

/** The most recent booklet for a service, for the "already made" link. */
export async function latestBooklet(
  db: D1Database,
  serviceId: number
): Promise<{ id: number; ref: string } | null> {
  return db
    .prepare(`SELECT id, ref FROM booklet WHERE service_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .bind(serviceId)
    .first<{ id: number; ref: string }>();
}

export async function recordBooklet(
  db: D1Database,
  booklet: {
    ref: string;
    serviceId: number | null;
    title: string;
    r2Key: string;
    kind: "working" | "proper";
    contentHash: string | null;
    pages: number;
    bytes: number;
    createdBy?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO booklet (ref, service_id, title, r2_key, kind, content_hash, pages, bytes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (ref) DO UPDATE SET
         pages = excluded.pages, bytes = excluded.bytes`
    )
    .bind(
      booklet.ref,
      booklet.serviceId,
      booklet.title,
      booklet.r2Key,
      booklet.kind,
      booklet.contentHash,
      booklet.pages,
      booklet.bytes,
      booklet.createdBy ?? null
    )
    .run();
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export interface FeedbackRow {
  id: number;
  at: string;
  page: string | null;
  category: string | null;
  message: string;
  ua: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

export async function recordFeedback(
  db: D1Database,
  entry: { page: string | null; category: string | null; message: string; ua: string | null }
): Promise<void> {
  await db
    .prepare(`INSERT INTO feedback (page, category, message, ua) VALUES (?, ?, ?, ?)`)
    .bind(entry.page, entry.category, entry.message, entry.ua)
    .run();
}

/** Newest first, unresolved above resolved — the admin's reading order. */
export async function allFeedback(db: D1Database, limit = 100): Promise<FeedbackRow[]> {
  const rows = await db
    .prepare(`SELECT * FROM feedback ORDER BY (resolved_at IS NOT NULL), at DESC LIMIT ?`)
    .bind(Math.min(Math.max(limit, 1), 500))
    .all<FeedbackRow>();
  return rows.results ?? [];
}

export async function resolveFeedback(db: D1Database, id: number, who: string): Promise<void> {
  await db
    .prepare(
      `UPDATE feedback SET resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), resolved_by = ? WHERE id = ?`
    )
    .bind(who, id)
    .run();
}
