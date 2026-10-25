// =============================================================================
// Buzón — the automatic start on "Paid needs action" (docs/features/buzon.md, Phase 2)
// =============================================================================
// A Fee K whose Contract Stage became "Paid needs action" on or after
// BUZON_AUTO_SINCE (item_events: LawPay's own write and a hand change in Monday
// both come back through the webhook; LawPay also calls startForFeeK at once):
//   1. its Fee K Type(s) have a document list? Else nothing (no_list);
//   2. the list goes on the client's checklist, their link is reused or made;
//   3. the link is texted (buzon_link) unless autoTextBlocked says no — then
//      the Fee K's Paralegal + Assistant are told why, so a person sends it.
// Once per Fee K, ever (buzon_fee_ks), whatever the stage does later.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { recordAudit } from "../audit/log.js";
import { loadFeeKTypes, type FeeKTypeRow } from "../fee-k-types.js";
import { addFeeKList, clientFeeKs, documentsForFeeK } from "../uploads/checklist.js";
import { buzonClient, buzonClientByMondayId, clientSettings, ensureLink } from "./client.js";
import { autoTextBlocked } from "./rules.js";
import { loadBuzonSettings } from "./settings.js";
import { effectiveSmsMode, sendBuzonText, type BuzonTextDeps } from "./text.js";
import { tellFeeKTeam } from "./team.js";

export const PAID_STAGE = "Paid needs action";
const BY = "Buzón (automatic)";

export type StartResult = "texted" | "not_texted" | "no_list" | "no_profile" | "already";

/** Fee Ks (Monday ids) that reached Paid needs action since `since` and were never started. */
export function startCandidates(db: DatabaseInstance, since: string): string[] {
  return (db.prepare(`
    SELECT DISTINCT e.monday_item_id AS id
      FROM item_events e
     WHERE e.board_key = 'fee_ks' AND e.monday_item_id IS NOT NULL
       AND (e.column_id = 'deal_stage' OR e.column_title = 'Contract Stage')
       AND TRIM(e.value_text) = ? AND e.changed_at >= ?
       AND NOT EXISTS (SELECT 1 FROM buzon_fee_ks b WHERE b.fee_k_monday_id = e.monday_item_id)
     ORDER BY e.changed_at
  `).all(PAID_STAGE, since) as { id: string }[]).map((r) => r.id);
}

export async function startForFeeK(
  deps: BuzonTextDeps & { feeKTypes?: () => FeeKTypeRow[] },
  feeKMondayId: string,
): Promise<StartResult> {
  const { db } = deps;
  if (db.prepare("SELECT 1 FROM buzon_fee_ks WHERE fee_k_monday_id = ?").get(feeKMondayId)) return "already";

  const contract = db.prepare(
    "SELECT local_id AS localId, profile_monday_id AS profileMondayId, profile_local_id AS profileLocalId FROM contracts WHERE monday_item_id = ? AND deleted_at IS NULL",
  ).get(feeKMondayId) as { localId: string; profileMondayId: string | null; profileLocalId: string } | undefined;
  const save = (result: StartResult, reason: string | null, extra: { profileLocalId?: string | null; profileMondayId?: string | null; linkId?: number | null } = {}) => {
    db.prepare(`
      INSERT OR IGNORE INTO buzon_fee_ks (fee_k_monday_id, fee_k_local_id, profile_local_id, profile_monday_id, result, reason, link_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(feeKMondayId, contract?.localId ?? null, extra.profileLocalId ?? null, extra.profileMondayId ?? null, result, reason, extra.linkId ?? null);
    recordAudit({
      actor: { userId: null, email: "buzon" }, action: "buzon.started",
      targetType: "contract", targetId: contract?.localId ?? null, targetMondayId: feeKMondayId,
      metadata: { result, reason },
    });
    return result;
  };

  const client = contract
    ? (contract.profileMondayId ? buzonClientByMondayId(db, contract.profileMondayId) : null) ?? buzonClient(db, contract.profileLocalId)
    : null;
  if (!contract || !client) return save("no_profile", contract ? "the Fee K has no client profile" : "the Fee K is not in the mirror yet");

  const table = (deps.feeKTypes ?? loadFeeKTypes)();
  const feeK = clientFeeKs(db, client).find((k) => k.mondayId === feeKMondayId);
  if (!feeK || !documentsForFeeK(feeK, table).length) {
    return save("no_list", "its Fee K Type has no document list", { profileLocalId: client.localId, profileMondayId: client.mondayId });
  }
  addFeeKList(db, client, feeK, table, BY);
  const link = ensureLink(db, client, BY);
  const ids = { profileLocalId: client.localId, profileMondayId: client.mondayId, linkId: link?.id ?? null };
  const types = feeK.feeKTypes.join(" + ");

  const blocked = link
    ? autoTextBlocked({ kind: "link", firm: loadBuzonSettings(), client: clientSettings(db, client), phoneE164: client.phone, smsMode: effectiveSmsMode(deps.seed) })
    : "client upload links are off on this server (CLIENT_UPLOADS)";
  let reason = blocked;
  if (!blocked && link) {
    const sent = await sendBuzonText(deps, { client, kind: "link", vars: { uploadLink: link.url }, linkId: link.id });
    if (sent.status !== "failed") {
      await tellFeeKTeam(db, deps.mondayApiToken, feeKMondayId,
        `📤 Buzón sent to ${client.name}: the documents for ${types}.`,
        { text: `Buzón sent to ${client.name} for ${types}${sent.status === "dry_run" ? " (dry run)" : ""}.`, profileMondayId: client.mondayId });
      return save("texted", null, ids);
    }
    reason = sent.error ?? "the text failed";
  }
  await tellFeeKTeam(db, deps.mondayApiToken, feeKMondayId,
    `📤 Buzón ready for ${client.name} (${types}), NOT texted: ${reason}. Open the client → Upload link to send it.`,
    { text: `Buzón ready for ${client.name} (${types}), not texted: ${reason}.`, profileMondayId: client.mondayId });
  return save("not_texted", reason, ids);
}
