/**
 * Reading the workbook.
 *
 * The importer's job is not to be clever. It is to read what it can, flag what
 * it cannot, and write nothing until a person says so — and every test here is
 * about one of those three. A reader that quietly guesses a date the American
 * way, or silently skips a sheet it does not recognise, does more harm than one
 * that reads nothing at all.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  choirOfSheet,
  dateFrom,
  findHeaderRow,
  parseWorkbook,
  phoneFrom,
  schoolYearFrom,
} from "../src/importer";
import { readWorkbook } from "../src/xlsx";
import type { PersonRow } from "../src/people";

const WORKBOOK = new Uint8Array(
  readFileSync(join(import.meta.dirname, "fixtures", "workbook.xlsx"))
);

function sheet(name: string, rows: string[][]) {
  return { name, rows };
}

describe("recognising a sheet", () => {
  it("reads the choir out of a tab name", () => {
    expect(choirOfSheet("Girls")).toBe("girls");
    expect(choirOfSheet("Boys register")).toBe("boys");
    expect(choirOfSheet("Consort 2026")).toBe("consort");
    expect(choirOfSheet("JC")).toBe("jc");
    expect(choirOfSheet("Junior Choir")).toBe("jc");
    expect(choirOfSheet("Adults")).toBe("satb");
    expect(choirOfSheet("Team A")).toBe("satb");
  });

  // A sheet silently ignored is a sheet nobody notices is missing, so an
  // unrecognised tab is read and its rows flagged rather than skipped.
  it("says it does not know rather than guessing", () => {
    expect(choirOfSheet("Weddings")).toBeNull();
    expect(choirOfSheet("Sheet1")).toBeNull();
    expect(choirOfSheet("")).toBeNull();
  });

  // Workbooks have a title, a blank line and sometimes a note above the
  // headings. The header is found, not assumed.
  it("finds a header row that is not the first row", () => {
    expect(
      findHeaderRow([["Girls register 2026"], [], ["Name", "School year"], ["Anna", "6"]])
    ).toBe(2);
    expect(findHeaderRow([["Name"]])).toBe(0);
    expect(findHeaderRow([["Total"], ["Sum"]])).toBe(-1);
  });
});

describe("reading a cell", () => {
  it("reads a school year however it is written", () => {
    expect(schoolYearFrom("6")).toBe(6);
    expect(schoolYearFrom("Year 6")).toBe(6);
    expect(schoolYearFrom("Yr 6")).toBe(6);
    expect(schoolYearFrom("Y6")).toBe(6);
    expect(schoolYearFrom("Reception")).toBe(0);
    expect(schoolYearFrom("R")).toBe(0);
  });

  it("refuses a school year that is not one", () => {
    expect(schoolYearFrom("")).toBeNull();
    expect(schoolYearFrom("14")).toBeNull();
    expect(schoolYearFrom("sixth form")).toBeNull();
    expect(schoolYearFrom("6a")).toBeNull();
  });

  it("reads a date from a serial, an ISO date, and a British one", () => {
    expect(dateFrom("2019-09-12")).toBe("2019-09-12");
    expect(dateFrom("12/09/2019")).toBe("2019-09-12");
    expect(dateFrom("12.9.2019")).toBe("2019-09-12");
    expect(dateFrom("45900")).toBe("2025-08-31");
  });

  // British order, because this is a British workbook. A value it cannot place
  // comes back null and is flagged, rather than being read the American way
  // and quietly wrong for every date before the thirteenth of a month.
  it("reads a slashed date the British way round", () => {
    expect(dateFrom("01/02/2020")).toBe("2020-02-01");
    expect(dateFrom("13/02/2020")).toBe("2020-02-13");
    // 13 cannot be a month, so an American reading is impossible here — which
    // is exactly why the unambiguous case must not be the one that decides.
    expect(dateFrom("02/13/2020")).toBeNull();
  });

  it("refuses a date it cannot place", () => {
    expect(dateFrom("")).toBeNull();
    expect(dateFrom("summer term")).toBeNull();
    expect(dateFrom("32/01/2020")).toBeNull();
  });

  it("takes a telephone number as written, and a note as nothing", () => {
    expect(phoneFrom("07700 900123")).toBe("07700 900123");
    expect(phoneFrom("+44 7700 900123")).toBe("+44 7700 900123");
    expect(phoneFrom("ask mum")).toBeNull();
    expect(phoneFrom("123")).toBeNull();
    expect(phoneFrom("")).toBeNull();
  });
});

describe("reading a workbook", () => {
  const existing: PersonRow[] = [
    {
      id: 1,
      display_name: "Anna O'Brien",
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
    },
  ];

  const girls = sheet("Girls", [
    ["Name", "School year", "Joined", "Parent phone"],
    ["Beth Clarke", "Year 6", "12/09/2019", "07700 900123"],
    ["Cara Dunn", "R", "2021-01-04", "ask mum"],
  ]);

  it("proposes a person per row, keeping where it came from", () => {
    const result = parseWorkbook([girls], []);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.sheet).toBe("Girls");
    expect(result.rows[0]!.rowNumber).toBe(2);
    expect(result.rows[0]!.person.displayName).toBe("Beth Clarke");
    expect(result.rows[0]!.person.choir).toBe("girls");
    expect(result.rows[0]!.person.schoolYear).toBe(6);
    expect(result.rows[0]!.person.joinedOn).toBe("2019-09-12");
  });

  // Kept apart from the person from the very first moment, so that no code
  // path exists in which a number is a property of a person.
  it("keeps a telephone number in its own list, never on the person", () => {
    const result = parseWorkbook([girls], []);
    expect(result.rows[0]!.person.contacts).toEqual([
      { label: "parent phone", name: null, phone: "07700 900123" },
    ]);
    expect(result.rows[1]!.person.contacts).toEqual([]);
    expect(JSON.stringify(result.rows[0]!.person)).not.toMatch(/"phone":"07700 900123","displayName"/);
  });

  it("flags a name already on the choir list rather than merging it", () => {
    const result = parseWorkbook(
      [sheet("Girls", [["Name"], ["Anna O'Brien"]])],
      existing
    );
    expect(result.rows[0]!.issue).toMatch(/already on the choir list/);
  });

  it("flags a school year it could not read, and keeps the rest of the row", () => {
    const result = parseWorkbook(
      [sheet("Girls", [["Name", "School year"], ["Dee Evans", "sixth form"]])],
      []
    );
    expect(result.rows[0]!.person.displayName).toBe("Dee Evans");
    expect(result.rows[0]!.person.schoolYear).toBeNull();
    expect(result.rows[0]!.issue).toMatch(/sixth form/);
  });

  it("flags a date it could not read, naming which one", () => {
    const result = parseWorkbook(
      [sheet("Girls", [["Name", "Joined"], ["Dee Evans", "summer term"]])],
      []
    );
    expect(result.rows[0]!.issue).toMatch(/joined "summer term"/);
  });

  // Not skipped, not guessed at: read, and every row flagged, so a sheet
  // nobody expected is a sheet somebody looks at.
  it("reads a sheet it cannot place and flags every row", () => {
    const result = parseWorkbook([sheet("Weddings", [["Name"], ["Fay Green"]])], []);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.person.choir).toBe("");
    expect(result.rows[0]!.issue).toMatch(/does not say which choir/);
  });

  it("says why it read nothing from a sheet, rather than passing over it", () => {
    const result = parseWorkbook([sheet("Notes", [["Remember to"], ["ring the school"]])], []);
    expect(result.rows).toHaveLength(0);
    expect(result.sheets[0]!.skipped).toMatch(/Name/);
  });

  it("ignores a blank row without treating it as the end of the sheet", () => {
    const result = parseWorkbook(
      [sheet("Girls", [["Name"], ["Beth Clarke"], [""], ["Cara Dunn"]])],
      []
    );
    expect(result.rows.map((r) => r.person.displayName)).toEqual(["Beth Clarke", "Cara Dunn"]);
    expect(result.rows[1]!.rowNumber).toBe(4);
  });

  it("counts what it read from each sheet", () => {
    const result = parseWorkbook([girls, sheet("Boys", [["Name"], ["Ian Hall"]])], []);
    expect(result.sheets).toEqual([
      { name: "Girls", choir: "girls", rows: 2, skipped: null },
      { name: "Boys", choir: "boys", rows: 1, skipped: null },
    ]);
  });
});

describe("end to end, against a real .xlsx", () => {
  it("reads the fixture workbook into proposed people", async () => {
    const sheets = await readWorkbook(WORKBOOK);
    const result = parseWorkbook(sheets, []);

    // The "Dates" tab names no choir; "Girls & Consort" names two and the
    // first match wins — which is why it is flagged, not silently resolved.
    const names = result.rows.map((r) => r.person.displayName);
    expect(names).toContain("Anna O'Brien");
    expect(names).toContain("Beth Clarke");

    const anna = result.rows.find((r) => r.person.displayName === "Anna O'Brien")!;
    expect(anna.person.schoolYear).toBe(6);
    expect(anna.person.joinedOn).toBe("2025-08-31");
    expect(anna.person.contacts.map((c) => c.phone)).toEqual(["07700 900123"]);
  });
});
