/**
 * The admin gate: modules and roles.
 *
 * These are the tests that matter most in the repository, because what they
 * check is not a calculation but a boundary. A path that falls through the
 * module table renders a screen that was meant to be dark; a path that falls
 * through the role table hands a librarian the register. Neither shows up as a
 * broken page — the app carries on working, more openly than intended — so the
 * only thing that catches it is a test that reads the routes out of
 * `src/index.ts` and insists every one of them is accounted for.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MODULES,
  MODULE_KEYS,
  defaultModuleState,
  isModuleKey,
  moduleForPath,
  settingKeyFor,
  type ModuleKey,
} from "../src/modules";
import {
  ROLES,
  ROLE_BLURBS,
  ROLE_LABELS,
  hasAnyRole,
  isRole,
  permits,
  requiredRolesFor,
  type Role,
} from "../src/roles";

/** Every admin path `src/index.ts` actually registers a handler for. */
function declaredAdminRoutes(): string[] {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const routes = new Set<string>();
  for (const match of source.matchAll(/app\.(?:get|post|put|delete)\(\s*"(\/admin[^"]*)"/g)) {
    routes.add(match[1]!);
  }
  return [...routes].sort();
}

/** `/admin/piece/:id` → `/admin/piece/1`: a path the gate would really see. */
function concrete(route: string): string {
  return route.replace(/:[A-Za-z]+/g, "1");
}

describe("modules", () => {
  it("names all eight, and the migration writes a flag for each", () => {
    expect(MODULE_KEYS.length).toBe(8);
    expect(MODULES.map((m) => m.key).sort()).toEqual([...MODULE_KEYS].sort());

    const sql = readFileSync(
      join(import.meta.dirname, "..", "migrations", "0003_addendum_a.sql"),
      "utf8"
    );
    for (const m of MODULES) {
      expect(sql, `${settingKeyFor(m.key)} has no row in migration 0003`).toContain(
        `'${settingKeyFor(m.key)}'`
      );
    }
  });

  // Dark by default is the whole point. A module that holds a child's name and
  // ships on is the failure this test exists to prevent.
  it("ships everything that holds a person's name switched off", () => {
    const state = defaultModuleState();
    for (const m of MODULES) {
      if (m.personal) expect(state[m.key], `${m.key} holds names and must ship off`).toBe(false);
    }
    expect(state.library).toBe(true);
    expect(state.services).toBe(true);
  });

  it("the code's defaults and the migration's agree", () => {
    const sql = readFileSync(
      join(import.meta.dirname, "..", "migrations", "0003_addendum_a.sql"),
      "utf8"
    );
    const state = defaultModuleState();
    for (const m of MODULES) {
      const expected = state[m.key] ? "on" : "off";
      expect(sql, `migration 0003 disagrees with the code about ${m.key}`).toMatch(
        new RegExp(`'${settingKeyFor(m.key).replace(".", "\\.")}'\\s*,\\s*'${expected}'`)
      );
    }
  });

  it("recognises exactly the eight keys", () => {
    for (const key of MODULE_KEYS) expect(isModuleKey(key)).toBe(true);
    for (const key of ["", "Library", "module.people", "everything"]) expect(isModuleKey(key)).toBe(false);
  });

  // The register is a separate switch from the choir list it sits inside, so
  // the longer prefix has to win. Getting this wrong makes the whole of
  // /admin/people go dark or light together.
  it("gives the register its own switch, inside the choir list", () => {
    expect(moduleForPath("/admin/people")).toBe("people");
    expect(moduleForPath("/admin/people/4")).toBe("people");
    expect(moduleForPath("/admin/people/register/12")).toBe("attendance");
    expect(moduleForPath("/admin/people/register/12/7")).toBe("attendance");
  });

  // A prefix must match whole segments. `/admin/newsletter` caught by the
  // `/admin/new` rule would go dark for a reason nobody could find.
  it("matches on a whole path segment, never mid-word", () => {
    expect(moduleForPath("/admin/new")).toBe("library");
    expect(moduleForPath("/admin/new/anything")).toBe("library");
    expect(moduleForPath("/admin/newsletter")).toBeNull();
    expect(moduleForPath("/admin/peoplemover")).toBeNull();
  });

  it("leaves the front page and the app's own screens outside every module", () => {
    for (const path of ["/admin", "/admin/settings", "/admin/modules", "/admin/roles", "/admin/activity"]) {
      expect(moduleForPath(path), `${path} should belong to no module`).toBeNull();
    }
  });
});

describe("roles", () => {
  it("names three, each with a label and a description", () => {
    expect([...ROLES]).toEqual(["librarian", "music_staff", "safeguarding"]);
    for (const r of ROLES) {
      expect(ROLE_LABELS[r]).toBeTruthy();
      expect(ROLE_BLURBS[r]).toBeTruthy();
    }
  });

  it("recognises exactly the three", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true);
    for (const r of ["", "admin", "Librarian", "music-staff"]) expect(isRole(r)).toBe(false);
  });

  it("holds nothing until a role is granted", () => {
    expect(hasAnyRole([])).toBe(false);
    expect(hasAnyRole(["librarian"])).toBe(true);
  });

  it("satisfies a requirement with any one of the roles it names", () => {
    expect(permits(["librarian"], ["librarian", "music_staff"])).toBe(true);
    expect(permits(["safeguarding"], ["librarian", "music_staff"])).toBe(false);
    expect(permits([], ["librarian"])).toBe(false);
    expect(permits(["music_staff"], ["music_staff"])).toBe(true);
  });

  // The point of the whole file: six people hold a Librarian policy in Access
  // so the library can be catalogued, and none of that is a reason to hand them
  // a child's name.
  it("keeps a librarian out of everything about a person", () => {
    for (const path of [
      "/admin/people",
      "/admin/people/4",
      "/admin/people/register/12",
      "/admin/people/register/12/7",
      "/admin/people/contact/4",
      "/admin/safeguarding",
      "/admin/safeguarding/today",
    ]) {
      expect(permits(["librarian"], requiredRolesFor(path)), `a librarian can reach ${path}`).toBe(false);
    }
  });

  // The one door inside /admin/people that safeguarding may open: somebody on
  // dismissal duty with an uncollected child needs the parent's number, and
  // sending them to find music staff first is the wrong answer. It is still
  // one door — not the choir list, not the register, not a person's record.
  it("gives safeguarding the parent contacts and nothing else under /admin/people", () => {
    expect(permits(["safeguarding"], requiredRolesFor("/admin/people/contact/4"))).toBe(true);
    for (const path of ["/admin/people", "/admin/people/4", "/admin/people/register/12"]) {
      expect(permits(["safeguarding"], requiredRolesFor(path)), `safeguarding can reach ${path}`).toBe(
        false
      );
    }
  });

  it("keeps a librarian out of the app's own settings", () => {
    for (const path of ["/admin/settings", "/admin/modules", "/admin/roles", "/admin/activity"]) {
      expect(permits(["librarian"], requiredRolesFor(path)), `a librarian can reach ${path}`).toBe(false);
    }
  });

  it("lets a librarian do the library and the music lists", () => {
    for (const path of [
      "/admin/new",
      "/admin/search",
      "/admin/review",
      "/admin/piece/12",
      "/admin/labels",
      "/admin/scans",
      "/admin/services",
      "/admin/loans",
    ]) {
      expect(permits(["librarian"], requiredRolesFor(path)), `a librarian cannot reach ${path}`).toBe(true);
    }
  });

  it("gives safeguarding the rota and nothing else", () => {
    expect(permits(["safeguarding"], requiredRolesFor("/admin/safeguarding"))).toBe(true);
    for (const path of ["/admin/people", "/admin/search", "/admin/settings", "/admin/roles"]) {
      expect(permits(["safeguarding"], requiredRolesFor(path)), `safeguarding can reach ${path}`).toBe(false);
    }
  });

  it("lets music staff everywhere — there has to be somebody who can", () => {
    for (const route of declaredAdminRoutes()) {
      expect(
        permits(["music_staff"], requiredRolesFor(concrete(route))),
        `music staff cannot reach ${route}`
      ).toBe(true);
    }
  });

  it("lets any single role reach the front page, so nobody lands on a refusal", () => {
    for (const r of ROLES) expect(permits([r], requiredRolesFor("/admin"))).toBe(true);
  });

  // A route nobody remembered to add to the table must be locked down, not
  // open. This is the difference between forgetting being a visible mistake
  // and forgetting being a silent hole.
  it("fails closed on a path it has never heard of", () => {
    for (const path of ["/admin/whatever", "/admin/pay/2026-Q1", "/admin/nonsense/deep/path"]) {
      expect(requiredRolesFor(path)).toEqual(["music_staff"]);
      expect(permits(["librarian"], requiredRolesFor(path))).toBe(false);
      expect(permits(["safeguarding"], requiredRolesFor(path))).toBe(false);
    }
  });

  it("never leaves a path with no way in at all", () => {
    for (const route of declaredAdminRoutes()) {
      expect(requiredRolesFor(concrete(route)).length, `${route} is unreachable`).toBeGreaterThan(0);
    }
  });
});

describe("every admin route the app declares", () => {
  const routes = declaredAdminRoutes();

  it("there are some, so this file is testing something", () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  // A2: a second and tighter Cloudflare Access application will be scoped to
  // these two prefixes. A route that renders a child's name from outside them
  // would sit outside that application without anybody noticing.
  it("renders a person only under /admin/people or /admin/safeguarding", () => {
    const PERSONAL: readonly ModuleKey[] = MODULES.filter((m) => m.personal).map((m) => m.key);
    for (const route of routes) {
      const module = moduleForPath(concrete(route));
      if (module && PERSONAL.includes(module)) {
        expect(
          route.startsWith("/admin/people") || route.startsWith("/admin/safeguarding"),
          `${route} holds person data but sits outside the two prefixes Access will be scoped to`
        ).toBe(true);
      }
    }
  });

  // The other half of the same rule, read the other way round: nothing under
  // those two prefixes may be anything but a person module.
  it("puts nothing under those prefixes that is not about a person", () => {
    for (const route of routes) {
      if (!route.startsWith("/admin/people") && !route.startsWith("/admin/safeguarding")) continue;
      const module = moduleForPath(concrete(route));
      expect(module, `${route} belongs to no module and so can never be switched off`).not.toBeNull();
      expect(MODULES.find((m) => m.key === module)!.personal).toBe(true);
    }
  });

  // Anything about a person must be behind a switch that ships off. A route
  // that belongs to no module is on for ever.
  it("puts every route about a person behind a module that ships off", () => {
    for (const route of routes) {
      if (!route.startsWith("/admin/people") && !route.startsWith("/admin/safeguarding")) continue;
      const module = moduleForPath(concrete(route))!;
      expect(defaultModuleState()[module], `${route} is on by default`).toBe(false);
    }
  });

  // The register was at /admin/register before Addendum A. If it ever comes
  // back, it is outside the prefix Access will be scoped to.
  it("has moved the register inside /admin/people", () => {
    for (const route of routes) {
      expect(route.startsWith("/admin/register"), `${route} is outside /admin/people`).toBe(false);
    }
    expect(routes).toContain("/admin/people/register/:serviceId");
    expect(routes).toContain("/admin/people/register/:serviceId/:personId");
  });
});
