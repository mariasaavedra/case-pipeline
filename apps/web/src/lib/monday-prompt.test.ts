import { describe, expect, it } from "vitest";
import { MONDAY_PROMPT_SNOOZE_MS, shouldPromptMondayConnect } from "./monday-prompt";

const NOW = 1_800_000_000_000;

describe("shouldPromptMondayConnect", () => {
  it("asks when not connected", () => {
    expect(shouldPromptMondayConnect({ oauthConfigured: true, connected: false }, null, NOW)).toBe(true);
  });

  it("asks when Monday refuses the existing connection", () => {
    expect(
      shouldPromptMondayConnect({ oauthConfigured: true, connected: true, needsReconnect: true }, null, NOW),
    ).toBe(true);
  });

  it("stays quiet for a working connection", () => {
    expect(shouldPromptMondayConnect({ oauthConfigured: true, connected: true }, null, NOW)).toBe(false);
  });

  it("stays quiet when the server can't run the OAuth flow", () => {
    expect(shouldPromptMondayConnect({ oauthConfigured: false, connected: false }, null, NOW)).toBe(false);
  });

  it("asks when an older API omits oauthConfigured", () => {
    expect(shouldPromptMondayConnect({ connected: false }, null, NOW)).toBe(true);
  });

  it("respects 'Not now' until the snooze runs out", () => {
    const status = { oauthConfigured: true, connected: false };
    expect(shouldPromptMondayConnect(status, NOW - 60_000, NOW)).toBe(false);
    expect(shouldPromptMondayConnect(status, NOW - MONDAY_PROMPT_SNOOZE_MS, NOW)).toBe(true);
  });
});
