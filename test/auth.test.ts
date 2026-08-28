import { describe, expect, it } from "vitest";
import { createSessionValue, verifySessionValue } from "../src/auth";
import { hashPassword, verifyPassword } from "../src/password";
import type { Env } from "../src/env";

const env = {
  SESSION_SECRET: "test-session-secret",
  CHOIR_PASSWORD: "michaelmas anthem box",
} as unknown as Env;

describe("session cookie", () => {
  it("round-trips a freshly minted session", async () => {
    const value = await createSessionValue(env, 0);
    expect(await verifySessionValue(env, value, 0)).toBe(true);
  });

  it("rejects a tampered signature", async () => {
    const value = await createSessionValue(env, 0);
    const tampered = value.slice(0, -1) + (value.endsWith("0") ? "1" : "0");
    expect(await verifySessionValue(env, tampered, 0)).toBe(false);
  });

  it("rejects an expired session", async () => {
    const past = Date.now() - 120 * 24 * 60 * 60 * 1000; // minted 120 days ago
    const value = await createSessionValue(env, 0, past);
    expect(await verifySessionValue(env, value, 0)).toBe(false);
  });

  it("rejects a missing or malformed cookie", async () => {
    expect(await verifySessionValue(env, undefined, 0)).toBe(false);
    expect(await verifySessionValue(env, "garbage", 0)).toBe(false);
    expect(await verifySessionValue(env, ".", 0)).toBe(false);
    expect(await verifySessionValue(env, "1.2", 0)).toBe(false);
    expect(await verifySessionValue(env, "1.2.3.4", 0)).toBe(false);
  });

  // Rotating SESSION_SECRET is how a lost laptop signs everybody out, so this
  // is the property that emergency depends on.
  it("rejects a session signed with a different secret", async () => {
    const value = await createSessionValue(env, 0);
    const rotated = { ...env, SESSION_SECRET: "next-term" } as unknown as Env;
    expect(await verifySessionValue(rotated, value, 0)).toBe(false);
  });

  it("verifies nothing when no secret is configured", async () => {
    const value = await createSessionValue(env, 0);
    const unconfigured = { CHOIR_PASSWORD: "x" } as unknown as Env;
    expect(await verifySessionValue(unconfigured, value, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

/**
 * The property the whole self-service password screen rests on (11A).
 *
 * Sessions are HMAC cookies with no server-side store, so there is nothing to
 * delete when the password changes. Instead the generation counter is mixed
 * into the signing key. If these fail, changing the password on the admin
 * screen would leave every existing session alive — and the chorister who left
 * at Christmas would keep getting in for ninety days.
 */
describe("password generation invalidates sessions", () => {
  it("rejects a session minted under the previous generation", async () => {
    const before = await createSessionValue(env, 3);
    expect(await verifySessionValue(env, before, 3)).toBe(true);
    expect(await verifySessionValue(env, before, 4)).toBe(false);
  });

  it("rejects a session from a later generation too", async () => {
    const ahead = await createSessionValue(env, 9);
    expect(await verifySessionValue(env, ahead, 4)).toBe(false);
  });

  it("keeps issuing usable sessions after a change", async () => {
    const after = await createSessionValue(env, 4);
    expect(await verifySessionValue(env, after, 4)).toBe(true);
  });

  // Editing the generation in the cookie must not get anybody in: it is signed
  // as part of the payload, and the key is derived from it as well.
  it("cannot be fooled by editing the generation in the cookie", async () => {
    const old = await createSessionValue(env, 3);
    const [expiry, , sig] = old.split(".");
    const forged = `${expiry}.4.${sig}`;
    expect(await verifySessionValue(env, forged, 4)).toBe(false);
  });

  it("survives many rotations without collision", async () => {
    for (const generation of [0, 1, 2, 17, 512]) {
      const value = await createSessionValue(env, generation);
      expect(await verifySessionValue(env, value, generation)).toBe(true);
      expect(await verifySessionValue(env, value, generation + 1)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------

describe("hashing the choir password", () => {
  it("accepts the password it was made from", async () => {
    const hash = await hashPassword("michaelmas anthem box");
    expect(await verifyPassword("michaelmas anthem box", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("michaelmas anthem box");
    expect(await verifyPassword("lent anthem box", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  // A shared password in a shared database must not be readable by anybody who
  // can read the database.
  it("stores no trace of the password itself", async () => {
    const hash = await hashPassword("michaelmas anthem box");
    expect(hash).not.toContain("michaelmas");
    expect(hash).not.toContain("anthem");
    expect(hash.startsWith("pbkdf2$")).toBe(true);
  });

  it("salts, so the same password twice gives two different hashes", async () => {
    const a = await hashPassword("michaelmas anthem box");
    const b = await hashPassword("michaelmas anthem box");
    expect(a).not.toBe(b);
    expect(await verifyPassword("michaelmas anthem box", b)).toBe(true);
  });

  // The iteration count travels with the hash, so raising it later does not
  // invalidate every password already stored.
  it("verifies a hash made at a different iteration count", async () => {
    const hash = await hashPassword("x");
    const [scheme, iterations, salt, digest] = hash.split("$");
    expect(scheme).toBe("pbkdf2");
    expect(Number(iterations)).toBeGreaterThanOrEqual(100_000);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a stored value that is not one of ours", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plaintext-password")).toBe(false);
    expect(await verifyPassword("x", "md5$1$aa$bb")).toBe(false);
    // A derisory iteration count is not a hash we are prepared to honour.
    expect(await verifyPassword("x", "pbkdf2$1$aa$bb")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2$100000$notahexsalt$bb")).toBe(false);
  });
});
