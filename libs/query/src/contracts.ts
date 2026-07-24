// =============================================================================
// Contract / Fee K Queries
// =============================================================================
// Contracts carry the firm's fee history. Each row is enriched here into a
// case-oriented shape: a normalized status (see normalizeContractStatus), the
// AF/PF amounts parsed out of the Monday column blob, and the actual Open Form /
// Court Case the contract represents, resolved live from the board relations.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type {
  ContractSummary,
  ContractLinkedCase,
  ContractTotals,
  ClientContracts,
} from "./types";
import { normalizeContractStatus, isContractPaid } from "./types";

interface RawContractRow {
  localId: string;
  mondayItemId: string | null;
  caseType: string | null;
  status: string | null;
  value: number | null;
  contractId: string | null;
  groupTitle: string | null;
  rawColumnValues: string | null;
}

const SELECT_COLUMNS = `
  local_id           AS localId,
  monday_item_id     AS mondayItemId,
  case_type          AS caseType,
  status,
  value,
  contract_id        AS contractId,
  group_title        AS groupTitle,
  raw_column_values  AS rawColumnValues
`;

/**
 * Batch-fetch contracts for multiple profiles in one query.
 * Returns a Map keyed by profileLocalId, split into active/closed with totals.
 */
export function batchGetClientContracts(
  db: Database,
  profileLocalIds: string[],
): Map<string, ClientContracts> {
  if (profileLocalIds.length === 0) return new Map();

  const placeholders = profileLocalIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT profile_local_id, ${SELECT_COLUMNS}
       FROM contracts
       WHERE profile_local_id IN (${placeholders})
       ORDER BY profile_local_id, created_at DESC`,
    )
    .all(...profileLocalIds) as (RawContractRow & { profile_local_id: string })[];

  const linkedCases = resolveLinkedCases(db, rows);

  const byProfile = new Map<string, RawContractRow[]>();
  for (const { profile_local_id, ...row } of rows) {
    const list = byProfile.get(profile_local_id) ?? [];
    list.push(row);
    byProfile.set(profile_local_id, list);
  }

  const result = new Map<string, ClientContracts>();
  for (const [profileId, list] of byProfile) {
    result.set(profileId, assemble(list, linkedCases));
  }
  return result;
}

/**
 * Get all contracts for a profile, split into active/closed with totals.
 */
export function getClientContracts(db: Database, profileLocalId: string): ClientContracts {
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM contracts WHERE profile_local_id = ?
       ORDER BY created_at DESC`,
    )
    .all(profileLocalId) as RawContractRow[];

  const linkedCases = resolveLinkedCases(db, rows);
  return assemble(rows, linkedCases);
}

// =============================================================================
// Assembly
// =============================================================================

function assemble(
  rows: RawContractRow[],
  linkedCases: Map<string, ContractLinkedCase>,
): ClientContracts {
  const active: ContractSummary[] = [];
  const closed: ContractSummary[] = [];
  const totals: ContractTotals = { afPaid: 0, pfPaid: 0, totalPaid: 0, paidCount: 0 };

  for (const row of rows) {
    const cv = parseJson(row.rawColumnValues);
    const norm = normalizeContractStatus(row.groupTitle, row.status);
    const af = parseFee(cv.af);
    const pf = parseFee(cv.pf);

    const contract: ContractSummary = {
      localId: row.localId,
      caseType: row.caseType,
      status: row.status ?? "",
      value: row.value,
      contractId: row.contractId,
      statusKey: norm.key,
      statusLabel: norm.label,
      tone: norm.tone,
      af,
      pf,
      goesTo: labelOf(cv.it_will_go_to),
      linkedCase: linkedCases.get(row.localId) ?? null,
    };

    // Closed = the case is settled one way or the other (completed or dead).
    // Active = still moving (paid/in-progress or pending).
    if (norm.key === "completed" || norm.key === "not_going_forward") {
      closed.push(contract);
    } else {
      active.push(contract);
    }

    if (isContractPaid(norm.key)) {
      totals.afPaid += af ?? 0;
      totals.pfPaid += pf ?? 0;
      totals.paidCount += 1;
    }
  }

  totals.totalPaid = totals.afPaid + totals.pfPaid;
  return { active, closed, totals };
}

// =============================================================================
// Linked-case resolution
// =============================================================================

/**
 * Map each contract (by local_id) to the Open Form / Court Case it represents.
 *
 * Coverage on real data comes mostly from the REVERSE direction — the case item
 * carries a link_to_fee_ks / fee_ks relation back to its contract (Open Forms,
 * Motions, FOIAs populate this; ~54% of contracts). Court Cases don't link back,
 * so the FORWARD contract.court_cases_connected relation covers those. Both are
 * resolved in bulk; contracts with neither link get null.
 */
function resolveLinkedCases(
  db: Database,
  contracts: Array<{ localId: string; mondayItemId: string | null; rawColumnValues: string | null }>,
): Map<string, ContractLinkedCase> {
  const out = new Map<string, ContractLinkedCase>();

  // contract monday id → contract local id (for the reverse join).
  const byMondayId = new Map<string, string>();
  for (const c of contracts) {
    if (c.mondayItemId) byMondayId.set(c.mondayItemId, c.localId);
  }

  // ---- Reverse: cases pointing back at these contracts ----
  const contractMondayIds = [...byMondayId.keys()];
  if (contractMondayIds.length > 0) {
    const ph = contractMondayIds.map(() => "?").join(",");
    const cases = db
      .prepare(
        `SELECT board_key AS boardKey, name, status,
           COALESCE(
             json_extract(column_values, '$.link_to_fee_ks.linked_item_ids[0]'),
             json_extract(column_values, '$.fee_ks.linked_item_ids[0]')
           ) AS feeMondayId
         FROM board_items
         WHERE feeMondayId IN (${ph})`,
      )
      .all(...contractMondayIds) as Array<ContractLinkedCase & { feeMondayId: string }>;

    for (const c of cases) {
      const contractLocalId = byMondayId.get(String(c.feeMondayId));
      // First writer wins; a contract can be linked from several case items, but
      // one representative case is enough for the payment table.
      if (contractLocalId && !out.has(contractLocalId)) {
        out.set(contractLocalId, { boardKey: c.boardKey, name: c.name, status: c.status });
      }
    }
  }

  // ---- Forward: contract.court_cases_connected → court case item ----
  const forward: Array<{ localId: string; caseMondayId: string }> = [];
  for (const c of contracts) {
    if (out.has(c.localId)) continue; // reverse already covered it
    const cv = parseJson(c.rawColumnValues);
    const id = firstLinkedId(cv.court_cases_connected);
    if (id) forward.push({ localId: c.localId, caseMondayId: id });
  }
  if (forward.length > 0) {
    const ph = forward.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT monday_item_id AS mondayItemId, board_key AS boardKey, name, status
         FROM board_items WHERE monday_item_id IN (${ph})`,
      )
      .all(...forward.map((f) => f.caseMondayId)) as Array<ContractLinkedCase & { mondayItemId: string }>;
    const caseById = new Map(rows.map((r) => [r.mondayItemId, r]));
    for (const f of forward) {
      const c = caseById.get(f.caseMondayId);
      if (c) out.set(f.localId, { boardKey: c.boardKey, name: c.name, status: c.status });
    }
  }

  return out;
}

// =============================================================================
// Value helpers
// =============================================================================

function parseJson(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const p = JSON.parse(json) as unknown;
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Monday stores fees as strings ("4000"). Parse to a number; null when empty. */
function parseFee(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function labelOf(v: unknown): string | null {
  if (v && typeof v === "object" && "label" in v) return (v as { label?: string }).label ?? null;
  return typeof v === "string" ? v : null;
}

function firstLinkedId(v: unknown): string | null {
  if (v && typeof v === "object" && "linked_item_ids" in v) {
    const ids = (v as { linked_item_ids?: unknown[] }).linked_item_ids;
    if (Array.isArray(ids) && ids.length > 0) return String(ids[0]);
  }
  return null;
}
