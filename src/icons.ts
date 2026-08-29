/**
 * icons — the glyph set, as inline SVG.
 *
 * **Why inline, and why hand-drawn paths.** `CLAUDE.md` rules out CDN assets and
 * dependencies beyond Hono and wrangler, which takes an icon font and every
 * npm icon package off the table in one sentence. Inline SVG costs no request
 * at all: the glyph arrives in the same bytes as the page that uses it, so the
 * volunteer portal on one bar of signal in the song school renders complete or
 * not at all, rather than as a page of empty squares waiting on a font.
 *
 * The set is deliberately small. Twenty-odd glyphs that all look like they were
 * drawn by the same hand beat sixty that do not, and every one here is on a
 * 24×24 grid with the same 1.8 stroke, round caps and round joins.
 *
 * **Three rules the whole file follows.**
 *
 * 1. **`currentColor`, never a hex.** A glyph is the colour of the text beside
 *    it, which means it is correct in the dark theme, inside a red button, in a
 *    muted caption and on a printed page without a single extra rule. There is
 *    no colour in this file and there should never be one.
 *
 * 2. **`aria-hidden`, always.** Every glyph in this app sits next to a text
 *    label that says the same thing. Announcing both would read the label
 *    twice, so the icon is decoration to a screen reader — which is exactly
 *    what it is. This is also why {@link icon} takes no label argument: an icon
 *    that needs its own label is an icon in the wrong place, and the fix is to
 *    write the words next to it.
 *
 * 3. **Sized in `em`, not pixels.** The glyph scales with the text it sits in,
 *    so a nav link, a button and a 1.8rem tile heading each get a glyph in
 *    proportion rather than three hard-coded sizes.
 *
 * The shape of this module — a `Record` of path bodies plus one `icon()` that
 * wraps them — is the estate's, matching `src/icons.ts` in fobm-vestry. The
 * *pattern* is shared; nothing else is. The Friends are a separate charity with
 * their own sub-brand, and none of their marks, colours or app-specific glyphs
 * appear here. What is shared is geometry that belongs to nobody: a house is a
 * house.
 */

/**
 * The paths, by name.
 *
 * Grouped by what they are for rather than alphabetically, because the question
 * being asked here is always "what is there for a thing like this?".
 */
const PATHS: Record<string, string> = {
  // --- the library ---------------------------------------------------------
  /** A piece of music. The catalogue's own glyph. */
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  /** A box of music. Used wherever a box is the subject. */
  box: '<path d="M3 8l2-4h14l2 4"/><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M10 12h4"/>',
  /** The cupboards. A diesel loco, because of what they are called. */
  loco: '<path d="M4 16V8a2 2 0 0 1 2-2h7l4 4h1a2 2 0 0 1 2 2v4"/><path d="M2 16h20"/><circle cx="7.5" cy="18.5" r="1.8"/><circle cx="16.5" cy="18.5" r="1.8"/><path d="M7 9h4v3H7z"/>',
  /** Search. */
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/>',
  /** A label, printed and stuck on a spine. */
  label: '<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  /** Repairs. */
  repair: '<path d="M15.5 3.5a5 5 0 0 0-6.2 6.9L3 16.7V21h4.3l6.3-6.3a5 5 0 0 0 6.9-6.2l-3.1 3.1-2.9-.7-.7-2.9z"/>',
  /** A count, a stocktake. */
  count: '<path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"/><path d="M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2"/><path d="M9 13l2 2 4-4"/>',
  /** Scans and photographs. */
  camera: '<path d="M3 8a2 2 0 0 1 2-2h2.2l1.3-1.7a1 1 0 0 1 .8-.4h5.4a1 1 0 0 1 .8.4L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.2"/>',
  /** Out on loan. */
  loan: '<path d="M4 7h9l3 3h4"/><path d="M20 10v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7"/><path d="M12 17V12"/><path d="M9.5 14.5L12 12l2.5 2.5"/>',

  // --- services and the year -----------------------------------------------
  /** A service, a date, a music list. */
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
  /** Choosing music by season. */
  season: '<path d="M12 3v18M3 12h18"/><path d="M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7"/>',

  // --- the choir -----------------------------------------------------------
  /** People. */
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6a3 3 0 0 1 0 6"/><path d="M21 20a5 5 0 0 0-4-5"/>',
  /** The register. */
  register: '<path d="M5 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  /** Pay. */
  pay: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9a3 3 0 0 0-4.7 3.6c.6 1 2.6 1.4 3.4 2.3A2.6 2.6 0 0 1 9.4 15"/><path d="M12 6.5v11"/>',
  /** The duty rota, and safeguarding generally. */
  shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  /** Robes. */
  robe: '<path d="M9 3l3 2 3-2 3.5 3-2 2.5V21H7.5V8.5L5.5 6z"/><path d="M12 5v16"/>',
  /** An award. */
  award: '<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5L7 21l5-2.5L17 21l-1.5-7.5"/>',

  // --- reading and reporting -----------------------------------------------
  /** A report. */
  report: '<path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 13v4m3-6v6m3-3v3"/>',
  /** A list of work, in order. */
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  /** Take the data out. */
  download: '<path d="M12 4v10"/><path d="M8.5 10.5L12 14l3.5-3.5"/><path d="M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"/>',
  /** Bring data in. */
  upload: '<path d="M12 16V6"/><path d="M8.5 9.5L12 6l3.5 3.5"/><path d="M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"/>',
  /** Print. */
  print: '<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="1"/><path d="M8 17h8v4H8z"/>',

  // --- the app itself ------------------------------------------------------
  /** Home. */
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  /** Settings. */
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 3h.1A2 2 0 1 1 13 3v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  /** Modules: what the app does at all. */
  modules: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  /** Roles: who may do what. */
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9"/><path d="M17 12v3M20 12v2"/>',
  /** Feedback, and anything conversational. */
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
  /** Review: something to check. */
  review: '<path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M15 3v5h5"/><path d="M9 14l2 2 4-4"/>',
  /** The way through to the librarian's side. A closed padlock. */
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><path d="M12 14v2.5"/>',
  /** Sign out. */
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
  /** The choir side, seen from the admin side. */
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>',
  /** Add something. */
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  /** The dark theme. */
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  /** The light theme. */
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
  /** The guide: how to use this. An open book, lying flat. */
  book: '<path d="M4 4.5h5a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H4z"/><path d="M20 4.5h-5a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H20z"/>',

  // --- the register, at the door -------------------------------------------
  //
  // These three are the register's states, and they are why the glyph set grew.
  // Colour alone does not carry a state to somebody colour-blind, in low light
  // in a vestry doorway, or on a photocopied page — so here, away and excused
  // each get a shape as well, and the three shapes are told apart at a glance
  // with no colour at all.
  /** Here. */
  tick: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  /** Away. */
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  /** Excused — neither here nor absent without leave. */
  minus: '<path d="M5 12h14"/>',
};

/** Every glyph name, for the test that checks each one is actually drawn. */
export function iconNames(): string[] {
  return Object.keys(PATHS);
}

/**
 * One glyph, as inline SVG.
 *
 * Returns the empty string for a name that does not exist, rather than
 * throwing. A missing glyph should cost the page its decoration and nothing
 * else — the label beside it still says what the thing is, so the screen
 * degrades to the text-only app it was a moment ago. `test/icons.test.ts`
 * catches the typo instead, which is the right place to catch it.
 */
export function icon(name: string): string {
  const body = PATHS[name];
  if (!body) return "";
  return (
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}
