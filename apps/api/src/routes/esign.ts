// =============================================================================
// Contracts out for signature in Adobe Sign, through Zapier (P14 → M22)
// =============================================================================
// The firm's Adobe Sign is reachable only through Zapier, so the app talks to
// three Zaps (docs/features/esign-zapier.md has every field):
//
//   app ──POST──▶ Zap 1 (Catch Hook → Upload Document → Create Agreement,
//                 attorney order 1, client order 2 → POST "sent" back)
//   Zap 2 (Agreement State Changed) ──POST──▶ /api/webhooks/zapier/:secret
//   Zap 3 (Signed by All → PDF of Signed Agreement) ──POST "signed_pdf"──▶ same
//
// POST /api/contracts/:localId/esign — the browser already made the PDF (M22,
//   the user's Microsoft 365). Raw PDF body + ?attorneyEmail=&clientEmail=.
//   The PDF waits under data/esign/ behind a random link Zap 1 downloads from
//   (GET /api/esign/files/:token, no login — the token is the key, valid 3
//   days). Then the step "sent for signature" (Atty Reviewing) and a note.
// POST /api/webhooks/zapier/:secret — every Adobe event. events.ts decides;
//   this applies: the CONTRACT_STEPS write (stage + date), a note on the Fee K,
//   and for signed / rejected / expired / recalled a Monday notification to
//   whoever sent it + Slack. The signed PDF goes onto the Fee K's (else the
//   client profile's) file column.
//
// Off unless ZAPIER_ESIGN_HOOK_URL, ZAPIER_ESIGN_SECRET and API_URL are set.
// Writes made for an Adobe event go under the sender's Monday token (shared
// token as the net), like every other write-back.
// =============================================================================

import express from "express";
import type { Express, Request } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { requireAuth } from "../auth/middleware.js";
import { auditFromReq, recordAudit } from "../audit/log.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { TokenFallbackOptions } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { getUserMondayToken, markMondayTokenRejected } from "./monday-oauth.js";
import { executeContractStep } from "./contract-step.js";
import { DATA_DIR } from "../paths.js";
import { fetchWorkspaceUsers } from "@case-pipeline/monday";
import { getBoardColumnsFor } from "@case-pipeline/query";
import {
  OPEN_STATUSES, agreementNameFor, classifyEsignEvent, esignRefOf, planEsignEvent,
  type EsignStatus,
} from "../esign/events.js";
import { notifyMonday, notifySlack } from "../esign/notify.js";

const ESIGN_DIR = "esign";
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const FILE_LINK_HOURS = 72;
const MONDAY_ACCOUNT_URL = "https://scaltheclinic.monday.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export interface EsignConfig {
  hookUrl: string;
  secret: string;
  publicUrl: string;
}

/** Null = the feature is off (one of the three settings missing). */
export function esignConfig(env: NodeJS.ProcessEnv = process.env): EsignConfig | null {
  const hookUrl = env.ZAPIER_ESIGN_HOOK_URL?.trim();
  const secret = env.ZAPIER_ESIGN_SECRET?.trim();
  const publicUrl = env.API_URL?.trim().replace(/\/+$/, "");
  return hookUrl && secret && publicUrl ? { hookUrl, secret, publicUrl } : null;
}

interface AgreementRow {
  id: number;
  contract_local_id: string;
  contract_monday_id: string;
  profile_monday_id: string | null;
  client_name: string;
  client_email: string;
  attorney_email: string;
  agreement_id: string | null;
  file_token: string;
  status: EsignStatus;
  sent_by_oid: string | null;
  sent_by_name: string | null;
  sent_by_monday_id: string | null;
  created_at: string;
}

function secretMatches(provided: string, secret: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|#%&{}$!'@+`=]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "contract";

export interface EsignDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

/** Routes Zapier calls (no Azure login). Register BEFORE the /api/ requireAuth catch-all. */
export function registerEsignPublicRoutes(app: Express, deps: EsignDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN } = deps;

  // The PDF for Zap 1's "Upload a Document". The file name segment is cosmetic
  // (Adobe names the document after it).
  app.get("/api/esign/files/:token/:name", (req, res) => {
    const token = String(req.params.token);
    const row = TOKEN_RE.test(token)
      ? (db.prepare("SELECT id, created_at FROM esign_agreements WHERE file_token = ?").get(token) as { id: number; created_at: string } | undefined)
      : undefined;
    const ageHours = row ? (Date.now() - Date.parse(`${row.created_at.replace(" ", "T")}Z`)) / 3_600_000 : Infinity;
    const file = path.join(DATA_DIR, ESIGN_DIR, `${token}.pdf`);
    if (!row || ageHours > FILE_LINK_HOURS || !fs.existsSync(file)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.type("application/pdf").sendFile(file);
  });

  // Every event from Zaps 1–3.
  app.post("/api/webhooks/zapier/:secret", async (req, res) => {
    const config = esignConfig();
    if (!config) {
      res.status(503).json({ error: "Adobe Sign via Zapier is not configured" });
      return;
    }
    if (!secretMatches(String(req.params.secret ?? ""), config.secret)) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : null);
    const kind = classifyEsignEvent(b.event);
    const agreementId = str(b.agreementId);
    const ref = esignRefOf(b.ref, b.agreementName);

    const row = (ref != null
      ? db.prepare("SELECT * FROM esign_agreements WHERE id = ?").get(ref)
      : agreementId
        ? db.prepare("SELECT * FROM esign_agreements WHERE agreement_id = ?").get(agreementId)
        : undefined) as AgreementRow | undefined;
    if (!row) {
      // Not one of ours (an agreement sent by hand from Adobe) — acknowledge so Zapier doesn't retry.
      res.json({ ok: true, ignored: "no matching contract" });
      return;
    }
    try {
      const result = await applyEvent(db, row, kind, {
        agreementId, participantEmail: str(b.participantEmail), pdfUrl: str(b.pdfUrl), rawEvent: str(b.event),
      }, MONDAY_API_TOKEN);
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[esign] event failed:", err);
      db.prepare("UPDATE esign_agreements SET last_error = ?, updated_at = datetime('now') WHERE id = ?")
        .run(err instanceof Error ? err.message.slice(0, 500) : "error", row.id);
      // 500 → Zapier shows the step as errored and the run can be replayed.
      res.status(500).json({ error: "Could not apply the event" });
    }
  });
}

/** Token options for a write made on the sender's behalf, outside any request. */
function senderTokenOptions(row: AgreementRow, shared: string | undefined): TokenFallbackOptions {
  const oid = row.sent_by_oid ?? "";
  return {
    userToken: oid ? getUserMondayToken(oid) : null,
    sharedToken: shared,
    onPersonalTokenRejected: (reason) => oid && markMondayTokenRejected(oid, reason),
  };
}

async function postNote(db: DatabaseInstance, itemId: string, body: string, tokenOptions: TokenFallbackOptions, authorOid: string | null, localId: string) {
  try {
    await withTokenFallback((token) => dataSource.postUpdate(itemId, body, token), tokenOptions);
  } catch (err) {
    console.error("[esign] note failed; queueing:", err);
    enqueueWrite(db, { opType: "create_update", targetTable: "contracts", targetLocalId: localId, mondayItemId: itemId, authorOid, payload: { body } });
  }
}

async function applyEvent(
  db: DatabaseInstance,
  row: AgreementRow,
  kind: ReturnType<typeof classifyEsignEvent>,
  ev: { agreementId: string | null; participantEmail: string | null; pdfUrl: string | null; rawEvent: string | null },
  sharedToken: string | undefined,
): Promise<Record<string, unknown>> {
  const tokenOptions = senderTokenOptions(row, sharedToken);
  const audit = (action: string, metadata: Record<string, unknown>) =>
    recordAudit({
      actor: { userId: null, email: "zapier:adobe-sign" }, action,
      targetType: "contract", targetId: row.contract_local_id, targetMondayId: row.contract_monday_id,
      metadata: { agreement: row.id, ...metadata },
    });

  db.prepare("UPDATE esign_agreements SET last_event = ?, agreement_id = COALESCE(agreement_id, ?), updated_at = datetime('now') WHERE id = ?")
    .run(ev.rawEvent, ev.agreementId, row.id);

  if (kind === "signed_pdf") return attachSignedPdf(db, row, ev.pdfUrl, tokenOptions, audit);

  const plan = planEsignEvent(row, kind, ev.participantEmail);
  if (!plan.status) return { applied: false, kind };

  db.prepare("UPDATE esign_agreements SET status = ?, last_error = NULL, updated_at = datetime('now') WHERE id = ?").run(plan.status, row.id);

  const stepResults: Record<string, unknown> = {};
  for (const step of plan.steps) {
    const r = await executeContractStep(db, row.contract_local_id, { step }, {
      tokenOptions, authorOid: row.sent_by_oid,
      audit: (action, opts) => recordAudit({ actor: { userId: null, email: "zapier:adobe-sign" }, action, ...opts }),
    });
    // A stage someone moved by hand stays as they left it; the note still goes.
    stepResults[step] = r.ok ? r.data.stage : r.body.error;
  }
  if (plan.note) await postNote(db, row.contract_monday_id, plan.note, tokenOptions, row.sent_by_oid, row.contract_local_id);
  if (plan.notify) {
    const boardId = getBoardColumnsFor(db, "fee_ks")?.mondayBoardId;
    const link = boardId ? `${MONDAY_ACCOUNT_URL}/boards/${boardId}/pulses/${row.contract_monday_id}` : null;
    await Promise.all([
      notifyMonday(row.sent_by_monday_id, row.contract_monday_id, plan.notify, sharedToken),
      notifySlack(plan.notify, link),
    ]);
  }
  audit("esign.event", { kind, status: plan.status, steps: stepResults });
  return { applied: true, kind, status: plan.status, steps: stepResults };
}

/** The signed copy → the Fee K's file column, else the client profile's "Files". */
async function attachSignedPdf(
  db: DatabaseInstance,
  row: AgreementRow,
  pdfUrl: string | null,
  tokenOptions: TokenFallbackOptions,
  audit: (action: string, metadata: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  if (!pdfUrl || !/^https:\/\//i.test(pdfUrl)) throw new Error("signed_pdf needs an https pdfUrl");
  const res = await fetch(pdfUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Downloading the signed PDF failed (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) throw new Error("Signed PDF is empty or too large");

  const rel = path.join(ESIGN_DIR, `signed-${row.id}.pdf`);
  fs.mkdirSync(path.join(DATA_DIR, ESIGN_DIR), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, rel), bytes, { mode: 0o600 });
  db.prepare("UPDATE esign_agreements SET signed_pdf_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(row.id);

  const feeKFile = getBoardColumnsFor(db, "fee_ks")?.columns.find((c) => c.type === "file");
  const profileFiles = getBoardColumnsFor(db, "profiles")?.columns.find((c) => c.type === "file" && c.title.trim().toLowerCase() === "files");
  const target = feeKFile
    ? { itemId: row.contract_monday_id, columnId: feeKFile.columnId, table: "contracts", localId: row.contract_local_id }
    : profileFiles && row.profile_monday_id
      ? { itemId: row.profile_monday_id, columnId: profileFiles.columnId, table: "profiles", localId: null }
      : null;
  if (!target) {
    audit("esign.signed_pdf", { attached: false, reason: "no file column" });
    return { attached: false, saved: true };
  }
  const fileName = `${safeFileName(row.client_name)} - Signed Fee K.pdf`;
  try {
    await withTokenFallback(
      (token) => dataSource.addFile(target.itemId, target.columnId, fileName, new Uint8Array(bytes), "application/pdf", token),
      tokenOptions,
    );
  } catch (err) {
    console.error("[esign] attaching the signed PDF failed; queueing:", err);
    enqueueWrite(db, {
      opType: "add_file", targetTable: target.table, targetLocalId: target.localId, mondayItemId: target.itemId,
      authorOid: row.sent_by_oid, payload: { columnId: target.columnId, filePath: rel, fileName, contentType: "application/pdf" },
    });
  }
  audit("esign.signed_pdf", { attached: true, on: target.table });
  return { attached: true, on: target.table };
}

/** The send itself (signed-in staff). */
export function registerEsignRoutes(app: Express, deps: EsignDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  let staffCache: { users: Awaited<ReturnType<typeof fetchWorkspaceUsers>>; at: number } | null = null;
  async function mondayUserIdOf(req: Request): Promise<string | null> {
    const email = (req.user?.preferred_username ?? req.user?.email ?? "").toLowerCase();
    const name = (req.user?.name ?? "").trim().toLowerCase();
    try {
      if (!staffCache || Date.now() - staffCache.at > 10 * 60 * 1000) {
        staffCache = { users: await fetchWorkspaceUsers(MONDAY_API_TOKEN), at: Date.now() };
      }
      const hit = staffCache.users.find((u) => (email && u.email?.toLowerCase() === email) || (name && u.name.trim().toLowerCase() === name));
      return hit ? String(hit.id) : null;
    } catch (err) {
      console.error("[esign] could not resolve the sender to a Monday user:", err);
      return null;
    }
  }

  app.get("/api/esign/status", requireAuth, (_req, res) => {
    res.json({ data: { enabled: !!esignConfig() && !!MONDAY_API_TOKEN } });
  });

  app.post(
    "/api/contracts/:localId/esign",
    requireAuth,
    express.raw({ type: "application/pdf", limit: MAX_PDF_BYTES }),
    async (req, res) => {
      const config = esignConfig();
      if (!config || !MONDAY_API_TOKEN) {
        res.status(503).json({ error: "Sending for signature is not set up on this server" });
        return;
      }
      const pdf = req.body as unknown;
      if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
        res.status(400).json({ error: "Send the contract PDF as the request body" });
        return;
      }
      const attorneyEmail = String(req.query.attorneyEmail ?? "").trim();
      const clientEmail = String(req.query.clientEmail ?? "").trim();
      if (!EMAIL_RE.test(attorneyEmail) || !EMAIL_RE.test(clientEmail)) {
        res.status(400).json({ error: "The attorney's and the client's e-mail are both needed" });
        return;
      }
      if (attorneyEmail.toLowerCase() === clientEmail.toLowerCase()) {
        res.status(400).json({ error: "The attorney and the client need different e-mails" });
        return;
      }
      const localId = String(req.params.localId);
      const contract = db.prepare(`
        SELECT c.monday_item_id AS mondayId, COALESCE(p.name, c.name) AS clientName, p.monday_item_id AS profileMondayId
          FROM contracts c LEFT JOIN profiles p ON p.local_id = c.profile_local_id
         WHERE c.local_id = ? AND c.deleted_at IS NULL
      `).get(localId) as { mondayId: string | null; clientName: string; profileMondayId: string | null } | undefined;
      if (!contract) {
        res.status(404).json({ error: "Contract not found" });
        return;
      }
      if (!contract.mondayId) {
        res.status(400).json({ error: "This contract has not synced to Monday yet — try again after the next sync" });
        return;
      }
      const open = db.prepare(
        `SELECT id, status FROM esign_agreements WHERE contract_monday_id = ? AND status IN (${OPEN_STATUSES.map(() => "?").join(",")})`,
      ).get(contract.mondayId, ...OPEN_STATUSES) as { id: number; status: string } | undefined;
      if (open) {
        res.status(409).json({ error: "This contract is already out for signature in Adobe Sign. Recall it in Adobe first to send a new one." });
        return;
      }

      const token = randomBytes(24).toString("base64url");
      fs.mkdirSync(path.join(DATA_DIR, ESIGN_DIR), { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, ESIGN_DIR, `${token}.pdf`), pdf, { mode: 0o600 });
      const senderName = req.user?.name ?? null;
      const id = Number(db.prepare(`
        INSERT INTO esign_agreements
          (contract_local_id, contract_monday_id, profile_monday_id, client_name, client_email, attorney_email, file_token, status, sent_by_oid, sent_by_name, sent_by_monday_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', ?, ?, ?)
      `).run(
        localId, contract.mondayId, contract.profileMondayId, contract.clientName, clientEmail, attorneyEmail, token,
        req.user?.oid ?? null, senderName, await mondayUserIdOf(req),
      ).lastInsertRowid);

      const agreementName = agreementNameFor(contract.clientName, id);
      try {
        const hook = await fetch(config.hookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ref: `CP-${id}`,
            agreementName,
            pdfUrl: `${config.publicUrl}/api/esign/files/${token}/${encodeURIComponent(safeFileName(agreementName))}.pdf`,
            fileName: `${safeFileName(agreementName)}.pdf`,
            attorneyEmail,
            clientEmail,
            clientName: contract.clientName,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!hook.ok) throw new Error(`Zapier answered ${hook.status}`);
      } catch (err) {
        console.error("[esign] Zapier hook failed:", err);
        db.prepare("UPDATE esign_agreements SET status = 'send_failed', last_error = ?, updated_at = datetime('now') WHERE id = ?")
          .run(err instanceof Error ? err.message.slice(0, 500) : "error", id);
        res.status(502).json({ error: "Zapier did not take the contract — nothing was sent. Try again in a minute." });
        return;
      }

      // Zapier has it. The stage move can be refused (someone moved it by
      // hand) without undoing the send.
      const step = await executeContractStep(db, localId, { step: "sent_for_signature" }, {
        tokenOptions: writeTokenOptions(req), authorOid: req.user?.oid ?? null,
        audit: (action, opts) => auditFromReq(req, action, opts),
      });
      await postNote(
        db, contract.mondayId,
        `📝 Contract sent for signature in Adobe Sign by ${senderName ?? "staff"}: attorney (${attorneyEmail}) first, then the client (${clientEmail}).`,
        writeTokenOptions(req), req.user?.oid ?? null, localId,
      );
      auditFromReq(req, "esign.sent", {
        targetType: "contract", targetId: localId, targetMondayId: contract.mondayId,
        metadata: { agreement: id, stageMoved: step.ok },
      });
      res.json({
        data: {
          id, stage: step.ok ? step.data.stage : null,
          warning: step.ok ? null : `Sent, but the Contract Stage was not changed: ${String(step.body.error)}`,
        },
      });
    },
  );
}
