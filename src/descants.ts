/**
 * The descant finder (H4): "which binder has the descant for hymn 285?"
 *
 * The descants are not catalogued piece by piece. They live in a run of ring
 * binders in the song school, indexed by hymn number — the draft index records
 * the whole lot as one row (D-255): "St Patrick's Breastplate binder + Hymn
 * Descants binder + numbered binders 1-150 (18 binders)", noted as "indexed by
 * hymn number".
 *
 * So this is not a catalogue search. It is arithmetic on a shelf, and the
 * honest shape of the answer is "binder 21–30, on the descant shelf" rather
 * than a piece page that does not exist. Cataloguing 150 hymn descants
 * individually is a different job for a different afternoon.
 *
 * Pure, so the arithmetic can be tested without a database.
 */

import { CHURCH } from "./church.config";

export interface BinderAnswer {
  /** What is written on the spine of the binder to reach for. */
  binder: string;
  /** The hymn number asked for. */
  hymn: number;
  /** Anything else worth saying — a named binder to try, a caveat. */
  note: string | null;
}

export interface BinderMiss {
  hymn: number | null;
  /** Why there is no answer, in words a chorister can act on. */
  reason: string;
}

export type DescantResult = { found: true; answer: BinderAnswer } | { found: false; miss: BinderMiss };

/**
 * Read what somebody typed into the box as a hymn number.
 *
 * Takes "285", " 285 " and "Hymn 285", because all three are what people type.
 * Anything else is not a hymn number and saying so beats guessing.
 */
export function readHymnNumber(raw: string): number | null {
  const digits = raw.trim().replace(/^hymn\s*/i, "").trim();
  if (!/^\d{1,4}$/.test(digits)) return null;
  const n = Number(digits);
  return n > 0 ? n : null;
}

/** The label on the binder holding a given hymn: 285 → "281–290". */
export function binderFor(hymn: number): string {
  const { rangeSize } = CHURCH.descants;
  const start = Math.floor((hymn - 1) / rangeSize) * rangeSize + 1;
  return `${start}–${start + rangeSize - 1}`;
}

/**
 * Which binder holds the descant for a hymn.
 *
 * The numbered binders stop at the highest hymn they cover. Above that the
 * answer is not "binder 151–160" — that binder does not exist, and sending
 * somebody to look for it in a cold song school is worse than saying so.
 */
export function findDescant(raw: string): DescantResult {
  const hymn = readHymnNumber(raw);
  if (hymn === null) {
    return {
      found: false,
      miss: { hymn: null, reason: "That is not a hymn number. Put in the number alone, like 285." },
    };
  }

  const { highestNumbered, namedBinders } = CHURCH.descants;

  if (hymn > highestNumbered) {
    return {
      found: false,
      miss: {
        hymn,
        reason:
          `The numbered binders only run to ${highestNumbered}. ` +
          `Try the ${namedBinders.join(" binder or the ")} binder, or ask the Director of Music.`,
      },
    };
  }

  return {
    found: true,
    answer: {
      binder: binderFor(hymn),
      hymn,
      note:
        `There is no index of which hymns actually have a descant — the binder is where to look, ` +
        `not a promise that it is in there.`,
    },
  };
}

/** Every binder on the shelf, for the "what is there?" panel. */
export function allBinders(): string[] {
  const { rangeSize, highestNumbered, namedBinders } = CHURCH.descants;
  const numbered: string[] = [];
  for (let start = 1; start <= highestNumbered; start += rangeSize) {
    numbered.push(`${start}–${Math.min(start + rangeSize - 1, highestNumbered)}`);
  }
  return [...numbered, ...namedBinders];
}
