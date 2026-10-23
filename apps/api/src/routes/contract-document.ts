// =============================================================================
// Contract generation support (P14 → M22 Generate contract)
// =============================================================================
// The contract itself is filled in the browser, from the firm's templates in
// SharePoint (apps/web/src/lib/contract-fill.ts) — templates never pass through
// this server. The API only:
//   GET  /api/contracts/:localId/document-form — what Monday knows, to pre-fill
//        the form: client, e-mail, address, attorney, AF / FF / PF, and the
//        client's next hearing (type + date) from their open court case, and
//        the scope of services for its Fee K Type(s) (Fee K Types table), and
//        the attorney pick list (active roster attorneys + e-mails).
//   POST /api/contracts/:localId/document-generated — audit entry for a
//        generated contract (template name + fees; no client details). M22
//        calls it on Send for signature and on each Download, not on Preview.
//        It also makes whoever generated it the Fee K's ASSISTANT when that
//        column is empty — locally and on Monday (checked live first), never
//        replacing someone already there (decided 2026-10-15). Their own
//        Monday token, the durable queue on outage.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import type { Request } from "express";
import { requireAuth } from "../auth/middleware.js";
import { auditFromReq } from "../audit/log.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { feeKCaseTypeSql, getBoardColumnsFor } from "@case-pipeline/query";
import { usersDb } from "../db/users-db.js";
import { listStaff, makeStaffResolver, normName, splitPeople, type ResolvedStaff, type StaffMember } from "../staff/roster.js";
import { FEE_K_ASSISTANT, makeMondayUserByLogin, peopleValue } from "../contract-info.js";
import { hearingKindOf } from "@case-pipeline/query";
import { letterAddress, oneLineAddress } from "../documents/us-address.js";
import { loadDocumentSettings } from "../documents/document-settings.js";
import { contractTitles, feeKTypesSaved, loadFeeKTypes, scopeFor, type FeeKTypeRow } from "../fee-k-types.js";
import { DRAFT_FEE_K_TYPES } from "../fee-k-types-draft.js";
import type { AttorneyInfo } from "../documents/document-settings.js";

interface ContractDocRow {
  monday_item_id: string | null;
  itemName: string;
  profileLocalId: string | null;
  clientName: string | null;
  email: string | null;
  address: string | null;
  attorney: string | null;
  contractFor: string | null;
  af: unknown;
  ff: unknown;
  pf: unknown;
  assistant: string | null;
}

export interface ContractPrefill {
  clientName: string;
  email: string;
  /** One line, tidied ("Street, City, ST zip"; as typed when it can't be split). */
  address: string;
  /** The same address split for a letter: street line + "City, ST zip" ("" when it can't tell). */
  street: string;
  cityStateZip: string;
  attorneyName: string;
  /** The attorney's e-mail (staff roster, else Settings → Documents); "" when unknown. For Adobe Sign. */
  attorneyEmail: string;
  /** Who can sign: the active attorneys on the staff roster, each with an e-mail when the roster has one. */
  attorneys: ContractAttorney[];
  contractFor: string[];
  /** The matter for the contract from the Fee K Type(s): clean English title, and Spanish. */
  formName: string;
  formNameEs: string;
  attorneyFee: number | null;
  filingFee: number | null;
  processingFee: number | null;
  /** "Master Hearing" / "Individual Hearing" / Monday's own label; "" when none. */
  hearingType: string;
  /** ISO date of the next hearing; "" when none. */
  hearingDate: string;
  /** Scope of services for the Fee K's type(s) (Fee K Types table), "" each when none. */
  scope: Pick<FeeKTypeRow, "services" | "servicesEs" | "excluded" | "excludedEs">;
}

const amount = (raw: unknown): number | null => {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

function labels(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((l): l is string => typeof l === "string") : [];
  } catch {
    return [];
  }
}

/** How the 2026 COURT contract names a hearing. */
export function contractHearingType(mondayLabel: string | null): string {
  if (!mondayLabel) return "";
  const kind = hearingKindOf(mondayLabel);
  return kind === "mch" ? "Master Hearing" : kind === "trial" ? "Individual Hearing" : mondayLabel;
}

export interface ContractAttorney {
  name: string;
  email: string;
  /** Staff roster id; null for someone only in Settings → Documents. */
  staffId: number | null;
}

type DocumentAttorney = Pick<AttorneyInfo, "givenName" | "familyName" | "email">;
const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * The attorney pick list (M22): every active attorney on the staff roster, named
 * as Settings → Documents names them when the e-mails match (Monday calls Rekha
 * "Rekha@Sharma- com"), with the roster e-mail, else the Documents one; then
 * anyone only in Settings → Documents. By name.
 */
export function contractAttorneyOptions(
  staff: Pick<StaffMember, "id" | "name" | "email" | "active" | "roles">[],
  documents: DocumentAttorney[],
): ContractAttorney[] {
  const docName = (a: DocumentAttorney) => `${a.givenName} ${a.familyName}`.replace(/\s+/g, " ").trim();
  const used = new Set<DocumentAttorney>();
  const out: ContractAttorney[] = staff.filter((s) => s.active && s.roles.includes("attorney")).map((s) => {
    const doc = documents.find((a) => lower(a.email) !== "" && lower(a.email) === lower(s.email))
      ?? documents.find((a) => normName(docName(a)) === normName(s.name));
    if (doc) used.add(doc);
    return { name: doc ? docName(doc) : s.name, email: (s.email ?? "").trim() || (doc?.email ?? "").trim(), staffId: s.id };
  });
  for (const a of documents) if (!used.has(a)) out.push({ name: docName(a), email: a.email.trim(), staffId: null });
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * The Fee K's attorney (People column text, "A, B" for two) as one of the pick
 * list: the first that the roster's matcher (aliases included) or the list's
 * own names recognise. Null when none does.
 */
export function pickContractAttorney(
  label: string | null,
  options: ContractAttorney[],
  resolve: (name: string) => Pick<ResolvedStaff, "id"> | null,
): ContractAttorney | null {
  for (const name of splitPeople(label)) {
    const staffId = resolve(name)?.id;
    const hit = options.find((o) => (staffId !== undefined && o.staffId === staffId) || normName(o.name) === normName(name));
    if (hit) return hit;
  }
  return null;
}

/** The attorney's e-mail from Settings → Documents, by full name. */
export function attorneyEmailFor(name: string, attorneys: Pick<AttorneyInfo, "givenName" | "familyName" | "email">[]): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const want = norm(name);
  if (!want) return "";
  const hit = attorneys.find((a) => norm(`${a.givenName} ${a.familyName}`) === want);
  return hit?.email.trim() ?? "";
}

export function contractPrefill(
  row: ContractDocRow,
  hearing: { type: string | null; date: string | null } | null,
  attorneys: DocumentAttorney[] = [],
  feeKTypes: FeeKTypeRow[] = [],
  team: { options: ContractAttorney[]; resolve: (name: string) => Pick<ResolvedStaff, "id"> | null } = { options: [], resolve: () => null },
): ContractPrefill {
  const titles = contractTitles(labels(row.contractFor), feeKTypes);
  // The Fee K's attorney as one of the pick list; else the first name that isn't an e-mail.
  const picked = pickContractAttorney(row.attorney, team.options, team.resolve);
  const attorneyName = picked?.name ?? splitPeople(row.attorney).find((s) => !s.includes("@")) ?? "";
  return {
    clientName: (row.clientName ?? row.itemName).trim(),
    email: row.email?.trim() ?? "",
    address: oneLineAddress(row.address),
    ...letterAddress(row.address),
    attorneyName,
    attorneyEmail: picked?.email || attorneyEmailFor(attorneyName, attorneys),
    attorneys: team.options,
    contractFor: labels(row.contractFor),
    formName: titles.en,
    formNameEs: titles.es,
    attorneyFee: amount(row.af),
    filingFee: amount(row.ff),
    processingFee: amount(row.pf),
    hearingType: contractHearingType(hearing?.type ?? null),
    hearingDate: hearing?.date ?? "",
    scope: scopeFor(labels(row.contractFor), feeKTypes),
  };
}

export type AssistantOutcome = "assigned" | "queued" | "kept" | "unknown-user" | "not-synced";

export function registerContractDocumentRoutes(
  app: Express,
  deps: { db: DatabaseInstance; mondayApiToken?: string; writeTokenOptions?: WriteTokenOptions },
): void {
  const { db } = deps;
  const mondayUser = makeMondayUserByLogin(deps.mondayApiToken, usersDb);

  /** Whoever generated the contract becomes the Fee K's Assistant — only when nobody is. */
  async function assignAssistant(req: Request, localId: string, row: ContractDocRow): Promise<AssistantOutcome> {
    if (!row.monday_item_id || !deps.writeTokenOptions) return "not-synced";
    if ((row.assistant ?? "").trim()) return "kept";
    // The local copy can lag a change made in Monday minutes ago.
    if (await dataSource.getColumnText(row.monday_item_id, FEE_K_ASSISTANT.id)) return "kept";
    const me = await mondayUser(String(req.user?.preferred_username ?? req.user?.email ?? ""), String(req.user?.name ?? ""));
    if (!me) return "unknown-user";
    const boardId = getBoardColumnsFor(db, "fee_ks")?.mondayBoardId;
    if (!boardId) return "not-synced";
    const value = peopleValue(me.id);
    let outcome: AssistantOutcome = "assigned";
    try {
      await withTokenFallback(
        (token) => dataSource.setColumnValues(boardId, row.monday_item_id!, { [FEE_K_ASSISTANT.id]: value }, token),
        deps.writeTokenOptions(req),
      );
    } catch (err) {
      console.error("[write-back] Fee K assistant failed; queueing for retry:", err);
      enqueueWrite(db, {
        opType: "change_column_json", targetTable: "contracts", targetLocalId: localId,
        mondayItemId: row.monday_item_id, authorOid: req.user?.oid ?? null,
        payload: { boardId, columnId: FEE_K_ASSISTANT.id, value },
      });
      outcome = "queued";
    }
    db.prepare(`UPDATE contracts SET raw_column_values = json_set(COALESCE(raw_column_values, '{}'), '$.${FEE_K_ASSISTANT.key}', json(?)) WHERE local_id = ?`)
      .run(JSON.stringify({ label: me.name }), localId);
    return outcome;
  }

  const load = (localId: string) =>
    db.prepare(`
      SELECT c.monday_item_id, c.name AS itemName, p.local_id AS profileLocalId,
             p.name AS clientName, p.email,
             -- The profile's Address, else its Mailing address, else the Fee K's own
             -- copy (a mirror) — the same order P14's "missing Address" flag uses.
             COALESCE(NULLIF(TRIM(p.address), ''),
                      NULLIF(TRIM(json_extract(p.raw_column_values, '$.mailing_address')), ''),
                      json_extract(c.raw_column_values, '$.address')) AS address,
             json_extract(c.raw_column_values, '$.attorney.label')      AS attorney,
             ${feeKCaseTypeSql()} AS contractFor,
             json_extract(c.raw_column_values, '$.af')                  AS af,
             json_extract(c.raw_column_values, '$.ff')                  AS ff,
             json_extract(c.raw_column_values, '$.pf')                  AS pf,
             json_extract(c.raw_column_values, '$.assistant.label')     AS assistant
        FROM contracts c
        LEFT JOIN profiles p ON p.local_id = c.profile_local_id
       WHERE c.local_id = ? AND c.deleted_at IS NULL
    `).get(localId) as ContractDocRow | undefined;

  app.get("/api/contracts/:localId/document-form", requireAuth, (req, res) => {
    const row = load(String(req.params.localId));
    if (!row) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const hearing = row.profileLocalId
      ? (db.prepare(`
          SELECT json_extract(column_values, '$.hearing_type.label') AS type, next_date AS date
            FROM board_items
           WHERE board_key = 'court_cases' AND profile_local_id = ? AND deleted_at IS NULL AND next_date >= ?
           ORDER BY next_date LIMIT 1
        `).get(row.profileLocalId, today) as { type: string | null; date: string | null } | undefined) ?? null
      : null;
    // The saved table, else the draft: its scope text is approved (2026-10-23).
    const feeKTypes = feeKTypesSaved() ? loadFeeKTypes() : DRAFT_FEE_K_TYPES;
    const documents = loadDocumentSettings().attorneys;
    const team = { options: contractAttorneyOptions(listStaff(usersDb), documents), resolve: makeStaffResolver(usersDb) };
    res.json({ data: contractPrefill(row, hearing, documents, feeKTypes, team) });
  });

  app.post("/api/contracts/:localId/document-generated", requireAuth, async (req, res) => {
    const localId = String(req.params.localId);
    const row = load(localId);
    if (!row) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const b = (req.body ?? {}) as { template?: unknown; format?: unknown; attorneyFee?: unknown; filingFee?: unknown };
    let assistant: AssistantOutcome | "failed";
    try {
      assistant = await assignAssistant(req, localId, row);
    } catch (err) {
      console.error("[contracts] assistant auto-assign failed:", err);
      assistant = "failed";
    }
    auditFromReq(req, "doc.contract_generated", {
      targetType: "contract", targetId: localId, targetMondayId: row.monday_item_id,
      metadata: {
        template: typeof b.template === "string" ? b.template.slice(0, 200) : null,
        format: b.format === "pdf" ? "pdf" : "docx",
        attorneyFee: amount(b.attorneyFee), filingFee: amount(b.filingFee),
        assistant,
      },
    });
    res.json({ data: { assistant } });
  });
}
