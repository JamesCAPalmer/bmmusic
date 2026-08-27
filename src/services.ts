/**
 * Services, their music lists, and the matcher's memory — the D1 half.
 *
 * `src/feed.ts` reads the feed and `src/matcher.ts` decides what a line means;
 * both are pure. This is where the results meet the database, kept apart so the
 * two hard parts stay testable without a database anywhere near them.
 */

import { canonicalComposer, canonicalTitle } from "./normalise";
import {
  isMatchable,
  matchLine,
  normaliseMatchKey,
  type CorpusPiece,
  type Slot,
} from "./matcher";
import type { ReadMonth, ReadService } from "./feed";

export interface ServiceRow {
  id: number;
  service_date: string;
  service_time: string | null;
  title: string;
  designation: string | null;
  source: string;
  feed_ref: string | null;
}

export interface ServiceMusicRow {
  id: number;
  service_id: number;
  slot: string;
  raw_text: string;
  piece_id: number | null;
  match_state: string;
  position: number;
}

/** A music line with the piece it matched, for rendering a service. */
export interface ServiceMusicWithPiece extends ServiceMusicRow {
  piece_title: string | null;
  piece_composer: string | null;
  piece_accession: string | null;
  /** Usable copies from the latest count, for the RAG. NULL when never counted. */
  copies_usable: number | null;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Services from `from` onwards, soonest first.
 *
 * Dates are compared as text, which is exactly right for "YYYY-MM-DD" and is
 * why the schema stores them that way.
 */
export async function upcomingServices(
  db: D1Database,
  from: string,
  limit = 20
): Promise<ServiceRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM service
        WHERE service_date >= ?
        ORDER BY service_date, COALESCE(service_time, '00:00')
        LIMIT ?`
    )
    .bind(from, Math.min(Math.max(limit, 1), 100))
    .all<ServiceRow>();
  return rows.results ?? [];
}

export async function getService(db: D1Database, id: number): Promise<ServiceRow | null> {
  return db.prepare(`SELECT * FROM service WHERE id = ?`).bind(id).first<ServiceRow>();
}

/** One service's music list, in service order, with whatever it matched. */
export async function serviceMusic(db: D1Database, serviceId: number): Promise<ServiceMusicWithPiece[]> {
  const rows = await db
    .prepare(
      `SELECT sm.*,
              p.title     AS piece_title,
              p.composer  AS piece_composer,
              p.accession AS piece_accession,
              (SELECT h.copies_usable FROM holding h
                WHERE h.piece_id = p.id
                ORDER BY h.last_counted DESC, h.id DESC LIMIT 1) AS copies_usable
         FROM service_music sm
         LEFT JOIN piece p ON p.id = sm.piece_id
        WHERE sm.service_id = ?
        ORDER BY sm.position, sm.id`
    )
    .bind(serviceId)
    .all<ServiceMusicWithPiece>();
  return rows.results ?? [];
}

/** Every line still waiting for a human to say what it is. */
export async function unmatchedLines(
  db: D1Database,
  limit = 50,
  offset = 0
): Promise<{ lines: (ServiceMusicWithPiece & { service_date: string; service_title: string })[]; total: number }> {
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM service_music WHERE match_state != 'confirmed'`)
    .first<{ n: number }>();

  const rows = await db
    .prepare(
      `SELECT sm.*,
              p.title     AS piece_title,
              p.composer  AS piece_composer,
              p.accession AS piece_accession,
              NULL        AS copies_usable,
              s.service_date, s.title AS service_title
         FROM service_music sm
         JOIN service s ON s.id = sm.service_id
         LEFT JOIN piece p ON p.id = sm.piece_id
        WHERE sm.match_state != 'confirmed'
        ORDER BY (sm.match_state = 'auto'), s.service_date DESC, sm.position
        LIMIT ? OFFSET ?`
    )
    .bind(Math.min(Math.max(limit, 1), 200), Math.max(offset, 0))
    .all<ServiceMusicWithPiece & { service_date: string; service_title: string }>();

  return { lines: rows.results ?? [], total: countRow?.n ?? 0 };
}

/**
 * Where a piece has been sung, from confirmed music-list matches.
 *
 * Only 'confirmed' counts. An 'auto' guess on a chorister's "last sung" line
 * would be presenting the matcher's opinion as history, which it is not.
 */
export async function sungAt(
  db: D1Database,
  pieceId: number,
  limit = 20
): Promise<{ service_date: string; title: string; service_id: number }[]> {
  const rows = await db
    .prepare(
      `SELECT s.id AS service_id, s.service_date, s.title
         FROM service_music sm
         JOIN service s ON s.id = sm.service_id
        WHERE sm.piece_id = ? AND sm.match_state = 'confirmed'
        ORDER BY s.service_date DESC
        LIMIT ?`
    )
    .bind(pieceId, Math.min(Math.max(limit, 1), 100))
    .all<{ service_date: string; title: string; service_id: number }>();
  return rows.results ?? [];
}

// ---------------------------------------------------------------------------
// The corpus and the learned aliases
// ---------------------------------------------------------------------------

/**
 * The whole catalogue, flattened for matching.
 *
 * Loaded once per run rather than queried per line. Six hundred parcels is
 * nothing to hold in memory, and doing it this way keeps the matching itself
 * pure — which is what lets it be tested against real feed lines.
 */
export async function loadCorpus(db: D1Database): Promise<CorpusPiece[]> {
  const [pieces, aliases] = await Promise.all([
    db
      .prepare(`SELECT id, composer, composer_full, surname, title FROM piece`)
      .all<{ id: number; composer: string; composer_full: string | null; surname: string | null; title: string }>(),
    db.prepare(`SELECT piece_id, alt_name FROM alias`).all<{ piece_id: number; alt_name: string }>(),
  ]);

  const aliasesByPiece = new Map<number, string[]>();
  for (const a of aliases.results ?? []) {
    const list = aliasesByPiece.get(a.piece_id);
    if (list) list.push(a.alt_name);
    else aliasesByPiece.set(a.piece_id, [a.alt_name]);
  }

  return (pieces.results ?? []).map((p) => ({
    id: p.id,
    titles: [p.title, ...(aliasesByPiece.get(p.id) ?? [])],
    composers: [p.composer, p.composer_full, p.surname].filter((c): c is string => Boolean(c)),
  }));
}

/** Everything a human has taught the matcher, keyed on normalised raw text. */
export async function loadLearnedAliases(db: D1Database): Promise<Map<string, number>> {
  const rows = await db.prepare(`SELECT raw_norm, piece_id FROM match_alias`).all<{
    raw_norm: string;
    piece_id: number;
  }>();
  return new Map((rows.results ?? []).map((r) => [r.raw_norm, r.piece_id]));
}

/**
 * Teach the matcher that this phrasing means this piece.
 *
 * Written on confirmation, and only on confirmation: an 'auto' proposal is the
 * matcher's own guess, and letting it teach itself would turn one wrong match
 * into a permanent one.
 */
export async function rememberMatch(
  db: D1Database,
  rawText: string,
  pieceId: number,
  who: string
): Promise<void> {
  const key = normaliseMatchKey(rawText);
  if (!key) return;
  await db
    .prepare(
      `INSERT INTO match_alias (raw_norm, piece_id, created_by) VALUES (?, ?, ?)
       ON CONFLICT (raw_norm) DO UPDATE SET piece_id = excluded.piece_id, created_by = excluded.created_by`
    )
    .bind(key, pieceId, who)
    .run();
}

// ---------------------------------------------------------------------------
// Confirming and correcting
// ---------------------------------------------------------------------------

/**
 * Confirm a line against a piece — the admin's one tap.
 *
 * Two writes that belong together: the line becomes 'confirmed', and the pair
 * is remembered so the same phrasing never has to be confirmed again.
 */
export async function confirmMatch(
  db: D1Database,
  lineId: number,
  pieceId: number,
  who: string
): Promise<void> {
  const line = await db
    .prepare(`SELECT raw_text FROM service_music WHERE id = ?`)
    .bind(lineId)
    .first<{ raw_text: string }>();
  if (!line) throw new Error("That music line no longer exists.");

  await db
    .prepare(`UPDATE service_music SET piece_id = ?, match_state = 'confirmed' WHERE id = ?`)
    .bind(pieceId, lineId)
    .run();

  await rememberMatch(db, line.raw_text, pieceId, who);
}

/**
 * Say that a line matches nothing in the library.
 *
 * Not the same as leaving it alone: it clears a wrong proposal, so the line
 * stops claiming a parcel it is not. It stays in the queue, because "we do not
 * own this" is a fact about today's catalogue and may stop being true.
 */
export async function rejectMatch(db: D1Database, lineId: number): Promise<void> {
  await db
    .prepare(`UPDATE service_music SET piece_id = NULL, match_state = 'unmatched' WHERE id = ?`)
    .bind(lineId)
    .run();
}

// ---------------------------------------------------------------------------
// Ingesting a month
// ---------------------------------------------------------------------------

export interface IngestSummary {
  month: string;
  /** True when the feed's sourceHash had not moved and nothing was done. */
  unchanged: boolean;
  servicesWritten: number;
  linesWritten: number;
  autoMatched: number;
  unmatched: number;
  skipped: { at: string; reason: string }[];
}

/** `app_setting` key holding the last sourceHash seen for a month. */
function hashKey(month: string): string {
  return `feed_hash:${month}`;
}

async function readSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM app_setting WHERE key = ?`).bind(key).first<{ value: string | null }>();
  return row?.value ?? null;
}

export async function writeSetting(db: D1Database, key: string, value: string, who: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_setting (key, value, updated_by) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         value = excluded.value, updated_by = excluded.updated_by,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
    )
    .bind(key, value, who)
    .run();
}

/**
 * Write one month of the feed into `service` and `service_music`, matching as
 * it goes.
 *
 * Three properties this has to have, all of them about not destroying work:
 *
 *   - **Unchanged months cost nothing.** bmserviceapp publishes a `sourceHash`
 *     of the document it parsed; when it has not moved, this returns without
 *     touching the database.
 *   - **A confirmed match survives a re-fetch.** The music list is re-parsed
 *     every time the source document is touched, and James confirming forty
 *     lines must not be undone by somebody fixing a typo in the Word file. A
 *     line whose raw text is unchanged keeps its piece and its state.
 *   - **The upsert is keyed on `feed_ref`.** Re-running duplicates nothing.
 */
export async function ingestMonth(
  db: D1Database,
  read: ReadMonth,
  options: { force?: boolean; who?: string } = {}
): Promise<IngestSummary> {
  const who = options.who ?? "feed";
  const summary: IngestSummary = {
    month: read.month,
    unchanged: false,
    servicesWritten: 0,
    linesWritten: 0,
    autoMatched: 0,
    unmatched: 0,
    skipped: read.skipped,
  };

  if (read.sourceHash && !options.force) {
    const seen = await readSetting(db, hashKey(read.month));
    if (seen === read.sourceHash) {
      summary.unchanged = true;
      return summary;
    }
  }

  const [corpus, learned] = await Promise.all([loadCorpus(db), loadLearnedAliases(db)]);

  for (const service of read.services) {
    const serviceId = await upsertService(db, service);
    const written = await writeServiceMusic(db, serviceId, service, corpus, learned);
    summary.servicesWritten++;
    summary.linesWritten += written.lines;
    summary.autoMatched += written.autoMatched;
    summary.unmatched += written.unmatched;
  }

  if (read.sourceHash) await writeSetting(db, hashKey(read.month), read.sourceHash, who);

  return summary;
}

async function upsertService(db: D1Database, service: ReadService): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO service (service_date, service_time, title, designation, source, feed_ref)
       VALUES (?, ?, ?, ?, 'feed', ?)
       ON CONFLICT (feed_ref) DO UPDATE SET
         service_date = excluded.service_date,
         service_time = excluded.service_time,
         title        = excluded.title,
         designation  = excluded.designation,
         updated_at   = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       RETURNING id`
    )
    .bind(service.date, service.time, service.title, service.designation, service.feedRef)
    .first<{ id: number }>();

  if (!row) throw new Error(`The service on ${service.date} could not be saved.`);
  return row.id;
}

/**
 * Write one service's music lines, keeping any human decision already made.
 *
 * The existing rows are read first and compared on raw text. A line whose text
 * is unchanged is left exactly as it is — piece, state and all — because the
 * only way it got to 'confirmed' was somebody deciding it. A line whose text
 * *has* changed is a different line, and is re-matched from scratch.
 */
async function writeServiceMusic(
  db: D1Database,
  serviceId: number,
  service: ReadService,
  corpus: CorpusPiece[],
  learned: ReadonlyMap<string, number>
): Promise<{ lines: number; autoMatched: number; unmatched: number }> {
  const existing = await db
    .prepare(`SELECT id, slot, raw_text, piece_id, match_state, position FROM service_music WHERE service_id = ?`)
    .bind(serviceId)
    .all<ServiceMusicRow>();

  // Keyed on slot and text rather than position: the parser reordering the
  // month's fields must not look like every line having changed.
  const byText = new Map<string, ServiceMusicRow>();
  for (const row of existing.results ?? []) byText.set(`${row.slot} ${row.raw_text}`, row);

  const statements: D1PreparedStatement[] = [];
  let autoMatched = 0;
  let unmatched = 0;
  const keptIds = new Set<number>();

  for (const line of service.music) {
    const previous = byText.get(`${line.slot} ${line.rawText}`);

    if (previous) {
      keptIds.add(previous.id);
      // Same line as last time. Keep the human's decision; only the running
      // order can have moved.
      if (previous.position !== line.position) {
        statements.push(
          db.prepare(`UPDATE service_music SET position = ? WHERE id = ?`).bind(line.position, previous.id)
        );
      }
      if (previous.match_state === "auto") autoMatched++;
      else if (previous.match_state === "unmatched") unmatched++;
      continue;
    }

    const match = matchLine(line.rawText, line.slot, corpus, learned);
    const state = match ? match.state : "unmatched";
    if (match) autoMatched++;
    else if (isMatchable(line.slot)) unmatched++;

    statements.push(
      db
        .prepare(
          `INSERT INTO service_music (service_id, slot, raw_text, piece_id, match_state, position)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (service_id, slot, position) DO UPDATE SET
             raw_text    = excluded.raw_text,
             piece_id    = excluded.piece_id,
             match_state = excluded.match_state`
        )
        .bind(serviceId, line.slot, line.rawText, match?.pieceId ?? null, state, line.position)
    );
  }

  // A line the list no longer carries is gone from the service. Removing it is
  // right — the music list is the truth about what is being sung — but only
  // when it was the feed's line to begin with.
  for (const row of existing.results ?? []) {
    if (!keptIds.has(row.id) && !service.music.some((l) => l.position === row.position && l.slot === row.slot)) {
      statements.push(db.prepare(`DELETE FROM service_music WHERE id = ?`).bind(row.id));
    }
  }

  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }

  return { lines: service.music.length, autoMatched, unmatched };
}

/**
 * Candidate pieces for an admin correcting a line by hand.
 *
 * A plain search over composer, title and alias — the admin knows what they are
 * looking for far better than the matcher does, so this gets out of the way.
 */
export async function matchCandidates(
  db: D1Database,
  query: string,
  limit = 12
): Promise<{ id: number; title: string; composer: string; accession: string | null }[]> {
  const q = query.trim();
  if (!q) return [];
  const composerLike = `%${canonicalComposer(q)}%`;
  const titleLike = `%${canonicalTitle(q)}%`;

  const rows = await db
    .prepare(
      `SELECT DISTINCT p.id, p.title, p.composer, p.accession
         FROM piece p
         LEFT JOIN alias a ON a.piece_id = p.id
        WHERE p.composer_canonical LIKE ?
           OR REPLACE(LOWER(p.title), '''', '') LIKE ?
           OR a.alt_canonical LIKE ?
        ORDER BY p.composer_canonical, p.title
        LIMIT ?`
    )
    .bind(composerLike, `%${q.toLowerCase()}%`, titleLike, Math.min(Math.max(limit, 1), 50))
    .all<{ id: number; title: string; composer: string; accession: string | null }>();

  return rows.results ?? [];
}

/** Slots the interface shows a heading for, in service order. */
export const SLOT_LABEL: Record<string, string> = {
  responses: "Responses",
  psalm: "Psalm",
  introit: "Introit",
  canticles: "Canticles",
  setting: "Setting",
  anthem: "Anthem",
  motet: "Motet",
  voluntary: "Voluntary",
  hymn: "Hymn",
  other: "Also",
};

export function slotLabel(slot: string): string {
  return SLOT_LABEL[slot] ?? slot;
}

export type { Slot };
