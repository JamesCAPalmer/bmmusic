/**
 * Printing labels (1A and H10).
 *
 * Two stocks, both bought and sitting in a box in Beverley:
 *
 *   - **The volunteer sheet** — a Triplast A4 integrated sheet with one
 *     110×60mm peel-off label at the top and plain paper below it. The label
 *     goes on the box; the paper below is where a volunteer writes what they
 *     found. One sheet per box, and 410 of them for the whole library.
 *   - **Avery L7163** — 14 per sheet, for reprints, face labels and combined
 *     labels, with a selectable start position so a part-used sheet is not
 *     wasted.
 *
 * The geometry lives in `church.config.ts`, in millimetres, because that is
 * what the packaging says and what James will measure with. This module
 * converts to PDF points once, at the boundary, so no drawing code below
 * carries a conversion factor around with it.
 *
 * **A calibration page comes first on the volunteer run.** Sheet-fed printers
 * wander, and finding out that the Brother is 3mm out after 410 sheets is a
 * genuinely expensive way to learn it. The first page draws the die-cut
 * outline and nothing else, so James can hold it up to a real sheet.
 */

import { CHURCH, type LabelGrid } from "./church.config";

/** PDF user space is 72 points to the inch; 25.4mm to the inch. */
const MM_TO_POINTS = 72 / 25.4;

export function mm(millimetres: number): number {
  return millimetres * MM_TO_POINTS;
}

/** One label's position on the sheet, in millimetres from the top-left. */
export interface LabelSlot {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where label `index` sits on the sheet, counting left-to-right then down.
 *
 * Reading order, because that is how somebody peeling labels off a sheet works
 * through it, and a start position that skipped down a column would be baffling
 * to use on a part-used sheet.
 */
export function slotFor(grid: LabelGrid, index: number): LabelSlot {
  const perSheet = grid.columns * grid.rows;
  const onSheet = ((index % perSheet) + perSheet) % perSheet;
  const row = Math.floor(onSheet / grid.columns);
  const column = onSheet % grid.columns;

  return {
    x: grid.marginLeft + column * (grid.labelWidth + grid.columnGap),
    y: grid.marginTop + row * (grid.labelHeight + grid.rowGap),
    width: grid.labelWidth,
    height: grid.labelHeight,
  };
}

export function labelsPerSheet(grid: LabelGrid): number {
  return grid.columns * grid.rows;
}

/**
 * Does this grid actually fit on its page?
 *
 * Worth asserting rather than assuming: an earlier draft of the Avery geometry
 * had a left margin that made two columns 5mm wider than an A4 sheet, and the
 * only symptom would have been a column of labels printed off the edge of the
 * paper on somebody's afternoon.
 */
export function gridFits(grid: LabelGrid): boolean {
  const usedWidth =
    grid.marginLeft + grid.columns * grid.labelWidth + (grid.columns - 1) * grid.columnGap;
  const usedHeight =
    grid.marginTop + grid.rows * grid.labelHeight + (grid.rows - 1) * grid.rowGap;
  return usedWidth <= grid.pageWidth && usedHeight <= grid.pageHeight;
}

// ---------------------------------------------------------------------------
// Category glyphs
// ---------------------------------------------------------------------------

/**
 * A glyph *and* a letter for every category, per the brief.
 *
 * Both, not either: the glyph is quick to spot along a shelf, and the letter is
 * what survives a label that has gone brown in a song school for twenty years.
 * Drawn as strokes and fills rather than as a font, so they print on a mono
 * laser printer exactly as they appear here.
 *
 * The shapes are named in the brief — moon for evening canticles, sunrise for
 * morning, bread for communion, two voices for responses, harp for psalms, star
 * for carols, quaver for anthems, book for collections.
 */
export interface Glyph {
  /** SVG path data, drawn inside a 24×24 box. */
  path: string;
  /** Paths that are stroked rather than filled. */
  strokePath?: string;
}

export const CATEGORY_GLYPHS: Record<string, Glyph> = {
  // Anthem — a quaver.
  A: {
    path: "M13 4 L13 16.5 A3.2 3.2 0 1 1 11 13.6 L11 7 L18 5 L18 3 Z",
  },
  // Evening canticles — a crescent moon.
  E: {
    path: "M16.5 3.5 A9 9 0 1 0 16.5 20.5 A7.2 7.2 0 1 1 16.5 3.5 Z",
  },
  // Morning canticles — a sunrise over a horizon.
  M: {
    path: "M12 6 A5.5 5.5 0 0 1 17.5 11.5 L6.5 11.5 A5.5 5.5 0 0 1 12 6 Z M2 14 L22 14 L22 15.6 L2 15.6 Z M11.2 1 L12.8 1 L12.8 4 L11.2 4 Z M4 4.6 L5.2 3.4 L7.3 5.5 L6.1 6.7 Z M18.8 3.4 L20 4.6 L17.9 6.7 L16.7 5.5 Z",
  },
  // Communion setting — a loaf.
  C: {
    path: "M4 12 A8 5.5 0 0 1 20 12 L20 18.5 A1.4 1.4 0 0 1 18.6 19.9 L5.4 19.9 A1.4 1.4 0 0 1 4 18.5 Z",
    strokePath: "M8.5 8.2 L7 11 M12 7.6 L12 10.6 M15.5 8.2 L17 11",
  },
  // Responses — two voices answering each other.
  R: {
    path: "M8 4.5 A3.3 3.3 0 1 1 8 11.1 A3.3 3.3 0 0 1 8 4.5 Z M16 4.5 A3.3 3.3 0 1 1 16 11.1 A3.3 3.3 0 0 1 16 4.5 Z M2.5 20 A5.5 5.5 0 0 1 13.5 20 Z M10.5 20 A5.5 5.5 0 0 1 21.5 20 Z",
  },
  // Psalm chant — a harp.
  P: {
    path: "M5 3 L5 21 L7 21 L7 3 Z M5 3 A14 14 0 0 1 19 17 L19 21 L17 21 L17 17 A12 12 0 0 0 5 5 Z",
    strokePath: "M8 6.4 L8 20 M11 8.6 L11 20 M14 12 L14 20",
  },
  // Carol — a star.
  X: {
    path: "M12 2 L14.6 9.2 L22 9.6 L16.2 14.2 L18.2 21.4 L12 17.2 L5.8 21.4 L7.8 14.2 L2 9.6 L9.4 9.2 Z",
  },
  // Solo, collection and anything else — an open book.
  S: {
    path: "M2.4 5 A10 3 0 0 1 11.4 5.4 L11.4 19.4 A10 3 0 0 0 2.4 19 Z M12.6 5.4 A10 3 0 0 1 21.6 5 L21.6 19 A10 3 0 0 0 12.6 19.4 Z",
  },
};

export function glyphFor(category: string): Glyph {
  return CATEGORY_GLYPHS[category] ?? CATEGORY_GLYPHS.S!;
}

// ---------------------------------------------------------------------------
// QR (H1)
// ---------------------------------------------------------------------------

/**
 * The URL a label's QR encodes.
 *
 * **Domain-move-safe by design.** When the app moves to
 * `music.beverleyminster.org.uk`, the old hostname keeps a Worker that 301s
 * everything — so a QR printed on a box today still works in ten years.
 * That is the whole reason for the short `/q/:accession` route rather than
 * encoding a `/piece/:id` link: the accession is written on the box in ink
 * and is the one identifier that cannot go stale.
 */
export function qrTargetFor(accession: string): string {
  return `https://${CHURCH.domains.app}/q/${encodeURIComponent(accession)}`;
}

/** A QR as a square grid of booleans, ready to draw as filled rectangles. */
export interface QrMatrix {
  size: number;
  isDark: (row: number, column: number) => boolean;
}

/**
 * Build the QR matrix for an accession.
 *
 * Error correction M: a label lives on a box handled by choristers in a cold
 * room, so it will get creased and thumbed. M recovers from about 15% damage,
 * which is the usual choice for print and leaves the code small enough to sit
 * comfortably on a 38mm label.
 *
 * Loaded dynamically for the same reason as pdf-lib: it is only ever needed on
 * the label routes, and the choir side should not pay to evaluate it.
 */
export async function qrMatrixFor(accession: string): Promise<QrMatrix> {
  const { default: qrcode } = await import("qrcode-generator");
  // Type 0 lets the library choose the smallest version that fits.
  const qr = qrcode(0, "M");
  qr.addData(qrTargetFor(accession));
  qr.make();
  return { size: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) };
}

// ---------------------------------------------------------------------------
// What goes on a label
// ---------------------------------------------------------------------------

/** Everything one label needs. Assembled by the route, drawn by the renderer. */
export interface LabelContent {
  pieceId: number;
  /** Null when the piece has no accession yet — then there is no QR either. */
  accession: string | null;
  /** Surname in capitals is a presentation choice; the data stays proper case. */
  surname: string;
  title: string;
  category: string;
  /** For a combined label: the other boxes sharing it. */
  boxmates?: string[];
}

/**
 * Trim a string to fit a width, with an ellipsis if it had to be cut.
 *
 * Measuring properly needs the font, which the renderer has and this does not,
 * so the renderer passes a measuring function in. Keeping the logic here means
 * both label kinds truncate the same way.
 */
export function fitText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string {
  if (measure(text) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && measure(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** The stocks, named for the admin screen. */
export const LABEL_STOCKS = {
  volunteer: CHURCH.labels.volunteerSheet,
  avery: CHURCH.labels.avery,
} as const;

export type LabelStockName = keyof typeof LABEL_STOCKS;
