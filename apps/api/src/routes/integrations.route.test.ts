// =============================================================================
// Settings → Integrations routes — with Slack and RingCentral faked
// =============================================================================
// What matters most: no secret ever leaves the server, settings save and are
// audited, the test button reports Slack's answer, and the channel list is
// cached (Slack rate-limits conversations.list hard).
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const audits: Array<{ action: string; metadata: unknown }> = [];
const tests: Array<{ channel: string; text: string }> = [];
let testReply: { ok: true; dryRun: boolean } | { ok: false; error: string } = { ok: true, dryRun: false };

vi.mock("../auth/middleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { oid: "oid-1", name: "Ana Admin" };
    next();
  },
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../audit/log.js", () => ({
  auditFromReq: (_req: unknown, action: string, opts: { metadata: unknown }) => audits.push({ action, metadata: opts.metadata }),
}));
vi.mock("../notify/slack.js", async (orig) => ({
  ...(await orig<typeof import("../notify/slack.js")>()),
  sendSlackTest: async (channel: string, text: string) => { tests.push({ channel, text }); return testReply; },
}));
vi.mock("../sms/check.js", () => ({
  TEN_DLC_NOTE: "10DLC note",
  checkRingCentral: async () => ({ ok: true, steps: [{ ok: true, label: "JWT signs in" }] }),
}));

const { registerIntegrationRoutes } = await import("./integrations.js");
const { initNotifySettings } = await import("../notify/settings.js");

const SECRETS = {
  SLACK_BOT_TOKEN: "xoxb-secret-token",
  RINGCENTRAL_CLIENT_ID: "rc-id-secret",
  RINGCENTRAL_CLIENT_SECRET: "rc-secret",
  RINGCENTRAL_JWT: "aaa.bbb.ccc",
};

let server: Server;
let base: string;
let tmp: string;
let slackCalls: string[] = [];

beforeEach(() => {
  audits.length = 0; tests.length = 0; slackCalls = [];
  testReply = { ok: true, dryRun: false };
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "notify-"));
  initNotifySettings(tmp);
  for (const [k, v] of Object.entries(SECRETS)) vi.stubEnv(k, v);
  vi.stubEnv("SLACK_MODE", "on");
  vi.stubEnv("SLACK_EVENTS_CHANNEL", "C1111111111");
  vi.stubEnv("SMS_MODE", "on");
  vi.stubEnv("RINGCENTRAL_FROM_NUMBER", "+18169942300");

  const app = express();
  app.use(express.json());
  registerIntegrationRoutes(app, {
    fetchImpl: async (url) => {
      const method = new URL(url).pathname.split("/").pop()!;
      slackCalls.push(method);
      const body = method === "auth.test"
        ? { ok: true, user: "quarterbot", team: "SCAAL" }
        : { ok: true, channels: [
            { id: "C2", name: "zeta", is_private: false, is_member: false },
            { id: "C1", name: "testing-grounds", is_private: true, is_member: true },
          ], response_metadata: { next_cursor: "" } };
      return new Response(JSON.stringify(body));
    },
  });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.close();
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const json = async (p: string, init?: RequestInit) => {
  const res = await fetch(`${base}${p}`, { headers: { "Content-Type": "application/json" }, ...init });
  return { status: res.status, text: await res.clone().text(), body: (await res.json()) as { data?: any; error?: string } };
};

describe("GET /api/settings/integrations", () => {
  it("reports both integrations without leaking a single secret", async () => {
    const r = await json("/api/settings/integrations");
    expect(r.status).toBe(200);
    expect(r.body.data.slack).toMatchObject({
      mode: "on", tokenSet: true, bot: { name: "quarterbot", team: "SCAAL" },
      envChannels: { events: "C1111111111", ops: null, alerts: null },
    });
    expect(r.body.data.slack.catalog.length).toBeGreaterThan(5);
    expect(r.body.data.sms).toMatchObject({ mode: "on", configured: true, fromNumber: "(816) 994-2300" });
    for (const secret of Object.values(SECRETS)) expect(r.text).not.toContain(secret);
  });
});

describe("PUT /api/settings/notify", () => {
  it("saves, audits, and is read back", async () => {
    const put = await json("/api/settings/notify", {
      method: "PUT",
      body: JSON.stringify({ events: { sms_sent: { enabled: false }, contract_signed: { enabled: true, channel: "C9999999999" } }, opsRepeatMinutes: 30 }),
    });
    expect(put.status).toBe(200);
    expect(audits).toEqual([{ action: "notify_settings.updated", metadata: { off: ["sms_sent"], rerouted: ["contract_signed→C9999999999"], opsRepeatMinutes: 30 } }]);
    const get = await json("/api/settings/integrations");
    expect(get.body.data.slack.settings.events.sms_sent.enabled).toBe(false);
    expect(get.body.data.slack.settings.opsRepeatMinutes).toBe(30);
  });
});

describe("POST /api/settings/integrations/slack/test", () => {
  it("posts to the chosen channel and names who pressed it", async () => {
    const r = await json("/api/settings/integrations/slack/test", { method: "POST", body: JSON.stringify({ channel: "C1111111111" }) });
    expect(r.status).toBe(200);
    expect(tests[0]!.channel).toBe("C1111111111");
    expect(tests[0]!.text).toContain("Ana Admin");
    expect(audits[0]!.action).toBe("slack.test_sent");
  });

  it("passes Slack's refusal back, and refuses a #name", async () => {
    testReply = { ok: false, error: "not_in_channel" };
    expect((await json("/api/settings/integrations/slack/test", { method: "POST", body: JSON.stringify({ channel: "C1111111111" }) })).body.error)
      .toBe("Slack: not_in_channel");
    expect((await json("/api/settings/integrations/slack/test", { method: "POST", body: JSON.stringify({ channel: "#general" }) })).status).toBe(400);
  });
});

describe("GET /api/settings/integrations/slack/channels", () => {
  it("lists channels the bot is in first, and caches the list", async () => {
    const r = await json("/api/settings/integrations/slack/channels");
    expect(r.body.data.map((c: { name: string }) => c.name)).toEqual(["testing-grounds", "zeta"]);
    await json("/api/settings/integrations/slack/channels");
    expect(slackCalls.filter((m) => m === "conversations.list")).toHaveLength(1);
    await json("/api/settings/integrations/slack/channels?refresh=1");
    expect(slackCalls.filter((m) => m === "conversations.list")).toHaveLength(2);
  });
});

describe("POST /api/settings/integrations/sms/check", () => {
  it("returns the check's steps", async () => {
    const r = await json("/api/settings/integrations/sms/check", { method: "POST" });
    expect(r.body.data).toEqual({ ok: true, steps: [{ ok: true, label: "JWT signs in" }] });
  });
});
