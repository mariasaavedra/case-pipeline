// =============================================================================
// Buzón — the automatic start, reminders and thank-you texts, on an in-memory DB
// =============================================================================
// SMS is a dry run; Monday, Slack and the audit log are mocked. Under test:
// who gets texted, what, when — and who never does.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import type { FeeKTypeRow } from "../fee-k-types.js";

const mocks = vi.hoisted(() => ({
  team: vi.fn(async () => {}),
  sms: [] as { body: string; to: string; context: string }[],
  usersDb: null as unknown as import("better-sqlite3").Database,
}));

vi.mock("../db/users-db.js", async () => {
  const D = (await import("better-sqlite3")).default;
  mocks.usersDb = new D(":memory:");
  mocks.usersDb.exec("CREATE TABLE sms_messages (profile_monday_id TEXT, context TEXT, error TEXT, created_at TEXT DEFAULT (datetime('now')))");
  return { usersDb: mocks.usersDb };
});
vi.mock("./team.js", () => ({ tellFeeKTeam: mocks.team }));
vi.mock("../audit/log.js", () => ({ recordAudit: () => {}, auditFromReq: () => {} }));
vi.mock("../sms/log.js", () => ({
  recordSms: (e: { body: string; toNumber: string; context: string }) => { mocks.sms.push({ body: e.body, to: e.toNumber, context: e.context }); return 1; },
  recentlySent: () => false,
}));
vi.mock("../sms/ringcentral.js", () => ({ smsMode: () => "dry-run", ringCentral: () => null, RingCentralError: Error }));
vi.mock("../routes/sms.js", () => ({ SMS_ACTIVITY_NAME: "Text message" }));
vi.mock("../routes/detention-write.js", () => ({ CASENOTE_ACTIVITY_ID: "1" }));
vi.mock("../documents/document-settings.js", () => ({ loadDocumentSettings: () => ({ firm: { name: "Sharma-Crawford", phone: "8169942300" } }) }));
vi.mock("../notify/slack.js", () => ({ notifyOps: async () => {} }));
vi.mock("../workflows/runs.js", () => ({ recordRun: () => {} }));

const { startForFeeK, startCandidates } = await import("./start.js");
const { runReminders, runReceivedTexts } = await import("./job.js");
const { initBuzonSettings, saveBuzonSettings, DEFAULT_BUZON_SETTINGS } = await import("./settings.js");
const { initSmsTemplates } = await import("../sms/templates.js");

const BLANK = { spanish: "", board: "", feeSheetJob: "", services: "", servicesEs: "", excluded: "", excludedEs: "" };
const TABLE: FeeKTypeRow[] = [
  { ...BLANK, feeKType: "I-130", documents: [
    { en: "Marriage certificate", es: "Acta de matrimonio", required: true },
    { en: "Passport", es: "Pasaporte", required: true },
  ] },
];
const feeKTypes = () => TABLE;

let db: Database.Database;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "buzon-job-"));
const deps = () => ({ db, mondayApiToken: undefined, seed: false, feeKTypes });

function profile(localId: string, mondayId: string, phone: string | null, language = "Espanol") {
  db.prepare("INSERT INTO profiles (local_id, monday_item_id, name, phone, raw_column_values) VALUES (?, ?, ?, ?, ?)")
    .run(localId, mondayId, `Maria ${localId.toUpperCase()}`, phone, JSON.stringify({ preferred_language: { label: language } }));
}
function feeK(localId: string, mondayId: string, profileLocal: string, profileMonday: string, types: string[]) {
  db.prepare("INSERT INTO contracts (local_id, monday_item_id, profile_local_id, profile_monday_id, name, raw_column_values) VALUES (?, ?, ?, ?, ?, ?)")
    .run(localId, mondayId, profileLocal, profileMonday, "Fee K", JSON.stringify({ fee_k_type: { labels: types }, contract_stage: { label: "Paid needs action" } }));
}

beforeEach(() => {
  process.env.CLIENT_UPLOADS = "on";
  process.env.API_URL = "https://app.example.com";
  process.env.APP_ENCRYPTION_KEY = "test-key-test-key-test-key-test-key";
  mocks.team.mockClear();
  mocks.sms.length = 0;
  mocks.usersDb.exec("DELETE FROM sms_messages");
  fs.rmSync(path.join(tmp, "buzon-settings.json"), { force: true });
  initBuzonSettings(tmp);
  initSmsTemplates(tmp);
  db = new Database(":memory:");
  initializeSchema(db);
  profile("p1", "9001", "816-555-1234");
  feeK("k1", "7001", "p1", "9001", ["I-130"]);
});

describe("automatic start on Paid needs action", () => {
  it("puts the list on the checklist, makes a link and texts it in the client's language; once", async () => {
    expect(await startForFeeK(deps(), "7001")).toBe("texted");
    const items = db.prepare("SELECT label_en, fee_k_monday_id FROM upload_checklist_items").all();
    expect(items).toEqual([{ label_en: "Marriage certificate", fee_k_monday_id: "7001" }, { label_en: "Passport", fee_k_monday_id: "7001" }]);
    const link = db.prepare("SELECT id, token_enc FROM upload_links").get() as { id: number; token_enc: string };
    expect(link.token_enc).toMatch(/^CPS1:/);
    expect(mocks.sms).toHaveLength(1);
    expect(mocks.sms[0]).toMatchObject({ to: "+18165551234", context: "buzon" });
    expect(mocks.sms[0]!.body).toMatch(/^Hola Maria, le escribe Sharma-Crawford\. Gracias por su pago\..*https:\/\/app\.example\.com\/u\/[A-Za-z0-9_-]{43}/s);
    expect(db.prepare("SELECT kind, status FROM buzon_texts").all()).toEqual([{ kind: "link", status: "sent" }].map((r) => ({ ...r, status: "dry_run" })));
    expect(mocks.team).toHaveBeenCalledTimes(1);
    expect(await startForFeeK(deps(), "7001")).toBe("already");
    expect(mocks.sms).toHaveLength(1);
  });

  it("a case type with no list: nothing made, nothing sent", async () => {
    feeK("k2", "7002", "p1", "9001", ["FOIA"]);
    expect(await startForFeeK(deps(), "7002")).toBe("no_list");
    expect(db.prepare("SELECT COUNT(*) AS n FROM upload_links").get()).toEqual({ n: 0 });
    expect(mocks.sms).toHaveLength(0);
  });

  it("a client set to no automatic texts, or with no phone: the list and link are ready, staff are told why", async () => {
    db.prepare("INSERT INTO buzon_client_settings (profile_key, no_auto_texts) VALUES ('9001', 1)").run();
    expect(await startForFeeK(deps(), "7001")).toBe("not_texted");
    expect(mocks.sms).toHaveLength(0);
    expect(db.prepare("SELECT reason FROM buzon_fee_ks").get()).toEqual({ reason: "this client is set to no automatic texts" });
    expect((mocks.team.mock.calls[0] as unknown[])[3]).toMatch(/NOT texted: this client is set to no automatic texts/);

    profile("p2", "9002", null);
    feeK("k3", "7003", "p2", "9002", ["I-130"]);
    expect(await startForFeeK(deps(), "7003")).toBe("not_texted");
    expect(db.prepare("SELECT reason FROM buzon_fee_ks WHERE fee_k_monday_id = '7003'").get()).toEqual({ reason: "no US phone number on the profile" });
  });

  it("the firm switch off: not texted", async () => {
    saveBuzonSettings({ ...DEFAULT_BUZON_SETTINGS, autoText: false });
    expect(await startForFeeK(deps(), "7001")).toBe("not_texted");
    expect(mocks.sms).toHaveLength(0);
  });

  it("candidates: stage changes to Paid needs action since the start date, not yet started", async () => {
    const ev = db.prepare("INSERT INTO item_events (event_type, board_key, monday_item_id, column_id, value_text, changed_at) VALUES ('update_column_value', 'fee_ks', ?, 'deal_stage', ?, ?)");
    ev.run("7001", "Paid needs action", "2026-10-25T15:00:00Z");
    ev.run("7005", "Paid needs action", "2026-10-01T15:00:00Z");
    ev.run("7006", "Payment link sent", "2026-10-25T15:00:00Z");
    expect(startCandidates(db, "2026-10-24")).toEqual(["7001"]);
    await startForFeeK(deps(), "7001");
    expect(startCandidates(db, "2026-10-24")).toEqual([]);
  });
});

describe("reminders", () => {
  // Friday 2026-10-30, 10:00 in Kansas City.
  const now = () => new Date("2026-10-30T15:00:00Z");
  async function startedDaysAgo(days: number) {
    await startForFeeK(deps(), "7001");
    db.prepare("UPDATE buzon_texts SET sent_at = datetime(?, ?)").run("2026-10-30 15:00:00", `-${days} days`);
    mocks.sms.length = 0;
  }

  it("none while reminders are off (the default)", async () => {
    await startedDaysAgo(5);
    expect(await runReminders({ ...deps(), now })).toEqual({ sent: 0, gaveUp: 0 });
  });

  it("on its day, with what is still missing; not twice the same day", async () => {
    saveBuzonSettings({ ...DEFAULT_BUZON_SETTINGS, reminders: { ...DEFAULT_BUZON_SETTINGS.reminders, on: true } });
    await startedDaysAgo(4);
    db.prepare("UPDATE upload_checklist_items SET status = 'received' WHERE label_en = 'Passport'").run();
    expect(await runReminders({ ...deps(), now })).toEqual({ sent: 1, gaveUp: 0 });
    expect(mocks.sms[0]!.body).toMatch(/Todavía necesitamos: Acta de matrimonio\. Envíelos aquí: https:\/\/app\.example\.com\/u\//);
    expect(await runReminders({ ...deps(), now })).toEqual({ sent: 0, gaveUp: 0 });
  });

  it("not yet due, out of hours, or the client opted out", async () => {
    saveBuzonSettings({ ...DEFAULT_BUZON_SETTINGS, reminders: { ...DEFAULT_BUZON_SETTINGS.reminders, on: true } });
    await startedDaysAgo(2);
    expect((await runReminders({ ...deps(), now })).sent).toBe(0);
    db.prepare("UPDATE buzon_texts SET sent_at = datetime(sent_at, '-5 days')").run();
    expect((await runReminders({ ...deps(), now: () => new Date("2026-10-31T15:00:00Z") })).sent).toBe(0); // Saturday
    db.prepare("INSERT INTO buzon_client_settings (profile_key, reminders) VALUES ('9001', 'off')").run();
    expect((await runReminders({ ...deps(), now })).sent).toBe(0);
  });

  it("after the last reminder, staff are told once", async () => {
    db.prepare("INSERT INTO buzon_client_settings (profile_key, reminders, reminder_days) VALUES ('9001', 'custom', '[1]')").run();
    await startedDaysAgo(3);
    expect((await runReminders({ ...deps(), now })).sent).toBe(1);
    mocks.team.mockClear();
    expect(await runReminders({ ...deps(), now })).toEqual({ sent: 0, gaveUp: 1 });
    expect((mocks.team.mock.calls[0] as unknown[])[3]).toMatch(/hasn't sent: Marriage certificate and Passport/);
    expect(await runReminders({ ...deps(), now })).toEqual({ sent: 0, gaveUp: 0 });
  });
});

describe("we received your documents", () => {
  function quietUpload() {
    const link = (db.prepare("SELECT id FROM upload_links").get() as { id: number }).id;
    const item = (db.prepare("SELECT id FROM upload_checklist_items WHERE label_en = 'Passport'").get() as { id: number }).id;
    db.prepare("INSERT INTO client_uploads (link_id, original_name, stored_name, size, content_type, sha256, kind, item_id, received_at) VALUES (?, 'p.jpg', 'p.jpg', 1, 'image/jpeg', 's', 'evidence', ?, datetime('now', '-20 minutes'))")
      .run(link, item);
    db.prepare("UPDATE upload_checklist_items SET status = 'received' WHERE id = ?").run(item);
  }

  it("off by default: nothing sent, the batch is stamped anyway", async () => {
    await startForFeeK(deps(), "7001");
    mocks.sms.length = 0;
    quietUpload();
    expect(await runReceivedTexts(deps())).toBe(0);
    expect(db.prepare("SELECT thanked_at IS NOT NULL AS t FROM client_uploads").get()).toEqual({ t: 1 });
  });

  it("on: one text per batch saying what is still missing", async () => {
    saveBuzonSettings({ ...DEFAULT_BUZON_SETTINGS, receivedText: true });
    await startForFeeK(deps(), "7001");
    mocks.sms.length = 0;
    quietUpload();
    expect(await runReceivedTexts(deps())).toBe(1);
    expect(mocks.sms[0]!.body).toMatch(/Recibimos sus documentos\. ¡Gracias! Todavía necesitamos: Acta de matrimonio\./);
    expect(await runReceivedTexts(deps())).toBe(0);
  });
});
