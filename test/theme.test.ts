/**
 * The theme.
 *
 * Two things are worth a test here, and neither is "does this look nice".
 *
 * The first is that **every colour has a dark counterpart**. A token defined
 * only in the light palette does not fall back to something sensible at night —
 * it keeps its light value and glares out of a dark page, and the only way
 * anybody finds out is by opening that one screen after dark.
 *
 * The second is that the palette **is the estate's**, not an approximation of
 * it. The hexes below were read off the live bmserviceapp stylesheet; pinning
 * them means a well-meaning tweak to "warm the red up a bit" fails here rather
 * than silently making the two apps different colours.
 */

import { describe, expect, it } from "vitest";
import { SEASON_COLOURS, SEASON_COLOUR_DEFAULT, THEME, THEME_CSS, THEME_DARK, FONT_CSS } from "../src/theme";
import { CHURCH } from "../src/church.config";
import { assetNames } from "../src/assets";

describe("light and dark are the same shape", () => {
  it("gives every colour a dark counterpart", () => {
    const light = Object.keys(THEME.colour).sort();
    const dark = Object.keys(THEME_DARK).sort();
    expect(dark).toEqual(light);
  });

  it("actually changes the colours rather than reusing the light ones", () => {
    // Print colours are deliberately the same — paper is paper.
    const shared = ["printInk", "printMeta"];
    for (const [token, value] of Object.entries(THEME.colour)) {
      if (shared.includes(token)) continue;
      expect(
        THEME_DARK[token as keyof typeof THEME_DARK],
        `${token} is the same in both themes`
      ).not.toBe(value);
    }
  });

  it("writes every token as a valid colour", () => {
    const hex = /^#[0-9a-fA-F]{3,8}$/;
    for (const [token, value] of Object.entries(THEME.colour)) {
      expect(value, `light ${token}`).toMatch(hex);
    }
    for (const [token, value] of Object.entries(THEME_DARK)) {
      expect(value, `dark ${token}`).toMatch(hex);
    }
  });
});

describe("the palette is the estate's", () => {
  // Read off the live bmserviceapp stylesheet. If one of these has to change,
  // it should change in both apps on the same day.
  it("uses the estate's light values", () => {
    expect(THEME.colour.ink).toBe("#2C2C2C");
    expect(THEME.colour.muted).toBe("#555856");
    expect(THEME.colour.subtle).toBe("#929491");
    expect(THEME.colour.canvas).toBe("#FBF8F3");
    expect(THEME.colour.surface).toBe("#FFFFFF");
    expect(THEME.colour.border).toBe("#E5E1D8");
    expect(THEME.colour.accent).toBe("#c83734");
    expect(THEME.colour.accentDark).toBe("#5C0A18");
    expect(THEME.colour.gold).toBe("#C8A24B");
    expect(THEME.colour.focus).toBe("#1A6FB5");
  });

  it("uses the estate's dark values", () => {
    expect(THEME_DARK.canvas).toBe("#16140F");
    expect(THEME_DARK.surface).toBe("#1D1A14");
    expect(THEME_DARK.ink).toBe("#ECE6D9");
    expect(THEME_DARK.accent).toBe("#F0796F");
    expect(THEME_DARK.gold).toBe("#D8B560");
    expect(THEME_DARK.focus).toBe("#6FB8F2");
  });

  // The estate sets one radius and uses it everywhere. Sharp corners are what
  // make the app read as printed matter rather than as a web form.
  it("keeps corners nearly square, as the estate does", () => {
    for (const name of ["sm", "md", "lg", "xl"] as const) {
      expect(THEME.radius[name], `radius.${name}`).toBe("2px");
    }
    // A status chip is a different object from a panel, and stays round.
    expect(THEME.radius.pill).toBe("999px");
  });

  it("names the estate's two type faces first in each stack", () => {
    expect(THEME.type.familyBase.startsWith('"Open Sans"')).toBe(true);
    expect(THEME.type.familyDisplay.startsWith('"Cormorant Garamond"')).toBe(true);
  });
});

describe("the generated stylesheet", () => {
  it("declares the light palette on :root", () => {
    expect(THEME_CSS).toContain("--colour-accent: #c83734;");
    expect(THEME_CSS).toContain("--type-family-display:");
    expect(THEME_CSS).toContain("--radius-sm: 2px;");
  });

  // Both routes into dark are needed. The media query honours a phone that is
  // already set to dark and needs no interaction; the attribute lets somebody
  // override that for this app alone. Without the [data-theme=light] block,
  // choosing light on a dark phone would do nothing at all.
  it("supports the phone's own setting and an explicit override", () => {
    expect(THEME_CSS).toContain("@media (prefers-color-scheme: dark)");
    expect(THEME_CSS).toContain('html[data-theme="dark"]');
    expect(THEME_CSS).toContain('html[data-theme="light"]');
    expect(THEME_CSS).toContain(':root:not([data-theme="light"])');
  });

  // Without color-scheme, a dark page keeps white input chrome and scrollbars.
  it("tells the browser which scheme is in play", () => {
    expect(THEME_CSS).toContain("color-scheme");
  });

  it("serves both faces from this Worker rather than a CDN", () => {
    expect(FONT_CSS).toContain('url("/asset/cormorant-garamond.woff2")');
    expect(FONT_CSS).toContain('url("/asset/open-sans.woff2")');
    expect(FONT_CSS).not.toContain("fonts.gstatic.com");
    expect(FONT_CSS).not.toContain("fonts.googleapis.com");
    // Text must be readable in the fallback face while the real one loads.
    expect(FONT_CSS).toContain("font-display: swap");
  });
});

describe("the season rule", () => {
  // The rule under the masthead is painted in the colour of the church season,
  // the same colour bmserviceapp paints on the same day.
  it("has a colour for every season in the vocabulary", () => {
    for (const season of CHURCH.seasons) {
      expect(SEASON_COLOURS[season.value], `no colour for ${season.value}`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("uses the estate's liturgical colours", () => {
    expect(SEASON_COLOURS.advent).toBe("#6B2C8F"); // purple
    expect(SEASON_COLOURS.lent).toBe("#6B2C8F");
    expect(SEASON_COLOURS.easter).toBe("#D9B44A"); // gold
    expect(SEASON_COLOURS.pentecost).toBe("#C0392B"); // red
    expect(SEASON_COLOUR_DEFAULT).toBe("#1F7A3D"); // Ordinary Time, green
  });
});

describe("the bundled assets", () => {
  it("carries everything the pages ask for", () => {
    const names = assetNames();
    for (const needed of [
      "cormorant-garamond.woff2",
      "open-sans.woff2",
      "minster-logo-light.png",
      "minster-logo-dark.png",
      "favicon.ico",
      "apple-touch-icon.png",
      "icon-192.png",
    ]) {
      expect(names, `${needed} is not bundled`).toContain(needed);
    }
  });
});
