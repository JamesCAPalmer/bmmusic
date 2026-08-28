/**
 * The copies RAG and the descant finder.
 *
 * Both are arithmetic that a chorister acts on: one tells them whether there
 * are enough copies to sing from, the other which binder to reach for. Getting
 * either subtly wrong is worse than not having it, because both are believed.
 */

import { describe, expect, it } from "vitest";
import { copiesRag, ragLabel, worstRag, type RagState } from "../src/rag";
import { allBinders, binderFor, findDescant, readHymnNumber } from "../src/descants";
import { CHURCH } from "../src/church.config";
import { adventSunday, easterSunday, seasonsInPlay } from "../src/churchyear";

// ---------------------------------------------------------------------------

describe("the copies RAG", () => {
  it("is green when there is a copy for everybody", () => {
    expect(copiesRag({ copiesUsable: 24, typicalSingers: 20 }).state).toBe("green");
    expect(copiesRag({ copiesUsable: 20, typicalSingers: 20 }).state).toBe("green");
  });

  // A couple of singers sharing is a normal Tuesday, not an emergency.
  it("is amber when a few will have to share", () => {
    expect(copiesRag({ copiesUsable: 18, typicalSingers: 20 }).state).toBe("amber");
    expect(copiesRag({ copiesUsable: 16, typicalSingers: 20 }).state).toBe("amber");
  });

  it("is red when there are not nearly enough", () => {
    expect(copiesRag({ copiesUsable: 15, typicalSingers: 20 }).state).toBe("red");
    expect(copiesRag({ copiesUsable: 0, typicalSingers: 20 }).state).toBe("red");
  });

  // The one that matters on the day this ships. Robert has not given us the
  // singer counts yet, so every service is grey — and grey must not look like
  // green, or the screen is full of reassuring ticks that mean nothing.
  it("is grey, not green, when nobody has said how many singers there are", () => {
    const verdict = copiesRag({ copiesUsable: 40, typicalSingers: null, designation: "Boys and SATB" });
    expect(verdict.state).toBe("grey");
    expect(verdict.reason).toContain("Boys and SATB");
    expect(verdict.shortfall).toBeNull();
  });

  it("is grey, not red, when nobody has counted the box", () => {
    const verdict = copiesRag({ copiesUsable: null, typicalSingers: 20 });
    expect(verdict.state).toBe("grey");
    expect(verdict.reason).toContain("counted");
    expect(verdict.shortfall).toBeNull();
  });

  it("is grey when neither number is known", () => {
    expect(copiesRag({ copiesUsable: null, typicalSingers: null }).state).toBe("grey");
  });

  // A designation recorded as zero singers is a data problem, not a choir of
  // nobody; treating it as "we know, and the answer is none" would make every
  // piece green by dividing by nothing.
  it("treats a designation recorded as zero singers as unknown", () => {
    expect(copiesRag({ copiesUsable: 0, typicalSingers: 0 }).state).toBe("grey");
  });

  it("says how many copies short, in words", () => {
    const verdict = copiesRag({ copiesUsable: 14, typicalSingers: 20 });
    expect(verdict.shortfall).toBe(6);
    expect(verdict.reason).toContain("6 short");
  });

  it("counts one copy as a copy, not copies", () => {
    expect(copiesRag({ copiesUsable: 1, typicalSingers: 1 }).reason).toContain("1 usable copy");
  });

  it("moves with the config rather than a number buried in the code", () => {
    const singers = 20;
    const floor = Math.ceil(singers * CHURCH.copiesRag.amberProportion);
    expect(copiesRag({ copiesUsable: floor, typicalSingers: singers }).state).toBe("amber");
    expect(copiesRag({ copiesUsable: floor - 1, typicalSingers: singers }).state).toBe("red");
  });
});

describe("a service's worst piece", () => {
  it("reports the worst state present", () => {
    expect(worstRag(["green", "amber", "red"])).toBe("red");
    expect(worstRag(["green", "amber", "grey"])).toBe("amber");
    expect(worstRag(["green", "grey"])).toBe("green");
  });

  // An all-grey service is unknown, not fine.
  it("reports grey when nothing is known at all", () => {
    expect(worstRag(["grey", "grey"])).toBe("grey");
    expect(worstRag([])).toBe("grey");
  });

  it("gives every state a label a chorister can read", () => {
    for (const state of ["green", "amber", "red", "grey"] as RagState[]) {
      expect(ragLabel(state).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the descant finder", () => {
  it("reads a hymn number, however it was typed", () => {
    expect(readHymnNumber("285")).toBe(285);
    expect(readHymnNumber("  285  ")).toBe(285);
    expect(readHymnNumber("Hymn 285")).toBe(285);
    expect(readHymnNumber("hymn285")).toBe(285);
  });

  it("refuses what is not a hymn number", () => {
    expect(readHymnNumber("")).toBeNull();
    expect(readHymnNumber("Ave verum")).toBeNull();
    expect(readHymnNumber("0")).toBeNull();
    expect(readHymnNumber("28.5")).toBeNull();
  });

  it("puts a hymn in the binder whose range covers it", () => {
    expect(binderFor(1)).toBe("1–10");
    expect(binderFor(10)).toBe("1–10");
    expect(binderFor(11)).toBe("11–20");
    expect(binderFor(85)).toBe("81–90");
  });

  // The boundaries are where an off-by-one would send somebody to the wrong
  // shelf, and they would believe it.
  it("gets the boundaries right", () => {
    expect(binderFor(20)).toBe("11–20");
    expect(binderFor(21)).toBe("21–30");
    expect(binderFor(150)).toBe("141–150");
  });

  it("answers a hymn inside the numbered binders", () => {
    const result = findDescant("85");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.answer.binder).toBe("81–90");
      expect(result.answer.hymn).toBe(85);
    }
  });

  // There is no binder 151–160. Sending somebody to look for one in a cold
  // song school is worse than telling them it does not exist.
  //
  // This is not a rare edge: hymn numbers in the live music feed run from 9 to
  // 565, and only about a third fall inside the binders' range. Whether that
  // means the binders are indexed some other way is a question for James — but
  // until somebody has looked at the shelf, declining is the honest answer, and
  // the range is config so correcting it is a one-line edit.
  it("does not invent a binder past the end of the run", () => {
    const result = findDescant("285");
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.miss.reason).toContain("150");
      expect(result.miss.reason).toContain("St Patrick's Breastplate");
    }
  });

  it("declines the top of the range the music list actually uses", () => {
    expect(findDescant("565").found).toBe(false);
  });

  it("answers right up to the last numbered binder", () => {
    const result = findDescant("150");
    expect(result.found).toBe(true);
    if (result.found) expect(result.answer.binder).toBe("141–150");
  });

  it("says so plainly when that was not a number", () => {
    const result = findDescant("Ave verum");
    expect(result.found).toBe(false);
    if (!result.found) expect(result.miss.reason).toContain("number alone");
  });

  // The binder tells you where to look; it does not promise the descant is in
  // there. Saying that up front saves a wasted trip.
  it("does not promise the descant is actually in the binder", () => {
    const result = findDescant("285");
    if (result.found) expect(result.answer.note).toContain("not a promise");
  });

  it("lists every binder on the shelf, numbered then named", () => {
    const binders = allBinders();
    expect(binders[0]).toBe("1–10");
    expect(binders).toContain("141–150");
    expect(binders).toContain("St Patrick's Breastplate");
    expect(binders.filter((b) => /^\d/.test(b))).toHaveLength(15);
  });
});

// ---------------------------------------------------------------------------

describe("where we are in the church year", () => {
  // Checked against the published dates. Everything from Ash Wednesday to
  // Pentecost is counted from Easter, so being a week out here would put the
  // whole Passiontide shelf in the wrong month.
  it("computes Easter for a spread of real years", () => {
    const easter = (y: number) => easterSunday(y).toISOString().slice(0, 10);
    expect(easter(2024)).toBe("2024-03-31");
    expect(easter(2025)).toBe("2025-04-20");
    expect(easter(2026)).toBe("2026-04-05");
    expect(easter(2027)).toBe("2027-03-28");
    expect(easter(2030)).toBe("2030-04-21");
    // The extremes of the range Easter can occupy.
    expect(easter(2038)).toBe("2038-04-25");
    expect(easter(2285)).toBe("2285-03-22");
  });

  it("always lands Easter on a Sunday", () => {
    for (let y = 2024; y < 2075; y++) expect(easterSunday(y).getUTCDay()).toBe(0);
  });

  it("finds Advent Sunday, four Sundays before Christmas", () => {
    const advent = (y: number) => adventSunday(y).toISOString().slice(0, 10);
    expect(advent(2026)).toBe("2026-11-29");
    expect(advent(2027)).toBe("2027-11-28");
    for (let y = 2024; y < 2060; y++) expect(adventSunday(y).getUTCDay()).toBe(0);
  });

  // The panel looks ahead on purpose: telling a librarian on Palm Sunday that
  // it is Holy Week is no use to anybody.
  it("sees a season coming before it arrives", () => {
    // Easter 2026 is 5 April, so Lent begins 18 February.
    const earlyFebruary = seasonsInPlay(new Date("2026-02-01T00:00:00Z"));
    expect(earlyFebruary).toContain("lent");
  });

  it("knows Advent and Christmas in late November", () => {
    const seasons = seasonsInPlay(new Date("2026-11-25T00:00:00Z"));
    expect(seasons).toContain("advent");
    expect(seasons).toContain("christmas");
  });

  it("knows harvest in September", () => {
    expect(seasonsInPlay(new Date("2026-09-10T00:00:00Z"))).toContain("harvest");
  });

  it("carries Christmas across the year boundary into January", () => {
    expect(seasonsInPlay(new Date("2027-01-02T00:00:00Z"), 3)).toContain("christmas");
  });

  it("returns them in church-year order, not the order they were found", () => {
    const seasons = seasonsInPlay(new Date("2026-03-20T00:00:00Z"), 60);
    const order = CHURCH.seasons.map((s) => s.value);
    const positions = seasons.map((s) => order.indexOf(s));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  // "general" means "any time", which is not the same as "in season now".
  it("never selects the general tag by date", () => {
    for (const date of ["2026-01-15", "2026-04-05", "2026-07-01", "2026-12-25"]) {
      expect(seasonsInPlay(new Date(`${date}T00:00:00Z`))).not.toContain("general");
    }
  });

  it("only ever names seasons the vocabulary knows", () => {
    const vocabulary = new Set(CHURCH.seasons.map((s) => s.value));
    for (let month = 1; month <= 12; month++) {
      const date = new Date(Date.UTC(2026, month - 1, 15));
      for (const season of seasonsInPlay(date)) expect(vocabulary).toContain(season);
    }
  });
});
