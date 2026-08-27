/**
 * Drawing the label sheets.
 *
 * Kept apart from `src/labels.ts` — which holds the geometry, the glyphs and
 * the QR, all of it pure and testable — because everything here needs pdf-lib
 * and a real document. The split means the arithmetic that decides *where a
 * label goes* can be tested without producing a PDF, which is the part most
 * likely to be quietly wrong.
 */

import type { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import { CHURCH, type LabelGrid } from "./church.config";
import {
  fitText,
  glyphFor,
  labelsPerSheet,
  mm,
  qrMatrixFor,
  slotFor,
  type LabelContent,
} from "./labels";

async function pdfLib() {
  return import("pdf-lib");
}

/**
 * Millimetres from the top of the page → PDF's y-axis, which counts up from the
 * bottom.
 *
 * Every geometry figure in `church.config` is measured from the top-left,
 * because that is how label packaging describes a sheet and how somebody with a
 * ruler measures one. This is the single place that flip happens.
 */
function topDown(grid: LabelGrid, millimetresFromTop: number): number {
  return mm(grid.pageHeight - millimetresFromTop);
}

interface Ink {
  font: PDFFont;
  bold: PDFFont;
}

/**
 * The calibration page.
 *
 * Draws the die-cut outline, a centre cross and a ruler scale — and nothing
 * else. James holds it against a real sheet before committing the Brother to a
 * 410-sheet run. Finding out afterwards that the printer is 3mm out is an
 * expensive way to learn it.
 */
async function drawCalibrationPage(doc: PDFDocument, grid: LabelGrid, ink: Ink): Promise<void> {
  const { rgb } = await pdfLib();
  const page = doc.addPage([mm(grid.pageWidth), mm(grid.pageHeight)]);

  for (let i = 0; i < labelsPerSheet(grid); i++) {
    const slot = slotFor(grid, i);
    page.drawRectangle({
      x: mm(slot.x),
      y: topDown(grid, slot.y + slot.height),
      width: mm(slot.width),
      height: mm(slot.height),
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.5,
    });

    // A cross at the centre: if the print is out, this is where you see it.
    const cx = mm(slot.x + slot.width / 2);
    const cy = topDown(grid, slot.y + slot.height / 2);
    page.drawLine({ start: { x: cx - mm(5), y: cy }, end: { x: cx + mm(5), y: cy }, thickness: 0.4 });
    page.drawLine({ start: { x: cx, y: cy - mm(5) }, end: { x: cx, y: cy + mm(5) }, thickness: 0.4 });
  }

  const lines = [
    "Calibration page — do not stick anything to this one.",
    `Stock: ${grid.stock}`,
    "",
    "Hold this against a blank sheet of the label stock, up to the light.",
    "The rectangles should sit exactly on the die-cut edges.",
    "",
    "If they are out, it is the printer's margins rather than this file:",
    "print again with scaling set to 100% / 'Actual size', not 'Fit to page'.",
  ];

  let y = topDown(grid, grid.marginTop + grid.rows * grid.labelHeight + 14);
  for (const line of lines) {
    page.drawText(line, { x: mm(grid.marginLeft), y, size: 9, font: ink.font });
    y -= 12;
  }
}

/**
 * One label's contents, inside the die-cut area.
 *
 * The layout, top to bottom: glyph and category letter top-left, accession
 * top-right in large type, surname in capitals, then the title. The QR sits
 * bottom-right where a thumb does not usually land.
 *
 * **No location is printed** (3A). Parcels move; a label that names a shelf
 * becomes a lie the first time somebody tidies, and an accession number plus
 * the catalogue is a better answer to "where does this live?".
 */
async function drawLabel(
  page: PDFPage,
  grid: LabelGrid,
  slot: { x: number; y: number; width: number; height: number },
  content: LabelContent,
  ink: Ink
): Promise<void> {
  const { rgb } = await pdfLib();
  const pad = grid.safeMargin;
  const left = slot.x + pad;
  const innerWidth = slot.width - pad * 2;

  // --- category glyph and letter, top left ---
  const glyphSize = Math.min(slot.height * 0.22, 7);
  await drawGlyph(page, grid, content.category, left, slot.y + pad, glyphSize);
  page.drawText(content.category, {
    x: mm(left + glyphSize + 1.2),
    y: topDown(grid, slot.y + pad + glyphSize * 0.78),
    size: glyphSize * 2.4,
    font: ink.bold,
  });

  // --- accession, top right, large ---
  const accessionSize = Math.min(slot.height * 0.3, 11) * 2.2;
  if (content.accession) {
    const width = ink.bold.widthOfTextAtSize(content.accession, accessionSize);
    page.drawText(content.accession, {
      x: mm(slot.x + slot.width - pad) - width,
      y: topDown(grid, slot.y + pad + glyphSize * 0.78),
      size: accessionSize,
      font: ink.bold,
    });
  }

  // --- surname, in capitals ---
  // Capitals are a THEME decision made here at the point of printing. The data
  // stays in proper case, so a fork that prefers "Stanford" changes this line.
  const surnameSize = Math.min(slot.height * 0.26, 9) * 2.4;
  const surnameY = slot.y + pad + glyphSize + 5;
  page.drawText(
    fitText(content.surname.toUpperCase(), mm(innerWidth), (s) =>
      ink.bold.widthOfTextAtSize(s, surnameSize)
    ),
    { x: mm(left), y: topDown(grid, surnameY + surnameSize / 2.9), size: surnameSize, font: ink.bold }
  );

  // --- title, wrapped over up to three lines ---
  const titleSize = Math.min(slot.height * 0.2, 7) * 2.1;
  const qrSide = Math.min(slot.height * 0.42, 18);
  // Keep the title clear of the QR block in the bottom-right corner.
  const titleWidth = innerWidth - (content.accession ? qrSide + 2 : 0);
  let titleY = surnameY + surnameSize / 2.4 + 3;

  for (const line of wrap(content.title, mm(titleWidth), (s) => ink.font.widthOfTextAtSize(s, titleSize), 3)) {
    page.drawText(line, { x: mm(left), y: topDown(grid, titleY + titleSize / 2.9), size: titleSize, font: ink.font });
    titleY += titleSize / 2.4;
  }

  // --- boxmates, for a combined label ---
  if (content.boxmates?.length) {
    const noteSize = titleSize * 0.82;
    const note = fitText(
      `with ${content.boxmates.join(", ")}`,
      mm(titleWidth),
      (s) => ink.font.widthOfTextAtSize(s, noteSize)
    );
    page.drawText(note, {
      x: mm(left),
      y: topDown(grid, titleY + noteSize / 2.9),
      size: noteSize,
      font: ink.font,
      color: rgb(0.35, 0.35, 0.35),
    });
  }

  // --- QR, bottom right ---
  if (content.accession) {
    await drawQr(
      page,
      grid,
      content.accession,
      slot.x + slot.width - pad - qrSide,
      slot.y + slot.height - pad - qrSide,
      qrSide
    );
  }
}

/** Break text into at most `maxLines` lines that fit, eliding the overflow. */
function wrap(text: string, maxWidth: number, measure: (s: string) => number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  // Anything that did not fit is elided on the last line, so a long title reads
  // as "cut short" rather than as a different piece.
  const used = lines.join(" ");
  if (used.length < text.length && lines.length) {
    lines[lines.length - 1] = fitText(`${lines[lines.length - 1]!}…`, maxWidth, measure);
  }
  return lines;
}

/** Draw a category glyph as filled paths at a given size in millimetres. */
async function drawGlyph(
  page: PDFPage,
  grid: LabelGrid,
  category: string,
  x: number,
  y: number,
  size: number
): Promise<void> {
  const { rgb } = await pdfLib();
  const glyph = glyphFor(category);
  // The paths are authored in a 24×24 box; scale to the requested size.
  const scale = mm(size) / 24;

  page.drawSvgPath(glyph.path, {
    x: mm(x),
    y: topDown(grid, y),
    scale,
    color: rgb(0, 0, 0),
  });
  if (glyph.strokePath) {
    page.drawSvgPath(glyph.strokePath, {
      x: mm(x),
      y: topDown(grid, y),
      scale,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.8,
    });
  }
}

/**
 * Draw a QR as filled squares.
 *
 * Each module is drawn a whisker larger than its true size so that adjacent
 * modules meet rather than leaving hairlines between them — a laser printer
 * renders a hairline as a visible white gap, and enough of those defeat a
 * scanner.
 */
async function drawQr(
  page: PDFPage,
  grid: LabelGrid,
  accession: string,
  x: number,
  y: number,
  side: number
): Promise<void> {
  const { rgb } = await pdfLib();
  const matrix = await qrMatrixFor(accession);
  // A quiet zone is part of the spec, not decoration: without it a scanner
  // cannot find the code against a busy label.
  const quiet = 2;
  const modules = matrix.size + quiet * 2;
  const module = side / modules;

  page.drawRectangle({
    x: mm(x),
    y: topDown(grid, y + side),
    width: mm(side),
    height: mm(side),
    color: rgb(1, 1, 1),
  });

  for (let row = 0; row < matrix.size; row++) {
    for (let column = 0; column < matrix.size; column++) {
      if (!matrix.isDark(row, column)) continue;
      page.drawRectangle({
        x: mm(x + (column + quiet) * module),
        y: topDown(grid, y + (row + quiet + 1) * module),
        width: mm(module) + 0.3,
        height: mm(module) + 0.3,
        color: rgb(0, 0, 0),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The two runs
// ---------------------------------------------------------------------------

export interface SheetOptions {
  /** Skip this many label positions, so a part-used sheet is not wasted (H10). */
  startAt?: number;
  /** Put the calibration page first. Always true for a volunteer run. */
  calibration?: boolean;
}

/**
 * Avery L7163: as many labels as asked for, packed 14 to a sheet.
 *
 * `startAt` skips positions on the first sheet only — the point is a part-used
 * sheet with four labels already peeled off, not a permanent offset.
 */
export async function buildAverySheet(
  labels: LabelContent[],
  options: SheetOptions = {}
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await pdfLib();
  const grid = CHURCH.labels.avery;

  const doc = await PDFDocument.create();
  doc.setTitle(`${CHURCH.appName} — labels`);
  doc.setCreator(CHURCH.appName);

  const ink: Ink = {
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  if (options.calibration) await drawCalibrationPage(doc, grid, ink);

  const perSheet = labelsPerSheet(grid);
  const skip = Math.min(Math.max(options.startAt ?? 0, 0), perSheet - 1);

  let page: PDFPage | null = null;
  for (const [index, content] of labels.entries()) {
    const position = index + skip;
    if (position % perSheet === 0 || page === null) {
      page = doc.addPage([mm(grid.pageWidth), mm(grid.pageHeight)]);
    }
    await drawLabel(page, grid, slotFor(grid, position), content, ink);
  }

  return doc.save();
}

/**
 * The volunteer sheets (1A): one parcel per A4 page.
 *
 * The peel-off label at the top goes on the parcel. Everything below it is the
 * form the volunteer fills in by hand while they have the parcel open — and it
 * is laid out for somebody standing in a cold room with the parcel in one hand,
 * which is why the tick-boxes are large and the guidance sits beside each grade
 * rather than in a paragraph at the top nobody reads (4A).
 */
export async function buildVolunteerSheets(labels: LabelContent[]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const grid = CHURCH.labels.volunteerSheet;

  const doc = await PDFDocument.create();
  doc.setTitle(`${CHURCH.appName} — volunteer sheets`);
  doc.setCreator(CHURCH.appName);

  const ink: Ink = {
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  // Always. A 410-sheet run is not the place to discover the printer is out.
  await drawCalibrationPage(doc, grid, ink);

  for (const content of labels) {
    const page = doc.addPage([mm(grid.pageWidth), mm(grid.pageHeight)]);
    const slot = slotFor(grid, 0);

    await drawLabel(page, grid, slot, content, ink);

    // --- catalogue details, to the right of the die-cut label ---
    const asideX = slot.x + slot.width + 6;
    const asideWidth = grid.pageWidth - asideX - 10;
    if (asideWidth > 20) {
      let y = slot.y + 4;
      const detail = (label: string, value: string) => {
        page.drawText(label, { x: mm(asideX), y: topDown(grid, y), size: 7, font: ink.font, color: rgb(0.4, 0.4, 0.4) });
        page.drawText(fitText(value, mm(asideWidth), (s) => ink.bold.widthOfTextAtSize(s, 9)), {
          x: mm(asideX),
          y: topDown(grid, y + 4),
          size: 9,
          font: ink.bold,
        });
        y += 11;
      };
      detail("ACCESSION", content.accession ?? "not yet assigned");
      detail("COMPOSER", content.surname);
      detail("CATEGORY", `${content.category} — ${CHURCH.categories.find((c) => c.code === content.category)?.label ?? ""}`);
    }

    drawVolunteerForm(page, grid, ink, slot.y + slot.height + 12, content);
  }

  return doc.save();
}

/**
 * The hand-fill zone below the label.
 *
 * Everything a volunteer records with the parcel open: how many copies, what
 * state they are in, and the three ticks that raise work elsewhere in the app.
 */
function drawVolunteerForm(
  page: PDFPage,
  grid: LabelGrid,
  ink: Ink,
  startY: number,
  content: LabelContent
): void {
  const left = 14;
  const right = grid.pageWidth - 14;
  let y = startY;

  const rule = (atY: number) => {
    page.drawLine({
      start: { x: mm(left), y: topDown(grid, atY) },
      end: { x: mm(right), y: topDown(grid, atY) },
      thickness: 0.4,
    });
  };

  const heading = (text: string) => {
    page.drawText(text, { x: mm(left), y: topDown(grid, y), size: 10, font: ink.bold });
    y += 6;
  };

  const box = (x: number, atY: number, side = 5) => {
    page.drawRectangle({
      x: mm(x),
      y: topDown(grid, atY + side),
      width: mm(side),
      height: mm(side),
      borderWidth: 0.6,
    });
  };

  heading("How many copies are in this parcel?");
  page.drawText("Altogether", { x: mm(left), y: topDown(grid, y + 4), size: 9, font: ink.font });
  page.drawRectangle({ x: mm(left + 24), y: topDown(grid, y + 7), width: mm(20), height: mm(9), borderWidth: 0.6 });
  page.drawText("Usable — ones you would hand to a singer", {
    x: mm(left + 50),
    y: topDown(grid, y + 4),
    size: 9,
    font: ink.font,
  });
  page.drawRectangle({ x: mm(right - 20), y: topDown(grid, y + 7), width: mm(20), height: mm(9), borderWidth: 0.6 });
  y += 14;
  rule(y);
  y += 7;

  heading("What state are they in? Tick one.");
  for (const grade of CHURCH.conditions) {
    box(left, y);
    page.drawText(grade.label, { x: mm(left + 8), y: topDown(grid, y + 3.6), size: 9.5, font: ink.bold });
    page.drawText(grade.guidance, { x: mm(left + 30), y: topDown(grid, y + 3.6), size: 8.5, font: ink.font });
    y += 8;
  }
  y += 2;
  rule(y);
  y += 7;

  heading("Anything else? Tick what applies.");
  const ticks = [
    "The folder or wrapper needs replacing",
    "There is no usable label on the spine",
    "This should share a combined label with the others in its box",
  ];
  for (const tick of ticks) {
    box(left, y);
    page.drawText(tick, { x: mm(left + 8), y: topDown(grid, y + 3.6), size: 9, font: ink.font });
    y += 8;
  }
  page.drawText("If it should share a label, which others? ", {
    x: mm(left + 8),
    y: topDown(grid, y + 3.6),
    size: 8.5,
    font: ink.font,
  });
  page.drawLine({
    start: { x: mm(left + 62), y: topDown(grid, y + 4.6) },
    end: { x: mm(right), y: topDown(grid, y + 4.6) },
    thickness: 0.4,
  });
  y += 12;
  rule(y);
  y += 7;

  heading("Notes");
  for (let i = 0; i < 5; i++) {
    page.drawLine({
      start: { x: mm(left), y: topDown(grid, y) },
      end: { x: mm(right), y: topDown(grid, y) },
      thickness: 0.3,
    });
    y += 8;
  }

  y += 4;
  page.drawText("Your name", { x: mm(left), y: topDown(grid, y), size: 9, font: ink.font });
  page.drawLine({
    start: { x: mm(left + 20), y: topDown(grid, y + 1) },
    end: { x: mm(left + 80), y: topDown(grid, y + 1) },
    thickness: 0.4,
  });
  page.drawText("Date", { x: mm(left + 90), y: topDown(grid, y), size: 9, font: ink.font });
  page.drawLine({
    start: { x: mm(left + 100), y: topDown(grid, y + 1) },
    end: { x: mm(right), y: topDown(grid, y + 1) },
    thickness: 0.4,
  });

  // The accession again, bottom right and large, so a sheet that has been put
  // down on a pile can be matched back to its parcel at a glance.
  if (content.accession) {
    const size = 22;
    const width = ink.bold.widthOfTextAtSize(content.accession, size);
    page.drawText(content.accession, {
      x: mm(right) - width,
      y: mm(12),
      size,
      font: ink.bold,
    });
  }
}
