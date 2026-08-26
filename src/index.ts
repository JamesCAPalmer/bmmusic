/**
 * Routes.
 *
 * Three surfaces behind two different gates (see `src/auth.ts`):
 *
 *   - the choir side (`/`, `/piece/:id`) — shared choir password;
 *   - the volunteer portal (`/portal`) — the same password, phone-shaped;
 *   - the librarian's side (`/admin`) — Cloudflare Access.
 *
 * Everything is server-rendered by `src/ui.ts` and every query goes through
 * `src/catalogue.ts`. There are no public URLs: every response carries noindex
 * headers and `/robots.txt` disallows the lot.
 */

import { Hono } from "hono";
import type { Env } from "./env";
import { CHURCH } from "./church.config";
import {
  adminIdentity,
  authMiddleware,
  checkPassword,
  clearCookieHeader,
  createSessionValue,
  sessionCookieHeader,
  FAILED_LOGIN_DELAY_MS,
} from "./auth";
import {
  addAlias,
  assignAccessions,
  categoryCounts,
  catalogueStats,
  confirmPiece,
  createPiece,
  getFile,
  getPiece,
  getPieceByAccession,
  getPieceDetail,
  mergePieces,
  recordCount,
  reviewQueue,
  searchPieces,
  updatePiece,
  type PieceEdit,
  type SearchQuery,
} from "./catalogue";
import { importSeed, seedChoirProfiles, type ImportSummary } from "./seed";
import { extractionAvailable, extractLabel } from "./extract";
import { NotConfiguredError, toContentBlock } from "./anthropic";
import {
  adminAccessionPage,
  adminEditPage,
  adminHomePage,
  adminImportPage,
  adminIntakeDonePage,
  adminIntakePage,
  adminReviewPage,
  browsePage,
  errorPage,
  itemPage,
  loginPage,
  notFoundPage,
  portalCountPage,
  portalDonePage,
  portalPage,
} from "./ui";
import SEED_CSV from "../data/seed/bm-music-draft-index.csv";

const app = new Hono<{ Bindings: Env }>();

/**
 * Noindex on every response, and never let a browser hold on to a page.
 *
 * The headers matter more than the meta tag: they cover the JSON endpoints and
 * the streamed PDFs too, not just the pages. Nothing here should be cached by
 * an intermediary or indexed by anything.
 */
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, noimageindex");
  const type = c.res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) {
    c.res.headers.set("Cache-Control", "no-store, must-revalidate");
  }
});

app.use("*", authMiddleware);

/** No crawler should be here, and there is nothing for one to find. */
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

app.get("/login", (c) => c.html(loginPage()));

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
  if (password && (await checkPassword(c.env, password))) {
    c.header("Set-Cookie", sessionCookieHeader(await createSessionValue(c.env)));
    return c.redirect("/", 302);
  }
  // One generic message and a fixed delay: no enumeration, no lockout to lock
  // a chorister out of the catalogue five minutes before a service.
  await new Promise((r) => setTimeout(r, FAILED_LOGIN_DELAY_MS));
  return c.html(loginPage(true), 401);
});

app.get("/logout", (c) => {
  c.header("Set-Cookie", clearCookieHeader());
  return c.redirect("/login", 302);
});

// ---------------------------------------------------------------------------
// Choir
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

app.get("/", async (c) => {
  const query = readSearchQuery(c.req.url);
  const [result, counts] = await Promise.all([
    searchPieces(c.env.DB, query),
    categoryCounts(c.env.DB),
  ]);
  return c.html(browsePage(query, result, counts));
});

app.get("/piece/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);
  const detail = await getPieceDetail(c.env.DB, id);
  if (!detail) return c.html(notFoundPage(), 404);
  return c.html(itemPage(detail));
});

function readSearchQuery(url: string): SearchQuery {
  const params = new URL(url).searchParams;
  const offset = Number(params.get("offset") ?? "0");
  return {
    q: params.get("q")?.trim() || undefined,
    category: params.get("category")?.trim() || undefined,
    voicing: params.get("voicing")?.trim() || undefined,
    limit: PAGE_SIZE,
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
  };
}

// ---------------------------------------------------------------------------
// Volunteer portal
// ---------------------------------------------------------------------------

app.get("/portal", async (c) => {
  const q = new URL(c.req.url).searchParams.get("q")?.trim();
  if (!q) return c.html(portalPage());

  // An accession number is an exact thing; jump straight there rather than
  // making somebody holding a parcel pick their own parcel out of a list.
  const byAccession = await getPieceByAccession(c.env.DB, q);
  if (byAccession) return c.redirect(`/portal/count/${byAccession.id}`, 302);

  const result = await searchPieces(c.env.DB, { q, limit: 25 });
  return c.html(portalPage({ q, results: result.pieces }));
});

app.get("/portal/count/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);
  const piece = await getPiece(c.env.DB, id);
  if (!piece) return c.html(notFoundPage(), 404);
  return c.html(portalCountPage(piece));
});

app.post("/portal/count/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);
  const piece = await getPiece(c.env.DB, id);
  if (!piece) return c.html(notFoundPage(), 404);

  const body = await c.req.parseBody();
  const total = countField(body.copies_total);
  const usable = countField(body.copies_usable);
  const condition = str(body.condition);

  // Validation messages say what to do, not what went wrong grammatically.
  if (total === null) {
    return c.html(portalCountPage(piece, "Please put in how many copies there are altogether."), 400);
  }
  if (usable === null) {
    return c.html(portalCountPage(piece, "Please put in how many copies are usable."), 400);
  }
  if (usable > total) {
    return c.html(
      portalCountPage(piece, "There cannot be more usable copies than copies altogether — please check both numbers."),
      400
    );
  }
  if (!CHURCH.conditions.some((x) => x.value === condition)) {
    return c.html(portalCountPage(piece, "Please choose what state the copies are in."), 400);
  }

  const outcome = await recordCount(c.env.DB, {
    pieceId: id,
    copiesTotal: total,
    copiesUsable: usable,
    condition,
    voicing: str(body.voicing) || null,
    note: str(body.note) || null,
    countedBy: str(body.counted_by) || null,
  });

  return c.html(portalDonePage(piece, outcome));
});

// ---------------------------------------------------------------------------
// Scans (R2)
// ---------------------------------------------------------------------------

/**
 * Stream a scan to a signed-in user.
 *
 * The bucket has no public access and this app mints no public object URLs: the
 * only way to a PDF is through this route, behind the same gate as everything
 * else. `inline` so it opens in the browser's own viewer rather than landing in
 * a downloads folder.
 */
app.get("/file/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  if (!c.env.SCANS) {
    return c.html(errorPage("Scans are not available yet — the storage bucket has not been set up."), 503);
  }

  const row = await getFile(c.env.DB, id);
  if (!row) return c.html(notFoundPage(), 404);

  const object = await c.env.SCANS.get(row.r2_key);
  if (!object) return c.html(notFoundPage(), 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-type", object.httpMetadata?.contentType ?? "application/pdf");
  headers.set("content-disposition", `inline; filename="piece-${row.piece_id}-${row.id}.pdf"`);
  // Private: a shared cache must never hold a copy of a gated file.
  headers.set("cache-control", "private, max-age=300");
  return new Response(object.body, { headers });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

app.get("/admin", async (c) => {
  const stats = await catalogueStats(c.env.DB);
  return c.html(adminHomePage(stats, extractionAvailable(c.env)));
});

app.get("/admin/review", async (c) => {
  const offset = Number(new URL(c.req.url).searchParams.get("offset") ?? "0");
  const start = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const queue = await reviewQueue(c.env.DB, 25, start);
  return c.html(adminReviewPage(queue, start));
});

app.post("/admin/review/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const body = await c.req.parseBody();
  const action = str(body.action);

  if (action === "merge") {
    const target = str(body.merge_into);
    if (!target) return c.redirect("/admin/review", 302);
    const keep = await findPieceByReference(c.env.DB, target);
    if (!keep) {
      return c.html(
        errorPage(`No piece matches "${target}". Use its accession number (BM-0042) or its draft ref (D-172).`),
        404
      );
    }
    try {
      await mergePieces(c.env.DB, keep.id, id);
    } catch (e) {
      return c.html(errorPage(e instanceof Error ? e.message : "That merge could not be done."), 400);
    }
    return c.redirect("/admin/review", 302);
  }

  const edit = readPieceEdit(body);
  if (!edit) return c.html(errorPage("A composer and a title are both needed."), 400);

  await updatePiece(c.env.DB, id, edit);
  if (action === "confirm") {
    await confirmPiece(c.env.DB, id, adminIdentity(c));
  }
  return c.redirect("/admin/review", 302);
});

app.get("/admin/piece/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);
  const detail = await getPieceDetail(c.env.DB, id);
  if (!detail) return c.html(notFoundPage(), 404);
  return c.html(adminEditPage(detail, new URL(c.req.url).searchParams.has("saved")));
});

app.post("/admin/piece/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const body = await c.req.parseBody();
  const edit = readPieceEdit(body);
  if (!edit) return c.html(errorPage("A composer and a title are both needed."), 400);

  await updatePiece(c.env.DB, id, edit);
  const newAlias = str(body.new_alias);
  if (newAlias) await addAlias(c.env.DB, id, newAlias);

  return c.redirect(`/admin/piece/${id}?saved=1`, 302);
});

app.post("/admin/accessions", async (c) => {
  const result = await assignAccessions(c.env.DB);
  return c.html(adminAccessionPage(result));
});

app.get("/admin/import", (c) => c.html(adminImportPage(null)));

app.post("/admin/import", async (c) => {
  let summary: ImportSummary;
  try {
    summary = await importSeed(c.env.DB, SEED_CSV);
    // The choir designations come from church.config and cost nothing to keep
    // in step, so the import is a sensible place to do it.
    await seedChoirProfiles(c.env.DB);
  } catch (e) {
    return c.html(
      adminImportPage(null, e instanceof Error ? e.message : "The draft index could not be imported."),
      400
    );
  }
  return c.html(adminImportPage(summary));
});

app.get("/admin/intake", (c) => c.html(adminIntakePage(extractionAvailable(c.env))));

/** Read one label photograph. Errors here always leave manual entry working. */
app.post("/admin/api/read-label", async (c) => {
  const body = await c.req.parseBody();
  const file = body.photo;
  if (!(file instanceof File)) {
    return c.json({ error: "Please choose a photo to read." }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const block = toContentBlock(file.name, bytes);
  if (!block) {
    return c.json({ error: "That file type can't be read. Use a photo (JPG or PNG) or a PDF." }, 400);
  }

  try {
    const label = await extractLabel(c.env, block);
    return c.json({ label });
  } catch (e) {
    if (e instanceof NotConfiguredError) {
      return c.json({ error: "Reading labels is switched off. Please enter the details by hand." }, 503);
    }
    return c.json(
      { error: "The label could not be read just now. Please enter the details by hand." },
      502
    );
  }
});

app.post("/admin/intake", async (c) => {
  const body = await c.req.parseBody();
  const edit = readPieceEdit(body);
  if (!edit) return c.html(errorPage("A composer and a title are both needed."), 400);

  const id = await createPiece(c.env.DB, edit);

  // A parcel holding several pieces keeps the joined title and gains one alias
  // per piece — the same rule the seed importer follows.
  const parts = edit.title.split(";").map((t) => t.trim()).filter(Boolean);
  if (parts.length > 1) {
    for (const part of parts) await addAlias(c.env.DB, id, part);
  }

  return c.html(adminIntakeDonePage(id, edit.title));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

app.notFound((c) => c.html(notFoundPage(), 404));

app.onError((err, c) => {
  // Never show a stack trace to a chorister. The detail goes to the Worker's
  // logs, where James can find it.
  console.error("bmmusic error", err);
  return c.html(errorPage("Something went wrong at our end. Please try again in a moment."), 500);
});

type Body = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function numericParam(v: string | undefined): number | null {
  if (!v || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A copy count: a whole number from 0 to 999, or null if it is not one. */
function countField(v: unknown): number | null {
  const raw = str(v);
  if (!/^\d{1,3}$/.test(raw)) return null;
  return Number(raw);
}

/** Read the shared piece form. Null when the two required fields are missing. */
function readPieceEdit(body: Body): PieceEdit | null {
  const composer = str(body.composer);
  const title = str(body.title);
  if (!composer || !title) return null;

  const category = str(body.category);
  return {
    composer,
    title,
    category: CHURCH.categories.some((c) => c.code === category) ? category : "S",
    voicing: str(body.voicing) || null,
    season: str(body.season) || null,
    location: str(body.location) || null,
    notes: str(body.notes) || null,
    reviewFlag: str(body.review_flag) || null,
  };
}

/** Find a piece by accession number or draft ref, for the merge box. */
async function findPieceByReference(
  db: D1Database,
  reference: string
): Promise<{ id: number } | null> {
  const ref = reference.trim();
  return db
    .prepare(`SELECT id FROM piece WHERE accession = ? OR legacy_ref = ? LIMIT 1`)
    .bind(ref.toUpperCase(), ref.toUpperCase())
    .first<{ id: number }>();
}

export default app;
