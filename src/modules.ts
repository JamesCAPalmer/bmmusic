/**
 * Modules: which parts of the app exist at all.
 *
 * The library and the services are what bmmusic already is, and they are on.
 * Everything the register brought with it — people, attendance, the
 * safeguarding rota, wardrobe, awards, the junior choir — ships **off**, and
 * stays off until somebody deliberately turns it on from the Modules screen.
 *
 * **A disabled module's routes answer 404, not 403.** A 403 says "there is
 * something here and you may not have it", which is a fact about the choir
 * worth not publishing; a 404 says nothing at all. Dark means dark. This is
 * also why the admin front page renders no tile for a module that is off:
 * a door that is not there does not need a lock.
 *
 * Everything above `readModuleState` is pure — a table and the functions that
 * read it — so the mapping from a path to a module can be tested exhaustively
 * without a database. That matters more here than it looks: this table is the
 * single thing standing between a new route and an ungated one.
 */

/** The eight modules, as the addendum names them. */
export const MODULE_KEYS = [
  "library",
  "services",
  "people",
  "attendance",
  "safeguarding",
  "wardrobe",
  "awards",
  "jc",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/** The `app_setting` key a module's flag lives under. */
export function settingKeyFor(module: ModuleKey): string {
  return `module.${module}`;
}

export interface ModuleInfo {
  key: ModuleKey;
  label: string;
  /** One line for the Modules screen, in the same voice as the rest of the app. */
  blurb: string;
  /** What it ships as. Migration 0003 writes exactly these. */
  defaultOn: boolean;
  /** True when the module holds data about identifiable people. */
  personal: boolean;
}

export const MODULES: readonly ModuleInfo[] = [
  {
    key: "library",
    label: "The music library",
    blurb: "The catalogue itself: pieces, copies, scans, labels and repairs.",
    defaultOn: true,
    personal: false,
  },
  {
    key: "services",
    label: "Services and music lists",
    blurb: "The month's services from the service app, and matching their music to parcels.",
    defaultOn: true,
    personal: false,
  },
  {
    key: "people",
    label: "The choir",
    blurb: "Who sings in which choir. Holds children's names.",
    defaultOn: false,
    personal: true,
  },
  {
    key: "attendance",
    label: "The register",
    blurb: "Who turned up, service by service, and the quarterly totals pay is worked out from.",
    defaultOn: false,
    personal: true,
  },
  {
    key: "safeguarding",
    label: "The duty rota",
    blurb: "Robing, general and dismissal duties, who is covering them, and the collection tick.",
    defaultOn: false,
    personal: true,
  },
  {
    key: "wardrobe",
    label: "Robes",
    blurb: "Surplice sizes and what has been issued.",
    defaultOn: false,
    personal: true,
  },
  {
    key: "awards",
    label: "Awards",
    blurb: "Surplicing, Dean's, Archbishop's and gold awards, and the dates they were given.",
    defaultOn: false,
    personal: true,
  },
  {
    key: "jc",
    label: "Junior choir",
    blurb: "The junior choir register. Admin only — they do not sing from music.",
    defaultOn: false,
    personal: true,
  },
];

// ---------------------------------------------------------------------------
// Which module owns which path
// ---------------------------------------------------------------------------

/**
 * Route prefixes, longest first.
 *
 * Longest-first matters: `/admin/people/register` belongs to the register, not
 * to the choir list it sits inside, and the two are separate switches. Ordering
 * the table by descending prefix length rather than by hand means a rule added
 * carelessly at the bottom still resolves correctly.
 *
 * A path with no rule belongs to no module and is therefore never dark. That is
 * the right default for `/admin` itself and for the screens that administer the
 * app rather than the choir — but it is *not* a way past the roles below, which
 * every `/admin` path answers to.
 */
const MODULE_PREFIXES: ReadonlyArray<readonly [string, ModuleKey]> = [
  // People and everything about them. `/admin/people/register` first by length.
  ["/admin/people/register", "attendance"],
  ["/admin/people/awards", "awards"],
  ["/admin/people/robes", "wardrobe"],
  ["/admin/people/jc", "jc"],
  ["/admin/people", "people"],
  ["/admin/safeguarding", "safeguarding"],

  // The library.
  ["/admin/accessions", "library"],
  ["/admin/suggestions", "library"],
  ["/admin/stocktake", "library"],
  ["/admin/reports", "library"],
  ["/admin/labels", "library"],
  ["/admin/queues", "library"],
  ["/admin/review", "library"],
  ["/admin/search", "library"],
  ["/admin/intake", "library"],
  ["/admin/import", "library"],
  ["/admin/scans", "library"],
  ["/admin/loans", "library"],
  ["/admin/piece", "library"],
  ["/admin/new", "library"],

  // Services and music lists.
  ["/admin/services", "services"],
];

/** The prefixes, sorted longest first so the most specific rule wins. */
const SORTED_PREFIXES = [...MODULE_PREFIXES].sort((a, b) => b[0].length - a[0].length);

/**
 * Which module owns this path, or null if none does.
 *
 * Matching is on a path *segment* boundary: `/admin/newsletter` must not be
 * caught by the `/admin/new` rule, or a future route would go dark for reasons
 * nobody could find.
 */
export function moduleForPath(path: string): ModuleKey | null {
  for (const [prefix, module] of SORTED_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return module;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading and writing the flags
// ---------------------------------------------------------------------------

export type ModuleState = Readonly<Record<ModuleKey, boolean>>;

/** The state a database with no rows at all would imply. */
export function defaultModuleState(): ModuleState {
  const state = {} as Record<ModuleKey, boolean>;
  for (const m of MODULES) state[m.key] = m.defaultOn;
  return state;
}

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/**
 * Read every module flag.
 *
 * A missing row falls back to the module's default rather than to "on": a
 * database that has not had 0003 applied, or a module added in a later
 * migration, must not switch a person-data screen on by accident.
 */
export async function readModuleState(db: D1Database): Promise<ModuleState> {
  const state = { ...defaultModuleState() } as Record<ModuleKey, boolean>;
  try {
    const rows = await db
      .prepare(`SELECT key, value FROM app_setting WHERE key LIKE 'module.%'`)
      .all<{ key: string; value: string }>();
    for (const row of rows.results ?? []) {
      const key = row.key.slice("module.".length);
      if (isModuleKey(key)) state[key] = row.value === "on";
    }
  } catch (e) {
    // A failed read must not open a module. Fall back to the defaults, which
    // are dark for everything personal.
    console.error("module state read failed", e);
  }
  return state;
}

/** Turn one module on or off. The caller writes the audit line. */
export async function setModule(db: D1Database, module: ModuleKey, on: boolean, by: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_setting (key, value, updated_by, updated_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT (key) DO UPDATE SET
         value = excluded.value,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`
    )
    .bind(settingKeyFor(module), on ? "on" : "off", by)
    .run();
}
