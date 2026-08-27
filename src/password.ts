/**
 * The choir password, changeable from the admin screen (11A).
 *
 * Until now the password lived in a Cloudflare secret, so rotating it at the
 * start of term meant James opening the dashboard. This moves it into
 * `app_setting`, hashed, and gives him a screen.
 *
 * Three decisions worth spelling out.
 *
 * **It is stored as a salted PBKDF2 hash, never in the clear.** The old
 * `CHOIR_PASSWORD` secret compared plaintext, which was defensible when only
 * Cloudflare could read it. A row in a shared Minster database is a different
 * proposition: `minster-data` is read by more than this app, and a password in
 * it would be a password anybody with database access could read.
 *
 * **Changing it signs everybody out.** That is the point of rotating it — the
 * chorister who left at Christmas should stop getting in. Sessions are HMAC
 * cookies with no server-side store, so there is nothing to delete; instead a
 * `password_generation` counter is mixed into the key the cookie is signed
 * with, and bumping it makes every cookie already issued fail to verify.
 *
 * **It falls back to the secret when no row exists.** First run has no
 * `app_setting` row, and the app must not lock the choir out between deploying
 * and James visiting the screen.
 */

import type { Env } from "./env";

/** `app_setting` keys. Named here so no screen invents its own spelling. */
export const PASSWORD_HASH_KEY = "choir_password_hash";
export const PASSWORD_GENERATION_KEY = "password_generation";

/**
 * PBKDF2 rounds.
 *
 * This runs on a Worker's CPU budget, at sign-in only, for a password a whole
 * choir shares and which changes termly. 100,000 is the usual floor for
 * SHA-256 and costs a few milliseconds here — cheap for the once-a-term
 * sign-in, and expensive enough to matter to somebody working through a stolen
 * database dump.
 */
const PBKDF2_ITERATIONS = 100_000;

const enc = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time compare. Both sides are hex digests of a fixed length. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256
  );
}

/**
 * Hash a new password for storage.
 *
 * Format: `pbkdf2$<iterations>$<salt hex>$<hash hex>`. The iteration count
 * travels with the hash so raising it later does not invalidate every password
 * already stored — an old hash still verifies at the count it was made with.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt.buffer as ArrayBuffer)}$${toHex(bits)}`;
}

/** Check a submitted password against a stored hash, in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 1000) return false;
  if (!/^[0-9a-f]+$/.test(parts[2] ?? "") || !/^[0-9a-f]+$/.test(parts[3] ?? "")) return false;

  const bits = await derive(password, fromHex(parts[2]!), iterations);
  return timingSafeEqual(new Uint8Array(bits), fromHex(parts[3]!));
}

// ---------------------------------------------------------------------------
// Reading and writing the setting
// ---------------------------------------------------------------------------

export interface PasswordState {
  /** The stored hash, or null when the app is still on the env secret. */
  hash: string | null;
  /** Bumped on every change. Mixed into the session key to sign everybody out. */
  generation: number;
}

/**
 * Read the password state.
 *
 * Cached per isolate for a short while: this is read on every gated request,
 * and a D1 round trip on every page load for a value that changes once a term
 * would be a poor trade. The cost is that a password change takes up to
 * `CACHE_TTL_MS` to sign everybody out — see `changePassword` below, which
 * clears the cache in the isolate that made the change.
 */
const CACHE_TTL_MS = 60_000;
let cached: { at: number; state: PasswordState } | null = null;

export function clearPasswordCache(): void {
  cached = null;
}

export async function readPasswordState(db: D1Database, now = Date.now()): Promise<PasswordState> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.state;

  const rows = await db
    .prepare(`SELECT key, value FROM app_setting WHERE key IN (?, ?)`)
    .bind(PASSWORD_HASH_KEY, PASSWORD_GENERATION_KEY)
    .all<{ key: string; value: string | null }>();

  const byKey = new Map((rows.results ?? []).map((r) => [r.key, r.value]));
  const generation = Number(byKey.get(PASSWORD_GENERATION_KEY) ?? "0");

  const state: PasswordState = {
    hash: byKey.get(PASSWORD_HASH_KEY) ?? null,
    generation: Number.isSafeInteger(generation) && generation >= 0 ? generation : 0,
  };

  cached = { at: now, state };
  return state;
}

/**
 * Set a new choir password.
 *
 * The generation bump and the hash are written in one batch: a hash without a
 * bump would leave old sessions alive, and a bump without a hash would sign
 * everybody out and then refuse the new password. D1 runs a batch in one
 * implicit transaction, so neither half can land alone.
 */
export async function changePassword(db: D1Database, password: string, who: string): Promise<number> {
  const current = await readPasswordState(db);
  const nextGeneration = current.generation + 1;
  const hash = await hashPassword(password);

  const upsert = (key: string, value: string) =>
    db
      .prepare(
        `INSERT INTO app_setting (key, value, updated_by) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           value = excluded.value, updated_by = excluded.updated_by,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
      )
      .bind(key, value, who);

  await db.batch([
    upsert(PASSWORD_HASH_KEY, hash),
    upsert(PASSWORD_GENERATION_KEY, String(nextGeneration)),
  ]);

  // This isolate at least stops honouring the old sessions immediately.
  clearPasswordCache();
  return nextGeneration;
}

/**
 * Check a submitted password.
 *
 * Prefers the stored hash. Falls back to the `CHOIR_PASSWORD` secret only when
 * nothing has been stored yet, which is first run — after James has set one
 * from the screen, the secret stops being consulted at all, so a stale secret
 * left in the dashboard cannot quietly keep working.
 */
export async function checkChoirPassword(env: Env, db: D1Database, submitted: string): Promise<boolean> {
  if (!submitted) return false;

  const state = await readPasswordState(db);
  if (state.hash) return verifyPassword(submitted, state.hash);

  if (!env.CHOIR_PASSWORD || !env.SESSION_SECRET) return false;
  // Constant-time comparison of two secrets without leaking length: HMAC both
  // and compare fixed-length digests. Same approach as the original gate.
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const [a, b] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(submitted)),
    crypto.subtle.sign("HMAC", key, enc.encode(env.CHOIR_PASSWORD)),
  ]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}
