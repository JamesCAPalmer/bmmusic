/**
 * The Worker's bindings and secrets.
 *
 * Estate rule: bindings are configured in the Cloudflare dashboard, and
 * `wrangler.toml` carries names only. Nothing here is committed with a value.
 *
 * Data boundary: `DB` and `SCANS` are Minster-side bindings. Nothing belonging
 * to fobm-vestry / the Friends of Beverley Minster is bound to this Worker.
 */
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
