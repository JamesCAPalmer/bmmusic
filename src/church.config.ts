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
  /** Plain-English guidance for the volunteer holding the parcel. */
  guidance: string;
}

export interface ChurchConfig {
  /** Full public name of the institution. */
  name: string;
  /** Short name used in running prose ("the Minster"). */
  shortName: string;
  /** Name of this app, as it appears in the interface. */
  appName: string;
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
    /** Room the parcels and boxes are kept in. */
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
  /** Regular choral service patterns. */
  servicePatterns: ServicePattern[];
  /** The catalogue's categories, in the order they are offered. */
  categories: CategoryDefinition[];
  /** Condition grades, worst last. */
  conditions: ConditionGrade[];
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
  appName: "Minster Music Library",
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
  // Typical singer counts to be filled in by the maintainer as they are
  // confirmed — omit rather than guess. These seed the choir_profile table.
  choirs: [
    { designation: "Boys and SATB" },
    { designation: "Girls" },
    { designation: "ATB" },
    { designation: "Consort" },
  ],
  servicePatterns: [
    { name: "Choral Eucharist", rite: "CW Order One", usualTime: "11:00" },
    { name: "Choral Evensong", rite: "BCP 1662", usualTime: "17:30" },
  ],
  categories: [
    { code: "A", label: "Anthem", blurb: "Anthems and motets, kept in wrapped parcels." },
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
