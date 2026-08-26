/**
 * The seed importer.
 *
 * The property worth testing hardest is idempotency, because the whole point of
 * the importer is that James can re-photograph the shelves, produce a better
 * CSV, and run it again without losing anything. So the last block here runs
 * the real committed file through the planner twice.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mapCategory,
  parseSeedCsv,
  planImport,
  toDraftPiece,
  SeedError,
  type DraftPiece,
  type ExistingPiece,
} from "../src/seed";
import { parseCsv, parseCsvObjects, CsvError } from "../src/csv";
import { canonicalComposer, canonicalTitle, formatAccession, parseAccession, splitTitles } from "../src/normalise";

const SEED_PATH = join(import.meta.dirname, "..", "data", "seed", "bm-music-draft-index.csv");
const SEED_CSV = readFileSync(SEED_PATH, "utf8");

// ---------------------------------------------------------------------------

describe("CSV reading", () => {
  it("keeps a comma inside a quoted field", () => {
    const rows = parseCsv(`ref,titles\nD-004,"Come, let's rejoice"\n`);
    expect(rows[1]).toEqual(["D-004", "Come, let's rejoice"]);
  });

  it("handles doubled quotes and CRLF line endings", () => {
    const rows = parseCsv(`a,b\r\n1,"say ""hello"""\r\n`);
    expect(rows[1]).toEqual(["1", 'say "hello"']);
  });

  it("ignores a byte-order mark on the first header", () => {
    const rows = parseCsvObjects("﻿ref,composer\nD-001,ADAMS\n");
    expect(rows[0]!.ref).toBe("D-001");
  });

  it("pads a short row rather than shifting its columns", () => {
    const rows = parseCsvObjects("ref,composer,flags\nD-001,ADAMS\n");
    expect(rows[0]).toEqual({ ref: "D-001", composer: "ADAMS", flags: "" });
  });

  it("refuses a file that ends inside a quoted value", () => {
    expect(() => parseCsv(`a,b\n1,"unclosed\n`)).toThrow(CsvError);
  });
});

// ---------------------------------------------------------------------------

describe("normalising names", () => {
  it("drops a parenthetical and a doubtful question mark from a composer", () => {
    expect(canonicalComposer("ANON (16th c.)")).toBe("anon");
    expect(canonicalComposer("MAWBY?")).toBe("mawby");
  });

  it("folds accents, so FAURÉ and Faure are the same composer", () => {
    expect(canonicalComposer("FAURÉ")).toBe(canonicalComposer("Faure"));
  });

  it("folds a title's punctuation, case and leading article", () => {
    expect(canonicalTitle("O sing joyfully!")).toBe("o sing joyfully");
    expect(canonicalTitle("The Lord is King")).toBe("lord is king");
  });

  it("splits a joined title on semicolons", () => {
    expect(splitTitles("O sing joyfully; Deliver us O Lord; O praise the Lord")).toEqual([
      "O sing joyfully",
      "Deliver us O Lord",
      "O praise the Lord",
    ]);
  });

  it("round-trips an accession number", () => {
    expect(formatAccession(42, "BM-", 4)).toBe("BM-0042");
    expect(parseAccession("BM-0042", "BM-")).toBe(42);
    expect(parseAccession("OLD-12", "BM-")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("mapping the draft categories", () => {
  it("maps the three that map straight across, without flagging them", () => {
    expect(mapCategory("anthem", "Ave verum")).toMatchObject({ code: "A", inferred: false });
    expect(mapCategory("carol", "Christ is Born")).toMatchObject({ code: "X", inferred: false });
    expect(mapCategory("responses", "Ayleward")).toMatchObject({ code: "R", inferred: false });
  });

  it("reads a morning canticle from its title", () => {
    expect(mapCategory("canticle", "Te Deum Laudamus")).toMatchObject({ code: "M", inferred: true });
    expect(mapCategory("canticle", "Jubilate in B flat")).toMatchObject({ code: "M", inferred: true });
  });

  it("reads a communion setting from its title", () => {
    expect(mapCategory("setting", "The Holy Eucharist")).toMatchObject({ code: "C", inferred: true });
    expect(mapCategory("setting", "Missa Brevis")).toMatchObject({ code: "C", inferred: true });
  });

  // A setting filed by key alone is almost certainly Mag and Nunc — but
  // "almost certainly" is a guess, and a guess must be visible.
  it("assumes a bare 'in E flat' setting is evening canticles, and says so", () => {
    const decision = mapCategory("setting", "in E flat");
    expect(decision.code).toBe("E");
    expect(decision.inferred).toBe(true);
    expect(decision.reason).toContain("assumed");
  });

  it("files a category it does not recognise under solo/other, flagged", () => {
    expect(mapCategory("major work", "Requiem")).toMatchObject({ code: "S", inferred: true });
    expect(mapCategory("", "Something")).toMatchObject({ code: "S", inferred: true });
  });

  it("only ever produces one of the eight codes", () => {
    const codes = new Set(["A", "E", "M", "C", "R", "P", "X", "S"]);
    for (const row of parseSeedCsv(SEED_CSV)) {
      expect(codes).toContain(mapCategory(row.category, row.titles).code);
    }
  });
});

// ---------------------------------------------------------------------------

describe("turning a draft row into a piece", () => {
  const row = {
    ref: "D-032",
    composer: "BOYCE",
    titles: "All the ends of the world; O where shall wisdom; O turn away (Trebles)",
    category: "anthem",
    handwritten: "yes",
    confidence: "0.90",
    source_photos: "IMG_4300",
    flags: "",
  };

  it("keeps the joined title verbatim and adds one alias per title", () => {
    const piece = toDraftPiece(row);
    expect(piece.title).toBe(row.titles);
    expect(piece.aliases.map((a) => a.altName)).toEqual([
      "All the ends of the world",
      "O where shall wisdom",
      "O turn away (Trebles)",
    ]);
  });

  it("adds no aliases to a single-title parcel", () => {
    expect(toDraftPiece({ ...row, titles: "Ave verum" }).aliases).toEqual([]);
  });

  it("carries a low confidence into the review flag", () => {
    const piece = toDraftPiece({ ...row, confidence: "0.55" });
    expect(piece.reviewFlag).toContain("0.55");
  });

  it("leaves a confident, unflagged row unflagged", () => {
    expect(toDraftPiece({ ...row, confidence: "0.95" }).reviewFlag).toBeNull();
  });

  it("carries each of the cataloguer's own flags across verbatim", () => {
    const piece = toDraftPiece({ ...row, flags: "damaged; check" });
    expect(piece.reviewFlag).toContain("damaged");
    expect(piece.reviewFlag).toContain("check");
  });

  it("flags a composer the cataloguer could not read", () => {
    expect(toDraftPiece({ ...row, composer: "MAWBY?" }).reviewFlag).toContain("composer uncertain");
  });

  it("records the label photograph, so the row can be checked against it", () => {
    expect(toDraftPiece(row).notes).toContain("IMG_4300");
    expect(toDraftPiece(row).notes).toContain("handwritten");
  });

  it("survives a row with nothing readable on the label", () => {
    const piece = toDraftPiece({ ...row, composer: "", titles: "", confidence: "0.20" });
    expect(piece.composer).toBe("Unknown");
    expect(piece.title).toBe("(no title read)");
    expect(piece.reviewFlag).toContain("no title read");
    expect(piece.reviewFlag).toContain("no composer read");
  });
});

// ---------------------------------------------------------------------------

describe("planning an import", () => {
  const draft = (ref: string, title = "Ave verum"): DraftPiece =>
    toDraftPiece({
      ref,
      composer: "BYRD",
      titles: title,
      category: "anthem",
      handwritten: "no",
      confidence: "0.95",
      source_photos: "IMG_1",
      flags: "",
    });

  const existingFrom = (id: number, d: DraftPiece, reviewedAt: string | null = null): ExistingPiece => ({
    id,
    legacy_ref: d.legacyRef,
    composer: d.composer,
    composer_canonical: d.composerCanonical,
    title: d.title,
    category: d.category,
    notes: d.notes,
    review_flag: d.reviewFlag,
    reviewed_at: reviewedAt,
  });

  it("inserts everything into an empty catalogue", () => {
    const plan = planImport([draft("D-001"), draft("D-002")], []);
    expect(plan.insert).toHaveLength(2);
    expect(plan.update).toHaveLength(0);
  });

  it("does nothing at all the second time the same file is run", () => {
    const drafts = [draft("D-001"), draft("D-002")];
    const existing = drafts.map((d, i) => existingFrom(i + 1, d));
    const plan = planImport(drafts, existing);
    expect(plan.unchanged).toHaveLength(2);
    expect(plan.insert).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });

  it("refreshes a draft row when the new cut corrects it", () => {
    const before = draft("D-001", "Ave verum");
    const after = draft("D-001", "Ave verum corpus");
    const plan = planImport([after], [existingFrom(7, before)]);
    expect(plan.update).toEqual([{ id: 7, draft: after }]);
  });

  // The rule that protects somebody's afternoon in the song school.
  it("leaves a piece a human has confirmed completely alone", () => {
    const before = draft("D-001", "Ave verum");
    const after = draft("D-001", "Something quite different");
    const plan = planImport([after], [existingFrom(7, before, "2026-08-01T10:00:00Z")]);
    expect(plan.update).toHaveLength(0);
    expect(plan.insert).toHaveLength(0);
    expect(plan.skippedReviewed).toHaveLength(1);
  });

  it("rejects a ref that appears twice rather than silently picking one", () => {
    const plan = planImport([draft("D-001", "One"), draft("D-001", "Two")], []);
    expect(plan.insert).toHaveLength(1);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0]!.reason).toContain("more than once");
  });

  it("rejects a row with no ref, because it could never be matched again", () => {
    const plan = planImport([draft("")], []);
    expect(plan.insert).toHaveLength(0);
    expect(plan.rejected[0]!.ref).toBe("(blank)");
  });
});

// ---------------------------------------------------------------------------

describe("the real committed draft index", () => {
  const rows = parseSeedCsv(SEED_CSV);
  const drafts = rows.map(toDraftPiece);

  it("reads every row", () => {
    expect(rows.length).toBe(324);
    expect(drafts.length).toBe(324);
  });

  it("gives every row a ref, a composer and a title", () => {
    for (const d of drafts) {
      expect(d.legacyRef).toMatch(/^D-\d+$/);
      expect(d.composer.length).toBeGreaterThan(0);
      expect(d.title.length).toBeGreaterThan(0);
    }
  });

  it("finds the 65 multi-title parcels and splits them", () => {
    const multi = drafts.filter((d) => d.aliases.length > 0);
    expect(multi.length).toBe(65);
    const batten = drafts.find((d) => d.legacyRef === "D-026")!;
    expect(batten.aliases.map((a) => a.altName)).toEqual([
      "O sing joyfully",
      "Deliver us O Lord",
      "O praise the Lord",
    ]);
  });

  it("imports the whole file cleanly, with nothing rejected", () => {
    const plan = planImport(drafts, []);
    expect(plan.rejected).toEqual([]);
    expect(plan.insert).toHaveLength(324);
  });

  // The one that matters: re-running the same file changes nothing.
  it("is a complete no-op when re-run against what it just wrote", () => {
    const first = planImport(drafts, []);
    const written: ExistingPiece[] = first.insert.map((d, i) => ({
      id: i + 1,
      legacy_ref: d.legacyRef,
      composer: d.composer,
      composer_canonical: d.composerCanonical,
      title: d.title,
      category: d.category,
      notes: d.notes,
      review_flag: d.reviewFlag,
      reviewed_at: null,
    }));

    const second = planImport(drafts, written);
    expect(second.insert).toHaveLength(0);
    expect(second.update).toHaveLength(0);
    expect(second.rejected).toEqual([]);
    expect(second.unchanged).toHaveLength(324);
  });

  it("flags a good number of rows, but not all of them", () => {
    const flagged = drafts.filter((d) => d.reviewFlag !== null);
    // The draft index is genuinely uncertain in places; if either end of this
    // range breaks, the flagging rules have drifted and want looking at.
    expect(flagged.length).toBeGreaterThan(50);
    expect(flagged.length).toBeLessThan(drafts.length);
  });

  it("refuses a file missing the columns it needs", () => {
    expect(() => parseSeedCsv("composer,titles\nBYRD,Ave verum\n")).toThrow(SeedError);
  });
});
