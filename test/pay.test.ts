/**
 * Pay.
 *
 * The one part of this app that produces a figure somebody is handed. Every
 * rule below is about being wrong in a way a chorister would notice — a rate
 * change applied to the wrong side of itself, a missing rate silently read as
 * nought, a penny lost to binary fractions.
 */

import { describe, expect, it } from "vitest";

import {
  RATE_ROLES,
  isRateRole,
  parseQuarterRef,
  payRun,
  penceFrom,
  pounds,
  quarterFor,
  quarterOf,
  rateOn,
  rateRoleFor,
  recentQuarters,
  totalsByPerson,
  type AttendanceLine,
  type RateRow,
} from "../src/pay";
import { toCsv } from "../src/csv";

const RATES: RateRow[] = [
  { id: 1, role: "chorister_service", amount_pence: 400, effective_from: "2026-01-01", created_by: null },
  { id: 2, role: "chorister_service", amount_pence: 500, effective_from: "2026-09-01", created_by: null },
  { id: 3, role: "chorister_wedding", amount_pence: 2500, effective_from: "2026-01-01", created_by: null },
];

function line(over: Partial<AttendanceLine> = {}): AttendanceLine {
  return {
    person_id: 1,
    display_name: "A Chorister",
    choir: "girls",
    service_date: "2026-09-06",
    event_type: "regular",
    ...over,
  };
}

describe("quarters", () => {
  it("puts each month in the right one", () => {
    expect(quarterOf("2026-01-15").ref).toBe("2026-Q1");
    expect(quarterOf("2026-03-31").ref).toBe("2026-Q1");
    expect(quarterOf("2026-04-01").ref).toBe("2026-Q2");
    expect(quarterOf("2026-09-06").ref).toBe("2026-Q3");
    expect(quarterOf("2026-12-31").ref).toBe("2026-Q4");
  });

  it("covers every day of the year between its boundaries", () => {
    for (let q = 1; q <= 4; q++) {
      const quarter = quarterFor(2026, q);
      expect(quarterOf(quarter.from).ref).toBe(quarter.ref);
      expect(quarterOf(quarter.to).ref).toBe(quarter.ref);
    }
    expect(quarterFor(2026, 1).from).toBe("2026-01-01");
    expect(quarterFor(2026, 4).to).toBe("2026-12-31");
  });

  it("reads a reference back, and refuses one that is not", () => {
    expect(parseQuarterRef("2026-Q3")?.ref).toBe("2026-Q3");
    for (const bad of ["2026-Q5", "2026-Q0", "26-Q1", "2026Q1", "", "2026-Q3 "]) {
      expect(parseQuarterRef(bad), bad).toBeNull();
    }
  });

  it("walks back over a year boundary", () => {
    const quarters = recentQuarters("2026-02-10", 3).map((q) => q.ref);
    expect(quarters).toEqual(["2026-Q1", "2025-Q4", "2025-Q3"]);
  });
});

describe("rates", () => {
  it("names two things and refuses a third", () => {
    expect(RATE_ROLES.map((r) => r.value)).toEqual(["chorister_service", "chorister_wedding"]);
    for (const r of RATE_ROLES) expect(isRateRole(r.value)).toBe(true);
    expect(isRateRole("organist")).toBe(false);
  });

  it("pays a wedding at the wedding rate and everything else at the service rate", () => {
    expect(rateRoleFor("wedding")).toBe("chorister_wedding");
    for (const type of ["regular", "concert", "tour", "other"]) {
      expect(rateRoleFor(type)).toBe("chorister_service");
    }
  });

  // The rule the whole file turns on: a rate is a row with a date, and the one
  // that applies is the one in force on the day.
  it("takes the rate in force on the day, not the newest one", () => {
    expect(rateOn(RATES, "chorister_service", "2026-08-31")?.amount_pence).toBe(400);
    expect(rateOn(RATES, "chorister_service", "2026-09-01")?.amount_pence).toBe(500);
    expect(rateOn(RATES, "chorister_service", "2026-12-25")?.amount_pence).toBe(500);
  });

  // Null is a real answer. A service sung before anybody set a rate has no
  // rate, and reading that as £0.00 short-changes somebody silently.
  it("has no rate at all before the first one starts", () => {
    expect(rateOn(RATES, "chorister_service", "2025-12-31")).toBeNull();
    expect(rateOn(RATES, "chorister_wedding", "2025-06-01")).toBeNull();
  });
});

describe("a pay run", () => {
  it("counts services and weddings separately and prices each", () => {
    const run = payRun(quarterFor(2026, 3), [line(), line(), line({ event_type: "wedding" })], RATES);
    const only = run.lines[0]!;
    expect(only.services).toBe(2);
    expect(only.weddings).toBe(1);
    expect(only.pence).toBe(500 + 500 + 2500);
    expect(run.totalPence).toBe(3500);
  });

  // A quarter that straddles a rate change has to come out right without
  // anybody having to notice that it did.
  it("prices a quarter that straddles a rate change per service", () => {
    const run = payRun(
      quarterFor(2026, 3),
      [line({ service_date: "2026-08-30" }), line({ service_date: "2026-09-06" })],
      RATES
    );
    expect(run.totalPence).toBe(400 + 500);
  });

  it("counts an unpriced attendance and does not price it at nothing quietly", () => {
    const run = payRun(quarterFor(2025, 4), [line({ service_date: "2025-11-02" })], RATES);
    expect(run.lines[0]!.services).toBe(1);
    expect(run.lines[0]!.pence).toBe(0);
    expect(run.lines[0]!.unrated).toBe(1);
    expect(run.unrated).toBe(1);
  });

  it("keeps each person on their own line, in the order the run is read in", () => {
    const run = payRun(
      quarterFor(2026, 3),
      [
        line({ person_id: 2, display_name: "Zoe", choir: "girls" }),
        line({ person_id: 3, display_name: "Alan", choir: "boys" }),
        line({ person_id: 2, display_name: "Zoe", choir: "girls" }),
      ],
      RATES
    );
    expect(run.lines.map((l) => l.display_name)).toEqual(["Alan", "Zoe"]);
    expect(run.lines.find((l) => l.display_name === "Zoe")!.services).toBe(2);
  });

  it("is empty and free when nobody sang", () => {
    const run = payRun(quarterFor(2026, 3), [], RATES);
    expect(run.lines).toEqual([]);
    expect(run.totalPence).toBe(0);
  });
});

describe("money", () => {
  // No floating point touches a figure anybody is paid.
  it("prints pence as pounds without losing one", () => {
    expect(pounds(0)).toBe("£0.00");
    expect(pounds(5)).toBe("£0.05");
    expect(pounds(450)).toBe("£4.50");
    expect(pounds(123456)).toBe("£1234.56");
  });

  it("reads pounds back to whole pence", () => {
    expect(penceFrom("4.50")).toBe(450);
    expect(penceFrom("£4.50")).toBe(450);
    expect(penceFrom("4.5")).toBe(450);
    expect(penceFrom("4")).toBe(400);
    expect(penceFrom("1,234.05")).toBe(123405);
  });

  it("refuses anything that is not a figure", () => {
    for (const bad of ["", "four pounds", "4.505", "-4.50", "4.5.0", "£"]) {
      expect(penceFrom(bad), bad).toBeNull();
    }
  });

  it("survives a round trip at every penny of a pound", () => {
    for (let p = 0; p < 100; p++) expect(penceFrom(pounds(1200 + p))).toBe(1200 + p);
  });
});

describe("monthly totals", () => {
  const people = [
    { id: 1, display_name: "Girl", choir: "girls" },
    { id: 2, display_name: "Boy", choir: "boys" },
  ];

  it("counts present against what that person's choir was due at", () => {
    const possible = new Map([
      ["1:2026-09", 4],
      ["2:2026-09", 2],
    ]);
    const totals = totalsByPerson(
      [line({ person_id: 1 }), line({ person_id: 1 }), line({ person_id: 1 })],
      possible,
      people
    );
    const girl = totals.find((t) => t.person_id === 1)!;
    expect(girl.present).toBe(3);
    expect(girl.possible).toBe(4);
    expect(girl.percent).toBe(75);
  });

  // 0% reads as "never turned up"; the truth is "was never asked".
  it("has no percentage at all for somebody due at nothing", () => {
    const totals = totalsByPerson([], new Map(), people);
    expect(totals.every((t) => t.percent === null)).toBe(true);
  });

  it("splits by month, not just by quarter", () => {
    const possible = new Map([
      ["1:2026-07", 1],
      ["1:2026-09", 1],
    ]);
    const totals = totalsByPerson([line({ person_id: 1, service_date: "2026-09-06" })], possible, people);
    const months = totals.find((t) => t.person_id === 1)!.months;
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-09"]);
    expect(months.find((m) => m.month === "2026-07")!.present).toBe(0);
    expect(months.find((m) => m.month === "2026-09")!.present).toBe(1);
  });
});

describe("the CSV a pay run comes out as", () => {
  it("quotes a comma and doubles a quote, so a name survives", () => {
    const csv = toCsv(["Name"], [["Smith, John"], ['He said "hello"']]);
    expect(csv).toContain('"Smith, John"');
    expect(csv).toContain('"He said ""hello"""');
  });

  // Excel reads a cell starting with = as a formula. A name or a note that
  // begins with one is a formula-injection hole in a file somebody else opens.
  it("defuses a cell Excel would run as a formula", () => {
    const csv = toCsv(["Name"], [["=1+1"], ["+44 7700 900123"], ["-5"], ["@SUM(A1)"]]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+44 7700 900123");
    expect(csv).toContain("'-5");
    expect(csv).toContain("'@SUM(A1)");
  });

  // Without the mark, Excel on Windows reads UTF-8 as Windows-1252 and the
  // first chorister with an accent in their name comes out mangled.
  it("starts with a byte-order mark and ends its lines the way Excel does", () => {
    const csv = toCsv(["A"], [["b"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
  });
});
