// =============================================================================
// Contract / Fee K Queries
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { ContractSummary } from "./types";
import { CLOSED_CONTRACT_STATUSES } from "./types";

/**
 * Batch-fetch contracts for multiple profiles in one query.
 * Returns a Map keyed by profileLocalId; each entry is split into active/closed.
 */
export function batchGetClientContracts(
  db: Database,
  profileLocalIds: string[]
): Map<string, { active: ContractSummary[]; closed: ContractSummary[] }> {
  if (profileLocalIds.length === 0) return new Map();

  const placeholders = profileLocalIds.map(() => "?").join(",");
  const rows = db
    .prepare(`
      SELECT
        profile_local_id,
        local_id AS localId,
        case_type AS caseType,
        status,
        value,
        contract_id AS contractId
      FROM contracts
      WHERE profile_local_id IN (${placeholders})
      ORDER BY profile_local_id, created_at DESC
    `)
    .all(...profileLocalIds) as (ContractSummary & { profile_local_id: string })[];

  const result = new Map<string, { active: ContractSummary[]; closed: ContractSummary[] }>();
  for (const { profile_local_id, ...contract } of rows) {
    let entry = result.get(profile_local_id);
    if (!entry) {
      entry = { active: [], closed: [] };
      result.set(profile_local_id, entry);
    }
    if (CLOSED_CONTRACT_STATUSES.has(contract.status)) {
      entry.closed.push(contract);
    } else {
      entry.active.push(contract);
    }
  }
  return result;
}

/**
 * Get all contracts for a profile, split into active and closed
 */
export function getClientContracts(
  db: Database,
  profileLocalId: string
): { active: ContractSummary[]; closed: ContractSummary[] } {
  const all = db
    .prepare(`
      SELECT
        local_id AS localId,
        case_type AS caseType,
        status,
        value,
        contract_id AS contractId
      FROM contracts
      WHERE profile_local_id = ?
      ORDER BY created_at DESC
    `)
    .all(profileLocalId) as ContractSummary[];

  const active: ContractSummary[] = [];
  const closed: ContractSummary[] = [];

  for (const c of all) {
    if (CLOSED_CONTRACT_STATUSES.has(c.status)) {
      closed.push(c);
    } else {
      active.push(c);
    }
  }

  return { active, closed };
}
