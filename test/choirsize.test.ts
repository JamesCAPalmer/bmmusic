/**
 * Reading a music-list designation as a number of singers.
 *
 * Every designation quoted here is a real one, taken from four months of the
 * live bmserviceapp feed (May–August 2026). That matters: the list is written
 * by a person and parsed by a language model, and its phrasings are not the
 * ones anybody would invent — "Consort, Girls and SATB with Young Voices
 * (St Nicholas, Hornsea)" is a real entry.
 *
 * The numbers behind them are September 2026: the children from Rachel Dent,
 * the adults counted off the Minster Choir teams list.
 */

import { describe, expect, it } from "vitest";
import {
  choirSizeFor,
  explainChoirSize,
  singersFor,
  ADULTS,
  ADULT_TOTAL,
  FULL_CHOIR_TOTAL,
  TEAM_A_TOTAL,
  TEAM_B_TOTAL,
} from "../src/choirsize";
import { CHURCH } from "../src/church.config";

const { boys, girls, consort } = CHURCH.choirSections;

describe("the sections add up", () => {
  it("counts the children as the Director of Junior Choir counted them", () => {
    expect(consort).toBe(12);
    expect(girls).toBe(19);
    expect(boys).toBe(10);
  });

  it("counts the two adult teams off the September 2026 team list", () => {
    expect(TEAM_A_TOTAL).toBe(16);
    expect(TEAM_B_TOTAL).toBe(17);
    expect(ADULT_TOTAL).toBe(33);
  });

  it("splits the adults into voice parts that total the same", () => {
    expect(ADULTS.soprano + ADULTS.alto + ADULTS.tenor + ADULTS.bass).toBe(ADULT_TOTAL);
    expect(ADULTS).toEqual({ soprano: 5, alto: 12, tenor: 7, bass: 9 });
  });

  // The Junior Choir (5–8) does not sing from copies, so it can never make a
  // box short and is deliberately not counted anywhere.
  it("leaves the Junior Choir out of the full choir", () => {
    expect(FULL_CHOIR_TOTAL).toBe(boys + girls + consort + ADULT_TOTAL);
    expect(FULL_CHOIR_TOTAL).toBe(74);
  });
});

describe("designations the feed actually publishes", () => {
  // Every one of these appeared in the live feed between May and August 2026.
  const cases: [string, number][] = [
    ["Boys and SATB", 10 + 33],
    ["Consort, Girls and SATB", 12 + 19 + 33],
    ["ATB", 12 + 7 + 9],
    ["Consort and Girls", 12 + 19],
    ["SATB", 33],
    ["Boys and Team A", 10 + 16],
    ["Girls and Team B", 19 + 17],
    ["Full Choir", 74],
    ["Boys and Team B", 10 + 17],
    ["Consort and Sopranos", 12 + 5],
    ["Boys, Consort and Girls", 10 + 12 + 19],
    ["Consort and Team A", 12 + 16],
  ];

  for (const [designation, expected] of cases) {
    it(`reads "${designation}" as ${expected} singers`, () => {
      expect(singersFor(designation)).toBe(expected);
    });
  }
});

describe("telling SATB from ATB", () => {
  // "SATB" contains "ATB". Matching in the wrong order would read every SATB
  // service as ATB and quietly lose five sopranos from the count — the exact
  // kind of undercount that turns a red into a green.
  it("does not read SATB as ATB", () => {
    expect(singersFor("SATB")).toBe(ADULT_TOTAL);
    expect(singersFor("ATB")).toBe(ADULT_TOTAL - ADULTS.soprano);
    expect(singersFor("SATB")).toBeGreaterThan(singersFor("ATB")!);
  });

  it("does not read SATB as containing basses twice", () => {
    expect(choirSizeFor("SATB").recognised).toEqual(["satb"]);
  });
});

describe("choirs we cannot count", () => {
  // Nobody here knows how many singers a visiting choir is bringing, and the
  // honest answer is "we do not know" rather than a number.
  for (const visiting of ["Liturgy Singers", "Symbel choir", "Clerkes of All Saints", "RCSM"]) {
    it(`declines to count "${visiting}"`, () => {
      expect(singersFor(visiting)).toBeNull();
    });
  }

  /**
   * The important one, and the reason a partial count is refused outright.
   *
   * "Consort, Girls and SATB with Young Voices" recognises 64 of our own
   * singers — but Young Voices are coming too, and we have no idea how many.
   * Returning 64 would produce a confident green against a number that is
   * certainly too low, and a chorister would find no copy. Grey is correct.
   */
  it("returns nothing when a visiting choir joins ours, rather than an undercount", () => {
    const designation = "Consort, Girls and SATB with Young Voices (St Nicholas, Hornsea)";
    const size = choirSizeFor(designation);
    expect(size.singers).toBeNull();
    expect(size.recognised).toContain("satb");
    expect(size.unrecognised.join(" ")).toContain("young");
  });

  it("declines an empty or missing designation", () => {
    expect(singersFor(null)).toBeNull();
    expect(singersFor("")).toBeNull();
    expect(singersFor("   ")).toBeNull();
  });
});

describe("reading the words", () => {
  it("is not fooled by case or an ampersand", () => {
    expect(singersFor("BOYS AND SATB")).toBe(singersFor("Boys and SATB"));
    expect(singersFor("Boys & SATB")).toBe(singersFor("Boys and SATB"));
  });

  it("counts a group named twice only once", () => {
    expect(singersFor("SATB and SATB")).toBe(ADULT_TOTAL);
  });

  // Whole words only: "boys" must not match inside another word.
  it("does not find a section hiding inside a longer word", () => {
    expect(singersFor("Boysenberry Singers")).toBeNull();
  });

  it("ignores the filler words a list uses to join groups", () => {
    expect(singersFor("The Boys and the SATB choir")).toBe(10 + 33);
  });

  it("explains a number in words for the admin screen", () => {
    expect(explainChoirSize("Boys and SATB")).toContain("43");
    expect(explainChoirSize("Liturgy Singers")).toContain("do not have numbers");
    expect(explainChoirSize("Consort, Girls and SATB with Young Voices")).toContain("unknown");
  });
});

describe("which way to be wrong", () => {
  // Overestimating makes the RAG cry "not enough copies" and somebody checks.
  // Underestimating makes it say "enough" and a chorister arrives to find none.
  // So where a reading is ambiguous, the higher one is the safer one.
  it("reads upper voices as including the adult sopranos and altos", () => {
    expect(singersFor("Upper voices")).toBe(boys + girls + consort + ADULTS.soprano + ADULTS.alto);
    expect(singersFor("Upper voices")!).toBeGreaterThan(boys + girls + consort);
  });

  // A named team is one team; SATB with no team named is the whole adult body.
  it("reads a bare SATB as all the adults, not one team", () => {
    expect(singersFor("SATB")).toBe(ADULT_TOTAL);
    expect(singersFor("SATB")!).toBeGreaterThan(TEAM_A_TOTAL);
    expect(singersFor("SATB")!).toBeGreaterThan(TEAM_B_TOTAL);
  });

  it("never returns a number larger than the whole choir", () => {
    for (const designation of [
      "Full Choir",
      "Consort, Girls and SATB",
      "Boys, Consort and Girls",
      "Upper voices",
      "Boys and SATB",
    ]) {
      expect(singersFor(designation)!).toBeLessThanOrEqual(FULL_CHOIR_TOTAL);
    }
  });

  it("never returns zero for a designation it recognised", () => {
    for (const designation of ["SATB", "Boys", "Girls", "Consort", "ATB", "Full Choir"]) {
      expect(singersFor(designation)).toBeGreaterThan(0);
    }
  });
});

describe("every seeded designation resolves", () => {
  // The config seeds `choir_profile` with these. If one of them cannot be read
  // into a number, it would sit grey forever with nobody the wiser.
  it("gives a number for every designation the config seeds", () => {
    const unresolved = CHURCH.choirs
      .map((c) => c.designation)
      .filter((d) => singersFor(d) === null);
    expect(unresolved).toEqual([]);
  });
});
