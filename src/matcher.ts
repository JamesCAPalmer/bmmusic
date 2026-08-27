/**
 * Matching a music-list line to a parcel in the library.
 *
 * The feed gives us what the Minster published, in the shape a human wrote it:
 *
 *     anthem:    "Ave verum corpus (Wiliam Byrd)"
 *     canticles: "Charles Villiers Stanford in C"
 *     responses: "Bernard Rose"
 *     psalm:     "80 vv1-8"
 *
 * The catalogue holds what is written on the parcel, which was read off a
 * photograph of a handwritten label. Neither side is clean — note the "Wiliam"
 * above, which is in the real feed — so this is a fuzzy match, and the whole
 * design follows from admitting that:
 *
 *   - **Everything here is pure.** No D1, no fetch. The caller loads the
 *     catalogue once and passes it in, which makes every rule below testable
 *     against real lines from the real feed.
 *
 *   - **The slot decides how to read the line.** "Bernard Rose" is a composer
 *     when it is the responses and a title when it is an anthem. Guessing from
 *     the words alone would be strictly worse than reading the column heading,
 *     which the feed has already given us.
 *
 *   - **A near-miss is not a match.** Where two Stanford settings score alike,
 *     the answer is "I don't know" and a line in the admin queue — not a coin
 *     toss that quietly puts the wrong parcel on a chorister's service page.
 *
 *   - **What a human confirms is remembered.** A confirmed pair is written to
 *     `match_alias` keyed on the normalised raw text and reused outright from
 *     then on. That is what stops James confirming "Stanford in B flat" every
 *     week for the rest of his life.
 */

import { canonicalComposer, canonicalTitle } from "./normalise";

/** How the feed's fields map onto slots. Slots drive interpretation below. */
export type Slot =
  | "responses"
  | "psalm"
  | "canticles"
  | "setting"
  | "introit"
  | "anthem"
  | "motet"
  | "voluntary"
  | "hymn"
  | "other";

/**
 * Slots worth matching against the parcel library.
 *
 * A psalm is a number and a pointing, a hymn is a number in the hymn book, and
 * a voluntary is organ repertoire that lives on the organ loft rather than in
 * the song school. All three are recorded and shown, none is matched: offering
 * a parcel for "80 vv1-8" would be noise in the review queue every week.
 */
const MATCHABLE: ReadonlySet<Slot> = new Set<Slot>([
  "responses",
  "canticles",
  "setting",
  "introit",
  "anthem",
  "motet",
  "other",
]);

export function isMatchable(slot: Slot): boolean {
  return MATCHABLE.has(slot);
}

// ---------------------------------------------------------------------------
// Normalising a raw line
// ---------------------------------------------------------------------------

/**
 * The key a learned match is remembered under.
 *
 * Deliberately blunter than `canonicalTitle`: it folds the *whole* line,
 * composer and all, because what is being remembered is "this exact phrasing,
 * however the list wrote it, means that parcel". Keeping the composer in is
 * what stops "in C (Stanford)" and "in C (Wood)" collapsing onto one key.
 */
export function normaliseMatchKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Reading a line apart
// ---------------------------------------------------------------------------

/** A music-list line, read into the parts worth matching on. */
export interface ParsedLine {
  /** The title, where the line has one. */
  title: string | null;
  /** The composer, where the line names one. */
  composer: string | null;
  /** "E flat", "C", "D minor" — a setting filed by key rather than by title. */
  key: string | null;
}

/** "(Wiliam Byrd)" at the end of a line — the feed's usual way of saying who. */
const TRAILING_PARENTHETICAL = /^(.*?)\s*\(([^()]*)\)\s*$/;

/**
 * "Charles Villiers Stanford in C", "Herbert Brewer in D minor".
 *
 * Anchored on a real key name rather than any word after "in", so that
 * "Jesu, joy of man's desiring in the arrangement by..." is not read as a
 * composer called "Jesu, joy of man's desiring".
 */
const COMPOSER_IN_KEY = /^(.+?)\s+in\s+([A-G](?:\s*(?:flat|sharp|b|#))?(?:\s+(?:major|minor))?)\s*$/i;

/** A hymn or psalm reference: digits, optionally with verses. Never a title. */
const NUMERIC_REFERENCE = /^\d+\s*(?:[a-z]*\s*[\d\s,–—-]*(?:vv?\.?\s*[\d\s,–—-]+)?)?$/i;

/**
 * Read one music-list line, using the slot to decide what its words mean.
 *
 * The same string means different things in different columns, and the feed has
 * already told us which column it came from — so this reads the heading rather
 * than trying to out-guess it.
 */
export function parseMusicLine(raw: string, slot: Slot): ParsedLine {
  const line = raw.trim();
  if (!line) return { title: null, composer: null, key: null };

  // Responses are published as a composer's name and nothing else: the
  // Minster does not print "Preces and Responses (Bernard Rose)", it prints
  // "Bernard Rose". Reading that as a title would match nothing, every week.
  if (slot === "responses") {
    const parenthesised = TRAILING_PARENTHETICAL.exec(line);
    if (parenthesised) return { title: parenthesised[1]!.trim() || null, composer: parenthesised[2]!.trim(), key: null };
    return { title: null, composer: line, key: null };
  }

  if (slot === "psalm" || slot === "hymn") {
    return { title: null, composer: null, key: null };
  }

  const parenthesised = TRAILING_PARENTHETICAL.exec(line);
  if (parenthesised) {
    const head = parenthesised[1]!.trim();
    const inside = parenthesised[2]!.trim();
    // "King's College Service (Joanna Forbes L'Estrange)" — title, then who.
    // A head that is itself "<composer> in <key>" keeps its key: the feed
    // writes "Stanford in C (Charles Villiers Stanford)" often enough.
    const keyed = COMPOSER_IN_KEY.exec(head);
    if (keyed) return { title: head, composer: inside, key: keyed[2]!.trim() };
    return { title: head || null, composer: inside || null, key: null };
  }

  const keyed = COMPOSER_IN_KEY.exec(line);
  if (keyed) {
    // "Charles Villiers Stanford in C" — the composer leads and the key is the
    // whole identity of the piece. There is no title to match on at all, which
    // is exactly why canticles are the hardest slot.
    return { title: null, composer: keyed[1]!.trim(), key: keyed[2]!.trim() };
  }

  if (NUMERIC_REFERENCE.test(line)) return { title: null, composer: null, key: null };

  return { title: line, composer: null, key: null };
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/** One catalogue entry, flattened into the forms the matcher compares. */
export interface CorpusPiece {
  id: number;
  /** Every title this parcel is known by: its own, plus its aliases. */
  titles: string[];
  /** Composer as printed, written out, and surname — whichever exist. */
  composers: string[];
}

/** A piece and why it was chosen, for the admin queue to explain itself. */
export interface MatchResult {
  pieceId: number;
  /** 0–1. Above the threshold and clear of the runner-up, or it is not a match. */
  score: number;
  /** 'confirmed' when a human has already taught us this phrasing. */
  state: "auto" | "confirmed";
}

/**
 * How good a match has to be before it is offered at all.
 *
 * Set by walking the real feed against the real catalogue: below this the
 * proposals were mostly two pieces that share a common word ("O praise the
 * Lord"), which cost more to reject than to match by hand.
 */
const SCORE_THRESHOLD = 0.55;

/**
 * How far the winner must beat the runner-up.
 *
 * The library holds several Stanford evening services. When two of them score
 * alike the honest answer is "I don't know", and an unmatched line an admin
 * taps once is far cheaper than a wrong parcel on a chorister's service page
 * that nobody notices until the rehearsal.
 */
const CLEAR_MARGIN = 0.08;

/** Words that carry no matching signal but appear in half the titles. */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "and", "o", "for", "to", "is", "on", "my", "our", "with", "be", "us", "thy",
]);

function tokens(text: string): Set<string> {
  return new Set(
    canonicalTitle(text)
      .split(" ")
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

/**
 * How much of what the music list said this parcel accounts for.
 *
 * Directional on purpose, and the direction was wrong first time round. Scoring
 * against the *shorter* of the two sides let a three-word line match a two-word
 * parcel on one shared word — which is how "Lord, I trust thee (Handel)" came
 * to point at a different Handel parcel entirely in a dry run over four real
 * months of the feed.
 *
 * Measuring against the line's own words instead asks the question that
 * matters: is everything the list named actually in this parcel's title? That
 * keeps "Abendlied" matching a parcel catalogued "Abendlied (Op. 69 No. 3)",
 * where the extra words are the library's cataloguing rather than a different
 * piece, while a line sharing one word out of four falls well short.
 */
function overlap(line: Set<string>, candidate: Set<string>): number {
  if (!line.size || !candidate.size) return 0;
  let shared = 0;
  for (const t of line) if (candidate.has(t)) shared++;
  return shared / line.size;
}

/**
 * Does this piece's composer appear in the line's composer?
 *
 * One-directional containment on purpose. The feed writes composers out
 * ("Charles Villiers Stanford"); the parcel label shouts a surname
 * ("STANFORD"). The surname must appear in the feed's name, not the other way
 * about, or every parcel labelled with a common surname matches everything.
 */
function composerMatches(lineComposer: string, pieceComposers: string[]): boolean {
  const line = canonicalComposer(lineComposer);
  if (!line) return false;
  const lineTokens = new Set(line.split(" ").filter(Boolean));

  for (const candidate of pieceComposers) {
    const folded = canonicalComposer(candidate);
    if (!folded) continue;
    if (folded === line) return true;
    // Every word of the parcel's composer appears somewhere in the feed's.
    const parts = folded.split(" ").filter((p) => p.length > 1);
    if (parts.length && parts.every((p) => lineTokens.has(p))) return true;
  }
  return false;
}

/**
 * Does this parcel's title carry the key the line asked for?
 *
 * A substring test is not good enough and was wrong here first time round: a
 * bare "C" appears inside "evening servi**c**e", so every setting matched every
 * key and the matcher declined every canticle it should have got right.
 *
 * So the comparison is on words. The parcel's key is whatever follows the last
 * "in" in its title, and the line's key has to be that, or the start of it —
 * which lets "Stanford in C" match a parcel catalogued "…in C major" while
 * still keeping "in C" clear of "in B flat".
 */
function titleCarriesKey(title: string, key: string): boolean {
  const titleTokens = canonicalTitle(title).split(" ").filter(Boolean);
  const keyTokens = canonicalTitle(key).split(" ").filter(Boolean);
  if (!keyTokens.length) return false;

  const lastIn = titleTokens.lastIndexOf("in");
  const titleKey = lastIn >= 0 ? titleTokens.slice(lastIn + 1) : [];
  if (!titleKey.length) return false;

  return keyTokens.every((token, i) => titleKey[i] === token);
}

/**
 * Score one candidate against one parsed line, 0–1.
 *
 * Composer and title are weighted differently by design. A title match with the
 * wrong composer is usually a different setting of the same words, which is a
 * real and common trap ("Ave verum corpus" is in the library four times over).
 * A composer match with no title is how canticles arrive and has to be worth
 * something on its own — but never enough to win by itself.
 */
export function scoreCandidate(parsed: ParsedLine, piece: CorpusPiece): number {
  const composerHit = parsed.composer ? composerMatches(parsed.composer, piece.composers) : false;

  let titleScore = 0;
  if (parsed.title) {
    const lineTokens = tokens(parsed.title);
    const lineCanonical = canonicalTitle(parsed.title);
    for (const title of piece.titles) {
      // An exact fold is as good as it gets and short-circuits the rest.
      if (lineCanonical && canonicalTitle(title) === lineCanonical) {
        titleScore = 1;
        break;
      }
      titleScore = Math.max(titleScore, overlap(lineTokens, tokens(title)));
    }
  }

  // A key ("in C") only counts once a composer already matches: on its own it
  // would match every setting in the library that happens to be in that key.
  const keyHit =
    composerHit && parsed.key ? piece.titles.some((t) => titleCarriesKey(t, parsed.key!)) : false;

  if (parsed.title && parsed.composer) {
    // Both known, so both have to agree. The composer alone is worth 0.30 —
    // real, but never enough on its own to clear the threshold, because the
    // library holds several parcels by every composer the Minster sings often.
    // That weighting is what stops "O for a closer walk with God (Stanford)"
    // settling on whichever Stanford parcel shares a stray word.
    //
    // A composer that is published and does *not* match caps out at 0.50 and so
    // can never match at all: the right words by the wrong composer is a
    // different setting of the same text, which the library genuinely holds
    // four of in the case of "Ave verum corpus".
    return composerHit ? 0.3 + 0.7 * titleScore : 0.5 * titleScore;
  }
  if (parsed.composer) {
    // Canticles and responses: the composer is all there is.
    if (!composerHit) return 0;
    return keyHit ? 0.9 : 0.6;
  }
  // Title alone, no composer published.
  return 0.8 * titleScore;
}

/**
 * Pick a match for one line, or decline.
 *
 * `learned` is the `match_alias` table keyed on the normalised raw text. A hit
 * there is returned outright as 'confirmed': a human has already looked at this
 * exact phrasing and said what it is, and asking them again is the one thing
 * this feature exists to stop.
 */
export function matchLine(
  raw: string,
  slot: Slot,
  corpus: CorpusPiece[],
  learned: ReadonlyMap<string, number> = new Map()
): MatchResult | null {
  if (!isMatchable(slot)) return null;

  const remembered = learned.get(normaliseMatchKey(raw));
  if (remembered !== undefined) return { pieceId: remembered, score: 1, state: "confirmed" };

  const parsed = parseMusicLine(raw, slot);
  if (!parsed.title && !parsed.composer) return null;

  let best: { piece: CorpusPiece; score: number } | null = null;
  let runnerUp = 0;

  for (const piece of corpus) {
    const score = scoreCandidate(parsed, piece);
    if (!best || score > best.score) {
      if (best) runnerUp = best.score;
      best = { piece, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (!best || best.score < SCORE_THRESHOLD) return null;
  if (best.score - runnerUp < CLEAR_MARGIN) return null;

  return { pieceId: best.piece.id, score: best.score, state: "auto" };
}
