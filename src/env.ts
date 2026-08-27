/**
 * The Worker's bindings and secrets.
 *
 * Estate rule: bindings are configured in the Cloudflare dashboard, and
 * `wrangler.toml` carries names only. Nothing here is committed with a value.
 *
 * Data boundary: `DB` and `SCANS` are Minster-side bindings. Nothing belonging
 * to fobm-vestry / the Friends of Beverley Minster is bound to this Worker.
 */
import type { ModuleState } from "./modules";
import type { Role } from "./roles";

export interface Env {
  /** D1 database `minster-data`. */
  DB: D1Database;
  /** R2 bucket `bmmusic-scans`. Created at deploy time — see README. */
  SCANS?: R2Bucket;

  /**
   * "access" (production) — /admin requires a Cloudflare Access assertion.
   * "local"  — /admin is open. `wrangler dev` only; never set in production.
   */
  ADMIN_MODE?: string;

  /** The shared choir password. Rotated each term (README). */
  CHOIR_PASSWORD?: string;
  /** HMAC key for the session cookie. Rotating it signs everyone out. */
  SESSION_SECRET?: string;
  /** Optional: photo intake reads labels with it, and degrades without it. */
  ANTHROPIC_API_KEY?: string;
}

/**
 * What the admin gate works out once per request, and everything after it can
 * read: which modules exist, and what this administrator may do.
 *
 * Only `/admin` requests pass through the gate, so on the choir side these are
 * unset — which is why nothing outside `/admin` reads them.
 */
export interface AdminVars {
  modules: ModuleState;
  roles: Role[];
}

/**
 * The Hono environment, in one place.
 *
 * Every `Hono<>`, `Context<>` and `MiddlewareHandler<>` in the app names this
 * type rather than spelling out its own. That is not tidiness: a helper typed
 * with a narrower environment than the app's stops accepting the app's own
 * context the moment a variable is added, and the fix is invariably to widen
 * the helper — which is what this makes automatic.
 */
export type AppEnv = { Bindings: Env; Variables: AdminVars };
