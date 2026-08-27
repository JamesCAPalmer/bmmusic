/**
 * Working copies (17A, **beta**): a service's approved reference scans, joined
 * into one PDF a chorister can read on a phone in a rehearsal.
 *
 * This is the one place in the app that does real work per request, so three
 * decisions shape it.
 *
 * **It fails soft, always.** A working copy is a convenience. If a scan is
 * missing, malformed, or the whole thing takes too long, the chorister gets a
 * sentence telling them what to do instead — never a stack trace, and never a
 * half-built PDF. Beta features that break loudly get switched off; beta
 * features that degrade quietly get used.
 *
 * **It is cached in R2 on a content hash.** Tapping the button twice must cost
 * one PDF, not two. The key includes a hash of exactly which files went in, so
 * a newly approved scan produces a new key rather than serving a stale copy —
 * the cache is correct first and fast second.
 *
 * **Every page is watermarked** (H12). These are reference scans of the
 * library's own copies, joined for rehearsal use inside the choir. The footer
 * says so on every page, so a page that escapes the app still says what it is.
 */

import type { PDFDocument } from "pdf-lib";
import { CHURCH } from "./church.config";

/**
 * pdf-lib, evaluated only when somebody actually asks for a working copy.
 *
 * It is by far the largest thing this Worker depends on: adding it took the
 * bundle from 236 KiB to 1.1 MB. To be straight about what this dynamic import
 * does and does not buy — wrangler still bundles the Worker into one module, so
 * the *upload* is the same size either way. What it defers is module
 * evaluation, which is per-isolate startup work that every choir-side page
 * would otherwise pay for a feature almost none of them use.
 *
 * The upload stays well inside the limit (≈300 KiB gzipped against a 3 MB
 * ceiling), so size is not the concern; the cold-start cost on a phone in a
 * cold song school with one bar of signal is.
 */
async function pdfLib() {
  return import("pdf-lib");
}

/** One scan to fold in, in the order it should appear. */
export interface WorkingCopySource {
  /** R2 key of the reference scan. */
  r2Key: string;
  /** Piece title, for the watermark and for saying which one failed. */
  title: string;
}

export interface WorkingCopyResult {
  bytes: Uint8Array;
  pages: number;
  /** Sources that could not be folded in, with why. Never silently dropped. */
  omitted: { title: string; reason: string }[];
}

export class WorkingCopyError extends Error {}

/**
 * How many source PDFs one working copy will take.
 *
 * A Worker has a CPU budget, and pdf-lib does real work per page. A service's
 * music list is rarely more than a handful of items; the cap is here so that a
 * pathological service cannot hang the request, not because anybody expects to
 * hit it.
 */
const MAX_SOURCES = 12;

/** Footer text per H12, on every page. */
function watermark(ref: string, date: string): string {
  return `${CHURCH.name} Choir — internal rehearsal use — ${ref} — ${date}`;
}

/**
 * A stable key for exactly this set of scans.
 *
 * Hashing the keys in order means "the same scans in the same order" produces
 * the same PDF and reuses it, while approving one more scan changes the hash
 * and rebuilds. Content-addressed rather than time-addressed, so the cache
 * cannot go stale.
 */
export async function contentHash(sources: WorkingCopySource[]): Promise<string> {
  const material = sources.map((s) => s.r2Key).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** R2 key a built working copy is cached under. */
export function workingCopyKey(serviceId: number, hash: string): string {
  return `working-copies/${serviceId}-${hash}.pdf`;
}

/** The reference printed in the footer and stored as the booklet's ref. */
export function workingCopyRef(serviceId: number, hash: string): string {
  return `W-${serviceId}-${hash}`;
}

/**
 * Build the PDF.
 *
 * A source that cannot be read is *omitted and reported*, not fatal: one
 * corrupt scan out of six should still produce a usable booklet with a line
 * saying what is missing. Only "nothing at all could be read" is an error,
 * because an empty PDF helps nobody.
 */
export async function buildWorkingCopy(
  bucket: R2Bucket,
  serviceId: number,
  serviceTitle: string,
  serviceDate: string,
  sources: WorkingCopySource[]
): Promise<WorkingCopyResult> {
  if (!sources.length) {
    throw new WorkingCopyError("None of the music for this service has been scanned yet.");
  }

  const { PDFDocument } = await pdfLib();

  const hash = await contentHash(sources);
  const ref = workingCopyRef(serviceId, hash);
  const omitted: { title: string; reason: string }[] = [];

  const out = await PDFDocument.create();
  out.setTitle(`${serviceTitle} — working copy`);
  out.setSubject(watermark(ref, serviceDate));
  // No author and no producer: this is the library's own document and carries
  // nobody's name.
  out.setCreator(CHURCH.appName);

  const capped = sources.slice(0, MAX_SOURCES);
  for (const extra of sources.slice(MAX_SOURCES)) {
    omitted.push({ title: extra.title, reason: `more than ${MAX_SOURCES} items in one booklet` });
  }

  for (const source of capped) {
    try {
      const object = await bucket.get(source.r2Key);
      if (!object) {
        omitted.push({ title: source.title, reason: "the scan could not be found" });
        continue;
      }
      const bytes = new Uint8Array(await object.arrayBuffer());
      // `ignoreEncryption` because a few of the library's scans came off a
      // photocopier that stamps a permissions flag on everything it makes.
      const donor = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(donor, donor.getPageIndices());
      for (const page of pages) out.addPage(page);
    } catch {
      omitted.push({ title: source.title, reason: "the scan could not be read" });
    }
  }

  if (out.getPageCount() === 0) {
    throw new WorkingCopyError("None of the scans for this service could be read.");
  }

  await stampFooter(out, watermark(ref, serviceDate));

  return { bytes: await out.save(), pages: out.getPageCount(), omitted };
}

/**
 * Put the H12 footer on every page.
 *
 * Drawn inside the bottom margin at 7pt. Music is engraved to the edge of the
 * staff, not the edge of the paper, so this sits under it rather than over it —
 * a watermark that obscures a note would be worse than no watermark at all.
 */
async function stampFooter(doc: PDFDocument, text: string): Promise<void> {
  const { StandardFonts, rgb } = await pdfLib();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 7;

  for (const page of doc.getPages()) {
    const { width } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: Math.max((width - textWidth) / 2, 4),
      y: 8,
      size,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
  }
}
