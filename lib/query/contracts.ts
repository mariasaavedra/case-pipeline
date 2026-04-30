// =============================================================================
// Contract / Fee K Queries
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { ContractSummary } from "./types";
import { CLOSED_CONTRACT_STATUSES } from "./types";

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
