/**
 * Folding names down to a form worth comparing.
 *
 * Two separate jobs, deliberately kept apart:
 *
 *   - `canonicalComposer` — for sorting the catalogue and grouping a composer's
 *     parcels together. The labels were written by hand over decades, so the
 *     same composer appears as "BAIRSTOW", "Bairstow", "MAWBY?" and
 *     "ANON (16th c.)". A trailing "?" is somebody's uncertainty, not part of
 *     the name; a parenthetical is a note, not part of the name.
 *
 *   - `canonicalTitle` — for matching a music-list entry or a YouTube
 *     description against an alias. Punctuation, case, accents and a leading
 *     article all vary between sources and none of them carry meaning here.
 *
 * Both are lossy on purpose. The printed form is always kept alongside in the
 * `composer` / `title` / `alt_name` columns; these are only ever the key.
 */

import { CHURCH } from "./church.config";

/** Strip accents so "Fauré" and "Faure" fold together. */
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * A composer's name folded for sorting and grouping.
 *
 * "ANON (16th c.)" → "anon"; "MAWBY?" → "mawby"; "S.S. Wesley" → "s s wesley".
 */
export function canonicalComposer(raw: string): string {
  return stripDiacritics(raw)
    .toLowerCase()
    // Parentheticals are notes on the label, not part of the name.
    .replace(/\([^)]*\)/g, " ")
    // "?" is the cataloguer's doubt about the whole name; "!" never means anything.
    .replace(/[?!]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Articles that a music list drops and a label keeps, or the other way about. */
const LEADING_ARTICLE = /^(the|a|an)\s+/;

/**
 * A title folded for matching.
 *
 * "O sing joyfully!" → "o sing joyfully"; "The Lord is King" → "lord is king".
 */
export function canonicalTitle(raw: string): string {
  const folded = stripDiacritics(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return folded.replace(LEADING_ARTICLE, "").trim();
}

/**
 * Split a joined title into its parts.
 *
 * The draft index joins the titles on one parcel with ";" — 69 of its 410 rows
 * are multi-title. The joined string stays the piece's title verbatim, because
 * that is what is written on the parcel; the parts become aliases so that a
 * music list naming only one of them still finds it.
 */
export function splitTitles(joined: string): string[] {
  return joined
    .split(";")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// Season tags
// ---------------------------------------------------------------------------

const SEASON_VALUES = new Set(CHURCH.seasons.map((s) => s.value));

/**
 * Common spellings that mean a tag in the vocabulary.
 *
 * The draft index is tidy, but the admin bulk-edit box and the photo intake
 * both let somebody type a season by hand, and "Whitsun" is what half the
 * choir calls Pentecost. Folding those in here beats rejecting them.
 */
const SEASON_SYNONYMS: Record<string, string> = {
  whitsun: "pentecost",
  whitsunday: "pentecost",
  pentecoste: "pentecost",
  passion: "passiontide",
  "holy week": "holyweek",
  "all saints": "allsaints",
  allsouls: "allsaints",
  "all souls": "allsaints",
  bvm: "marian",
  mary: "marian",
  saint: "saints",
  purification: "candlemas",
  presentation: "candlemas",
  ordinary: "general",
  "ordinary time": "general",
};

export interface SeasonReading {
  /** Recognised tags, deduplicated and in the church-year order of the config. */
  tags: string[];
  /** Anything that was not a tag, kept verbatim so a human can see what it was. */
  unknown: string[];
}

/**
 * Read a semicolon-joined season string against the controlled vocabulary.
 *
 * Unrecognised tags are returned rather than dropped or coerced. The importer
 * turns them into a review flag; the database has no CHECK on the column
 * precisely so that this can happen where somebody will read about it, rather
 * than as a failed write nobody sees.
 */
export function readSeasons(raw: string | null | undefined): SeasonReading {
  const tags = new Set<string>();
  const unknown: string[] = [];

  for (const part of (raw ?? "").split(/[;,]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const folded = trimmed.toLowerCase().replace(/\s+/g, " ");
    const candidate = SEASON_SYNONYMS[folded] ?? folded.replace(/\s+/g, "");
    if (SEASON_VALUES.has(candidate)) tags.add(candidate);
    else unknown.push(trimmed);
  }

  // Church-year order, not the order somebody happened to type them in, so two
  // rows tagged the same way always render the same way.
  return { tags: CHURCH.seasons.map((s) => s.value).filter((v) => tags.has(v)), unknown };
}

/** The stored form of a season list: recognised tags, joined with ";". */
export function formatSeasons(raw: string | null | undefined): string | null {
  const { tags } = readSeasons(raw);
  return tags.length ? tags.join(";") : null;
}

/** Format an accession number: 1 → "BM-0001". */
export function formatAccession(n: number, prefix: string, digits: number): string {
  return `${prefix}${String(n).padStart(digits, "0")}`;
}

/**
 * Read the sequence number back out of an accession, or null if it is not one
 * of ours. Used to continue numbering from the highest already assigned.
 */
export function parseAccession(accession: string, prefix: string): number | null {
  if (!accession.startsWith(prefix)) return null;
  const rest = accession.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}
