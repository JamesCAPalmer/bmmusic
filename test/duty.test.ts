/**
 * Duty coverage.
 *
 * A rota that says green when it should say red is worse than no rota, because
 * somebody will trust it. Every rule gets a case, and the cases are written the
 * way the failure would actually happen — a name on the backup line and nobody
 * on the door, a DBS date that ran out last month, a Thursday with only one
 * adult and forty children.
 */

import { describe, expect, it } from "vitest";

import {
  DUTY_ROLES,
  EVENT_TYPES,
  dutyCandidates,
  dutyCoverage,
  isDutyRole,
  isEventType,
  type DutyRow,
} from "../src/duty";
import { childrenFor } from "../src/choirsize";
import type { PersonRow } from "../src/people";

const TODAY = "2026-09-06";

let nextId = 1;

function duty(overrides: Partial<DutyRow> = {}): DutyRow {
  return {
    id: nextId++,
    service_id: 1,
    person_id: 1,
    role: "robing",
    is_backup: 0,
    note: null,
    all_collected_at: null,
    all_collected_by: null,
    display_name: "An Adult",
    gender: null,
    // In date unless a case says otherwise, so a test about one rule is not
    // quietly also testing the DBS rule.
    dbs_valid_until: "2027-01-01",
    ...overrides,
  };
}

/** A fully covered event, which every case below then breaks in one way. */
function covered(): DutyRow[] {
  return [
    duty({ role: "robing", display_name: "Robing Adult" }),
    duty({ role: "general", display_name: "General Adult" }),
    duty({ role: "dismissal", display_name: "Dismissal Adult" }),
  ];
}

function check(duties: DutyRow[], extra: Partial<Parameters<typeof dutyCoverage>[0]> = {}) {
  return dutyCoverage({
    duties,
    designation: "Girls",
    childrenExpected: null,
    childrenPerAdult: null,
    today: TODAY,
    ...extra,
  });
}

describe("the shape of a rota", () => {
  it("has three duties and five kinds of event", () => {
    expect(DUTY_ROLES.map((r) => r.value)).toEqual(["robing", "general", "dismissal"]);
    for (const r of DUTY_ROLES) expect(isDutyRole(r.value)).toBe(true);
    expect(isDutyRole("supervision")).toBe(false);

    expect(EVENT_TYPES.map((t) => t.value)).toEqual(["regular", "wedding", "concert", "tour", "other"]);
    for (const t of EVENT_TYPES) expect(isEventType(t.value)).toBe(true);
    expect(isEventType("service")).toBe(false);
  });
});

describe("coverage", () => {
  it("is green when all three are covered and every DBS is in date", () => {
    const result = check(covered());
    expect(result.rag).toBe("green");
    expect(result.issues).toEqual([]);
  });

  // The two moments children are unsupervised if nobody is there.
  it("is red with nobody on robing", () => {
    const result = check(covered().filter((d) => d.role !== "robing"));
    expect(result.rag).toBe("red");
    expect(result.issues.map((i) => i.message)).toContain("Nobody is on robing.");
  });

  it("is red with nobody on dismissal", () => {
    const result = check(covered().filter((d) => d.role !== "dismissal"));
    expect(result.rag).toBe("red");
    expect(result.issues.map((i) => i.message)).toContain("Nobody is on dismissal.");
  });

  // A gap, not an absence at the door.
  it("is amber with nobody on general duty", () => {
    const result = check(covered().filter((d) => d.role !== "general"));
    expect(result.rag).toBe("amber");
  });

  // The failure this rule exists for: a rota that looks full because every line
  // has a name on it, and nobody is actually on the door.
  it("does not count a backup as cover", () => {
    const result = check([
      duty({ role: "robing", is_backup: 1 }),
      duty({ role: "general", is_backup: 1 }),
      duty({ role: "dismissal", is_backup: 1 }),
    ]);
    expect(result.rag).toBe("red");
    expect(result.issues.map((i) => i.message)).toContain("Nobody is on robing.");
    expect(result.issues.map((i) => i.message)).toContain("Nobody is on dismissal.");
  });

  it("reports every problem at once, not the first one", () => {
    const result = check([duty({ role: "general" })]);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe("DBS checks", () => {
  it("is red for a date that has passed, and names whose it is", () => {
    const result = check([
      ...covered().filter((d) => d.role !== "robing"),
      duty({ role: "robing", display_name: "Lapsed Adult", dbs_valid_until: "2026-08-31" }),
    ]);
    expect(result.rag).toBe("red");
    expect(result.issues.some((i) => i.message.includes("Lapsed Adult"))).toBe(true);
  });

  it("counts a check expiring today as still in date", () => {
    const result = check([
      ...covered().filter((d) => d.role !== "robing"),
      duty({ role: "robing", dbs_valid_until: TODAY }),
    ]);
    expect(result.rag).toBe("green");
  });

  // Not knowing is not the same as knowing it has expired, and treating the
  // two alike would train people to ignore the red ones.
  it("is amber, not red, when no date is recorded at all", () => {
    const result = check([
      ...covered().filter((d) => d.role !== "robing"),
      duty({ role: "robing", dbs_valid_until: null }),
    ]);
    expect(result.rag).toBe("amber");
  });

  it("checks backups too — they are on the premises", () => {
    const result = check([...covered(), duty({ role: "general", is_backup: 1, dbs_valid_until: "2020-01-01" })]);
    expect(result.rag).toBe("red");
  });
});

describe("both genders when both groups are due", () => {
  it("is amber when everybody we know about is the same one", () => {
    const result = check(covered().map((d) => ({ ...d, gender: "f" })), {
      designation: "Boys and Girls",
    });
    expect(result.rag).toBe("amber");
  });

  it("is green when cover includes both", () => {
    const [robing, general, dismissal] = covered() as [DutyRow, DutyRow, DutyRow];
    const result = check(
      [
        { ...robing, gender: "f" },
        { ...general, gender: "m" },
        { ...dismissal, gender: "f" },
      ],
      { designation: "Boys and Girls" }
    );
    expect(result.rag).toBe("green");
  });

  // Gender is recorded for duty adults and often not at all. A check that
  // shouts on missing data is a check people learn to ignore.
  it("says nothing when no gender is recorded", () => {
    const result = check(covered(), { designation: "Boys and Girls" });
    expect(result.rag).toBe("green");
  });

  it("says nothing when only one group is due", () => {
    const result = check(covered().map((d) => ({ ...d, gender: "f" })), { designation: "Girls" });
    expect(result.rag).toBe("green");
  });
});

describe("the ratio", () => {
  // The app ships no figure: what is acceptable is the Minster's safeguarding
  // policy to state, not something software should decide.
  it("is not checked at all until somebody sets a figure", () => {
    const result = check(covered(), { childrenExpected: 500 });
    expect(result.rag).toBe("green");
  });

  it("is amber when there are more children than the figure allows", () => {
    const result = check(covered(), { childrenExpected: 40, childrenPerAdult: 10 });
    expect(result.rag).toBe("amber");
    expect(result.issues.some((i) => i.message.includes("40 children"))).toBe(true);
  });

  it("is green at exactly the figure", () => {
    const result = check(covered(), { childrenExpected: 30, childrenPerAdult: 10 });
    expect(result.rag).toBe("green");
  });

  it("counts only the people actually on duty, not the backups", () => {
    const result = check([...covered(), duty({ role: "general", is_backup: 1 })], {
      childrenExpected: 40,
      childrenPerAdult: 10,
    });
    expect(result.rag).toBe("amber");
  });

  it("says nothing when nobody knows how many children are coming", () => {
    const result = check(covered(), { childrenExpected: null, childrenPerAdult: 5 });
    expect(result.rag).toBe("green");
  });
});

describe("who may be put on a duty", () => {
  const person = (over: Partial<PersonRow>): PersonRow => ({
    id: nextId++,
    display_name: "Somebody",
    choir: "satb",
    voice_part: null,
    active: 1,
    school_year: null,
    joined_on: null,
    surplice_awarded_on: null,
    deans_award_on: null,
    archbishops_award_on: null,
    gold_award_on: null,
    dbs_valid_until: null,
    gender: null,
    left_on: null,
    ...over,
  });

  // A null school year is what "adult" means here, and it is the only
  // age-shaped fact the app holds.
  it("is adults, and a null school year is what adult means", () => {
    const people = [person({ display_name: "Adult" }), person({ display_name: "Child", school_year: 6 })];
    expect(dutyCandidates(people).map((p) => p.display_name)).toEqual(["Adult"]);
  });

  it("never a child in Reception, which is school year zero", () => {
    expect(dutyCandidates([person({ school_year: 0 })])).toEqual([]);
  });

  it("never somebody who has left", () => {
    expect(dutyCandidates([person({ left_on: "2026-07-31" })])).toEqual([]);
    expect(dutyCandidates([person({ active: 0 })])).toEqual([]);
  });
});

describe("how many children a designation means", () => {
  // The safeguarding count is a different number from the copies count: an
  // adult on duty is supervision, and an adult singing is not a child.
  it("counts the children's choirs and not the adults", () => {
    expect(childrenFor("Boys and SATB")).toBe(childrenFor("Boys"));
    expect(childrenFor("SATB")).toBe(0);
  });

  it("adds up the children's choirs a designation names", () => {
    const boys = childrenFor("Boys")!;
    const girls = childrenFor("Girls")!;
    expect(childrenFor("Boys and Girls")).toBe(boys + girls);
  });

  // Their children are children too, and nobody here knows how many they are
  // bringing. A confident low number on a safeguarding screen is worse than
  // no number at all.
  it("is unknown when a visiting choir is coming", () => {
    expect(childrenFor("Symbel Choir")).toBeNull();
    expect(childrenFor("Girls with Young Voices")).toBeNull();
    expect(childrenFor(null)).toBeNull();
  });

  it("reads Full Choir as all three children's choirs", () => {
    const boys = childrenFor("Boys")!;
    const girls = childrenFor("Girls")!;
    const consort = childrenFor("Consort")!;
    expect(childrenFor("Full Choir")).toBe(boys + girls + consort);
  });
});
