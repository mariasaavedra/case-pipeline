// =============================================================================
// Fee K Types routes (P11.3.6) — end to end through Express + SQLite
// =============================================================================
// GET gives the saved table plus Monday's Fee K Type and "It will go to…"
// labels from the synced schema; only admins save, and a save is audited and
// read back by the next GET.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";

const audits: { action: string; metadata: unknown }[] = [];
let isAdmin = false;

vi.mock("../auth/middleware.js", () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireAdmin: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (isAdmin) next();
    else res.status(403).json({ error: "Admin only" });
  },
}));
vi.mock("../audit/log.js", () => ({
  auditFromReq: (_req: unknown, action: string, opts: { metadata?: unknown }) => audits.push({ action, metadata: opts.metadata }),
}));

const { registerFeeKTypeRoutes } = await import("./fee-k-types.js");
const { initFeeKTypes } = await import("../fee-k-types.js");
const { DRAFT_FEE_K_TYPES } = await import("../fee-k-types-draft.js");

let db: Database.Database;
let server: Server;
let base: string;
let dataDir: string;

beforeEach(() => {
  audits.length = 0;
  isAdmin = false;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "feek-types-"));
  initFeeKTypes(dataDir);
  db = new Database(":memory:");
  initializeSchema(db);
  const col = db.prepare(
    "INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, options, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  // Monday's title when it was first made; matched by id.
  col.run("fee_ks", "B-FK", "dropdown_mm89vqtc", "Dup. of Contract for...", "dropdown", JSON.stringify([{ label: "Motion (c)" }, { label: "Bond MTN  (c)" }]), 0);
  col.run("fee_ks", "B-FK", "status__1", "It will go to...", "status", JSON.stringify([{ label: "Open Forms" }, { label: "Motions" }]), 1);
  const app = express();
  app.use(express.json());
  registerFeeKTypeRoutes(app, { db });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const get = async () => (await (await fetch(`${base}/api/settings/fee-k-types`)).json()) as {
  data: { rows: { feeKType: string; board: string }[]; feeKTypes: string[]; boards: string[]; draft: boolean };
};
const put = (rows: unknown) =>
  fetch(`${base}/api/settings/fee-k-types`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });

describe("Fee K Types routes", () => {
  it("GET before any save: the draft, flagged, with Monday's Fee K Types and boards", async () => {
    const { data } = await get();
    expect(data.draft).toBe(true);
    expect(data.rows).toEqual(DRAFT_FEE_K_TYPES);
    expect(data.feeKTypes).toEqual(["Motion (c)", "Bond MTN  (c)"]);
    expect(data.boards).toEqual(["Open Forms", "Motions"]);
  });

  it("PUT is admin-only", async () => {
    expect((await put([{ feeKType: "Motion (c)", board: "Motions" }])).status).toBe(403);
    expect((await get()).data.draft).toBe(true);
  });

  it("an admin's save is audited and read back", async () => {
    isAdmin = true;
    const res = await put([{ feeKType: "Motion (c)", spanish: "Moción", board: "Motions", feeSheetJob: "Motion" }, { feeKType: "Bond MTN  (c)" }]);
    expect(res.status).toBe(200);
    const { data } = await get();
    expect(data.draft).toBe(false);
    expect(data.rows).toEqual([{ feeKType: "Motion (c)", spanish: "Moción", board: "Motions", feeSheetJob: "Motion", services: "", servicesEs: "", excluded: "", excludedEs: "" }]);
    expect(audits).toEqual([{ action: "fee_k_types.updated", metadata: { rows: 1 } }]);
  });
});
