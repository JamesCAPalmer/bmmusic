/**
 * The librarian's numbers: coverage, what gets sung, and what to do next.
 *
 * Every query here answers a question James actually asks. Where a number could
 * be read two ways, the comment says which reading it is — a coverage figure
 * that quietly counts the wrong denominator is worse than no figure, because
 * somebody will plan an afternoon around it.
 */

import { CHURCH } from "./church.config";

// ---------------------------------------------------------------------------
// Coverage (H9)
// ---------------------------------------------------------------------------

export interface Coverage {
  pieces: number;
  reviewed: number;
  counted: number;
  conditionAssessed: number;
  scanned: number;
  seasonTagged: number;
  located: number;
  withAccession: number;
}

/**
 * How far through the cataloguing we are, as counts rather than percentages.
 *
 * Counts, not percentages, because the screen needs the denominator anyway and
 * a percentage of an unknown total is how "we're 80% done" becomes untrue.
 *
 * "Condition assessed" and "counted" are separate on purpose even though the
 * same form collects both: a holding row always carries a condition, so they
 * move together today, but a future bulk import of counts without conditions
 * would pull them apart and the screen should show that rather than hide it.
 */
export async function coverage(db: D1Database): Promise<Coverage> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM piece) AS pieces,
         (SELECT COUNT(*) FROM piece WHERE reviewed_at IS NOT NULL) AS reviewed,
         (SELECT COUNT(DISTINCT piece_id) FROM holding) AS counted,
         (SELECT COUNT(DISTINCT piece_id) FROM holding WHERE condition IS NOT NULL) AS conditionAssessed,
         (SELECT COUNT(DISTINCT piece_id) FROM file WHERE kind = 'reference_scan') AS scanned,
         (SELECT COUNT(*) FROM piece WHERE season IS NOT NULL AND season != '') AS seasonTagged,
         (SELECT COUNT(*) FROM piece WHERE location_door IS NOT NULL OR (location IS NOT NULL AND location != '')) AS located,
         (SELECT COUNT(*) FROM piece WHERE accession IS NOT NULL) AS withAccession`
    )
    .first<Coverage>();

  return (
    row ?? {
      pieces: 0,
      reviewed: 0,
      counted: 0,
      conditionAssessed: 0,
      scanned: 0,
      seasonTagged: 0,
      located: 0,
      withAccession: 0,
    }
  );
}

// ---------------------------------------------------------------------------
// What gets sung
// ---------------------------------------------------------------------------

export interface SungCount {
  piece_id: number;
  title: string;
  composer: string;
  times: number;
  last_sung: string | null;
}

/**
 * Most sung over a window, from confirmed music-list matches.
 *
 * Confirmed only, throughout this module. An 'auto' match is the matcher's
 * proposal, and building a year's statistics on proposals would produce a
 * report that looks authoritative and is partly guesswork.
 */
export async function mostSung(db: D1Database, since: string, limit = 20): Promise<SungCount[]> {
  const rows = await db
    .prepare(
      `SELECT p.id AS piece_id, p.title, p.composer,
              COUNT(*) AS times, MAX(s.service_date) AS last_sung
         FROM service_music sm
         JOIN service s ON s.id = sm.service_id
         JOIN piece p   ON p.id = sm.piece_id
        WHERE sm.match_state = 'confirmed' AND s.service_date >= ?
        GROUP BY p.id
        ORDER BY times DESC, last_sung DESC
        LIMIT ?`
    )
    .bind(since, Math.min(Math.max(limit, 1), 100))
    .all<SungCount>();
  return rows.results ?? [];
}

/**
 * Reviewed pieces nobody has sung in the window, least recently sung first.
 *
 * Reviewed only: a draft row nobody has checked is not "neglected repertoire",
 * it is a row that may not describe a real parcel.
 */
export async function leastSung(db: D1Database, since: string, limit = 20): Promise<SungCount[]> {
  const rows = await db
    .prepare(
      `SELECT p.id AS piece_id, p.title, p.composer,
              0 AS times,
              (SELECT MAX(s2.service_date) FROM service_music sm2
                 JOIN service s2 ON s2.id = sm2.service_id
                WHERE sm2.piece_id = p.id AND sm2.match_state = 'confirmed') AS last_sung
         FROM piece p
        WHERE p.reviewed_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM service_music sm
              JOIN service s ON s.id = sm.service_id
             WHERE sm.piece_id = p.id AND sm.match_state = 'confirmed' AND s.service_date >= ?
          )
        ORDER BY (last_sung IS NOT NULL), last_sung, p.composer_canonical
        LIMIT ?`
    )
    .bind(since, Math.min(Math.max(limit, 1), 100))
    .all<SungCount>();
  return rows.results ?? [];
}

export interface ConditionCount {
  condition: string;
  n: number;
}

/** The condition summary, over each piece's most recent count. */
export async function conditionSummary(db: D1Database): Promise<ConditionCount[]> {
  const rows = await db
    .prepare(
      `SELECT condition, COUNT(*) AS n FROM (
         SELECT h.condition FROM holding h
          WHERE h.id = (SELECT h2.id FROM holding h2 WHERE h2.piece_id = h.piece_id
                         ORDER BY h2.last_counted DESC, h2.id DESC LIMIT 1)
       ) GROUP BY condition`
    )
    .all<ConditionCount>();

  const found = new Map((rows.results ?? []).map((r) => [r.condition, r.n]));
  // Every grade, in the config's order, so a grade with nothing in it still
  // shows as zero rather than vanishing off the report.
  return CHURCH.conditions.map((c) => ({ condition: c.value, n: found.get(c.value) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Priority queues
// ---------------------------------------------------------------------------

export interface PriorityPiece {
  id: number;
  title: string;
  composer: string;
  accession: string | null;
  season: string | null;
  /** Why this is near the top, in words. */
  reason: string;
  last_sung: string | null;
}

/**
 * What to scan next.
 *
 * The order is the order that saves the most wasted trips to the song school:
 *
 *   1. Confirmed on a service that has not happened yet — somebody needs it.
 *   2. Tagged for the season we are in — likely to come up.
 *   3. Sung most recently — proven repertoire before untouched shelves.
 *
 * Anything already scanned is out entirely, which is what makes this a queue
 * rather than a ranking of the whole catalogue.
 */
export async function scanningPriority(
  db: D1Database,
  from: string,
  seasons: string[],
  limit = 40
): Promise<PriorityPiece[]> {
  // Season tags are semicolon-joined, so matching is a LIKE per tag. A handful
  // of tags is the most this is ever called with (the current and next season).
  const seasonClause = seasons.length
    ? seasons.map(() => `p.season LIKE ?`).join(" OR ")
    : "0";

  const rows = await db
    .prepare(
      `SELECT p.id, p.title, p.composer, p.accession, p.season,
              (SELECT MAX(s.service_date) FROM service_music sm
                 JOIN service s ON s.id = sm.service_id
                WHERE sm.piece_id = p.id AND sm.match_state = 'confirmed') AS last_sung,
              CASE
                WHEN EXISTS (SELECT 1 FROM service_music sm
                               JOIN service s ON s.id = sm.service_id
                              WHERE sm.piece_id = p.id AND sm.match_state = 'confirmed'
                                AND s.service_date >= ?) THEN 'coming up at a service'
                WHEN (${seasonClause}) THEN 'tagged for the season'
                ELSE 'sung recently'
              END AS reason,
              CASE
                WHEN EXISTS (SELECT 1 FROM service_music sm
                               JOIN service s ON s.id = sm.service_id
                              WHERE sm.piece_id = p.id AND sm.match_state = 'confirmed'
                                AND s.service_date >= ?) THEN 0
                WHEN (${seasonClause}) THEN 1
                ELSE 2
              END AS rank
         FROM piece p
        WHERE p.reviewed_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM file f WHERE f.piece_id = p.id AND f.kind = 'reference_scan')
        ORDER BY rank, last_sung DESC, p.composer_canonical
        LIMIT ?`
    )
    .bind(
      from,
      ...seasons.map((s) => `%${s}%`),
      from,
      ...seasons.map((s) => `%${s}%`),
      Math.min(Math.max(limit, 1), 200)
    )
    .all<PriorityPiece>();

  return rows.results ?? [];
}

/**
 * What to repair next: urgent, then poor, then anything with no usable spine.
 *
 * The spine tick auto-nominates (13A): a parcel nobody can read the spine of is
 * effectively lost on the shelf, whatever state the paper inside is in.
 */
export async function repairPriority(db: D1Database, limit = 40): Promise<PriorityPiece[]> {
  const rows = await db
    .prepare(
      `SELECT p.id, p.title, p.composer, p.accession, p.season,
              (SELECT MAX(s.service_date) FROM service_music sm
                 JOIN service s ON s.id = sm.service_id
                WHERE sm.piece_id = p.id AND sm.match_state = 'confirmed') AS last_sung,
              CASE
                WHEN lh.condition = 'urgent' THEN 'urgent — falling apart'
                WHEN lh.condition = 'poor'   THEN 'poor — needs attention'
                ELSE 'no usable spine label'
              END AS reason,
              CASE lh.condition WHEN 'urgent' THEN 0 WHEN 'poor' THEN 1 ELSE 2 END AS rank
         FROM piece p
         LEFT JOIN (
           SELECT h.* FROM holding h
            WHERE h.id = (SELECT h2.id FROM holding h2 WHERE h2.piece_id = h.piece_id
                           ORDER BY h2.last_counted DESC, h2.id DESC LIMIT 1)
         ) lh ON lh.piece_id = p.id
        WHERE lh.condition IN ('poor','urgent') OR p.spine_state = 'none'
        ORDER BY rank, last_sung DESC, p.composer_canonical
        LIMIT ?`
    )
    .bind(Math.min(Math.max(limit, 1), 200))
    .all<PriorityPiece>();

  return rows.results ?? [];
}

// ---------------------------------------------------------------------------
// Stocktake (H6)
// ---------------------------------------------------------------------------

export interface RecountRow {
  id: number;
  title: string;
  composer: string;
  accession: string | null;
  last_counted: string | null;
  performances_since: number;
  reason: string;
}

/**
 * Parcels due a recount: not counted in five years, **or** sung ten times since
 * the last count, whichever comes first.
 *
 * Deliberately a list James can look at rather than a nag. It feeds the
 * volunteer-sheet run; nothing about it chases anybody.
 */
export async function dueRecount(db: D1Database, today: string, limit = 100): Promise<RecountRow[]> {
  const fiveYearsAgo = `${Number(today.slice(0, 4)) - CHURCH.stocktake.yearsBetweenCounts}${today.slice(4)}`;

  const rows = await db
    .prepare(
      `SELECT p.id, p.title, p.composer, p.accession,
              lh.last_counted,
              (SELECT COUNT(*) FROM service_music sm
                 JOIN service s ON s.id = sm.service_id
                WHERE sm.piece_id = p.id AND sm.match_state = 'confirmed'
                  AND (lh.last_counted IS NULL OR s.service_date > lh.last_counted)) AS performances_since,
              CASE
                WHEN lh.last_counted IS NULL THEN 'never counted'
                WHEN lh.last_counted < ? THEN 'not counted for ' || ? || ' years'
                ELSE 'sung a lot since it was last counted'
              END AS reason
         FROM piece p
         LEFT JOIN (
           SELECT h.* FROM holding h
            WHERE h.id = (SELECT h2.id FROM holding h2 WHERE h2.piece_id = h.piece_id
                           ORDER BY h2.last_counted DESC, h2.id DESC LIMIT 1)
         ) lh ON lh.piece_id = p.id
        WHERE p.reviewed_at IS NOT NULL
          AND (lh.last_counted IS NULL
               OR lh.last_counted < ?
               OR (SELECT COUNT(*) FROM service_music sm
                     JOIN service s ON s.id = sm.service_id
                    WHERE sm.piece_id = p.id AND sm.match_state = 'confirmed'
                      AND s.service_date > lh.last_counted) >= ?)
        ORDER BY (lh.last_counted IS NOT NULL), lh.last_counted, performances_since DESC
        LIMIT ?`
    )
    .bind(
      fiveYearsAgo,
      CHURCH.stocktake.yearsBetweenCounts,
      fiveYearsAgo,
      CHURCH.stocktake.performancesBetweenCounts,
      Math.min(Math.max(limit, 1), 500)
    )
    .all<RecountRow>();

  return rows.results ?? [];
}

// ---------------------------------------------------------------------------
// Loans (H5)
// ---------------------------------------------------------------------------

export interface LoanRow {
  id: number;
  piece_id: number;
  copies: number;
  borrower: string;
  reason: string | null;
  out_at: string;
  due_back: string | null;
  back_at: string | null;
  title: string;
  composer: string;
}

/** Everything currently out, longest out first. */
export async function openLoans(db: D1Database): Promise<LoanRow[]> {
  const rows = await db
    .prepare(
      `SELECT l.*, p.title, p.composer
         FROM loan l JOIN piece p ON p.id = l.piece_id
        WHERE l.back_at IS NULL
        ORDER BY l.out_at`
    )
    .all<LoanRow>();
  return rows.results ?? [];
}

/** One piece's loan history, for the piece page. */
export async function loansForPiece(db: D1Database, pieceId: number): Promise<LoanRow[]> {
  const rows = await db
    .prepare(
      `SELECT l.*, p.title, p.composer
         FROM loan l JOIN piece p ON p.id = l.piece_id
        WHERE l.piece_id = ?
        ORDER BY l.out_at DESC LIMIT 20`
    )
    .bind(pieceId)
    .all<LoanRow>();
  return rows.results ?? [];
}

export async function lendOut(
  db: D1Database,
  loan: { pieceId: number; copies: number; borrower: string; reason: string | null; dueBack: string | null },
  who: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO loan (piece_id, copies, borrower, reason, due_back, logged_by) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(loan.pieceId, loan.copies, loan.borrower, loan.reason, loan.dueBack, who)
    .run();
}

export async function markReturned(db: D1Database, loanId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE loan SET back_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND back_at IS NULL`
    )
    .bind(loanId)
    .run();
}

// ---------------------------------------------------------------------------
// Feast ahead (H11)
// ---------------------------------------------------------------------------

export interface SeasonReadiness {
  season: string;
  label: string;
  tagged: number;
  scanned: number;
  /** Tagged pieces whose latest count is short of the biggest choir we know of. */
  thin: number;
}

/**
 * How ready we are for each of the coming seasons.
 *
 * "Thin" compares usable copies against the largest `typical_singers` on record
 * — the worst case, since a piece may be sung by any choir. With no numbers
 * recorded it is zero rather than everything, because "we cannot tell" must not
 * render as "everything is a problem".
 */
export async function seasonReadiness(db: D1Database, seasons: string[]): Promise<SeasonReadiness[]> {
  if (!seasons.length) return [];

  const biggest = await db
    .prepare(`SELECT MAX(typical_singers) AS n FROM choir_profile WHERE typical_singers IS NOT NULL`)
    .first<{ n: number | null }>();
  const need = biggest?.n ?? null;

  const out: SeasonReadiness[] = [];
  for (const season of seasons) {
    const row = await db
      .prepare(
        `SELECT
           COUNT(*) AS tagged,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM file f WHERE f.piece_id = p.id AND f.kind='reference_scan')
                    THEN 1 ELSE 0 END) AS scanned,
           SUM(CASE WHEN ? IS NOT NULL AND (
                      SELECT h.copies_usable FROM holding h WHERE h.piece_id = p.id
                       ORDER BY h.last_counted DESC, h.id DESC LIMIT 1
                    ) < ? THEN 1 ELSE 0 END) AS thin
           FROM piece p
          WHERE p.season LIKE ?`
      )
      .bind(need, need, `%${season}%`)
      .first<{ tagged: number; scanned: number | null; thin: number | null }>();

    out.push({
      season,
      label: CHURCH.seasons.find((s) => s.value === season)?.label ?? season,
      tagged: row?.tagged ?? 0,
      scanned: row?.scanned ?? 0,
      thin: row?.thin ?? 0,
    });
  }
  return out;
}
