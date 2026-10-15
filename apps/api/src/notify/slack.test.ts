import { describe, it, expect } from "vitest";
import { createSlackNotifier, slackEscape, slackMode, mondayItemUrl, appUrl, withLink } from "./slack.js";

function harness(env: NodeJS.ProcessEnv, reply: unknown = { ok: true }) {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth?: string }> = [];
  const logs: string[] = [];
  let now = 0;
  const n = createSlackNotifier({
    env,
    now: () => now,
    log: (m) => logs.push(m),
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify(reply), { status: 200 });
    },
  });
  return { n, calls, logs, advance: (ms: number) => { now += ms; } };
}

const ON = { SLACK_MODE: "on", SLACK_BOT_TOKEN: "xoxb-1", SLACK_EVENTS_CHANNEL: "C111", SLACK_OPS_CHANNEL: "C222" };

describe("slackMode", () => {
  it("defaults to off", () => {
    expect(slackMode({})).toBe("off");
    expect(slackMode({ SLACK_MODE: "On" })).toBe("on");
    expect(slackMode({ SLACK_MODE: "maybe" })).toBe("off");
  });
});

describe("postSlack", () => {
  it("posts to the kind's channel with the bot token, no link previews", async () => {
    const h = harness(ON);
    expect(await h.n.notifyEvent("hello")).toBe(true);
    expect(h.calls).toEqual([{
      url: "https://slack.com/api/chat.postMessage",
      auth: "Bearer xoxb-1",
      body: { channel: "C111", text: "hello", unfurl_links: false, unfurl_media: false },
    }]);
  });

  it("off posts nothing; dry-run only logs", async () => {
    const off = harness({ ...ON, SLACK_MODE: "off" });
    expect(await off.n.notifyEvent("x")).toBe(false);
    const dry = harness({ ...ON, SLACK_MODE: "dry-run" });
    expect(await dry.n.notifyEvent("x")).toBe(true);
    expect(dry.calls).toHaveLength(0);
    expect(dry.logs).toEqual(["[slack] DRY RUN → events: x"]);
  });

  it("a kind with no channel is off", async () => {
    const h = harness({ ...ON, SLACK_OPS_CHANNEL: "" });
    expect(await h.n.postSlack("ops", "x")).toBe(false);
    expect(h.calls).toHaveLength(0);
  });

  it("Slack's ok:false is logged, not thrown", async () => {
    const h = harness(ON, { ok: false, error: "not_in_channel" });
    expect(await h.n.notifyEvent("x")).toBe(false);
    expect(h.logs).toEqual(["[slack] events post refused: not_in_channel"]);
  });

  it("a network error is logged, not thrown", async () => {
    const n = createSlackNotifier({
      env: ON,
      log: () => {},
      fetchImpl: async () => { throw new Error("ECONNRESET"); },
    });
    await expect(n.notifyEvent("x")).resolves.toBe(false);
  });

  it("events fall back to the old Incoming Webhook when no bot channel is set — even with SLACK_MODE off", async () => {
    const h = harness({ SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X" });
    expect(await h.n.notifyEvent("signed")).toBe(true);
    expect(h.calls).toEqual([{ url: "https://hooks.slack.com/services/T/B/X", auth: undefined, body: { text: "signed" } }]);
    // …but never for ops.
    expect(await h.n.postSlack("ops", "x")).toBe(false);
  });

  it("the bot channel wins over the webhook", async () => {
    const h = harness({ ...ON, SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X" });
    await h.n.notifyEvent("x");
    expect(h.calls[0]!.url).toBe("https://slack.com/api/chat.postMessage");
  });
});

describe("notifyOps", () => {
  it("posts once per key per hour", async () => {
    const h = harness(ON);
    expect(await h.n.notifyOps("sync:full", "failed")).toBe(true);
    expect(await h.n.notifyOps("sync:full", "failed again")).toBe(false);
    expect(await h.n.notifyOps("backup", "other key")).toBe(true);
    h.advance(60 * 60 * 1000);
    expect(await h.n.notifyOps("sync:full", "an hour later")).toBe(true);
    expect(h.calls.map((c) => [c.body.channel, c.body.text])).toEqual([
      ["C222", ":rotating_light: failed"],
      ["C222", ":rotating_light: other key"],
      ["C222", ":rotating_light: an hour later"],
    ]);
  });

  it("a post that didn't go out doesn't start the hour", async () => {
    const h = harness(ON, { ok: false, error: "channel_not_found" });
    await h.n.notifyOps("k", "a");
    await h.n.notifyOps("k", "b");
    expect(h.calls).toHaveLength(2);
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
