/**
 * People: the pure parts.
 *
 * Which choirs a designation calls for, what a school year is called, and the
 * one thing about this module that is a rule rather than a calculation — that
 * a five-year-old is never on the register at the door of Choral Evensong.
 *
 * Nothing here touches D1 and nothing here invents a person.
 */

import { describe, expect, it } from "vitest";

import { CHOIRS, SCHOOL_YEARS, choirsExpectedFor, isChoir, nextStatus, registerTally, schoolYearLabel } from "../src/people";
import type { RegisterRow } from "../src/people";

describe("choirs", () => {
  it("names the five the department runs, junior choir included", () => {
    expect(CHOIRS.map((c) => c.value)).toEqual(["boys", "girls", "consort", "satb", "jc"]);
    for (const c of CHOIRS) expect(isChoir(c.value)).toBe(true);
    expect(isChoir("trebles")).toBe(false);
    expect(isChoir("")).toBe(false);
  });

  it("reads the choirs a designation names", () => {
    expect(choirsExpectedFor("Boys and SATB")).toEqual(["boys", "satb"]);
    expect(choirsExpectedFor("Consort and Girls")).toEqual(["girls", "consort"]);
  });

  // Showing an empty register at the door is worse than showing a long one: the
  // person holding the phone cannot tell it apart from a bug.
  it("expects everybody when a designation names nobody it knows", () => {
    expect(choirsExpectedFor("Symbel Choir")).toEqual(["boys", "girls", "consort", "satb"]);
    expect(choirsExpectedFor(null)).toEqual(["boys", "girls", "consort", "satb"]);
  });

  // The rule this file exists for. The junior choir do not sing services from
  // music, they have their own register, and a five-year-old's name has no
  // reason to be on a phone at the door of Evensong.
  it("never puts the junior choir in that everybody", () => {
    for (const designation of ["Symbel Choir", "RSCM", "", null, "Visiting choir"]) {
      expect(choirsExpectedFor(designation)).not.toContain("jc");
    }
  });

  it("includes them only when a designation says so outright", () => {
    expect(choirsExpectedFor("JC practice")).toEqual(["jc"]);
  });
});

describe("school years", () => {
  // Reception is 0 so that the September rollover is school_year + 1 with no
  // special case anywhere.
  it("runs Reception to Year 13, Reception at zero", () => {
    expect(SCHOOL_YEARS[0]).toBe(0);
    expect(SCHOOL_YEARS[SCHOOL_YEARS.length - 1]).toBe(13);
    expect(SCHOOL_YEARS.length).toBe(14);
  });

  it("says Reception, Year 6, and Adult for nothing at all", () => {
    expect(schoolYearLabel(0)).toBe("Reception");
    expect(schoolYearLabel(6)).toBe("Year 6");
    expect(schoolYearLabel(13)).toBe("Year 13");
    expect(schoolYearLabel(null)).toBe("Adult");
  });
});

describe("the register", () => {
  it("cycles unmarked, present, absent, excused, and back", () => {
    expect(nextStatus(null)).toBe("present");
    expect(nextStatus("present")).toBe("absent");
    expect(nextStatus("absent")).toBe("excused");
    expect(nextStatus("excused")).toBeNull();
  });

  it("counts what is marked and what is not", () => {
    const row = (status: string | null): RegisterRow => ({
      id: 1,
      display_name: "x",
      choir: "girls",
      voice_part: null,
      active: 1,
      school_year: 6,
      joined_on: null,
      surplice_awarded_on: null,
      deans_award_on: null,
      archbishops_award_on: null,
      gold_award_on: null,
      dbs_valid_until: null,
      gender: null,
      left_on: null,
      status,
      marked_by: null,
    });

    expect(registerTally([row("present"), row("present"), row("absent"), row(null)])).toEqual({
      present: 2,
      absent: 1,
      excused: 0,
      unmarked: 1,
    });
  });
});
