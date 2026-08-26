/**
 * theme — the design tokens, and nothing else.
 *
 * Estate rule (see `docs/ESTATE.md` in JamesCAPalmer/bmserviceapp): design
 * tokens live in a standalone module, separate from layout styles, so the look
 * is swappable by a fork without touching layout. The shape here is copied from
 * `fobm-vestry`, the estate's UI template:
 *
 *   - `THEME` — pure data: one flat group per kind of token (colour, type,
 *     radius, shadow). No imports, no side effects.
 *   - `THEME_CSS` — the `:root` custom-property block derived from `THEME`,
 *     emitted ahead of the layout stylesheet.
 *
 * Layout rules in `src/ui.ts` reference the custom properties
 * (`var(--colour-accent)`) and never name a colour, font stack or radius
 * directly. Where a value cannot be a custom property, read it from `THEME`.
 *
 * The palette is warmer than Vestry's: stone and claret rather than corporate
 * blue, because this app is read in a song school rather than at a desk. A fork
 * rebrands by editing the values below.
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
    /** The brand colour: links, buttons, icons. */
    accent: string;
    /** Pressed and hovered accent. */
    accentDark: string;
    /** Accent wash behind callouts and step panels. */
    accentTint: string;
    /** Text and icons on an accent fill. */
    onAccent: string;
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
    /** Root font size — large; a good deal of this is read on phones in a cold room. */
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

export const THEME: Theme = {
  colour: {
    ink: "#2a2422",
    muted: "#5a514c",
    subtle: "#857a72",
    canvas: "#faf8f5",
    surface: "#fff",
    surfaceAlt: "#f1ede7",
    border: "#d8d0c4",
    borderSubtle: "#e8e2d9",
    accent: "#8a2f3f",
    accentDark: "#6b2431",
    accentTint: "#fdf2f4",
    onAccent: "#fff",
    confirm: "#2f855a",
    confirmDark: "#276749",
    success: "#38a169",
    successTint: "#f0fff4",
    warning: "#b7791f",
    warningTint: "#fffaf0",
    danger: "#c53030",
    dangerTint: "#fff5f5",
    pillGreenBg: "#c6f6d5",
    pillGreenInk: "#22543d",
    pillAmberBg: "#feebc8",
    pillAmberInk: "#7b341e",
    pillRedBg: "#fed7d7",
    pillRedInk: "#742a2a",
    pillVioletBg: "#e9d8fd",
    pillVioletInk: "#44337a",
    printInk: "#000",
    printMeta: "#777",
  },
  type: {
    familyBase: `-apple-system, "Segoe UI", system-ui, sans-serif`,
    familyDisplay: `Georgia, "Times New Roman", serif`,
    rootSize: "18px",
    lineHeight: "1.6",
    h1: "1.7rem",
    h2: "1.3rem",
    measure: "62rem",
    measureReading: "44rem",
  },
  radius: {
    sm: "6px",
    md: "8px",
    lg: "10px",
    xl: "12px",
    pill: "999px",
  },
  shadow: {
    card: "0 1px 2px rgba(0,0,0,0.04)",
    raised: "0 -2px 10px rgba(0,0,0,0.08)",
  },
};

/** `colour.accentDark` → `--colour-accent-dark`. */
function customPropertyName(group: string, token: string): string {
  return `--${group}-${token.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`;
}

/** The `:root` block declaring every token as a CSS custom property. */
function themeCss(theme: Theme): string {
  const declarations = Object.entries(theme).flatMap(([group, tokens]) =>
    Object.entries(tokens as Record<string, string>).map(
      ([token, value]) => `${customPropertyName(group, token)}: ${value};`
    )
  );
  return `:root { ${declarations.join(" ")} }`;
}

export const THEME_CSS = themeCss(THEME);
