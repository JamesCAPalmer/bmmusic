/**
 * The seed importer: `data/seed/bm-music-draft-index.csv` → `piece` + `alias`.
 *
 * The CSV is a *draft index*, read off photographs of the parcel and box labels
 * in the song school. Its `confidence` and `flags` columns mean what they say,
 * and its `category` column uses loose words ("setting", "major work") rather
 * than the catalogue's codes. So the importer's job is not to produce a
 * finished catalogue: it is to get the draft into the database in a shape a
 * human can work through, with every uncertainty carried across rather than
 * quietly resolved. Nothing it writes is presented to the choir as settled fact
 * until somebody confirms it in the review queue.
 *
 * **Idempotency is the property that matters.** James will re-photograph the
 * shelves, produce a better cut of the CSV, and run this again. So:
 *
 *   - Rows are keyed on `legacy_ref` (the CSV's "D-001"), which carries a
 *     unique index. Re-running never duplicates a piece or an alias.
 *   - A piece nobody has reviewed yet is refreshed from the new CSV.
 *   - A piece somebody *has* reviewed is left completely alone. A better
 *     photograph must not undo somebody's afternoon in a cold song school.
 *
 * Splitting the planning (pure, tested) from the applying (D1) is what makes
 * the first of those testable against the real committed file.
 */

import { CHURCH } from "./church.config";
import { parseCsvObjects } from "./csv";
import { canonicalComposer, canonicalTitle, readSeasons, splitTitles } from "./normalise";

/** Below this, the draft row says so itself and a human should look. */
const LOW_CONFIDENCE = 0.8;

/** The columns the importer needs. Others in the file are ignored. */
const REQUIRED_COLUMNS = ["ref", "composer", "titles", "category"] as const;

export class SeedError extends Error {}

/** One row of the draft index, as read. */
export interface SeedRow {
  ref: string;
  composer: string;
  /** v2: the composer written out ("Gregorio Allegri"). Empty in a v1 cut. */
  composer_full: string;
  /** v2: surname alone, for filing order and the label. Empty in a v1 cut. */
  surname: string;
  /** v2: semicolon-joined season tags. Empty in a v1 cut, and for most rows. */
  season: string;
  titles: string;
  category: string;
  handwritten: string;
  confidence: string;
  source_photos: string;
  flags: string;
}

/** A piece ready to be written, with its aliases. */
export interface DraftPiece {
  legacyRef: string;
  composer: string;
  composerCanonical: string;
  /** The composer written out, where the index gave one. */
  composerFull: string | null;
  /** Surname alone, where the index gave one. Proper case, not capitals. */
  surname: string | null;
  /** Recognised season tags, ";"-joined in church-year order. */
  season: string | null;
  /** The joined title, verbatim as printed on the parcel. */
  title: string;
  category: string;
  notes: string | null;
  /** Semicolon-joined reasons a human should look, or null when settled. */
  reviewFlag: string | null;
  /** One per title on a multi-title parcel. Empty when there is only one. */
  aliases: { altName: string; altCanonical: string }[];
}

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------

/**
 * The draft index's categories are the words whoever read the labels wrote
 * down; the catalogue's are the eight codes in `church.config`. Three map
 * straight across. The rest need the title to decide, and where the title does
 * not settle it the row is mapped to the likeliest code *and flagged*, so the
 * guess is visible in the review queue rather than buried.
 *
 * Kept in step with `docs/PIPELINE.md`, which explains the mapping to James.
 */
const DIRECT_CATEGORY: Record<string, string> = {
  anthem: "A",
  carol: "X",
  responses: "R",
  psalm: "P",
  "psalm chant": "P",
};

/** Titles that place a canticle at Mattins rather than Evensong. */
const MORNING_CANTICLE = /\b(te deum|benedictus|jubilate|venite|benedicite)\b/i;
/** Titles that place a canticle at Evensong. */
const EVENING_CANTICLE = /\b(mag|magnificat|nunc|dimittis|evening service|evening canticles)\b/i;
/** Titles that make a "setting" a communion setting rather than canticles. */
const COMMUNION_SETTING = /\b(mass|missa|eucharist|communion|kyrie|sanctus|agnus dei|benedictus qui venit)\b/i;

export interface CategoryDecision {
  code: string;
  /** True when the title, not the CSV, decided it — or when nothing did. */
  inferred: boolean;
  /** Why, for the review flag. Null when the CSV said it outright. */
  reason: string | null;
}

/** Map a draft category (plus its titles, which often settle it) onto a code. */
export function mapCategory(rawCategory: string, titles: string): CategoryDecision {
  const cat = rawCategory.trim().toLowerCase();
  const direct = DIRECT_CATEGORY[cat];
  if (direct) return { code: direct, inferred: false, reason: null };

  if (cat === "canticle") {
    if (MORNING_CANTICLE.test(titles)) {
      return { code: "M", inferred: true, reason: "category read as morning canticles from the title" };
    }
    if (EVENING_CANTICLE.test(titles)) {
      return { code: "E", inferred: true, reason: "category read as evening canticles from the title" };
    }
    return { code: "E", inferred: true, reason: "draft category 'canticle' — morning or evening not established" };
  }

  if (cat === "setting") {
    if (COMMUNION_SETTING.test(titles)) {
      return { code: "C", inferred: true, reason: "category read as a communion setting from the title" };
    }
    // Nearly every "setting" in the boxes is a Mag and Nunc — they are filed
    // by key ("in E flat"), which is an Evensong habit — but "nearly every" is
    // a guess, so it is flagged as one.
    return { code: "E", inferred: true, reason: "draft category 'setting' — assumed evening canticles" };
  }

  if (cat === "major work" || cat === "collection" || cat === "hymn") {
    return { code: "S", inferred: true, reason: `draft category '${cat}' has no exact code — filed under solo/other` };
  }

  return {
    code: "S",
    inferred: true,
    reason: cat ? `draft category '${cat}' not recognised — filed under solo/other` : "no draft category — filed under solo/other",
  };
}

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

/** Read the CSV text into rows, checking the columns are the ones expected. */
export function parseSeedCsv(text: string): SeedRow[] {
  const objects = parseCsvObjects(text);
  const first = objects[0];
  if (!first) throw new SeedError("That file has a header but no rows.");

  const missing = REQUIRED_COLUMNS.filter((col) => !(col in first));
  if (missing.length) {
    throw new SeedError(
      `That file is missing the ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}. ` +
        `The draft index needs: ${REQUIRED_COLUMNS.join(", ")}.`
    );
  }

  return objects.map((o) => ({
    ref: o.ref ?? "",
    composer: o.composer ?? "",
    // v2 columns. A v1 cut has none of these; empty is the right reading of
    // "the file did not say", and the piece keeps a NULL rather than a guess.
    composer_full: o.composer_full ?? "",
    surname: o.surname ?? "",
    season: o.season ?? "",
    titles: o.titles ?? "",
    category: o.category ?? "",
    handwritten: o.handwritten ?? "",
    confidence: o.confidence ?? "",
    source_photos: o.source_photos ?? "",
    flags: o.flags ?? "",
  }));
}

/** Turn one draft row into a piece, carrying its uncertainty with it. */
export function toDraftPiece(row: SeedRow): DraftPiece {
  const titlesRaw = row.titles.trim();
  const parts = splitTitles(titlesRaw);
  const decision = mapCategory(row.category, titlesRaw);

  const reasons: string[] = [];

  const confidence = Number(row.confidence);
  if (Number.isFinite(confidence) && confidence < LOW_CONFIDENCE) {
    reasons.push(`draft confidence ${confidence.toFixed(2)}`);
  }
  // The CSV's own flags are somebody's note to themselves; they belong in front
  // of a human unchanged.
  for (const flag of row.flags.split(";").map((f) => f.trim()).filter(Boolean)) {
    reasons.push(`label note: ${flag}`);
  }
  if (decision.inferred && decision.reason) reasons.push(decision.reason);

  // A season tag outside the vocabulary is somebody's shorthand, and throwing
  // it away would lose the only note anybody made about when this is sung. It
  // goes in front of a human instead, with the word they actually wrote.
  const seasons = readSeasons(row.season);
  for (const tag of seasons.unknown) {
    reasons.push(`season "${tag}" is not one of the tags we use`);
  }

  if (!titlesRaw) reasons.push("no title read from the label");
  if (!row.composer.trim()) reasons.push("no composer read from the label");
  // A trailing "?" is the cataloguer saying they could not read it.
  if (/\?/.test(row.composer)) reasons.push("composer uncertain on the label");

  const noteParts: string[] = [];
  if (row.source_photos.trim()) noteParts.push(`Label photo ${row.source_photos.trim()}`);
  if (row.handwritten.trim() === "yes") noteParts.push("handwritten label");
  else if (row.handwritten.trim() === "mixed") noteParts.push("part-printed, part-handwritten label");

  // A multi-title parcel keeps its joined title (that is what is written on the
  // parcel) and gains one alias per title, so a music list naming just one of
  // them still finds it.
  const aliases =
    parts.length > 1
      ? parts.map((t) => ({ altName: t, altCanonical: canonicalTitle(t) })).filter((a) => a.altCanonical !== "")
      : [];

  return {
    legacyRef: row.ref.trim(),
    composer: row.composer.trim() || "Unknown",
    composerCanonical: canonicalComposer(row.composer) || "unknown",
    composerFull: row.composer_full.trim() || null,
    surname: row.surname.trim() || null,
    season: seasons.tags.length ? seasons.tags.join(";") : null,
    title: titlesRaw || "(no title read)",
    category: decision.code,
    notes: noteParts.length ? noteParts.join("; ") : null,
    reviewFlag: reasons.length ? reasons.join("; ") : null,
    aliases: dedupeAliases(aliases),
  };
}

/** Two parts of a parcel occasionally fold to the same key; keep the first. */
function dedupeAliases(
  aliases: { altName: string; altCanonical: string }[]
): { altName: string; altCanonical: string }[] {
  const seen = new Set<string>();
  return aliases.filter((a) => (seen.has(a.altCanonical) ? false : (seen.add(a.altCanonical), true)));
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** The piece columns the plan compares, to tell "updated" from "unchanged". */
export interface ExistingPiece {
  id: number;
  legacy_ref: string;
  composer: string;
  composer_canonical: string;
  composer_full: string | null;
  surname: string | null;
  season: string | null;
  title: string;
  category: string;
  notes: string | null;
  review_flag: string | null;
  reviewed_at: string | null;
}

export interface ImportPlan {
  insert: DraftPiece[];
  update: { id: number; draft: DraftPiece }[];
  /** Reviewed by a human — left alone entirely. */
  skippedReviewed: DraftPiece[];
  /** Already present and identical: nothing to write. */
  unchanged: DraftPiece[];
  /** Rows the file itself could not offer, with why. */
  rejected: { ref: string; reason: string }[];
}

/**
 * Work out what re-running the importer against this file would do, without
 * doing any of it.
 *
 * Duplicate refs within one file are rejected rather than merged: two rows
 * claiming "D-042" means the file is wrong, and picking one silently would
 * hide that.
 */
export function planImport(drafts: DraftPiece[], existing: ExistingPiece[]): ImportPlan {
  const byRef = new Map(existing.map((e) => [e.legacy_ref, e]));
  const plan: ImportPlan = { insert: [], update: [], skippedReviewed: [], unchanged: [], rejected: [] };
  const seenRefs = new Set<string>();

  for (const draft of drafts) {
    if (!draft.legacyRef) {
      plan.rejected.push({ ref: "(blank)", reason: "the row has no ref, so it cannot be matched on a re-run" });
      continue;
    }
    if (seenRefs.has(draft.legacyRef)) {
      plan.rejected.push({ ref: draft.legacyRef, reason: "the same ref appears more than once in the file" });
      continue;
    }
    seenRefs.add(draft.legacyRef);

    const current = byRef.get(draft.legacyRef);
    if (!current) {
      plan.insert.push(draft);
    } else if (current.reviewed_at) {
      plan.skippedReviewed.push(draft);
    } else if (matches(current, draft)) {
      plan.unchanged.push(draft);
    } else {
      plan.update.push({ id: current.id, draft });
    }
  }

  return plan;
}

function matches(current: ExistingPiece, draft: DraftPiece): boolean {
  return (
    current.composer === draft.composer &&
    current.composer_canonical === draft.composerCanonical &&
    (current.composer_full ?? null) === draft.composerFull &&
    (current.surname ?? null) === draft.surname &&
    (current.season ?? null) === draft.season &&
    current.title === draft.title &&
    current.category === draft.category &&
    (current.notes ?? null) === draft.notes &&
    (current.review_flag ?? null) === draft.reviewFlag
  );
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export interface ImportSummary {
  inserted: number;
  updated: number;
  unchanged: number;
  skippedReviewed: number;
  rejected: { ref: string; reason: string }[];
  aliasesWritten: number;
  total: number;
}

/**
 * Import the draft index into D1.
 *
 * Statements go through `db.batch`, which D1 runs in one implicit transaction,
 * so a failure part-way leaves the catalogue as it was rather than half-imported.
 * Batches are chunked because a whole file's worth of statements is more than
 * one batch should carry.
 */
export async function importSeed(db: D1Database, csvText: string): Promise<ImportSummary> {
  const drafts = parseSeedCsv(csvText).map(toDraftPiece);

  const existing = await db
    .prepare(
      `SELECT id, legacy_ref, composer, composer_canonical, composer_full, surname, season,
              title, category, notes, review_flag, reviewed_at
         FROM piece WHERE legacy_ref IS NOT NULL`
    )
    .all<ExistingPiece>();

  const plan = planImport(drafts, existing.results ?? []);

  const insertPiece = db.prepare(
    `INSERT INTO piece (composer, composer_canonical, composer_full, surname, season,
                        title, category, legacy_ref, notes, review_flag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (legacy_ref) DO NOTHING`
  );
  const updatePiece = db.prepare(
    `UPDATE piece
        SET composer = ?, composer_canonical = ?, composer_full = ?, surname = ?, season = ?,
            title = ?, category = ?, notes = ?, review_flag = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ? AND reviewed_at IS NULL`
  );

  const statements: D1PreparedStatement[] = [];
  for (const d of plan.insert) {
    statements.push(
      insertPiece.bind(
        d.composer,
        d.composerCanonical,
        d.composerFull,
        d.surname,
        d.season,
        d.title,
        d.category,
        d.legacyRef,
        d.notes,
        d.reviewFlag
      )
    );
  }
  for (const { id, draft: d } of plan.update) {
    statements.push(
      updatePiece.bind(
        d.composer,
        d.composerCanonical,
        d.composerFull,
        d.surname,
        d.season,
        d.title,
        d.category,
        d.notes,
        d.reviewFlag,
        id
      )
    );
  }
  await runBatched(db, statements);

  // Aliases are written after the pieces, because the inserted rows' ids are
  // only knowable once they exist. Seed-derived aliases are replaced wholesale
  // for the rows this run touched, so a corrected title in a new cut does not
  // leave the old spelling behind as a match.
  const touched = [...plan.insert, ...plan.update.map((u) => u.draft)];
  const aliasesWritten = await syncSeedAliases(db, touched);

  return {
    inserted: plan.insert.length,
    updated: plan.update.length,
    unchanged: plan.unchanged.length,
    skippedReviewed: plan.skippedReviewed.length,
    rejected: plan.rejected,
    aliasesWritten,
    total: drafts.length,
  };
}

/** Replace the `seed-title` aliases of the given pieces with the current ones. */
async function syncSeedAliases(db: D1Database, drafts: DraftPiece[]): Promise<number> {
  const withAliases = drafts.filter((d) => d.aliases.length > 0);
  if (!withAliases.length) return 0;

  const refs = withAliases.map((d) => d.legacyRef);
  const idByRef = new Map<string, number>();
  for (const chunk of chunks(refs, 100)) {
    const placeholders = chunk.map(() => "?").join(",");
    const found = await db
      .prepare(`SELECT id, legacy_ref FROM piece WHERE legacy_ref IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: number; legacy_ref: string }>();
    for (const r of found.results ?? []) idByRef.set(r.legacy_ref, r.id);
  }

  const deleteSeedAliases = db.prepare(`DELETE FROM alias WHERE piece_id = ? AND source = 'seed-title'`);
  const insertAlias = db.prepare(
    `INSERT INTO alias (piece_id, alt_name, alt_canonical, source) VALUES (?, ?, ?, 'seed-title')
     ON CONFLICT (piece_id, alt_canonical) DO NOTHING`
  );

  const statements: D1PreparedStatement[] = [];
  let count = 0;
  for (const d of withAliases) {
    const pieceId = idByRef.get(d.legacyRef);
    if (pieceId === undefined) continue;
    statements.push(deleteSeedAliases.bind(pieceId));
    for (const a of d.aliases) {
      statements.push(insertAlias.bind(pieceId, a.altName, a.altCanonical));
      count++;
    }
  }
  await runBatched(db, statements);
  return count;
}

/** Seed `choir_profile` from `church.config`. Safe to re-run. */
export async function seedChoirProfiles(db: D1Database): Promise<number> {
  const stmt = db.prepare(
    `INSERT INTO choir_profile (designation, typical_singers) VALUES (?, ?)
     ON CONFLICT (designation) DO UPDATE SET
       typical_singers = excluded.typical_singers,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
  );
  const statements = CHURCH.choirs.map((c) => stmt.bind(c.designation, c.typicalSingers ?? null));
  await runBatched(db, statements);
  return statements.length;
}

const BATCH_SIZE = 50;

async function runBatched(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (const chunk of chunks(statements, BATCH_SIZE)) {
    await db.batch(chunk);
  }
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
