/**
 * theme — the design tokens, and nothing else.
 *
 * Estate rule (see `docs/ESTATE.md` in JamesCAPalmer/bmserviceapp): design
 * tokens live in a standalone module, separate from layout styles, so the look
 * is swappable by a fork without touching layout.
 *
 *   - `THEME` — pure data: one flat group per kind of token (colour, type,
 *     radius, shadow). No imports, no side effects.
 *   - `THEME_CSS` — the `:root` custom-property block derived from `THEME`,
 *     emitted ahead of the layout stylesheet.
 *
 * Layout rules in `src/ui.ts` reference the custom properties
 * (`var(--colour-accent)`) and never name a colour, font stack or radius
 * directly.
 *
 * ---
 *
 * **The palette is the estate's, taken from the live bmserviceapp deployment
 * rather than invented here.** Every hex below appears in that app's stylesheet
 * under the same role, so the two apps are the same colour rather than
 * approximately the same colour:
 *
 *     red #c83734 · red-accent #E1251B · red-deep #5C0A18 · cream #e9dbc6
 *     paper #FBF8F3 · ink #2C2C2C · ink-soft #555856 · grey-soft #929491
 *     line/card-edge #E5E1D8 · card #FFFFFF · accent (gold) #C8A24B
 *     focus #1A6FB5
 *
 * Three consequences worth naming, because they are visible changes from what
 * this app looked like before:
 *
 *   - **Corners are nearly sharp.** The estate sets one radius, `2px`, and uses
 *     it everywhere. This app previously ran 6–12px with fully-round pills.
 *     Sharp reads as printed matter, which is the right register for a church.
 *   - **Red is the brand, gold is the accent.** Previously a single claret did
 *     both jobs. Red carries identity — the masthead rule, the crest — and gold
 *     marks the things that want a second glance.
 *   - **There is a dark theme.** The estate has one; this app did not. The full
 *     dark palette is below, and every token has a counterpart, so nothing
 *     falls back to a light value in the dark and glares.
 */

export interface Theme {
  /** Every colour in the interface. */
  colour: {
    /** Body text. */
    ink: string;
    /** Secondary text: blurbs, captions, help copy. */
    muted: string;
    /** Tertiary text: labels, empty states. */
    subtle: string;
    /** Page background. */
    canvas: string;
    /** Cards, panels, the nav bar. */
    surface: string;
    /** Table headings and hover fills. */
    surfaceAlt: string;
    /** Card, input and panel borders. */
    border: string;
    /** Hairlines: table rows, dividers. */
    borderSubtle: string;
    /** The brand colour: links, buttons, the masthead rule. */
    accent: string;
    /** Pressed and hovered accent. */
    accentDark: string;
    /** Accent wash behind callouts and step panels. */
    accentTint: string;
    /** Text and icons on an accent fill. */
    onAccent: string;
    /** The estate's gold. Marks a thing worth a second glance. */
    gold: string;
    /** Confirmation button (distinct from the accent so it reads as "go"). */
    confirm: string;
    confirmDark: string;
    /** Success, warning and error notices: rule colour plus its wash. */
    success: string;
    successTint: string;
    warning: string;
    warningTint: string;
    danger: string;
    dangerTint: string;
    /** Keyboard focus ring. The estate's blue, which is nobody else's colour. */
    focus: string;
    /** Status pills, as background/ink pairs. */
    pillGreenBg: string;
    pillGreenInk: string;
    pillAmberBg: string;
    pillAmberInk: string;
    pillRedBg: string;
    pillRedInk: string;
    pillVioletBg: string;
    pillVioletInk: string;
    /** Print only: body text, and running heads/page numbers. */
    printInk: string;
    printMeta: string;
  };
  /** Type scale and measures. */
  type: {
    familyBase: string;
    /** Serif face for piece titles and composer names — this is a music library. */
    familyDisplay: string;
    /** Root font size — large; a good deal of this is read on phones. */
    rootSize: string;
    lineHeight: string;
    h1: string;
    h2: string;
    /** Maximum width of a page. */
    measure: string;
    /** Narrower measure for long-form reading. */
    measureReading: string;
  };
  /** Corner radii. */
  radius: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
    /** Fully rounded: pills. */
    pill: string;
  };
  /** Elevation. */
  shadow: {
    /** Resting surfaces: the nav bar. */
    card: string;
    /** Raised surfaces: the volunteer portal's sticky action bar. */
    raised: string;
  };
}

/**
 * The estate's type pairing: Cormorant Garamond for display, Open Sans for
 * everything else.
 *
 * Both are served by this Worker from `/asset/*` (see `src/assets.ts`) rather
 * than fetched from Google, so the stacks below are the fallbacks for the
 * moment before the face loads, not a substitute for it.
 */
const SANS_STACK = `"Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const SERIF_STACK = `"Cormorant Garamond", Georgia, "Times New Roman", serif`;

export const THEME: Theme = {
  colour: {
    ink: "#2C2C2C",
    muted: "#555856",
    subtle: "#929491",
    canvas: "#FBF8F3",
    surface: "#FFFFFF",
    // Derived from the estate's cream, lightened so a table heading sits
    // quietly behind text rather than competing with it.
    surfaceAlt: "#F4EEE3",
    border: "#E5E1D8",
    borderSubtle: "#EDEAE2",
    accent: "#c83734",
    accentDark: "#5C0A18",
    accentTint: "#FBF1EF",
    onAccent: "#FFFFFF",
    gold: "#C8A24B",
    confirm: "#1F7A3D",
    confirmDark: "#175C2E",
    success: "#1F7A3D",
    successTint: "#F1F7F2",
    warning: "#C8A24B",
    warningTint: "#FBF7EE",
    danger: "#c83734",
    dangerTint: "#FBF1EF",
    focus: "#1A6FB5",
    pillGreenBg: "#E3F0E7",
    pillGreenInk: "#175C2E",
    pillAmberBg: "#F7EFDC",
    pillAmberInk: "#6B5015",
    pillRedBg: "#F8E4E3",
    pillRedInk: "#5C0A18",
    pillVioletBg: "#EDE4F3",
    pillVioletInk: "#4A2360",
    printInk: "#000",
    printMeta: "#777",
  },
  type: {
    familyBase: SANS_STACK,
    familyDisplay: SERIF_STACK,
    rootSize: "18px",
    lineHeight: "1.62",
    h1: "2.25rem",
    h2: "1.35rem",
    measure: "62rem",
    measureReading: "42rem",
  },
  // The estate uses one radius, 2px, everywhere. Kept as five names so the
  // layout rules do not have to change, but they all resolve to the same
  // near-square corner — which is what makes the app read as printed matter.
  radius: {
    sm: "2px",
    md: "2px",
    lg: "2px",
    xl: "2px",
    // Pills stay round: a status chip is a different object from a panel.
    pill: "999px",
  },
  shadow: {
    card: "0 1px 2px rgba(44,44,44,0.05)",
    raised: "0 -2px 10px rgba(44,44,44,0.10)",
  },
};

/**
 * The dark theme.
 *
 * Only the colours change — type, radii and shadows are shared, because a
 * corner does not get rounder at night. Values are the estate's
 * `[data-theme=dark]` block, with the same derivations applied as above.
 */
export const THEME_DARK: Theme["colour"] = {
  ink: "#ECE6D9",
  muted: "#ABA493",
  subtle: "#86888A",
  canvas: "#16140F",
  surface: "#1D1A14",
  surfaceAlt: "#26221A",
  border: "#2F2A20",
  borderSubtle: "#2E2A21",
  accent: "#F0796F",
  accentDark: "#8B2230",
  accentTint: "#2A1A18",
  onAccent: "#16140F",
  gold: "#D8B560",
  confirm: "#5FB47C",
  confirmDark: "#4A9463",
  success: "#5FB47C",
  successTint: "#17251B",
  warning: "#D8B560",
  warningTint: "#262016",
  danger: "#F0796F",
  dangerTint: "#2A1A18",
  focus: "#6FB8F2",
  pillGreenBg: "#1C3324",
  pillGreenInk: "#9BD6AF",
  pillAmberBg: "#332913",
  pillAmberInk: "#E3C77E",
  pillRedBg: "#3A1F20",
  pillRedInk: "#F5A9A2",
  pillVioletBg: "#2C2338",
  pillVioletInk: "#C8AEE0",
  printInk: "#000",
  printMeta: "#777",
};

/** `colour.accentDark` → `--colour-accent-dark`. */
function customPropertyName(group: string, token: string): string {
  return `--${group}-${token.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`;
}

function declarations(group: string, tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([token, value]) => `${customPropertyName(group, token)}: ${value};`)
    .join(" ");
}

/**
 * The `:root` block declaring every token, plus the dark overrides.
 *
 * Dark is applied two ways on purpose. `prefers-color-scheme` honours whatever
 * the phone is already set to, which is the right default and needs no
 * interaction; `html[data-theme="…"]` lets somebody override it for this app
 * alone and have that stick. The explicit attribute wins, which is why the
 * `[data-theme=light]` block exists at all — without it, choosing light on a
 * phone in dark mode would do nothing.
 *
 * The attribute selector matches the estate's, so a stylesheet moved between
 * the two apps behaves the same way.
 */
function themeCss(theme: Theme): string {
  const light = [
    declarations("colour", theme.colour),
    declarations("type", theme.type),
    declarations("radius", theme.radius),
    declarations("shadow", theme.shadow),
  ].join(" ");

  const dark = declarations("colour", THEME_DARK);

  return [
    `:root { ${light} }`,
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} } }`,
    `html[data-theme="dark"] { ${dark} }`,
    `html[data-theme="light"] { ${declarations("colour", theme.colour)} }`,
    // Tell the browser which scheme is in play so form controls, scrollbars and
    // the address bar follow. Without it a dark page keeps white input chrome.
    `:root { color-scheme: light dark; }`,
    `html[data-theme="dark"] { color-scheme: dark; }`,
    `html[data-theme="light"] { color-scheme: light; }`,
  ].join("\n");
}

export const THEME_CSS = themeCss(THEME);

/**
 * The estate's type faces, served from this Worker.
 *
 * `font-display: swap` so text is readable in the fallback face immediately and
 * reflows once the real one arrives — the right trade on a slow connection,
 * where the alternative is a blank page.
 */
export const FONT_CSS = `
@font-face {
  font-family: "Cormorant Garamond";
  src: url("/asset/cormorant-garamond.woff2") format("woff2");
  font-weight: 500 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Open Sans";
  src: url("/asset/open-sans.woff2") format("woff2");
  font-weight: 400 800;
  font-style: normal;
  font-display: swap;
}`;

/**
 * Liturgical colours for the season rule, taken from bmserviceapp.
 *
 * The hub paints a 2px rule under its heading in the colour of the season, and
 * this app does the same so that somebody moving between them sees the same
 * colour on the same day. Values are that app's exactly.
 */
export const SEASON_COLOURS: Record<string, string> = {
  advent: "#6B2C8F",
  christmas: "#6B2C8F",
  epiphany: "#1F7A3D",
  candlemas: "#1F7A3D",
  lent: "#6B2C8F",
  passiontide: "#6B2C8F",
  holyweek: "#6B2C8F",
  easter: "#D9B44A",
  ascension: "#D9B44A",
  pentecost: "#C0392B",
  trinity: "#1F7A3D",
  harvest: "#1F7A3D",
  remembrance: "#C0392B",
  allsaints: "#D9B44A",
  marian: "#1A6FB5",
  saints: "#C0392B",
  wedding: "#D9B44A",
  funeral: "#6B2C8F",
  general: "#1F7A3D",
};

/** Ordinary Time, when no season is in play. */
export const SEASON_COLOUR_DEFAULT = "#1F7A3D";
