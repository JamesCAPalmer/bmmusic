import { describe, expect, it } from "vitest";
import { checkPassword, createSessionValue, verifySessionValue } from "../src/auth";
import type { Env } from "../src/env";

const env = {
  SESSION_SECRET: "test-session-secret",
  CHOIR_PASSWORD: "michaelmas anthem parcel",
} as unknown as Env;

describe("session cookie", () => {
  it("round-trips a freshly minted session", async () => {
    const value = await createSessionValue(env);
    expect(await verifySessionValue(env, value)).toBe(true);
  });

  it("rejects a tampered signature", async () => {
    const value = await createSessionValue(env);
    const tampered = value.slice(0, -1) + (value.endsWith("0") ? "1" : "0");
    expect(await verifySessionValue(env, tampered)).toBe(false);
  });

  it("rejects an expired session", async () => {
    const past = Date.now() - 120 * 24 * 60 * 60 * 1000; // minted 120 days ago
    const value = await createSessionValue(env, past);
    expect(await verifySessionValue(env, value)).toBe(false);
  });

  it("rejects a missing or malformed cookie", async () => {
    expect(await verifySessionValue(env, undefined)).toBe(false);
    expect(await verifySessionValue(env, "garbage")).toBe(false);
    expect(await verifySessionValue(env, ".")).toBe(false);
  });

  // Rotating SESSION_SECRET is how the end of term signs everybody out, so this
  // is the property the termly rotation actually depends on.
  it("rejects a session signed with a different secret", async () => {
    const value = await createSessionValue(env);
    const rotated = { ...env, SESSION_SECRET: "next-term" } as unknown as Env;
    expect(await verifySessionValue(rotated, value)).toBe(false);
  });

  it("verifies nothing when no secret is configured", async () => {
    const value = await createSessionValue(env);
    const unconfigured = { CHOIR_PASSWORD: "x" } as unknown as Env;
    expect(await verifySessionValue(unconfigured, value)).toBe(false);
  });
});

describe("checkPassword", () => {
  it("accepts the term's password", async () => {
    expect(await checkPassword(env, "michaelmas anthem parcel")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    expect(await checkPassword(env, "lent anthem parcel")).toBe(false);
  });

  it("rejects an empty password", async () => {
    expect(await checkPassword(env, "")).toBe(false);
  });

  // With no password configured the gate must be shut, not open.
  it("rejects everything when CHOIR_PASSWORD is unset", async () => {
    const unconfigured = { SESSION_SECRET: "s" } as unknown as Env;
    expect(await checkPassword(unconfigured, "")).toBe(false);
    expect(await checkPassword(unconfigured, "anything")).toBe(false);
  });
});
