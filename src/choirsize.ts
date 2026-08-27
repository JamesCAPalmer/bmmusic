/**
 * How many people a music-list designation actually means.
 *
 * This is what turns the copies RAG from grey into a colour. The music list
 * publishes prose — "Boys and SATB", "Consort, Girls and SATB", "ATB" — and the
 * RAG needs a number of singers to divide into the usable copy count.
 *
 * The sections and their sizes live in `church.config.ts` (from the September
 * 2026 team list and the Director of Junior Choir's own count). This module is
 * the pure arithmetic on top, so every rule below can be tested against the
 * designations the feed really publishes.
 *
 * **Two decisions worth stating plainly, because both are about which way to be
 * wrong.**
 *
 * *Overestimating is safer than underestimating.* If we say more singers than
 * turn up, the RAG cries "not enough copies" and somebody checks — mildly
 * annoying. If we say fewer, the RAG says "enough" and a chorister arrives at a
 * rehearsal with no copy. So where a reading is genuinely ambiguous, this leans
 * high.
 *
 * *An unknown group makes the whole answer unknown.* A designation naming a
 * visiting choir — "Symbel choir", "Liturgy Singers", "Clerkes of All Saints",
 * or "Consort, Girls and SATB **with Young Voices**" — cannot be counted,
 * because nobody here knows how many they are bringing. Returning the part we
 * *can* count would be worse than returning nothing: it would produce a
 * confident green against a number that is certainly too low. So those come
 * back null, and the RAG shows grey.
 */

import { CHURCH } from "./church.config";

const { boys, girls, consort, teamA, teamB } = CHURCH.choirSections;

const teamTotal = (team: { soprano: number; alto: number; tenor: number; bass: number }) =>
  team.soprano + team.alto + team.tenor + team.bass;

/** Every adult, both teams. */
export const ADULTS = {
  soprano: teamA.soprano + teamB.soprano,
  alto: teamA.alto + teamB.alto,
  tenor: teamA.tenor + teamB.tenor,
  bass: teamA.bass + teamB.bass,
};

export const TEAM_A_TOTAL = teamTotal(teamA);
export const TEAM_B_TOTAL = teamTotal(teamB);
export const ADULT_TOTAL = TEAM_A_TOTAL + TEAM_B_TOTAL;
/** Everyone who sings from a copy: the three children's choirs plus the adults. */
export const FULL_CHOIR_TOTAL = boys + girls + consort + ADULT_TOTAL;

/**
 * The groups a designation can name, longest phrase first.
 *
 * Order matters and is load-bearing: "SATB" must be matched and consumed before
 * "ATB" is looked for, or every SATB service would be read as ATB and lose the
 * sopranos. Likewise "Full Choir" before "Choir".
 */
interface Group {
  /** Phrases that mean this group, all lower case. */
  phrases: string[];
  singers: number;
}

const GROUPS: Group[] = [
  // Whole-choir phrases first — they subsume everything else.
  { phrases: ["full choir", "bglm"], singers: FULL_CHOIR_TOTAL },

  // Adults. "satb" before "atb", and both before the bare voice parts.
  { phrases: ["satb"], singers: ADULT_TOTAL },
  { phrases: ["atb"], singers: ADULTS.alto + ADULTS.tenor + ADULTS.bass },
  { phrases: ["men's voices", "mens voices", "men"], singers: ADULTS.tenor + ADULTS.bass },
  { phrases: ["team a"], singers: TEAM_A_TOTAL },
  { phrases: ["team b"], singers: TEAM_B_TOTAL },
  { phrases: ["sopranos", "soprano"], singers: ADULTS.soprano },
  { phrases: ["altos", "alto"], singers: ADULTS.alto },
  { phrases: ["tenors", "tenor"], singers: ADULTS.tenor },
  { phrases: ["basses", "bass"], singers: ADULTS.bass },

  // Children.
  { phrases: ["consort"], singers: consort },
  { phrases: ["girls"], singers: girls },
  { phrases: ["boys"], singers: boys },

  /**
   * "Upper voices" — everyone singing a treble or alto line.
   *
   * The children plus the adult sopranos and altos. Read the other way (the
   * children alone) it would be 41 rather than 58, and by the rule above the
   * higher reading is the safer one to be wrong with.
   */
  {
    phrases: ["upper voices"],
    singers: boys + girls + consort + ADULTS.soprano + ADULTS.alto,
  },
];

/**
 * Words that carry no group of their own.
 *
 * What is left after the groups and these have been struck out is a choir we do
 * not know the size of — which is the signal that the whole answer is unknown.
 */
const FILLER = new Set([
  "and", "with", "the", "a", "plus", "then", "only", "voices", "choir", "singers", "team",
]);

export interface ChoirSize {
  /** How many singers, or null when the designation names somebody we cannot count. */
  singers: number | null;
  /** The groups recognised, for explaining the number on screen. */
  recognised: string[];
  /** What was named but not recognised — a visiting choir, usually. */
  unrecognised: string[];
}

/**
 * Work out how many singers a designation means.
 *
 * Groups are struck out of the string as they are matched, so each is counted
 * once however the list phrases it, and what remains at the end is the evidence
 * for whether the answer can be trusted.
 */
export function choirSizeFor(designation: string | null | undefined): ChoirSize {
  const raw = (designation ?? "").trim();
  if (!raw) return { singers: null, recognised: [], unrecognised: [] };

  // A parenthetical is nearly always a visiting choir's home church
  // ("(St Nicholas, Hornsea)"). Keep it — it is exactly the kind of leftover
  // that should make the answer unknown.
  let remaining = raw.toLowerCase().replace(/&/g, " and ");

  let total = 0;
  const recognised: string[] = [];

  for (const group of GROUPS) {
    for (const phrase of group.phrases) {
      // Whole words only: "boys" must not match inside another word, and
      // "bass" must not swallow the "bass" in somebody's surname.
      const pattern = new RegExp(`(?<![a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "g");
      if (!pattern.test(remaining)) continue;
      remaining = remaining.replace(pattern, " ");
      total += group.singers;
      recognised.push(phrase);
      break; // One phrase per group; do not count a group twice.
    }
  }

  const unrecognised = remaining
    .split(/[^a-z']+/i)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !FILLER.has(w));

  // Nothing recognised at all — a visiting choir start to finish.
  if (!recognised.length) return { singers: null, recognised, unrecognised };

  // Something recognised, but somebody else is coming too. We cannot know how
  // many they are bringing, and a number that is certainly too low would show
  // as a confident green.
  if (unrecognised.length) return { singers: null, recognised, unrecognised };

  return { singers: total, recognised, unrecognised };
}

/** Just the number, for the RAG. */
export function singersFor(designation: string | null | undefined): number | null {
  return choirSizeFor(designation).singers;
}

/**
 * One line explaining a number, for the admin screen.
 *
 * The librarian filling in choir sizes should be able to see why a designation
 * came out at 43 without doing the arithmetic themselves.
 */
export function explainChoirSize(designation: string | null | undefined): string {
  const size = choirSizeFor(designation);
  if (size.singers !== null) {
    return `${size.recognised.join(" + ")} — ${size.singers} singers`;
  }
  if (size.recognised.length) {
    return `we cannot count "${size.unrecognised.join(" ")}", so this stays unknown`;
  }
  return "a choir we do not have numbers for";
}
