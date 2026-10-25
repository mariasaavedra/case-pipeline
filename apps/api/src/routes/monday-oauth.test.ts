import { describe, it, expect, vi, afterEach } from "vitest";

// users.db is opened at import; these tests only exercise the state rules.
vi.mock("../db/users-db.js", () => ({ usersDb: { prepare: () => ({ run: () => undefined, get: () => undefined }) } }));

import { signState, verifyState, readCookie, safeReturnPath, NONCE_COOKIE } from "./monday-oauth.js";

const SECRET = "test-client-secret";

describe("Monday OAuth state", () => {
  afterEach(() => vi.useRealTimers());

  it("verifies a state for the browser holding its nonce", () => {
    const state = signState("oid-1", "/clients/7", "nonce-a", SECRET);
    expect(verifyState(state, "nonce-a", SECRET)).toEqual({ azureOid: "oid-1", returnTo: "/clients/7" });
  });

  // The forwarded-consent-link case: the state is real, but this browser never started it.
  it("refuses a state when the cookie is missing or belongs to another flow", () => {
    const state = signState("oid-1", "/settings", "nonce-a", SECRET);
    expect(verifyState(state, null, SECRET)).toBeNull();
    expect(verifyState(state, "nonce-b", SECRET)).toBeNull();
  });

  it("refuses a tampered, foreign-signed or expired state", () => {
    const state = signState("oid-1", "/settings", "n", SECRET);
    const decoded = Buffer.from(state, "base64url").toString();
    const tampered = Buffer.from(decoded.replace("oid-1", "oid-2")).toString("base64url");
    expect(verifyState(tampered, "n", SECRET)).toBeNull();
    expect(verifyState(signState("oid-1", "/settings", "n", "other-secret"), "n", SECRET)).toBeNull();
    expect(verifyState(state, "n", "")).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(verifyState(state, "n", SECRET)).toBeNull();
  });

  it("refuses a state with no account in it", () => {
    expect(verifyState(signState("", "/settings", "n", SECRET), "n", SECRET)).toBeNull();
  });

  it("keeps the return path on this site", () => {
    const state = signState("oid-1", safeReturnPath("//evil.example"), "n", SECRET);
    expect(verifyState(state, "n", SECRET)?.returnTo).toBe("/settings");
  });

  it("reads its cookie out of a Cookie header", () => {
    expect(readCookie(`a=1; ${NONCE_COOKIE}=abc%2Ddef; b=2`, NONCE_COOKIE)).toBe("abc-def");
    expect(readCookie("a=1", NONCE_COOKIE)).toBeNull();
    expect(readCookie(undefined, NONCE_COOKIE)).toBeNull();
  });
});
