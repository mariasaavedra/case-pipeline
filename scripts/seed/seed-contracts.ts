// =============================================================================
// Seed Contracts - Creates random contracts linked to profiles in Monday.com
// =============================================================================

import {
  CASE_TYPES,
  CONTRACT_STATUSES,
  DEFAULT_CONFIG,
  loadBoardIds,
} from "./lib/constants";
import { generateContractData, randomInt } from "./lib/generators";
import {
  setApiToken,
  fetchBoardStructure,
  createItem,
  findColumnByType,
  findColumnByTitle,
  ensureLabelsExist,
} from "../../lib/monday";
import type { MondayColumn, CreatedItem } from "../../lib/monday";
import type { ContractData } from "./lib/types";

// =============================================================================
// Column value builder
// =============================================================================

function buildContractColumnValues(
  columns: MondayColumn[],
  contract: ContractData,
  profileItemId: string
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  // Case type - usually a status or dropdown
  const caseTypeCol = findColumnByTitle(columns, /case|type/);
  if (caseTypeCol) {
    if (caseTypeCol.type === "status" || caseTypeCol.type === "color") {
      values[caseTypeCol.id] = { label: contract.caseType };
    } else if (caseTypeCol.type === "dropdown") {
      values[caseTypeCol.id] = { labels: [contract.caseType] };
    } else {
      values[caseTypeCol.id] = contract.caseType;
    }
  }

  // Contract value - numbers column
  const valueCol =
    findColumnByType(columns, "numbers") ||
    findColumnByTitle(columns, /value|amount|price/);
  if (valueCol) {
    values[valueCol.id] = contract.value.toString();
  }

  // Contract ID - text column
  const idCol = findColumnByTitle(columns, /contract.*id|id/);
  if (idCol && idCol.type === "text") {
    values[idCol.id] = contract.contractId;
  }

  // Status column (if different from case type)
  const statusCol =
    findColumnByType(columns, "status") ||
    findColumnByTitle(columns, /status/);
  if (statusCol && statusCol.id !== caseTypeCol?.id) {
    values[statusCol.id] = { label: contract.status };
  }

  // Board relation to link to profile
  const relationCol = findColumnByType(columns, "board_relation");
  if (relationCol) {
    values[relationCol.id] = { item_ids: [parseInt(profileItemId)] };
  }

  return values;
}

// =============================================================================
// Main seeding function
// =============================================================================

export interface ProfileReference {
  id: string;
  name: string;
}

export interface SeedContractsResult {
  contracts: Array<{ item: CreatedItem; contract: ContractData; profileId: string }>;
  board: { id: string; name: string };
}

export interface SeedContractsOptions {
  profiles: ProfileReference[];
  contractsPerProfile?: { min: number; max: number };
  boardId?: string;
}

export async function seedContracts(
  options: SeedContractsOptions
): Promise<SeedContractsResult> {
  const { profiles } = options;
  const contractsPerProfile = options.contractsPerProfile ?? DEFAULT_CONFIG.contractsPerProfile;
  const boardId = options.boardId ?? (await loadBoardIds()).contractsBoardId;

  if (profiles.length === 0) {
    throw new Error("No profiles provided. Create profiles first.");
  }

  console.log("\n[1/3] Fetching contracts board structure...");
  const board = await fetchBoardStructure(boardId);
  console.log(`  Board: "${board.name}" (${board.columns.length} columns)`);

  // Log columns for debugging
  console.log("\n  Columns:");
  board.columns.forEach((c) => console.log(`    - ${c.id}: ${c.title} (${c.type})`));

  const groupId = board.groups[0]?.id;
  if (!groupId) {
    throw new Error("Could not find group in contracts board");
  }

  // Ensure labels exist
  console.log("\n[2/3] Ensuring required labels exist...");

  const caseTypeCol = findColumnByTitle(board.columns, /case|type/);
  if (caseTypeCol) {
    await ensureLabelsExist(boardId, caseTypeCol, CASE_TYPES);
  }

  const statusCol =
    findColumnByType(board.columns, "status") ||
    findColumnByType(board.columns, "color") ||
    findColumnByTitle(board.columns, /status/);
  if (statusCol && statusCol.id !== caseTypeCol?.id) {
    await ensureLabelsExist(boardId, statusCol, CONTRACT_STATUSES);
  }

  // Create contracts
  console.log(`\n[3/3] Creating contracts for ${profiles.length} profiles...`);
  const results: SeedContractsResult["contracts"] = [];

  for (const profile of profiles) {
    const count = randomInt(contractsPerProfile.min, contractsPerProfile.max);

    for (let i = 0; i < count; i++) {
      const contract = generateContractData();
      const contractName = `${profile.name} - ${contract.caseType}`;
      const columnValues = buildContractColumnValues(board.columns, contract, profile.id);

      const item = await createItem(boardId, groupId, contractName, columnValues);
      results.push({ item, contract, profileId: profile.id });
      console.log(`  Created: ${item.name} (linked to ${profile.name})`);
    }
  }

  return {
    contracts: results,
    board: { id: board.id, name: board.name },
  };
}

// =============================================================================
// CLI entry point
// =============================================================================

async function main() {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    console.error("Error: MONDAY_API_TOKEN is required in .env");
    process.exit(1);
  }

  setApiToken(token);

  // Parse profile IDs from command line
  const profileIds = process.argv.slice(2);
  if (profileIds.length === 0) {
    console.error("Usage: bun seed-contracts.ts <profile_id1> [profile_id2] ...");
    console.error("Example: bun seed-contracts.ts 123456789 987654321");
    console.error("\nTip: Run seed-profiles.ts first to create profiles, then use the returned IDs.");
    process.exit(1);
  }

  const profiles: ProfileReference[] = profileIds.map((id) => ({
    id,
    name: `Profile ${id}`,
  }));

  const startTime = performance.now();

  console.log("=".repeat(60));
  console.log("Monday.com Contract Seeder");
  console.log("=".repeat(60));

  const result = await seedContracts({ profiles });

  const elapsed = (performance.now() - startTime).toFixed(0);
  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`  Board: ${result.board.name}`);
  console.log(`  Contracts created: ${result.contracts.length}`);
  console.log(`  Total time: ${elapsed}ms`);
  console.log("=".repeat(60));
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
