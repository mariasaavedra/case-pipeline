// =============================================================================
// Token-fallback tests — the rule that keeps an under-scoped personal token
// from silently swallowing a staff member's edit.
// =============================================================================

import { describe, it, expect, vi } from "vitest";
import { AuthError, MondayApiError, RateLimitError } from "@case-pipeline/monday";
import { isPermissionError, withTokenFallback } from "./write-auth";

describe("isPermissionError", () => {
  it("treats 401/403 as a permission failure", () => {
    expect(isPermissionError(new AuthError("Authentication failed: 401 Unauthorized"))).toBe(true);
    expect(isPermissionError(new MondayApiError("API error: 403 Forbidden", 403))).toBe(true);
  });

  it("recognises a scope refusal returned as a GraphQL error on an HTTP 200", () => {
    // The shape Monday actually returns for a token issued without boards:write.
    const err = new MondayApiError(
      `Monday API errors: [{"message":"User unauthorized to perform action","extensions":{"code":"UserUnauthorizedException"}}]`,
    );
    expect(isPermissionError(err)).toBe(true);
  });

  it("does NOT treat a rate limit as a permission failure", () => {
    expect(isPermissionError(new RateLimitError("Rate limit exceeded", 60_000))).toBe(false);
  });

  it("does NOT treat a server error or a plain failure as a permission failure", () => {
    expect(isPermissionError(new MondayApiError("Server error: 502 Bad Gateway", 502, true))).toBe(false);
    expect(isPermissionError(new Error("fetch failed"))).toBe(false);
  });

  it("does not misread a validation error that merely mentions the item", () => {
    expect(isPermissionError(new MondayApiError("API error: 400 Bad Request", 400))).toBe(false);
  });
});

describe("withTokenFallback", () => {
  it("uses the personal token when it works, and does not touch the shared one", async () => {
    const write = vi.fn().mockResolvedValue("ok");
    const onRejected = vi.fn();

    const out = await withTokenFallback(write, {
      userToken: "personal",
      sharedToken: "shared",
      onPersonalTokenRejected: onRejected,
    });

    expect(write).toHaveBeenCalledExactlyOnceWith("personal");
    expect(out).toEqual({ result: "ok", usedPersonalToken: true, fellBackToSharedToken: false });
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("falls back to the shared token when the personal one is refused, and flags it", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new AuthError("Authentication failed: 403 Forbidden"))
      .mockResolvedValueOnce("ok");
    const onRejected = vi.fn();

    const out = await withTokenFallback(write, {
      userToken: "personal",
      sharedToken: "shared",
      onPersonalTokenRejected: onRejected,
    });

    expect(write).toHaveBeenNthCalledWith(1, "personal");
    expect(write).toHaveBeenNthCalledWith(2, "shared");
    expect(out).toEqual({ result: "ok", usedPersonalToken: false, fellBackToSharedToken: true });
    expect(onRejected).toHaveBeenCalledWith("Authentication failed: 403 Forbidden");
  });

  it("does NOT retry a transient failure with the shared token — the caller queues it", async () => {
    const err = new MondayApiError("Server error: 503 Service Unavailable", 503, true);
    const write = vi.fn().mockRejectedValue(err);

    await expect(
      withTokenFallback(write, { userToken: "personal", sharedToken: "shared" }),
    ).rejects.toThrow(err);
    expect(write).toHaveBeenCalledOnce();
  });

  it("rethrows when the personal token is refused and no shared token is configured", async () => {
    const write = vi.fn().mockRejectedValue(new AuthError("Authentication failed: 401"));
    const onRejected = vi.fn();

    await expect(
      withTokenFallback(write, { userToken: "personal", onPersonalTokenRejected: onRejected }),
    ).rejects.toThrow(AuthError);
    // Still worth flagging — the user's connection is genuinely broken.
    expect(onRejected).toHaveBeenCalled();
  });

  it("surfaces the shared token's own failure when the fallback also fails", async () => {
    const shared = new MondayApiError("API error: 400 Bad Request", 400);
    const write = vi
      .fn()
      .mockRejectedValueOnce(new AuthError("Authentication failed: 403"))
      .mockRejectedValueOnce(shared);

    await expect(
      withTokenFallback(write, { userToken: "personal", sharedToken: "shared" }),
    ).rejects.toThrow(shared);
  });

  it("goes straight to the shared token when the user has no personal connection", async () => {
    const write = vi.fn().mockResolvedValue("ok");

    const out = await withTokenFallback(write, { userToken: null, sharedToken: "shared" });

    expect(write).toHaveBeenCalledExactlyOnceWith("shared");
    expect(out).toEqual({ result: "ok", usedPersonalToken: false, fellBackToSharedToken: false });
  });
});
