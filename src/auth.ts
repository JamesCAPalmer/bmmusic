/**
 * Two gates, deliberately different.
 *
 *   - **The choir side** (browse, search, item pages, the volunteer portal)
 *     sits behind one shared password. There are no accounts: the choir is a
 *     known group of people who are told the password at the start of term,
 *     and rotating it is how somebody who has left stops getting in. The
 *     session is an HMAC-signed cookie — no server-side session store, so
 *     rotating `SESSION_SECRET` signs everybody out at once, which is exactly
 *     what the end of term wants.
 *
 *   - **`/admin`** sits behind Cloudflare Access. Access does the real gating
 *     at the edge, before the Worker runs; the check here is defence in depth,
 *     so that a route accidentally exposed by a future change fails closed
 *     rather than open. `ADMIN_MODE = "local"` opens it for `wrangler dev` and
 *     must never be set in production.
 *
 * Shape, constant-time comparisons and cookie flags follow `fobm-vestry`'s
 * `src/auth.ts`, the estate's auth template.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { checkChoirPassword, readPasswordState } from "./password";

const COOKIE_NAME = "bmmusic_session";
/**
 * A term is about fourteen weeks. Ninety days outlives that comfortably while
 * still expiring on its own if the password is never rotated.
 */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const FAILED_LOGIN_DELAY_MS = 1000;

/** The header Cloudflare Access puts on every request it lets through. */
const ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion";

type Ctx = Context<{ Bindings: Env }>;

// --- crypto helpers (WebCrypto only) ---

const enc = new TextEncoder();

async function hmacSha256(key: string, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two equal-length byte arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Compare two secrets in constant time without leaking length: HMAC both with
 * the session secret and compare the fixed-length digests.
 */
async function constantTimeSecretEqual(a: string, b: string, key: string): Promise<boolean> {
  const [da, db] = await Promise.all([hmacSha256(key, a), hmacSha256(key, b)]);
  return timingSafeEqual(new Uint8Array(da), new Uint8Array(db));
}

// --- session cookie ---

/**
 * The key a session cookie is signed with.
 *
 * `SESSION_SECRET`, plus the password generation. Rotating the secret in the
 * dashboard still signs everybody out — but so does changing the choir password
 * from the admin screen, because a different generation derives a different key
 * and every cookie already issued stops verifying. That is what makes the
 * termly rotation actually rotate: the chorister who left at Christmas has a
 * cookie good for ninety days, and it must stop working the moment the password
 * does.
 */
function signingKey(secret: string, generation: number): string {
  return `${secret}:g${generation}`;
}

/**
 * Build a signed session cookie: `expiry.generation.HMAC-SHA256(expiry.generation, key)`.
 *
 * The generation travels in the cookie as well as in the key so that an old
 * cookie fails on a signature check rather than by accident. Verification does
 * not trust it — the current generation is read from the database — but having
 * it there means a mismatched cookie is recognisably stale rather than merely
 * malformed.
 */
export async function createSessionValue(env: Env, generation = 0, now = Date.now()): Promise<string> {
  const secret = env.SESSION_SECRET ?? "";
  const expiry = String(now + SESSION_TTL_MS);
  const payload = `${expiry}.${generation}`;
  const sig = toHex(await hmacSha256(signingKey(secret, generation), payload));
  return `${payload}.${sig}`;
}

/**
 * Verify a session cookie: signature valid, not expired, and minted under the
 * current password generation.
 */
export async function verifySessionValue(
  env: Env,
  value: string | undefined,
  generation = 0,
  now = Date.now()
): Promise<boolean> {
  // With no secret configured nothing can be verified, so nothing is let in.
  if (!env.SESSION_SECRET) return false;
  if (!value) return false;

  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [expiryStr, generationStr, sig] = parts as [string, string, string];

  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < now) return false;

  // A cookie from an earlier generation is stale by definition: the password
  // has been changed since it was issued.
  if (Number(generationStr) !== generation) return false;

  const payload = `${expiryStr}.${generationStr}`;
  const expected = toHex(await hmacSha256(signingKey(env.SESSION_SECRET, generation), payload));
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(enc.encode(sig), enc.encode(expected));
}

export function sessionCookieHeader(value: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(c: Ctx, name: string): string | undefined {
  const header = c.req.header("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

// --- middleware ---

/**
 * Paths reachable without a session.
 *
 * `/robots.txt` is public on purpose, and so is `/asset/*` — the sign-in page
 * needs the Minster logo and the type faces before anybody has signed in. A
 * logo and a font reveal nothing about the library; every route that touches
 * the catalogue is still behind the gate.
 */
const PUBLIC_PATHS = new Set(["/login", "/logout", "/robots.txt"]);

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path) || path.startsWith("/asset/");
}

/**
 * Is this request allowed through the admin gate?
 *
 * In "access" mode (production) Cloudflare Access has already authenticated the
 * caller and stamped the assertion header. We do not verify the JWT here: the
 * Worker only ever sees requests that reached it through the Access-protected
 * hostname, so the header's presence is the signal, and verifying it would mean
 * fetching and caching Access's public keys for no gain in this threat model.
 * What it buys is failing closed if `/admin` is ever routed somewhere Access
 * does not cover.
 */
export function isAdminRequest(c: Ctx): boolean {
  if (c.env.ADMIN_MODE === "local") return true;
  return Boolean(c.req.header(ACCESS_ASSERTION_HEADER));
}

/** Who Access says this is, for stamping `reviewed_by` on the rows they confirm. */
export function adminIdentity(c: Ctx): string {
  return c.req.header("Cf-Access-Authenticated-User-Email") ?? "admin";
}

/**
 * The choir gate, plus the admin gate on `/admin`.
 *
 * Every response gets noindex headers: there are no public pages here, and a
 * catalogue of where several hundred pieces of music physically live is not
 * something to leave lying about for a crawler.
 */
export const authMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Admin routes: Cloudflare Access, checked before the choir session so that a
  // choir password can never reach the admin side.
  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!isAdminRequest(c)) {
      return c.text(
        "This page is for the music librarian and is protected separately. If you should have access, ask James.",
        403
      );
    }
    return next();
  }

  if (isPublicPath(path)) return next();

  // The current generation comes from the database, cached per isolate for a
  // minute (see src/password.ts) so this is not a D1 round trip per page load.
  const { generation } = await readPasswordState(c.env.DB);
  if (await verifySessionValue(c.env, readCookie(c, COOKIE_NAME), generation)) return next();

  // Not signed in: APIs get JSON 401, pages go to the password screen.
  if (path.startsWith("/api/")) {
    return c.json({ error: "Not signed in. Please sign in and try again." }, 401);
  }
  return c.redirect("/login", 302);
};

/**
 * Validate a submitted password.
 *
 * Kept as a thin wrapper over `src/password.ts` so the routes have one thing to
 * call. The stored hash wins; the `CHOIR_PASSWORD` secret is only consulted
 * before James has ever set a password from the admin screen.
 */
export async function checkPassword(env: Env, submitted: string): Promise<boolean> {
  return checkChoirPassword(env, env.DB, submitted);
}

export { FAILED_LOGIN_DELAY_MS, COOKIE_NAME, ACCESS_ASSERTION_HEADER };
