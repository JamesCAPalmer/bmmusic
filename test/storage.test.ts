/**
 * The cupboards.
 *
 * Eight doors along a wall in the song school, lettered `A`–`H` and named after
 * diesel locomotive classes. The names are a good joke and a genuinely useful
 * mnemonic — "it's in Deltic" survives being called across a room in a way that
 * "it's in D" does not — but they are only safe to have because of one
 * invariant, and that invariant is what this file protects:
 *
 * **The letter is stored. The name is only ever displayed.**
 *
 * Every `holding.location_door` in D1 holds a letter. Every label already stuck
 * to a spine carries a letter. Every volunteer who has learned the wall knows
 * the letters. If a name ever became the stored value, renaming a cupboard
 * would mean a migration and a reprint, and the joke would have quietly become
 * a schema.
 */

import { describe, expect, it } from "vitest";
import { CHURCH } from "../src/church.config";
import { doorByLetter, doorLabel, doorLabelLong, doorLetters, isDoorLetter, shelfAddress } from "../src/storage";

describe("the letter is the identity", () => {
  /**
   * The one that keeps the names cosmetic. If this ever passes for a name, a
   * cupboard's name has become writable into the database and renaming one
   * stops being free.
   */
  it("accepts a letter and refuses a name", () => {
    expect(isDoorLetter("A")).toBe(true);
    expect(isDoorLetter("Deltic")).toBe(false);
    expect(isDoorLetter("A · Deltic")).toBe(false);
    expect(isDoorLetter("")).toBe(false);
    expect(isDoorLetter("Z")).toBe(false);
  });

  it("offers exactly the letters, and nothing else, as the stored vocabulary", () => {
    expect(doorLetters()).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
  });

  it("gives every cupboard a distinct letter and a distinct name", () => {
    const letters = CHURCH.storage.doors.map((d) => d.letter);
    const names = CHURCH.storage.doors.map((d) => d.name);
    expect(new Set(letters).size, "two cupboards share a letter").toBe(letters.length);
    expect(new Set(names).size, "two cupboards share a name").toBe(names.length);
  });

  it("runs the letters in order along the wall", () => {
    // The letters are the order you walk past them; the names deliberately are
    // not in any order, which is what makes them memorable.
    expect(doorLetters()).toEqual([...doorLetters()].sort());
  });
});

describe("how a cupboard reads", () => {
  it("puts the letter first, because that is what is painted on the door", () => {
    expect(doorLabel("A")).toBe("A · Deltic");
    expect(doorLabelLong("A")).toBe("A · Deltic (Class 55)");
  });

  /**
   * A holding whose cupboard has since been taken out of the config still has
   * to say where the box is. "F, shelf 2" is worth a great deal more to
   * somebody looking for it than a blank or the word "unknown".
   */
  it("falls back to the bare letter rather than losing the address", () => {
    expect(doorLabel("Q")).toBe("Q");
    expect(doorLabelLong("Q")).toBe("Q");
    expect(shelfAddress("Q", 3)).toBe("Q, shelf 3");
  });

  it("writes a full address, and declines to write half of one", () => {
    expect(shelfAddress("E", 4)).toBe("E · Hymek, shelf 4");
    // A cupboard with no shelf recorded is still an address.
    expect(shelfAddress("E", null)).toBe("E · Hymek");
    // A shelf with no cupboard is not: there are eight shelf 4s.
    expect(shelfAddress(null, 4)).toBe(null);
    expect(shelfAddress(null, null)).toBe(null);
  });

  it("finds a cupboard by its letter, and nothing by a name", () => {
    expect(doorByLetter("H")?.name).toBe("Duff");
    expect(doorByLetter("Duff")).toBe(null);
  });
});

describe("the names are real locomotive classes", () => {
  /**
   * Not pedantry: the whole value of the joke is that Robert can tell it is a
   * real class list rather than eight words that sound vaguely railway-ish, and
   * the class number in the caption is what lets anybody who is not Robert
   * follow it. A blank or malformed one gives the game away.
   */
  it("carries a class number for every cupboard", () => {
    for (const door of CHURCH.storage.doors) {
      expect(door.loco, `${door.name} has no class`).toMatch(/^Class \d{1,3}$/);
      expect(door.name.length, `${door.letter} has no name`).toBeGreaterThan(2);
    }
  });
});
