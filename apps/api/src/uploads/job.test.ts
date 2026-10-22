// =============================================================================
// Client upload filing — the API's half: tell staff, report what's stuck
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

const calls: { op: string; [k: string]: unknown }[] = [];
const monday = vi.hoisted(() => ({ fail: false }));

vi.mock("../data-source/index.js", () => ({
  dataSource: {
    postUpdate: async (itemId: string, body: string) => {
      if (monday.fail) throw new Error("Monday is down");
      calls.push({ op: "update", itemId, body });
      return "u1";
    },
  },
}));
vi.mock("../notify/slack.js", async (orig) => ({
  ...(await orig<typeof import("../notify/slack.js")>()),
  notifyEvent: async (key: string, text: string) => {
    calls.push({ op: "slack", key, text });
    return true;
  },
  notifyOps: async (key: string, text: string, throttleKey?: string) => {
    calls.push({ op: "ops", key, text, throttleKey });
    return true;
  },
}));

const { tellStaff, runFilingNow, _setFilingDeps } = await import("./job.js");

let db: Database.Database;

function addUpload(linkId: number, fields: Record<string, unknown>) {
  const row = {
    original_name: "a.pdf", stored_name: "2026-10-21 Notice - a.pdf", local_file: "x.pdf", size: 10,
    content_type: "application/pdf", sha256: `s${Math.random()}`, kind: "notice", ...fields,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO client_uploads (link_id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`)
    .run(linkId, ...Object.values(row));
}

beforeEach(() => {
  calls.length = 0;
  monday.fail = false;
  db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO profiles (local_id, monday_item_id, name) VALUES ('p1', '9001', 'Itzel MARTINEZ')").run();
  db.prepare("INSERT INTO upload_links (id, profile_local_id, profile_monday_id, token_hash, language, expires_at) VALUES (1, 'p1', '9001', 'h', 'es', '2030-01-01 00:00:00')").run();
});

const filed = { filed_at: "2026-10-21 15:00:00", sharepoint_url: "https://sp/a", filed_where: "E-File" };

describe("tellStaff", () => {
  it("one Monday update + one Slack post per batch, then stamped so it's never told twice", async () => {
    addUpload(1, { ...filed, note: "mi aviso" });
    addUpload(1, { ...filed, kind: "id", stored_name: "2026-10-21 ID - b.jpg", sharepoint_url: "https://sp/b" });
    await tellStaff({ db, mondayApiToken: "tok" });
    expect(calls.map((c) => c.op)).toEqual(["update", "slack"]);
    expect(calls[0]).toMatchObject({ itemId: "9001" });
    expect(String(calls[0]!.body)).toContain("The client sent 2 documents");
    expect(calls[1]).toMatchObject({ key: "client_upload" });
    expect(String(calls[1]!.text)).toContain("*Itzel MARTINEZ* sent 2 documents (1 notice, 1 ID)");
    expect(String(calls[1]!.text)).not.toMatch(/aviso|a\.pdf|b\.jpg/);

    calls.length = 0;
    await tellStaff({ db, mondayApiToken: "tok" });
    expect(calls).toEqual([]);
  });

  it("Monday down → the update is queued, Slack still posts, still stamped", async () => {
    monday.fail = true;
    addUpload(1, filed);
    await tellStaff({ db, mondayApiToken: "tok" });
    const queued = db.prepare("SELECT op_type, target_table, monday_item_id FROM write_queue").all();
    expect(queued).toEqual([{ op_type: "create_update", target_table: "profiles", monday_item_id: "9001" }]);
    expect(calls.map((c) => c.op)).toEqual(["slack"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM client_uploads WHERE notified_at IS NULL").get()).toEqual({ n: 0 });
  });

  it("not yet filed = nothing to tell", async () => {
    addUpload(1, {});
    await tellStaff({ db, mondayApiToken: "tok" });
    expect(calls).toEqual([]);
  });

  it("ops post for files waiting over a day, and for files that gave up — not for a fresh wait", async () => {
    addUpload(1, { last_error: "waiting: no E-File or Consult File link on the profile", received_at: "2026-01-01 00:00:00" });
    await tellStaff({ db, mondayApiToken: "tok" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: "ops", key: "ops_client_uploads", throttleKey: "client_uploads:stuck:9001" });
    expect(String(calls[0]!.text)).toContain("nowhere to go for a day");

    calls.length = 0;
    db.prepare("DELETE FROM client_uploads").run();
    addUpload(1, { last_error: "waiting: no E-File or Consult File link on the profile" });
    await tellStaff({ db, mondayApiToken: "tok" });
    expect(calls).toEqual([]);

    addUpload(1, { attempts: 8, last_error: "Graph 500" });
    await tellStaff({ db, mondayApiToken: "tok" });
    expect(String(calls[0]!.text)).toContain("could not be filed after 8 tries");
  });
});

describe("runFilingNow", () => {
  it("runs the script with --apply (and --db=seed on seed data), reports a failed run to ops", async () => {
    const runs: string[][] = [];
    _setFilingDeps({ db, mondayApiToken: "tok", seed: true, runScript: async (args) => { runs.push(args); return { ok: false, reason: "sign-in expired" }; } });
    await runFilingNow();
    expect(runs).toEqual([["--apply", "--quiet=10", "--db=seed"]]);
    expect(calls).toEqual([expect.objectContaining({ op: "ops", key: "ops_client_uploads", text: expect.stringContaining("sign-in expired") })]);
    _setFilingDeps(null);
  });

  it("a request during a run makes exactly one more run", async () => {
    let release!: () => void;
    let n = 0;
    _setFilingDeps({
      db, mondayApiToken: "tok", seed: false,
      runScript: async () => {
        n++;
        if (n === 1) await new Promise<void>((r) => { release = r; });
        return { ok: true };
      },
    });
    const first = runFilingNow();
    void runFilingNow();
    void runFilingNow();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await first;
    await new Promise((r) => setTimeout(r, 10));
    expect(n).toBe(2);
    _setFilingDeps(null);
  });
});
