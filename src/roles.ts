/**
 * In-app roles, on top of Cloudflare Access.
 *
 * Access answers one question: may this person reach `/admin` at all? That is
 * not the same question as: may this person see a child's telephone number.
 * Six people hold a Librarian policy in Access so that the physical library can
 * be catalogued by whoever is in the song school that afternoon; none of that
 * is a reason to hand them the register.
 *
 * So there are three roles, and every `/admin` path answers to one of them:
 *
 *   - **librarian** — the music library and the service music lists. The
 *     catalogue, labels, scans, repairs, loans, reports. No person data.
 *   - **music_staff** — everything about people: the choir list, the register,
 *     pay, awards, robes, the junior choir, and the screens that administer the
 *     app itself (settings, modules, roles, exports).
 *   - **safeguarding** — the duty rota and the on-the-day duty view.
 *
 * Identity is still `Cf-Access-Authenticated-User-Email`, trusted only where
 * Access has demonstrably run. This file never reads a header; it is given an
 * email and answers about it.
 *
 * Everything above `readRoles` is pure, so the path-to-role mapping can be
 * tested exhaustively. `requiredRolesFor` **fails closed**: a path it has never
 * heard of needs `music_staff`, which is the narrowest grant there is. A new
 * route that nobody remembered to add to the table is therefore locked down
 * rather than open, and the first person to hit it finds out immediately.
 */

export const ROLES = ["librarian", "music_staff", "safeguarding"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** How a role is described on the Roles screen. */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  librarian: "Librarian",
  music_staff: "Music staff",
  safeguarding: "Safeguarding",
};

export const ROLE_BLURBS: Readonly<Record<Role, string>> = {
  librarian: "The music library: catalogue, labels, scans, repairs, loans, and the service music lists.",
  music_staff: "Everything about people — the choir, the register, pay, awards, robes — and the app's own settings.",
  safeguarding: "The duty rota and the on-the-day duty view. No access to pay or to the catalogue.",
};

// ---------------------------------------------------------------------------
// Which roles may reach which path
// ---------------------------------------------------------------------------

/** The library and the music lists: either a librarian or music staff. */
const LIBRARY: readonly Role[] = ["librarian", "music_staff"];
/** People, pay, awards, robes, and the app's own administration. */
const STAFF: readonly Role[] = ["music_staff"];
/** The rota: the people who run it, and the staff who own it. */
const ROTA: readonly Role[] = ["safeguarding", "music_staff"];

const ROLE_PREFIXES: ReadonlyArray<readonly [string, readonly Role[]]> = [
  // Everything about a person. `/admin/people*` and `/admin/safeguarding*` are
  // the only two prefixes children's data appears under, so a second and
  // tighter Cloudflare Access application can be scoped to exactly these.
  ["/admin/people", STAFF],
  ["/admin/safeguarding", ROTA],

  // The app's own administration.
  ["/admin/settings", STAFF],
  ["/admin/modules", STAFF],
  ["/admin/roles", STAFF],
  ["/admin/activity", STAFF],
  ["/admin/export", STAFF],

  // The library and the music lists.
  ["/admin/accessions", LIBRARY],
  ["/admin/suggestions", LIBRARY],
  ["/admin/stocktake", LIBRARY],
  ["/admin/services", LIBRARY],
  ["/admin/feedback", LIBRARY],
  ["/admin/reports", LIBRARY],
  ["/admin/labels", LIBRARY],
  ["/admin/queues", LIBRARY],
  ["/admin/review", LIBRARY],
  ["/admin/search", LIBRARY],
  ["/admin/intake", LIBRARY],
  ["/admin/import", LIBRARY],
  ["/admin/scans", LIBRARY],
  ["/admin/loans", LIBRARY],
  ["/admin/piece", LIBRARY],
  ["/admin/new", LIBRARY],
  ["/admin/api", LIBRARY],
];

const SORTED_ROLE_PREFIXES = [...ROLE_PREFIXES].sort((a, b) => b[0].length - a[0].length);

/**
 * Which roles may reach this path. Never empty.
 *
 * `/admin` itself is the front page and needs only *a* role — it renders the
 * tiles the caller may actually walk through, and an admin with no roles never
 * gets that far (see `hasAnyRole`).
 *
 * Anything unrecognised needs `music_staff`. See the note at the top: failing
 * closed is what makes forgetting to add a rule a visible mistake instead of a
 * silent hole.
 */
export function requiredRolesFor(path: string): readonly Role[] {
  if (path === "/admin" || path === "/admin/") return ROLES;
  for (const [prefix, roles] of SORTED_ROLE_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return roles;
  }
  return STAFF;
}

/** Does this set of roles satisfy that requirement? */
export function permits(held: readonly Role[], required: readonly Role[]): boolean {
  return required.some((role) => held.includes(role));
}

/** May this caller reach `/admin` at all, roles aside from Access? */
export function hasAnyRole(held: readonly Role[]): boolean {
  return held.length > 0;
}

// ---------------------------------------------------------------------------
// Reading and writing grants
// ---------------------------------------------------------------------------

export interface RoleGrant {
  email: string;
  role: Role;
  granted_by: string | null;
  granted_at: string;
}

/**
 * The roles held by one email.
 *
 * A failed read returns no roles rather than throwing: the caller then sees the
 * "ask a music staff member" page, which is the safe end of the failure. It is
 * also the reason this never caches — a revoked role must stop working at once,
 * and one indexed lookup per admin request is not a cost worth optimising.
 */
export async function readRoles(db: D1Database, email: string): Promise<Role[]> {
  try {
    const rows = await db
      .prepare(`SELECT role FROM admin_role WHERE email = ?`)
      .bind(email)
      .all<{ role: string }>();
    return (rows.results ?? []).map((r) => r.role).filter(isRole);
  } catch (e) {
    console.error("role read failed", e);
    return [];
  }
}

/** Every grant, for the Roles screen. */
export async function listGrants(db: D1Database): Promise<RoleGrant[]> {
  const rows = await db
    .prepare(`SELECT email, role, granted_by, granted_at FROM admin_role ORDER BY email, role`)
    .all<RoleGrant>();
  return (rows.results ?? []).filter((r) => isRole(r.role));
}

/** Grant a role. Idempotent; the caller writes the audit line. */
export async function grantRole(db: D1Database, email: string, role: Role, by: string): Promise<void> {
  await db
    .prepare(`INSERT OR IGNORE INTO admin_role (email, role, granted_by) VALUES (?, ?, ?)`)
    .bind(email, role, by)
    .run();
}

/** Revoke a role. The caller writes the audit line. */
export async function revokeRole(db: D1Database, email: string, role: Role): Promise<void> {
  await db.prepare(`DELETE FROM admin_role WHERE email = ? AND role = ?`).bind(email, role).run();
}

/**
 * How many people still hold `music_staff`.
 *
 * The Roles screen refuses to revoke the last one. Without a music_staff there
 * is nobody who can grant anybody anything, the Roles screen is itself
 * music_staff-only, and the only way back is a migration — so the app must not
 * let somebody walk into that by unticking a box.
 */
export async function countMusicStaff(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT count(*) AS n FROM admin_role WHERE role = 'music_staff'`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
