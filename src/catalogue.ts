/**
 * Reading and writing the catalogue.
 *
 * All the D1 in one place, so the routes in `src/index.ts` stay a thin layer
 * over it and the pages in `src/ui.ts` never see SQL.
 */

import { CHURCH } from "./church.config";
import {
  canonicalComposer,
  canonicalTitle,
  formatAccession,
  formatSeasons,
  parseAccession,
} from "./normalise";

/** A piece as the choir sees it, with its current holding folded in. */
export interface PieceRow {
  id: number;
  accession: string | null;
  composer: string;
  composer_canonical: string;
  /** The composer written out. NULL where the draft index gave only a label. */
  composer_full: string | null;
  /** Surname alone, proper case. Capitals are the theme's business, not the data's. */
  surname: string | null;
  title: string;
  category: string;
  voicing: string | null;
  /** Semicolon-joined season tags from the config's vocabulary. */
  season: string | null;
  /** Free text from the draft index — superseded by door and shelf below. */
  location: string | null;
  /** Cupboard door, "A"–"H". */
  location_door: string | null;
  /** Shelf within that door. */
  location_shelf: number | null;
  /** 'ok' | 'none' | 'combined' — whether the parcel has a usable spine label. */
  spine_state: string | null;
  legacy_ref: string | null;
  notes: string | null;
  review_flag: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HoldingRow {
  id: number;
  piece_id: number;
  copies_total: number;
  copies_usable: number;
  condition: string;
  last_counted: string;
  counted_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface AliasRow {
  id: number;
  piece_id: number;
  alt_name: string;
  alt_canonical: string;
  source: string;
}

export interface FileRow {
  id: number;
  piece_id: number;
  r2_key: string;
  kind: string;
  pages: number | null;
  bytes: number | null;
  source_ref: string | null;
  created_at: string;
}

export interface PerformanceRow {
  id: number;
  piece_id: number;
  date: string;
  service: string | null;
  source: string;
  youtube_url: string | null;
}

/** A search hit: the piece, plus its latest count if it has ever been counted. */
export interface PieceWithHolding extends PieceRow {
  copies_total: number | null;
  copies_usable: number | null;
  condition: string | null;
  last_counted: string | null;
}

/**
 * The most recent holding per piece.
 *
 * `holding` keeps every count rather than overwriting, so "how many are there"
 * means "what did the last person to open the parcel find". Ordering by date
 * then id breaks the tie when two counts share a day.
 */
const LATEST_HOLDING = `
  SELECT h.* FROM holding h
   WHERE h.id = (
     SELECT h2.id FROM holding h2
      WHERE h2.piece_id = h.piece_id
      ORDER BY h2.last_counted DESC, h2.id DESC
      LIMIT 1
   )`;

const PIECE_WITH_HOLDING = `
  SELECT p.*, lh.copies_total, lh.copies_usable, lh.condition, lh.last_counted
    FROM piece p
    LEFT JOIN (${LATEST_HOLDING}) lh ON lh.piece_id = p.id`;

export interface SearchQuery {
  /** Free text, matched against composer, title and aliases. */
  q?: string;
  category?: string;
  voicing?: string;
  /** Only pieces still waiting for a human to confirm them. */
  unreviewedOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  pieces: PieceWithHolding[];
  total: number;
}

/**
 * Search the catalogue.
 *
 * Free text is matched three ways — the composer's folded name, the title's
 * folded form, and any alias — because somebody looking for "O sing joyfully"
 * is looking for the Batten parcel whose title is
 * "O sing joyfully; Deliver us O Lord; O praise the Lord", and somebody looking
 * for "Faure" should find "FAURÉ" without knowing where the accent is.
 *
 * Everything is bound, never interpolated: the free-text box is the one place
 * a user's typing reaches SQL.
 */
export async function searchPieces(db: D1Database, query: SearchQuery): Promise<SearchResult> {
  const where: string[] = [];
  const binds: unknown[] = [];

  const q = (query.q ?? "").trim();
  if (q) {
    const like = `%${canonicalTitle(q)}%`;
    const composerLike = `%${canonicalComposer(q)}%`;
    where.push(
      `(p.composer_canonical LIKE ?
        OR REPLACE(LOWER(p.title), '''', '') LIKE ?
        OR EXISTS (SELECT 1 FROM alias a WHERE a.piece_id = p.id AND a.alt_canonical LIKE ?)
        OR p.accession = ?)`
    );
    binds.push(composerLike, `%${q.toLowerCase()}%`, like, q.toUpperCase());
  }
  if (query.category) {
    where.push("p.category = ?");
    binds.push(query.category);
  }
  if (query.voicing) {
    where.push("LOWER(COALESCE(p.voicing,'')) LIKE ?");
    binds.push(`%${query.voicing.toLowerCase()}%`);
  }
  if (query.unreviewedOnly) {
    where.push("p.reviewed_at IS NULL");
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM piece p ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>();

  const rows = await db
    .prepare(
      `${PIECE_WITH_HOLDING} ${whereSql}
        ORDER BY p.composer_canonical, p.title
        LIMIT ? OFFSET ?`
    )
    .bind(...binds, limit, offset)
    .all<PieceWithHolding>();

  return { pieces: rows.results ?? [], total: countRow?.n ?? 0 };
}

/** One piece by id, with its latest holding. */
export async function getPiece(db: D1Database, id: number): Promise<PieceWithHolding | null> {
  return db.prepare(`${PIECE_WITH_HOLDING} WHERE p.id = ?`).bind(id).first<PieceWithHolding>();
}

/** One piece by accession number, for the volunteer portal's lookup. */
export async function getPieceByAccession(
  db: D1Database,
  accession: string
): Promise<PieceWithHolding | null> {
  return db
    .prepare(`${PIECE_WITH_HOLDING} WHERE p.accession = ?`)
    .bind(accession.trim().toUpperCase())
    .first<PieceWithHolding>();
}

export interface PieceDetail {
  piece: PieceWithHolding;
  aliases: AliasRow[];
  holdings: HoldingRow[];
  files: FileRow[];
  performances: PerformanceRow[];
}

/** Everything the item page shows about one piece. */
export async function getPieceDetail(db: D1Database, id: number): Promise<PieceDetail | null> {
  const piece = await getPiece(db, id);
  if (!piece) return null;

  const [aliases, holdings, files, performances] = await Promise.all([
    db.prepare(`SELECT * FROM alias WHERE piece_id = ? ORDER BY alt_name`).bind(id).all<AliasRow>(),
    db
      .prepare(`SELECT * FROM holding WHERE piece_id = ? ORDER BY last_counted DESC, id DESC`)
      .bind(id)
      .all<HoldingRow>(),
    db.prepare(`SELECT * FROM file WHERE piece_id = ? ORDER BY kind, id`).bind(id).all<FileRow>(),
    db
      .prepare(`SELECT * FROM performance WHERE piece_id = ? ORDER BY date DESC LIMIT 50`)
      .bind(id)
      .all<PerformanceRow>(),
  ]);

  return {
    piece,
    aliases: aliases.results ?? [],
    holdings: holdings.results ?? [],
    files: files.results ?? [],
    performances: performances.results ?? [],
  };
}

/** How many pieces sit in each category, for the browse screen's headings. */
export async function categoryCounts(db: D1Database): Promise<Record<string, number>> {
  const rows = await db
    .prepare(`SELECT category, COUNT(*) AS n FROM piece GROUP BY category`)
    .all<{ category: string; n: number }>();
  const out: Record<string, number> = {};
  for (const r of rows.results ?? []) out[r.category] = r.n;
  return out;
}

export interface CatalogueStats {
  pieces: number;
  reviewed: number;
  flagged: number;
  withAccession: number;
  counted: number;
  copiesUsable: number;
  openRepairs: number;
}

/** The numbers on the admin home page. */
export async function catalogueStats(db: D1Database): Promise<CatalogueStats> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM piece) AS pieces,
         (SELECT COUNT(*) FROM piece WHERE reviewed_at IS NOT NULL) AS reviewed,
         (SELECT COUNT(*) FROM piece WHERE reviewed_at IS NULL AND review_flag IS NOT NULL) AS flagged,
         (SELECT COUNT(*) FROM piece WHERE accession IS NOT NULL) AS withAccession,
         (SELECT COUNT(DISTINCT piece_id) FROM holding) AS counted,
         (SELECT COALESCE(SUM(copies_usable),0) FROM (${LATEST_HOLDING})) AS copiesUsable,
         (SELECT COUNT(*) FROM repair_job WHERE status IN ('open','in_progress')) AS openRepairs`
    )
    .first<CatalogueStats>();

  return (
    row ?? { pieces: 0, reviewed: 0, flagged: 0, withAccession: 0, counted: 0, copiesUsable: 0, openRepairs: 0 }
  );
}

/** The review queue: unreviewed pieces, the flagged ones first. */
export async function reviewQueue(db: D1Database, limit = 50, offset = 0): Promise<SearchResult> {
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM piece WHERE reviewed_at IS NULL`)
    .first<{ n: number }>();

  const rows = await db
    .prepare(
      `${PIECE_WITH_HOLDING}
        WHERE p.reviewed_at IS NULL
        ORDER BY (p.review_flag IS NULL), p.legacy_ref, p.composer_canonical
        LIMIT ? OFFSET ?`
    )
    .bind(Math.min(Math.max(limit, 1), 200), Math.max(offset, 0))
    .all<PieceWithHolding>();

  return { pieces: rows.results ?? [], total: countRow?.n ?? 0 };
}

export interface PieceEdit {
  composer: string;
  title: string;
  category: string;
  voicing: string | null;
  season: string | null;
  location: string | null;
  notes: string | null;
  reviewFlag: string | null;
}

/**
 * Save an edit from the item editor or the review queue.
 *
 * `season` is folded to the controlled vocabulary on the way in, so a box
 * somebody typed "Whitsun" into stores "pentecost" and the feast-ahead panel
 * finds it. A word that is not a season at all stores nothing rather than
 * polluting the column — the screens offer the vocabulary as chips, so getting
 * here with free text means somebody has gone out of their way.
 */
export async function updatePiece(db: D1Database, id: number, edit: PieceEdit): Promise<void> {
  await db
    .prepare(
      `UPDATE piece
          SET composer = ?, composer_canonical = ?, title = ?, category = ?,
              voicing = ?, season = ?, location = ?, notes = ?, review_flag = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ?`
    )
    .bind(
      edit.composer,
      canonicalComposer(edit.composer),
      edit.title,
      edit.category,
      edit.voicing,
      formatSeasons(edit.season),
      edit.location,
      edit.notes,
      edit.reviewFlag,
      id
    )
    .run();
}

/**
 * Mark a piece confirmed.
 *
 * Confirming clears the review flag — the flags are reasons to look, and
 * somebody has now looked. It also takes the piece out of the seed importer's
 * reach for good, which is the point.
 */
export async function confirmPiece(db: D1Database, id: number, who: string): Promise<void> {
  await db
    .prepare(
      `UPDATE piece
          SET reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), reviewed_by = ?,
              review_flag = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ?`
    )
    .bind(who, id)
    .run();
}

/**
 * Merge one piece into another: the loser's aliases and holdings move across,
 * its title is kept as an alias, and the row itself is deleted.
 *
 * The draft index has genuine duplicates in it — the same parcel photographed
 * from two angles, or "see also REDFORD D-172" written on a label — so the
 * review queue needs a way to say "these two are one parcel".
 */
export async function mergePieces(db: D1Database, keepId: number, mergeId: number): Promise<void> {
  if (keepId === mergeId) throw new Error("A piece cannot be merged into itself.");

  const loser = await db.prepare(`SELECT * FROM piece WHERE id = ?`).bind(mergeId).first<PieceRow>();
  if (!loser) throw new Error("That piece no longer exists.");

  await db.batch([
    // The losing title becomes an alias of the survivor, so a music list naming
    // it still finds the parcel.
    db
      .prepare(
        `INSERT INTO alias (piece_id, alt_name, alt_canonical, source) VALUES (?, ?, ?, 'merge')
         ON CONFLICT (piece_id, alt_canonical) DO NOTHING`
      )
      .bind(keepId, loser.title, canonicalTitle(loser.title)),
    // Aliases that would collide with one the survivor already has are dropped
    // by the unique index rather than failing the merge.
    db
      .prepare(
        `INSERT OR IGNORE INTO alias (piece_id, alt_name, alt_canonical, source)
         SELECT ?, alt_name, alt_canonical, source FROM alias WHERE piece_id = ?`
      )
      .bind(keepId, mergeId),
    db.prepare(`UPDATE holding SET piece_id = ? WHERE piece_id = ?`).bind(keepId, mergeId),
    db.prepare(`UPDATE file SET piece_id = ? WHERE piece_id = ?`).bind(keepId, mergeId),
    db.prepare(`UPDATE OR IGNORE performance SET piece_id = ? WHERE piece_id = ?`).bind(keepId, mergeId),
    db.prepare(`UPDATE repair_job SET piece_id = ? WHERE piece_id = ?`).bind(keepId, mergeId),
    // Note on the survivor which draft row was folded in, so the trail back to
    // the source photograph survives the merge.
    db
      .prepare(
        `UPDATE piece
            SET notes = TRIM(COALESCE(notes || '; ', '') || ?),
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
          WHERE id = ?`
      )
      .bind(`merged from ${loser.legacy_ref ?? `piece ${mergeId}`}`, keepId),
    db.prepare(`DELETE FROM piece WHERE id = ?`).bind(mergeId),
  ]);
}

// ---------------------------------------------------------------------------
// Accession numbers
// ---------------------------------------------------------------------------

export interface AccessionResult {
  assigned: number;
  from: string | null;
  to: string | null;
  remaining: number;
}

/**
 * Assign accession numbers to every piece that has none, in catalogue order.
 *
 * Catalogue order is composer then title — the order somebody walking the
 * shelves with a pen would work in. Numbering continues from the highest
 * already assigned and never renumbers an existing one: an accession number is
 * written on a physical parcel, so once it is out in the world it is fixed.
 *
 * Only reviewed pieces are numbered. Numbering a draft row would mean writing a
 * number on a parcel whose composer might still be wrong.
 */
export async function assignAccessions(db: D1Database): Promise<AccessionResult> {
  const { prefix, digits } = CHURCH.accession;

  const existing = await db
    .prepare(`SELECT accession FROM piece WHERE accession IS NOT NULL`)
    .all<{ accession: string }>();

  let next = 0;
  for (const row of existing.results ?? []) {
    const n = parseAccession(row.accession, prefix);
    if (n !== null && n > next) next = n;
  }

  const pending = await db
    .prepare(
      `SELECT id FROM piece
        WHERE accession IS NULL AND reviewed_at IS NOT NULL
        ORDER BY composer_canonical, title, id`
    )
    .all<{ id: number }>();

  const rows = pending.results ?? [];
  if (!rows.length) {
    const remainingRow = await db
      .prepare(`SELECT COUNT(*) AS n FROM piece WHERE accession IS NULL`)
      .first<{ n: number }>();
    return { assigned: 0, from: null, to: null, remaining: remainingRow?.n ?? 0 };
  }

  const stmt = db.prepare(
    `UPDATE piece SET accession = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ? AND accession IS NULL`
  );
  const statements: D1PreparedStatement[] = [];
  const first = next + 1;
  for (const row of rows) {
    next += 1;
    statements.push(stmt.bind(formatAccession(next, prefix, digits), row.id));
  }
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }

  const remainingRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM piece WHERE accession IS NULL`)
    .first<{ n: number }>();

  return {
    assigned: rows.length,
    from: formatAccession(first, prefix, digits),
    to: formatAccession(next, prefix, digits),
    remaining: remainingRow?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Counting (the volunteer portal)
// ---------------------------------------------------------------------------

export interface CountSubmission {
  pieceId: number;
  copiesTotal: number;
  copiesUsable: number;
  condition: string;
  voicing: string | null;
  note: string | null;
  countedBy: string | null;
}

export interface CountOutcome {
  /** Raised because the count contradicts what was recorded, or looks wrong. */
  flags: string[];
  /** True when a repair job was opened off the back of the condition. */
  repairRaised: boolean;
}

/**
 * Record a count from the volunteer portal.
 *
 * Three things happen beyond writing the row:
 *
 *   - A count that contradicts the last one flags the piece for review rather
 *     than silently replacing it. Volunteers work in a cold room with a torch;
 *     a big disagreement is worth a second look, not a quiet overwrite.
 *   - 'poor' or 'urgent' opens a repair job, unless one is already open.
 *   - A voicing the volunteer read off the copies fills the field in if it is
 *     empty, and flags a disagreement if it is not.
 */
export async function recordCount(db: D1Database, sub: CountSubmission): Promise<CountOutcome> {
  const piece = await getPiece(db, sub.pieceId);
  if (!piece) throw new Error("That piece no longer exists.");

  const flags: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  if (piece.copies_total !== null && piece.copies_total !== sub.copiesTotal) {
    flags.push(`count changed from ${piece.copies_total} to ${sub.copiesTotal}`);
  }
  if (sub.copiesUsable < sub.copiesTotal) {
    flags.push(`${sub.copiesTotal - sub.copiesUsable} of ${sub.copiesTotal} copies not usable`);
  }
  if (sub.condition === "poor" || sub.condition === "urgent") {
    flags.push(`condition reported ${sub.condition}`);
  }
  if (sub.voicing && piece.voicing && piece.voicing.trim().toLowerCase() !== sub.voicing.trim().toLowerCase()) {
    flags.push(`voicing seen "${sub.voicing}" but catalogued "${piece.voicing}"`);
  }

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO holding (piece_id, copies_total, copies_usable, condition, last_counted, counted_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        sub.pieceId,
        sub.copiesTotal,
        sub.copiesUsable,
        sub.condition,
        today,
        sub.countedBy,
        sub.note
      ),
  ];

  // Fill in a voicing nobody had recorded; never overwrite one somebody has.
  if (sub.voicing && !piece.voicing) {
    statements.push(
      db
        .prepare(
          `UPDATE piece SET voicing = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
        )
        .bind(sub.voicing, sub.pieceId)
    );
  }

  if (flags.length) {
    statements.push(
      db
        .prepare(
          `UPDATE piece
              SET review_flag = TRIM(COALESCE(review_flag || '; ', '') || ?),
                  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
            WHERE id = ?`
        )
        .bind(`count ${today}: ${flags.join("; ")}`, sub.pieceId)
    );
  }

  await db.batch(statements);

  let repairRaised = false;
  if (sub.condition === "poor" || sub.condition === "urgent") {
    const open = await db
      .prepare(`SELECT id FROM repair_job WHERE piece_id = ? AND status IN ('open','in_progress') LIMIT 1`)
      .bind(sub.pieceId)
      .first<{ id: number }>();
    if (!open) {
      await db
        .prepare(
          `INSERT INTO repair_job (piece_id, reported_condition, volunteer, notes) VALUES (?, ?, ?, ?)`
        )
        .bind(sub.pieceId, sub.condition, sub.countedBy, sub.note)
        .run();
      repairRaised = true;
    }
  }

  return { flags, repairRaised };
}

/** Add a piece by hand (the photo-intake confirm step, and the item editor). */
export async function createPiece(
  db: D1Database,
  edit: PieceEdit & { legacyRef?: string | null }
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO piece (composer, composer_canonical, title, category, voicing, season, location, notes, review_flag, legacy_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`
    )
    .bind(
      edit.composer,
      canonicalComposer(edit.composer),
      edit.title,
      edit.category,
      edit.voicing,
      formatSeasons(edit.season),
      edit.location,
      edit.notes,
      edit.reviewFlag,
      edit.legacyRef ?? null
    )
    .first<{ id: number }>();

  if (!result) throw new Error("The piece could not be saved.");
  return result.id;
}

/** Add an alias by hand. */
export async function addAlias(db: D1Database, pieceId: number, altName: string): Promise<void> {
  const canonical = canonicalTitle(altName);
  if (!canonical) return;
  await db
    .prepare(
      `INSERT INTO alias (piece_id, alt_name, alt_canonical, source) VALUES (?, ?, ?, 'manual')
       ON CONFLICT (piece_id, alt_canonical) DO NOTHING`
    )
    .bind(pieceId, altName.trim(), canonical)
    .run();
}

/**
 * The most recently catalogued pieces, for the home screen's rail.
 *
 * Newest first by creation, and reviewed pieces only: "recently added" on a
 * chorister's home screen should not be a shop window for rows nobody has
 * checked, where the composer may still be wrong.
 */
export async function recentlyAdded(db: D1Database, limit = 8): Promise<PieceWithHolding[]> {
  const rows = await db
    .prepare(
      `${PIECE_WITH_HOLDING}
        WHERE p.reviewed_at IS NOT NULL
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ?`
    )
    .bind(Math.min(Math.max(limit, 1), 50))
    .all<PieceWithHolding>();
  return rows.results ?? [];
}

export interface ChoirProfileRow {
  id: number;
  designation: string;
  typical_singers: number | null;
}

/** Every choir designation and its size, for the RAG and the admin table. */
export async function choirProfiles(db: D1Database): Promise<ChoirProfileRow[]> {
  const rows = await db
    .prepare(`SELECT id, designation, typical_singers FROM choir_profile ORDER BY designation`)
    .all<ChoirProfileRow>();
  return rows.results ?? [];
}

/**
 * How many singers a designation usually means.
 *
 * Matched case-insensitively on the whole string. The music list publishes
 * designations we have never seen — "Symbel choir", "Liturgy Singers", and at
 * least once "RCSM" for the RSCM — and the right answer for those is NULL,
 * which the RAG renders grey. Guessing at a near match would be worse: it would
 * put a confident green tick against a number nobody has recorded.
 */
export async function typicalSingersFor(
  db: D1Database,
  designation: string | null
): Promise<number | null> {
  if (!designation) return null;
  const row = await db
    .prepare(`SELECT typical_singers FROM choir_profile WHERE LOWER(designation) = LOWER(?)`)
    .bind(designation.trim())
    .first<{ typical_singers: number | null }>();
  return row?.typical_singers ?? null;
}

// ---------------------------------------------------------------------------
// Admin search and bulk edit
// ---------------------------------------------------------------------------

export interface AdminSearch {
  q?: string;
  category?: string;
  season?: string;
  locationDoor?: string;
  /** 'yes' | 'no' — has a reference scan, or has not. */
  scanned?: string;
  /** 'flagged' | 'unreviewed' | 'reviewed'. */
  flagged?: string;
  limit?: number;
  offset?: number;
}

/** The filterable table behind the bulk editor. */
export async function adminSearchPieces(db: D1Database, search: AdminSearch): Promise<SearchResult> {
  const where: string[] = [];
  const binds: unknown[] = [];

  const q = (search.q ?? "").trim();
  if (q) {
    where.push(
      `(p.composer_canonical LIKE ?
        OR REPLACE(LOWER(p.title), '''', '') LIKE ?
        OR EXISTS (SELECT 1 FROM alias a WHERE a.piece_id = p.id AND a.alt_canonical LIKE ?))`
    );
    binds.push(`%${canonicalComposer(q)}%`, `%${q.toLowerCase()}%`, `%${canonicalTitle(q)}%`);
  }
  if (search.category) {
    where.push("p.category = ?");
    binds.push(search.category);
  }
  // Season is a semicolon-joined list, so this is a substring test. The tags are
  // a closed vocabulary with no tag a substring of another, which is what makes
  // that safe here.
  if (search.season) {
    where.push("p.season LIKE ?");
    binds.push(`%${search.season}%`);
  }
  if (search.locationDoor) {
    where.push("p.location_door = ?");
    binds.push(search.locationDoor);
  }
  if (search.scanned === "yes") {
    where.push("EXISTS (SELECT 1 FROM file f WHERE f.piece_id = p.id AND f.kind = 'reference_scan')");
  } else if (search.scanned === "no") {
    where.push("NOT EXISTS (SELECT 1 FROM file f WHERE f.piece_id = p.id AND f.kind = 'reference_scan')");
  }
  if (search.flagged === "flagged") where.push("p.review_flag IS NOT NULL");
  else if (search.flagged === "unreviewed") where.push("p.reviewed_at IS NULL");
  else if (search.flagged === "reviewed") where.push("p.reviewed_at IS NOT NULL");

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(search.limit ?? 100, 1), 300);
  const offset = Math.max(search.offset ?? 0, 0);

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM piece p ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>();

  const rows = await db
    .prepare(
      `${PIECE_WITH_HOLDING} ${whereSql}
        ORDER BY p.composer_canonical, p.title
        LIMIT ? OFFSET ?`
    )
    .bind(...binds, limit, offset)
    .all<PieceWithHolding>();

  return { pieces: rows.results ?? [], total: countRow?.n ?? 0 };
}

/** The fields a bulk edit can set. Anything left undefined is left alone. */
export interface BulkEdit {
  category?: string;
  season?: string;
  locationDoor?: string;
  locationShelf?: number;
  spineState?: string;
}

/**
 * Apply a bulk edit to a set of pieces.
 *
 * **Only fields that were actually given are touched.** A blank box in the
 * bulk-edit bar means "leave this alone", never "clear it" — getting that
 * backwards would let one careless click wipe the season tags off two hundred
 * rows, and there is no undo. Emptying a field is a deliberate act on one
 * piece's own page.
 *
 * Returns how many rows were changed, so the caller can say so and log it.
 */
export async function applyBulkEdit(db: D1Database, ids: number[], edit: BulkEdit): Promise<number> {
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (edit.category) {
    sets.push("category = ?");
    binds.push(edit.category);
  }
  if (edit.season) {
    sets.push("season = ?");
    binds.push(formatSeasons(edit.season));
  }
  if (edit.locationDoor) {
    sets.push("location_door = ?");
    binds.push(edit.locationDoor);
  }
  if (edit.locationShelf !== undefined) {
    sets.push("location_shelf = ?");
    binds.push(edit.locationShelf);
  }
  if (edit.spineState) {
    sets.push("spine_state = ?");
    binds.push(edit.spineState);
  }

  if (!sets.length || !ids.length) return 0;
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");

  let changed = 0;
  // Chunked so the IN list stays a sensible size whatever somebody ticks.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`UPDATE piece SET ${sets.join(", ")} WHERE id IN (${placeholders})`)
      .bind(...binds, ...chunk)
      .run();
    changed += result.meta?.changes ?? chunk.length;
  }
  return changed;
}

/** Add a choir designation, or update its size. */
export async function saveChoirProfile(
  db: D1Database,
  designation: string,
  typicalSingers: number | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO choir_profile (designation, typical_singers) VALUES (?, ?)
       ON CONFLICT (designation) DO UPDATE SET
         typical_singers = excluded.typical_singers,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
    )
    .bind(designation.trim(), typicalSingers)
    .run();
}

/** Set one profile's size by id, for the settings table. */
export async function setChoirSize(db: D1Database, id: number, typicalSingers: number | null): Promise<void> {
  await db
    .prepare(
      `UPDATE choir_profile SET typical_singers = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
    )
    .bind(typicalSingers, id)
    .run();
}

/** One file row, for the streaming route to resolve an id to an R2 key. */
export async function getFile(db: D1Database, id: number): Promise<FileRow | null> {
  return db.prepare(`SELECT * FROM file WHERE id = ?`).bind(id).first<FileRow>();
}
