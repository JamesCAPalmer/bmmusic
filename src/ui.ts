/**
 * Server-rendered pages. Plain British English, large type, one obvious action
 * per page, no jargon.
 *
 * Pages are served by the Worker (not as static assets) so the auth gate covers
 * them, and there is no client framework and nothing loaded from a CDN — the
 * volunteer portal is used on a phone in a cold song school with one bar of
 * signal, and the whole page is a few kilobytes.
 *
 * **Everything interpolated goes through `esc`.** The catalogue's text came off
 * handwritten labels via an OCR pass and a CSV, and volunteers type free text
 * into the count form; none of it is trusted markup.
 *
 * Layout rules reference the theme's custom properties and never name a colour
 * or radius directly (see `src/theme.ts`).
 */

import { CHURCH } from "./church.config";
import { THEME_CSS } from "./theme";
import type {
  AliasRow,
  CatalogueStats,
  FileRow,
  HoldingRow,
  PerformanceRow,
  PieceDetail,
  PieceWithHolding,
  SearchQuery,
  SearchResult,
  AccessionResult,
  CountOutcome,
} from "./catalogue";
import type { ImportSummary } from "./seed";
import type { ExtractedLabel } from "./extract";
import { slotLabel, type IngestSummary, type ServiceMusicWithPiece, type ServiceRow } from "./services";
import { isMatchable, type Slot } from "./matcher";
import { copiesRag, ragLabel, ragPill, worstRag } from "./rag";
import { allBinders, type DescantResult } from "./descants";
import type { FeedbackRow, ScanSubmissionRow } from "./submissions";

// ---------------------------------------------------------------------------
// Escaping and small helpers
// ---------------------------------------------------------------------------

/** HTML-escape. Every interpolated value passes through here. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CATEGORY_LABEL = new Map(CHURCH.categories.map((c) => [c.code, c.label]));
export function categoryLabel(code: string | null): string {
  if (!code) return "Uncategorised";
  return CATEGORY_LABEL.get(code) ?? code;
}

const CONDITION_LABEL = new Map(CHURCH.conditions.map((c) => [c.value, c.label]));
function conditionLabel(value: string | null): string {
  if (!value) return "Not counted";
  return CONDITION_LABEL.get(value) ?? value;
}

/** Pill colour for a condition — urgent and poor should read as red and amber. */
function conditionPill(value: string | null): string {
  switch (value) {
    case "fine":
      return "green";
    case "average":
      return "amber";
    case "poor":
    case "urgent":
      return "red";
    default:
      return "grey";
  }
}

/** "12 copies" / "1 copy" / "not counted". */
function copiesLabel(piece: PieceWithHolding): string {
  if (piece.copies_total === null) return "Not counted yet";
  const usable = piece.copies_usable ?? 0;
  const total = piece.copies_total;
  const plural = (n: number) => (n === 1 ? "copy" : "copies");
  if (usable === total) return `${total} ${plural(total)}`;
  return `${usable} of ${total} ${plural(total)} usable`;
}

/** A date as "3 September 2026". Dates in the database are already ISO. */
export function prettyDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Review flags are stored "; "-joined; show them as separate pills. */
export function flagPills(reviewFlag: string | null): string {
  if (!reviewFlag) return "";
  return reviewFlag
    .split(";")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => `<span class="pill amber">${esc(f)}</span>`)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const STYLES = `
  :root { font-size: var(--type-root-size); }
  * { box-sizing: border-box; }
  body { font-family: var(--type-family-base); max-width: var(--type-measure);
         margin: 0 auto; padding: 1.25rem 1rem 4rem; color: var(--colour-ink);
         line-height: var(--type-line-height); background: var(--colour-canvas); }
  a { color: var(--colour-accent); }
  h1 { font-family: var(--type-family-display); font-size: var(--type-h1); margin: 0.5rem 0; font-weight: 700; }
  h2 { font-size: var(--type-h2); }
  h1 .sub { font-family: var(--type-family-base); font-size: 1rem; font-weight: 400; color: var(--colour-muted); display: block; }
  .muted { color: var(--colour-muted); }
  .small { font-size: 0.9rem; }
  .navbar { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem 1rem;
            flex-wrap: wrap; background: var(--colour-surface); border: 1px solid var(--colour-border-subtle);
            border-radius: var(--radius-xl); padding: 0.55rem 0.9rem; margin-bottom: 1.25rem;
            box-shadow: var(--shadow-card); }
  .navbar .brand { display: flex; align-items: baseline; gap: 0.5rem; text-decoration: none;
                   color: var(--colour-ink); font-weight: 700; font-size: 1.1rem;
                   font-family: var(--type-family-display); }
  .navbar .brand .where { font-family: var(--type-family-base); font-size: 0.8rem; font-weight: 400;
                          color: var(--colour-subtle); }
  .nav-actions { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; font-size: 0.92rem; }
  .nav-actions a { display: inline-flex; align-items: center; padding: 0.35rem 0.7rem;
                   border-radius: var(--radius-md); border: 1px solid var(--colour-border);
                   background: var(--colour-surface); text-decoration: none; }
  .nav-actions a:hover { background: var(--colour-accent-tint); }
  .nav-actions a.current { background: var(--colour-accent); color: var(--colour-on-accent);
                           border-color: var(--colour-accent); }
  .card { background: var(--colour-surface); border: 1px solid var(--colour-border);
          border-radius: var(--radius-xl); padding: 1.1rem 1.3rem; margin: 1rem 0; }
  .card h2:first-child, .card h3:first-child { margin-top: 0; }
  button, .btn { font-size: 1.02rem; padding: 0.65rem 1.2rem; border-radius: var(--radius-lg);
          border: 1px solid var(--colour-accent); background: var(--colour-accent);
          color: var(--colour-on-accent); cursor: pointer; text-decoration: none; display: inline-block; }
  button:hover, .btn:hover { background: var(--colour-accent-dark); }
  button.secondary, .btn.secondary { background: var(--colour-surface); color: var(--colour-accent); }
  button.secondary:hover, .btn.secondary:hover { background: var(--colour-accent-tint); }
  button.confirm { background: var(--colour-confirm); border-color: var(--colour-confirm); }
  button.confirm:hover { background: var(--colour-confirm-dark); }
  button:disabled { opacity: 0.5; cursor: default; }
  input[type=text], input[type=password], input[type=number], input[type=search], select, textarea {
          font-size: 1.02rem; padding: 0.55rem; width: 100%; border: 1px solid var(--colour-border);
          border-radius: var(--radius-md); background: var(--colour-surface); color: var(--colour-ink);
          font-family: inherit; }
  input[type=file] { font-size: 1rem; }
  label { font-weight: 600; display: block; margin-bottom: 0.3rem; }
  .field { margin-bottom: 0.9rem; }
  .field .hint { font-weight: 400; color: var(--colour-muted); font-size: 0.88rem; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0 1rem; }
  table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; font-size: 0.95rem; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--colour-border-subtle);
           vertical-align: top; }
  th { background: var(--colour-surface-alt); }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .scroll { overflow-x: auto; }
  .pill { display: inline-block; padding: 0.1rem 0.55rem; border-radius: var(--radius-pill);
          font-size: 0.78rem; font-weight: 600; margin: 0.1rem 0.15rem 0.1rem 0; }
  .pill.green { background: var(--colour-pill-green-bg); color: var(--colour-pill-green-ink); }
  .pill.amber { background: var(--colour-pill-amber-bg); color: var(--colour-pill-amber-ink); }
  .pill.red { background: var(--colour-pill-red-bg); color: var(--colour-pill-red-ink); }
  .pill.violet { background: var(--colour-pill-violet-bg); color: var(--colour-pill-violet-ink); }
  .pill.grey { background: var(--colour-surface-alt); color: var(--colour-muted); }
  .notice { border-left: 4px solid var(--colour-warning); background: var(--colour-warning-tint);
            padding: 0.85rem 1rem; border-radius: 0 var(--radius-md) var(--radius-md) 0; margin: 1rem 0; }
  .notice.error { border-color: var(--colour-danger); background: var(--colour-danger-tint); }
  .notice.ok { border-color: var(--colour-success); background: var(--colour-success-tint); }
  .notice.info { border-color: var(--colour-accent); background: var(--colour-accent-tint); }
  .notice p:first-child { margin-top: 0; } .notice p:last-child { margin-bottom: 0; }
  .hidden { display: none; }
  ul { padding-left: 1.2rem; }
  .results { list-style: none; padding: 0; margin: 0; }
  .results li { border-bottom: 1px solid var(--colour-border-subtle); padding: 0.7rem 0; }
  .results li:last-child { border-bottom: 0; }
  .results .title { font-family: var(--type-family-display); font-size: 1.08rem; font-weight: 700;
                    text-decoration: none; }
  .results .composer { color: var(--colour-muted); font-size: 0.95rem; }
  .results .meta { font-size: 0.86rem; color: var(--colour-subtle); margin-top: 0.15rem; }
  .filters { display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 0.6rem; align-items: end; }
  @media (max-width: 40rem) { .filters { grid-template-columns: 1fr; } }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.75rem; }
  .stat { background: var(--colour-surface-alt); border-radius: var(--radius-lg); padding: 0.7rem 0.9rem; }
  .stat .n { font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; display: block; }
  .stat .l { font-size: 0.85rem; color: var(--colour-muted); }
  .dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1rem; margin: 0; }
  .dl dt { color: var(--colour-muted); font-size: 0.9rem; }
  .dl dd { margin: 0; }
  .placeholder { border: 1px dashed var(--colour-border); border-radius: var(--radius-lg);
                 padding: 0.9rem 1.1rem; color: var(--colour-muted); background: var(--colour-canvas); }
  .placeholder .tag { display: inline-block; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em;
                      text-transform: uppercase; color: var(--colour-subtle); margin-bottom: 0.3rem; }
  .crumb { font-size: 0.9rem; margin-bottom: 0.35rem; }
  .pager { display: flex; justify-content: space-between; margin-top: 1rem; font-size: 0.95rem; }
  /* The volunteer portal is used one-handed on a phone: bigger targets. */
  .portal input, .portal select, .portal textarea { font-size: 1.15rem; padding: 0.75rem; }
  .portal button { font-size: 1.15rem; padding: 0.9rem 1.4rem; width: 100%; }
  .portal .choices { display: grid; gap: 0.5rem; }
  .portal .choice { display: flex; gap: 0.6rem; align-items: flex-start; border: 1px solid var(--colour-border);
                    border-radius: var(--radius-lg); padding: 0.7rem 0.85rem; background: var(--colour-surface);
                    cursor: pointer; font-weight: 400; margin: 0; }
  .portal .choice input { width: auto; margin-top: 0.25rem; flex: none; }
  .portal .choice .g { display: block; font-size: 0.88rem; color: var(--colour-muted); }
  .portal .choice strong { font-weight: 700; }
  @media print { .navbar, .no-print { display: none !important; } body { background: #fff; } }

  /* A beta chip says "this is new and may misbehave" without a paragraph of
     apology. Amber rather than red: it works, it is just not settled. */
  .beta { display: inline-block; padding: 0.05rem 0.45rem; border-radius: var(--radius-pill);
          font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
          background: var(--colour-pill-amber-bg); color: var(--colour-pill-amber-ink);
          vertical-align: middle; margin-left: 0.35rem; }

  /* The service list: a slot label, then what the list said, then what we
     matched it to. Reads down the page like an order of service. */
  .music { list-style: none; padding: 0; margin: 0; }
  .music li { display: grid; grid-template-columns: 7.5rem 1fr; gap: 0.2rem 0.9rem;
              padding: 0.6rem 0; border-bottom: 1px solid var(--colour-border-subtle); }
  .music li:last-child { border-bottom: 0; }
  .music .slot { color: var(--colour-muted); font-size: 0.85rem; text-transform: uppercase;
                 letter-spacing: 0.04em; padding-top: 0.15rem; }
  .music .said { font-size: 1.05rem; }
  .music .matched { font-size: 0.88rem; color: var(--colour-subtle); }
  @media (max-width: 34rem) {
    .music li { grid-template-columns: 1fr; }
    .music .slot { padding-top: 0; }
  }

  .service-head { display: flex; align-items: baseline; justify-content: space-between;
                  gap: 0.5rem 1rem; flex-wrap: wrap; }
  .rail { display: flex; gap: 0.6rem; overflow-x: auto; padding: 0.2rem 0 0.6rem; }
  .rail a { flex: 0 0 auto; max-width: 14rem; border: 1px solid var(--colour-border);
            border-radius: var(--radius-lg); padding: 0.6rem 0.8rem; text-decoration: none;
            background: var(--colour-surface); color: var(--colour-ink); }
  .rail a .t { font-family: var(--type-family-display); font-weight: 700; display: block; }
  .rail a .c { font-size: 0.85rem; color: var(--colour-muted); }

  /* Feedback widget — ported from bmcompanion. Floating button bottom-right,
     slide-up panel. Hidden from print and from the page's flow. */
  .fb-btn { position: fixed; right: 1rem; bottom: 1rem; z-index: 40; border-radius: var(--radius-pill);
            padding: 0.6rem 1.05rem; box-shadow: var(--shadow-raised); font-size: 0.95rem; }
  .fb-panel { position: fixed; right: 1rem; bottom: 4.2rem; z-index: 41; width: min(23rem, calc(100vw - 2rem));
              background: var(--colour-surface); border: 1px solid var(--colour-border);
              border-radius: var(--radius-xl); box-shadow: var(--shadow-raised); padding: 1rem; }
  .fb-panel h2 { margin-top: 0; font-size: 1.05rem; }
  .fb-panel .field { margin-bottom: 0.6rem; }
  .fb-panel textarea { min-height: 5rem; }
  /* The honeypot. Off-screen rather than display:none, which some bots skip. */
  .fb-hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
  @media print { .fb-btn, .fb-panel { display: none !important; } }
`;

export interface PageOptions {
  /** Which nav item to highlight. */
  nav?: "browse" | "portal" | "admin" | "home";
  /** Admin pages get the admin nav instead of the choir one. */
  admin?: boolean;
  /** Login page has no nav at all. */
  chrome?: boolean;
  /** Path the feedback widget reports as the page it was opened on. */
  path?: string;
}

/** The amber "beta" chip (Milestone 2). Used wherever a feature is new. */
export function betaChip(): string {
  return `<span class="beta" title="New — it may not be perfect yet">beta</span>`;
}

export function page(title: string, bodyHtml: string, opts: PageOptions = {}): string {
  const chrome = opts.chrome !== false;
  const navbar = chrome ? navFor(opts) : "";
  // The login page has no widget: somebody who cannot get in has nothing to
  // report but that, and there is no session to attach it to anyway.
  const feedback = chrome ? feedbackWidget(opts.path ?? "") : "";
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive, noimageindex">
  <meta name="referrer" content="same-origin">
  <title>${esc(title)}</title>
  <style>${THEME_CSS}${STYLES}</style>
</head>
<body>
${navbar}
${bodyHtml}
${feedback}
</body>
</html>`;
}

/**
 * The feedback widget, on every page, choir side and admin.
 *
 * Ported from bmcompanion: floating button, slide-up panel, the page it was
 * opened on carried in a hidden field, and a honeypot named `company` that a
 * person never sees and a bot fills in.
 *
 * No name field and no email field. This is a choir-side app used by children,
 * and collecting either would be collecting personal data to no purpose —
 * James wants to know the page is broken, not who noticed.
 */
function feedbackWidget(path: string): string {
  return `<button type="button" class="fb-btn no-print" id="fb-open">Feedback</button>
<div class="fb-panel hidden no-print" id="fb-panel" role="dialog" aria-label="Send feedback">
  <h2>Something wrong, or an idea?</h2>
  <form id="fb-form">
    <input type="hidden" name="page" value="${esc(path)}">
    <div class="fb-hp" aria-hidden="true">
      <label for="fb-company">Company</label>
      <input type="text" id="fb-company" name="company" tabindex="-1" autocomplete="off">
    </div>
    <div class="field">
      <label for="fb-category">What is it about?</label>
      <select id="fb-category" name="category">
        <option value="wrong">Something here is wrong</option>
        <option value="broken">Something does not work</option>
        <option value="missing">Something is missing</option>
        <option value="idea">An idea</option>
        <option value="other">Something else</option>
      </select>
    </div>
    <div class="field">
      <label for="fb-message">Tell us about it</label>
      <textarea id="fb-message" name="message" rows="4" required
        placeholder="As much or as little as you like."></textarea>
    </div>
    <button type="submit" id="fb-send">Send</button>
    <button type="button" class="secondary" id="fb-close">Close</button>
    <p class="muted small" id="fb-status" style="margin-bottom:0"></p>
  </form>
</div>
<script>${FEEDBACK_SCRIPT}</script>`;
}

/**
 * The widget's behaviour.
 *
 * Progressive enhancement in the sense that matters: if the script does not
 * run, the button simply is not there, and nothing else on the page depends on
 * it. Every message written with `textContent`, never innerHTML.
 */
const FEEDBACK_SCRIPT = String.raw`
(function () {
  var open = document.getElementById('fb-open');
  var panel = document.getElementById('fb-panel');
  var form = document.getElementById('fb-form');
  if (!open || !panel || !form) return;
  var statusEl = document.getElementById('fb-status');
  var send = document.getElementById('fb-send');

  function show(on) {
    panel.classList.toggle('hidden', !on);
    if (on) document.getElementById('fb-message').focus();
  }
  open.addEventListener('click', function () { show(panel.classList.contains('hidden')); });
  document.getElementById('fb-close').addEventListener('click', function () { show(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') show(false); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = new FormData(form);
    send.disabled = true;
    statusEl.textContent = 'Sending…';

    fetch('/api/feedback', { method: 'POST', body: data }).then(function (r) {
      send.disabled = false;
      if (!r.ok) { statusEl.textContent = 'That did not send. Please try again in a moment.'; return; }
      form.reset();
      statusEl.textContent = 'Thank you — that has gone to James.';
      setTimeout(function () { show(false); statusEl.textContent = ''; }, 2200);
    }).catch(function () {
      send.disabled = false;
      statusEl.textContent = 'Could not reach the server. Please try again in a moment.';
    });
  });
})();
`;

function navFor(opts: PageOptions): string {
  const item = (href: string, label: string, key: string) =>
    `<a href="${href}"${opts.nav === key ? ' class="current"' : ""}>${esc(label)}</a>`;

  if (opts.admin) {
    return `<header class="navbar no-print">
      <a href="/admin" class="brand">${esc(CHURCH.appName)} <span class="where">Librarian</span></a>
      <nav class="nav-actions">
        <a href="/admin/review">Review queue</a>
        <a href="/admin/services">Music lists</a>
        <a href="/admin/scans">Scans</a>
        <a href="/admin/feedback">Feedback</a>
        <a href="/admin/intake">Photo intake</a>
        <a href="/admin/import">Import</a>
        <a href="/">Choir view</a>
      </nav>
    </header>`;
  }
  return `<header class="navbar no-print">
    <a href="/" class="brand">${esc(CHURCH.appName)} <span class="where">${esc(CHURCH.library.location)}</span></a>
    <nav class="nav-actions">
      ${item("/", "Home", "home")}
      ${item("/music", "Browse", "browse")}
      ${item("/portal", "Count a parcel", "portal")}
      <a href="/logout">Sign out</a>
    </nav>
  </header>`;
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export function loginPage(failed = false): string {
  const error = failed
    ? `<div class="notice error">That password was not recognised. Please try again — it changes each term.</div>`
    : "";
  return page(
    `Sign in — ${CHURCH.appName}`,
    `<h1>${esc(CHURCH.appName)}<span class="sub">${esc(CHURCH.name)} — for the choir</span></h1>
     <p class="muted">A catalogue of the music in the ${esc(CHURCH.library.location.toLowerCase())}: what we have,
        how many copies, and what state they are in.</p>
     ${error}
     <div class="card">
       <form method="POST" action="/login">
         <div class="field">
           <label for="password">Choir password</label>
           <input type="password" id="password" name="password" autocomplete="current-password" autofocus required>
         </div>
         <button type="submit">Sign in</button>
       </form>
     </div>
     <p class="muted small">The password changes at the start of each term. If you have not been given
        this term's, ask ${esc(CHURCH.contact.maintainer.shortName)} or the Director of Music.</p>`,
    { chrome: false }
  );
}

// ---------------------------------------------------------------------------
// Choir — home (15A)
// ---------------------------------------------------------------------------

export interface HomeService {
  service: ServiceRow;
  music: ServiceMusicWithPiece[];
  typicalSingers: number | null;
}

/**
 * The home screen: what we are singing next, then what is coming, then what is
 * new — and search one tap away throughout.
 *
 * The order is the order a chorister actually wants it in. Somebody opening
 * this on the bus is nearly always asking "what's on tonight and have I looked
 * at the anthem?", so that goes at the top with its music list already open
 * rather than behind a link.
 */
export function homePage(
  next: HomeService | null,
  upcoming: ServiceRow[],
  recent: PieceWithHolding[]
): string {
  const nextCard = next
    ? `<div class="card">
         <div class="service-head">
           <h2 style="margin:0">${esc(next.service.title)}</h2>
           <span class="muted">${esc(prettyDate(next.service.service_date))}${
             next.service.service_time ? ` · ${esc(next.service.service_time)}` : ""
           }</span>
         </div>
         ${
           next.service.designation
             ? `<p class="muted small" style="margin:0.2rem 0 0.6rem">${esc(next.service.designation)}</p>`
             : ""
         }
         ${musicList(next.music, next.typicalSingers, next.service.designation)}
         <p style="margin-bottom:0"><a class="btn secondary" href="/service/${next.service.id}">Open this service</a></p>
       </div>`
    : `<div class="card">
         <h2>Nothing coming up yet</h2>
         <p class="muted">The music list for the next service has not reached us yet. It arrives from the
            Minster's service app and updates by itself — there is nothing for you to do.</p>
       </div>`;

  const later = upcoming.length
    ? `<div class="card">
         <h2>Later this term</h2>
         <ul class="results">
           ${upcoming
             .map(
               (s) => `<li>
                 <a class="title" href="/service/${s.id}">${esc(s.title)}</a>
                 <div class="meta">${esc(prettyDate(s.service_date))}${
                   s.service_time ? ` · ${esc(s.service_time)}` : ""
                 }${s.designation ? ` · ${esc(s.designation)}` : ""}</div>
               </li>`
             )
             .join("")}
         </ul>
       </div>`
    : "";

  const rail = recent.length
    ? `<div class="card">
         <h2>Recently added</h2>
         <div class="rail">
           ${recent
             .map(
               (p) => `<a href="/piece/${p.id}">
                 <span class="t">${esc(p.title.length > 44 ? `${p.title.slice(0, 43)}…` : p.title)}</span>
                 <span class="c">${esc(p.composer)}</span>
               </a>`
             )
             .join("")}
         </div>
       </div>`
    : "";

  return page(
    `${CHURCH.appName}`,
    `<h1>The music library<span class="sub">${esc(CHURCH.name)} — for the choir</span></h1>

     <div class="card">
       <form method="GET" action="/music">
         <div class="field" style="margin:0">
           <label for="q">Find a piece</label>
           <input type="search" id="q" name="q" placeholder="Composer, title or accession number">
         </div>
         <p class="small muted" style="margin:0.5rem 0 0">
           <a href="/music">Browse everything</a> · <a href="/descants">Find a descant</a>
         </p>
       </form>
     </div>

     <h2>Next</h2>
     ${nextCard}
     ${later}
     ${rail}`,
    { nav: "home", path: "/" }
  );
}

/**
 * One service's music list, with the copies RAG against each matched piece.
 *
 * Every line shows what the music list actually said, whether or not we matched
 * it. That is deliberate: the list is the truth about what is being sung, and a
 * line we could not find a parcel for still needs to be on the page.
 */
function musicList(
  music: ServiceMusicWithPiece[],
  typicalSingers: number | null,
  designation: string | null
): string {
  if (!music.length) return `<p class="muted">No music has been published for this service yet.</p>`;

  return `<ul class="music">
      ${music
        .map((line) => {
          const matched = line.piece_id
            ? `<a href="/piece/${line.piece_id}">${esc(line.piece_title ?? "in the library")}</a>${
                line.match_state === "auto" ? ` <span class="pill grey">not checked</span>` : ""
              }`
            : "";

          // Only matched, matchable lines get a RAG. A psalm number has no
          // copies to count, and an unmatched line has no parcel to count them
          // in — a pill on either would be a number about nothing.
          const rag =
            line.piece_id && isMatchable(line.slot as Slot)
              ? copiesRag({
                  copiesUsable: line.copies_usable,
                  typicalSingers,
                  designation,
                })
              : null;

          const ragPill_ = rag
            ? `<span class="pill ${ragPill(rag.state)}" title="${esc(rag.reason)}">${esc(ragLabel(rag.state))}</span>`
            : "";

          return `<li>
              <span class="slot">${esc(slotLabel(line.slot))}</span>
              <span>
                <span class="said">${esc(line.raw_text)}</span>
                ${matched || ragPill_ ? `<div class="matched">${matched} ${ragPill_}</div>` : ""}
              </span>
            </li>`;
        })
        .join("")}
    </ul>`;
}

/**
 * One service in full: its music, the copies RAG, and the booklet if there is
 * one.
 */
export function servicePage(
  service: ServiceRow,
  music: ServiceMusicWithPiece[],
  typicalSingers: number | null,
  booklet: { id: number; ref: string } | null,
  workingCopyMessage?: string
): string {
  const states = music
    .filter((l) => l.piece_id && isMatchable(l.slot as Slot))
    .map((l) => copiesRag({ copiesUsable: l.copies_usable, typicalSingers, designation: service.designation }).state);
  const overall = worstRag(states);

  const ragSummary =
    typicalSingers === null
      ? `<p class="muted small">We have not recorded how many singers${
          service.designation ? ` "${esc(service.designation)}"` : " this service"
        } usually means, so the copy checks below are grey rather than wrong.
        ${esc(CHURCH.contact.maintainer.shortName)} can fill that in on the librarian's side.</p>`
      : `<p class="small">Copies overall:
          <span class="pill ${ragPill(overall)}">${esc(ragLabel(overall))}</span></p>`;

  return page(
    `${service.title} — ${CHURCH.appName}`,
    `<p class="crumb"><a href="/">← Home</a></p>
     <h1>${esc(service.title)}<span class="sub">${esc(prettyDate(service.service_date))}${
       service.service_time ? ` · ${esc(service.service_time)}` : ""
     }${service.designation ? ` · ${esc(service.designation)}` : ""}</span></h1>

     <div class="card">
       ${ragSummary}
       ${musicList(music, typicalSingers, service.designation)}
     </div>

     <div class="card no-print">
       <h2>Working copy ${betaChip()}</h2>
       <p class="muted">Joins this service's reference scans into one PDF to read in a rehearsal.
          Only music that has been scanned and approved goes in, so it may not be the whole list.</p>
       ${workingCopyMessage ? `<div class="notice">${esc(workingCopyMessage)}</div>` : ""}
       <p><a class="btn secondary" href="/service/${service.id}/working-copy">Make a working copy</a></p>
       ${
         booklet
           ? `<p class="small"><a href="/booklet/${booklet.id}">Booklet ${esc(booklet.ref)}</a> is already made for this service.</p>`
           : ""
       }
     </div>`,
    { nav: "home", path: `/service/${service.id}` }
  );
}

// ---------------------------------------------------------------------------
// Choir — the descant finder (H4)
// ---------------------------------------------------------------------------

export function descantPage(query: string, result: DescantResult | null): string {
  const answer = result
    ? result.found
      ? `<div class="notice ok">
           <p style="font-size:1.25rem;margin:0">Hymn ${result.answer.hymn} —
              binder <strong>${esc(result.answer.binder)}</strong></p>
           <p class="small" style="margin-bottom:0">${esc(result.answer.note ?? "")}</p>
         </div>`
      : `<div class="notice">
           <p style="margin:0">${esc(result.miss.reason)}</p>
         </div>`
    : "";

  return page(
    `Find a descant — ${CHURCH.appName}`,
    `<p class="crumb"><a href="/">← Home</a></p>
     <h1>Find a descant<span class="sub">Which binder holds it</span></h1>
     <div class="card">
       <form method="GET" action="/descants">
         <div class="field">
           <label for="hymn">Hymn number</label>
           <input type="search" id="hymn" name="hymn" value="${esc(query)}" inputmode="numeric"
                  placeholder="e.g. 85" autofocus>
         </div>
         <button type="submit">Find it</button>
       </form>
     </div>
     ${answer}
     <div class="card">
       <h2>What is on the shelf</h2>
       <p class="muted small">The descants are not catalogued one by one — they live in these binders,
          indexed by hymn number.</p>
       <p>${allBinders().map((b) => `<span class="pill grey">${esc(b)}</span>`).join(" ")}</p>
     </div>`,
    { nav: "home", path: "/descants" }
  );
}

// ---------------------------------------------------------------------------
// Choir — browse and search
// ---------------------------------------------------------------------------

export function browsePage(
  query: SearchQuery,
  result: SearchResult,
  counts: Record<string, number>
): string {
  const categoryOptions = CHURCH.categories
    .map(
      (c) =>
        `<option value="${esc(c.code)}"${query.category === c.code ? " selected" : ""}>${esc(c.label)}${
          counts[c.code] ? ` (${counts[c.code]})` : ""
        }</option>`
    )
    .join("");

  const filters = `<form method="GET" action="/music" class="filters">
      <div class="field" style="margin:0">
        <label for="q">Search</label>
        <input type="search" id="q" name="q" value="${esc(query.q ?? "")}"
               placeholder="Composer, title or accession number">
      </div>
      <div class="field" style="margin:0">
        <label for="category">Category</label>
        <select id="category" name="category"><option value="">All</option>${categoryOptions}</select>
      </div>
      <div class="field" style="margin:0">
        <label for="voicing">Voicing</label>
        <input type="text" id="voicing" name="voicing" value="${esc(query.voicing ?? "")}" placeholder="e.g. SATB">
      </div>
      <div class="field" style="margin:0"><button type="submit">Search</button></div>
    </form>`;

  const isFiltered = Boolean(query.q || query.category || query.voicing);
  const heading = isFiltered
    ? `${result.total} ${result.total === 1 ? "result" : "results"}`
    : `${result.total} ${result.total === 1 ? "piece" : "pieces"} in the library`;

  const body = result.pieces.length
    ? `<ul class="results">${result.pieces.map(resultRow).join("")}</ul>${pager("/music", query, result)}`
    : `<p class="muted">${
        isFiltered
          ? "Nothing matched that. Try a shorter search — one word of the title, or just the composer's surname."
          : "The catalogue is empty. The draft index has not been imported yet."
      }</p>`;

  return page(
    `${CHURCH.appName}`,
    `<p class="crumb"><a href="/">← Home</a></p>
     <h1>The music library<span class="sub">${esc(CHURCH.name)} — ${esc(CHURCH.library.location)}</span></h1>
     <div class="card">${filters}</div>
     <p class="small muted"><a href="/descants">Find a descant</a> — which binder holds a hymn descant.</p>
     <h2>${esc(heading)}</h2>
     ${body}`,
    { nav: "browse", path: "/music" }
  );
}

function resultRow(p: PieceWithHolding): string {
  const bits: string[] = [categoryLabel(p.category)];
  if (p.voicing) bits.push(p.voicing);
  if (p.location) bits.push(p.location);
  bits.push(copiesLabel(p));

  const accession = p.accession
    ? `<span class="pill grey">${esc(p.accession)}</span> `
    : "";
  const condition =
    p.condition !== null ? `<span class="pill ${conditionPill(p.condition)}">${esc(conditionLabel(p.condition))}</span>` : "";
  const unreviewed = !p.reviewed_at ? `<span class="pill violet">Draft entry</span>` : "";

  return `<li>
      ${accession}<a class="title" href="/piece/${p.id}">${esc(p.title)}</a>
      <div class="composer">${esc(p.composer)}</div>
      <div class="meta">${esc(bits.join(" · "))} ${condition} ${unreviewed}</div>
    </li>`;
}

function pager(path: string, query: SearchQuery, result: SearchResult): string {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  if (result.total <= limit) return "";

  const link = (newOffset: number, label: string) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.category) params.set("category", query.category);
    if (query.voicing) params.set("voicing", query.voicing);
    if (newOffset > 0) params.set("offset", String(newOffset));
    const qs = params.toString();
    return `<a href="${path}${qs ? `?${qs}` : ""}">${esc(label)}</a>`;
  };

  const prev = offset > 0 ? link(Math.max(offset - limit, 0), "← Previous") : "<span></span>";
  const next = offset + limit < result.total ? link(offset + limit, "Next →") : "<span></span>";
  const from = offset + 1;
  const to = Math.min(offset + limit, result.total);
  return `<div class="pager">${prev}<span class="muted small">${from}–${to} of ${result.total}</span>${next}</div>`;
}

// ---------------------------------------------------------------------------
// Choir — one piece
// ---------------------------------------------------------------------------

const SEASON_LABEL = new Map(CHURCH.seasons.map((s) => [s.value, s.label]));

/** Season tags as chips, in the order they were stored (church-year order). */
function seasonChips(season: string | null): string {
  if (!season) return '<span class="muted">Not recorded</span>';
  const chips = season
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `<span class="pill violet">${esc(SEASON_LABEL.get(t) ?? t)}</span>`);
  return chips.length ? chips.join(" ") : '<span class="muted">Not recorded</span>';
}

/** Where the parcel physically is: door and shelf, falling back to free text. */
function whereItLives(piece: PieceWithHolding): string {
  if (piece.location_door) {
    const shelf = piece.location_shelf ? `, shelf ${piece.location_shelf}` : "";
    return `Door ${esc(piece.location_door)}${esc(shelf)}`;
  }
  if (piece.location) return esc(piece.location);
  return `<span class="muted">Not recorded — ${esc(CHURCH.library.location)}</span>`;
}

export function itemPage(
  detail: PieceDetail,
  sung: { service_date: string; title: string; service_id: number }[] = [],
  scanMessage?: { ok: boolean; text: string }
): string {
  const { piece, aliases, holdings, files, performances } = detail;

  const draftNotice = !piece.reviewed_at
    ? `<div class="notice">
         <p><strong>This entry has not been checked yet.</strong> It was read off a photograph of the
            parcel label, so the composer or title may be wrong. ${
              piece.review_flag ? "The specific doubts are listed below." : ""
            }</p>
         ${piece.review_flag ? `<p>${flagPills(piece.review_flag)}</p>` : ""}
       </div>`
    : "";

  // The composer written out, where we have it — the parcel label shouts a
  // surname, and "STANFORD" is not what anybody calls him.
  const composerLine = piece.composer_full && piece.composer_full !== piece.composer
    ? `${esc(piece.composer_full)}`
    : `${esc(piece.composer)}`;

  return page(
    `${piece.title} — ${CHURCH.appName}`,
    `<p class="crumb"><a href="/music">← All music</a></p>
     <h1>${esc(piece.title)}<span class="sub">${composerLine}</span></h1>
     ${draftNotice}
     <div class="card">
       <dl class="dl">
         <dt>Accession</dt><dd>${
           piece.accession ? esc(piece.accession) : '<span class="muted">Not yet assigned</span>'
         }</dd>
         <dt>Category</dt><dd>${esc(categoryLabel(piece.category))}</dd>
         <dt>Voicing</dt><dd>${piece.voicing ? esc(piece.voicing) : '<span class="muted">Not recorded</span>'}</dd>
         <dt>Season</dt><dd>${seasonChips(piece.season)}</dd>
         <dt>Where it lives</dt><dd>${whereItLives(piece)}</dd>
         ${aliases.length ? `<dt>Also known as</dt><dd>${aliases.map((a: AliasRow) => esc(a.alt_name)).join("<br>")}</dd>` : ""}
         ${piece.notes ? `<dt>Notes</dt><dd>${esc(piece.notes)}</dd>` : ""}
       </dl>
     </div>

     ${holdingsSection(holdings, piece)}
     ${filesSection(files)}
     ${scanUploadSection(piece, scanMessage)}
     ${sungAtSection(sung)}
     ${performanceSection(performances)}

     <p class="no-print"><a class="btn secondary" href="/portal/count/${piece.id}">Count this parcel</a></p>`,
    { nav: "browse", path: `/piece/${piece.id}` }
  );
}

/**
 * "Scan this with your phone" (18A, **beta**).
 *
 * A chorister photographs the copy in front of them and it lands as a *pending*
 * submission — invisible to everybody else until an admin approves it. That
 * gate is the whole feature: these are photographs of somebody's marked-up
 * working copy, and the choir side must never surface one nobody has looked at.
 */
function scanUploadSection(piece: PieceWithHolding, message?: { ok: boolean; text: string }): string {
  return `<div class="card no-print">
      <h2>Scan this with your phone ${betaChip()}</h2>
      <p class="muted">If you have a copy in front of you, photographing it helps everybody —
         one good copy of each piece is all the library needs. Lay it flat, get the whole page in,
         and take one photo per page.</p>
      ${message ? `<div class="notice ${message.ok ? "ok" : "error"}"><p style="margin:0">${esc(message.text)}</p></div>` : ""}
      <form method="POST" action="/piece/${piece.id}/scan" enctype="multipart/form-data">
        <div class="field">
          <label for="scan">Photos of the copy</label>
          <input type="file" id="scan" name="scan" accept="image/*" capture="environment" multiple required>
        </div>
        <div class="field">
          <label for="scan-label">Anything worth saying about it?</label>
          <input type="text" id="scan-label" name="submitted_label"
                 placeholder="e.g. the tenor copy, pages 1–4 only">
        </div>
        <button type="submit" class="secondary">Send these in</button>
      </form>
      <p class="muted small">Nobody else sees these until ${esc(CHURCH.contact.maintainer.shortName)}
         has looked at them.</p>
    </div>`;
}

/**
 * When we last sang it (H3), from confirmed music-list matches only.
 *
 * An 'auto' guess has no business on this list: it would be presenting the
 * matcher's opinion as the choir's history.
 */
function sungAtSection(sung: { service_date: string; title: string; service_id: number }[]): string {
  if (!sung.length) return "";
  const [latest, ...rest] = sung;
  return `<div class="card">
      <h2>When we last sang it</h2>
      <p style="font-size:1.1rem;margin:0.2rem 0">
        <a href="/service/${latest!.service_id}">${esc(prettyDate(latest!.service_date))}</a>
        <span class="muted">— ${esc(latest!.title)}</span>
      </p>
      ${
        rest.length
          ? `<details><summary class="muted small">Before that (${rest.length})</summary>
               <ul>${rest
                 .map(
                   (s) =>
                     `<li><a href="/service/${s.service_id}">${esc(prettyDate(s.service_date))}</a> — ${esc(s.title)}</li>`
                 )
                 .join("")}</ul>
             </details>`
          : ""
      }
    </div>`;
}

function holdingsSection(holdings: HoldingRow[], piece: PieceWithHolding): string {
  if (!holdings.length) {
    return `<div class="card">
        <h2>Copies</h2>
        <p class="muted">Nobody has counted this parcel yet.
           <a href="/portal/count/${piece.id}">Count it now</a> if you have it open in front of you.</p>
      </div>`;
  }

  const latest = holdings[0]!;
  const history = holdings.slice(1);

  return `<div class="card">
      <h2>Copies</h2>
      <p style="font-size:1.15rem">
        <strong>${latest.copies_usable}</strong> usable of <strong>${latest.copies_total}</strong>
        <span class="pill ${conditionPill(latest.condition)}">${esc(conditionLabel(latest.condition))}</span>
      </p>
      <p class="muted small">Counted ${esc(prettyDate(latest.last_counted))}${
        latest.counted_by ? ` by ${esc(latest.counted_by)}` : ""
      }.${latest.notes ? ` ${esc(latest.notes)}` : ""}</p>
      ${
        history.length
          ? `<details><summary class="muted small">Earlier counts (${history.length})</summary>
               <div class="scroll"><table>
                 <tr><th>Date</th><th class="num">Total</th><th class="num">Usable</th><th>Condition</th><th>Counted by</th></tr>
                 ${history
                   .map(
                     (h) => `<tr><td>${esc(prettyDate(h.last_counted))}</td>
                        <td class="num">${h.copies_total}</td><td class="num">${h.copies_usable}</td>
                        <td>${esc(conditionLabel(h.condition))}</td><td>${esc(h.counted_by ?? "")}</td></tr>`
                   )
                   .join("")}
               </table></div>
             </details>`
          : ""
      }
    </div>`;
}

function filesSection(files: FileRow[]): string {
  if (!files.length) {
    return `<div class="card">
        <h2>Reference scan</h2>
        <div class="placeholder">
          <span class="tag">Coming in Phase 1</span>
          <p style="margin:0">No scan yet. Once one copy of each parcel has been scanned, it will be readable
             here — signed in only, never a public link.</p>
        </div>
      </div>`;
  }
  return `<div class="card">
      <h2>Reference scan</h2>
      <ul>
        ${files
          .map(
            (f) =>
              `<li><a href="/file/${f.id}">${esc(f.kind === "reference_scan" ? "Reference scan" : f.kind)}</a>${
                f.pages ? ` <span class="muted small">${f.pages} pages</span>` : ""
              }</li>`
          )
          .join("")}
      </ul>
      <p class="muted small">In-page viewing arrives in Phase 1; for now the file downloads.</p>
    </div>`;
}

function performanceSection(performances: PerformanceRow[]): string {
  if (!performances.length) {
    return `<div class="card">
        <h2>When we last sang it</h2>
        <div class="placeholder">
          <span class="tag">Coming in Phase 2</span>
          <p style="margin:0">Nothing recorded yet. This will fill in from the Minster's music lists and the
             YouTube archive.</p>
        </div>
      </div>`;
  }
  return `<div class="card">
      <h2>When we last sang it</h2>
      <div class="scroll"><table>
        <tr><th>Date</th><th>Service</th><th>Source</th></tr>
        ${performances
          .map(
            (p) => `<tr><td>${esc(prettyDate(p.date))}</td><td>${esc(p.service ?? "")}</td>
              <td>${
                p.youtube_url
                  ? `<a href="${esc(p.youtube_url)}" rel="noopener noreferrer">YouTube</a>`
                  : esc(p.source === "music_list" ? "Music list" : p.source)
              }</td></tr>`
          )
          .join("")}
      </table></div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Volunteer portal
// ---------------------------------------------------------------------------

export function portalPage(searched?: { q: string; results: PieceWithHolding[] }): string {
  const results = searched
    ? searched.results.length
      ? `<h2>${searched.results.length} match${searched.results.length === 1 ? "" : "es"}</h2>
         <ul class="results">
           ${searched.results
             .map(
               (p) => `<li>
                 <a class="title" href="/portal/count/${p.id}">${esc(p.title)}</a>
                 <div class="composer">${esc(p.composer)}</div>
                 <div class="meta">${p.accession ? esc(p.accession) + " · " : ""}${esc(copiesLabel(p))}</div>
               </li>`
             )
             .join("")}
         </ul>`
      : `<div class="notice">
           <p>Nothing matched “${esc(searched.q)}”.</p>
           <p>Try just the composer's surname, or one word of the title. The labels were written by hand,
              so the spelling in here may not be the spelling on the parcel.</p>
         </div>`
    : "";

  return page(
    `Count a parcel — ${CHURCH.appName}`,
    `<div class="portal">
       <h1>Count a parcel<span class="sub">Find it first, then tell us what is in it</span></h1>
       <div class="card">
         <form method="GET" action="/portal">
           <div class="field">
             <label for="q">Accession number, composer or title</label>
             <input type="search" id="q" name="q" value="${esc(searched?.q ?? "")}"
                    placeholder="BM-0042, or Stanford, or O sing joyfully"
                    autocomplete="off" autocapitalize="none" autofocus>
             <span class="hint">The accession number is the ${esc(CHURCH.accession.prefix)} number written on the parcel,
               if it has one yet.</span>
           </div>
           <button type="submit">Find it</button>
         </form>
       </div>
       ${results}
     </div>`,
    { nav: "portal" }
  );
}

export function portalCountPage(piece: PieceWithHolding, error?: string): string {
  const conditions = CHURCH.conditions
    .map(
      (c) => `<label class="choice">
        <input type="radio" name="condition" value="${esc(c.value)}" required>
        <span><strong>${esc(c.label)}</strong><span class="g">${esc(c.guidance)}</span></span>
      </label>`
    )
    .join("");

  const previously =
    piece.copies_total !== null
      ? `<p class="muted small">Last counted ${esc(prettyDate(piece.last_counted))}:
         ${piece.copies_usable} usable of ${piece.copies_total}. If you find something different, that is
         useful — put down what you actually see.</p>`
      : `<p class="muted small">This parcel has never been counted.</p>`;

  return page(
    `Counting ${piece.title} — ${CHURCH.appName}`,
    `<div class="portal">
       <p class="crumb"><a href="/portal">← Find a different parcel</a></p>
       <h1>${esc(piece.title)}<span class="sub">${esc(piece.composer)}${
         piece.accession ? ` · ${esc(piece.accession)}` : ""
       }</span></h1>
       ${previously}
       ${error ? `<div class="notice error">${esc(error)}</div>` : ""}

       <form method="POST" action="/portal/count/${piece.id}">
         <div class="card">
           <div class="row">
             <div class="field">
               <label for="copies_total">How many copies altogether?</label>
               <input type="number" id="copies_total" name="copies_total" min="0" max="999" inputmode="numeric" required>
             </div>
             <div class="field">
               <label for="copies_usable">How many are usable?</label>
               <input type="number" id="copies_usable" name="copies_usable" min="0" max="999" inputmode="numeric" required>
               <span class="hint">Ones you would hand to a singer.</span>
             </div>
           </div>
         </div>

         <div class="card">
           <label>What state are they in?</label>
           <div class="choices">${conditions}</div>
         </div>

         <div class="card">
           <div class="field">
             <label for="voicing">Voicing printed on the copies</label>
             <input type="text" id="voicing" name="voicing" value="${esc(piece.voicing ?? "")}"
                    placeholder="SATB, SS, ATB, unison…" autocapitalize="characters">
             <span class="hint">Leave it as it is if you are not sure.</span>
           </div>
           <div class="field">
             <label for="note">Anything else worth knowing?</label>
             <textarea id="note" name="note" rows="3"
               placeholder="e.g. two parcels tied together, pages missing from three copies, damp on the wrapper"></textarea>
           </div>
           <div class="field">
             <label for="counted_by">Your name</label>
             <input type="text" id="counted_by" name="counted_by" autocomplete="name">
           </div>
         </div>

         <button type="submit" class="confirm">Save this count</button>
       </form>
     </div>`,
    { nav: "portal" }
  );
}

export function portalDonePage(piece: PieceWithHolding, outcome: CountOutcome): string {
  const flags = outcome.flags.length
    ? `<div class="notice">
         <p><strong>Flagged for ${esc(CHURCH.contact.maintainer.shortName)} to look at:</strong></p>
         <ul>${outcome.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
         <p class="small">That is not a problem — it just means somebody will check it.</p>
       </div>`
    : "";

  const repair = outcome.repairRaised
    ? `<div class="notice">A repair job has been raised for this parcel.</div>`
    : "";

  return page(
    `Counted — ${CHURCH.appName}`,
    `<div class="portal">
       <h1>Thank you<span class="sub">${esc(piece.title)} — ${esc(piece.composer)}</span></h1>
       <div class="notice ok"><p>The count is saved.</p></div>
       ${flags}
       ${repair}
       <div class="card">
         <h2>Before you wrap it back up</h2>
         <p style="font-size:1.1rem"><strong>Please set one copy aside for scanning.</strong></p>
         <p class="muted">Put it in the scanning tray rather than back in the parcel. One good copy of each
            piece is all we need, and it is much easier to do now than to find the parcel again later.</p>
       </div>
       <p><a class="btn" href="/portal">Count another parcel</a></p>
       <p><a href="/piece/${piece.id}">See this piece in the catalogue</a></p>
     </div>`,
    { nav: "portal" }
  );
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function adminReviewPage(queue: SearchResult, offset: number): string {
  if (!queue.pieces.length) {
    return page(
      `Review queue — ${CHURCH.appName}`,
      `<h1>Review queue</h1>
       <div class="notice ok"><p>Nothing left to review. Every piece has been checked by a human.</p></div>
       <p><a href="/admin">← Back to the librarian's page</a></p>`,
      { admin: true }
    );
  }

  const rows = queue.pieces.map((p) => reviewRow(p)).join("");
  const next = offset + 25 < queue.total ? `<a href="/admin/review?offset=${offset + 25}">Next 25 →</a>` : "<span></span>";
  const prev = offset > 0 ? `<a href="/admin/review?offset=${Math.max(offset - 25, 0)}">← Previous</a>` : "<span></span>";

  return page(
    `Review queue — ${CHURCH.appName}`,
    `<h1>Review queue<span class="sub">${queue.total} still to check</span></h1>
     <p class="muted">These came from the draft index and nobody has confirmed them yet. Correct anything
        wrong, then confirm. Confirming takes the row out of the importer's reach for good, so a future
        re-import cannot undo your work.</p>
     ${rows}
     <div class="pager">${prev}${next}</div>`,
    { admin: true }
  );
}

function reviewRow(p: PieceWithHolding): string {
  const categoryOptions = CHURCH.categories
    .map((c) => `<option value="${esc(c.code)}"${p.category === c.code ? " selected" : ""}>${esc(c.label)}</option>`)
    .join("");

  return `<div class="card">
      <form method="POST" action="/admin/review/${p.id}">
        <p class="muted small" style="margin-top:0">
          ${p.legacy_ref ? `Draft ref ${esc(p.legacy_ref)}` : `Piece ${p.id}`}
          ${p.notes ? ` · ${esc(p.notes)}` : ""}
        </p>
        ${p.review_flag ? `<p>${flagPills(p.review_flag)}</p>` : ""}
        <div class="row">
          <div class="field">
            <label for="composer-${p.id}">Composer</label>
            <input type="text" id="composer-${p.id}" name="composer" value="${esc(p.composer)}" required>
          </div>
          <div class="field">
            <label for="category-${p.id}">Category</label>
            <select id="category-${p.id}" name="category">${categoryOptions}</select>
          </div>
        </div>
        <div class="field">
          <label for="title-${p.id}">Title</label>
          <input type="text" id="title-${p.id}" name="title" value="${esc(p.title)}" required>
          <span class="hint">A parcel holding several pieces keeps them all here, joined with semicolons —
            each one is also kept as an alias so a music list can find it.</span>
        </div>
        <div class="row">
          <div class="field">
            <label for="voicing-${p.id}">Voicing</label>
            <input type="text" id="voicing-${p.id}" name="voicing" value="${esc(p.voicing ?? "")}">
          </div>
          <div class="field">
            <label for="season-${p.id}">Season</label>
            <input type="text" id="season-${p.id}" name="season" value="${esc(p.season ?? "")}">
          </div>
          <div class="field">
            <label for="location-${p.id}">Where it lives</label>
            <input type="text" id="location-${p.id}" name="location" value="${esc(p.location ?? "")}">
          </div>
        </div>
        <div class="field">
          <label for="merge-${p.id}">Or merge into another piece</label>
          <input type="text" id="merge-${p.id}" name="merge_into" placeholder="Accession or draft ref, e.g. D-172">
          <span class="hint">Use this when two draft rows are the same parcel. This row's title becomes an
            alias of the other, its counts and scans move across, and this row goes.</span>
        </div>
        <button type="submit" name="action" value="confirm" class="confirm">Save and confirm</button>
        <button type="submit" name="action" value="save" class="secondary">Save, still to check</button>
        <button type="submit" name="action" value="merge" class="secondary">Merge</button>
      </form>
    </div>`;
}

export function adminEditPage(detail: PieceDetail, saved = false): string {
  const { piece, aliases } = detail;
  const categoryOptions = CHURCH.categories
    .map((c) => `<option value="${esc(c.code)}"${piece.category === c.code ? " selected" : ""}>${esc(c.label)}</option>`)
    .join("");

  return page(
    `Edit ${piece.title} — ${CHURCH.appName}`,
    `<p class="crumb"><a href="/piece/${piece.id}">← Back to the piece</a></p>
     <h1>Edit<span class="sub">${esc(piece.title)} — ${esc(piece.composer)}</span></h1>
     ${saved ? `<div class="notice ok"><p>Saved.</p></div>` : ""}
     <div class="card">
       <form method="POST" action="/admin/piece/${piece.id}">
         <div class="row">
           <div class="field">
             <label for="composer">Composer</label>
             <input type="text" id="composer" name="composer" value="${esc(piece.composer)}" required>
           </div>
           <div class="field">
             <label for="category">Category</label>
             <select id="category" name="category">${categoryOptions}</select>
           </div>
         </div>
         <div class="field">
           <label for="title">Title</label>
           <input type="text" id="title" name="title" value="${esc(piece.title)}" required>
         </div>
         <div class="row">
           <div class="field">
             <label for="voicing">Voicing</label>
             <input type="text" id="voicing" name="voicing" value="${esc(piece.voicing ?? "")}">
           </div>
           <div class="field">
             <label for="season">Season</label>
             <input type="text" id="season" name="season" value="${esc(piece.season ?? "")}">
           </div>
           <div class="field">
             <label for="location">Where it lives</label>
             <input type="text" id="location" name="location" value="${esc(piece.location ?? "")}">
           </div>
         </div>
         <div class="field">
           <label for="notes">Notes</label>
           <textarea id="notes" name="notes" rows="3">${esc(piece.notes ?? "")}</textarea>
         </div>
         <div class="field">
           <label for="review_flag">Review flags</label>
           <input type="text" id="review_flag" name="review_flag" value="${esc(piece.review_flag ?? "")}">
           <span class="hint">Semicolon-separated reasons somebody should look. Empty means settled.</span>
         </div>
         <div class="field">
           <label for="new_alias">Add an alias</label>
           <input type="text" id="new_alias" name="new_alias" placeholder="Another name a music list might use">
         </div>
         <button type="submit">Save</button>
       </form>
     </div>

     <div class="card">
       <h2>Aliases</h2>
       ${
         aliases.length
           ? `<ul>${aliases.map((a) => `<li>${esc(a.alt_name)} <span class="muted small">${esc(a.source)}</span></li>`).join("")}</ul>`
           : `<p class="muted">None.</p>`
       }
     </div>

     <p class="muted small">Accession: ${
       piece.accession ? esc(piece.accession) : "not yet assigned"
     } · Draft ref: ${piece.legacy_ref ? esc(piece.legacy_ref) : "none"} · ${
       piece.reviewed_at
         ? `Confirmed ${esc(prettyDate(piece.reviewed_at))}${piece.reviewed_by ? ` by ${esc(piece.reviewed_by)}` : ""}`
         : "Not yet confirmed"
     }</p>`,
    { admin: true }
  );
}

export function adminImportPage(summary: ImportSummary | null, error?: string): string {
  const result = summary
    ? `<div class="notice ok">
         <p><strong>Imported.</strong></p>
         <ul>
           <li>${summary.inserted} new ${summary.inserted === 1 ? "piece" : "pieces"}</li>
           <li>${summary.updated} draft ${summary.updated === 1 ? "row" : "rows"} refreshed</li>
           <li>${summary.unchanged} unchanged</li>
           <li>${summary.skippedReviewed} already confirmed by a human and left alone</li>
           <li>${summary.aliasesWritten} aliases written from multi-title parcels</li>
         </ul>
         <p class="small">${summary.total} rows read in total.</p>
       </div>
       ${
         summary.rejected.length
           ? `<div class="notice">
                <p><strong>${summary.rejected.length} ${
                  summary.rejected.length === 1 ? "row was" : "rows were"
                } not imported:</strong></p>
                <ul>${summary.rejected.map((r) => `<li>${esc(r.ref)} — ${esc(r.reason)}</li>`).join("")}</ul>
              </div>`
           : ""
       }`
    : "";

  return page(
    `Import the draft index — ${CHURCH.appName}`,
    `<h1>Import the draft index</h1>
     ${error ? `<div class="notice error">${esc(error)}</div>` : ""}
     ${result}
     <div class="card">
       <p>This reads <code>data/seed/bm-music-draft-index.csv</code> as committed in the repository and
          imports it into the catalogue.</p>
       <p><strong>It is safe to run more than once.</strong> Rows are matched on their draft ref
          (<code>D-001</code>), so re-running never duplicates anything. A row nobody has reviewed is
          refreshed from the file; a row somebody has confirmed is left completely alone.</p>
       <form method="POST" action="/admin/import">
         <button type="submit">Import now</button>
       </form>
     </div>
     <p class="muted small">To load a better cut of the index, replace the CSV in the repository, deploy,
        and run this again.</p>`,
    { admin: true }
  );
}

export function adminAccessionPage(result: AccessionResult): string {
  return page(
    `Accession numbers — ${CHURCH.appName}`,
    `<h1>Accession numbers</h1>
     ${
       result.assigned
         ? `<div class="notice ok">
              <p><strong>${result.assigned} assigned</strong>, ${esc(result.from ?? "")} to ${esc(result.to ?? "")}.</p>
            </div>`
         : `<div class="notice">
              <p>Nothing to assign. Every reviewed piece already has a number.</p>
              ${
                result.remaining
                  ? `<p class="small">${result.remaining} ${
                      result.remaining === 1 ? "piece is" : "pieces are"
                    } still unnumbered because they have not been reviewed yet.</p>`
                  : ""
              }
            </div>`
     }
     <p><a class="btn secondary" href="/admin">← Back to the librarian's page</a></p>`,
    { admin: true }
  );
}

// --- Photo intake -----------------------------------------------------------

export function adminIntakePage(extractionReady: boolean): string {
  const upload = extractionReady
    ? `<div class="card">
         <h2>1. Photograph the label</h2>
         <form id="upload-form">
           <div class="field">
             <label for="photo">Photo of the parcel label</label>
             <input type="file" id="photo" name="photo" accept="image/*,.pdf" capture="environment" required>
             <span class="hint">A straight-on photo in good light reads best. One label at a time.</span>
           </div>
           <button type="submit" id="go">Read the label</button>
         </form>
         <p id="status" class="muted hidden"></p>
       </div>`
    : `<div class="notice">
         <p><strong>Reading labels automatically is switched off.</strong> No <code>ANTHROPIC_API_KEY</code> is
            set for this Worker, so there is nothing to read the photograph with.</p>
         <p>Everything still works — fill the form in by hand below. Set the key in the Cloudflare dashboard
            to turn label reading on; nothing else needs to change.</p>
       </div>`;

  return page(
    `Photo intake — ${CHURCH.appName}`,
    `<h1>Photo intake<span class="sub">Photograph a label, check what it reads, then add it</span></h1>
     ${upload}
     <div class="card" id="review-card">
       <h2>${extractionReady ? "2. Check it, then add it" : "Add a piece"}</h2>
       <p class="muted" id="review-blurb">${
         extractionReady
           ? "Nothing read yet. Take a photo above, or fill this in by hand."
           : "Fill this in from the label in front of you."
       }</p>
       <div id="concerns"></div>
       ${manualForm()}
     </div>
     ${extractionReady ? `<script>${INTAKE_SCRIPT}</script>` : ""}`,
    { admin: true }
  );
}

/** The form the extraction fills in, and the one a human uses when it cannot. */
export function manualForm(): string {
  const categoryOptions = CHURCH.categories
    .map((c) => `<option value="${esc(c.code)}">${esc(c.label)}</option>`)
    .join("");

  return `<form method="POST" action="/admin/intake" id="confirm-form">
      <div class="row">
        <div class="field">
          <label for="i-composer">Composer</label>
          <input type="text" id="i-composer" name="composer" required>
          <span class="hint" id="h-composer"></span>
        </div>
        <div class="field">
          <label for="i-category">Category</label>
          <select id="i-category" name="category">${categoryOptions}</select>
          <span class="hint" id="h-category"></span>
        </div>
      </div>
      <div class="field">
        <label for="i-title">Title</label>
        <input type="text" id="i-title" name="title" required>
        <span class="hint" id="h-title">Several pieces in one parcel: join them with semicolons. Each becomes an alias.</span>
      </div>
      <div class="row">
        <div class="field">
          <label for="i-voicing">Voicing</label>
          <input type="text" id="i-voicing" name="voicing">
        </div>
        <div class="field">
          <label for="i-season">Season</label>
          <input type="text" id="i-season" name="season">
        </div>
        <div class="field">
          <label for="i-location">Where it lives</label>
          <input type="text" id="i-location" name="location">
        </div>
      </div>
      <div class="field">
        <label for="i-notes">Notes</label>
        <textarea id="i-notes" name="notes" rows="2"></textarea>
      </div>
      <div class="field">
        <label for="i-flags">Review flags</label>
        <input type="text" id="i-flags" name="review_flag">
        <span class="hint">Anything left doubtful. Leave empty and it is added as settled.</span>
      </div>
      <button type="submit" class="confirm">Add this piece</button>
    </form>`;
}

/**
 * Fills the review form in from the extraction.
 *
 * Every value is written with `value =` or `textContent`, never innerHTML: the
 * text has been read off a photograph by a model and is not trusted markup.
 */
export const INTAKE_SCRIPT = String.raw`
(function () {
  var form = document.getElementById('upload-form');
  if (!form) return;
  var statusEl = document.getElementById('status');
  var goBtn = document.getElementById('go');
  var LOW = 0.8;

  function setHint(id, field, label) {
    var el = document.getElementById(id);
    if (!el) return;
    if (!field || field.value === null) { el.textContent = label + ' was not on the label.'; el.style.color = ''; return; }
    var pct = Math.round((field.confidence || 0) * 100);
    var text = 'Read as "' + (field.verbatim || field.value) + '" — ' + pct + '% sure.';
    el.textContent = text;
    el.style.color = (field.confidence || 0) < LOW ? 'var(--colour-danger)' : 'var(--colour-muted)';
  }

  function fill(d) {
    document.getElementById('i-composer').value = (d.composer && d.composer.value) || '';
    document.getElementById('i-title').value = (d.titles || []).map(function (t) { return t.value; }).join('; ');
    if (d.category && d.category.value) document.getElementById('i-category').value = d.category.value;
    document.getElementById('i-voicing').value = (d.voicing && d.voicing.value) || '';
    document.getElementById('i-season').value = (d.season && d.season.value) || '';
    document.getElementById('i-location').value = (d.location && d.location.value) || '';
    document.getElementById('i-notes').value = d.otherText || '';

    setHint('h-composer', d.composer, 'The composer');
    setHint('h-category', d.category, 'A category');

    // Anything read at low confidence starts life as a review flag, so a shaky
    // reading cannot be confirmed into the catalogue by pressing the button.
    var flags = (d.concerns || []).slice();
    var lowFields = [];
    [['composer', d.composer], ['category', d.category], ['voicing', d.voicing]].forEach(function (pair) {
      if (pair[1] && pair[1].value !== null && (pair[1].confidence || 0) < LOW) lowFields.push(pair[0]);
    });
    (d.titles || []).forEach(function (t) { if ((t.confidence || 0) < LOW) lowFields.push('title "' + t.value + '"'); });
    if (lowFields.length) flags.push('read with low confidence: ' + lowFields.join(', '));
    document.getElementById('i-flags').value = flags.join('; ');

    var box = document.getElementById('concerns');
    while (box.firstChild) box.removeChild(box.firstChild);
    if ((d.concerns || []).length) {
      var note = document.createElement('div'); note.className = 'notice';
      var p = document.createElement('p'); p.style.marginTop = '0';
      p.appendChild(document.createTextNode('Worth a look before you add it:'));
      note.appendChild(p);
      var ul = document.createElement('ul');
      d.concerns.forEach(function (c) { var li = document.createElement('li'); li.textContent = c; ul.appendChild(li); });
      note.appendChild(ul); box.appendChild(note);
    }
    document.getElementById('review-blurb').textContent =
      'Read from the photo. Check every field against the label — especially anything marked in red — then add it.';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('photo');
    if (!input.files.length) return;
    var data = new FormData(); data.append('photo', input.files[0]);
    goBtn.disabled = true;
    statusEl.classList.remove('hidden'); statusEl.className = 'muted';
    statusEl.textContent = 'Reading the label… this takes a few seconds.';

    fetch('/admin/api/read-label', { method: 'POST', body: data }).then(function (r) {
      return r.json().then(function (b) { return { ok: r.ok, body: b }; });
    }).then(function (res) {
      goBtn.disabled = false;
      if (!res.ok) {
        statusEl.className = 'notice error';
        statusEl.textContent = (res.body && res.body.error) || 'The label could not be read. Enter it by hand below.';
        return;
      }
      statusEl.classList.add('hidden');
      fill(res.body.label);
    }).catch(function () {
      goBtn.disabled = false;
      statusEl.className = 'notice error';
      statusEl.textContent = 'Could not reach the server. Enter the details by hand below.';
    });
  });
})();
`;

export function adminIntakeDonePage(pieceId: number, title: string): string {
  return page(
    `Added — ${CHURCH.appName}`,
    `<h1>Added<span class="sub">${esc(title)}</span></h1>
     <div class="notice ok"><p>The piece is in the catalogue.</p></div>
     <p><a class="btn" href="/admin/intake">Add another</a></p>
     <p><a href="/piece/${pieceId}">See it in the catalogue</a> ·
        <a href="/admin/piece/${pieceId}">Edit it</a></p>`,
    { admin: true }
  );
}

// --- The service feed and its match queue -----------------------------------

/**
 * The match queue: music-list lines waiting for a human to say what they are.
 *
 * Ordered with the matcher's own proposals first, because confirming a correct
 * guess is one tap and clearing the easy ones makes the hard ones visible.
 * Each row offers the proposal, a search box for correcting it, and a way to
 * say the piece is simply not in the library — which is a real answer, not a
 * failure to answer.
 */
export function adminMatchQueuePage(
  lines: (ServiceMusicWithPiece & { service_date: string; service_title: string })[],
  total: number,
  offset: number
): string {
  if (!lines.length) {
    return page(
      `Music lists — ${CHURCH.appName}`,
      `<h1>Music lists</h1>
       <div class="notice ok"><p>Every line of every service has been matched or accounted for.</p></div>
       ${feedFetchCard()}
       <p><a href="/admin">← Back to the librarian's page</a></p>`,
      { admin: true }
    );
  }

  const next = offset + 25 < total ? `<a href="/admin/services?offset=${offset + 25}">Next 25 →</a>` : "<span></span>";
  const prev = offset > 0 ? `<a href="/admin/services?offset=${Math.max(offset - 25, 0)}">← Previous</a>` : "<span></span>";

  return page(
    `Music lists — ${CHURCH.appName}`,
    `<h1>Music lists<span class="sub">${total} ${total === 1 ? "line" : "lines"} to check</span></h1>
     <p class="muted">These come from the Minster's music list, read through the
        ${esc(CHURCH.shortName)}'s service app. Where the matcher has proposed a piece, confirming it
        takes one tap — and teaches it that phrasing for good, so the same line never comes back.</p>
     ${feedFetchCard()}
     ${lines.map(matchRow).join("")}
     <div class="pager">${prev}${next}</div>`,
    { admin: true }
  );
}

function feedFetchCard(): string {
  return `<div class="card no-print">
      <h2>Read the music list now</h2>
      <p class="muted small">This happens by itself every hour. Use this when the list has just been
         corrected and you would rather not wait.</p>
      <form method="POST" action="/admin/services/fetch">
        <button type="submit" class="secondary">Read it now</button>
        <label class="small muted" style="font-weight:400;display:inline-block;margin-left:0.6rem">
          <input type="checkbox" name="force" value="1" style="width:auto"> even if nothing has changed
        </label>
      </form>
    </div>`;
}

function matchRow(
  line: ServiceMusicWithPiece & { service_date: string; service_title: string }
): string {
  const proposal =
    line.piece_id && line.match_state === "auto"
      ? `<div class="notice info">
           <p style="margin:0">Proposed: <strong>${esc(line.piece_title)}</strong> —
              ${esc(line.piece_composer)}${line.piece_accession ? ` <span class="pill grey">${esc(line.piece_accession)}</span>` : ""}</p>
         </div>`
      : `<p class="muted small">Nothing in the library obviously matches this.</p>`;

  return `<div class="card">
      <p class="muted small" style="margin-top:0">
        ${esc(prettyDate(line.service_date))} · ${esc(line.service_title)} · ${esc(slotLabel(line.slot))}
      </p>
      <p style="font-size:1.1rem;margin:0.2rem 0"><strong>${esc(line.raw_text)}</strong></p>
      ${proposal}
      <form method="POST" action="/admin/services/line/${line.id}">
        ${
          line.piece_id && line.match_state === "auto"
            ? `<button type="submit" name="piece_id" value="${line.piece_id}" class="confirm">That's right</button> `
            : ""
        }
        <div class="field" style="margin-top:0.6rem">
          <label for="piece-${line.id}">Or match it to a different piece</label>
          <input type="number" id="piece-${line.id}" name="piece_id" min="1"
                 placeholder="Piece number — search below to find it">
          <span class="hint">
            <a href="/?q=${encodeURIComponent(line.raw_text)}" target="_blank" rel="noopener">
              Search the catalogue for “${esc(line.raw_text)}”</a> and use the number from the piece's address.
          </span>
        </div>
        <button type="submit" class="secondary">Save that match</button>
        <button type="submit" name="action" value="reject" class="secondary">Not in the library</button>
      </form>
    </div>`;
}

export function adminFeedResultPage(
  results: IngestSummary[],
  errors: { month: string; message: string }[]
): string {
  const rows = results
    .map((r) => {
      if (r.unchanged) {
        return `<li><strong>${esc(r.month)}</strong> — unchanged since the last read, so nothing was written.</li>`;
      }
      return `<li><strong>${esc(r.month)}</strong> — ${r.servicesWritten} ${
        r.servicesWritten === 1 ? "service" : "services"
      }, ${r.linesWritten} ${r.linesWritten === 1 ? "line" : "lines"};
        ${r.autoMatched} matched, ${r.unmatched} for you to check.
        ${
          r.skipped.length
            ? `<br><span class="muted small">${r.skipped.length} entr${
                r.skipped.length === 1 ? "y was" : "ies were"
              } skipped: ${esc(r.skipped.map((s) => `${s.at} (${s.reason})`).join("; "))}</span>`
            : ""
        }</li>`;
    })
    .join("");

  return page(
    `Music list read — ${CHURCH.appName}`,
    `<h1>Music list read</h1>
     ${results.length ? `<div class="notice ok"><ul style="margin:0">${rows}</ul></div>` : ""}
     ${
       errors.length
         ? `<div class="notice">
              <p><strong>Some months could not be read:</strong></p>
              <ul>${errors.map((e) => `<li>${esc(e.month)} — ${esc(e.message)}</li>`).join("")}</ul>
              <p class="small">Next month's list often does not exist yet, which is not a problem.</p>
            </div>`
         : ""
     }
     <p><a class="btn" href="/admin/services">Check the music lists</a></p>
     <p><a href="/admin">← Back to the librarian's page</a></p>`,
    { admin: true }
  );
}

// --- Feedback and crowd scans ------------------------------------------------

export function adminFeedbackPage(items: FeedbackRow[]): string {
  const open = items.filter((f) => !f.resolved_at);
  const done = items.filter((f) => f.resolved_at);

  const row = (f: FeedbackRow) => `<div class="card">
      <p class="muted small" style="margin-top:0">
        ${esc(prettyDate(f.at))}${f.page ? ` · ${esc(f.page)}` : ""}${f.category ? ` · ${esc(f.category)}` : ""}
      </p>
      <p style="white-space:pre-wrap;margin:0.3rem 0">${esc(f.message)}</p>
      ${
        f.resolved_at
          ? `<p class="muted small" style="margin-bottom:0">Dealt with ${esc(prettyDate(f.resolved_at))}${
              f.resolved_by ? ` by ${esc(f.resolved_by)}` : ""
            }.</p>`
          : `<form method="POST" action="/admin/feedback/${f.id}">
               <button type="submit" class="secondary">Mark as dealt with</button>
             </form>`
      }
      ${f.ua ? `<details><summary class="muted small">Browser</summary><p class="small muted">${esc(f.ua)}</p></details>` : ""}
    </div>`;

  return page(
    `Feedback — ${CHURCH.appName}`,
    `<h1>Feedback<span class="sub">${open.length} to look at</span></h1>
     ${
       items.length
         ? `${open.map(row).join("")}
            ${done.length ? `<h2>Already dealt with</h2>${done.map(row).join("")}` : ""}`
         : `<div class="notice ok"><p>Nothing has been sent in yet.</p></div>`
     }
     <p><a href="/admin">← Back to the librarian's page</a></p>`,
    { admin: true, path: "/admin/feedback" }
  );
}

/**
 * The crowd-scan approval queue.
 *
 * Nothing here is visible to the choir. Approving writes a `file` row, which is
 * the moment it becomes readable — so this screen is the gate, and it shows the
 * photograph rather than making somebody approve a filename.
 */
export function adminScanQueuePage(items: ScanSubmissionRow[]): string {
  if (!items.length) {
    return page(
      `Scans sent in — ${CHURCH.appName}`,
      `<h1>Scans sent in</h1>
       <div class="notice ok"><p>Nothing waiting. Everything sent in has been looked at.</p></div>
       <p><a href="/admin">← Back to the librarian's page</a></p>`,
      { admin: true, path: "/admin/scans" }
    );
  }

  return page(
    `Scans sent in — ${CHURCH.appName}`,
    `<h1>Scans sent in<span class="sub">${items.length} waiting ${betaChip()}</span></h1>
     <p class="muted">Choristers photographed these on their phones. Nothing here is visible to anybody
        else until you approve it — approving is what turns it into a reference scan.</p>
     ${items
       .map(
         (s) => `<div class="card">
           <p class="muted small" style="margin-top:0">${esc(prettyDate(s.at))}${
             s.submitted_label ? ` · “${esc(s.submitted_label)}”` : ""
           }</p>
           <p style="margin:0.2rem 0"><a href="/piece/${s.piece_id}"><strong>${esc(s.piece_title)}</strong></a>
              — ${esc(s.piece_composer)}</p>
           <p><a href="/admin/scans/${s.id}/preview" target="_blank" rel="noopener">Look at this photo</a></p>
           <form method="POST" action="/admin/scans/${s.id}">
             <button type="submit" name="action" value="approve" class="confirm">Approve</button>
             <button type="submit" name="action" value="reject" class="secondary">Reject</button>
           </form>
         </div>`
       )
       .join("")}`,
    { admin: true, path: "/admin/scans" }
  );
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function notFoundPage(): string {
  return page(
    `Not found — ${CHURCH.appName}`,
    `<h1>Not found</h1>
     <p class="muted">That page or piece does not exist. It may have been merged into another entry.</p>
     <p><a class="btn" href="/">Back to the music</a></p>`
  );
}

export function errorPage(message: string): string {
  return page(
    `Something went wrong — ${CHURCH.appName}`,
    `<h1>Something went wrong</h1>
     <div class="notice error"><p>${esc(message)}</p></div>
     <p><a class="btn" href="/">Back to the music</a></p>`
  );
}
