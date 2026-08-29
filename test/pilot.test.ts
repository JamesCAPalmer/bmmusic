/**
 * Build 3 — the term-one pilot.
 *
 * This build added almost nothing and moved a great deal, which is the shape of
 * change most likely to break something quietly. Three things could go wrong
 * without anybody noticing until the first Thursday of term:
 *
 *   - **A door lost in the move.** Twenty-three tiles became six plus a drawer.
 *     If a screen is on neither the strip, nor Today, nor More, it is
 *     unreachable — the route still answers, and nobody can find it. So the
 *     last block below reads the routes out of `src/index.ts`, exactly as
 *     `test/gate.test.ts` does, and insists every one of them is linked from
 *     somewhere a person could actually click.
 *
 *   - **A tab or a tile offered to somebody who may not have it.** The chrome
 *     is now filtered by the same gate that admits the request. A filter that
 *     is subtly wrong hands a librarian a door to the register that answers
 *     403, which teaches them the app is broken.
 *
 *   - **The register losing its meaning.** It is the screen the pilot is judged
 *     on, and its states have to be told apart without colour.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { adminTabs, browsePage, categoryGlyph, loginPage, nothingYet, type AdminGate } from "../src/ui";
import {
  adminGuidePage,
  adminMorePage,
  adminPeoplePage,
  adminRegisterPage,
  adminSafeguardingPage,
  adminTodayPage,
  type AdminQueueCounts,
  type TodayEvent,
} from "../src/ui-admin";
import { defaultModuleState, moduleForPath, MODULE_KEYS, type ModuleState } from "../src/modules";
import { permits, requiredRolesFor, ROLES, type Role } from "../src/roles";
import { preselectedGroup, registerGroups, type RegisterRow } from "../src/people";
import type { CatalogueStats } from "../src/catalogue";

const INDEX_SOURCE = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");

/** Everything switched on, which is what the pilot runs with bar three. */
function allModules(): ModuleState {
  const state = {} as Record<string, boolean>;
  for (const key of MODULE_KEYS) state[key] = true;
  return state as ModuleState;
}

function gate(roles: Role[], modules: ModuleState = allModules()): AdminGate {
  return { modules, roles };
}

const NO_QUEUES: AdminQueueCounts = {
  toReview: 0,
  musicLines: 0,
  pendingScans: 0,
  openFeedback: 0,
  openRepairs: 0,
  dueRecount: 0,
};

const STATS: CatalogueStats = {
  pieces: 512,
  reviewed: 200,
  withAccession: 180,
  counted: 90,
  copiesUsable: 4000,
  openRepairs: 3,
  flagged: 12,
};

/** Every href an admin page offers, in source order. */
function hrefsIn(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
}

// ---------------------------------------------------------------------------
// The tab strip
// ---------------------------------------------------------------------------

describe("the admin tab strip", () => {
  it("is never more than six, whoever is reading", () => {
    for (const roles of [["librarian"], ["music_staff"], ["safeguarding"], [...ROLES]] as Role[][]) {
      expect(adminTabs(gate(roles)).length).toBeLessThanOrEqual(6);
    }
  });

  it("gives music staff with everything on the whole six", () => {
    const tabs = adminTabs(gate(["music_staff"]));
    expect(tabs.map((t) => t.href)).toEqual([
      "/admin",
      "/admin/review",
      "/admin/search",
      "/admin/people",
      "/admin/safeguarding",
      "/admin/more",
    ]);
  });

  // The point of filtering at all: six people hold a Librarian policy in Access
  // so the library can be catalogued, and none of that is a reason to show them
  // a door to the choir.
  it("shows a librarian no way to the choir or the rota", () => {
    const hrefs = adminTabs(gate(["librarian"])).map((t) => t.href);
    expect(hrefs).not.toContain("/admin/people");
    expect(hrefs).not.toContain("/admin/safeguarding");
    expect(hrefs).toContain("/admin/review");
    expect(hrefs).toContain("/admin/search");
  });

  it("shows somebody on the rota nothing of the catalogue", () => {
    const hrefs = adminTabs(gate(["safeguarding"])).map((t) => t.href);
    expect(hrefs).toEqual(["/admin", "/admin/safeguarding", "/admin/more"]);
  });

  // Dark means dark: a module that is off takes its tab with it, whoever holds
  // whatever role. This is the same rule the middleware answers 404 with.
  it("drops a tab whose module is switched off", () => {
    const hrefs = adminTabs(gate(["music_staff"], defaultModuleState())).map((t) => t.href);
    expect(hrefs).not.toContain("/admin/people");
    expect(hrefs).not.toContain("/admin/safeguarding");
    expect(hrefs).toContain("/admin/review");
  });

  // Today and More need no module and no particular role, which is why they are
  // the floor a page that forgot to pass a gate falls back to.
  it("falls back to the two doors anybody may open", () => {
    expect(adminTabs(undefined).map((t) => t.href)).toEqual(["/admin", "/admin/more"]);
  });

  it("leaves somebody with no role at all no strip to mislead them", () => {
    expect(adminTabs(gate([]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

const EVENSONG: TodayEvent = {
  service: {
    id: 12,
    title: "Choral Evensong",
    service_date: "2026-09-03",
    service_time: "17:30",
    designation: "Boys",
  },
  duty: [
    { label: "Robing", names: ["Sue Wheeldon"] },
    { label: "General", names: [] },
    { label: "Dismissal", names: ["James Palmer"] },
  ],
  registerHref: "/admin/people/register/12",
};

describe("Today", () => {
  it("says TODAY loudly when the next thing is today", () => {
    const html = adminTodayPage(gate(["music_staff"]), EVENSONG, NO_QUEUES, true, false, "2026-09-03");
    expect(html).toContain("Today</span>");
    expect(html).toContain("Choral Evensong");
  });

  it("says the date, not TODAY, when it is not today", () => {
    const html = adminTodayPage(gate(["music_staff"]), EVENSONG, NO_QUEUES, true, false, "2026-09-01");
    expect(html).toContain("3 September 2026");
    expect(html).not.toContain('class="pill red today"');
  });

  // One tap to the register is the whole definition of done for the pilot.
  it("puts the register one tap from the front page", () => {
    const html = adminTodayPage(gate(["music_staff"]), EVENSONG, NO_QUEUES, true, false, "2026-09-03");
    expect(html).toContain('href="/admin/people/register/12"');
    expect(html).toContain("Open the register");
  });

  it("names the gap in the cover rather than leaving it blank", () => {
    const html = adminTodayPage(gate(["music_staff"]), EVENSONG, NO_QUEUES, true, false, "2026-09-03");
    expect(html).toContain("Sue Wheeldon");
    expect(html).toContain("nobody yet");
  });

  // A tile reading "0 scans sent in" is furniture, and furniture teaches people
  // to stop reading the section it is in.
  it("draws no queue tile with nothing behind it, and no heading either", () => {
    const html = adminTodayPage(gate(["music_staff"]), EVENSONG, NO_QUEUES, true, false, "2026-09-03");
    expect(html).not.toContain("Waiting for you");
    expect(html).not.toContain("Draft entries");
  });

  it("draws the queues that do have something behind them", () => {
    const html = adminTodayPage(
      gate(["music_staff"]),
      EVENSONG,
      { ...NO_QUEUES, toReview: 41 },
      true,
      false,
      "2026-09-03"
    );
    expect(html).toContain("Waiting for you");
    expect(html).toContain("41");
    expect(html).toContain('href="/admin/review"');
  });

  it("offers at most six things to do, and More is always one of them", () => {
    for (const roles of [["librarian"], ["music_staff"], ["safeguarding"]] as Role[][]) {
      const html = adminTodayPage(gate(roles), null, NO_QUEUES, true, false, "2026-09-03");
      const acts = [...html.matchAll(/class="tile act"/g)];
      expect(acts.length, `${roles.join()} sees ${acts.length} actions`).toBeLessThanOrEqual(6);
      expect(html).toContain('href="/admin/more"');
    }
  });

  // The definition of done says it in as many words: an admin with only the
  // librarian role never sees choir tiles.
  it("shows a librarian no tile to the choir or the rota", () => {
    const html = adminTodayPage(
      gate(["librarian"]),
      EVENSONG,
      { ...NO_QUEUES, toReview: 4 },
      true,
      false,
      "2026-09-03"
    );
    const hrefs = hrefsIn(html);
    expect(hrefs).not.toContain("/admin/people");
    expect(hrefs).not.toContain("/admin/safeguarding");
    expect(hrefs).not.toContain("/admin/people/register/12");
  });

  it("says what to do when the diary is empty, rather than nothing at all", () => {
    const html = adminTodayPage(gate(["music_staff"]), null, NO_QUEUES, true, false, "2026-09-03");
    expect(html).toContain("Nothing in the diary");
  });

  it("shows the welcome card once asked to, and not otherwise", () => {
    const on = adminTodayPage(gate(["music_staff"]), null, NO_QUEUES, true, true, "2026-09-03");
    const off = adminTodayPage(gate(["music_staff"]), null, NO_QUEUES, true, false, "2026-09-03");
    expect(on).toContain("replaces the register spreadsheet and the emailed rota");
    expect(on).toContain('action="/admin/welcome"');
    expect(on).toContain('href="/admin/guide"');
    expect(off).not.toContain('action="/admin/welcome"');
  });
});

// ---------------------------------------------------------------------------
// More, and the promise that nothing was deleted
// ---------------------------------------------------------------------------

describe("More", () => {
  it("shows a librarian the library and none of the choir", () => {
    const hrefs = hrefsIn(adminMorePage(gate(["librarian"]), STATS));
    expect(hrefs).toContain("/admin/labels");
    expect(hrefs).toContain("/admin/reports");
    expect(hrefs).not.toContain("/admin/people");
    expect(hrefs).not.toContain("/admin/settings");
    expect(hrefs).not.toContain("/admin/people/pay");
  });

  it("draws no heading with nothing under it", () => {
    const html = adminMorePage(gate(["safeguarding"]), STATS);
    expect(html).not.toContain("<h2>The library</h2>");
    expect(html).toContain("/admin/safeguarding");
  });

  // The accession run and the statistics moved off the front page and must
  // still be somewhere.
  it("keeps the accession run and the figures", () => {
    const html = adminMorePage(gate(["music_staff"]), STATS);
    expect(html).toContain('action="/admin/accessions"');
    expect(html).toContain("pieces catalogued");
  });

  /**
   * The one that guards the whole build.
   *
   * Every screen that used to be a tile or a tab must still be reachable by
   * clicking. A route that answers but is linked from nowhere is a feature that
   * has been deleted without anybody deciding to delete it.
   */
  it("leaves no admin screen unreachable by clicking", () => {
    const routes = [
      ...new Set(
        [...INDEX_SOURCE.matchAll(/app\.get\(\s*"(\/admin[^"]*)"/g)].map((m) => m[1]!)
      ),
    ].filter((r) => !r.includes(":"));

    const staff = gate([...ROLES]);
    const reachable = new Set([
      ...adminTabs(staff).map((t) => t.href),
      ...hrefsIn(adminMorePage(staff, STATS)),
      ...hrefsIn(adminTodayPage(staff, EVENSONG, NO_QUEUES, true, false, "2026-09-03")),
    ]);

    /**
     * Reached from a screen of its own rather than from the navigation, and
     * deliberately so. The exports all hang off `/admin/export`; today's duty
     * hangs off the rota; the intake form is the same form as `/admin/new`.
     */
    const linkedElsewhere = new Set([
      "/admin/search/export.csv",
      "/admin/services/export.csv",
      "/admin/people/export.csv",
      "/admin/people/contacts.csv",
      "/admin/safeguarding/export.csv",
      "/admin/people/attendance.csv",
      "/admin/people/pay.csv",
      "/admin/safeguarding/today",
      "/admin/intake",
      // Not a screen at all: the music-list matcher asks it for candidates.
      "/admin/api/match-candidates",
    ]);

    const lost = routes.filter((r) => !reachable.has(r) && !linkedElsewhere.has(r));
    expect(lost, "these routes answer, and nothing links to them").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The new routes and the gate
// ---------------------------------------------------------------------------

describe("the pilot's three new routes", () => {
  it("lets every role reach More, the guide and the welcome dismissal", () => {
    for (const path of ["/admin/more", "/admin/guide", "/admin/welcome"]) {
      for (const role of ROLES) {
        expect(permits([role], requiredRolesFor(path)), `${role} cannot reach ${path}`).toBe(true);
      }
    }
  });

  // They are the app explaining itself, not a part of the choir or the library,
  // so no module switch may take them away.
  it("puts them outside every module", () => {
    for (const path of ["/admin/more", "/admin/guide", "/admin/welcome"]) {
      expect(moduleForPath(path), `${path} belongs to a module`).toBeNull();
    }
  });

  it("writes the welcome flag against one person, not everybody", () => {
    const body = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf("function welcomeKeyFor"));
    expect(body.slice(0, 200)).toContain("welcome.seen.");
    expect(body.slice(0, 200)).toContain("toLowerCase()");
  });

  it("gives the guide the three jobs it promises", () => {
    const html = adminGuidePage(gate([...ROLES]));
    expect(html).toContain("Taking the register");
    expect(html).toContain("The duty rota");
    expect(html).toContain("The music library");
  });
});

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

function person(id: number, name: string, choir: string, status: string | null): RegisterRow {
  return {
    id,
    display_name: name,
    choir,
    voice_part: null,
    active: 1,
    school_year: 6,
    joined_on: null,
    surplice_awarded_on: null,
    deans_award_on: null,
    archbishops_award_on: null,
    gold_award_on: null,
    dbs_valid_until: null,
    gender: null,
    left_on: null,
    status,
    marked_by: null,
  };
}

const ROLL: RegisterRow[] = [
  person(1, "Alice", "girls", "present"),
  person(2, "Bea", "girls", null),
  person(3, "Charlie", "boys", "absent"),
  person(4, "Dev", "boys", "excused"),
  person(5, "Eve", "consort", null),
];

describe("grouping the register", () => {
  it("splits by choir, in the order the choirs are listed, and drops empty ones", () => {
    const groups = registerGroups(ROLL);
    expect(groups.map((g) => g.key)).toEqual(["boys", "girls", "consort"]);
    expect(groups.map((g) => g.rows.length)).toEqual([2, 2, 1]);
  });

  it("opens on the choir the designation names, when it names exactly one", () => {
    expect(preselectedGroup("Boys", registerGroups(ROLL))).toBe("boys");
  });

  // Pre-picking one of two would hide half a register from somebody who did not
  // ask it to, which at a door is how a child goes unmarked.
  it("opens on everybody when the designation names more than one", () => {
    expect(preselectedGroup("Boys and Girls", registerGroups(ROLL))).toBe("");
    expect(preselectedGroup(null, registerGroups(ROLL))).toBe("");
  });

  it("does not bother with a group when there is only one", () => {
    const boys = ROLL.filter((r) => r.choir === "boys");
    expect(preselectedGroup("Boys", registerGroups(boys))).toBe("");
  });
});

describe("the door register", () => {
  const service = {
    id: 12,
    title: "Choral Evensong",
    service_date: "2026-09-03",
    designation: "Boys and Girls",
  };
  const tally = { present: 1, absent: 1, excused: 1, unmarked: 2 };

  const html = adminRegisterPage(
    gate(["music_staff"]),
    service,
    registerGroups(ROLL),
    preselectedGroup(service.designation, registerGroups(ROLL)),
    tally,
    { dutyId: 7, collectedAt: null, collectedBy: null }
  );

  it("counts how far you have got", () => {
    expect(html).toContain(">3</span> of 5");
  });

  /**
   * The one that is not a nicety. A register read in a vestry doorway, in bad
   * light, by somebody colour-blind, has to tell three states apart. Colour
   * alone does not do that; a shape and a word do.
   */
  it("tells the three states apart by shape and word, not colour alone", () => {
    for (const word of ["Here", "Away", "Excused", "Not marked"]) {
      expect(html, `no row says ${word}`).toContain(`>${word}</span>`);
    }
    for (const state of ["is-present", "is-absent", "is-excused", "is-none"]) {
      expect(html, `no row is ${state}`).toContain(state);
    }
  });

  it("makes the whole row the control", () => {
    // One form and one full-width button per person, and nothing smaller to aim
    // at inside it.
    expect([...html.matchAll(/class="mark-form"/g)]).toHaveLength(ROLL.length);
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('type="checkbox"');
  });

  it("still posts an ordinary form, so a lost signal costs one tap and not the register", () => {
    expect(html).toContain('method="POST" action="/admin/people/register/12/1"');
    expect(html).toContain("form.submit()");
  });

  it("puts the collection tick on the same screen, at the bottom", () => {
    expect(html).toContain("Every child under 18 has been collected");
    expect(html).toContain('name="back" value="register:12"');
    expect(html.indexOf("Every child under 18")).toBeGreaterThan(html.indexOf("mark-form"));
  });

  it("leaves the tick off entirely when nobody is on dismissal", () => {
    const without = adminRegisterPage(
      gate(["music_staff"]),
      service,
      registerGroups(ROLL),
      "",
      tally,
      null
    );
    expect(without).not.toContain("Every child under 18 has been collected");
  });

  it("offers the workbook when there is nobody to mark", () => {
    const empty = adminRegisterPage(gate(["music_staff"]), service, [], "", {
      present: 0,
      absent: 0,
      excused: 0,
      unmarked: 0,
    }, null);
    expect(empty).toContain("Nobody is expected at this service");
    expect(empty).toContain('href="/admin/people/import"');
  });
});

// ---------------------------------------------------------------------------
// Empty states, glyphs and the sign-in page
// ---------------------------------------------------------------------------

describe("empty screens say what to do next", () => {
  it("sends an empty choir list to the workbook importer", () => {
    const html = adminPeoplePage(gate(["music_staff"]), [], false);
    expect(html).toContain("Nobody is on the choir list yet");
    expect(html).toContain('href="/admin/people/import"');
  });

  // The importer is a module of its own: offering a door that answers 404 is
  // worse than saying nothing.
  it("does not offer the importer when its module is off", () => {
    const off = { ...allModules(), people: false } as ModuleState;
    const html = adminPeoplePage(gate(["music_staff"], off), [], false);
    expect(html).toContain("Nobody is on the choir list yet");
    expect(html).not.toContain('href="/admin/people/import"');
  });

  it("sends an empty rota to the place a rota is added", () => {
    const html = adminSafeguardingPage(gate(["safeguarding"]), [], null);
    expect(html).toContain("Nothing is in the diary yet");
    expect(html).toContain('href="#add-event"');
    expect(html).toContain('id="add-event"');
  });

  it("escapes what it is given, like everything else on a page", () => {
    expect(nothingYet("Robert & <b>Sue</b>")).toContain("Robert &amp; &lt;b&gt;Sue&lt;/b&gt;");
  });
});

describe("category glyphs on the choir side", () => {
  it("draws the same shape the box label carries", () => {
    for (const code of ["A", "E", "M", "C", "R", "P", "X", "S"]) {
      const svg = categoryGlyph(code);
      expect(svg, code).toContain("<svg");
      expect(svg, code).toContain('aria-hidden="true"');
      expect(svg, code).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });

  // A piece with no category must not be given one by the picture beside it.
  it("marks an uncategorised piece as uncategorised", () => {
    expect(categoryGlyph(null)).toContain("cat-glyph none");
    expect(categoryGlyph("A")).not.toContain("none");
  });

  it("puts one before the title in a list of pieces", () => {
    const piece = {
      id: 4,
      title: "Ave verum corpus",
      composer: "Mozart",
      composer_canonical: "mozart",
      title_canonical: "ave verum corpus",
      category: "A",
      voicing: "SATB",
      accession: null,
      season: null,
      location: null,
      location_door: null,
      location_shelf: null,
      spine_state: null,
      notes: null,
      review_flag: null,
      confidence: null,
      reviewed_at: "2026-01-01",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      copies_total: null,
      copies_usable: null,
      condition: null,
      last_counted: null,
    } as unknown as Parameters<typeof browsePage>[1]["pieces"][number];

    const html = browsePage({}, { pieces: [piece], total: 1 }, {});
    expect(html).toMatch(/<svg class="cat-glyph"[\s\S]*?<a class="title"/);
  });
});

describe("signing in", () => {
  it("is kind about a wrong password, and says who to ask", () => {
    const html = loginPage(true);
    expect(html).toContain("That is not this term's password");
    expect(html).toContain("Director of Music");
  });

  it("offers to show what was typed, and only once the script has run", () => {
    const html = loginPage(false);
    expect(html).toContain('id="show-password"');
    expect(html).toContain('class="quiet small-btn hidden"');
    expect(html).not.toContain("That is not this term's password");
  });
});
