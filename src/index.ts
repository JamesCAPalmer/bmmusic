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
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "./env";
import { audit } from "./audit";
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
  adminSearchPieces,
  applyBulkEdit,
  choirProfiles,
  mergePieces,
  recentlyAdded,
  saveChoirProfile,
  setChoirSize,
  recordCount,
  reviewQueue,
  searchPieces,
  typicalSingersFor,
  updatePiece,
  type PieceEdit,
  type SearchQuery,
} from "./catalogue";
import { importSeed, seedChoirProfiles, type ImportSummary } from "./seed";
import { fetchFeedMonth, monthsToFetch, readFeedMonth } from "./feed";
import {
  confirmMatch,
  getService,
  ingestMonth,
  matchCandidates,
  rejectMatch,
  serviceMusic,
  sungAt,
  unmatchedLines,
  upcomingServices,
  type IngestSummary,
  type ServiceRow,
} from "./services";
import {
  allFeedback,
  approveScan,
  approvedScansForService,
  getBooklet,
  getScanSubmission,
  latestBooklet,
  pendingScans,
  recordBooklet,
  recordFeedback,
  rejectScan,
  resolveFeedback,
  submitScans,
} from "./submissions";
import {
  buildWorkingCopy,
  contentHash,
  workingCopyKey,
  workingCopyRef,
  WorkingCopyError,
} from "./workingcopy";
import { findDescant } from "./descants";
import { serveAsset } from "./assets";
import { buildAverySheet, buildVolunteerSheets } from "./labelsheet";
import { copiesRag, ragLabel, ragPill } from "./rag";
import { childrenFor } from "./choirsize";
import { pruneBackups, runBackup } from "./backup";
import { toCsv } from "./csv";
import {
  addRate,
  attendanceLines,
  deleteRate,
  isRateRole,
  listRates,
  parseQuarterRef,
  payRun,
  penceFrom,
  possibleByPersonMonth,
  pounds,
  quarterOf,
  recentQuarters,
  totalsByPerson,
  type Quarter,
} from "./pay";
import {
  addContact,
  addPerson,
  anonymisePerson,
  clearAttendance,
  contactCountFor,
  deleteContact,
  deletePerson,
  getPerson,
  isChoir,
  isVoicePart,
  listPeople,
  markAttendance,
  markLeft,
  markReturned as markReturnedToChoir,
  nextStatus,
  registerFor,
  registerTally,
  revealContacts,
  rollOverSchoolYears,
  schoolYearLabel,
  CHOIRS,
  updatePerson,
} from "./people";
import { isModuleKey, moduleForPath, readModuleState, setModule } from "./modules";
import {
  assignDuty,
  createManualEvent,
  dutiesFor,
  dutiesForServices,
  dutyCandidates,
  dutyCoverage,
  DUTY_ROLES,
  isDutyRole,
  isEventType,
  markAllCollected,
  removeDuty,
  type DutyRow,
} from "./duty";
import {
  countMusicStaff,
  grantRole,
  hasAnyRole,
  isRole,
  listGrants,
  permits,
  readRoles,
  requiredRolesFor,
  revokeRole,
  ROLES,
  ROLE_LABELS,
} from "./roles";
import { changePassword, readPasswordState } from "./password";
import { recentActivity } from "./audit";
import { seasonsInPlay } from "./churchyear";
import {
  conditionSummary,
  coverage,
  dueRecount,
  leastSung,
  lendOut,
  markReturned,
  mostSung,
  openLoans,
  labelCandidates,
  labelContentsFor,
  recordLabelPrints,
  repairPriority,
  repertoireSuggestions,
  scanningPriority,
  seasonReadiness,
} from "./reports";
import {
  adminActivityPage,
  adminHomePage,
  adminLabelsPage,
  adminModulesPage,
  adminNoRolePage,
  adminAttendancePage,
  adminDutyEventPage,
  adminExportsPage,
  adminDutyTodayPage,
  adminPayPage,
  adminPeoplePage,
  adminPersonPage,
  adminSafeguardingPage,
  type DutyEvent,
  adminRegisterPage,
  adminRolesPage,
  adminWrongRolePage,
  adminSuggestionsPage,
  adminLoansPage,
  adminNewItemPage,
  adminQueuesPage,
  adminReportsPage,
  adminSearchPage,
  adminSettingsPage,
  adminStocktakePage,
  type AdminQueueCounts,
  type AdminSearchFilters,
} from "./ui-admin";

import { extractionAvailable, extractLabel } from "./extract";
import { NotConfiguredError, toContentBlock } from "./anthropic";
import {
  adminAccessionPage,
  adminEditPage,
  adminFeedbackPage,
  adminFeedResultPage,
  adminMatchQueuePage,
  adminScanQueuePage,
  adminImportPage,
  adminIntakeDonePage,
  adminIntakePage,
  adminReviewPage,
  browsePage,
  descantPage,
  errorPage,
  homePage,
  itemPage,
  loginPage,
  notFoundPage,
  portalCountPage,
  portalDonePage,
  manualForm,
  portalPage,
  servicePage,
  type HomeService,
} from "./ui";
import SEED_CSV from "../data/seed/bm-music-draft-index.csv";

/**
 * Shortest password the screen will take.
 *
 * Not a complexity rule — three ordinary words beat a jumble of symbols for
 * something a whole choir has to be told and remember, and a rule demanding a
 * digit and a capital would just produce "Anthem1" every term.
 */
const MIN_PASSWORD_LENGTH = 8;

const app = new Hono<AppEnv>();

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

/**
 * The admin gate: modules, then roles.
 *
 * Cloudflare Access has already decided that this person may reach `/admin`
 * (see `src/auth.ts`). This decides what is there when they do, and it is one
 * middleware over the whole prefix rather than a check inside each handler —
 * a route added next month is gated by existing, not by somebody remembering.
 *
 * **The order is deliberate.** The module check runs first and answers 404, so
 * a switched-off module is indistinguishable from a route that was never built,
 * whoever is asking. Only then do roles apply, and they answer a page rather
 * than a bare status: Access let this person in, so they are somebody the
 * Minster knows, and the honest answer is what to ask for and who to ask.
 *
 * `requiredRolesFor` fails closed on a path it has never heard of, so a route
 * that nobody added to the table is locked down rather than open.
 */
const adminGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const email = adminIdentity(c);

  // `wrangler dev` opens /admin entirely (ADMIN_MODE=local, never production),
  // and there is no Access header to carry an identity, so there would be no
  // roles to hold. Grant all three rather than lock the developer out of the
  // screens they are working on.
  const local = c.env.ADMIN_MODE === "local";

  const [modules, roles] = await Promise.all([
    readModuleState(c.env.DB),
    local ? Promise.resolve([...ROLES]) : readRoles(c.env.DB, email),
  ]);
  c.set("modules", modules);
  c.set("roles", roles);

  const module = moduleForPath(path);
  if (module && !modules[module]) return c.html(notFoundPage(), 404);

  if (!hasAnyRole(roles)) return c.html(adminNoRolePage(email), 403);

  const required = requiredRolesFor(path);
  if (!permits(roles, required)) return c.html(adminWrongRolePage(required), 403);

  return next();
};

app.use("/admin", adminGate);
app.use("/admin/*", adminGate);

/** No crawler should be here, and there is nothing for one to find. */
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

/**
 * The estate's brand assets: the Minster logo, the icons and the type faces.
 *
 * Unauthenticated, because the sign-in page needs them before there is a
 * session — see `src/assets.ts` for why that is not a hole in the gate. Served
 * with a one-year immutable cache so a phone in the song school downloads them
 * once and never again.
 */
app.get("/asset/:name", (c) => {
  const response = serveAsset(c.req.param("name"));
  return response ?? c.notFound();
});

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

app.get("/login", (c) => c.html(loginPage()));

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
  if (password && (await checkPassword(c.env, password))) {
    // Stamp the cookie with the generation in force now, so it survives until
    // the password is next changed and not a moment longer.
    const { generation } = await readPasswordState(c.env.DB);
    c.header("Set-Cookie", sessionCookieHeader(await createSessionValue(c.env, generation)));
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

/** Today, in the "YYYY-MM-DD" form the service table stores and sorts on. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Home (15A): the next service with its music, then what is coming, then what
 * is new.
 *
 * All four reads go out together — this is the page a chorister opens on the
 * bus with one bar of signal, and four round trips in sequence would be felt.
 */
app.get("/", async (c) => {
  const from = today();
  const [services, recent] = await Promise.all([
    upcomingServices(c.env.DB, from, 8),
    recentlyAdded(c.env.DB, 8),
  ]);

  const [nextService, ...later] = services;
  let next: HomeService | null = null;
  if (nextService) {
    const [music, typicalSingers] = await Promise.all([
      serviceMusic(c.env.DB, nextService.id),
      typicalSingersFor(c.env.DB, nextService.designation),
    ]);
    next = { service: nextService, music, typicalSingers };
  }

  return c.html(homePage(next, later, recent));
});

app.get("/music", async (c) => {
  const query = readSearchQuery(c.req.url);
  const [result, counts] = await Promise.all([
    searchPieces(c.env.DB, query),
    categoryCounts(c.env.DB),
  ]);
  return c.html(browsePage(query, result, counts));
});

/** The descant finder (H4): a hymn number in, a binder out. */
app.get("/descants", (c) => {
  const hymn = new URL(c.req.url).searchParams.get("hymn")?.trim() ?? "";
  return c.html(descantPage(hymn, hymn ? findDescant(hymn) : null));
});

app.get("/service/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const service = await getService(c.env.DB, id);
  if (!service) return c.html(notFoundPage(), 404);

  const [music, typicalSingers, booklet, duty] = await Promise.all([
    serviceMusic(c.env.DB, id),
    typicalSingersFor(c.env.DB, service.designation),
    latestBooklet(c.env.DB, id),
    choirSideDuty(c.env.DB, id),
  ]);

  const message = new URL(c.req.url).searchParams.get("wc") ?? undefined;
  return c.html(servicePage(service, music, typicalSingers, booklet, duty, message || undefined));
});

/**
 * Who is on duty, for the choir side.
 *
 * A7 allows exactly one piece of person data out here — a duty-holder's name on
 * a service page — and this is the only function that produces it. Names, by
 * role, primary cover only: a backup is an arrangement between adults and not
 * something a chorister's parent needs. Nothing else about the person leaves
 * this function, and nothing at all leaves it while the safeguarding module is
 * off, which is how it ships.
 */
async function choirSideDuty(
  db: D1Database,
  serviceId: number
): Promise<Array<{ role: string; label: string; names: string[] }>> {
  const modules = await readModuleState(db);
  if (!modules.safeguarding) return [];

  const duties = await dutiesFor(db, serviceId);
  return DUTY_ROLES.map((role) => ({
    role: role.value,
    label: role.label,
    names: duties
      .filter((d) => d.role === role.value && !d.is_backup)
      .map((d) => d.display_name),
  }));
}

app.get("/piece/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);
  const detail = await getPieceDetail(c.env.DB, id);
  if (!detail) return c.html(notFoundPage(), 404);

  const sung = await sungAt(c.env.DB, id);
  const params = new URL(c.req.url).searchParams;
  const scanMessage = params.has("scanned")
    ? { ok: true, text: "Thank you — those have gone to be checked. Nobody else sees them until then." }
    : params.has("scanfail")
      ? { ok: false, text: params.get("scanfail") ?? "Those photos could not be sent." }
      : undefined;

  return c.html(itemPage(detail, sung, scanMessage));
});

/**
 * A chorister's phone scan (18A, beta).
 *
 * Lands as a *pending* submission and an R2 object, visible to nobody until an
 * admin approves it. Fails soft: a photo that will not upload produces a
 * sentence on the piece page, never an error screen.
 */
app.post("/piece/:id/scan", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const piece = await getPiece(c.env.DB, id);
  if (!piece) return c.html(notFoundPage(), 404);

  if (!c.env.SCANS) {
    return c.redirect(`/piece/${id}?scanfail=${encodeURIComponent("Photos cannot be sent just now.")}`, 302);
  }

  const body = await c.req.parseBody({ all: true });
  const raw = body.scan;
  const uploads = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File && f.size > 0);

  if (!uploads.length) {
    return c.redirect(`/piece/${id}?scanfail=${encodeURIComponent("No photos were attached.")}`, 302);
  }

  try {
    const saved = await submitScans(c.env.DB, c.env.SCANS, id, uploads, str(body.submitted_label) || null);
    if (!saved) {
      return c.redirect(
        `/piece/${id}?scanfail=${encodeURIComponent("Those files were not photos we can take.")}`,
        302
      );
    }
  } catch (e) {
    console.error("scan submission failed", e);
    return c.redirect(
      `/piece/${id}?scanfail=${encodeURIComponent("Those photos could not be sent. Please try again.")}`,
      302
    );
  }

  return c.redirect(`/piece/${id}?scanned=1`, 302);
});

/** The feedback widget's endpoint. On every page, choir side and admin. */
app.post("/api/feedback", async (c) => {
  const body = await c.req.parseBody();

  // The honeypot. A person never sees this field; a bot fills it in. Answer 204
  // rather than an error, so a bot learns nothing from the difference.
  if (str(body.company)) return c.body(null, 204);

  const message = str(body.message);
  if (!message) return c.json({ error: "Please say what it is about." }, 400);

  await recordFeedback(c.env.DB, {
    page: str(body.page) || null,
    category: str(body.category) || null,
    // Bounded: this is free text from a browser and goes into a shared database.
    message: message.slice(0, 4000),
    ua: (c.req.header("User-Agent") ?? "").slice(0, 300) || null,
  });

  return c.json({ ok: true });
});

/** Read the admin table's filters off the query string. */
function readAdminSearch(url: string): AdminSearchFilters {
  const params = new URL(url).searchParams;
  const pick = (name: string, allowed?: readonly string[]) => {
    const value = params.get(name)?.trim() || undefined;
    if (!value) return undefined;
    return !allowed || allowed.includes(value) ? value : undefined;
  };

  return {
    q: pick("q"),
    category: pick("category", CHURCH.categories.map((x) => x.code)),
    season: pick("season", CHURCH.seasons.map((s) => s.value)),
    locationDoor: pick("door", CHURCH.storage.doors),
    scanned: pick("scanned", ["yes", "no"]),
    flagged: pick("flagged", ["flagged", "unreviewed", "reviewed"]),
    limit: 100,
  };
}

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

/**
 * Make (or reuse) a working copy for a service (17A, **beta**).
 *
 * Beta means it fails soft: every failure below sends the chorister back to the
 * service page with one sentence telling them what to do instead. None of them
 * shows an error screen, and none of them leaves a half-built PDF anywhere.
 *
 * The cache is content-addressed on exactly which scans went in, so tapping the
 * button twice costs one PDF while a newly approved scan still rebuilds.
 */
app.get("/service/:id/working-copy", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const service = await getService(c.env.DB, id);
  if (!service) return c.html(notFoundPage(), 404);

  const back = (why: string) => c.redirect(`/service/${id}?wc=${encodeURIComponent(why)}`, 302);

  if (!c.env.SCANS) return back("Working copies are not available just now.");

  const sources = await approvedScansForService(c.env.DB, id);
  if (!sources.length) {
    return back("None of the music for this service has been scanned yet, so there is nothing to join up.");
  }

  try {
    const hash = await contentHash(sources);
    const key = workingCopyKey(id, hash);
    const ref = workingCopyRef(id, hash);

    // Already built for exactly this set of scans: serve it and do no work.
    const cached = await c.env.SCANS.get(key);
    if (cached) return pdfResponse(cached.body, `${ref}.pdf`);

    const built = await buildWorkingCopy(c.env.SCANS, id, service.title, service.service_date, sources);
    await c.env.SCANS.put(key, built.bytes, { httpMetadata: { contentType: "application/pdf" } });
    await recordBooklet(c.env.DB, {
      ref,
      serviceId: id,
      title: `${service.title} — ${service.service_date}`,
      r2Key: key,
      kind: "working",
      contentHash: hash,
      pages: built.pages,
      bytes: built.bytes.byteLength,
    });

    return pdfResponse(built.bytes, `${ref}.pdf`);
  } catch (e) {
    if (e instanceof WorkingCopyError) return back(e.message);
    console.error("working copy failed", e);
    return back("The working copy could not be made just now. The scans are all still there to read one by one.");
  }
});

/** Stream a produced booklet, behind the same gate as everything else. */
app.get("/booklet/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);
  if (!c.env.SCANS) return c.html(errorPage("Booklets are not available just now."), 503);

  const row = await getBooklet(c.env.DB, id);
  if (!row) return c.html(notFoundPage(), 404);

  const object = await c.env.SCANS.get(row.r2_key);
  if (!object) return c.html(notFoundPage(), 404);

  return pdfResponse(object.body, `${row.ref}.pdf`);
});

/** A PDF, inline, private-cached — never in a shared cache. */
function pdfResponse(body: ReadableStream | Uint8Array | null, filename: string): Response {
  const headers = new Headers({
    "content-type": "application/pdf",
    "content-disposition": `inline; filename="${filename}"`,
    "cache-control": "private, max-age=300",
  });
  return new Response(body as BodyInit, { headers });
}

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
  const [stats, queues] = await Promise.all([catalogueStats(c.env.DB), adminQueueCounts(c.env.DB)]);
  return c.html(
    adminHomePage(stats, queues, extractionAvailable(c.env), c.get("modules"), c.get("roles"))
  );
});

/** The numbers on the admin home tiles, in one round trip. */
async function adminQueueCounts(db: D1Database): Promise<AdminQueueCounts> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM piece WHERE reviewed_at IS NULL) AS toReview,
         (SELECT COUNT(*) FROM service_music WHERE match_state != 'confirmed') AS musicLines,
         (SELECT COUNT(*) FROM scan_submission WHERE status = 'pending') AS pendingScans,
         (SELECT COUNT(*) FROM feedback WHERE resolved_at IS NULL) AS openFeedback,
         (SELECT COUNT(*) FROM repair_job WHERE status IN ('open','in_progress')) AS openRepairs,
         0 AS dueRecount`
    )
    .first<AdminQueueCounts>();

  // The recount list is the one number that needs the real query — it depends
  // on both the count date and how much has been sung since.
  const due = await dueRecount(db, today(), 500);
  return { ...(row ?? emptyQueueCounts()), dueRecount: due.length };
}

function emptyQueueCounts(): AdminQueueCounts {
  return { toReview: 0, musicLines: 0, pendingScans: 0, openFeedback: 0, openRepairs: 0, dueRecount: 0 };
}

// --- New catalogue item (5A as amended) -------------------------------------

app.get("/admin/new", (c) => c.html(adminNewItemPage(extractionAvailable(c.env), manualForm())));

// --- Search and bulk edit ---------------------------------------------------

app.get("/admin/search", async (c) => {
  const filters = readAdminSearch(c.req.url);
  const result = await adminSearchPieces(c.env.DB, filters);
  const changed = new URL(c.req.url).searchParams.get("changed");
  return c.html(
    adminSearchPage(
      filters,
      result,
      changed ? `${changed} ${changed === "1" ? "piece" : "pieces"} changed.` : undefined
    )
  );
});

app.post("/admin/search/bulk", async (c) => {
  const body = await c.req.parseBody({ all: true });

  const raw = body.id;
  const ids = (Array.isArray(raw) ? raw : [raw])
    .map((v) => Number(str(v)))
    .filter((n) => Number.isSafeInteger(n) && n > 0);

  if (!ids.length) {
    return c.html(errorPage("Tick the pieces you want to change first."), 400);
  }

  const shelf = str(body.location_shelf);
  const edit = {
    category: CHURCH.categories.some((x) => x.code === str(body.category)) ? str(body.category) : undefined,
    season: str(body.season) || undefined,
    locationDoor: CHURCH.storage.doors.includes(str(body.location_door)) ? str(body.location_door) : undefined,
    locationShelf: /^\d{1,3}$/.test(shelf) ? Number(shelf) : undefined,
    spineState: ["ok", "none", "combined"].includes(str(body.spine_state)) ? str(body.spine_state) : undefined,
  };

  const changed = await applyBulkEdit(c.env.DB, ids, edit);
  if (!changed) {
    return c.html(errorPage("Nothing was changed — every box in the bulk editor was left alone."), 400);
  }

  await logAdminAction(
    c,
    "bulk.edit",
    "piece",
    null,
    `${changed} pieces: ${Object.entries(edit)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`
  );

  return c.redirect(`/admin/search?changed=${changed}`, 302);
});

// --- Reports and queues -----------------------------------------------------

app.get("/admin/reports", async (c) => {
  const now = new Date();
  // A year back, which is the window James thinks in: "have we done this since
  // last Advent?"
  const since = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);

  const [cover, most, least, conditions, readiness] = await Promise.all([
    coverage(c.env.DB),
    mostSung(c.env.DB, since),
    leastSung(c.env.DB, since),
    conditionSummary(c.env.DB),
    seasonReadiness(c.env.DB, seasonsInPlay(now)),
  ]);

  return c.html(adminReportsPage(cover, most, least, conditions, readiness, since));
});

app.get("/admin/queues", async (c) => {
  const [scanning, repairs] = await Promise.all([
    scanningPriority(c.env.DB, today(), seasonsInPlay(new Date())),
    repairPriority(c.env.DB),
  ]);
  return c.html(adminQueuesPage(scanning, repairs));
});

app.get("/admin/stocktake", async (c) => {
  return c.html(adminStocktakePage(await dueRecount(c.env.DB, today())));
});

// --- Loans (H5) -------------------------------------------------------------

app.get("/admin/loans", async (c) => {
  const message = new URL(c.req.url).searchParams.get("done") ?? undefined;
  return c.html(adminLoansPage(await openLoans(c.env.DB), message || undefined));
});

app.post("/admin/loans", async (c) => {
  const body = await c.req.parseBody();
  const pieceId = Number(str(body.piece_id));
  const copies = Number(str(body.copies));
  const borrower = str(body.borrower);

  if (!Number.isSafeInteger(pieceId) || pieceId <= 0 || !borrower) {
    return c.html(errorPage("A piece number and somebody's name are both needed."), 400);
  }
  if (!Number.isSafeInteger(copies) || copies <= 0) {
    return c.html(errorPage("How many copies are going out?"), 400);
  }

  const dueBack = str(body.due_back);
  await lendOut(
    c.env.DB,
    {
      pieceId,
      copies,
      borrower,
      reason: str(body.reason) || null,
      dueBack: /^\d{4}-\d{2}-\d{2}$/.test(dueBack) ? dueBack : null,
    },
    adminIdentity(c)
  );
  await logAdminAction(c, "loan.out", "piece", pieceId, `${copies} to ${borrower}`);
  return c.redirect(`/admin/loans?done=${encodeURIComponent(`Logged out to ${borrower}.`)}`, 302);
});

app.post("/admin/loans/:id/back", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);
  await markReturned(c.env.DB, id);
  await logAdminAction(c, "loan.back", "loan", id, null);
  return c.redirect(`/admin/loans?done=${encodeURIComponent("Marked as back.")}`, 302);
});

// --- Settings: password, choir sizes, activity ------------------------------

app.get("/admin/settings", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const [profiles, state] = await Promise.all([
    choirProfiles(c.env.DB),
    readPasswordState(c.env.DB),
  ]);
  return c.html(
    adminSettingsPage(
      profiles,
      state.hash !== null,
      state.generation,
      params.get("done") ?? undefined,
      params.get("problem") ?? undefined
    )
  );
});

/**
 * Change the choir password (11A).
 *
 * Typed twice, because getting it wrong here signs the whole choir out and
 * leaves nobody — James included — able to get back in without coming to this
 * screen again.
 */
app.post("/admin/settings/password", async (c) => {
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
  const confirm = typeof body.confirm === "string" ? body.confirm : "";

  const problem = (why: string) => c.redirect(`/admin/settings?problem=${encodeURIComponent(why)}`, 302);

  if (password !== confirm) return problem("The two passwords did not match. Nothing has been changed.");
  if (password.trim().length < MIN_PASSWORD_LENGTH) {
    return problem(
      `That is too short to be a term's password — ${MIN_PASSWORD_LENGTH} characters at least. Nothing has been changed.`
    );
  }

  const generation = await changePassword(c.env.DB, password, adminIdentity(c));
  // Deliberately not logging the password, obviously — but not its length or
  // any part of it either. Only that it changed, and to which generation.
  await logAdminAction(c, "password.change", "app_setting", null, `now generation ${generation}`);

  return c.redirect(
    `/admin/settings?done=${encodeURIComponent(
      "The password is changed and everybody has been signed out. Tell the choir the new one."
    )}`,
    302
  );
});

app.post("/admin/settings/choirs", async (c) => {
  const body = await c.req.parseBody();
  let changed = 0;

  for (const [key, value] of Object.entries(body)) {
    const match = /^singers-(\d+)$/.exec(key);
    if (!match) continue;
    const id = Number(match[1]);
    const raw = str(value);
    // Empty means "still not known", which is a real answer and stores NULL.
    const singers = raw === "" ? null : Number(raw);
    if (singers !== null && (!Number.isSafeInteger(singers) || singers < 0 || singers > 200)) continue;
    await setChoirSize(c.env.DB, id, singers);
    changed++;
  }

  const added = str(body.new_designation);
  if (added) await saveChoirProfile(c.env.DB, added, null);

  await logAdminAction(c, "choirs.update", "choir_profile", null, `${changed} updated${added ? `, added ${added}` : ""}`);
  return c.redirect(`/admin/settings?done=${encodeURIComponent("Saved.")}`, 302);
});

app.get("/admin/activity", async (c) => {
  return c.html(adminActivityPage(await recentActivity(c.env.DB, 200)));
});

// ---------------------------------------------------------------------------
// Modules and roles (Addendum A) — music staff only, gated above
// ---------------------------------------------------------------------------

app.get("/admin/modules", async (c) => {
  const message = new URL(c.req.url).searchParams.get("done") ?? undefined;
  return c.html(adminModulesPage(c.get("modules"), message || undefined));
});

app.post("/admin/modules", async (c) => {
  const body = await c.req.parseBody();
  const module = str(body.module);
  if (!isModuleKey(module)) return c.html(errorPage("That is not a module."), 400);

  const on = str(body.on) === "1";
  await setModule(c.env.DB, module, on, adminIdentity(c));

  // Worth a line: "who switched the register on?" is a question somebody may
  // one day ask, and a module flag is exactly the sort of change nobody
  // remembers making.
  await logAdminAction(c, on ? "module.on" : "module.off", "app_setting", null, `module.${module}`);
  return c.redirect(
    `/admin/modules?done=${encodeURIComponent(on ? "Switched on." : "Switched off.")}`,
    302
  );
});

app.get("/admin/roles", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const [grants, musicStaff] = await Promise.all([listGrants(c.env.DB), countMusicStaff(c.env.DB)]);
  return c.html(
    adminRolesPage(grants, musicStaff, params.get("done") ?? undefined, params.get("error") ?? undefined)
  );
});

app.post("/admin/roles", async (c) => {
  const body = await c.req.parseBody();
  const action = str(body.action);
  const email = str(body.email).trim().toLowerCase();
  const role = str(body.role);

  if (!email || !email.includes("@")) {
    return c.redirect(`/admin/roles?error=${encodeURIComponent("That does not look like an email address.")}`, 302);
  }
  if (!isRole(role)) return c.html(errorPage("That is not a role."), 400);

  if (action === "revoke") {
    // The last music_staff grant cannot go. Without one there is nobody who can
    // grant anybody anything, and this screen is itself music staff only — the
    // way back would be a migration.
    if (role === "music_staff" && (await countMusicStaff(c.env.DB)) <= 1) {
      return c.redirect(
        `/admin/roles?error=${encodeURIComponent(
          "That is the last music staff role. Give it to somebody else first, or nobody will be able to give out roles at all."
        )}`,
        302
      );
    }
    await revokeRole(c.env.DB, email, role);
    await logAdminAction(c, "role.revoke", "admin_role", null, `${role} from ${email}`);
    return c.redirect(`/admin/roles?done=${encodeURIComponent("Removed.")}`, 302);
  }

  await grantRole(c.env.DB, email, role, adminIdentity(c));
  // An admin's work email is not a chorister's personal data, and who holds
  // which role is precisely what this line exists to record.
  await logAdminAction(c, "role.grant", "admin_role", null, `${role} to ${email}`);
  return c.redirect(
    `/admin/roles?done=${encodeURIComponent(`${ROLE_LABELS[role]} given to ${email}.`)}`,
    302
  );
});

// ---------------------------------------------------------------------------
// Labels (1A, H10) and the QR route (H1)
// ---------------------------------------------------------------------------

app.get("/admin/labels", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const door = params.get("door")?.trim();
  const unlabelled = params.get("unlabelled") === "1";

  const candidates = await labelCandidates(c.env.DB, {
    door: door && CHURCH.storage.doors.includes(door) ? door : undefined,
    unlabelled,
  });

  return c.html(adminLabelsPage(candidates, { door: door ?? undefined, unlabelled }, params.get("note") ?? undefined));
});

/**
 * Build a label PDF.
 *
 * Streamed straight back rather than stored: a label sheet is a thing you print
 * once and throw away, and keeping every run in R2 would fill a bucket with
 * paper nobody will look at again. What *is* recorded is that it was printed —
 * `label_print` — so a reprint or a combined-label run can be traced later.
 */
app.post("/admin/labels/print", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const stock = str(body.stock);

  // The calibration pages need no pieces at all: they are the die-cut outline.
  if (stock === "calibration-volunteer" || stock === "calibration-avery") {
    const bytes =
      stock === "calibration-volunteer"
        ? await buildVolunteerSheets([])
        : await buildAverySheet([], { calibration: true });
    return pdfResponse(bytes, `calibration-${stock === "calibration-avery" ? "avery" : "volunteer"}.pdf`);
  }

  const raw = body.id;
  const ids = (Array.isArray(raw) ? raw : [raw])
    .map((v) => Number(str(v)))
    .filter((n) => Number.isSafeInteger(n) && n > 0);

  if (!ids.length) {
    return c.html(errorPage("Tick at least one piece to print a label for."), 400);
  }

  const contents = await labelContentsFor(c.env.DB, ids);
  if (!contents.length) {
    return c.html(errorPage("None of those pieces could be found."), 404);
  }

  try {
    const kind = ["spine", "face", "combined"].includes(str(body.kind)) ? str(body.kind) : "spine";

    if (stock === "volunteer") {
      const bytes = await buildVolunteerSheets(contents);
      await recordLabelPrints(c.env.DB, contents.map((x: { pieceId: number }) => x.pieceId), "spine", adminIdentity(c));
      await logAdminAction(c, "labels.print", "piece", null, `${contents.length} volunteer sheets`);
      return pdfResponse(bytes, "volunteer-sheets.pdf");
    }

    // Positions are 1-based on the screen because that is how somebody counts
    // labels on a sheet in their hand; the geometry is 0-based.
    const start = Number(str(body.start));
    const startAt = Number.isSafeInteger(start) && start > 0 ? start - 1 : 0;

    const bytes = await buildAverySheet(contents, { startAt, calibration: true });
    await recordLabelPrints(c.env.DB, contents.map((x: { pieceId: number }) => x.pieceId), kind, adminIdentity(c));
    await logAdminAction(c, "labels.print", "piece", null, `${contents.length} ${kind} labels`);
    return pdfResponse(bytes, `${kind}-labels.pdf`);
  } catch (e) {
    console.error("label print failed", e);
    return c.html(
      errorPage("Those labels could not be made just now. Try a smaller selection, or tell James."),
      500
    );
  }
});

/**
 * The QR route (H1): `/q/BM-0042` → the piece.
 *
 * Short and stable on purpose. The accession is written on the parcel in ink,
 * so it is the one identifier that cannot go stale — a `/piece/:id` link could
 * be renumbered by a re-import, and a printed QR cannot be reprinted on four
 * hundred parcels. When the app moves to music.beverleyminster.org.uk, the old
 * hostname keeps a Worker that 301s everything here, and the printed codes go
 * on working.
 *
 * Behind the choir gate like everything else: scanning a label still needs the
 * term's password.
 */
app.get("/q/:accession", async (c) => {
  const accession = c.req.param("accession");
  const piece = await getPieceByAccession(c.env.DB, accession);
  if (!piece) {
    return c.html(
      errorPage(
        `Nothing in the catalogue has the number ${accession}. If it is written on a parcel, ` +
          `tell ${CHURCH.contact.maintainer.shortName} — the label may be older than the catalogue.`
      ),
      404
    );
  }
  return c.redirect(`/piece/${piece.id}`, 302);
});

// ---------------------------------------------------------------------------
// People and the register (beta)
// ---------------------------------------------------------------------------

app.get("/admin/people", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const leavers = params.get("leavers") === "1";
  return c.html(
    adminPeoplePage(await listPeople(c.env.DB, leavers), leavers, params.get("done") ?? undefined)
  );
});

app.post("/admin/people", async (c) => {
  const body = await c.req.parseBody();
  const displayName = str(body.display_name);
  const choir = str(body.choir);
  const voicePart = str(body.voice_part);

  if (!displayName) return c.html(errorPage("A name is needed."), 400);
  if (!isChoir(choir)) return c.html(errorPage("Choose which choir they sing in."), 400);

  await addPerson(c.env.DB, {
    displayName,
    choir,
    voicePart: voicePart && isVoicePart(voicePart) ? voicePart : null,
    schoolYear: schoolYearParam(str(body.school_year)),
  });

  // Deliberately not naming the person in the audit log: that log is read by
  // admins looking for a mistake, and a child's name has no business in it.
  await logAdminAction(c, "person.add", "person", null, `one added to ${choir}`);
  return c.redirect(`/admin/people?done=${encodeURIComponent("Added.")}`, 302);
});

/**
 * A school year off a form, or null for an adult.
 *
 * Anything outside Reception to Year 13 is null rather than an error: the only
 * way to send one is to edit the form by hand, and a silently blank school year
 * is a smaller harm than a 400 on a screen somebody is trying to fill in.
 */
function schoolYearParam(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 13 ? n : null;
}

/** A "YYYY-MM-DD" off a date field, or null. Never a partially-typed date. */
function dateParam(raw: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// Exports (Addendum A, A6)
// ---------------------------------------------------------------------------

/**
 * Everything that can be taken out, filtered the way the front page is.
 *
 * Declared here rather than in the page so that the filter is the gate's own
 * two functions and not a second opinion about them: an export whose route the
 * reader could not reach is not offered.
 */
const EXPORTS: ReadonlyArray<{ href: string; label: string; blurb: string }> = [
  {
    href: "/admin/search/export.csv",
    label: "The catalogue",
    blurb: "Every piece, with its accession number, location, copies and condition.",
  },
  {
    href: "/admin/services/export.csv",
    label: "Services and their music",
    blurb: "Every service on file and every line of its music list, matched or not.",
  },
  {
    href: "/admin/people/export.csv",
    label: "The choir",
    blurb: "Names, choirs, school years, joining and award dates. No contact details.",
  },
  {
    href: "/admin/people/attendance.csv",
    label: "Attendance, this quarter",
    blurb: "Per person, per month, with the percentage.",
  },
  {
    href: "/admin/people/pay.csv",
    label: "Pay, this quarter",
    blurb: "Per person, priced at the rates in force on each day.",
  },
  {
    href: "/admin/safeguarding/export.csv",
    label: "The duty rota",
    blurb: "Who is on what, for every event on file, with the collection ticks.",
  },
];

app.get("/admin/export", (c) => {
  const modules = c.get("modules");
  const roles = c.get("roles");

  const visible = (href: string): boolean => {
    const path = href.split("?")[0]!;
    const module = moduleForPath(path);
    if (module && !modules[module]) return false;
    return permits(roles, requiredRolesFor(path));
  };

  const contactsHref = "/admin/people/contacts.csv";
  return c.html(
    adminExportsPage(
      EXPORTS.filter((e) => visible(e.href)),
      visible(contactsHref)
        ? {
            href: contactsHref,
            label: "Parents' contact details",
            blurb: "The only export that carries a telephone number.",
            contacts: true,
          }
        : null,
      new URL(c.req.url).searchParams.get("done") ?? undefined
    )
  );
});

app.get("/admin/search/export.csv", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT p.accession, p.composer, p.title, p.category, p.voicing, p.season,
              p.location, p.location_door, p.location_shelf, p.spine_state, p.legacy_ref,
              h.copies_total, h.copies_usable, h.condition, h.last_counted,
              CASE WHEN p.reviewed_at IS NULL THEN 'no' ELSE 'yes' END AS reviewed
         FROM piece p LEFT JOIN holding h ON h.piece_id = p.id
        ORDER BY p.composer_canonical, p.title`
    )
    .all<Record<string, unknown>>();
  const results = rows.results ?? [];

  const csv = toCsv(
    ["Accession", "Composer", "Title", "Category", "Voicing", "Season", "Location", "Door", "Shelf",
     "Spine", "Legacy ref", "Copies", "Usable", "Condition", "Last counted", "Reviewed"],
    results.map((r) => [
      r.accession, r.composer, r.title, r.category, r.voicing, r.season, r.location,
      r.location_door, r.location_shelf, r.spine_state, r.legacy_ref,
      r.copies_total, r.copies_usable, r.condition, r.last_counted, r.reviewed,
    ])
  );

  await logAdminAction(c, "export.catalogue", "app_setting", null, `${results.length} pieces`);
  return csvResponse(csv, `catalogue-${today()}.csv`);
});

app.get("/admin/services/export.csv", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT s.service_date, s.service_time, s.title, s.designation,
              COALESCE(s.event_type, 'regular') AS event_type, s.source,
              m.slot, m.raw_text, m.match_state, p.accession, p.title AS piece_title
         FROM service s
         LEFT JOIN service_music m ON m.service_id = s.id
         LEFT JOIN piece p ON p.id = m.piece_id
        ORDER BY s.service_date, COALESCE(s.service_time,'00:00'), m.position`
    )
    .all<Record<string, unknown>>();
  const results = rows.results ?? [];

  const csv = toCsv(
    ["Date", "Time", "Service", "Designation", "Kind", "Source", "Slot", "As written", "Match", "Accession", "Matched to"],
    results.map((r) => [
      r.service_date, r.service_time, r.title, r.designation, r.event_type, r.source,
      r.slot, r.raw_text, r.match_state, r.accession, r.piece_title,
    ])
  );

  await logAdminAction(c, "export.services", "app_setting", null, `${results.length} lines`);
  return csvResponse(csv, `services-${today()}.csv`);
});

/**
 * The choir list.
 *
 * **No parent contacts.** Not omitted by remembering, either: `listPeople`
 * reads `person`, and `person` has no column that could carry one — the
 * telephone numbers are in another table entirely, and getting them into a file
 * takes the deliberate act below.
 */
app.get("/admin/people/export.csv", async (c) => {
  const people = await listPeople(c.env.DB, true);
  const csv = toCsv(
    ["Name", "Choir", "School year", "Voice part", "Joined", "Surpliced", "Dean's", "Archbishop's",
     "Gold", "DBS valid until", "Left"],
    people.map((p) => [
      p.display_name,
      CHOIRS.find((ch) => ch.value === p.choir)?.label ?? p.choir,
      schoolYearLabel(p.school_year),
      p.voice_part,
      p.joined_on,
      p.surplice_awarded_on,
      p.deans_award_on,
      p.archbishops_award_on,
      p.gold_award_on,
      p.dbs_valid_until,
      p.left_on,
    ])
  );

  await logAdminAction(c, "export.people", "app_setting", null, `${people.length} people, no contacts`);
  return csvResponse(csv, `choir-${today()}.csv`);
});

/**
 * The one export that carries a telephone number.
 *
 * Music staff only — `/admin/people/contacts` is its own row in the role table
 * precisely so this is not the same permission as the per-child reveal, which
 * safeguarding may also do. Audited separately from every other export, with a
 * fingerprint of the file, and named in the log as what it is.
 */
app.get("/admin/people/contacts.csv", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT p.display_name, p.choir, p.school_year, c.label, c.name, c.phone
         FROM parent_contact c
         JOIN person p ON p.id = c.person_id
        WHERE p.left_on IS NULL
        ORDER BY p.choir, p.display_name, c.id`
    )
    .all<{
      display_name: string;
      choir: string;
      school_year: number | null;
      label: string | null;
      name: string | null;
      phone: string | null;
    }>();
  const results = rows.results ?? [];

  const csv = toCsv(
    ["Child", "Choir", "School year", "Who", "Name", "Telephone"],
    results.map((r) => [
      r.display_name,
      CHOIRS.find((ch) => ch.value === r.choir)?.label ?? r.choir,
      schoolYearLabel(r.school_year),
      r.label,
      r.name,
      r.phone,
    ])
  );

  const hash = await sha256Hex(csv);
  await logAdminAction(
    c,
    "export.contacts",
    "app_setting",
    null,
    `parents' contact details for ${results.length} children, sha256 ${hash.slice(0, 16)}`
  );
  return csvResponse(csv, `contacts-${today()}.csv`);
});

app.get("/admin/safeguarding/export.csv", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT s.service_date, s.service_time, s.title, s.designation,
              COALESCE(s.event_type,'regular') AS event_type,
              d.role, d.is_backup, p.display_name, p.dbs_valid_until,
              d.all_collected_at, d.all_collected_by
         FROM duty d
         JOIN service s ON s.id = d.service_id
         JOIN person p ON p.id = d.person_id
        ORDER BY s.service_date, COALESCE(s.service_time,'00:00'), d.role, d.is_backup`
    )
    .all<Record<string, unknown>>();
  const results = rows.results ?? [];

  const csv = toCsv(
    ["Date", "Time", "Event", "Designation", "Kind", "Duty", "Backup", "Who", "DBS valid until",
     "All collected at", "Ticked by"],
    results.map((r) => [
      r.service_date, r.service_time, r.title, r.designation, r.event_type,
      r.role, r.is_backup ? "yes" : "", r.display_name, r.dbs_valid_until,
      r.all_collected_at, r.all_collected_by,
    ])
  );

  await logAdminAction(c, "export.duty", "app_setting", null, `${results.length} duties`);
  return csvResponse(csv, `duty-rota-${today()}.csv`);
});

// ---------------------------------------------------------------------------
// Attendance, rates and pay (Addendum A, A4)
// ---------------------------------------------------------------------------

/** The quarter a request asks for, or the one we are in. */
function quarterParam(url: string): Quarter {
  const ref = new URL(url).searchParams.get("quarter");
  return (ref && parseQuarterRef(ref)) || quarterOf(today());
}

app.get("/admin/people/attendance", async (c) => {
  const quarter = quarterParam(c.req.url);
  const [lines, possible, people] = await Promise.all([
    attendanceLines(c.env.DB, quarter.from, quarter.to),
    possibleByPersonMonth(c.env.DB, quarter.from, quarter.to),
    // Leavers included: somebody who left in October still sang in September,
    // and a quarter's totals that quietly drop them are wrong.
    listPeople(c.env.DB, true),
  ]);

  const totals = totalsByPerson(lines, possible, people).filter((t) => t.present || t.possible);
  const months = totals[0]?.months.map((m) => m.month) ?? [];

  return c.html(adminAttendancePage(quarter, recentQuarters(today()), totals, months));
});

app.get("/admin/people/attendance.csv", async (c) => {
  const quarter = quarterParam(c.req.url);
  const [lines, possible, people] = await Promise.all([
    attendanceLines(c.env.DB, quarter.from, quarter.to),
    possibleByPersonMonth(c.env.DB, quarter.from, quarter.to),
    listPeople(c.env.DB, true),
  ]);

  const totals = totalsByPerson(lines, possible, people).filter((t) => t.present || t.possible);
  const months = totals[0]?.months.map((m) => m.month) ?? [];

  // Names and counts. **No parent contact, no DBS date, no award date** — a
  // person export is not a dump of the person table, and the one export that
  // carries a telephone number is elsewhere and separately audited.
  const csv = toCsv(
    ["Name", "Choir", ...months.flatMap((m) => [`${m} present`, `${m} possible`]), "Present", "Possible", "%"],
    totals.map((t) => [
      t.display_name,
      t.choir,
      ...t.months.flatMap((m) => [m.present, m.possible]),
      t.present,
      t.possible,
      t.percent ?? "",
    ])
  );

  await logAdminAction(c, "export.attendance", "app_setting", null, `${quarter.ref}, ${totals.length} people`);
  return csvResponse(csv, `attendance-${quarter.ref}.csv`);
});

app.get("/admin/people/pay", async (c) => {
  const quarter = quarterParam(c.req.url);
  const [lines, rates] = await Promise.all([
    attendanceLines(c.env.DB, quarter.from, quarter.to),
    listRates(c.env.DB),
  ]);

  return c.html(
    adminPayPage(
      payRun(quarter, lines, rates),
      recentQuarters(today()),
      rates,
      new URL(c.req.url).searchParams.get("done") ?? undefined
    )
  );
});

/**
 * The pay run as a file, with a fingerprint written down.
 *
 * The audit line carries a SHA-256 of the exact bytes sent. Somebody holding a
 * printed pay run six months later can hash the file they still have and find
 * the moment it was made and who made it — which is the only way a paper
 * figure and a database figure can be reconciled after the fact.
 */
app.get("/admin/people/pay.csv", async (c) => {
  const quarter = quarterParam(c.req.url);
  const [lines, rates] = await Promise.all([
    attendanceLines(c.env.DB, quarter.from, quarter.to),
    listRates(c.env.DB),
  ]);

  const run = payRun(quarter, lines, rates);
  const csv = toCsv(
    ["Name", "Choir", "Services", "Weddings", "Not priced", "Due"],
    [
      ...run.lines.map((l) => [
        l.display_name,
        l.choir,
        l.services,
        l.weddings,
        l.unrated || "",
        pounds(l.pence),
      ]),
      ["Total", "", "", "", "", pounds(run.totalPence)],
    ]
  );

  const hash = await sha256Hex(csv);
  await logAdminAction(
    c,
    "export.pay",
    "app_setting",
    null,
    `${quarter.ref}, ${run.lines.length} people, ${pounds(run.totalPence)}, sha256 ${hash.slice(0, 16)}`
  );
  return csvResponse(csv, `pay-${quarter.ref}.csv`);
});

app.post("/admin/people/rates", async (c) => {
  const body = await c.req.parseBody();

  if (str(body.action) === "delete") {
    const id = numericParam(str(body.id));
    if (id === null) return c.html(notFoundPage(), 404);
    await deleteRate(c.env.DB, id);
    await logAdminAction(c, "rate.delete", "rate", id, "a rate was removed");
    return c.redirect(`/admin/people/pay?done=${encodeURIComponent("Removed.")}`, 302);
  }

  const role = str(body.role);
  if (!isRateRole(role)) return c.html(errorPage("That is not something we pay for."), 400);

  const pence = penceFrom(str(body.amount));
  if (pence === null) {
    return c.html(errorPage("Write the amount in pounds, like 4.50."), 400);
  }
  const from = str(body.effective_from);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return c.html(errorPage("A rate needs a date it starts from."), 400);
  }

  await addRate(c.env.DB, { role, amountPence: pence, effectiveFrom: from, by: adminIdentity(c) });
  // A rate is a fact about money and not about a person, so it is logged in
  // full — this is exactly the line somebody will want six months later.
  await logAdminAction(c, "rate.set", "rate", null, `${role} ${pounds(pence)} from ${from}`);
  return c.redirect(`/admin/people/pay?done=${encodeURIComponent("Rate set.")}`, 302);
});

/** SHA-256 of some text, hex. Used to fingerprint an export in the audit log. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A CSV as a download, never cached anywhere. */
function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

// ---------------------------------------------------------------------------
// The safeguarding rota (Addendum A, A5)
// ---------------------------------------------------------------------------

/** `app_setting` key for the ratio. Unset means the check is not run at all. */
const RATIO_KEY = "safeguarding.children_per_adult";

async function readChildrenPerAdult(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare(`SELECT value FROM app_setting WHERE key = ?`)
    .bind(RATIO_KEY)
    .first<{ value: string | null }>();
  const n = Number(row?.value ?? "");
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Assemble one event with its duties, its coverage and its headcount. */
function toDutyEvent(
  service: ServiceRow & { event_type?: string | null },
  duties: DutyRow[],
  childrenPerAdult: number | null,
  todayIso: string
): DutyEvent {
  const childrenExpected = childrenFor(service.designation);
  return {
    service: {
      id: service.id,
      service_date: service.service_date,
      service_time: service.service_time,
      title: service.title,
      designation: service.designation,
      event_type: service.event_type ?? null,
    },
    duties,
    childrenExpected,
    coverage: dutyCoverage({
      duties,
      designation: service.designation,
      childrenExpected,
      childrenPerAdult,
      today: todayIso,
    }),
  };
}

app.get("/admin/safeguarding", async (c) => {
  const now = today();
  const [services, childrenPerAdult] = await Promise.all([
    upcomingServices(c.env.DB, now, 30),
    readChildrenPerAdult(c.env.DB),
  ]);
  const duties = await dutiesForServices(c.env.DB, services.map((s) => s.id));

  return c.html(
    adminSafeguardingPage(
      services.map((s) => toDutyEvent(s, duties.get(s.id) ?? [], childrenPerAdult, now)),
      childrenPerAdult,
      new URL(c.req.url).searchParams.get("done") ?? undefined
    )
  );
});

/**
 * Today, on a phone, in a doorway.
 *
 * Registered before `/admin/safeguarding/:id` on purpose: Hono matches in
 * declaration order, and "today" would otherwise be read as a service id.
 */
app.get("/admin/safeguarding/today", async (c) => {
  const now = today();
  const [services, childrenPerAdult] = await Promise.all([
    todaysServices(c.env.DB, now),
    readChildrenPerAdult(c.env.DB),
  ]);
  const duties = await dutiesForServices(c.env.DB, services.map((s) => s.id));

  return c.html(
    adminDutyTodayPage(
      services.map((s) => toDutyEvent(s, duties.get(s.id) ?? [], childrenPerAdult, now)),
      adminIdentity(c),
      // The register is a module of its own and may well be off while the rota
      // is on. No point offering a door that answers 404.
      c.get("modules").attendance,
      new URL(c.req.url).searchParams.get("done") ?? undefined
    )
  );
});

/** Everything on one day, manual events included. */
async function todaysServices(db: D1Database, date: string): Promise<ServiceRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM service WHERE service_date = ?
        ORDER BY COALESCE(service_time, '00:00')`
    )
    .bind(date)
    .all<ServiceRow>();
  return rows.results ?? [];
}

app.post("/admin/safeguarding/events", async (c) => {
  const body = await c.req.parseBody();
  const title = str(body.title);
  const date = str(body.date);
  const eventType = str(body.event_type);

  if (!title) return c.html(errorPage("The event needs a name."), 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.html(errorPage("The event needs a date."), 400);
  if (!isEventType(eventType)) return c.html(errorPage("That is not a kind of event."), 400);

  const id = await createManualEvent(c.env.DB, {
    date,
    time: /^\d{2}:\d{2}$/.test(str(body.time)) ? str(body.time) : null,
    title,
    designation: str(body.designation) || null,
    eventType,
  });

  // An event is not personal data — a practice on a Thursday is a fact about
  // the diary — so it is named in full here.
  await logAdminAction(c, "event.add", "service", id, `${eventType} on ${date}: ${title}`);
  return c.redirect(`/admin/safeguarding/${id}`, 302);
});

app.post("/admin/safeguarding/ratio", async (c) => {
  const body = await c.req.parseBody();
  const raw = str(body.children_per_adult);
  const n = Number(raw);
  const value = raw && Number.isInteger(n) && n > 0 && n <= 50 ? String(n) : null;

  if (value === null) {
    await c.env.DB.prepare(`DELETE FROM app_setting WHERE key = ?`).bind(RATIO_KEY).run();
  } else {
    await c.env.DB
      .prepare(
        `INSERT INTO app_setting (key, value, updated_by, updated_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
         ON CONFLICT (key) DO UPDATE SET value = excluded.value,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      )
      .bind(RATIO_KEY, value, adminIdentity(c))
      .run();
  }

  await logAdminAction(
    c,
    "safeguarding.ratio",
    "app_setting",
    null,
    value === null ? "ratio check switched off" : `${value} children per adult`
  );
  return c.redirect(
    `/admin/safeguarding?done=${encodeURIComponent(value === null ? "The ratio check is off." : "Saved.")}`,
    302
  );
});

/**
 * The Thursday tick.
 *
 * Its own route rather than a field on the duty form, because it is the one
 * action on this screen that records a safeguarding fact about children rather
 * than an arrangement about adults. `markAllCollected` will not overwrite an
 * existing tick: "they had all gone, and then they had not" is not a state the
 * record should be able to hold.
 */
app.post("/admin/safeguarding/collected", async (c) => {
  const body = await c.req.parseBody();
  const dutyId = numericParam(str(body.duty_id));
  if (dutyId === null) return c.html(notFoundPage(), 404);

  await markAllCollected(c.env.DB, dutyId, adminIdentity(c));
  await logAdminAction(c, "duty.collected", "duty", dutyId, "every child under 18 collected");
  return c.redirect(
    `/admin/safeguarding/today?done=${encodeURIComponent("Recorded, with your name and the time.")}`,
    302
  );
});

app.get("/admin/safeguarding/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const service = await getService(c.env.DB, id);
  if (!service) return c.html(notFoundPage(), 404);

  const now = today();
  const [duties, childrenPerAdult, people] = await Promise.all([
    dutiesFor(c.env.DB, id),
    readChildrenPerAdult(c.env.DB),
    listPeople(c.env.DB),
  ]);

  return c.html(
    adminDutyEventPage(
      toDutyEvent(service, duties, childrenPerAdult, now),
      dutyCandidates(people),
      new URL(c.req.url).searchParams.get("done") ?? undefined
    )
  );
});

app.post("/admin/safeguarding/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const body = await c.req.parseBody();

  if (str(body.action) === "remove") {
    const dutyId = numericParam(str(body.duty_id));
    if (dutyId === null) return c.html(notFoundPage(), 404);
    await removeDuty(c.env.DB, dutyId);
    // Adults, not children — but still a name, so the log records the event
    // and not who was taken off it.
    await logAdminAction(c, "duty.remove", "service", id, "somebody taken off a duty");
    return c.redirect(`/admin/safeguarding/${id}?done=${encodeURIComponent("Taken off.")}`, 302);
  }

  const personId = numericParam(str(body.person_id));
  const role = str(body.role);
  if (personId === null || !isDutyRole(role)) return c.html(errorPage("Choose somebody and a duty."), 400);

  await assignDuty(c.env.DB, id, personId, role, str(body.is_backup) === "1");
  await logAdminAction(c, "duty.assign", "service", id, `somebody put on ${role}`);
  return c.redirect(`/admin/safeguarding/${id}?done=${encodeURIComponent("Added.")}`, 302);
});

// ---------------------------------------------------------------------------
// One person, by id
//
// **Registered after every literal `/admin/people/...` route on purpose.**
// Hono matches in declaration order, so `/admin/people/:id` declared earlier
// would swallow `/admin/people/pay` and answer 404 for it — which is exactly
// what happened, and what `test/gate.test.ts` now refuses to let happen again.
// ---------------------------------------------------------------------------

app.get("/admin/people/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const person = await getPerson(c.env.DB, id);
  if (!person) return c.html(notFoundPage(), 404);

  return c.html(
    adminPersonPage(
      person,
      await contactCountFor(c.env.DB, id),
      // Contacts are never rendered on a plain page load — only the POST that
      // asks for them, and writes down that it did, ever returns any.
      null,
      permits(c.get("roles"), requiredRolesFor("/admin/people/contact")),
      today(),
      new URL(c.req.url).searchParams.get("done") ?? undefined
    )
  );
});

app.post("/admin/people/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const body = await c.req.parseBody();
  const action = str(body.action);

  // Both destructive actions ask for a tick first, and neither happens without
  // it. A mis-click on a child's record is not a recoverable mistake.
  const confirmed = str(body.confirm) === "yes";

  if (action === "delete") {
    if (!confirmed) return c.redirect(`/admin/people/${id}`, 302);
    await deletePerson(c.env.DB, id);
    await logAdminAction(c, "person.delete", "person", id, "removed entirely, with their attendance");
    return c.redirect(`/admin/people?done=${encodeURIComponent("Removed.")}`, 302);
  }

  if (action === "anonymise") {
    if (!confirmed) return c.redirect(`/admin/people/${id}`, 302);
    await anonymisePerson(c.env.DB, id);
    await logAdminAction(c, "person.anonymise", "person", id, "name removed, attendance counts kept");
    return c.redirect(
      `/admin/people/${id}?done=${encodeURIComponent("The name has been taken off.")}`,
      302
    );
  }

  if (action === "left") {
    const on = dateParam(str(body.left_on)) ?? today();
    await markLeft(c.env.DB, id, on);
    await logAdminAction(c, "person.leave", "person", id, `marked as having left on ${on}`);
    return c.redirect(
      `/admin/people/${id}?done=${encodeURIComponent("Marked as having left.")}`,
      302
    );
  }

  if (action === "returned") {
    await markReturnedToChoir(c.env.DB, id);
    await logAdminAction(c, "person.return", "person", id, "put back on the list");
    return c.redirect(`/admin/people/${id}?done=${encodeURIComponent("Back on the list.")}`, 302);
  }

  const displayName = str(body.display_name);
  if (!displayName) return c.html(errorPage("A name is needed."), 400);
  const choir = str(body.choir);
  if (!isChoir(choir)) return c.html(errorPage("Choose which choir they sing in."), 400);
  const voicePart = str(body.voice_part);
  const gender = str(body.gender);

  await updatePerson(c.env.DB, id, {
    displayName,
    choir,
    voicePart: voicePart && isVoicePart(voicePart) ? voicePart : null,
    schoolYear: schoolYearParam(str(body.school_year)),
    joinedOn: dateParam(str(body.joined_on)),
    surpliceAwardedOn: dateParam(str(body.surplice_awarded_on)),
    deansAwardOn: dateParam(str(body.deans_award_on)),
    archbishopsAwardOn: dateParam(str(body.archbishops_award_on)),
    goldAwardOn: dateParam(str(body.gold_award_on)),
    dbsValidUntil: dateParam(str(body.dbs_valid_until)),
    gender: gender === "m" || gender === "f" ? gender : null,
  });

  // The detail says what changed about whom by id, never by name, and never
  // what the values were.
  await logAdminAction(c, "person.edit", "person", id, "details changed");
  return c.redirect(`/admin/people/${id}?done=${encodeURIComponent("Saved.")}`, 302);
});

/**
 * Parents' contact details — the hard gate.
 *
 * Reachable by music staff and by whoever is on safeguarding duty (see the
 * role table in `src/roles.ts`), and by nobody else. There is no GET: reading
 * a number is a POST, because `revealContacts` writes the audit line before it
 * fetches anything, and a bookmarkable URL that shows a child's parent's
 * telephone number is exactly what must not exist.
 */
app.post("/admin/people/contact/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const person = await getPerson(c.env.DB, id);
  if (!person) return c.html(notFoundPage(), 404);

  const body = await c.req.parseBody();
  const action = str(body.action);

  if (action === "add") {
    const phone = str(body.phone);
    if (!phone) return c.html(errorPage("A telephone number is needed."), 400);
    await addContact(c.env.DB, id, {
      label: str(body.label) || null,
      name: str(body.name) || null,
      phone,
    });
    // The number itself never reaches the audit log, only that one was added.
    await logAdminAction(c, "contact.add", "person", id, "a parent contact was added");
    return c.redirect(`/admin/people/${id}?done=${encodeURIComponent("Contact added.")}`, 302);
  }

  if (action === "delete") {
    const contactId = numericParam(str(body.contact_id));
    if (contactId === null) return c.html(notFoundPage(), 404);
    await deleteContact(c.env.DB, contactId);
    await logAdminAction(c, "contact.delete", "person", id, "a parent contact was removed");
    return c.redirect(`/admin/people/${id}?done=${encodeURIComponent("Contact removed.")}`, 302);
  }

  // The reveal. `revealContacts` audits first and reads second.
  const revealed = await revealContacts(c.env.DB, id, adminIdentity(c));
  return c.html(
    adminPersonPage(person, revealed.length, revealed, true, today())
  );
});

/**
 * The register lives under `/admin/people` and not at `/admin/register`.
 *
 * Addendum A, A2: every route that renders a child's name sits under
 * `/admin/people*` or `/admin/safeguarding*` and nowhere else, so that a
 * second and tighter Cloudflare Access application can be scoped to exactly
 * those two path prefixes without any of this having to be moved again. The
 * register was outside both and is moved here.
 */
app.get("/admin/people/register/:serviceId", async (c) => {
  const serviceId = numericParam(c.req.param("serviceId"));
  if (serviceId === null) return c.html(notFoundPage(), 404);

  const service = await getService(c.env.DB, serviceId);
  if (!service) return c.html(notFoundPage(), 404);

  const rows = await registerFor(c.env.DB, serviceId, service.designation);
  return c.html(adminRegisterPage(service, rows, registerTally(rows)));
});

/** One tap on one name. Cycles, and saves as it goes. */
app.post("/admin/people/register/:serviceId/:personId", async (c) => {
  const serviceId = numericParam(c.req.param("serviceId"));
  const personId = numericParam(c.req.param("personId"));
  if (serviceId === null || personId === null) return c.html(notFoundPage(), 404);

  const current = await c.env.DB
    .prepare(`SELECT status FROM attendance WHERE service_id = ? AND person_id = ?`)
    .bind(serviceId, personId)
    .first<{ status: string }>();

  const next = nextStatus(current?.status ?? null);
  if (next === null) await clearAttendance(c.env.DB, serviceId, personId);
  else await markAttendance(c.env.DB, serviceId, personId, next, adminIdentity(c));

  // No audit line. Attendance is personal data about a child and does not
  // belong in a log admins read looking for a mistake; the attendance row
  // carries marked_by, which is where the accountability belongs.
  return c.redirect(`/admin/people/register/${serviceId}`, 302);
});

// ---------------------------------------------------------------------------
// The repertoire picker (8A)
// ---------------------------------------------------------------------------

app.get("/admin/suggestions", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const season = params.get("season")?.trim();
  const category = params.get("category")?.trim();
  const designation = params.get("designation")?.trim();

  const filters = {
    season: season && CHURCH.seasons.some((s) => s.value === season) ? season : undefined,
    category: category && CHURCH.categories.some((x) => x.code === category) ? category : undefined,
    designation: designation || undefined,
  };

  const [results, typicalSingers] = await Promise.all([
    repertoireSuggestions(c.env.DB, filters),
    typicalSingersFor(c.env.DB, filters.designation ?? null),
  ]);

  return c.html(
    adminSuggestionsPage(results, filters, typicalSingers, (copiesUsable) => {
      const verdict = copiesRag({ copiesUsable, typicalSingers, designation: filters.designation ?? null });
      return { state: ragPill(verdict.state), label: ragLabel(verdict.state), reason: verdict.reason };
    })
  );
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

/**
 * Write one line to the audit log for the admin doing this.
 *
 * The identity comes from the Cloudflare Access header, which is only
 * trustworthy on `/admin/*` — and every caller of this is on `/admin/*`.
 */
function logAdminAction(
  c: Context<AppEnv>,
  action: string,
  entity: string | null,
  entityId: number | null,
  detail: string | null
): Promise<void> {
  return audit(c.env.DB, { userEmail: adminIdentity(c), action, entity, entityId, detail });
}

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

// ---------------------------------------------------------------------------
// The service feed
// ---------------------------------------------------------------------------

/**
 * Read the feed for this month and next, and fold it into the database.
 *
 * Shared by the hourly cron and the admin's "fetch now" button, so the button
 * exercises exactly what the schedule does rather than a second code path that
 * might drift from it.
 *
 * A month that fails is reported and the others carry on: a 502 on next month —
 * which very often does not exist yet — must not stop this month updating.
 */
async function runFeedIngest(
  env: Env,
  options: { force?: boolean; now?: Date } = {}
): Promise<{ results: IngestSummary[]; errors: { month: string; message: string }[] }> {
  const results: IngestSummary[] = [];
  const errors: { month: string; message: string }[] = [];

  for (const month of monthsToFetch(options.now ?? new Date())) {
    try {
      const payload = await fetchFeedMonth(month);
      const read = readFeedMonth(payload);
      results.push(await ingestMonth(env.DB, read, { force: options.force }));
    } catch (e) {
      errors.push({ month, message: e instanceof Error ? e.message : "The feed could not be read." });
    }
  }

  return { results, errors };
}

app.get("/admin/services", async (c) => {
  const offset = Number(new URL(c.req.url).searchParams.get("offset") ?? "0");
  const start = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const queue = await unmatchedLines(c.env.DB, 25, start);
  return c.html(adminMatchQueuePage(queue.lines, queue.total, start));
});

app.post("/admin/services/fetch", async (c) => {
  const body = await c.req.parseBody();
  const outcome = await runFeedIngest(c.env, { force: str(body.force) === "1" });
  await logAdminAction(
    c,
    "feed.fetch",
    "service",
    null,
    outcome.results.map((r) => `${r.month}: ${r.unchanged ? "unchanged" : `${r.servicesWritten} services`}`).join("; ")
  );
  return c.html(adminFeedResultPage(outcome.results, outcome.errors));
});

/** Confirm, correct or reject one music-list line. */
app.post("/admin/services/line/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const body = await c.req.parseBody();
  const action = str(body.action);

  if (action === "reject") {
    await rejectMatch(c.env.DB, id);
    await logAdminAction(c, "match.reject", "service_music", id, null);
    return c.redirect("/admin/services", 302);
  }

  const pieceId = Number(str(body.piece_id));
  if (!Number.isSafeInteger(pieceId) || pieceId <= 0) {
    return c.html(errorPage("Choose a piece to match that line to, or say it is not in the library."), 400);
  }

  try {
    await confirmMatch(c.env.DB, id, pieceId, adminIdentity(c));
  } catch (e) {
    return c.html(errorPage(e instanceof Error ? e.message : "That match could not be saved."), 400);
  }
  await logAdminAction(c, "match.confirm", "service_music", id, `matched to piece ${pieceId}`);
  return c.redirect("/admin/services", 302);
});

// ---------------------------------------------------------------------------
// Admin — feedback and crowd scans
// ---------------------------------------------------------------------------

app.get("/admin/feedback", async (c) => {
  return c.html(adminFeedbackPage(await allFeedback(c.env.DB)));
});

app.post("/admin/feedback/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);
  await resolveFeedback(c.env.DB, id, adminIdentity(c));
  await logAdminAction(c, "feedback.resolve", "feedback", id, null);
  return c.redirect("/admin/feedback", 302);
});

app.get("/admin/scans", async (c) => {
  return c.html(adminScanQueuePage(await pendingScans(c.env.DB)));
});

/**
 * Look at a pending scan before deciding on it.
 *
 * A separate route from `/file/:id` because a pending submission deliberately
 * has no `file` row — that is what "not approved" means — and this one is
 * admin-gated rather than choir-gated.
 */
app.get("/admin/scans/:id/preview", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);
  if (!c.env.SCANS) return c.html(errorPage("Scans are not available just now."), 503);

  const row = await getScanSubmission(c.env.DB, id);
  if (!row) return c.html(notFoundPage(), 404);

  const object = await c.env.SCANS.get(row.r2_key);
  if (!object) return c.html(notFoundPage(), 404);

  return new Response(object.body, {
    headers: {
      "content-type": row.content_type ?? "application/octet-stream",
      "cache-control": "private, max-age=60",
    },
  });
});

app.post("/admin/scans/:id", async (c) => {
  const id = numericParam(c.req.param("id"));
  if (id === null) return c.html(notFoundPage(), 404);

  const body = await c.req.parseBody();
  const who = adminIdentity(c);

  try {
    if (str(body.action) === "approve") {
      await approveScan(c.env.DB, id, who);
      await logAdminAction(c, "scan.approve", "scan_submission", id, null);
    } else {
      await rejectScan(c.env.DB, id, who);
      await logAdminAction(c, "scan.reject", "scan_submission", id, null);
    }
  } catch (e) {
    return c.html(errorPage(e instanceof Error ? e.message : "That could not be saved."), 400);
  }

  return c.redirect("/admin/scans", 302);
});

/** Search the catalogue from the match queue, for correcting a line by hand. */
app.get("/admin/api/match-candidates", async (c) => {
  const q = new URL(c.req.url).searchParams.get("q") ?? "";
  return c.json({ candidates: await matchCandidates(c.env.DB, q) });
});

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

/**
 * The Worker.
 *
 * `fetch` is Hono. `scheduled` is the hourly feed read (see the `[triggers]`
 * block in wrangler.toml), which is why this is an object rather than the Hono
 * app exported directly — a bare app has no `scheduled` for the cron to call.
 */
export default {
  fetch: app.fetch,

  /**
   * The hourly feed read.
   *
   * Never throws. A cron handler that throws is retried by the platform, and a
   * feed that is down stays down for the length of an outage — retrying it
   * every few minutes achieves nothing except noise in the logs. The next
   * scheduled run is in an hour and will find the feed either back or still
   * gone; either way one line in the log is the right amount of fuss.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(event.cron, env));
  },
} satisfies ExportedHandler<Env>;

/**
 * Three schedules, told apart by their cron expression.
 *
 * Dispatching on the expression rather than on the clock means each job runs
 * exactly when `wrangler.toml` says and can be triggered on its own in
 * development. An unrecognised expression falls through to the feed read,
 * which is the one that must never silently stop.
 */
async function runScheduled(cron: string, env: Env): Promise<void> {
  if (cron === CRON_BACKUP) return runNightlyBackup(env);
  if (cron === CRON_ROLLOVER) return runSeptemberRollover(env);
  return runFeedIngestJob(env);
}

/** Must match `[triggers] crons` in `wrangler.toml`. */
const CRON_FEED = "30 * * * *";
const CRON_BACKUP = "15 2 * * *";
const CRON_ROLLOVER = "0 3 1 9 *";

export const CRON_EXPRESSIONS = [CRON_FEED, CRON_BACKUP, CRON_ROLLOVER] as const;

async function runFeedIngestJob(env: Env): Promise<void> {
  try {
    const outcome = await runFeedIngest(env);
    for (const result of outcome.results) {
      if (result.unchanged) continue;
      console.log(
        `feed ${result.month}: ${result.servicesWritten} services, ${result.linesWritten} lines, ` +
          `${result.autoMatched} matched, ${result.unmatched} for review`
      );
    }
    for (const error of outcome.errors) {
      console.warn(`feed ${error.month}: ${error.message}`);
    }
  } catch (e) {
    console.error("scheduled feed read failed", e);
  }
}

/**
 * The nightly dump to R2, and the prune.
 *
 * Swallows its own failures for the same reason the feed read does: a cron
 * handler that throws is retried by the platform, and a bucket that is briefly
 * unreachable does not become reachable by being asked again in five minutes.
 *
 * Nothing about the contents is logged. The counts are the whole of it — this
 * dump contains children's names and their parents' telephone numbers, and a
 * log line quoting a row would put them somewhere with none of the protections
 * the bucket has.
 */
async function runNightlyBackup(env: Env): Promise<void> {
  if (!env.SCANS) {
    console.warn("nightly backup skipped: no R2 bucket bound");
    return;
  }
  try {
    const date = new Date().toISOString().slice(0, 10);
    const manifest = await runBackup(env.DB, env.SCANS, date, new Date().toISOString());
    const pruned = await pruneBackups(env.SCANS, date);

    const failed = manifest.tables.filter((t) => t.error);
    for (const table of failed) console.warn(`backup ${table.table}: ${table.error}`);

    console.log(
      `backup ${date}: ${manifest.totalRows} rows, ${manifest.totalBytes} bytes, ` +
        `${pruned} old objects removed${failed.length ? `, ${failed.length} tables failed` : ""}`
    );

    await audit(env.DB, {
      userEmail: "system",
      action: "backup.run",
      entity: "app_setting",
      detail:
        `${date}: ${manifest.totalRows} rows in ${manifest.tables.length} tables, ` +
        `${manifest.totalBytes} bytes, ${pruned} expired objects removed` +
        (failed.length ? `, ${failed.length} tables failed` : ""),
    });
  } catch (e) {
    console.error("nightly backup failed", e);
  }
}

/** Everybody moves up a year. Audited as the system, because nobody did it. */
async function runSeptemberRollover(env: Env): Promise<void> {
  try {
    const result = await rollOverSchoolYears(env.DB);
    console.log(`september rollover: ${result.movedUp} moved up, ${result.atTheTop} already at Year 13`);
    await audit(env.DB, {
      userEmail: "system",
      action: "person.rollover",
      entity: "person",
      detail:
        `${result.movedUp} moved up a school year` +
        (result.atTheTop
          ? `; ${result.atTheTop} already in Year 13 and left where they are`
          : ""),
    });
  } catch (e) {
    console.error("september rollover failed", e);
  }
}
