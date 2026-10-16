// =============================================================================
// LawPay payments → Fee Ks (decided 2026-10-16)
// =============================================================================
// Until now the firm learned of a payment from LawPay's receipt e-mail to
// rafael@. LawPay webhooks weren't available to us, so the receipts are the
// source: an Outlook rule forwards them to importantdocuments@, and every 10
// minutes (LAWPAY_MAIL=on) scripts/lawpay-mail.ts reads that inbox and hands
// the receipts here (lawpay/mail-job.ts → ingestLawPayReceipts):
//
//   each receipt is stored once (users.db lawpay_events, keyed by the e-mail's
//   id — only the fields read, never the card) and applied:
//     completed payment → its Fee K, by the payment's reference (the app wrote
//     it; the client can't change it — lib/lawpay.ts):
//       1. the Fee K code M21 puts at the end of every reference ("K3F9ZQ1" =
//          its Monday id), else
//       2. the link the app handed out with that exact reference
//          (users.db payment_links), else
//       3. a Pending Fee K whose client's name appears in the reference
//          (links made by hand or before this ledger existed), only when
//          exactly one does.
//     → a note on the Fee K, a Monday bell to whoever handed out the links,
//       Slack ("Payment received");
//     → every fee paid: Contract Stage "Paid needs action" and the Fee K moves
//       to the "Paid Fee Ks" group (when its stage was still the payment-link
//       one — a stage someone changed by hand is left).
//     no match → Slack "Payment to match"; refunds / failures → recorded only.
//   A second copy of the same payment (same LawPay transaction) is a no-op.
//
//   POST /api/contracts/:localId/payment-links  (signed-in staff, from M21)
//        Records the links M21 hands out — e-mailed, texted, copied or marked
//        sent — so the payment that comes back finds its Fee K and fee.
//
// Monday writes go under the shared token (no person is acting); a stage write
// that fails is queued, a group move that fails is said in the note.
// =============================================================================

import type { Express, Request } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth } from "../auth/middleware.js";
import { auditFromReq, recordAudit } from "../audit/log.js";
import { usersDb } from "../db/users-db.js";
import { currentUserId } from "../db/user-context.js";
import { dataSource } from "../data-source/index.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { getBoardColumnsFor } from "@case-pipeline/query";
import { createNotification, fetchBoardStructure } from "@case-pipeline/monday";
import { notifyEvent, slackEscape, withLink } from "../notify/slack.js";
import { makeMondayUserByLogin } from "../contract-info.js";
import {
  FEE_WORDS, feeKIdFromReference, isFullyPaid, normalizeReference, parseReference, personName,
  type FeeType, type IssuedLink, type LawPayPayment,
} from "../lawpay/events.js";
import type { LawPayReceipt } from "../lawpay/email.js";

const PAID_STAGE = "Paid needs action";
const PAID_GROUP = "Paid Fee Ks";
const PENDING_GROUP = "Pending Fee Ks";
/** A paid stage is only set over these — anything else was set by a person. */
const PAYMENT_STAGES = new Set(["Payment link sent", "Needs Payment Link", ""]);
const MONDAY_ACCOUNT_URL = "https://scaltheclinic.monday.com";
const FEES = new Set<FeeType>(["AF", "PF", "FF"]);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

interface FeeKRow {
  localId: string;
  mondayId: string | null;
  clientName: string;
  stage: string | null;
  group: string | null;
  contractFor: string | null;
  af: unknown;
  ff: unknown;
  pf: unknown;
}

const amountOf = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function feeK(db: DatabaseInstance, where: string, arg: string): FeeKRow | undefined {
  return db.prepare(`
    SELECT c.local_id AS localId, c.monday_item_id AS mondayId, COALESCE(p.name, c.name) AS clientName,
           json_extract(c.raw_column_values, '$.contract_stage.label') AS stage, c.group_title AS "group",
           json_extract(c.raw_column_values, '$.contract_for.labels') AS contractFor,
           json_extract(c.raw_column_values, '$.af') AS af, json_extract(c.raw_column_values, '$.ff') AS ff,
           json_extract(c.raw_column_values, '$.pf') AS pf
      FROM contracts c LEFT JOIN profiles p ON p.local_id = c.profile_local_id
     WHERE ${where} AND c.deleted_at IS NULL`).get(arg) as FeeKRow | undefined;
}

/**
 * By the client's name in the reference (whole words; the person's name only —
 * personName drops A-numbers and [tags]). A Pending Fee K counts only when
 * exactly one matches. With none pending, a match among the client's other Fee
 * Ks (Paid / Closed…) means staff already handled it: `closed`, applied quietly.
 */
function feeKByName(db: DatabaseInstance, description: string): { row?: FeeKRow; closed?: string } {
  const rows = db.prepare(`
    SELECT c.local_id AS id, c.group_title AS g, COALESCE(p.name, c.name) AS name
      FROM contracts c LEFT JOIN profiles p ON p.local_id = c.profile_local_id
     WHERE c.deleted_at IS NULL`).all() as { id: string; g: string | null; name: string }[];
  const ref = ` ${description.replace(/\s+/g, " ").trim().toUpperCase()} `;
  // At least two words, so a lone first name never matches.
  const hits = rows.filter((r) => { const n = personName(r.name); return n.includes(" ") && ref.includes(` ${n} `); });
  const pending = hits.filter((r) => r.g === PENDING_GROUP);
  if (pending.length === 1) return { row: feeK(db, "c.local_id = ?", pending[0]!.id) };
  if (pending.length === 0 && hits.length > 0) return { closed: hits[0]!.g ?? "another group" };
  return {};
}

let paidGroupId: { boardId: string; id: string } | null = null;
async function paidGroup(boardId: string): Promise<string | null> {
  if (paidGroupId?.boardId === boardId) return paidGroupId.id;
  const board = await fetchBoardStructure(boardId);
  const g = board.groups?.find((x) => x.title.trim().toLowerCase() === PAID_GROUP.toLowerCase());
  if (g) paidGroupId = { boardId, id: g.id };
  return g?.id ?? null;
}

interface LinkRow { id: number; contract_local_id: string; user_id: number | null; paid_at: string | null }

/**
 * Which Fee K a payment is for — read-only (the dry run uses it too): the Fee
 * K's own code in the reference first, then the link the app recorded with
 * that exact reference, then a Pending Fee K by the client's name.
 */
export function findFeeK(db: DatabaseInstance, payment: Pick<LawPayPayment, "reference">) {
  const ref = parseReference(payment.reference);
  const link = usersDb.prepare(
    "SELECT * FROM payment_links WHERE reference = ? ORDER BY paid_at IS NOT NULL, id DESC LIMIT 1",
  ).get(payment.reference) as LinkRow | undefined;
  const codedId = ref ? feeKIdFromReference(ref.description) : null;
  const byCode = codedId ? feeK(db, "c.monday_item_id = ?", codedId) : undefined;
  const byLink = !byCode && link ? feeK(db, "c.local_id = ?", link.contract_local_id) : undefined;
  const name = !byCode && !byLink && ref ? feeKByName(db, ref.description) : {};
  const row = byCode ?? byLink ?? name.row;
  return {
    ref, link, codedId: byCode ? codedId : null, row,
    by: byCode ? "code" : byLink ? "link" : name.row ? "name" : null,
    /** No Fee K waiting: the client's Fee K is already in this group (Paid / Closed…). */
    closed: row ? null : name.closed ?? null,
  } as const;
}

export type LawPayResult =
  | "duplicate" | "not_ours" | "failed" | "refunded" | "other" | "unmatched" | "already_closed" | "matched" | "fully_paid";

export interface LawPayDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
}

/** Apply one stored event. Exported for tests; the webhook calls it after answering. */
export async function applyLawPayEvent(deps: LawPayDeps, eventId: number, payment: LawPayPayment | null): Promise<LawPayResult> {
  const { db, mondayApiToken: token } = deps;
  const done = (result: LawPayResult, contractLocalId: string | null = null) => {
    usersDb.prepare("UPDATE lawpay_events SET result = ?, contract_local_id = ? WHERE id = ?").run(result, contractLocalId, eventId);
    return result;
  };
  if (!payment) return done("not_ours");
  if (payment.outcome !== "completed") return done(payment.outcome);

  if (payment.transactionId) {
    const seen = usersDb.prepare(
      "SELECT 1 FROM lawpay_events WHERE transaction_id = ? AND id <> ? AND result IN ('matched', 'fully_paid', 'unmatched')",
    ).get(payment.transactionId, eventId);
    if (seen) return done("duplicate");
  }

  const found = findFeeK(db, payment);
  const { ref, codedId, row } = found;
  // A hand-made link for a Fee K staff already moved on (Paid / Closed): nothing to do, no alert.
  if (!row && found.closed) return done("already_closed");
  if (found.link?.paid_at) return done("duplicate", found.link.contract_local_id);
  // The recorded link counts only when it is this Fee K's (the code wins).
  const link = found.link && row && found.link.contract_local_id === row.localId ? found.link : undefined;
  if (!row || !ref || !FEES.has(ref.fee)) {
    await notifyEvent("payment_unmatched",
      `:warning: LawPay payment the app couldn't tie to a Fee K: *${usd.format(payment.amount)}*, reference _${slackEscape(payment.reference)}_ — please file it by hand.`);
    recordAudit({ actor: { userId: null, email: "lawpay" }, action: "lawpay.unmatched", metadata: { event: eventId, amount: payment.amount } });
    return done("unmatched");
  }

  if (link) {
    usersDb.prepare("UPDATE payment_links SET paid_at = datetime('now'), paid_event_id = ? WHERE id = ?").run(eventId, link.id);
  } else {
    usersDb.prepare(`INSERT OR IGNORE INTO payment_links
        (contract_local_id, contract_monday_id, client_name, fee_type, amount, reference, channel, paid_at, paid_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`)
      .run(row.localId, row.mondayId, row.clientName, ref.fee, payment.amount, payment.reference, codedId ? "matched-by-code" : "matched-by-name", eventId);
  }

  // Fully paid? Against the links handed out for this Fee K, else its Monday fees.
  const issued = usersDb.prepare(
    "SELECT fee_type AS fee, amount, paid_at AS paidAt FROM payment_links WHERE contract_local_id = ? AND channel NOT LIKE 'matched-by-%'",
  ).all(row.localId) as IssuedLink[];
  const paidFees = new Set((usersDb.prepare(
    "SELECT DISTINCT fee_type AS f FROM payment_links WHERE contract_local_id = ? AND paid_at IS NOT NULL",
  ).all(row.localId) as { f: FeeType }[]).map((r) => r.f));
  const full = isFullyPaid(issued, { AF: amountOf(row.af), FF: amountOf(row.ff), PF: amountOf(row.pf) }, paidFees);

  const boardId = getBoardColumnsFor(db, "fee_ks")?.mondayBoardId ?? null;
  const lines = [
    `💵 LawPay payment received: ${FEE_WORDS[ref.fee]} ${usd.format(payment.amount)}${payment.method ? ` (${payment.method})` : ""}. Reference: ${payment.reference}.`,
  ];
  let movedNote = "";
  if (full && row.mondayId && boardId) {
    if (PAYMENT_STAGES.has((row.stage ?? "").trim())) {
      const value = { label: PAID_STAGE };
      try {
        await dataSource.setColumnValues(boardId, row.mondayId, { deal_stage: value }, token);
      } catch (err) {
        console.error("[lawpay] paid stage failed; queueing:", err);
        enqueueWrite(db, { opType: "change_column_json", targetTable: "contracts", targetLocalId: row.localId, mondayItemId: row.mondayId, authorOid: null, payload: { boardId, columnId: "deal_stage", value } });
      }
      db.prepare("UPDATE contracts SET raw_column_values = json_set(COALESCE(raw_column_values, '{}'), '$.contract_stage', json(?)) WHERE local_id = ?")
        .run(JSON.stringify(value), row.localId);
      try {
        const groupId = await paidGroup(boardId);
        if (!groupId) throw new Error(`no "${PAID_GROUP}" group on the board`);
        await dataSource.moveItem(boardId, groupId, row.mondayId, token);
        db.prepare("UPDATE contracts SET group_title = ? WHERE local_id = ?").run(PAID_GROUP, row.localId);
        movedNote = `✅ Fully paid: Contract Stage → ${PAID_STAGE}, moved to ${PAID_GROUP}.`;
      } catch (err) {
        console.error("[lawpay] move to Paid Fee Ks failed:", err);
        movedNote = `✅ Fully paid: Contract Stage → ${PAID_STAGE}. Moving it to ${PAID_GROUP} failed — please move it by hand.`;
      }
    } else {
      movedNote = `✅ Fully paid. The Contract Stage ("${row.stage}") was left as it is — it isn't the payment-link stage.`;
    }
    lines.push(movedNote);
  }

  if (row.mondayId) {
    const body = lines.join("\n");
    try {
      await dataSource.postUpdate(row.mondayId, body, token);
    } catch (err) {
      console.error("[lawpay] note failed; queueing:", err);
      enqueueWrite(db, { opType: "create_update", targetTable: "contracts", targetLocalId: row.localId, mondayItemId: row.mondayId, authorOid: null, payload: { body } });
    }
  }

  const types = (() => { try { return (JSON.parse(row.contractFor ?? "[]") as string[]).join(", "); } catch { return ""; } })();
  const link2 = boardId && row.mondayId ? `${MONDAY_ACCOUNT_URL}/boards/${boardId}/pulses/${row.mondayId}` : null;
  await notifyEvent("payment_received", withLink(
    `:moneybag: *${slackEscape(row.clientName)}* paid ${FEE_WORDS[ref.fee].toLowerCase()} ${usd.format(payment.amount)}${types ? ` (${slackEscape(types)})` : ""}` +
      (full ? " — *fully paid*, moved to Paid Fee Ks" : ""),
    link2, "Fee K",
  ));

  // The Monday bell goes to whoever handed out the links.
  const issuer = link?.user_id
    ? (usersDb.prepare("SELECT email, name FROM users WHERE id = ?").get(link.user_id) as { email: string | null; name: string | null } | undefined)
    : undefined;
  if (issuer && row.mondayId) {
    try {
      const me = await makeMondayUserByLogin(token)(issuer.email ?? "", issuer.name ?? "");
      if (me) await createNotification(String(me.id), row.mondayId, `💵 ${row.clientName} paid ${FEE_WORDS[ref.fee].toLowerCase()} ${usd.format(payment.amount)}${full ? " — fully paid" : ""}.`, token);
    } catch (err) {
      console.error("[lawpay] Monday notification failed:", err);
    }
  }

  recordAudit({
    actor: { userId: null, email: "lawpay" }, action: "lawpay.payment",
    targetType: "contract", targetId: row.localId, targetMondayId: row.mondayId,
    metadata: { event: eventId, fee: ref.fee, amount: payment.amount, matchedBy: codedId ? "code" : link ? "link" : "name", fullyPaid: full },
  });
  return done(full ? "fully_paid" : "matched", row.localId);
}

export interface MailReceipt extends LawPayReceipt {
  /** The e-mail's id in the inbox — each one is applied once. */
  messageId: string;
  receivedAt: string | null;
}

/** Store and apply the receipts the mailbox job found. Returns what each became. */
export async function ingestLawPayReceipts(deps: LawPayDeps, receipts: MailReceipt[]): Promise<LawPayResult[]> {
  const out: LawPayResult[] = [];
  for (const r of receipts) {
    if (usersDb.prepare("SELECT 1 FROM lawpay_events WHERE source = ?").get(r.messageId)) continue;
    // Only what was read — never the card number or auth code.
    const kept = { payer: r.payer, account: r.account, paidOn: r.paidOn, method: r.method, receivedAt: r.receivedAt };
    const eventId = Number(usersDb.prepare(
      "INSERT INTO lawpay_events (source, body, transaction_id, reference, amount, outcome) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(r.messageId, JSON.stringify(kept), r.transactionId, r.reference, r.amount, r.outcome).lastInsertRowid);
    try {
      out.push(await applyLawPayEvent(deps, eventId, r));
    } catch (err) {
      console.error("[lawpay] applying a receipt failed:", err);
      usersDb.prepare("UPDATE lawpay_events SET error = ? WHERE id = ?").run(err instanceof Error ? err.message.slice(0, 500) : "error", eventId);
    }
  }
  return out;
}

/** M21 records the links it hands out (signed-in staff). */
export function registerLawPayRoutes(app: Express, deps: { db: DatabaseInstance }): void {
  app.post("/api/contracts/:localId/payment-links", requireAuth, (req: Request, res) => {
    const localId = String(req.params.localId);
    const row = feeK(deps.db, "c.local_id = ?", localId);
    if (!row) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const b = (req.body ?? {}) as { links?: unknown; method?: unknown; channel?: unknown };
    const channel = typeof b.channel === "string" && /^(email|text|copy|mark)$/.test(b.channel) ? b.channel : null;
    const links = Array.isArray(b.links) ? b.links : [];
    const clean = links.flatMap((l) => {
      const x = l as { fee?: unknown; amount?: unknown; reference?: unknown };
      const ref = typeof x.reference === "string" ? parseReference(x.reference) : null;
      return ref && FEES.has(ref.fee) && ref.fee === x.fee ? [{ fee: ref.fee, amount: ref.amount, reference: normalizeReference(x.reference as string) }] : [];
    });
    if (!channel || clean.length === 0 || clean.length !== links.length) {
      res.status(400).json({ error: "Send the links (fee, amount, reference) and how they went out" });
      return;
    }
    const userId = currentUserId(req);
    const insert = usersDb.prepare(`INSERT OR IGNORE INTO payment_links
      (user_id, contract_local_id, contract_monday_id, client_name, fee_type, amount, reference, method, channel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let added = 0;
    for (const l of clean) {
      added += insert.run(userId, localId, row.mondayId, row.clientName, l.fee, l.amount, l.reference,
        typeof b.method === "string" ? b.method.slice(0, 20) : null, channel).changes;
    }
    auditFromReq(req, "lawpay.links_recorded", { targetType: "contract", targetId: localId, targetMondayId: row.mondayId, metadata: { channel, links: clean.length, added } });
    res.json({ data: { recorded: clean.length, added } });
  });
}
