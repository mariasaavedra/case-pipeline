import { describe, it, expect, beforeEach } from "vitest";
import { encryptString, decryptString, isEncrypted, protect, reveal } from "./secrets.js";

describe("secrets", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = "test-passphrase-do-not-use-in-prod";
  });

  it("round-trips a value through encrypt/decrypt", () => {
    const plain = "eyJ0eXAiOiJKV1Qif0.monday-token.abc123";
    const enc = encryptString(plain);
    expect(enc).not.toBe(plain);
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptString(enc)).toBe(plain);
  });

  it("produces a different ciphertext each time (random salt/iv)", () => {
    expect(encryptString("same")).not.toBe(encryptString("same"));
  });

  it("passes legacy plaintext through decryptString unchanged", () => {
    expect(isEncrypted("legacy-plain-token")).toBe(false);
    expect(decryptString("legacy-plain-token")).toBe("legacy-plain-token");
  });

  it("protect() stores plaintext (and reveal() reads it) when no key is set", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    const out = protect("no-key-value");
    expect(out).toBe("no-key-value");
    expect(reveal(out)).toBe("no-key-value");
  });

  it("encryptString throws without a key", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => encryptString("x")).toThrow();
  });
});
