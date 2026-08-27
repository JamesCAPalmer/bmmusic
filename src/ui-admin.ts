/**
 * The librarian's screens, Build 2.
 *
 * Split out of `src/ui.ts` because the admin side has grown past the point
 * where one file is navigable. The shell (`page`, `esc`, the stylesheet) still
 * lives there and is imported here, so both sides render identically and there
 * is exactly one place a layout rule can be changed.
 *
 * Same rules as the choir side: everything interpolated goes through `esc`,
 * server-rendered, no framework, plain British English.
 */

import { CHURCH } from "./church.config";
import { betaChip, categoryLabel, esc, flagPills, page, prettyDate } from "./ui";
import type { CatalogueStats, ChoirProfileRow, PieceWithHolding, SearchQuery, SearchResult } from "./catalogue";
import type { AuditRow } from "./audit";
import {
  CHOIRS,
  SCHOOL_YEARS,
  schoolYearLabel,
  type ParentContact,
  type PersonRow,
  type RegisterRow,
} from "./people";
import { MODULES, moduleForPath, type ModuleState } from "./modules";
import { DUTY_ROLES, EVENT_TYPES, type DutyCoverage, type DutyRow } from "./duty";
import type { BatchRow, ProposedPerson } from "./importer";
import {
  pounds,
  RATE_ROLES,
  type PayRun,
  type PersonTotals,
  type Quarter,
  type RateRow,
} from "./pay";
import {
  permits,
  requiredRolesFor,
  ROLES,
  ROLE_BLURBS,
  ROLE_LABELS,
  type Role,
  type RoleGrant,
} from "./roles";
import {
  explainChoirSize,
  singersFor,
  ADULT_TOTAL,
  FULL_CHOIR_TOTAL,
  TEAM_A_TOTAL,
  TEAM_B_TOTAL,
} from "./choirsize";
import type {
  ConditionCount,
  Coverage,
  LoanRow,
  PriorityPiece,
  RecountRow,
  SeasonReadiness,
  SungCount,
} from "./reports";

// ---------------------------------------------------------------------------
// Admin home — six tiles and the queues (5A)
// ---------------------------------------------------------------------------

export interface AdminQueueCounts {
  toReview: number;
  musicLines: number;
  pendingScans: number;
  openFeedback: number;
  openRepairs: number;
  dueRecount: number;
}

/**
 * The librarian's front page.
 *
 * Tiles for the things James goes looking for, and above them the queues — the
 * things waiting on him. Queues first because a number waiting is more urgent
 * than a door to walk through, and a tile with nothing behind it should not
 * look the same as one with forty items in it.
 *
 * **Every tile is filtered twice**, by the same two rules the gate applies to
 * the address behind it: the module has to be on, and the reader has to hold a
 * role that may reach it. A tile the reader could not walk through is not
 * drawn — an off module is dark rather than locked, and offering a librarian a
 * door to the register that answers "not for you" is a worse page than not
 * offering it. `visible()` asks `src/modules.ts` and `src/roles.ts` rather than
 * repeating their tables, so a rule changed there changes here too.
 */
export function adminHomePage(
  stats: CatalogueStats,
  queues: AdminQueueCounts,
  extractionReady: boolean,
  modules: ModuleState,
  roles: readonly Role[]
): string {
  const unreviewed = stats.pieces - stats.reviewed;

  /** Would the gate let this reader through to this address? */
  const visible = (href: string): boolean => {
    const module = moduleForPath(href);
    if (module && !modules[module]) return false;
    return permits(roles, requiredRolesFor(href));
  };

  const stat = (n: number | string, label: string) =>
    `<div class="stat"><span class="n">${esc(n)}</span><span class="l">${esc(label)}</span></div>`;

  const queue = (href: string, n: number, label: string, blurb: string) =>
    visible(href)
      ? `<a class="tile${n ? " has-work" : ""}" href="${href}">
           <span class="n">${n}</span>
           <span class="t">${esc(label)}</span>
           <span class="b">${esc(blurb)}</span>
         </a>`
      : "";

  const tile = (href: string, label: string, blurb: string, chip = "") =>
    visible(href)
      ? `<a class="tile" href="${href}">
           <span class="t">${esc(label)}${chip}</span>
           <span class="b">${esc(blurb)}</span>
         </a>`
      : "";

  /** A heading with nothing under it is worse than no heading. */
  const section = (heading: string, tiles: string[]): string => {
    const drawn = tiles.filter(Boolean);
    if (!drawn.length) return "";
    return `<h2>${esc(heading)}</h2><div class="tiles">${drawn.join("")}</div>`;
  };

  return page(
    `Librarian — ${CHURCH.appName}`,
    `<h1>Librarian<span class="sub">${esc(CHURCH.name)} music library</span></h1>

     ${section("Waiting for you", [
       queue("/admin/review", queues.toReview, "Draft entries", "read off label photographs, unchecked"),
       queue("/admin/services", queues.musicLines, "Music list lines", "matched or waiting to be matched"),
       queue("/admin/scans", queues.pendingScans, "Scans sent in", "photographed by choristers"),
       queue("/admin/feedback", queues.openFeedback, "Feedback", "sent from the widget"),
       queue("/admin/queues", queues.openRepairs, "Repairs", "poor, urgent, or no usable spine"),
       queue("/admin/stocktake", queues.dueRecount, "Due a recount", "five years old, or sung a lot since"),
     ])}

     ${section("The library", [
       tile("/admin/new", "New catalogue item", "parse a scan, or enter it by hand"),
       tile("/admin/search", "Search and bulk edit", "filter, select, change many at once"),
       tile("/admin/reports", "Reports", "what gets sung, condition, coverage"),
       tile("/admin/queues", "What to do next", "scanning and repair, in priority order"),
       tile("/admin/labels", "Print labels", "volunteer sheets, and reprints"),
       tile("/admin/suggestions", "Choosing music", "by season, with copies and scans"),
       tile("/admin/loans", "Out on loan", "who has what, and since when"),
     ])}

     ${section("The choir", [
       tile("/admin/people", "The choir", "people and the register", betaChip()),
       tile("/admin/people/import", "Import a workbook", "read the department's register", betaChip()),
       tile("/admin/people/attendance", "Attendance", "who sang, by month and quarter", betaChip()),
       tile("/admin/people/pay", "Pay", "a quarter's figures, and the rates", betaChip()),
       tile("/admin/safeguarding", "Duty rota", "robing, general and dismissal", betaChip()),
     ])}

     ${section("This app", [
       tile("/admin/settings", "Settings", "choir password, choir sizes, activity"),
       tile("/admin/export", "Exports", "take the data out as a spreadsheet", betaChip()),
       tile("/admin/modules", "Modules", "what this app does at all", betaChip()),
       tile("/admin/roles", "Roles", "who may do what in here", betaChip()),
     ])}

     <div class="card">
       <h2>Where things stand</h2>
       <div class="stat-grid">
         ${stat(stats.pieces, "pieces catalogued")}
         ${stat(unreviewed, "still to review")}
         ${stat(stats.withAccession, "with an accession number")}
         ${stat(stats.counted, "parcels counted")}
         ${stat(stats.copiesUsable, "usable copies counted")}
         ${stat(stats.openRepairs, "repairs outstanding")}
       </div>
     </div>

     <div class="card">
       <h2>Accession numbers</h2>
       <p>Assign ${esc(CHURCH.accession.prefix)} numbers to every reviewed piece that has none, in catalogue
          order (composer, then title). Numbering continues from the highest already assigned and never
          renumbers an existing one.</p>
       <form method="POST" action="/admin/accessions">
         <button type="submit" ${stats.reviewed === stats.withAccession ? "disabled" : ""}>
           Assign the next numbers
         </button>
       </form>
     </div>

     ${
       extractionReady
         ? ""
         : `<div class="notice">
              <p><strong>Reading labels automatically is switched off.</strong> No
                 <code>ANTHROPIC_API_KEY</code> is set, so "New catalogue item" takes details by hand.
                 Everything else works exactly as it does with the key set.</p>
            </div>`
     }

     <style>
       .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0.7rem;
                margin: 0.6rem 0 1.4rem; }
       .tile { display: block; padding: 0.85rem 1rem; border: 1px solid var(--colour-border);
               border-radius: var(--radius-xl); background: var(--colour-surface); text-decoration: none;
               color: var(--colour-ink); }
       .tile:hover { background: var(--colour-accent-tint); border-color: var(--colour-accent); }
       .tile .n { display: block; font-size: 1.8rem; font-weight: 700; font-variant-numeric: tabular-nums;
                  line-height: 1.1; color: var(--colour-subtle); }
       .tile.has-work .n { color: var(--colour-accent); }
       .tile .t { display: block; font-weight: 700; font-family: var(--type-family-display); }
       .tile .b { display: block; font-size: 0.85rem; color: var(--colour-muted); }
     </style>`,
    { admin: true, nav: "admin", path: "/admin" }
  );
}

// ---------------------------------------------------------------------------
// New catalogue item (5A as amended) — two modes, side by side
// ---------------------------------------------------------------------------

/**
 * One way in to adding a piece, offering both ways of doing it.
 *
 * James's amendment: rather than "photo intake" and "add by hand" being two
 * places to remember, this is one page with both modes visible. Somebody who
 * starts by uploading a scan and finds the reading poor just carries on typing
 * into the same form, which is what actually happens in practice.
 */
export function adminNewItemPage(extractionReady: boolean, formHtml: string): string {
  return page(
    `New catalogue item — ${CHURCH.appName}`,
    `<h1>New catalogue item<span class="sub">Parse a scan, or type it in</span></h1>

     <div class="modes">
       <div class="card">
         <h2>Parse a scan</h2>
         ${
           extractionReady
             ? `<p class="muted">Photograph the label or upload a scan. What it reads goes into the form
                  below for you to check — nothing is saved until you press the button.</p>
                <form id="upload-form">
                  <div class="field">
                    <label for="photo">Photo or PDF</label>
                    <input type="file" id="photo" name="photo" accept="image/*,.pdf" capture="environment" required>
                    <span class="hint">A straight-on photo in good light reads best. One label at a time.</span>
                  </div>
                  <button type="submit" id="go">Read it</button>
                </form>
                <p id="status" class="muted hidden"></p>`
             : `<div class="notice">
                  <p style="margin:0"><strong>Switched off.</strong> No <code>ANTHROPIC_API_KEY</code> is set
                     for this Worker, so there is nothing to read the scan with. Use the other side.</p>
                </div>`
         }
       </div>

       <div class="card">
         <h2>Enter manually</h2>
         <p class="muted">Everything the parcel label says. This is the same form the scan fills in, so
            you can start on either side and finish on this one.</p>
         <div id="concerns"></div>
         ${formHtml}
       </div>
     </div>

     <style>
       .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: start; }
       @media (max-width: 52rem) { .modes { grid-template-columns: 1fr; } }
       .modes .card { margin: 0; }
     </style>`,
    { admin: true, path: "/admin/new" }
  );
}

// ---------------------------------------------------------------------------
// Search and bulk edit
// ---------------------------------------------------------------------------

export interface AdminSearchFilters extends SearchQuery {
  season?: string;
  locationDoor?: string;
  scanned?: string;
  flagged?: string;
}

/**
 * The filterable table, with a bulk-edit bar under it.
 *
 * The bar only sets fields somebody has filled in — a blank box means "leave
 * this alone", not "clear it". Getting that backwards would let one careless
 * bulk edit wipe the season tags off two hundred rows, which is the sort of
 * mistake that costs an afternoon and is not obviously recoverable.
 */
export function adminSearchPage(
  filters: AdminSearchFilters,
  result: SearchResult,
  message?: string
): string {
  const categoryOptions = CHURCH.categories
    .map((c) => `<option value="${esc(c.code)}"${filters.category === c.code ? " selected" : ""}>${esc(c.label)}</option>`)
    .join("");
  const seasonOptions = CHURCH.seasons
    .map((s) => `<option value="${esc(s.value)}"${filters.season === s.value ? " selected" : ""}>${esc(s.label)}</option>`)
    .join("");
  const doorOptions = CHURCH.storage.doors
    .map((d) => `<option value="${esc(d)}"${filters.locationDoor === d ? " selected" : ""}>Door ${esc(d)}</option>`)
    .join("");

  const rows = result.pieces
    .map(
      (p) => `<tr>
        <td><input type="checkbox" name="id" value="${p.id}" form="bulk"></td>
        <td><a href="/admin/piece/${p.id}">${esc(p.title)}</a>
            ${p.review_flag ? `<br>${flagPills(p.review_flag)}` : ""}</td>
        <td>${esc(p.composer)}</td>
        <td>${esc(categoryLabel(p.category))}</td>
        <td>${p.season ? esc(p.season.replace(/;/g, ", ")) : ""}</td>
        <td>${p.location_door ? `${esc(p.location_door)}${p.location_shelf ? `/${p.location_shelf}` : ""}` : esc(p.location ?? "")}</td>
        <td class="num">${p.copies_usable ?? ""}</td>
      </tr>`
    )
    .join("");

  return page(
    `Search and bulk edit — ${CHURCH.appName}`,
    `<h1>Search and bulk edit<span class="sub">${result.total} ${result.total === 1 ? "piece" : "pieces"} match</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}

     <div class="card">
       <form method="GET" action="/admin/search">
         <div class="row">
           <div class="field">
             <label for="q">Composer or title</label>
             <input type="search" id="q" name="q" value="${esc(filters.q ?? "")}">
           </div>
           <div class="field">
             <label for="category">Category</label>
             <select id="category" name="category"><option value="">Any</option>${categoryOptions}</select>
           </div>
           <div class="field">
             <label for="season">Season</label>
             <select id="season" name="season"><option value="">Any</option>${seasonOptions}</select>
           </div>
         </div>
         <div class="row">
           <div class="field">
             <label for="door">Where it lives</label>
             <select id="door" name="door"><option value="">Anywhere</option>${doorOptions}</select>
           </div>
           <div class="field">
             <label for="scanned">Scanned</label>
             <select id="scanned" name="scanned">
               <option value="">Either</option>
               <option value="yes"${filters.scanned === "yes" ? " selected" : ""}>Scanned</option>
               <option value="no"${filters.scanned === "no" ? " selected" : ""}>Not scanned</option>
             </select>
           </div>
           <div class="field">
             <label for="flagged">Flag state</label>
             <select id="flagged" name="flagged">
               <option value="">Any</option>
               <option value="flagged"${filters.flagged === "flagged" ? " selected" : ""}>Flagged</option>
               <option value="unreviewed"${filters.flagged === "unreviewed" ? " selected" : ""}>Not reviewed</option>
               <option value="reviewed"${filters.flagged === "reviewed" ? " selected" : ""}>Reviewed</option>
             </select>
           </div>
         </div>
         <button type="submit">Filter</button>
       </form>
     </div>

     ${
       result.pieces.length
         ? `<div class="scroll"><table>
              <tr><th></th><th>Title</th><th>Composer</th><th>Category</th><th>Season</th><th>Where</th><th class="num">Usable</th></tr>
              ${rows}
            </table></div>

            <div class="card">
              <h2>Change the ticked ones</h2>
              <p class="muted small">Anything you leave blank is left alone. Nothing here clears a field —
                 to empty one, edit that piece on its own page.</p>
              <form method="POST" action="/admin/search/bulk" id="bulk">
                <div class="row">
                  <div class="field">
                    <label for="b-category">Category</label>
                    <select id="b-category" name="category"><option value="">Leave alone</option>${
                      CHURCH.categories.map((c) => `<option value="${esc(c.code)}">${esc(c.label)}</option>`).join("")
                    }</select>
                  </div>
                  <div class="field">
                    <label for="b-season">Season</label>
                    <select id="b-season" name="season"><option value="">Leave alone</option>${
                      CHURCH.seasons.map((s) => `<option value="${esc(s.value)}">${esc(s.label)}</option>`).join("")
                    }</select>
                  </div>
                  <div class="field">
                    <label for="b-door">Door</label>
                    <select id="b-door" name="location_door"><option value="">Leave alone</option>${
                      CHURCH.storage.doors.map((d) => `<option value="${esc(d)}">Door ${esc(d)}</option>`).join("")
                    }</select>
                  </div>
                  <div class="field">
                    <label for="b-shelf">Shelf</label>
                    <input type="number" id="b-shelf" name="location_shelf" min="1" max="${CHURCH.storage.maxShelf}"
                           placeholder="Leave alone">
                  </div>
                </div>
                <div class="field">
                  <label for="b-spine">Spine label</label>
                  <select id="b-spine" name="spine_state">
                    <option value="">Leave alone</option>
                    <option value="ok">Has a usable spine</option>
                    <option value="none">No usable spine</option>
                    <option value="combined">Shares a combined label</option>
                  </select>
                </div>
                <button type="submit">Change the ticked ones</button>
                <span class="muted small">Every bulk change is written to the activity log.</span>
              </form>
            </div>`
         : `<p class="muted">Nothing matched those filters.</p>`
     }`,
    { admin: true, path: "/admin/search" }
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function adminReportsPage(
  cover: Coverage,
  most: SungCount[],
  least: SungCount[],
  conditions: ConditionCount[],
  readiness: SeasonReadiness[],
  since: string
): string {
  const bar = (n: number, total: number, label: string) => {
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `<div class="cov">
        <div class="cov-l"><span>${esc(label)}</span><span class="muted">${n} of ${total} · ${pct}%</span></div>
        <div class="cov-t"><div class="cov-f" style="width:${pct}%"></div></div>
      </div>`;
  };

  const conditionLabel = new Map(CHURCH.conditions.map((c) => [c.value, c.label]));

  return page(
    `Reports — ${CHURCH.appName}`,
    `<h1>Reports</h1>

     <div class="card">
       <h2>How far through we are</h2>
       ${bar(cover.reviewed, cover.pieces, "Checked by a human")}
       ${bar(cover.counted, cover.pieces, "Counted")}
       ${bar(cover.conditionAssessed, cover.pieces, "Condition recorded")}
       ${bar(cover.scanned, cover.pieces, "Scanned")}
       ${bar(cover.seasonTagged, cover.pieces, "Season tagged")}
       ${bar(cover.located, cover.pieces, "Where it lives recorded")}
       ${bar(cover.withAccession, cover.pieces, "Accession number assigned")}
     </div>

     <div class="card">
       <h2>Condition</h2>
       <div class="scroll"><table>
         <tr><th>Grade</th><th class="num">Parcels</th></tr>
         ${conditions
           .map(
             (c) => `<tr><td>${esc(conditionLabel.get(c.condition) ?? c.condition)}</td>
               <td class="num">${c.n}</td></tr>`
           )
           .join("")}
       </table></div>
       <p class="muted small">Each parcel counted once, at its most recent count.</p>
     </div>

     <div class="card">
       <h2>Sung most since ${esc(prettyDate(since))}</h2>
       ${
         most.length
           ? `<div class="scroll"><table>
                <tr><th>Piece</th><th>Composer</th><th class="num">Times</th><th>Last</th></tr>
                ${most
                  .map(
                    (s) => `<tr><td><a href="/admin/piece/${s.piece_id}">${esc(s.title)}</a></td>
                      <td>${esc(s.composer)}</td><td class="num">${s.times}</td>
                      <td>${esc(prettyDate(s.last_sung))}</td></tr>`
                  )
                  .join("")}
              </table></div>`
           : `<p class="muted">Nothing yet. This fills in as music-list lines are confirmed —
                only confirmed matches count, so the numbers are the choir's history rather than
                the matcher's opinion.</p>`
       }
     </div>

     <div class="card">
       <h2>Not sung since ${esc(prettyDate(since))}</h2>
       ${
         least.length
           ? `<div class="scroll"><table>
                <tr><th>Piece</th><th>Composer</th><th>Last sung</th></tr>
                ${least
                  .map(
                    (s) => `<tr><td><a href="/admin/piece/${s.piece_id}">${esc(s.title)}</a></td>
                      <td>${esc(s.composer)}</td>
                      <td>${s.last_sung ? esc(prettyDate(s.last_sung)) : '<span class="muted">never recorded</span>'}</td></tr>`
                  )
                  .join("")}
              </table></div>`
           : `<p class="muted">Nothing to show yet.</p>`
       }
     </div>

     <div class="card">
       <h2>The seasons ahead</h2>
       ${
         readiness.length
           ? `<div class="scroll"><table>
                <tr><th>Season</th><th class="num">Tagged</th><th class="num">Scanned</th><th class="num">Short of copies</th></tr>
                ${readiness
                  .map(
                    (r) => `<tr><td><a href="/admin/search?season=${esc(r.season)}">${esc(r.label)}</a></td>
                      <td class="num">${r.tagged}</td><td class="num">${r.scanned}</td>
                      <td class="num">${r.thin ? `<span class="pill amber">${r.thin}</span>` : "0"}</td></tr>`
                  )
                  .join("")}
              </table></div>
              <p class="muted small">The seasons falling within the next six weeks. "Short of copies"
                 compares the last count against the largest choir on record, so it reads zero until
                 choir sizes are filled in.</p>`
           : `<p class="muted">No seasons fall in the next few weeks.</p>`
       }
     </div>

     <style>
       .cov { margin: 0.55rem 0; }
       .cov-l { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 0.2rem; }
       .cov-t { background: var(--colour-surface-alt); border-radius: var(--radius-pill); height: 0.5rem; }
       .cov-f { background: var(--colour-accent); border-radius: var(--radius-pill); height: 100%; }
     </style>`,
    { admin: true, path: "/admin/reports" }
  );
}

// ---------------------------------------------------------------------------
// Priority queues
// ---------------------------------------------------------------------------

export function adminQueuesPage(scanning: PriorityPiece[], repairs: PriorityPiece[]): string {
  const table = (rows: PriorityPiece[], empty: string) =>
    rows.length
      ? `<div class="scroll"><table>
           <tr><th>Piece</th><th>Composer</th><th>Why</th><th>Last sung</th></tr>
           ${rows
             .map(
               (p) => `<tr>
                 <td>${p.accession ? `<span class="pill grey">${esc(p.accession)}</span> ` : ""}
                     <a href="/admin/piece/${p.id}">${esc(p.title)}</a></td>
                 <td>${esc(p.composer)}</td>
                 <td>${esc(p.reason)}</td>
                 <td>${p.last_sung ? esc(prettyDate(p.last_sung)) : ""}</td>
               </tr>`
             )
             .join("")}
         </table></div>`
      : `<p class="muted">${esc(empty)}</p>`;

  return page(
    `What to do next — ${CHURCH.appName}`,
    `<h1>What to do next</h1>

     <div class="card">
       <h2>Scan these first</h2>
       <p class="muted small">Coming up at a service, then tagged for the season, then sung most recently.
          Anything already scanned is off the list.</p>
       ${table(scanning, "Nothing waiting — every reviewed piece has a scan.")}
     </div>

     <div class="card">
       <h2>Repair these first</h2>
       <p class="muted small">Urgent, then poor, then anything with no usable spine label — a parcel
          nobody can read the spine of is lost on the shelf whatever state the paper is in.</p>
       ${table(repairs, "Nothing in poor or urgent condition, and every parcel has a readable spine.")}
     </div>`,
    { admin: true, path: "/admin/queues" }
  );
}

export function adminStocktakePage(due: RecountRow[]): string {
  return page(
    `Due a recount — ${CHURCH.appName}`,
    `<h1>Due a recount<span class="sub">${due.length} ${due.length === 1 ? "parcel" : "parcels"}</span></h1>
     <p class="muted">Not counted for ${CHURCH.stocktake.yearsBetweenCounts} years, or sung
        ${CHURCH.stocktake.performancesBetweenCounts} times since the last count — whichever came first.
        This is a list to look at, not a nag: it feeds the volunteer sheet run.</p>
     ${
       due.length
         ? `<div class="scroll"><table>
              <tr><th>Piece</th><th>Composer</th><th>Last counted</th><th class="num">Sung since</th><th>Why</th></tr>
              ${due
                .map(
                  (r) => `<tr>
                    <td>${r.accession ? `<span class="pill grey">${esc(r.accession)}</span> ` : ""}
                        <a href="/admin/piece/${r.id}">${esc(r.title)}</a></td>
                    <td>${esc(r.composer)}</td>
                    <td>${r.last_counted ? esc(prettyDate(r.last_counted)) : '<span class="muted">never</span>'}</td>
                    <td class="num">${r.performances_since}</td>
                    <td>${esc(r.reason)}</td>
                  </tr>`
                )
                .join("")}
            </table></div>`
         : `<div class="notice ok"><p>Nothing is due a recount.</p></div>`
     }`,
    { admin: true, path: "/admin/stocktake" }
  );
}

// ---------------------------------------------------------------------------
// Loans (H5)
// ---------------------------------------------------------------------------

export function adminLoansPage(open: LoanRow[], message?: string): string {
  return page(
    `Out on loan — ${CHURCH.appName}`,
    `<h1>Out on loan<span class="sub">${open.length} ${open.length === 1 ? "loan" : "loans"} outstanding</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}

     ${
       open.length
         ? `<div class="scroll"><table>
              <tr><th>Piece</th><th>Who has it</th><th class="num">Copies</th><th>Out since</th><th>Due back</th><th></th></tr>
              ${open
                .map(
                  (l) => `<tr>
                    <td><a href="/admin/piece/${l.piece_id}">${esc(l.title)}</a>
                        <div class="muted small">${esc(l.composer)}${l.reason ? ` · ${esc(l.reason)}` : ""}</div></td>
                    <td>${esc(l.borrower)}</td>
                    <td class="num">${l.copies}</td>
                    <td>${esc(prettyDate(l.out_at))}</td>
                    <td>${l.due_back ? esc(prettyDate(l.due_back)) : '<span class="muted">not said</span>'}</td>
                    <td><form method="POST" action="/admin/loans/${l.id}/back">
                          <button type="submit" class="secondary">Back</button>
                        </form></td>
                  </tr>`
                )
                .join("")}
            </table></div>`
         : `<div class="notice ok"><p>Nothing is out.</p></div>`
     }

     <div class="card">
       <h2>Lend something out</h2>
       <form method="POST" action="/admin/loans">
         <div class="row">
           <div class="field">
             <label for="piece_id">Piece number</label>
             <input type="number" id="piece_id" name="piece_id" min="1" required>
             <span class="hint">From the piece's address — <a href="/admin/search">search for it</a>.</span>
           </div>
           <div class="field">
             <label for="copies">How many copies</label>
             <input type="number" id="copies" name="copies" min="1" max="999" value="1" required>
           </div>
           <div class="field">
             <label for="due_back">Due back</label>
             <input type="text" id="due_back" name="due_back" placeholder="YYYY-MM-DD">
           </div>
         </div>
         <div class="row">
           <div class="field">
             <label for="borrower">Who is taking it</label>
             <input type="text" id="borrower" name="borrower" required>
           </div>
           <div class="field">
             <label for="reason">What for</label>
             <input type="text" id="reason" name="reason" placeholder="e.g. the Wednesday rehearsal">
           </div>
         </div>
         <button type="submit">Log it out</button>
       </form>
     </div>`,
    { admin: true, path: "/admin/loans" }
  );
}

// ---------------------------------------------------------------------------
// Settings — password, choir sizes, activity
// ---------------------------------------------------------------------------

export function adminSettingsPage(
  profiles: ChoirProfileRow[],
  usingStoredPassword: boolean,
  generation: number,
  message?: string,
  error?: string
): string {
  return page(
    `Settings — ${CHURCH.appName}`,
    `<h1>Settings</h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}
     ${error ? `<div class="notice error"><p style="margin:0">${esc(error)}</p></div>` : ""}

     <div class="card">
       <h2>The choir password</h2>
       <p class="muted">Changing this <strong>signs everybody out</strong>, on every device, straight away.
          That is the point of changing it at the start of term — somebody who has left stops getting in.
          You will have to sign in again yourself on the choir side.</p>
       ${
         usingStoredPassword
           ? `<p class="small muted">Changed ${generation} ${generation === 1 ? "time" : "times"} from this screen.</p>`
           : `<div class="notice">
                <p style="margin:0">The password is still the one set as a Cloudflare secret. Once you set one
                   here, the secret stops being used at all.</p>
              </div>`
       }
       <form method="POST" action="/admin/settings/password">
         <div class="row">
           <div class="field">
             <label for="password">New password</label>
             <input type="password" id="password" name="password" autocomplete="new-password" required>
             <span class="hint">Three or four ordinary words are easier to tell a choir than a jumble of
               symbols, and harder to guess.</span>
           </div>
           <div class="field">
             <label for="confirm">Type it again</label>
             <input type="password" id="confirm" name="confirm" autocomplete="new-password" required>
           </div>
         </div>
         <button type="submit" class="confirm">Change the password and sign everybody out</button>
       </form>
     </div>

     <div class="card">
       <h2>How big each choir is</h2>
       <p class="muted">The copies check on a service page divides these into the usable copy count.</p>
       <p class="muted small">Most of these work themselves out: "Boys and SATB" is the boys plus the
          adults, added up from the section sizes below. Put a number in only where a term is
          genuinely different — an entry here overrides the calculation for that designation.
          A designation naming a visiting choir stays blank on purpose, because nobody here knows
          how many they are bringing.</p>
       <form method="POST" action="/admin/settings/choirs">
         <div class="scroll"><table>
           <tr><th>Designation</th><th class="num">Typical singers</th><th>How it is worked out</th></tr>
           ${profiles
             .map((p) => {
               const worked = singersFor(p.designation);
               return `<tr>
                 <td>${esc(p.designation)}</td>
                 <td class="num"><input type="number" name="singers-${p.id}" min="0" max="200"
                      value="${p.typical_singers ?? ""}" style="width:6rem"
                      placeholder="${worked ?? "—"}"></td>
                 <td class="small ${p.typical_singers != null ? "muted" : ""}">${
                   p.typical_singers != null
                     ? `overridden — normally ${esc(explainChoirSize(p.designation))}`
                     : esc(explainChoirSize(p.designation))
                 }</td>
               </tr>`;
             })
             .join("")}
         </table></div>

         <details style="margin-top:0.8rem">
           <summary class="muted small">The section sizes these are added up from</summary>
           <div class="scroll"><table>
             <tr><th>Section</th><th class="num">Singers</th></tr>
             <tr><td>Boys</td><td class="num">${CHURCH.choirSections.boys}</td></tr>
             <tr><td>Girls (younger girls)</td><td class="num">${CHURCH.choirSections.girls}</td></tr>
             <tr><td>Consort (older girls)</td><td class="num">${CHURCH.choirSections.consort}</td></tr>
             <tr><td>Adults — Team A</td><td class="num">${TEAM_A_TOTAL}</td></tr>
             <tr><td>Adults — Team B</td><td class="num">${TEAM_B_TOTAL}</td></tr>
             <tr><td><strong>SATB (both teams)</strong></td><td class="num"><strong>${ADULT_TOTAL}</strong></td></tr>
             <tr><td><strong>Full Choir</strong></td><td class="num"><strong>${FULL_CHOIR_TOTAL}</strong></td></tr>
           </table></div>
           <p class="muted small">From September 2026 — the children's numbers from Rachel Dent, the
              adults counted off the choir teams list. When they drift, they are changed in
              <code>src/church.config.ts</code> and everything above follows.
              The Junior Choir is not counted: they do not sing from copies.</p>
         </details>
         <div class="field" style="margin-top:0.8rem">
           <label for="new_designation">Add a designation</label>
           <input type="text" id="new_designation" name="new_designation"
                  placeholder="As the music list writes it, e.g. Consort and Team A">
           <span class="hint">The music list publishes designations we have not seen — matching is on the
             whole name, so it has to be spelled the way the list spells it.</span>
         </div>
         <button type="submit">Save</button>
       </form>
     </div>

     <div class="card">
       <h2>Activity</h2>
       <p><a class="btn secondary" href="/admin/activity">See who did what</a></p>
     </div>`,
    { admin: true, path: "/admin/settings" }
  );
}

/**
 * The activity log.
 *
 * Every admin mutation, newest first, naming the Cloudflare Access identity
 * that made it. Six people hold the Librarian policy, and "who decided that?"
 * only has an honest answer if it was written down at the time.
 */
export function adminActivityPage(rows: AuditRow[]): string {
  return page(
    `Activity — ${CHURCH.appName}`,
    `<h1>Activity<span class="sub">The last ${rows.length} things done here</span></h1>
     ${
       rows.length
         ? `<div class="scroll"><table>
              <tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr>
              ${rows
                .map(
                  (r) => `<tr>
                    <td class="muted small">${esc(prettyDate(r.at))}</td>
                    <td>${esc(r.user_email ?? "unknown")}</td>
                    <td><code>${esc(r.action)}</code>${
                      r.entity && r.entity_id
                        ? ` <span class="muted small">${esc(r.entity)} ${r.entity_id}</span>`
                        : ""
                    }</td>
                    <td class="small">${esc(r.detail ?? "")}</td>
                  </tr>`
                )
                .join("")}
            </table></div>`
         : `<p class="muted">Nothing has been changed yet.</p>`
     }
     <p class="muted small">Attendance is deliberately not in here: a register is personal data about a
        child, and it does not belong in a log admins read looking for a mistake. Each attendance row
        records who marked it, on the register itself.</p>`,
    { admin: true, path: "/admin/activity" }
  );
}

export { betaChip };

// ---------------------------------------------------------------------------
// Labels (1A, H10)
// ---------------------------------------------------------------------------

/**
 * The label print screen.
 *
 * Two stocks, two jobs. The volunteer run is a sheet per parcel with the
 * hand-fill form below the label; the Avery run is reprints and combined
 * labels, with a start position so a part-used sheet is not wasted.
 *
 * Both are described in terms of the physical thing in the box, because that is
 * what James is holding when he uses this.
 */
export function adminLabelsPage(
  candidates: PieceWithHolding[],
  filters: { door?: string; unlabelled?: boolean },
  message?: string
): string {
  const doorOptions = CHURCH.storage.doors
    .map((d) => `<option value="${esc(d)}"${filters.door === d ? " selected" : ""}>Door ${esc(d)}</option>`)
    .join("");

  const rows = candidates
    .map(
      (p) => `<tr>
        <td><input type="checkbox" name="id" value="${p.id}" form="labels" checked></td>
        <td>${p.accession ? `<span class="pill grey">${esc(p.accession)}</span>` : '<span class="muted small">no number yet</span>'}</td>
        <td>${esc(p.surname ?? p.composer)}</td>
        <td>${esc(p.title.length > 60 ? `${p.title.slice(0, 59)}…` : p.title)}</td>
        <td>${esc(categoryLabel(p.category))}</td>
      </tr>`
    )
    .join("");

  return page(
    `Print labels — ${CHURCH.appName}`,
    `<h1>Print labels<span class="sub">${candidates.length} selected</span></h1>
     ${message ? `<div class="notice">${esc(message)}</div>` : ""}

     <div class="notice info">
       <p style="margin:0"><strong>Print at 100%.</strong> Every one of these files starts with a
          calibration page: hold it against a blank sheet of the stock before committing to a long run.
          If your printer dialog says "Fit to page" or "Shrink oversized pages", turn it off — that is
          what puts a whole run 3mm out.</p>
     </div>

     <div class="card">
       <h2>Choose what to print</h2>
       <form method="GET" action="/admin/labels">
         <div class="row">
           <div class="field">
             <label for="door">Where it lives</label>
             <select id="door" name="door"><option value="">Anywhere</option>${doorOptions}</select>
           </div>
           <div class="field">
             <label for="unlabelled">Which parcels</label>
             <select id="unlabelled" name="unlabelled">
               <option value="">All reviewed pieces</option>
               <option value="1"${filters.unlabelled ? " selected" : ""}>Only ones never printed</option>
             </select>
           </div>
         </div>
         <button type="submit" class="secondary">Show them</button>
       </form>
     </div>

     ${
       candidates.length
         ? `<div class="scroll"><table>
              <tr><th></th><th>Accession</th><th>Composer</th><th>Title</th><th>Category</th></tr>
              ${rows}
            </table></div>

            <form method="POST" action="/admin/labels/print" id="labels" target="_blank">
              <div class="card">
                <h2>Volunteer sheets <span class="muted small">${esc(CHURCH.labels.volunteerSheet.stock)}</span></h2>
                <p class="muted">One A4 sheet per parcel: the peel-off label at the top goes on the parcel,
                   and the form below it is what the volunteer fills in with the parcel open. This is the
                   run for the volunteer day.</p>
                <button type="submit" name="stock" value="volunteer">Make the volunteer sheets</button>
              </div>

              <div class="card">
                <h2>Labels <span class="muted small">${esc(CHURCH.labels.avery.stock)}</span></h2>
                <p class="muted">Reprints, face labels and combined labels, 14 to a sheet.</p>
                <div class="row">
                  <div class="field">
                    <label for="start">Start at position</label>
                    <input type="number" id="start" name="start" min="1" max="14" value="1">
                    <span class="hint">Counting left to right, then down. Use this on a part-used sheet
                      so the labels already peeled off are skipped.</span>
                  </div>
                  <div class="field">
                    <label for="kind">What kind</label>
                    <select id="kind" name="kind">
                      <option value="spine">Spine labels</option>
                      <option value="face">Face labels</option>
                      <option value="combined">Combined label for a box</option>
                    </select>
                  </div>
                </div>
                <button type="submit" name="stock" value="avery">Make the label sheet</button>
              </div>

              <div class="card">
                <h2>Just the calibration page</h2>
                <p class="muted small">Prints the die-cut outline and nothing else, for either stock.</p>
                <button type="submit" name="stock" value="calibration-volunteer" class="secondary">Volunteer stock</button>
                <button type="submit" name="stock" value="calibration-avery" class="secondary">Avery stock</button>
              </div>
            </form>`
         : `<p class="muted">Nothing matches those filters. Labels are only offered for reviewed pieces —
              an accession number goes on a physical parcel, so it should not go on a row whose composer
              might still be wrong.</p>`
     }`,
    { admin: true, path: "/admin/labels" }
  );
}

// ---------------------------------------------------------------------------
// People and the register (beta)
// ---------------------------------------------------------------------------

export function adminPeoplePage(people: PersonRow[], showingLeavers: boolean, message?: string): string {
  const choirOptions = CHOIRS.map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join("");
  const partOptions = CHURCH.voiceParts
    .map((v) => `<option value="${esc(v.value)}">${esc(v.label)}</option>`)
    .join("");

  const byChoir = new Map<string, PersonRow[]>();
  for (const p of people) {
    const list = byChoir.get(p.choir);
    if (list) list.push(p);
    else byChoir.set(p.choir, [p]);
  }

  return page(
    `The choir — ${CHURCH.appName}`,
    `<h1>The choir ${betaChip()}<span class="sub">${people.length} on the list</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}

     <div class="notice">
       <p style="margin:0"><strong>Names only.</strong> This holds what a register needs and nothing more —
          no contact details, no dates of birth. Nothing on the choir side can see any of it, and no
          chorister can see anybody else's attendance.</p>
     </div>

     ${
       people.length
         ? CHOIRS.filter((c) => byChoir.has(c.value))
             .map(
               (c) => `<div class="card">
                 <h2>${esc(c.label)}</h2>
                 <div class="scroll"><table>
                   <tr><th>Name</th><th>School year</th><th>Voice part</th><th></th></tr>
                   ${byChoir
                     .get(c.value)!
                     .map(
                       (p) => `<tr${p.left_on ? ' class="gone"' : ""}>
                         <td><a href="/admin/people/${p.id}">${esc(p.display_name)}</a></td>
                         <td>${
                           p.school_year !== null
                             ? esc(schoolYearLabel(p.school_year))
                             : '<span class="muted">adult</span>'
                         }</td>
                         <td>${
                           p.voice_part
                             ? esc(CHURCH.voiceParts.find((v) => v.value === p.voice_part)?.label ?? p.voice_part)
                             : '<span class="muted">not recorded</span>'
                         }</td>
                         <td>${
                           p.left_on
                             ? `<span class="muted small">left ${esc(prettyDate(p.left_on))}</span>`
                             : ""
                         }</td>
                       </tr>`
                     )
                     .join("")}
                 </table></div>
               </div>`
             )
             .join("")
         : `<p class="muted">Nobody on the list yet.</p>`
     }

     <p>
       <a class="btn secondary" href="/admin/people${showingLeavers ? "" : "?leavers=1"}">
         ${showingLeavers ? "Hide people who have left" : "Show people who have left"}
       </a>
     </p>

     <style>
       tr.gone td { color: var(--colour-muted); }
     </style>

     <div class="card">
       <h2>Add somebody</h2>
       <form method="POST" action="/admin/people">
         <div class="row">
           <div class="field">
             <label for="display_name">Name</label>
             <input type="text" id="display_name" name="display_name" required>
           </div>
           <div class="field">
             <label for="choir">Choir</label>
             <select id="choir" name="choir">${choirOptions}</select>
           </div>
           <div class="field">
             <label for="voice_part">Voice part</label>
             <select id="voice_part" name="voice_part">
               <option value="">Not recorded</option>${partOptions}
             </select>
             <span class="hint">Optional. Section-level attendance waits on these being filled in.</span>
           </div>
           <div class="field">
             <label for="school_year">School year</label>
             <select id="school_year" name="school_year">
               <option value="">Adult</option>
               ${SCHOOL_YEARS.map((y) => `<option value="${y}">${esc(schoolYearLabel(y))}</option>`).join("")}
             </select>
             <span class="hint">Moves up by itself each September. Leave as "Adult" for grown-ups —
               we hold no dates of birth and no ages.</span>
           </div>
         </div>
         <button type="submit">Add</button>
       </form>
     </div>`,
    { admin: true, path: "/admin/people" }
  );
}

/**
 * The register, taken at the door on a phone.
 *
 * Every name is one big tappable button that cycles unmarked → present →
 * absent → excused and saves as it goes. Big targets because this is used
 * one-handed on an iPhone in a doorway, with the other hand holding a door open.
 */
export function adminRegisterPage(
  service: { id: number; title: string; service_date: string; designation: string | null },
  rows: RegisterRow[],
  tally: { present: number; absent: number; excused: number; unmarked: number }
): string {
  const statusPill = (status: string | null) => {
    switch (status) {
      case "present":
        return `<span class="pill green">Here</span>`;
      case "absent":
        return `<span class="pill red">Away</span>`;
      case "excused":
        return `<span class="pill amber">Excused</span>`;
      default:
        return `<span class="pill grey">Tap to mark</span>`;
    }
  };

  return page(
    `Register — ${CHURCH.appName}`,
    `<p class="crumb"><a href="/admin/people">← The choir</a></p>
     <h1>Register ${betaChip()}<span class="sub">${esc(service.title)} — ${esc(prettyDate(service.service_date))}</span></h1>

     <p class="small">
       <span class="pill green">${tally.present} here</span>
       <span class="pill red">${tally.absent} away</span>
       <span class="pill amber">${tally.excused} excused</span>
       <span class="pill grey">${tally.unmarked} not marked</span>
     </p>

     ${
       rows.length
         ? `<div class="register">
              ${rows
                .map(
                  (r) => `<form method="POST" action="/admin/people/register/${service.id}/${r.id}">
                    <button type="submit" class="who">
                      <span class="n">${esc(r.display_name)}</span>
                      ${statusPill(r.status)}
                    </button>
                  </form>`
                )
                .join("")}
            </div>
            <p class="muted small">Each tap moves on: not marked → here → away → excused → not marked.
               It saves as you go.</p>`
         : `<p class="muted">Nobody is on the list for this service's choir yet.
              <a href="/admin/people">Add the choir</a> first.</p>`
     }

     <style>
       .register { display: grid; gap: 0.4rem; }
       .register form { margin: 0; }
       .register .who { display: flex; align-items: center; justify-content: space-between; gap: 1rem;
                        width: 100%; text-align: left; font-size: 1.1rem; padding: 0.9rem 1rem;
                        background: var(--colour-surface); color: var(--colour-ink);
                        border: 1px solid var(--colour-border); }
       .register .who:hover { background: var(--colour-accent-tint); }
       .register .who .n { font-weight: 600; }
     </style>`,
    { admin: true, path: `/admin/people/register/${service.id}` }
  );
}

// ---------------------------------------------------------------------------
// The repertoire picker (8A)
// ---------------------------------------------------------------------------

/**
 * Choosing music for a service.
 *
 * Filters work from day one; the ranking by history is **beta** and says so,
 * because it is only as good as the confirmed matches behind it and there are
 * very few of those until the music lists have been worked through.
 */
export function adminSuggestionsPage(
  results: (PieceWithHolding & { times_sung: number; last_sung: string | null; scanned: number })[],
  filters: { season?: string; category?: string; designation?: string },
  typicalSingers: number | null,
  ragFor: (copiesUsable: number | null) => { state: string; label: string; reason: string }
): string {
  const seasonOptions = CHURCH.seasons
    .map((s) => `<option value="${esc(s.value)}"${filters.season === s.value ? " selected" : ""}>${esc(s.label)}</option>`)
    .join("");
  const categoryOptions = CHURCH.categories
    .map((c) => `<option value="${esc(c.code)}"${filters.category === c.code ? " selected" : ""}>${esc(c.label)}</option>`)
    .join("");

  return page(
    `Choosing music — ${CHURCH.appName}`,
    `<h1>Choosing music<span class="sub">${results.length} to look at</span></h1>

     <div class="card">
       <form method="GET" action="/admin/suggestions">
         <div class="row">
           <div class="field">
             <label for="season">Season</label>
             <select id="season" name="season"><option value="">Any</option>${seasonOptions}</select>
           </div>
           <div class="field">
             <label for="category">Category</label>
             <select id="category" name="category"><option value="">Any</option>${categoryOptions}</select>
           </div>
           <div class="field">
             <label for="designation">Which choir</label>
             <input type="text" id="designation" name="designation" value="${esc(filters.designation ?? "")}"
                    placeholder="e.g. Boys and SATB">
             <span class="hint">Sets the copy check below against that choir's size.</span>
           </div>
         </div>
         <button type="submit">Show me</button>
       </form>
     </div>

     <p class="muted small">Ordered by how often it has been sung ${betaChip()} — that ranking is only as
        good as the music-list lines confirmed so far, so it settles down as those are worked through.
        The filters are exact from day one.</p>

     ${
       results.length
         ? `<div class="scroll"><table>
              <tr><th>Piece</th><th>Composer</th><th>Season</th><th class="num">Sung</th><th>Last</th>
                  <th>Copies</th><th>Scan</th></tr>
              ${results
                .map((p) => {
                  const rag = ragFor(p.copies_usable);
                  return `<tr>
                    <td><a href="/admin/piece/${p.id}">${esc(p.title)}</a></td>
                    <td>${esc(p.composer)}</td>
                    <td>${p.season ? esc(p.season.replace(/;/g, ", ")) : ""}</td>
                    <td class="num">${p.times_sung}</td>
                    <td>${p.last_sung ? esc(prettyDate(p.last_sung)) : '<span class="muted">—</span>'}</td>
                    <td><span class="pill ${esc(rag.state)}" title="${esc(rag.reason)}">${esc(rag.label)}</span></td>
                    <td>${p.scanned ? "yes" : '<span class="muted">no</span>'}</td>
                  </tr>`;
                })
                .join("")}
            </table></div>`
         : `<p class="muted">Nothing matched. Try loosening the season or the category.</p>`
     }`,
    { admin: true, path: "/admin/suggestions" }
  );
}

// ---------------------------------------------------------------------------
// Modules, roles, and the two ways in that are refused (Addendum A)
// ---------------------------------------------------------------------------

/**
 * The Modules screen.
 *
 * Everything the register brought with it ships off. This is where it gets
 * turned on, one switch at a time, by music staff — and every flip is audited,
 * because "who turned the register on?" is a question somebody may one day ask.
 *
 * The screen says plainly what a module holds, and marks the ones that hold
 * children's names, so that switching one on is a decision rather than a
 * reflex.
 */
export function adminModulesPage(state: ModuleState, message?: string): string {
  const row = (m: (typeof MODULES)[number]) => {
    const on = state[m.key];
    return `<tr>
      <td>
        <strong>${esc(m.label)}</strong>${m.personal ? ` <span class="chip personal">holds names</span>` : ""}
        <div class="small muted">${esc(m.blurb)}</div>
      </td>
      <td class="num">${on ? `<span class="chip on">On</span>` : `<span class="chip off">Off</span>`}</td>
      <td>
        <form method="POST" action="/admin/modules" style="display:inline">
          <input type="hidden" name="module" value="${esc(m.key)}">
          <input type="hidden" name="on" value="${on ? "0" : "1"}">
          <button type="submit" class="${on ? "secondary" : ""}">${on ? "Switch off" : "Switch on"}</button>
        </form>
      </td>
    </tr>`;
  };

  return page(
    `Modules — ${CHURCH.appName}`,
    `<h1>Modules<span class="sub">What this app does at all</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}

     <div class="notice">
       <p style="margin:0">A module that is off is <strong>not there</strong>: its screens are gone from the
          front page and its addresses answer as though they had never existed. Switching one off does not
          delete anything — the records stay in the database, and come back exactly as they were when it is
          switched on again.</p>
     </div>

     <div class="card">
       <div class="scroll"><table>
         <tr><th>Module</th><th class="num">State</th><th></th></tr>
         ${MODULES.map(row).join("")}
       </table></div>
     </div>

     <style>
       .chip { display: inline-block; padding: 0.05rem 0.45rem; border-radius: var(--radius-pill);
               font-size: 0.75rem; font-weight: 700; }
       .chip.on { background: var(--colour-accent-tint); color: var(--colour-accent); }
       .chip.off { background: var(--colour-surface-sunk); color: var(--colour-muted); }
       .chip.personal { background: var(--colour-surface-sunk); color: var(--colour-muted);
                        font-weight: 400; }
     </style>`,
    { admin: true, path: "/admin/modules" }
  );
}

/**
 * The Roles screen.
 *
 * Cloudflare Access says who may reach `/admin`. This says what they may do
 * once they are here, which is a different question — six people hold a
 * Librarian policy so the library can be catalogued, and none of that is a
 * reason to hand them the register.
 *
 * The last `music_staff` grant cannot be revoked from here: without one there
 * is nobody who can grant anybody anything, and this screen is itself music
 * staff only.
 */
export function adminRolesPage(
  grants: RoleGrant[],
  musicStaffCount: number,
  message?: string,
  error?: string
): string {
  const byEmail = new Map<string, Role[]>();
  for (const g of grants) {
    const held = byEmail.get(g.email);
    if (held) held.push(g.role);
    else byEmail.set(g.email, [g.role]);
  }

  const roleOptions = ROLES.map((r) => `<option value="${esc(r)}">${esc(ROLE_LABELS[r])}</option>`).join("");

  const person = ([email, held]: [string, Role[]]) => `<tr>
    <td>${esc(email)}</td>
    <td>${ROLES.map((r) => {
      if (!held.includes(r)) return "";
      const last = r === "music_staff" && musicStaffCount <= 1;
      return `<form method="POST" action="/admin/roles" style="display:inline-block; margin:0 0.3rem 0.3rem 0">
                <input type="hidden" name="action" value="revoke">
                <input type="hidden" name="email" value="${esc(email)}">
                <input type="hidden" name="role" value="${esc(r)}">
                <button type="submit" class="secondary" ${last ? "disabled" : ""}
                  title="${last ? "The last music staff grant cannot be removed" : `Remove ${esc(ROLE_LABELS[r])}`}">
                  ${esc(ROLE_LABELS[r])} ×
                </button>
              </form>`;
    }).join("")}</td>
  </tr>`;

  return page(
    `Roles — ${CHURCH.appName}`,
    `<h1>Roles<span class="sub">What each administrator may do</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}
     ${error ? `<div class="notice error"><p style="margin:0">${esc(error)}</p></div>` : ""}

     <div class="notice">
       <p style="margin:0">Cloudflare Access decides who reaches this side of the app at all. This decides
          what they find when they do. Somebody with no role here sees a page telling them to ask you.</p>
     </div>

     <div class="card">
       <h2>Who has what</h2>
       ${
         byEmail.size
           ? `<div class="scroll"><table>
                <tr><th>Email</th><th>Roles — click one to remove it</th></tr>
                ${[...byEmail.entries()].map(person).join("")}
              </table></div>`
           : `<p class="muted">Nobody has a role yet.</p>`
       }
     </div>

     <div class="card">
       <h2>Give somebody a role</h2>
       <form method="POST" action="/admin/roles">
         <input type="hidden" name="action" value="grant">
         <div class="row">
           <div class="field">
             <label for="email">Email</label>
             <input type="email" id="email" name="email" required
                    placeholder="as it is spelled in Cloudflare Access">
             <span class="hint">It has to match the address Access signs them in with, exactly.</span>
           </div>
           <div class="field">
             <label for="role">Role</label>
             <select id="role" name="role">${roleOptions}</select>
           </div>
         </div>
         <button type="submit">Give the role</button>
       </form>
     </div>

     <div class="card">
       <h2>What each role means</h2>
       <dl>
         ${ROLES.map(
           (r) => `<dt><strong>${esc(ROLE_LABELS[r])}</strong></dt><dd class="muted">${esc(ROLE_BLURBS[r])}</dd>`
         ).join("")}
       </dl>
     </div>`,
    { admin: true, path: "/admin/roles" }
  );
}

/**
 * Signed in, and holding nothing.
 *
 * Cloudflare Access let them through, so they are somebody the Minster knows,
 * and the page treats them that way: no stack trace, no "forbidden", just what
 * has happened and who fixes it.
 */
export function adminNoRolePage(email: string): string {
  return page(
    `Nothing set up yet — ${CHURCH.appName}`,
    `<h1>Nothing set up for you yet</h1>
     <div class="card">
       <p>You are signed in as <strong>${esc(email)}</strong>, but nobody has said yet what you should be
          able to do here.</p>
       <p>Ask a member of the music staff to give you a role — they can do it from the Roles screen in a
          few seconds. Tell them the address above, exactly as it is written.</p>
       <p class="muted small">Nothing has gone wrong, and there is nothing for you to fix at this end.</p>
     </div>`,
    { admin: true, path: "/admin" }
  );
}

/**
 * Signed in, holding a role, but not this one.
 *
 * Names the role needed rather than the one held: what the reader wants to know
 * is what to ask for. A module that is switched off never reaches this page —
 * it answers 404, because a locked door still tells you there is a room.
 */
export function adminWrongRolePage(required: readonly Role[]): string {
  const names = required.map((r) => ROLE_LABELS[r]);
  const list =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]!}`;

  return page(
    `Not for you — ${CHURCH.appName}`,
    `<h1>That part is not yours</h1>
     <div class="card">
       <p>This screen is for <strong>${esc(list)}</strong>, and you do not have that role.</p>
       <p>If you think you should, ask a member of the music staff — they can add it from the Roles screen.</p>
       <p><a class="btn secondary" href="/admin">Back to the front page</a></p>
     </div>`,
    { admin: true, path: "/admin" }
  );
}

// ---------------------------------------------------------------------------
// One person (Addendum A) — the workbook's Dates sheet, one child at a time
// ---------------------------------------------------------------------------

/**
 * Everything the app holds about one person, on one page.
 *
 * The awards and the joining date come off the department's workbook. The
 * school year is here and an age is not, because we are given a school year and
 * not a date of birth, and an app that cannot compute an age cannot leak one.
 *
 * **Parent contacts are not on this page** until somebody asks for them. The
 * count is shown — knowing a number exists is not the same as reading it — and
 * revealing them is a form submission that writes an audit line naming the
 * viewer, the child and the time before the numbers are fetched at all.
 */
export function adminPersonPage(
  person: PersonRow,
  contactCount: number,
  revealed: ParentContact[] | null,
  mayReadContacts: boolean,
  today: string,
  message?: string
): string {
  const choirOptions = CHOIRS.map(
    (c) => `<option value="${esc(c.value)}"${c.value === person.choir ? " selected" : ""}>${esc(c.label)}</option>`
  ).join("");

  const partOptions = CHURCH.voiceParts
    .map(
      (v) =>
        `<option value="${esc(v.value)}"${v.value === person.voice_part ? " selected" : ""}>${esc(v.label)}</option>`
    )
    .join("");

  const yearOptions = SCHOOL_YEARS.map(
    (y) => `<option value="${y}"${person.school_year === y ? " selected" : ""}>${esc(schoolYearLabel(y))}</option>`
  ).join("");

  const date = (name: string, label: string, value: string | null, hint = "") =>
    `<div class="field">
       <label for="${name}">${esc(label)}</label>
       <input type="date" id="${name}" name="${name}" value="${esc(value ?? "")}">
       ${hint ? `<span class="hint">${esc(hint)}</span>` : ""}
     </div>`;

  const dbsExpired = person.dbs_valid_until !== null && person.dbs_valid_until < today;

  return page(
    `${person.display_name} — ${CHURCH.appName}`,
    `<h1>${esc(person.display_name)} ${betaChip()}
       <span class="sub">${esc(CHOIRS.find((c) => c.value === person.choir)?.label ?? person.choir)}${
         person.school_year !== null ? ` · ${esc(schoolYearLabel(person.school_year))}` : ""
       }</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}
     ${
       person.left_on
         ? `<div class="notice">
              <p style="margin:0"><strong>Left on ${esc(prettyDate(person.left_on))}.</strong>
                 They are off every register and out of every picker. Their attendance up to that date is
                 untouched, because it is what last quarter's pay was worked out from.</p>
            </div>`
         : ""
     }

     <div class="card">
       <h2>Who they are</h2>
       <form method="POST" action="/admin/people/${person.id}">
         <input type="hidden" name="action" value="save">
         <div class="row">
           <div class="field">
             <label for="display_name">Name</label>
             <input type="text" id="display_name" name="display_name"
                    value="${esc(person.display_name)}" required>
           </div>
           <div class="field">
             <label for="choir">Choir</label>
             <select id="choir" name="choir">${choirOptions}</select>
           </div>
           <div class="field">
             <label for="voice_part">Voice part</label>
             <select id="voice_part" name="voice_part">
               <option value="">Not recorded</option>${partOptions}
             </select>
           </div>
           <div class="field">
             <label for="school_year">School year</label>
             <select id="school_year" name="school_year">
               <option value=""${person.school_year === null ? " selected" : ""}>Adult</option>
               ${yearOptions}
             </select>
             <span class="hint">Moves up by itself on 1 September. We hold this and not a date of
               birth — the app has no way to work out anybody's age.</span>
           </div>
         </div>

         <div class="row">
           ${date("joined_on", "Joined the choir", person.joined_on)}
           ${date("surplice_awarded_on", "Surpliced", person.surplice_awarded_on)}
           ${date("deans_award_on", "Dean's award", person.deans_award_on)}
           ${date("archbishops_award_on", "Archbishop's award", person.archbishops_award_on)}
           ${date("gold_award_on", "Gold award", person.gold_award_on)}
         </div>

         <details>
           <summary class="muted small">For adults who take safeguarding duties</summary>
           <div class="row" style="margin-top:0.6rem">
             ${date(
               "dbs_valid_until",
               "DBS valid until",
               person.dbs_valid_until,
               "The rota warns when this is in the past, and says nothing when it is blank."
             )}
             <div class="field">
               <label for="gender">Recorded for duty cover</label>
               <select id="gender" name="gender">
                 <option value=""${person.gender === null ? " selected" : ""}>Not recorded</option>
                 <option value="f"${person.gender === "f" ? " selected" : ""}>Female</option>
                 <option value="m"${person.gender === "m" ? " selected" : ""}>Male</option>
               </select>
               <span class="hint">Only so the rota can check cover includes both when the boys and the
                 girls are both due. Leave blank for children.</span>
             </div>
           </div>
         </details>
         ${dbsExpired ? `<div class="notice error"><p style="margin:0">Their DBS check ran out on ${esc(prettyDate(person.dbs_valid_until!))}.</p></div>` : ""}

         <button type="submit">Save</button>
       </form>
     </div>

     ${adminContactsCard(person, contactCount, revealed, mayReadContacts)}

     <div class="card">
       <h2>Leaving</h2>
       ${
         person.left_on
           ? `<form method="POST" action="/admin/people/${person.id}">
                <input type="hidden" name="action" value="returned">
                <p class="muted">Marked as having left by mistake?</p>
                <button type="submit" class="secondary">Put them back on the list</button>
              </form>`
           : `<form method="POST" action="/admin/people/${person.id}">
                <input type="hidden" name="action" value="left">
                <div class="field" style="max-width:14rem">
                  <label for="left_on">Last day</label>
                  <input type="date" id="left_on" name="left_on" value="${esc(today)}" required>
                </div>
                <button type="submit" class="secondary">Mark as having left</button>
              </form>`
       }
     </div>

     <details class="card">
       <summary><strong>Removing their record</strong></summary>
       <p class="muted">Two ways, and they are not the same thing.</p>
       <form method="POST" action="/admin/people/${person.id}" style="margin-bottom:1rem">
         <input type="hidden" name="action" value="anonymise">
         <p><strong>Take the name off.</strong> Their name becomes
            "Former chorister #${person.id}" and their parents' contact details are deleted. The
            attendance counts stay, so a past quarter's pay still adds up — but nothing says whose they
            were. This cannot be undone.</p>
         <label class="check"><input type="checkbox" name="confirm" value="yes" required>
           I understand this cannot be undone</label>
         <button type="submit" class="secondary">Take the name off</button>
       </form>
       <form method="POST" action="/admin/people/${person.id}">
         <input type="hidden" name="action" value="delete">
         <p><strong>Delete everything.</strong> The person, their attendance, their duties and their
            parents' contact details, gone. This is what a parent asking for their child's record to be
            removed is entitled to.</p>
         <label class="check"><input type="checkbox" name="confirm" value="yes" required>
           I understand this cannot be undone</label>
         <button type="submit" class="confirm">Delete everything</button>
       </form>
     </details>

     <p><a class="btn secondary" href="/admin/people">Back to the choir</a></p>

     <style>
       .check { display: block; margin: 0.4rem 0 0.6rem; font-size: 0.9rem; }
       .check input { margin-right: 0.4rem; }
     </style>`,
    { admin: true, path: "/admin/people" }
  );
}

/**
 * The parent-contact card.
 *
 * Three states, and the difference between them is the whole point. Without
 * the role: a sentence saying the details exist and who may read them. With
 * the role but before asking: a count and a button. After asking: the numbers,
 * and a line saying the look has been written down — so that nobody is under
 * the impression it was private.
 */
function adminContactsCard(
  person: PersonRow,
  contactCount: number,
  revealed: ParentContact[] | null,
  mayRead: boolean
): string {
  if (!mayRead) {
    return `<div class="card">
      <h2>Parents' contact details</h2>
      <p class="muted">${
        contactCount
          ? `${contactCount} recorded. They can be read by music staff and by whoever is on safeguarding duty, and every look is written down.`
          : "None recorded."
      }</p>
    </div>`;
  }

  const list = revealed
    ? `<div class="scroll"><table>
         <tr><th>Who</th><th>Name</th><th>Telephone</th><th></th></tr>
         ${revealed
           .map(
             (contact) => `<tr>
               <td>${esc(contact.label ?? "—")}</td>
               <td>${esc(contact.name ?? "—")}</td>
               <td><a href="tel:${esc((contact.phone ?? "").replace(/\s+/g, ""))}">${esc(contact.phone ?? "—")}</a></td>
               <td><form method="POST" action="/admin/people/contact/${person.id}" style="display:inline">
                     <input type="hidden" name="action" value="delete">
                     <input type="hidden" name="contact_id" value="${contact.id}">
                     <button type="submit" class="secondary">Remove</button>
                   </form></td>
             </tr>`
           )
           .join("")}
       </table></div>
       <p class="small muted">This look has been recorded against your name in the activity log.</p>`
    : `<p class="muted">${
        contactCount
          ? `${contactCount} recorded. They are not shown until you ask for them.`
          : "None recorded yet."
      }</p>
       ${
         contactCount
           ? `<form method="POST" action="/admin/people/contact/${person.id}">
                <input type="hidden" name="action" value="reveal">
                <button type="submit">Show the contact details</button>
                <span class="hint">Asking writes a line in the activity log naming you, this child and
                  the time. That is deliberate.</span>
              </form>`
           : ""
       }`;

  return `<div class="card">
    <h2>Parents' contact details</h2>
    <div class="notice">
      <p style="margin:0">The most sensitive thing this app holds. Never in a list, never in an export
         except the separate contacts export, and never shown without it being written down.</p>
    </div>
    ${list}
    <details style="margin-top:0.8rem">
      <summary class="muted small">Add a contact</summary>
      <form method="POST" action="/admin/people/contact/${person.id}" style="margin-top:0.6rem">
        <input type="hidden" name="action" value="add">
        <div class="row">
          <div class="field">
            <label for="label">Who they are</label>
            <input type="text" id="label" name="label" placeholder="Parent 1, Grandmother">
          </div>
          <div class="field">
            <label for="name">Their name</label>
            <input type="text" id="name" name="name">
          </div>
          <div class="field">
            <label for="phone">Telephone</label>
            <input type="tel" id="phone" name="phone" required>
          </div>
        </div>
        <button type="submit">Add</button>
      </form>
    </details>
  </div>`;
}

// ---------------------------------------------------------------------------
// The safeguarding rota (Addendum A, A5)
// ---------------------------------------------------------------------------

export interface DutyEvent {
  service: {
    id: number;
    service_date: string;
    service_time: string | null;
    title: string;
    designation: string | null;
    event_type: string | null;
  };
  duties: DutyRow[];
  coverage: DutyCoverage;
  /** Expected under-16 headcount, or null when nobody knows. */
  childrenExpected: number | null;
}

/**
 * What is coming, and whether anybody is on it.
 *
 * Red first is deliberate. This is read on a Wednesday evening by somebody
 * deciding whether they have to ring round, and the events that need ringing
 * round about are the only ones that matter — so they come first, whatever
 * order the calendar puts them in.
 */
export function adminSafeguardingPage(
  events: DutyEvent[],
  childrenPerAdult: number | null,
  message?: string
): string {
  const rank = { red: 0, amber: 1, green: 2 } as const;
  const sorted = [...events].sort(
    (a, b) =>
      rank[a.coverage.rag] - rank[b.coverage.rag] ||
      a.service.service_date.localeCompare(b.service.service_date)
  );

  const needing = events.filter((e) => e.coverage.rag !== "green").length;

  const card = (event: DutyEvent) => {
    const primary = event.duties.filter((d) => !d.is_backup);
    const backups = event.duties.filter((d) => d.is_backup);

    const forRole = (role: string, list: DutyRow[]) =>
      list
        .filter((d) => d.role === role)
        .map((d) => esc(d.display_name))
        .join(", ");

    return `<div class="card duty-card ${esc(event.coverage.rag)}">
      <h2>
        <a href="/admin/safeguarding/${event.service.id}">${esc(event.service.title)}</a>
        <span class="pill ${esc(event.coverage.rag)}">${
          event.coverage.rag === "green" ? "Covered" : event.coverage.rag === "amber" ? "Check" : "Not covered"
        }</span>
      </h2>
      <p class="muted small">${esc(prettyDate(event.service.service_date))}${
        event.service.service_time ? ` at ${esc(event.service.service_time)}` : ""
      }${event.service.designation ? ` · ${esc(event.service.designation)}` : ""}${
        event.childrenExpected !== null ? ` · about ${event.childrenExpected} children` : ""
      }</p>

      <div class="scroll"><table>
        ${DUTY_ROLES.map((role) => {
          const who = forRole(role.value, primary);
          const backup = forRole(role.value, backups);
          return `<tr>
            <td><strong>${esc(role.label)}</strong><div class="small muted">${esc(role.blurb)}</div></td>
            <td>${who || '<span class="muted">nobody</span>'}${
              backup ? `<div class="small muted">backup: ${backup}</div>` : ""
            }</td>
          </tr>`;
        }).join("")}
      </table></div>

      ${
        event.coverage.issues.length
          ? `<ul class="issues">${event.coverage.issues
              .map((i) => `<li class="${esc(i.severity)}">${esc(i.message)}</li>`)
              .join("")}</ul>`
          : ""
      }
    </div>`;
  };

  return page(
    `Duty rota — ${CHURCH.appName}`,
    `<h1>Duty rota ${betaChip()}<span class="sub">${
      needing ? `${needing} of the next ${events.length} need attention` : "everything coming up is covered"
    }</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}

     <p><a class="btn" href="/admin/safeguarding/today">Today's duty</a></p>

     ${sorted.length ? sorted.map(card).join("") : `<p class="muted">Nothing coming up.</p>`}

     <div class="card">
       <h2>Add an event</h2>
       <p class="muted">Practices, weddings, concerts and tours are not on the service app's music list
          and never will be — it publishes what is being sung, not the department's diary. Put them in
          here and they carry a rota and a register like anything else.</p>
       <form method="POST" action="/admin/safeguarding/events">
         <div class="row">
           <div class="field">
             <label for="title">What it is</label>
             <input type="text" id="title" name="title" required placeholder="Boys practice">
           </div>
           <div class="field">
             <label for="date">Date</label>
             <input type="date" id="date" name="date" required>
           </div>
           <div class="field">
             <label for="time">Time</label>
             <input type="time" id="time" name="time">
           </div>
           <div class="field">
             <label for="event_type">Kind</label>
             <select id="event_type" name="event_type">
               ${EVENT_TYPES.map(
                 (t) => `<option value="${esc(t.value)}"${t.value === "other" ? " selected" : ""}>${esc(t.label)}</option>`
               ).join("")}
             </select>
           </div>
           <div class="field">
             <label for="designation">Who is singing</label>
             <input type="text" id="designation" name="designation" placeholder="Boys">
             <span class="hint">Spelled the way the music list spells it — that is what decides whose
               names are on the register.</span>
           </div>
         </div>
         <button type="submit">Add the event</button>
       </form>
     </div>

     <div class="card">
       <h2>How many children to an adult</h2>
       <form method="POST" action="/admin/safeguarding/ratio">
         <div class="field" style="max-width:10rem">
           <label for="children_per_adult">Children per adult on duty</label>
           <input type="number" id="children_per_adult" name="children_per_adult" min="1" max="50"
                  value="${childrenPerAdult ?? ""}" placeholder="not set">
         </div>
         <p class="muted small">Left blank, the ratio is not checked at all. This app does not ship a
            figure: what is acceptable is the Minster's safeguarding policy to state, not something
            software should decide. Set it and every event above is checked against it.</p>
         <button type="submit">Save</button>
       </form>
     </div>

     <style>
       .duty-card.red { border-left: 4px solid var(--colour-pill-red-ink); }
       .duty-card.amber { border-left: 4px solid var(--colour-pill-amber-ink); }
       .duty-card h2 { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
       .issues { margin: 0.6rem 0 0; padding-left: 1.1rem; font-size: 0.9rem; }
       .issues li.red { color: var(--colour-pill-red-ink); }
       .issues li.amber { color: var(--colour-pill-amber-ink); }
     </style>`,
    { admin: true, path: "/admin/safeguarding" }
  );
}

/** One event: who is on, who could be, and what is still missing. */
export function adminDutyEventPage(
  event: DutyEvent,
  candidates: PersonRow[],
  message?: string
): string {
  const options = candidates
    .map((p) => `<option value="${p.id}">${esc(p.display_name)}</option>`)
    .join("");

  const assigned = (role: string, backup: boolean) =>
    event.duties
      .filter((d) => d.role === role && Boolean(d.is_backup) === backup)
      .map(
        (d) => `<li>
          ${esc(d.display_name)}
          ${
            d.dbs_valid_until === null
              ? ' <span class="pill grey">no DBS date</span>'
              : ""
          }
          <form method="POST" action="/admin/safeguarding/${event.service.id}" style="display:inline">
            <input type="hidden" name="action" value="remove">
            <input type="hidden" name="duty_id" value="${d.id}">
            <button type="submit" class="secondary small-btn">Take off</button>
          </form>
        </li>`
      )
      .join("");

  return page(
    `${event.service.title} — duty — ${CHURCH.appName}`,
    `<h1>${esc(event.service.title)} ${betaChip()}
       <span class="sub">${esc(prettyDate(event.service.service_date))}${
         event.service.service_time ? ` at ${esc(event.service.service_time)}` : ""
       }</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}

     ${
       event.coverage.issues.length
         ? `<div class="notice ${event.coverage.rag === "red" ? "error" : ""}">
              <ul class="issues" style="margin:0">${event.coverage.issues
                .map((i) => `<li class="${esc(i.severity)}">${esc(i.message)}</li>`)
                .join("")}</ul>
            </div>`
         : `<div class="notice ok"><p style="margin:0">Covered.</p></div>`
     }

     ${DUTY_ROLES.map(
       (role) => `<div class="card">
         <h2>${esc(role.label)}</h2>
         <p class="muted small">${esc(role.blurb)}</p>
         <ul class="duty-list">${assigned(role.value, false) || '<li class="muted">Nobody on duty.</li>'}</ul>
         ${
           assigned(role.value, true)
             ? `<p class="small muted" style="margin-bottom:0.2rem">Backup</p>
                <ul class="duty-list">${assigned(role.value, true)}</ul>`
             : ""
         }
         <form method="POST" action="/admin/safeguarding/${event.service.id}">
           <input type="hidden" name="action" value="assign">
           <input type="hidden" name="role" value="${esc(role.value)}">
           <div class="row">
             <div class="field">
               <label for="person-${esc(role.value)}">Put somebody on</label>
               <select id="person-${esc(role.value)}" name="person_id">${options}</select>
             </div>
             <div class="field">
               <label for="backup-${esc(role.value)}">As</label>
               <select id="backup-${esc(role.value)}" name="is_backup">
                 <option value="0">On duty</option>
                 <option value="1">Backup</option>
               </select>
             </div>
           </div>
           <button type="submit" ${candidates.length ? "" : "disabled"}>Add</button>
           ${
             candidates.length
               ? ""
               : `<span class="hint">Nobody on the choir list is recorded as an adult yet — anybody
                    with no school year counts as one.</span>`
           }
         </form>
       </div>`
     ).join("")}

     <p><a class="btn secondary" href="/admin/safeguarding">Back to the rota</a></p>

     <style>
       .duty-list { list-style: none; margin: 0 0 0.6rem; padding: 0; }
       .duty-list li { padding: 0.25rem 0; }
       .small-btn { font-size: 0.8rem; padding: 0.15rem 0.5rem; }
     </style>`,
    { admin: true, path: "/admin/safeguarding" }
  );
}

/**
 * Today, on a phone, in a doorway.
 *
 * One question at the top — what am I on? — then the way straight to the
 * register, then the tick. Everything else is a link. This is the screen used
 * one-handed at twenty past eight with the other hand holding a door open, and
 * the only thing it must do well is be readable at arm's length.
 */
export function adminDutyTodayPage(
  events: DutyEvent[],
  me: string,
  registerable: boolean,
  message?: string
): string {
  const mine = (event: DutyEvent) =>
    event.duties.filter((d) => d.display_name.toLowerCase() === me.toLowerCase());

  const card = (event: DutyEvent) => {
    const dismissal = event.duties.filter((d) => d.role === "dismissal" && !d.is_backup);
    const collected = dismissal.find((d) => d.all_collected_at !== null);

    return `<div class="card">
      <h2>${esc(event.service.title)}</h2>
      <p class="muted small">${
        event.service.service_time ? `${esc(event.service.service_time)} · ` : ""
      }${esc(event.service.designation ?? "")}</p>

      <div class="scroll"><table>
        ${DUTY_ROLES.map((role) => {
          const who = event.duties
            .filter((d) => d.role === role.value && !d.is_backup)
            .map((d) => esc(d.display_name))
            .join(", ");
          return `<tr><td><strong>${esc(role.label)}</strong></td>
                      <td>${who || '<span class="muted">nobody</span>'}</td></tr>`;
        }).join("")}
      </table></div>

      ${
        registerable
          ? `<p><a class="btn" href="/admin/people/register/${event.service.id}">Take the register</a></p>`
          : ""
      }

      ${
        collected
          ? `<div class="notice ok">
               <p style="margin:0"><strong>Every child under eighteen was collected.</strong>
                  Ticked by ${esc(collected.all_collected_by ?? "somebody on duty")} at
                  ${esc((collected.all_collected_at ?? "").slice(11, 16))}.</p>
             </div>`
          : dismissal.length
            ? `<form method="POST" action="/admin/safeguarding/collected">
                 <input type="hidden" name="duty_id" value="${dismissal[0]!.id}">
                 <p class="muted small">Tick this once the last child has gone. It is recorded against
                    your name and the time, and it cannot be un-ticked.</p>
                 <button type="submit" class="big">Every child under 18 has been collected</button>
               </form>`
            : `<p class="muted small">Nobody is on dismissal, so there is nothing to tick.</p>`
      }
    </div>`;
  };

  return page(
    `Today's duty — ${CHURCH.appName}`,
    `<h1>Today ${betaChip()}<span class="sub">${
      events.length ? `${events.length} ${events.length === 1 ? "event" : "events"}` : "nothing on"
    }</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}

     ${
       events.some((e) => mine(e).length)
         ? `<div class="notice">
              <p style="margin:0"><strong>You are on duty.</strong> ${events
                .flatMap((e) => mine(e).map((d) => esc(`${d.role} at ${e.service.title}`)))
                .join("; ")}.</p>
            </div>`
         : ""
     }

     ${events.length ? events.map(card).join("") : `<p class="muted">Nothing on today.</p>`}

     <p><a class="btn secondary" href="/admin/safeguarding">The whole rota</a></p>

     <style>
       button.big { font-size: 1.05rem; padding: 0.75rem 1.1rem; width: 100%; }
     </style>`,
    { admin: true, path: "/admin/safeguarding" }
  );
}

// ---------------------------------------------------------------------------
// Attendance, rates and pay (Addendum A, A4)
// ---------------------------------------------------------------------------

/**
 * The workbook's shape: per person, per month, and a percentage.
 *
 * "Possible" is how many events that person's choir was actually due at, so
 * the boys are not marked down for missing an Evensong the girls sang. A
 * percentage of null shows as a dash rather than 0%, because 0% reads as "never
 * turned up" and the truth is "was never asked".
 */
export function adminAttendancePage(
  quarter: Quarter,
  quarters: Quarter[],
  totals: PersonTotals[],
  months: string[]
): string {
  const byChoir = new Map<string, PersonTotals[]>();
  for (const t of totals) {
    const list = byChoir.get(t.choir);
    if (list) list.push(t);
    else byChoir.set(t.choir, [t]);
  }

  const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

  return page(
    `Attendance — ${CHURCH.appName}`,
    `<h1>Attendance ${betaChip()}<span class="sub">${esc(quarter.label)}</span></h1>

     <form method="GET" action="/admin/people/attendance" class="card">
       <div class="field" style="max-width:16rem">
         <label for="quarter">Quarter</label>
         <select id="quarter" name="quarter" onchange="this.form.submit()">
           ${quarters
             .map(
               (q) =>
                 `<option value="${esc(q.ref)}"${q.ref === quarter.ref ? " selected" : ""}>${esc(q.label)}</option>`
             )
             .join("")}
         </select>
       </div>
       <noscript><button type="submit">Show</button></noscript>
     </form>

     ${
       totals.length
         ? CHOIRS.filter((c) => byChoir.has(c.value))
             .map(
               (c) => `<div class="card">
                 <h2>${esc(c.label)}</h2>
                 <div class="scroll"><table>
                   <tr>
                     <th>Name</th>
                     ${months.map((m) => `<th class="num">${esc(monthLabel(m))}</th>`).join("")}
                     <th class="num">Quarter</th>
                     <th class="num">%</th>
                   </tr>
                   ${byChoir
                     .get(c.value)!
                     .map(
                       (t) => `<tr>
                         <td><a href="/admin/people/${t.person_id}">${esc(t.display_name)}</a></td>
                         ${t.months
                           .map(
                             (m) =>
                               `<td class="num">${m.possible ? `${m.present}/${m.possible}` : '<span class="muted">—</span>'}</td>`
                           )
                           .join("")}
                         <td class="num">${t.possible ? `${t.present}/${t.possible}` : '<span class="muted">—</span>'}</td>
                         <td class="num">${
                           t.percent === null ? '<span class="muted">—</span>' : `${t.percent}%`
                         }</td>
                       </tr>`
                     )
                     .join("")}
                 </table></div>
               </div>`
             )
             .join("")
         : `<p class="muted">Nothing recorded in this quarter.</p>`
     }

     <p>
       <a class="btn secondary" href="/admin/people/pay?quarter=${esc(quarter.ref)}">Work out the pay</a>
       <a class="btn secondary" href="/admin/people/attendance.csv?quarter=${esc(quarter.ref)}">Export this</a>
     </p>`,
    { admin: true, path: "/admin/people" }
  );
}

/**
 * The pay run, on screen before it is a file.
 *
 * Shown first because a spreadsheet that appears in the downloads folder is a
 * spreadsheet nobody checked. The per-person breakdown is here, the total is
 * here, and anything that could not be priced is called out in red — a service
 * sung before a rate was set has no rate, and treating that as nought would
 * short-change somebody without anybody noticing.
 */
export function adminPayPage(
  run: PayRun,
  quarters: Quarter[],
  rates: RateRow[],
  message?: string
): string {
  const rateLine = (role: (typeof RATE_ROLES)[number]) => {
    const current = rates.filter((r) => r.role === role.value);
    return `<tr>
      <td><strong>${esc(role.label)}</strong><div class="small muted">${esc(role.blurb)}</div></td>
      <td>${
        current.length
          ? current
              .map(
                (r) =>
                  `<div>${esc(pounds(r.amount_pence))} <span class="muted small">from ${esc(
                    prettyDate(r.effective_from)
                  )}</span>
                   <form method="POST" action="/admin/people/rates" style="display:inline">
                     <input type="hidden" name="action" value="delete">
                     <input type="hidden" name="id" value="${r.id}">
                     <button type="submit" class="secondary small-btn">Remove</button>
                   </form></div>`
              )
              .join("")
          : '<span class="muted">no rate set</span>'
      }</td>
    </tr>`;
  };

  return page(
    `Pay — ${CHURCH.appName}`,
    `<h1>Pay ${betaChip()}<span class="sub">${esc(run.quarter.label)}</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}

     <form method="GET" action="/admin/people/pay" class="card">
       <div class="field" style="max-width:16rem">
         <label for="quarter">Quarter</label>
         <select id="quarter" name="quarter" onchange="this.form.submit()">
           ${quarters
             .map(
               (q) =>
                 `<option value="${esc(q.ref)}"${q.ref === run.quarter.ref ? " selected" : ""}>${esc(q.label)}</option>`
             )
             .join("")}
         </select>
       </div>
       <noscript><button type="submit">Show</button></noscript>
     </form>

     ${
       run.unrated
         ? `<div class="notice error">
              <p style="margin:0"><strong>${run.unrated} ${
                run.unrated === 1 ? "attendance has" : "attendances have"
              } no rate.</strong> They were sung on days no rate was in force, so they are counted below
                 and priced at nothing. Set a rate with an earlier start date and this figure changes.</p>
            </div>`
         : ""
     }

     <div class="card">
       <h2>What each person is owed</h2>
       ${
         run.lines.length
           ? `<div class="scroll"><table>
                <tr><th>Name</th><th>Choir</th><th class="num">Services</th><th class="num">Weddings</th>
                    <th class="num">Not priced</th><th class="num">Due</th></tr>
                ${run.lines
                  .map(
                    (l) => `<tr>
                      <td>${esc(l.display_name)}</td>
                      <td>${esc(CHOIRS.find((c) => c.value === l.choir)?.label ?? l.choir)}</td>
                      <td class="num">${l.services}</td>
                      <td class="num">${l.weddings}</td>
                      <td class="num">${l.unrated || ""}</td>
                      <td class="num">${esc(pounds(l.pence))}</td>
                    </tr>`
                  )
                  .join("")}
                <tr><td colspan="5"><strong>Total</strong></td>
                    <td class="num"><strong>${esc(pounds(run.totalPence))}</strong></td></tr>
              </table></div>
              <p><a class="btn" href="/admin/people/pay.csv?quarter=${esc(run.quarter.ref)}">Download this as a spreadsheet</a></p>
              <p class="muted small">A CSV, which opens in Excel and in Numbers. Downloading it is
                 recorded in the activity log with a fingerprint of the file, so a printed pay run can
                 always be matched back to the moment it was made.</p>`
           : `<p class="muted">Nobody was marked present in this quarter.</p>`
       }
     </div>

     <div class="card">
       <h2>Rates</h2>
       <p class="muted">A rate is a row with a date, not a figure that gets edited over: last quarter's
          pay still works out at last quarter's rate, and a quarter that straddles a change comes out
          right on its own. Nothing is set to start with — the figures are yours.</p>
       <div class="scroll"><table>${RATE_ROLES.map(rateLine).join("")}</table></div>

       <form method="POST" action="/admin/people/rates">
         <input type="hidden" name="action" value="add">
         <div class="row">
           <div class="field">
             <label for="role">What for</label>
             <select id="role" name="role">
               ${RATE_ROLES.map((r) => `<option value="${esc(r.value)}">${esc(r.label)}</option>`).join("")}
             </select>
           </div>
           <div class="field">
             <label for="amount">Amount</label>
             <input type="text" id="amount" name="amount" placeholder="4.50" required inputmode="decimal">
             <span class="hint">In pounds. Held as whole pence, so nothing rounds.</span>
           </div>
           <div class="field">
             <label for="effective_from">In force from</label>
             <input type="date" id="effective_from" name="effective_from" required>
           </div>
         </div>
         <button type="submit">Set the rate</button>
       </form>
     </div>

     <style>
       .small-btn { font-size: 0.8rem; padding: 0.15rem 0.5rem; }
     </style>`,
    { admin: true, path: "/admin/people" }
  );
}

// ---------------------------------------------------------------------------
// Exports (Addendum A, A6)
// ---------------------------------------------------------------------------

export interface ExportOption {
  href: string;
  label: string;
  blurb: string;
  /** True for the one export that carries parents' telephone numbers. */
  contacts?: boolean;
}

/**
 * Everything that can be taken out of the app, in one place.
 *
 * The list is filtered by the same two rules as the front page — the module
 * has to be on, and the reader has to hold a role that may reach it — so a
 * librarian sees the catalogue exports and nothing about a person.
 *
 * The contacts export is set apart deliberately, in its own card and its own
 * colour, and it is the only export in the app that carries a telephone
 * number. Every other person export leaves them out entirely, which is what
 * makes this one worth marking out.
 */
export function adminExportsPage(
  options: ExportOption[],
  contactsExport: ExportOption | null,
  message?: string
): string {
  const row = (o: ExportOption) => `<tr>
    <td><strong>${esc(o.label)}</strong><div class="small muted">${esc(o.blurb)}</div></td>
    <td><a class="btn secondary" href="${o.href}">Download</a></td>
  </tr>`;

  return page(
    `Exports — ${CHURCH.appName}`,
    `<h1>Exports ${betaChip()}<span class="sub">Taking the data out</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}

     <div class="notice">
       <p style="margin:0">All of these are CSV, which opens in Excel and in Numbers. Every download is
          recorded in the activity log. A file on a laptop has none of the protections this app has —
          keep it where you would keep a printed register, and delete it when you are done with it.</p>
     </div>

     <div class="card">
       <h2>What you can take out</h2>
       ${
         options.length
           ? `<div class="scroll"><table>${options.map(row).join("")}</table></div>`
           : `<p class="muted">Nothing to export — the modules that would have something in them are
                switched off.</p>`
       }
     </div>

     ${
       contactsExport
         ? `<div class="card contacts">
              <h2>Parents' contact details</h2>
              <p><strong>This is the only export in this app that contains a telephone number.</strong>
                 Every other one leaves them out, on purpose. Downloading it is recorded against your
                 name with a fingerprint of the file.</p>
              <p class="muted small">A spreadsheet of children's parents' telephone numbers is the
                 single most sensitive thing this app can produce. Take it only when you have a reason
                 to, keep it off anything shared, and delete it afterwards.</p>
              <p><a class="btn" href="${contactsExport.href}">Download the contacts</a></p>
            </div>`
         : ""
     }

     <style>
       .card.contacts { border-left: 4px solid var(--colour-pill-red-ink); }
     </style>`,
    { admin: true, path: "/admin/export" }
  );
}

// ---------------------------------------------------------------------------
// The workbook importer (Addendum A, A7)
// ---------------------------------------------------------------------------

/**
 * Upload a workbook, and what has been uploaded before.
 *
 * The screen says what will and will not happen in the plainest terms
 * available, because the fear this has to answer is "am I about to overwrite
 * the choir list?" — and the answer is no, nothing at all is written until the
 * next screen.
 */
export function adminImportWorkbookPage(
  batches: BatchRow[],
  message?: string,
  error?: string
): string {
  return page(
    `Import a workbook — ${CHURCH.appName}`,
    `<h1>Import a workbook ${betaChip()}<span class="sub">Reading the department's register</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}
     ${error ? `<div class="notice error"><p style="margin:0">${esc(error)}</p></div>` : ""}

     <div class="notice">
       <p style="margin:0"><strong>Nothing is added to the choir until you say so.</strong> The file is
          read, and what it found is shown to you on the next screen, row by row, with anything it could
          not make sense of marked. You then tick what to keep. Until you do, nothing has changed.</p>
     </div>

     <div class="card">
       <h2>The file</h2>
       <form method="POST" action="/admin/people/import" enctype="multipart/form-data">
         <div class="field">
           <label for="workbook">The workbook</label>
           <input type="file" id="workbook" name="workbook" accept=".xlsx" required>
           <span class="hint">An Excel .xlsx file. A tab named after a choir — "Girls", "Boys",
             "Consort", "JC" — is read as that group; the reader looks for a column headed Name, and
             then for School year, Joined, Surplice, Dean's, Archbishop's, Gold, and anything with
             "phone" in the heading.</span>
         </div>
         <button type="submit">Read it</button>
       </form>
       <p class="muted small"><strong>This is an early version.</strong> It is built around the shape
          the register was described as having, not around the real file — expect to look carefully at
          what it makes of the first one, and to tell ${esc(CHURCH.contact.maintainer.shortName)} what
          it got wrong.</p>
     </div>

     ${
       batches.length
         ? `<div class="card">
              <h2>Uploads so far</h2>
              <div class="scroll"><table>
                <tr><th>File</th><th>When</th><th>Who</th><th>State</th><th></th></tr>
                ${batches
                  .map(
                    (b) => `<tr>
                      <td>${esc(b.filename ?? "—")}</td>
                      <td>${esc(prettyDate(b.uploaded_at.slice(0, 10)))}</td>
                      <td class="small">${esc(b.uploaded_by ?? "—")}</td>
                      <td>${
                        b.status === "pending"
                          ? '<span class="pill amber">waiting for you</span>'
                          : b.status === "applied"
                            ? '<span class="pill green">added</span>'
                            : '<span class="pill grey">discarded</span>'
                      }</td>
                      <td>${
                        b.status === "pending"
                          ? `<a class="btn secondary" href="/admin/people/import/${b.id}">Look at it</a>`
                          : ""
                      }</td>
                    </tr>`
                  )
                  .join("")}
              </table></div>
            </div>`
         : ""
     }

     <p><a class="btn secondary" href="/admin/people">Back to the choir</a></p>`,
    { admin: true, path: "/admin/people" }
  );
}

/**
 * What the workbook was found to contain, before anything is written.
 *
 * Rows with a problem come first and are ticked off by default, because the
 * ones needing a decision are the only ones worth anybody's attention and a
 * page of four hundred clean rows buries them. Everything clean is ticked on.
 */
export function adminImportReviewPage(
  batch: BatchRow,
  rows: Array<{ id: number; sheet: string | null; rowNumber: number | null; issue: string | null; person: ProposedPerson }>,
  message?: string
): string {
  const withIssues = rows.filter((r) => r.issue);
  const clean = rows.filter((r) => !r.issue);

  const row = (r: (typeof rows)[number]) => `<tr class="${r.issue ? "flagged" : ""}">
    <td><input type="checkbox" name="accept" value="${r.id}" ${r.issue ? "" : "checked"}></td>
    <td>${esc(r.person.displayName)}</td>
    <td>${esc(CHOIRS.find((c) => c.value === r.person.choir)?.label ?? "—")}</td>
    <td>${esc(schoolYearLabel(r.person.schoolYear))}</td>
    <td class="small">${esc(r.person.joinedOn ?? "")}</td>
    <td class="small">${r.person.contacts.length ? `${r.person.contacts.length} contact${r.person.contacts.length === 1 ? "" : "s"}` : ""}</td>
    <td class="small muted">${esc(r.sheet ?? "")}${r.rowNumber ? ` row ${r.rowNumber}` : ""}</td>
    <td class="small">${r.issue ? `<span class="pill amber">${esc(r.issue)}</span>` : ""}</td>
  </tr>`;

  const table = (list: typeof rows) => `<div class="scroll"><table>
    <tr><th></th><th>Name</th><th>Choir</th><th>School year</th><th>Joined</th><th>Contacts</th>
        <th>From</th><th>Problem</th></tr>
    ${list.map(row).join("")}
  </table></div>`;

  return page(
    `${batch.filename ?? "Workbook"} — ${CHURCH.appName}`,
    `<h1>What the workbook says ${betaChip()}
       <span class="sub">${rows.length} ${rows.length === 1 ? "row" : "rows"} read from ${esc(
         batch.filename ?? "the file"
       )}</span></h1>
     ${message ? `<div class="notice ok"><p style="margin:0">${esc(message)}</p></div>` : ""}

     <div class="notice">
       <p style="margin:0"><strong>Nothing has been added yet.</strong> Tick the rows to keep and press
          the button at the bottom. The numbers in the "Contacts" column are added alongside the person
          they belong to. Anything left unticked is not added, and <strong>this upload is finished
          either way</strong> — if you want the rest, put the file right and read it again.</p>
     </div>

     <form method="POST" action="/admin/people/import/${batch.id}">
       ${
         withIssues.length
           ? `<div class="card">
                <h2>${withIssues.length} ${withIssues.length === 1 ? "row needs" : "rows need"} a look</h2>
                <p class="muted">These are unticked. Tick one to add it as it stands — you can put the
                   details right afterwards on the person's own page.</p>
                ${table(withIssues)}
              </div>`
           : ""
       }

       ${
         clean.length
           ? `<div class="card">
                <h2>${clean.length} ${clean.length === 1 ? "row" : "rows"} read cleanly</h2>
                ${table(clean)}
              </div>`
           : `<p class="muted">Nothing in the file read cleanly.</p>`
       }

       <div class="card">
         <button type="submit" name="action" value="apply" class="confirm">Add the ticked rows</button>
         <button type="submit" name="action" value="discard" class="secondary">Throw this upload away</button>
         <p class="muted small">Throwing it away deletes what was read, names and all. The activity log
            keeps a line saying you did it, and nothing else.</p>
       </div>
     </form>

     <style>
       tr.flagged td { background: var(--colour-pill-amber-bg); }
       td .pill { white-space: normal; }
     </style>`,
    { admin: true, path: "/admin/people" }
  );
}
