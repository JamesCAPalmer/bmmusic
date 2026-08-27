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
