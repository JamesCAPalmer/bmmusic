/**
 * Enough of XLSX to read the music department's workbook.
 *
 * Written rather than depended on, for the same reason `src/csv.ts` was: the
 * estate keeps this app to Hono and wrangler. An .xlsx is a ZIP of XML, and
 * both halves are in the platform already — `DecompressionStream("deflate-raw")`
 * does the ZIP, and the XML we need is simple enough to read with a scanner.
 *
 * **This reads the common case and says so loudly when it cannot.** It handles
 * what Excel and Numbers actually write for a sheet of names and marks: stored
 * and deflated entries, the shared string table, inline strings, numbers, and
 * the `t="s"` indirection. It does not handle encrypted workbooks, ZIP64, or
 * formulas — it takes a formula cell's cached value and does not evaluate
 * anything. Where it cannot cope it throws `XlsxError` with a sentence a person
 * can act on, and the screen offers CSV instead, which always works.
 *
 * Dates are the one thing worth knowing about: Excel stores a date as a number
 * of days since 1899-12-30, and a cell gives no clue in the sheet XML whether
 * 46000 is a date or a quantity. `serialToDate` is here for the caller to apply
 * where it *knows* a column is a date, and nothing guesses.
 */

export class XlsxError extends Error {}

// ---------------------------------------------------------------------------
// The ZIP half
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

function readCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end-of-central-directory record is last, but a comment may follow it,
  // so scan back for the signature. 64 KB is the largest comment ZIP allows.
  let eocd = -1;
  const earliest = Math.max(0, bytes.length - 0xffff - 22);
  for (let i = bytes.length - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("That does not look like a spreadsheet file.");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  if (count === 0xffff || offset === 0xffffffff) {
    throw new XlsxError("That spreadsheet is in a format this app cannot read (ZIP64).");
  }

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new XlsxError("That spreadsheet file looks damaged.");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    entries.push({ name, method, compressedSize, offset: localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // A one-chunk stream rather than a Blob: `Blob` is present in Workers but
  // its constructor's part type differs between the Workers and DOM lib
  // definitions, and there is no reason to involve it.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One file out of the archive, as text. */
async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The local header's name and extra lengths can differ from the central
  // directory's, so the data offset has to be read from the local header.
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const raw = bytes.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method === 8) return new TextDecoder().decode(await inflate(raw));
  throw new XlsxError("That spreadsheet uses a compression this app cannot read.");
}

// ---------------------------------------------------------------------------
// The XML half
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function unescapeXml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos);|&#x?[0-9a-fA-F]+;/g, (entity) => {
    const known = ENTITIES[entity];
    if (known !== undefined) return known;
    const code = entity[2] === "x" || entity[2] === "X"
      ? parseInt(entity.slice(3, -1), 16)
      : parseInt(entity.slice(2, -1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}

/** The text of every `<t>` under one element, joined — rich text is in pieces. */
function textOf(xml: string): string {
  let text = "";
  for (const match of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += match[1]!;
  return unescapeXml(text);
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));
}

/** "BC12" → 54. Column letters are base-26 with no zero. */
export function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference.toUpperCase())?.[1] ?? "";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * One sheet as rows of strings, positioned exactly as the spreadsheet has them.
 *
 * Both axes are padded, and for the same reason. A workbook has blanks in it
 * that mean "absent", and Excel writes nothing at all for them — no `<c>` for
 * an empty cell, and often no `<row>` for an empty row. A reader that appends
 * as it goes puts the telephone number in the Joined column for exactly the
 * rows where something was left blank, and silently.
 *
 * So column *n* is at index *n*, and spreadsheet row *n* is at index *n − 1*.
 * The second is what lets the importer tell James "row 12" and be right.
 */
function parseSheet(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row([^>]*)>([\s\S]*?)<\/row>|<row([^>]*)\/>/g)) {
    const rowAttributes = rowMatch[1] ?? rowMatch[3] ?? "";
    const body = rowMatch[2] ?? "";

    const rowNumber = Number(/r="(\d+)"/.exec(rowAttributes)?.[1] ?? "");
    if (Number.isInteger(rowNumber) && rowNumber > 0) {
      while (rows.length < rowNumber - 1) rows.push([]);
    }

    const cells: string[] = [];

    for (const cellMatch of body.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attributes = cellMatch[1] ?? cellMatch[3] ?? "";
      const body = cellMatch[2] ?? "";

      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const at = reference ? columnIndex(reference) : cells.length;
      while (cells.length < at) cells.push("");

      const type = /t="([^"]+)"/.exec(attributes)?.[1];
      let value: string;
      if (type === "s") {
        // Shared string: <v> holds an index into the table.
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
        value = shared[index] ?? "";
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else {
        // A number, a date serial, a boolean, or a formula's cached value.
        value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      }
      cells.push(value);
    }
    rows.push(cells);
  }

  return rows;
}

export interface Sheet {
  name: string;
  rows: string[][];
}

/**
 * Read a workbook.
 *
 * Sheets come back in the order the workbook declares them, named as the tabs
 * are named, because the importer matches on those names.
 */
export async function readWorkbook(bytes: Uint8Array): Promise<Sheet[]> {
  const entries = readCentralDirectory(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const workbookEntry = byName.get("xl/workbook.xml");
  if (!workbookEntry) throw new XlsxError("That file is not an Excel workbook.");

  const sharedEntry = byName.get("xl/sharedStrings.xml");
  const shared = sharedEntry ? parseSharedStrings(await readEntry(bytes, sharedEntry)) : [];

  const workbookXml = await readEntry(bytes, workbookEntry);
  const relsEntry = byName.get("xl/_rels/workbook.xml.rels");
  const rels = new Map<string, string>();
  if (relsEntry) {
    for (const match of (await readEntry(bytes, relsEntry)).matchAll(
      /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g
    )) {
      rels.set(match[1]!, match[2]!.replace(/^\/?xl\//, "").replace(/^\//, ""));
    }
  }

  const sheets: Sheet[] = [];
  let fallbackIndex = 0;

  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    fallbackIndex += 1;
    const tag = match[0];
    const name = unescapeXml(/name="([^"]*)"/.exec(tag)?.[1] ?? `Sheet${fallbackIndex}`);
    const relId = /r:id="([^"]+)"/.exec(tag)?.[1];

    const target = (relId && rels.get(relId)) || `worksheets/sheet${fallbackIndex}.xml`;
    const entry = byName.get(`xl/${target}`) ?? byName.get(target);
    if (!entry) continue;

    sheets.push({ name, rows: parseSheet(await readEntry(bytes, entry), shared) });
  }

  if (!sheets.length) throw new XlsxError("That workbook has no sheets this app can read.");
  return sheets;
}

/**
 * An Excel date serial as "YYYY-MM-DD", or null.
 *
 * Excel counts days from 1899-12-30 — not 1900-01-01, because it believes 1900
 * was a leap year and the offset absorbs the phantom 29 February. Only applied
 * where the caller knows a column holds dates: a bare number in a sheet gives
 * no indication of whether it is a date or a count of anything else.
 */
export function serialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const at = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return at.toISOString().slice(0, 10);
}
