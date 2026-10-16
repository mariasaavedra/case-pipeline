import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lawpay-slack-"));
const ingested = vi.hoisted(() => ({ calls: [] as { messageId: string; reference: string }[][] }));
vi.mock("../paths.js", () => ({ DATA_DIR: tmp }));
vi.mock("../routes/lawpay.js", () => ({
  ingestLawPayReceipts: async (_d: unknown, r: { messageId: string; reference: string }[]) => { ingested.calls.push(r); return r.map(() => "matched"); },
  findFeeK: (_db: unknown, p: { reference: string }) => ({ row: p.reference.includes("ANA") ? { clientName: "Ana LOPEZ", group: "Pending Fee Ks" } : undefined, by: p.reference.includes("ANA") ? "code" : null }),
}));
const { runLawPaySlackJob } = await import("./slack-job");

const post = (ts: string, reference: string) => ({ ts, text: `New Transaction:\nTransaction Type: Received Payment\nPayer: X\nDate: Oct. 16, 2026 16:07\nAmount: $50.00\nAccount: SCAL Operating\nReference: ${reference}` });
const env = { SLACK_BOT_TOKEN: "xoxb-test" } as NodeJS.ProcessEnv;
const deps = { db: {} as never, mondayApiToken: undefined };

function fakeSlack(pages: object[]) {
  const urls: string[] = [];
  let i = 0;
  const f = async (url: string) => {
    urls.push(url);
    const p = pages[Math.min(i++, pages.length - 1)] as { status?: number };
    return p.status === 429
      ? new Response("", { status: 429, headers: { "retry-after": "2" } })
      : new Response(JSON.stringify(p), { status: 200 });
  };
  return { f, urls };
}

beforeEach(() => {
  ingested.calls = [];
  fs.rmSync(path.join(tmp, "lawpay-slack-cursor.json"), { force: true });
});

describe("runLawPaySlackJob", () => {
  it("first run looks back 3 days, reads every page oldest first, keeps only our LawPay posts, then remembers where it is", async () => {
    const { f, urls } = fakeSlack([
      { ok: true, messages: [post("300.1", "ANA LOPEZ K8F2XQ1 - AF 50"), { ts: "250.1", text: "Hi. Paypal Link Payment received" }], has_more: true, response_metadata: { next_cursor: "c2" } },
      { ok: true, messages: [post("200.1", "BOB TEST - FF 675")], has_more: false },
    ]);
    const r = await runLawPaySlackJob(deps, { env, fetch: f, now: 1_000_000_000 });
    expect(r).toMatchObject({ ok: true, read: 3, payments: 2 });
    expect(new URL(urls[0]!).searchParams.get("oldest")).toBe(String((1_000_000_000 - 3 * 86_400_000) / 1000));
    expect(new URL(urls[1]!).searchParams.get("cursor")).toBe("c2");
    expect(ingested.calls[0]!.map((x) => x.messageId)).toEqual(["slack:200.1", "slack:300.1"]);

    // Next run starts after the newest post it read.
    const next = fakeSlack([{ ok: true, messages: [], has_more: false }]);
    await runLawPaySlackJob(deps, { env, fetch: next.f });
    expect(new URL(next.urls[0]!).searchParams.get("oldest")).toBe("300.1");
  });

  it("waits out Slack's rate limit, then reads the page", async () => {
    const waits: number[] = [];
    const { f } = fakeSlack([{ status: 429 }, { ok: true, messages: [post("5.1", "ANA LOPEZ - AF 50")], has_more: false }]);
    const r = await runLawPaySlackJob(deps, { env, fetch: f, wait: async (ms) => { waits.push(ms); } });
    expect(waits).toEqual([2000]);
    expect(r).toMatchObject({ ok: true, payments: 1 });
  });

  it("a Slack error is a failure and the cursor doesn't move", async () => {
    const { f } = fakeSlack([{ ok: false, error: "not_in_channel" }]);
    expect(await runLawPaySlackJob(deps, { env, fetch: f })).toEqual({ ok: false, error: "Slack: not_in_channel" });
    expect(fs.existsSync(path.join(tmp, "lawpay-slack-cursor.json"))).toBe(false);
    expect(await runLawPaySlackJob(deps, { env: {} as NodeJS.ProcessEnv, fetch: f })).toEqual({ ok: false, error: "SLACK_BOT_TOKEN is not set" });
  });

  it("dry run: says what it would match, stores nothing, moves no cursor", async () => {
    const { f } = fakeSlack([{ ok: true, messages: [post("9.1", "ANA LOPEZ K8F2XQ1 - AF 50"), post("8.1", "BOB TEST - FF 675")], has_more: false }]);
    const r = await runLawPaySlackJob(deps, { env, fetch: f, dryRun: true });
    expect(r && r.ok && r.dryRun).toEqual([
      { ts: "slack:8.1", payer: "X", amount: 50, reference: "BOB TEST - FF 675", feeK: null, by: null },
      { ts: "slack:9.1", payer: "X", amount: 50, reference: "ANA LOPEZ K8F2XQ1 - AF 50", feeK: "Ana LOPEZ (Pending Fee Ks)", by: "code" },
    ]);
    expect(ingested.calls).toEqual([]);
    expect(fs.existsSync(path.join(tmp, "lawpay-slack-cursor.json"))).toBe(false);
  });
});
