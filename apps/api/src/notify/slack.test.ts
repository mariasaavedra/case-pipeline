import { describe, it, expect } from "vitest";
import { createSlackNotifier, slackEscape, slackMode, mondayItemUrl, appUrl, withLink } from "./slack.js";
import { defaultNotifySettings, sanitizeNotifySettings, type NotifySettings } from "./settings.js";

function harness(env: NodeJS.ProcessEnv, reply: unknown = { ok: true }, settings: NotifySettings = defaultNotifySettings()) {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth?: string }> = [];
  const logs: string[] = [];
  let now = 0;
  const n = createSlackNotifier({
    env,
    settings: () => settings,
    now: () => now,
    log: (m) => logs.push(m),
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify(reply), { status: 200 });
    },
  });
  return { n, calls, logs, advance: (ms: number) => { now += ms; } };
}

const ON = { SLACK_MODE: "on", SLACK_BOT_TOKEN: "xoxb-1", SLACK_EVENTS_CHANNEL: "C1111111111", SLACK_OPS_CHANNEL: "C2222222222" };

describe("slackMode", () => {
  it("defaults to off", () => {
    expect(slackMode({})).toBe("off");
    expect(slackMode({ SLACK_MODE: "On" })).toBe("on");
    expect(slackMode({ SLACK_MODE: "maybe" })).toBe("off");
  });
});

describe("notifyEvent", () => {
  it("posts to the kind's channel with the bot token, no link previews", async () => {
    const h = harness(ON);
    expect(await h.n.notifyEvent("consult_prepped", "hello")).toBe(true);
    expect(h.calls).toEqual([{
      url: "https://slack.com/api/chat.postMessage",
      auth: "Bearer xoxb-1",
      body: { channel: "C1111111111", text: "hello", unfurl_links: false, unfurl_media: false },
    }]);
  });

  it("off posts nothing; dry-run only logs", async () => {
    const off = harness({ ...ON, SLACK_MODE: "off" });
    expect(await off.n.notifyEvent("sms_sent", "x")).toBe(false);
    const dry = harness({ ...ON, SLACK_MODE: "dry-run" });
    expect(await dry.n.notifyEvent("sms_sent", "x")).toBe(true);
    expect(dry.calls).toHaveLength(0);
    expect(dry.logs).toEqual(["[slack] DRY RUN → events (C1111111111): x"]);
  });

  it("an event turned off in Settings posts nothing", async () => {
    const s = sanitizeNotifySettings({ events: { sms_sent: { enabled: false } } });
    const h = harness(ON, { ok: true }, s);
    expect(await h.n.notifyEvent("sms_sent", "x")).toBe(false);
    expect(await h.n.notifyEvent("mail_scanned", "y")).toBe(true);
    expect(h.calls).toHaveLength(1);
  });

  it("an event sent to its own channel in Settings goes there", async () => {
    const s = sanitizeNotifySettings({ events: { contract_signed: { enabled: true, channel: "C9999999999" } } });
    const h = harness(ON, { ok: true }, s);
    await h.n.notifyEvent("contract_signed", "x");
    await h.n.notifyEvent("consult_prepped", "y");
    expect(h.calls.map((c) => c.body.channel)).toEqual(["C9999999999", "C1111111111"]);
  });

  it("Slack's ok:false is logged, not thrown", async () => {
    const h = harness(ON, { ok: false, error: "not_in_channel" });
    expect(await h.n.notifyEvent("sms_sent", "x")).toBe(false);
    expect(h.logs).toEqual(["[slack] events post refused: not_in_channel"]);
  });

  it("a network error is logged, not thrown", async () => {
    const n = createSlackNotifier({
      env: ON,
      settings: defaultNotifySettings,
      log: () => {},
      fetchImpl: async () => { throw new Error("ECONNRESET"); },
    });
    await expect(n.notifyEvent("sms_sent", "x")).resolves.toBe(false);
  });

  it("events fall back to the old Incoming Webhook when no channel is set — even with SLACK_MODE off", async () => {
    const h = harness({ SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X" });
    expect(await h.n.notifyEvent("esign", "signed")).toBe(true);
    expect(h.calls).toEqual([{ url: "https://hooks.slack.com/services/T/B/X", auth: undefined, body: { text: "signed" } }]);
    // …but never for ops.
    expect(await h.n.notifyOps("ops_backup", "x")).toBe(false);
  });

  it("the bot channel wins over the webhook", async () => {
    const h = harness({ ...ON, SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X" });
    await h.n.notifyEvent("esign", "x");
    expect(h.calls[0]!.url).toBe("https://slack.com/api/chat.postMessage");
  });
});

describe("notifyOps", () => {
  it("posts once per throttle key per hour by default", async () => {
    const h = harness(ON);
    expect(await h.n.notifyOps("ops_sync", "failed", "sync:full")).toBe(true);
    expect(await h.n.notifyOps("ops_sync", "failed again", "sync:full")).toBe(false);
    expect(await h.n.notifyOps("ops_sync", "another sync", "sync:webhook")).toBe(true);
    h.advance(60 * 60 * 1000);
    expect(await h.n.notifyOps("ops_sync", "an hour later", "sync:full")).toBe(true);
    expect(h.calls.map((c) => [c.body.channel, c.body.text])).toEqual([
      ["C2222222222", ":rotating_light: failed"],
      ["C2222222222", ":rotating_light: another sync"],
      ["C2222222222", ":rotating_light: an hour later"],
    ]);
  });

  it("uses the repeat limit from Settings", async () => {
    const h = harness(ON, { ok: true }, sanitizeNotifySettings({ opsRepeatMinutes: 10 }));
    await h.n.notifyOps("ops_backup", "a");
    h.advance(9 * 60_000);
    expect(await h.n.notifyOps("ops_backup", "b")).toBe(false);
    h.advance(60_000);
    expect(await h.n.notifyOps("ops_backup", "c")).toBe(true);
  });

  it("a post that didn't go out doesn't start the clock", async () => {
    const h = harness(ON, { ok: false, error: "channel_not_found" });
    await h.n.notifyOps("ops_backup", "a");
    await h.n.notifyOps("ops_backup", "b");
    expect(h.calls).toHaveLength(2);
  });
});

describe("sendTest", () => {
  it("posts even when SLACK_MODE is off or dry-run, and reports Slack's error", async () => {
    const h = harness({ SLACK_MODE: "dry-run", SLACK_BOT_TOKEN: "xoxb-1" });
    expect(await h.n.sendTest("C3333333333", "hi")).toEqual({ ok: true, dryRun: false });
    expect(h.calls[0]!.body.channel).toBe("C3333333333");
    const bad = harness({ SLACK_BOT_TOKEN: "xoxb-1" }, { ok: false, error: "not_in_channel" });
    expect(await bad.n.sendTest("C3333333333", "hi")).toEqual({ ok: false, error: "not_in_channel" });
  });

  it("needs a token", async () => {
    const h = harness({});
    expect(await h.n.sendTest("C3333333333", "hi")).toEqual({ ok: false, error: "SLACK_BOT_TOKEN is not set" });
  });
});

describe("links + escaping", () => {
  it("escapes Slack's control characters", () => {
    expect(slackEscape("Tom & <Jerry>")).toBe("Tom &amp; &lt;Jerry&gt;");
  });

  it("builds stable links", () => {
    expect(mondayItemUrl("123", "456")).toBe("https://scaltheclinic.monday.com/boards/123/pulses/456");
    expect(mondayItemUrl(null, "456")).toBeNull();
    expect(appUrl("/alerts", { FRONTEND_URL: "https://app.example.com/" })).toBe("https://app.example.com/alerts");
    expect(appUrl("/alerts", {})).toBeNull();
    expect(withLink("x", "https://a.b", "A & B")).toBe("x — <https://a.b|A &amp; B>");
    expect(withLink("x", null, "A")).toBe("x");
  });
});

describe("sanitizeNotifySettings", () => {
  it("defaults every event on, default channel, 60 min", () => {
    const d = defaultNotifySettings();
    expect(Object.values(d.events).every((e) => e.enabled && e.channel === null)).toBe(true);
    expect(d.opsRepeatMinutes).toBe(60);
  });

  it("drops unknown events, bad channel ids, and clamps the repeat limit", () => {
    const s = sanitizeNotifySettings({
      events: { sms_sent: { enabled: false, channel: "#general" }, made_up: { enabled: false }, esign: { channel: "C1234567890" } },
      opsRepeatMinutes: 1,
    });
    expect(s.events.sms_sent).toEqual({ enabled: false, channel: null });
    expect(s.events.esign).toEqual({ enabled: true, channel: "C1234567890" });
    expect("made_up" in s.events).toBe(false);
    expect(s.opsRepeatMinutes).toBe(5);
    expect(sanitizeNotifySettings({ opsRepeatMinutes: 99999 }).opsRepeatMinutes).toBe(1440);
  });
});
