/**
 * The glyph set and the tab strip.
 *
 * Neither of these is "does it look nice", which is not a thing a test can
 * answer. They are the two ways this kind of change goes wrong silently:
 *
 *   - **A misspelled glyph name renders nothing.** `icon()` returns the empty
 *     string for a name it does not have, deliberately — a missing decoration
 *     should not take a page down. The cost of that choice is that a typo is
 *     invisible in the output, and the only way anybody notices is by looking
 *     at the right screen. So the first block below reads every `icon("…")`
 *     call out of the source and checks the name exists.
 *
 *   - **A tab pointing somewhere wrong is worse than no tab.** The strip is on
 *     every page, so one bad href is a broken link everywhere at once.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { icon, iconNames } from "../src/icons";

const SOURCES = ["ui.ts", "ui-admin.ts"] as const;

/** Read one file out of `src/`, the way `test/gate.test.ts` does. */
function read(file: string): string {
  return readFileSync(join(import.meta.dirname, "..", "src", file), "utf8");
}

describe("every glyph asked for is a glyph we have", () => {
  it("finds no misspelled icon name anywhere in the pages", () => {
    const known = new Set(iconNames());
    const missing: string[] = [];

    for (const file of SOURCES) {
      const source = read(file);
      for (const match of source.matchAll(/\bicon\(\s*"([^"]+)"\s*\)/g)) {
        const name = match[1]!;
        if (!known.has(name)) missing.push(`${file}: icon("${name}")`);
      }
    }

    expect(missing, "these render as nothing at all").toEqual([]);
  });

  it("actually draws something for every name it offers", () => {
    for (const name of iconNames()) {
      const svg = icon(name);
      expect(svg, `${name} is empty`).toContain("<svg");
      // A wrapper with no path in it is a name that looks fine in the source
      // and shows a blank square on the page.
      expect(svg.replace(/<svg[^>]*>|<\/svg>/g, "").trim().length, `${name} draws nothing`).toBeGreaterThan(0);
    }
  });

  it("returns nothing, rather than throwing, for a name it does not have", () => {
    expect(icon("no-such-glyph")).toBe("");
  });
});

describe("the glyphs behave themselves", () => {
  /**
   * Colour comes from the text, always. A hex in here would be a glyph that
   * stays dark blue on a dark page, or stays dark inside a red button — and
   * it would be found by somebody opening that one screen after dark rather
   * than by anybody reading this file.
   */
  it("names no colour of its own", () => {
    for (const name of iconNames()) {
      const svg = icon(name);
      expect(svg, `${name} carries a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,6}/);
      expect(svg, `${name} should paint with currentColor`).toContain('stroke="currentColor"');
    }
  });

  /**
   * Every glyph in this app sits beside a text label saying the same thing, so
   * a screen reader announcing it would read the label twice.
   */
  it("hides itself from screen readers", () => {
    for (const name of iconNames()) {
      expect(icon(name), `${name}`).toContain('aria-hidden="true"');
    }
  });

  /**
   * No CDN assets is a repository rule, and it is a rule for a reason: this is
   * used on a phone with one bar of signal in a cold song school. An icon that
   * fetches anything is an icon that is sometimes a blank square.
   */
  it("fetches nothing", () => {
    for (const name of iconNames()) {
      const svg = icon(name);
      expect(svg, `${name}`).not.toMatch(/https?:|url\(|<image|xlink:href/);
    }
  });
});

describe("the tab strip", () => {
  const ui = read("ui.ts");

  /** The hrefs declared in one of the two tab tables. */
  function hrefsIn(table: "CHOIR_TABS" | "ADMIN_TABS"): string[] {
    const start = ui.indexOf(`const ${table}`);
    expect(start, `${table} not found`).toBeGreaterThan(-1);
    const body = ui.slice(start, ui.indexOf("];", start));
    return [...body.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]!);
  }

  /**
   * The one that matters for more than tidiness.
   *
   * The choir side is used by children on a shared password. Every admin route
   * is gated twice over — Cloudflare Access at the edge, then roles in the
   * app — so a stray `/admin/...` in this table would not *leak* anything. It
   * would do something worse in a smaller way: put a door in front of a
   * chorister that opens onto a sign-in screen they cannot pass, on the tab
   * strip they see on every single page.
   *
   * The padlock in the masthead is the deliberate exception, and it is not in
   * this table.
   */
  it("keeps the choir's tabs off the admin side", () => {
    for (const href of hrefsIn("CHOIR_TABS")) {
      expect(href.startsWith("/admin"), `choir tab ${href} points at the admin side`).toBe(false);
    }
  });

  it("keeps the admin tabs on the admin side", () => {
    for (const href of hrefsIn("ADMIN_TABS")) {
      expect(href.startsWith("/admin"), `admin tab ${href} leaves the admin side`).toBe(true);
    }
  });

  /**
   * A tab whose href is not a route is a link to the 404 page, on every page.
   * Read the routes out of `src/index.ts` the same way `test/gate.test.ts`
   * does, and check each tab lands on one.
   */
  it("points every tab at a route that exists", () => {
    const index = read("index.ts");
    const routes = new Set(
      [...index.matchAll(/app\.(?:get|post)\(\s*"([^"]+)"/g)].map((m) => m[1]!)
    );

    for (const table of ["CHOIR_TABS", "ADMIN_TABS"] as const) {
      for (const href of hrefsIn(table)) {
        expect(routes.has(href), `${table}: no route serves ${href}`).toBe(true);
      }
    }
  });

  it("gives every tab a glyph that exists", () => {
    const known = new Set(iconNames());
    for (const table of ["CHOIR_TABS", "ADMIN_TABS"] as const) {
      const start = ui.indexOf(`const ${table}`);
      const body = ui.slice(start, ui.indexOf("];", start));
      const glyphs = [...body.matchAll(/glyph:\s*"([^"]+)"/g)].map((m) => m[1]!);
      expect(glyphs.length, `${table} has no tabs`).toBeGreaterThan(0);
      for (const g of glyphs) expect(known.has(g), `${table}: no glyph "${g}"`).toBe(true);
    }
  });
});
