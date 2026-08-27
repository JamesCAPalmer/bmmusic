/**
 * The copies RAG (16A): have we enough usable copies to sing this?
 *
 * Two numbers meet here. Usable copies come from the last time somebody opened
 * the parcel and counted; the number of singers comes from the service's choir
 * designation and `choir_profile`. Either can be missing, and the honest answer
 * when one is missing is **grey** — not green, and not red.
 *
 * That matters more than it sounds. Robert has not given us the singer counts
 * yet, so on the day this ships every service is grey. A design that made
 * "unknown" look like "fine" would ship a screen full of reassuring green
 * ticks that mean nothing at all, and the first time it mattered would be the
 * morning somebody found nine copies for a choir of twenty.
 *
 * Pure and free of D1 so the rules can be tested directly, per the brief.
 */

import { CHURCH } from "./church.config";

export type RagState = "green" | "amber" | "red" | "grey";

export interface RagVerdict {
  state: RagState;
  /** One line, in plain English, for the chorister or the librarian reading it. */
  reason: string;
  /** Copies short of the choir's size. Null when either number is unknown. */
  shortfall: number | null;
}

export interface RagInput {
  /** Usable copies at the last count. NULL when nobody has counted the parcel. */
  copiesUsable: number | null;
  /** Typical singers for the service's designation. NULL until Robert says. */
  typicalSingers: number | null;
  /** The designation as published, for the message. */
  designation?: string | null;
}

/**
 * Work out the RAG for one piece at one service.
 *
 * Amber is "enough for nearly everyone" — a couple of singers sharing is a
 * normal Tuesday, and calling that red would cry wolf on half the library. The
 * proportion lives in `church.config` so it is a config edit, not a code one.
 */
export function copiesRag(input: RagInput): RagVerdict {
  const { copiesUsable, typicalSingers } = input;

  if (typicalSingers === null || typicalSingers <= 0) {
    return {
      state: "grey",
      reason: input.designation
        ? `We have not recorded how many singers "${input.designation}" usually means.`
        : "We do not know how many singers this service needs.",
      shortfall: null,
    };
  }

  if (copiesUsable === null) {
    return {
      state: "grey",
      reason: "Nobody has counted this parcel yet.",
      shortfall: null,
    };
  }

  const shortfall = typicalSingers - copiesUsable;

  if (shortfall <= 0) {
    return {
      state: "green",
      reason: `${copiesUsable} usable ${copiesUsable === 1 ? "copy" : "copies"} for ${typicalSingers} singers.`,
      shortfall: 0,
    };
  }

  const amberFloor = Math.ceil(typicalSingers * CHURCH.copiesRag.amberProportion);
  if (copiesUsable >= amberFloor) {
    return {
      state: "amber",
      reason: `${copiesUsable} usable for ${typicalSingers} singers — ${shortfall} short, so some will share.`,
      shortfall,
    };
  }

  return {
    state: "red",
    reason: `Only ${copiesUsable} usable for ${typicalSingers} singers — ${shortfall} short.`,
    shortfall,
  };
}

/** The worst state in a list, for a service's overall standing. */
export function worstRag(states: RagState[]): RagState {
  if (states.includes("red")) return "red";
  if (states.includes("amber")) return "amber";
  if (states.includes("green")) return "green";
  return "grey";
}

/** The pill class the theme paints each state in. */
export function ragPill(state: RagState): string {
  switch (state) {
    case "green":
      return "green";
    case "amber":
      return "amber";
    case "red":
      return "red";
    default:
      return "grey";
  }
}

/** Short label for the pill itself. */
export function ragLabel(state: RagState): string {
  switch (state) {
    case "green":
      return "Enough copies";
    case "amber":
      return "Some sharing";
    case "red":
      return "Not enough";
    default:
      return "Not known";
  }
}
