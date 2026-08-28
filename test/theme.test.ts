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
  });

  it("uses the estate's dark values", () => {
    expect(THEME_DARK.canvas).toBe("#16140F");
    expect(THEME_DARK.surface).toBe("#1D1A14");
    expect(THEME_DARK.ink).toBe("#ECE6D9");
    expect(THEME_DARK.accent).toBe("#F0796F");
    expect(THEME_DARK.gold).toBe("#D8B560");
  });

  // Corners are rounded, and they get rounder as the object gets bigger: chip,
  // then input, then button, then card. The gradient is what the eye reads as a
  // hierarchy of objects, so it is the gradient that is worth pinning rather
  // than any one value — a later tweak from 12px to 14px is fine, a later
  // flattening back to one radius everywhere is the thing this catches.
  it("rounds corners, and rounds bigger things more", () => {
    const px = (value: string): number => {
      expect(value, `${value} is not a pixel value`).toMatch(/^\d+px$/);
      return Number.parseInt(value, 10);
    };
    const [sm, md, lg, xl] = (["sm", "md", "lg", "xl"] as const).map((n) => px(THEME.radius[n]));
    expect(sm, "small controls should still be visibly rounded").toBeGreaterThanOrEqual(4);
    expect(md!).toBeGreaterThan(sm!);
    expect(lg!).toBeGreaterThan(md!);
    expect(xl!).toBeGreaterThan(lg!);
    // A status chip is a different object from a panel, and stays fully round.
    expect(THEME.radius.pill).toBe("999px");
  });

  it("names the estate's two type faces first in each stack", () => {
    expect(THEME.type.familyBase.startsWith('"Open Sans"')).toBe(true);
    expect(THEME.type.familyDisplay.startsWith('"Cormorant Garamond"')).toBe(true);
  });
});

describe("there is no blue in the brand", () => {
  /**
   * Hue in degrees, and how saturated the colour is.
   *
   * A near-grey has a hue but it means nothing — `#E5E1D8` computes to 42°
   * without being in any sense yellow — so the check below ignores anything
   * washed out enough that a person would call it grey.
   */
  function hsl(hex: string): { hue: number; sat: number } {
    const n = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 2;
    if (max === min) return { hue: 0, sat: 0 };
    const d = max - min;
    const sat = d / (1 - Math.abs(2 * light - 1));
    const hue =
      max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { hue: hue * 60, sat };
  }

  /** Blue and cyan, broadly. Violet (266°+) is a liturgical colour and stays. */
  const BLUE = (hex: string) => {
    const { hue, sat } = hsl(hex);
    return sat > 0.12 && hue >= 180 && hue <= 260;
  };

  /**
   * James's rule, and the reason this test exists rather than a comment: blue
   * is not a Beverley Minster colour. The estate's focus ring was `#1A6FB5`
   * and it was in here for a good reason — a colour nobody else uses always
   * reads as "the keyboard is here" — so the pull to reintroduce a blue the
   * next time the focus ring is inconvenient is real. This fails when somebody
   * does.
   */
  it("has no blue anywhere in either palette", () => {
    for (const [token, value] of Object.entries(THEME.colour)) {
      expect(BLUE(value), `light ${token} (${value}) is a blue`).toBe(false);
    }
    for (const [token, value] of Object.entries(THEME_DARK)) {
      expect(BLUE(value), `dark ${token} (${value}) is a blue`).toBe(false);
    }
  });

  /**
   * The one exception, stated out loud so it cannot be mistaken for an
   * oversight: blue is the liturgical colour of feasts of Our Lady. It is not
   * brand, it is bmserviceapp's exact value so the two apps paint the same rule
   * on the same day, and it shows as 2px under the masthead a few days a year.
   */
  it("keeps exactly one blue, and it is the liturgical one", () => {
    const blues = Object.entries(SEASON_COLOURS)
      .filter(([, value]) => BLUE(value))
      .map(([season]) => season);
    expect(blues).toEqual(["marian"]);
  });

  /**
   * With no blue to reach for, the focus ring is two-tone instead: a dark ring
   * with a light halo, reversed in the dark theme. What makes that work is the
   * contrast between the two halves, so that is what is worth testing — if
   * somebody ever sets them to similar tones the ring stops being visible on
   * one background or another, and nothing else in the suite would notice.
   */
  it("builds a focus ring out of contrast rather than hue", () => {
    const lightness = (hex: string): number => {
      const n = hex.replace("#", "");
      const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255) as [
        number,
        number,
        number,
      ];
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    };
    for (const [name, palette] of [
      ["light", THEME.colour],
      ["dark", THEME_DARK],
    ] as const) {
      const gap = Math.abs(lightness(palette.focus) - lightness(palette.focusHalo));
      expect(gap, `${name}: the two halves of the focus ring are too close to tell apart`).toBeGreaterThan(0.5);
    }
    // And the two themes are the other way up from each other.
    const lightRingIsDark = lightness(THEME.colour.focus) < lightness(THEME.colour.focusHalo);
    const darkRingIsDark = lightness(THEME_DARK.focus) < lightness(THEME_DARK.focusHalo);
    expect(lightRingIsDark).toBe(true);
    expect(darkRingIsDark).toBe(false);
  });
});

describe("the generated stylesheet", () => {
  it("declares the light palette on :root", () => {
    expect(THEME_CSS).toContain("--colour-accent: #c83734;");
    expect(THEME_CSS).toContain("--type-family-display:");
    expect(THEME_CSS).toContain(`--radius-sm: ${THEME.radius.sm};`);
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
