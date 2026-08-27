/**
 * Label geometry.
 *
 * Both stocks are physical things in a box in Beverley, and the numbers below
 * have to match them to a fraction of a millimetre or the print lands off the
 * die-cut. The failure mode is expensive and slow to notice: a 410-sheet run
 * where every label is 5mm out and nobody sees it until the third sheet has
 * been stuck to a parcel.
 *
 * So this file tests the arithmetic rather than the PDF. Where a label *goes*
 * is the part most likely to be quietly wrong; whether pdf-lib can draw a
 * rectangle is not in doubt.
 */

import { describe, expect, it } from "vitest";
import {
  fitText,
  glyphFor,
  gridFits,
  labelsPerSheet,
  mm,
  qrTargetFor,
  slotFor,
  CATEGORY_GLYPHS,
} from "../src/labels";
import { CHURCH } from "../src/church.config";
import { choirsExpectedFor, isChoir, isVoicePart, nextStatus, registerTally } from "../src/people";

const volunteer = CHURCH.labels.volunteerSheet;
const avery = CHURCH.labels.avery;

describe("the label stocks fit their paper", () => {
  // This caught a real mistake while it was being written: an early draft had
  // the Avery left margin at 7.2mm, which made two 99.1mm columns plus a 2.5mm
  // gap 5mm wider than an A4 sheet. The only symptom in the world would have
  // been a column of labels printed off the edge of the paper.
  it("keeps every label on the page", () => {
    expect(gridFits(volunteer), "the volunteer sheet overflows A4").toBe(true);
    expect(gridFits(avery), "the Avery sheet overflows A4").toBe(true);
  });

  it("holds the number of labels the packaging claims", () => {
    expect(labelsPerSheet(avery)).toBe(14);
    expect(labelsPerSheet(volunteer)).toBe(1);
  });

  it("is A4, both of them", () => {
    for (const grid of [volunteer, avery]) {
      expect(grid.pageWidth).toBe(210);
      expect(grid.pageHeight).toBe(297);
    }
  });

  // Measured off the stock: 110×60mm, 10mm from the left, 49mm from the top.
  it("puts the volunteer label exactly where the sheet's die-cut is", () => {
    const slot = slotFor(volunteer, 0);
    expect(slot).toEqual({ x: 10, y: 49, width: 110, height: 60 });
  });

  // Avery L7163: horizontal pitch 101.6mm (four inches), vertical pitch 38.1mm
  // with the rows butting up.
  it("lays the Avery sheet out on its published pitch", () => {
    const first = slotFor(avery, 0);
    const secondColumn = slotFor(avery, 1);
    const secondRow = slotFor(avery, 2);

    expect(secondColumn.x - first.x).toBeCloseTo(101.6, 5);
    expect(secondColumn.y).toBe(first.y);
    expect(secondRow.y - first.y).toBeCloseTo(38.1, 5);
    expect(secondRow.x).toBe(first.x);
  });

  // Seven rows of 38.1mm is 266.7mm, leaving 30.3mm to share top and bottom —
  // which does not halve evenly, so Avery publishes 15.1mm at the top and the
  // remaining 15.2mm falls at the bottom. A tenth of a millimetre is far inside
  // what a sheet-fed printer holds; what matters is that the run is centred
  // rather than drifting down the page.
  it("centres the Avery rows top and bottom, to within the odd tenth", () => {
    const last = slotFor(avery, labelsPerSheet(avery) - 1);
    const bottomMargin = avery.pageHeight - (last.y + last.height);
    expect(Math.abs(bottomMargin - avery.marginTop)).toBeLessThanOrEqual(0.15);
  });
});

describe("where a label goes on the sheet", () => {
  // Reading order, because that is how somebody peeling labels off works
  // through a sheet. Going down the columns would be baffling on a part-used one.
  it("fills left to right, then down", () => {
    expect(slotFor(avery, 0)).toMatchObject({ x: avery.marginLeft, y: avery.marginTop });
    expect(slotFor(avery, 1).y).toBe(avery.marginTop);
    expect(slotFor(avery, 2).y).toBeGreaterThan(avery.marginTop);
  });

  // The start position exists so a sheet with four labels already peeled off is
  // not thrown away (H10).
  it("wraps round onto the next sheet", () => {
    const perSheet = labelsPerSheet(avery);
    expect(slotFor(avery, perSheet)).toEqual(slotFor(avery, 0));
    expect(slotFor(avery, perSheet + 3)).toEqual(slotFor(avery, 3));
  });

  it("never places a label outside the page", () => {
    for (const grid of [volunteer, avery]) {
      for (let i = 0; i < labelsPerSheet(grid); i++) {
        const slot = slotFor(grid, i);
        expect(slot.x).toBeGreaterThanOrEqual(0);
        expect(slot.y).toBeGreaterThanOrEqual(0);
        expect(slot.x + slot.width).toBeLessThanOrEqual(grid.pageWidth);
        expect(slot.y + slot.height).toBeLessThanOrEqual(grid.pageHeight);
      }
    }
  });

  // Avery's rows butt up — the vertical pitch is exactly the label height — so
  // adjacent labels are meant to touch. The tolerance is for that, and for the
  // last bit of floating point: 15.1 + 38.1 + 38.1 and 15.1 + 2 × 38.1 differ
  // in the sixteenth decimal place, which is not a printing problem.
  it("never overlaps two labels by anything a printer could show", () => {
    const TOUCHING = 0.001; // millimetres
    const slots = Array.from({ length: labelsPerSheet(avery) }, (_, i) => slotFor(avery, i));

    for (let a = 0; a < slots.length; a++) {
      for (let b = a + 1; b < slots.length; b++) {
        const one = slots[a]!;
        const two = slots[b]!;
        const apart =
          one.x + one.width - two.x <= TOUCHING ||
          two.x + two.width - one.x <= TOUCHING ||
          one.y + one.height - two.y <= TOUCHING ||
          two.y + two.height - one.y <= TOUCHING;
        expect(apart, `labels ${a} and ${b} overlap`).toBe(true);
      }
    }
  });
});

describe("millimetres to PDF points", () => {
  it("converts at 72 points to the inch", () => {
    expect(mm(25.4)).toBeCloseTo(72, 6);
    expect(mm(210)).toBeCloseTo(595.28, 1); // A4 width in points
    expect(mm(297)).toBeCloseTo(841.89, 1); // A4 height
  });
});

describe("category glyphs", () => {
  // Both a glyph and a letter, per the brief: the glyph is quick to spot along
  // a shelf, the letter survives a label gone brown after twenty years.
  it("has a glyph for every category the catalogue uses", () => {
    for (const category of CHURCH.categories) {
      expect(CATEGORY_GLYPHS[category.code], `no glyph for ${category.code}`).toBeDefined();
    }
  });

  it("falls back rather than printing nothing for an unknown category", () => {
    expect(glyphFor("Z")).toBe(CATEGORY_GLYPHS.S);
  });

  it("draws every glyph inside its 24×24 box", () => {
    for (const [code, glyph] of Object.entries(CATEGORY_GLYPHS)) {
      const numbers = `${glyph.path} ${glyph.strokePath ?? ""}`.match(/-?\d+(\.\d+)?/g) ?? [];
      for (const n of numbers) {
        expect(Number(n), `${code} draws outside its box at ${n}`).toBeLessThanOrEqual(24);
        expect(Number(n)).toBeGreaterThanOrEqual(-1);
      }
    }
  });
});

describe("the QR target (H1)", () => {
  // Domain-move-safe: the accession is written on the parcel in ink and is the
  // one identifier that cannot go stale, so the QR encodes that rather than a
  // piece id that a re-import could renumber.
  it("encodes the accession, not the database id", () => {
    expect(qrTargetFor("BM-0042")).toBe("https://bmmusic.james-palmer.com/q/BM-0042");
  });

  it("uses the app domain from config, so a fork moves with one edit", () => {
    expect(qrTargetFor("BM-0001")).toContain(CHURCH.domains.app);
  });

  it("escapes anything odd in an accession rather than producing a broken URL", () => {
    expect(qrTargetFor("BM 1/2")).toBe("https://bmmusic.james-palmer.com/q/BM%201%2F2");
  });
});

describe("fitting text to a label", () => {
  // Every character is one unit wide, which makes the arithmetic checkable.
  const measure = (s: string) => s.length;

  it("leaves text that already fits alone", () => {
    expect(fitText("Ave verum", 20, measure)).toBe("Ave verum");
  });

  it("cuts text that does not, and says it has been cut", () => {
    const fitted = fitText("O sing joyfully unto God our strength", 12, measure);
    expect(fitted.endsWith("…")).toBe(true);
    expect(measure(fitted)).toBeLessThanOrEqual(12);
  });

  it("does not cut away the whole string", () => {
    expect(fitText("Magnificat", 2, measure).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("the register", () => {
  // The music list writes designations as prose — "Boys and SATB", "Girls and
  // Team B" — so the register works out who to expect from the words present.
  it("expects the choirs the designation names", () => {
    expect(choirsExpectedFor("Boys and SATB")).toEqual(["boys", "satb"]);
    expect(choirsExpectedFor("Girls and Team B")).toEqual(["girls"]);
    expect(choirsExpectedFor("Consort")).toEqual(["consort"]);
  });

  it("is not fooled by capitals", () => {
    expect(choirsExpectedFor("BOYS AND SATB")).toEqual(["boys", "satb"]);
  });

  // "Symbel choir", "Liturgy Singers" and the feed's "RCSM" name none of ours.
  // Showing an empty register at the door is worse than showing a long one:
  // the person holding the phone cannot tell empty apart from broken.
  it("expects everybody when the designation names no choir we know", () => {
    expect(choirsExpectedFor("Symbel choir")).toEqual(["boys", "girls", "consort", "satb"]);
    expect(choirsExpectedFor(null)).toEqual(["boys", "girls", "consort", "satb"]);
    expect(choirsExpectedFor("")).toEqual(["boys", "girls", "consort", "satb"]);
  });

  // Each name is one button tapped down a list at a door, so the cycle has to
  // come back round — somebody who taps one name too many needs a way out.
  it("cycles through the three states and back to unmarked", () => {
    expect(nextStatus(null)).toBe("present");
    expect(nextStatus("present")).toBe("absent");
    expect(nextStatus("absent")).toBe("excused");
    expect(nextStatus("excused")).toBeNull();
  });

  it("counts the register up", () => {
    const rows = [
      { status: "present" },
      { status: "present" },
      { status: "absent" },
      { status: "excused" },
      { status: null },
    ] as Parameters<typeof registerTally>[0];
    expect(registerTally(rows)).toEqual({ present: 2, absent: 1, excused: 1, unmarked: 1 });
  });

  it("only recognises the choirs the schema allows", () => {
    expect(isChoir("boys")).toBe(true);
    expect(isChoir("trebles")).toBe(false);
    expect(isVoicePart("tenor1")).toBe(true);
    expect(isVoicePart("descant")).toBe(false);
  });
});
