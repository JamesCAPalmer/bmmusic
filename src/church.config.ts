/**
 * church.config — every institution-specific fact in one typed module.
 *
 * Estate rule (see `docs/ESTATE.md` in JamesCAPalmer/bmserviceapp): code reads
 * config; config never imports code. A fork of this app for another church
 * edits this file plus the design tokens in `src/theme.ts` — nothing else.
 *
 * Keep this module pure data: no imports, no functions, no side effects. It is
 * consumed by the pages (`src/ui.ts`), the routes (`src/index.ts`) and the seed
 * importer (`src/seed.ts`).
 *
 * Secrets never live here. They are set in the Cloudflare dashboard and read
 * from `env` (see `src/env.ts`).
 */

export interface ChoirProfile {
  /** Designation as it appears on the music list ("Boys and SATB"). */
  designation: string;
  /** Typical number of singers, where the maintainer has recorded it. */
  typicalSingers?: number;
}

export interface ServicePattern {
  /** Service name as published ("Choral Evensong"). */
  name: string;
  /** Rite the service follows ("BCP 1662", "CW Order One"). */
  rite: string;
  /** Usual start time, 24-hour "HH:MM". */
  usualTime: string;
}

/** One of the eight catalogue categories. Stored as the single-letter code. */
export interface CategoryDefinition {
  code: string;
  /** Label shown in the interface. */
  label: string;
  /** One-line explanation for the admin screens. */
  blurb: string;
}

/** A condition grade a volunteer can record against a holding. */
export interface ConditionGrade {
  value: string;
  label: string;
  /** Plain-English guidance for the volunteer holding the box. */
  guidance: string;
}

/**
 * A season or occasion a piece belongs to.
 *
 * The controlled vocabulary behind `piece.season`, which holds a
 * semicolon-joined list of these tags. Deliberately not a database CHECK: the
 * column holds a list, so a constraint could only match the whole string, and
 * a rejected write tells nobody anything. The importer flags an unrecognised
 * tag for review instead, where a human can see it and fix the source.
 *
 * The order here is the church year, which is the order the chips read in and
 * the order the feast-ahead panel walks. `general` sits last because it means
 * "any time", not a point in the year.
 */
export interface SeasonTag {
  /** Stored form. Lower case, no spaces. */
  value: string;
  /** Shown in the interface. */
  label: string;
}

/** A voice part, for the register. Optional per person until it is known. */
export interface VoicePart {
  value: string;
  label: string;
}

/** One adult team, by voice part. The teams alternate through the term. */
export interface AdultTeam {
  soprano: number;
  alto: number;
  tenor: number;
  bass: number;
}

/**
 * The size of every part of the choir.
 *
 * Children first, then the two adult teams. "SATB" on a music list means the
 * adults as a body (both teams); "Team A" or "Team B" names one of them.
 */
export interface ChoirSections {
  /** Boys' choir. */
  boys: number;
  /** Girls' choir — the younger girls. */
  girls: number;
  /** Consort — the older girls. */
  consort: number;
  teamA: AdultTeam;
  teamB: AdultTeam;
}

/** A sheet of labels, measured in millimetres from the top-left of the page. */
export interface LabelGrid {
  /** What is printed on the box, for the admin screen to name it. */
  stock: string;
  pageWidth: number;
  pageHeight: number;
  /** One die-cut label. */
  labelWidth: number;
  labelHeight: number;
  /** Distance from the left edge of the sheet to the left edge of column 1. */
  marginLeft: number;
  /** Distance from the top edge of the sheet to the top edge of row 1. */
  marginTop: number;
  columns: number;
  rows: number;
  /** Gap between columns and between rows. Zero on a butt-cut sheet. */
  columnGap: number;
  rowGap: number;
  /**
   * Ink kept clear of the die-cut edge.
   *
   * Sheet-fed printers wander by a millimetre or two, and a title that runs to
   * the cut looks like a mistake even when the alignment is perfect.
   */
  safeMargin: number;
}

export interface LabelStocks {
  /**
   * The volunteer sheet (1A): Triplast A4 integrated sheets, one peel-off
   * label, the rest of the sheet ordinary paper to write on.
   *
   * The die-cut position is measured, not derived: 110×60mm sitting 10mm from
   * the left edge and 49mm from the top.
   */
  volunteerSheet: LabelGrid;
  /** Reprints, face labels and combined labels (H10): Avery L7163. */
  avery: LabelGrid;
}

/** One cupboard in the song school: the letter on the door, and its name. */
export interface StorageDoor {
  /** The letter, "A"–"H". This is what is stored and printed. */
  letter: string;
  /** What everybody calls it. A diesel locomotive class. */
  name: string;
  /**
   * The class number, for the caption under the name.
   *
   * Worth carrying: it turns a private joke into something a person who is not
   * Robert can still follow, and it is the one fact that makes the names look
   * deliberate rather than random.
   */
  loco: string;
}

export interface ChurchConfig {
  /** Full public name of the institution. */
  name: string;
  /** Short name used in running prose ("the Minster"). */
  shortName: string;
  /**
   * Name of this app on the choir side, as it appears in the interface — the
   * wordmark beside the crest, the page titles, the sign-in screen.
   */
  appName: string;
  /**
   * Name of the admin side.
   *
   * Deliberately different from `appName` and deliberately abbreviated. Somebody
   * with both open has two tabs that would otherwise look identical, and the
   * one where a wrong click writes to the register should not be the one you
   * have to read twice to identify.
   */
  adminAppName: string;
  /** Canonical domains — the church's own site and this app's host. */
  domains: {
    site: string;
    app: string;
  };
  /**
   * The estate's data engine. Phase 2's pinch-point warnings read the music
   * list from here, server-side, per docs/API.md in the hub repo. This app
   * never fetches or parses the Minster's music-list document itself — that is
   * the estate's single ingestion path, and it belongs to bmserviceapp.
   */
  estateApi: {
    baseUrl: string;
    musicPath: string;
  };
  /** Where the physical library lives, for the volunteers' benefit. */
  library: {
    /** Room the boxes are kept in. */
    location: string;
    /** Roughly how many items the catalogue is expected to hold. */
    approximateItems: number;
  };
  /** Hymn book the music list's hymn numbers index into. */
  hymnBook: {
    id: string;
    title: string;
    publisher: string;
    year: number;
  };
  /** Choir designations that appear on the music list. */
  choirs: ChoirProfile[];
  /**
   * How many people are actually in each part of the choir.
   *
   * The music list publishes designations as prose — "Boys and SATB",
   * "Consort, Girls and SATB", "ATB" — and the copies RAG needs a number of
   * singers behind each. `src/choirsize.ts` does that arithmetic; these are its
   * inputs, and the only place the numbers live.
   *
   * They date from September 2026: the children's numbers from Rachel Dent
   * (Director of Junior Choir), the adults counted off the Minster Choir teams
   * list for the same month. They will drift, and updating them here is the
   * whole maintenance job — nothing else needs to change.
   *
   * The Junior Choir (ages 5–8) is deliberately absent: they do not sing from
   * copies, so they never affect whether there are enough.
   */
  choirSections: ChoirSections;
  /** Regular choral service patterns. */
  servicePatterns: ServicePattern[];
  /** The catalogue's categories, in the order they are offered. */
  categories: CategoryDefinition[];
  /** Condition grades, worst last. */
  conditions: ConditionGrade[];
  /** The season vocabulary `piece.season` tags against, in church-year order. */
  seasons: SeasonTag[];
  /** Voice parts a chorister can be recorded as singing. */
  voiceParts: VoicePart[];
  /**
   * How the physical library is laid out: cupboards, and shelves within one.
   *
   * The song school's music is behind a run of cupboard doors. A box's address
   * is a door letter and a shelf number, which is what a volunteer can actually
   * read off the front of a cupboard.
   *
   * **Each cupboard also has a name, and the names are diesel locomotive
   * classes.** That is Robert's doing and it is a good idea: "it's in Deltic"
   * is a thing a person says and remembers, where "it's in D" is a thing a
   * person mishears as "in B" across a song school. The letters run in order
   * and the names do not, which is the point — a name is memorable precisely
   * because it is not derivable.
   *
   * **The letter is what is stored; the name is only ever displayed.** Every
   * `holding.location_door` in D1, every label already printed and stuck to a
   * spine, and every volunteer who has learned the wall carries the letter. So
   * renaming a cupboard — or dropping the joke entirely — is an edit to this
   * array and nothing else: no migration, no reprint, no re-count.
   */
  storage: {
    /** The cupboards, in the order they run along the wall. */
    doors: StorageDoor[];
    /** Highest shelf number within a cupboard. */
    maxShelf: number;
  };
  /** How the copies RAG (16A) decides between green, amber and red. */
  copiesRag: {
    /**
     * Proportion of the choir that must have a usable copy before a shortfall
     * counts as amber rather than red.
     *
     * Amber means "a couple of people share", which is a normal Tuesday. Set
     * too low and red never fires; too high and the screen cries wolf on half
     * the library.
     */
    amberProportion: number;
  };
  /**
   * The hymn descant binders (H4).
   *
   * The descants are not catalogued piece by piece — they live in a run of ring
   * binders indexed by hymn number, recorded in the draft index as one row
   * (D-255). Finding one is arithmetic on a shelf, not a catalogue search.
   */
  descants: {
    /** Hymns per numbered binder: 10 gives "1–10", "11–20", … */
    rangeSize: number;
    /** Highest hymn number the numbered binders cover. */
    highestNumbered: number;
    /** Binders with a name rather than a range on the spine. */
    namedBinders: string[];
  };
  /** When a box is due a recount (H6). Whichever comes first. */
  stocktake: {
    yearsBetweenCounts: number;
    performancesBetweenCounts: number;
  };
  /**
   * The label stocks, in millimetres.
   *
   * Both stocks are physical things sitting in a box in Beverley, and the
   * geometry below has to match them to a fraction of a millimetre or the print
   * lands off the die-cut. They live in config precisely so that changing stock
   * is an edit here rather than a hunt through PDF-drawing code.
   *
   * Millimetres throughout, because that is what the packaging says and what
   * James will measure with. `src/labels.ts` converts to PDF points once, at
   * the boundary, so no drawing code carries a conversion factor.
   */
  labels: LabelStocks;
  /** Prefix and width of an accession number: "BM-" + 4 digits → "BM-0001". */
  accession: {
    prefix: string;
    digits: number;
  };
  /** IANA timezone all service times are local to. */
  timezone: string;
  /** YouTube channel ID for the church's live streams (Phase 2 mining). */
  youtubeChannelId: string;
  /** Contact points. */
  contact: {
    website: string;
    /** Who to ask when something here is wrong. */
    maintainer: {
      shortName: string;
      email: string;
    };
  };
}

export const CHURCH: ChurchConfig = {
  name: "Beverley Minster",
  shortName: "the Minster",
  appName: "Beverley Minster Music",
  adminAppName: "BM Music Admin",
  domains: {
    site: "beverleyminster.org.uk",
    app: "bmmusic.james-palmer.com",
  },
  estateApi: {
    baseUrl: "https://bmserviceapp.james-palmer.com",
    musicPath: "/api/music",
  },
  library: {
    location: "Song school",
    approximateItems: 600,
  },
  hymnBook: {
    id: "HONNA",
    title: "Hymns Old and New: New Anglican",
    publisher: "Kevin Mayhew",
    year: 1996,
  },
  // The designations the music list actually publishes, taken from four months
  // of the live feed. These seed `choir_profile`; the numbers beside them are
  // worked out from `choirSections` below by `src/choirsize.ts`, so they are
  // not repeated here — a row with no number falls back to that calculation,
  // and an admin can still override any one of them by hand on the settings
  // screen when a term turns out differently.
  //
  // Visiting choirs are listed without numbers on purpose. Nobody here knows
  // how many singers the Liturgy Singers are bringing, and the RAG showing grey
  // is the honest answer.
  choirs: [
    { designation: "Full Choir" },
    { designation: "SATB" },
    { designation: "ATB" },
    { designation: "Boys" },
    { designation: "Girls" },
    { designation: "Consort" },
    { designation: "Boys and SATB" },
    { designation: "Girls and SATB" },
    { designation: "Consort and SATB" },
    { designation: "Consort, Girls and SATB" },
    { designation: "Boys, Consort and Girls" },
    { designation: "Consort and Girls" },
    { designation: "Consort and Sopranos" },
    { designation: "Boys and Team A" },
    { designation: "Boys and Team B" },
    { designation: "Girls and Team A" },
    { designation: "Girls and Team B" },
    { designation: "Consort and Team A" },
    { designation: "Consort and Team B" },
  ],
  // September 2026. Children's numbers from Rachel Dent; adults counted off the
  // Minster Choir teams list for the same month.
  //
  // The Junior Choir (ages 5–8) is deliberately not here: they do not sing from
  // copies, so they can never make a box short.
  choirSections: {
    boys: 10,
    girls: 19,
    consort: 12,
    // Team A — 16 adults.
    teamA: { soprano: 2, alto: 5, tenor: 3, bass: 6 },
    // Team B — 17 adults.
    teamB: { soprano: 3, alto: 7, tenor: 4, bass: 3 },
  },
  servicePatterns: [
    { name: "Choral Eucharist", rite: "CW Order One", usualTime: "11:00" },
    { name: "Choral Evensong", rite: "BCP 1662", usualTime: "17:30" },
  ],
  categories: [
    { code: "A", label: "Anthem", blurb: "Anthems and motets, kept in boxes." },
    { code: "E", label: "Evening canticles", blurb: "Magnificat and Nunc dimittis settings." },
    { code: "M", label: "Morning canticles", blurb: "Te Deum, Benedictus, Jubilate." },
    { code: "C", label: "Communion setting", blurb: "Mass and Eucharist settings." },
    { code: "R", label: "Responses", blurb: "Preces and responses." },
    { code: "P", label: "Psalm chant", blurb: "Chants and pointed psalters." },
    { code: "X", label: "Carol", blurb: "Carols and Christmas music." },
    { code: "S", label: "Solo and other", blurb: "Solos, collections, major works and anything that fits nowhere else." },
  ],
  conditions: [
    { value: "fine", label: "Fine", guidance: "Clean and complete. Nothing to do." },
    { value: "average", label: "Average", guidance: "Used but usable. Some pencil, soft corners, a little foxing." },
    { value: "poor", label: "Poor", guidance: "Torn, loose or heavily marked. Still singable, but needs attention." },
    { value: "urgent", label: "Urgent", guidance: "Falling apart, damp, mouldy or missing pages. Tell James now." },
  ],
  // The church year, then the occasions that are not points in it. Every tag
  // in the v2 draft index falls inside this list; the importer flags anything
  // that does not, rather than inventing a new tag on the quiet.
  seasons: [
    { value: "advent", label: "Advent" },
    { value: "christmas", label: "Christmas" },
    { value: "epiphany", label: "Epiphany" },
    { value: "candlemas", label: "Candlemas" },
    { value: "lent", label: "Lent" },
    { value: "passiontide", label: "Passiontide" },
    { value: "holyweek", label: "Holy Week" },
    { value: "easter", label: "Easter" },
    { value: "ascension", label: "Ascension" },
    { value: "pentecost", label: "Pentecost" },
    { value: "trinity", label: "Trinity" },
    { value: "harvest", label: "Harvest" },
    { value: "remembrance", label: "Remembrance" },
    { value: "allsaints", label: "All Saints" },
    { value: "marian", label: "Marian" },
    { value: "saints", label: "Saints' days" },
    { value: "wedding", label: "Weddings" },
    { value: "funeral", label: "Funerals" },
    { value: "general", label: "General" },
  ],
  voiceParts: [
    { value: "soprano", label: "Soprano" },
    { value: "alto", label: "Alto" },
    { value: "tenor1", label: "Tenor 1" },
    { value: "tenor2", label: "Tenor 2" },
    { value: "bass1", label: "Bass 1" },
    { value: "bass2", label: "Bass 2" },
  ],
  storage: {
    // Eight cupboards, eight British diesel classes, by the nicknames the
    // enthusiasts actually use rather than the numbers. Deltic first because it
    // is Robert's favourite and A is the cupboard you reach first.
    doors: [
      { letter: "A", name: "Deltic", loco: "Class 55" },
      { letter: "B", name: "Western", loco: "Class 52" },
      { letter: "C", name: "Warship", loco: "Class 42" },
      { letter: "D", name: "Peak", loco: "Class 45" },
      { letter: "E", name: "Hymek", loco: "Class 35" },
      { letter: "F", name: "Whistler", loco: "Class 40" },
      { letter: "G", name: "Growler", loco: "Class 37" },
      { letter: "H", name: "Duff", loco: "Class 47" },
    ],
    maxShelf: 12,
  },
  copiesRag: {
    // Four in five with a copy is sharing; below that is a problem.
    amberProportion: 0.8,
  },
  descants: {
    rangeSize: 10,
    highestNumbered: 150,
    namedBinders: ["St Patrick's Breastplate", "Hymn Descants"],
  },
  stocktake: {
    yearsBetweenCounts: 5,
    performancesBetweenCounts: 10,
  },
  labels: {
    // Triplast A4 integrated label sheet: one 110×60mm peel-off label, placed
    // 10mm in from the left and 49mm down from the top. Everything below that
    // is plain paper for the volunteer to write on.
    volunteerSheet: {
      stock: "Triplast A4 integrated, 1 label 110×60mm",
      pageWidth: 210,
      pageHeight: 297,
      labelWidth: 110,
      labelHeight: 60,
      marginLeft: 10,
      marginTop: 49,
      columns: 1,
      rows: 1,
      columnGap: 0,
      rowGap: 0,
      safeMargin: 3,
    },
    // Avery L7163: 14 per sheet, 99.1×38.1mm, two columns of seven.
    //
    // Horizontal pitch is 101.6mm (four inches), so the gap between the columns
    // is 101.6 − 99.1 = 2.5mm. Vertical pitch is 38.1mm exactly, which is why
    // the rows butt up with no gap: 7 × 38.1 = 266.7mm, leaving 15.15mm top and
    // bottom on a 297mm page — matching Avery's published 15.1mm top margin.
    avery: {
      stock: "Avery L7163, 14 per sheet, 99.1×38.1mm",
      pageWidth: 210,
      pageHeight: 297,
      labelWidth: 99.1,
      labelHeight: 38.1,
      marginLeft: 5,
      marginTop: 15.1,
      columns: 2,
      rows: 7,
      columnGap: 2.5,
      rowGap: 0,
      safeMargin: 3,
    },
  },
  accession: {
    prefix: "BM-",
    digits: 4,
  },
  timezone: "Europe/London",
  youtubeChannelId: "UCmBo--MMq92JbInK3us7nKw",
  contact: {
    website: "https://beverleyminster.org.uk/",
    maintainer: {
      shortName: "James",
      email: "james@everinghampark.co.uk",
    },
  },
};
