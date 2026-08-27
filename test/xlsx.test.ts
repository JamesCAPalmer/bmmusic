/**
 * The XLSX reader, against a real .xlsx.
 *
 * `test/fixtures/workbook.xlsx` is a genuine ZIP written by `zipfile`, not a
 * mock: mixed stored and deflated entries, a shared string table, a rich-text
 * run split across two `<t>` elements, an escaped apostrophe, an inline
 * string, a date serial, and a row with a gap in the middle. Every one of
 * those is something a real workbook does and a naive reader gets wrong.
 *
 * See `test/fixtures/README.md` for how to rebuild it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { XlsxError, columnIndex, readWorkbook, serialToDate } from "../src/xlsx";

const WORKBOOK = new Uint8Array(
  readFileSync(join(import.meta.dirname, "fixtures", "workbook.xlsx"))
);

describe("column references", () => {
  it("reads letters as base-26 with no zero", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("B1")).toBe(1);
    expect(columnIndex("Z1")).toBe(25);
    expect(columnIndex("AA1")).toBe(26);
    expect(columnIndex("AB12")).toBe(27);
    expect(columnIndex("BC12")).toBe(54);
  });
});

describe("reading a workbook", () => {
  it("finds the sheets, in order, named as the tabs are", async () => {
    const sheets = await readWorkbook(WORKBOOK);
    expect(sheets.map((s) => s.name)).toEqual(["Dates", "Girls & Consort"]);
  });

  it("reads a shared string", async () => {
    const [dates] = await readWorkbook(WORKBOOK);
    expect(dates!.rows[0]).toEqual(["Name", "School year", "Joined", "Parent phone"]);
  });

  // Excel splits a cell into runs when any part of it is formatted
  // differently. A reader that takes the first `<t>` gets "Beth ".
  it("joins a rich-text cell back into one string", async () => {
    const [dates] = await readWorkbook(WORKBOOK);
    expect(dates!.rows[2]![0]).toBe("Beth Clarke");
  });

  it("unescapes an entity, so an apostrophe in a name survives", async () => {
    const [dates] = await readWorkbook(WORKBOOK);
    expect(dates!.rows[1]![0]).toBe("Anna O'Brien");
  });

  it("reads a number and an inline string", async () => {
    const [dates] = await readWorkbook(WORKBOOK);
    expect(dates!.rows[1]![1]).toBe("6");
    expect(dates!.rows[2]![3]).toBe("07700 900456");
  });

  /**
   * The one that matters most.
   *
   * Row 3 has no cell at all in column C. A reader that just appends cells as
   * it meets them puts the telephone number in the Joined column and every
   * column after a gap is wrong — silently, and for exactly the rows where
   * something was left blank.
   */
  it("holds a blank cell's place, so no column shifts", async () => {
    const [dates] = await readWorkbook(WORKBOOK);
    expect(dates!.rows[2]).toEqual(["Beth Clarke", "8", "", "07700 900456"]);
  });

  it("reads a sheet stored without compression as well as a deflated one", async () => {
    const sheets = await readWorkbook(WORKBOOK);
    expect(sheets[1]!.rows[1]).toEqual(["Anna O'Brien", "1"]);
    expect(sheets[1]!.rows[2]).toEqual(["Beth Clarke", "A"]);
  });

  it("keeps an empty row rather than dropping it", async () => {
    const sheets = await readWorkbook(WORKBOOK);
    expect(sheets[1]!.rows.length).toBe(4);
    expect(sheets[1]!.rows[3]).toEqual([]);
  });
});

describe("when it cannot read something", () => {
  it("says so in a sentence rather than throwing a parser error", async () => {
    await expect(readWorkbook(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(XlsxError);
    await expect(readWorkbook(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(
      /does not look like a spreadsheet/i
    );
  });

  it("refuses a ZIP that is not a workbook", async () => {
    // A valid empty ZIP: end-of-central-directory and nothing else.
    const emptyZip = new Uint8Array(22);
    new DataView(emptyZip.buffer).setUint32(0, 0x06054b50, true);
    await expect(readWorkbook(emptyZip)).rejects.toThrow(/not an Excel workbook/i);
  });
});

describe("date serials", () => {
  // Excel counts from 1899-12-30 because it believes 1900 was a leap year;
  // the offset absorbs the phantom 29 February.
  it("converts the serials Excel actually writes", () => {
    expect(serialToDate(1)).toBe("1899-12-31");
    expect(serialToDate(45292)).toBe("2024-01-01");
    expect(serialToDate(45900)).toBe("2025-08-31");
    expect(serialToDate(46266)).toBe("2026-09-01");
  });

  it("refuses a number that cannot be a date", () => {
    expect(serialToDate(0)).toBeNull();
    expect(serialToDate(-1)).toBeNull();
    expect(serialToDate(NaN)).toBeNull();
    expect(serialToDate(99999999)).toBeNull();
  });

  it("ignores the time of day", () => {
    expect(serialToDate(45900.75)).toBe(serialToDate(45900));
  });
});
