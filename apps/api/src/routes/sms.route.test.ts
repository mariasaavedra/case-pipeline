// =============================================================================
// SMS send route — end to end with RingCentral and Monday mocked
// =============================================================================
// The pure rules are in sms/send-plan.test.ts. This drives POST /api/sms/send
// through a real Express app and SQLite: what goes to RingCentral, what is
// logged, when the E&A entry is written, and what never leaves the building
// (dry run, seed data, a double click).
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

let sent: Array<{ to: string; text: string }> = [];
let activities: Array<Record<string, unknown>> = [];
let logged: Array<Record<string, unknown>> = [];
let audits: Array<{ action: string; metadata: Record<string, unknown> }> = [];
let rcFails: string | null = null;
let mondayDown = false;

vi.mock("../sms/ringcentral.js", async (orig) => {
  const real = await orig<typeof import("../sms/ringcentral.js")>();
  return {
    ...real,
    ringCentral: () => ({
      sendSms: async (to: string, text: string) => {
        if (rcFails) throw new real.RingCentralError(rcFails, 400);
        sent.push({ to, text });
        return { id: "rc-1", status: "Queued" };
      },
    }),
  };
});
vi.mock("../sms/log.js", () => ({
  recordSms: (e: Record<string, unknown>) => { logged.push(e); return logged.length; },
  recentlySent: (to: string, body: string) => logged.some((e) => e.toNumber === to && e.body === body && e.error === null),
  smsHistoryForProfile: () => [],
}));
vi.mock("../data-source/index.js", () => ({
  dataSource: {
    createTimelineItem: async (input: Record<string, unknown>) => {
      if (mondayDown) {
        const { NetworkError } = await import("@case-pipeline/monday");
        throw new NetworkError("Monday is down");
      }
      activities.push(input);
      return "tl-1";
    },
  },
}));
vi.mock("../auth/middleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { oid: "oid-1", name: "Ana Reyes", email: "ana@example.com" };
    next();
  },
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../db/user-context.js", () => ({ currentUserId: () => 7 }));
vi.mock("../audit/log.js", () => ({
  auditFromReq: (_req: unknown, action: string, opts: { metadata: Record<string, unknown> }) => audits.push({ action, metadata: opts.metadata }),
}));
vi.mock("@case-pipeline/monday", async (orig) => ({
  ...(await orig<typeof import("@case-pipeline/monday")>()),
  fetchCustomActivities: async () => new Map([["sms-act", "Text message"]]),
}));

const { registerSmsRoutes } = await import("./sms.js");

let db: Database.Database;
let server: Server;
let base: string;

async function start(forceDryRun = false) {
  db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (id, batch_name) VALUES (1, 'test')").run();
  db.prepare(
    "INSERT INTO profiles (batch_id, local_id, monday_item_id, name, phone) VALUES (1, 'p1', '111', 'Maria Garcia', '816 555 1234')",
  ).run();
  const app = express();
  app.use(express.json());
  registerSmsRoutes(app, { db, mondayApiToken: "shared", writeTokenOptions: () => ({ sharedToken: "shared" }) as never, forceDryRun });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function send(body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/sms/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: "(816) 555-1234", body: "Hi Maria", context: "call_log", ...body }),
  });
  return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown>; error?: string } };
}

beforeEach(() => {
  sent = []; activities = []; logged = []; audits = [];
  rcFails = null; mondayDown = false;
  vi.stubEnv("SMS_MODE", "on");
});
afterEach(() => {
  server?.close();
  db?.close();
  vi.unstubAllEnvs();
});

describe("POST /api/sms/send", () => {
  it("sends, logs, and writes the E&A entry on the linked profile", async () => {
    await start();
    const r = await send({ profileLocalId: "p1", templateKey: "consult_link", language: "en" });
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual({ mode: "on", status: "Queued", activity: "logged", segments: 1 });
    expect(sent).toEqual([{ to: "+18165551234", text: "Hi Maria" }]);
    expect(activities).toEqual([
      { itemId: "111", title: "Text sent to (816) 555-1234", customActivityId: "sms-act", content: "Hi Maria", phone: "+18165551234" },
    ]);
    expect(logged[0]).toMatchObject({ userId: 7, toNumber: "+18165551234", mode: "on", rcMessageId: "rc-1", profileMondayId: "111" });
    // The audit has the last 4 digits, never the number or the text.
    expect(audits).toEqual([{ action: "sms.sent", metadata: expect.objectContaining({ toLast4: "1234", activity: "logged" }) }]);
    expect(JSON.stringify(audits)).not.toContain("Hi Maria");
  });

  it("an unlinked call is texted with no E&A entry", async () => {
    await start();
    const r = await send({});
    expect(r.json.data?.activity).toBe("none");
    expect(sent).toHaveLength(1);
    expect(activities).toHaveLength(0);
  });

  it("dry-run logs but sends nothing and writes nothing to Monday", async () => {
    vi.stubEnv("SMS_MODE", "dry-run");
    await start();
    const r = await send({ profileLocalId: "p1" });
    expect(r.json.data).toMatchObject({ mode: "dry-run", status: "DryRun", activity: "none" });
    expect(sent).toHaveLength(0);
    expect(activities).toHaveLength(0);
    expect(logged[0]).toMatchObject({ mode: "dry-run" });
  });

  it("seed data is always a dry run", async () => {
    await start(true);
    const r = await send({});
    expect(r.json.data?.mode).toBe("dry-run");
    expect(sent).toHaveLength(0);
  });

  it("off refuses", async () => {
    vi.stubEnv("SMS_MODE", "off");
    await start();
    expect((await send({})).status).toBe(503);
  });

  it("refuses the same text to the same number twice", async () => {
    await start();
    expect((await send({})).status).toBe(200);
    expect((await send({})).status).toBe(409);
    expect(sent).toHaveLength(1);
  });

  it("a RingCentral refusal is reported and logged, with no E&A entry", async () => {
    await start();
    rcFails = "Phone number is not SMS-enabled";
    const r = await send({ profileLocalId: "p1" });
    expect(r.status).toBe(502);
    expect(r.json.error).toContain("Phone number is not SMS-enabled");
    expect(logged[0]).toMatchObject({ status: "Failed", error: "Phone number is not SMS-enabled" });
    expect(audits[0]!.action).toBe("sms.failed");
    expect(activities).toHaveLength(0);
    // A failed send doesn't block the retry.
    rcFails = null;
    expect((await send({ profileLocalId: "p1" })).status).toBe(200);
  });

  it("Monday down → the text still goes, the E&A entry is queued", async () => {
    await start();
    mondayDown = true;
    const r = await send({ profileLocalId: "p1" });
    expect(r.json.data?.activity).toBe("queued");
    expect(sent).toHaveLength(1);
    const q = db.prepare("SELECT op_type, monday_item_id FROM write_queue").all();
    expect(q).toEqual([{ op_type: "create_timeline_item", monday_item_id: "111" }]);
  });

  it("refuses an unfilled placeholder and an unknown profile", async () => {
    await start();
    expect((await send({ body: "Book: {{link}}" })).json.error).toMatch(/\{\{link\}\}/);
    expect((await send({ profileLocalId: "nope" })).status).toBe(404);
    expect(sent).toHaveLength(0);
  });
});

describe("SMS templates — anyone adds and edits", () => {
  async function call(method: string, path: string, body: unknown) {
    const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown>; error?: string } };
  }

  beforeEach(async () => {
    const { initSmsTemplates } = await import("../sms/templates.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    initSmsTemplates(fs.mkdtempSync(path.join(os.tmpdir(), "sms-tpl-")));
    await start();
  });

  it("adds a template after the defaults, with a key from its name", async () => {
    const r = await call("POST", "/api/sms/templates", { label: "Court reminder", en: "Hi {{firstName}}, court is tomorrow.", es: "" });
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ key: "court_reminder", label: "Court reminder" });
    const { loadSmsTemplates } = await import("../sms/templates.js");
    expect(loadSmsTemplates().at(-1)?.key).toBe("court_reminder");
    expect(loadSmsTemplates()[0]?.key).toBe("consult_link");
    expect(audits.at(-1)).toMatchObject({ action: "sms_templates.created" });
  });

  it("a second template with the same name gets its own key", async () => {
    await call("POST", "/api/sms/templates", { label: "Reminder", en: "a" });
    const r = await call("POST", "/api/sms/templates", { label: "Reminder", en: "b" });
    expect(r.json.data?.key).toBe("reminder_2");
  });

  it("edits a template's texts and keeps its key", async () => {
    const r = await call("PUT", "/api/sms/templates/consult_link", { key: "renamed", label: "Consult", en: "Book here: {{link}}", es: "Agende: {{link}}" });
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual({ key: "consult_link", label: "Consult", en: "Book here: {{link}}", es: "Agende: {{link}}" });
    expect(audits.at(-1)).toMatchObject({ action: "sms_templates.edited" });
  });

  it("refuses an empty template and an unknown key", async () => {
    expect((await call("POST", "/api/sms/templates", { label: "x", en: "", es: "" })).status).toBe(400);
    expect((await call("PUT", "/api/sms/templates/nope", { label: "x", en: "y" })).status).toBe(404);
  });
});
