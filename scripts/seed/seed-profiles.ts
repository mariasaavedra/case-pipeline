// =============================================================================
// Seed Profiles - Creates random client profiles in Monday.com
// =============================================================================

import { PRIORITIES, DEFAULT_CONFIG, loadBoardIds } from "./lib/constants";
import { generateProfileData, generatePriority } from "./lib/generators";
import {
  setApiToken,
  fetchBoardStructure,
  createItem,
  findColumnByType,
  findColumnByTitle,
  ensureLabelsExist,
} from "../../lib/monday";
import type { MondayColumn, CreatedItem } from "../../lib/monday";
import type { ProfileData } from "./lib/types";

// =============================================================================
// Column value builder
// =============================================================================

function buildProfileColumnValues(
  columns: MondayColumn[],
  profile: ProfileData
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  // Email column
  const emailCol =
    findColumnByType(columns, "email") || findColumnByTitle(columns, /email/);
  if (emailCol) {
    values[emailCol.id] = { email: profile.email, text: profile.email };
  }

  // Phone column
  const phoneCol =
    findColumnByType(columns, "phone") || findColumnByTitle(columns, /phone/);
  if (phoneCol) {
    values[phoneCol.id] = profile.phone;
  }

  // Status/Priority column
  const statusCol =
    findColumnByType(columns, "status") ||
    findColumnByType(columns, "color") ||
    findColumnByTitle(columns, /status|priority/);
  if (statusCol) {
    values[statusCol.id] = { label: generatePriority() };
  }

  // Date column
  const dateCol =
    findColumnByType(columns, "date") ||
    findColumnByTitle(columns, /date|interaction/);
  if (dateCol) {
    values[dateCol.id] = { date: profile.nextInteraction };
  }

  // Text/Notes column
  const textCol = findColumnByTitle(columns, /notes|text|comment/);
  if (textCol) {
    values[textCol.id] = profile.notes;
  }

  return values;
}

// =============================================================================
// Main seeding function
// =============================================================================

export interface SeedProfilesResult {
  profiles: Array<{ item: CreatedItem; profile: ProfileData }>;
  board: { id: string; name: string };
}

export interface SeedProfilesOptions {
  count?: number;
  boardId?: string;
}

export async function seedProfiles(
  options: SeedProfilesOptions = {}
): Promise<SeedProfilesResult> {
  const count = options.count ?? DEFAULT_CONFIG.profileCount;
  const boardId = options.boardId ?? (await loadBoardIds()).profilesBoardId;

  console.log("\n[1/3] Fetching profiles board structure...");
  const board = await fetchBoardStructure(boardId);
  console.log(`  Board: "${board.name}" (${board.columns.length} columns)`);

  // Log columns for debugging
  console.log("\n  Columns:");
  board.columns.forEach((c) => console.log(`    - ${c.id}: ${c.title} (${c.type})`));

  const groupId = board.groups[0]?.id;
  if (!groupId) {
    throw new Error("Could not find group in profiles board");
  }

  // Ensure labels exist
  console.log("\n[2/3] Ensuring required labels exist...");
  const statusCol =
    findColumnByType(board.columns, "status") ||
    findColumnByType(board.columns, "color") ||
    findColumnByTitle(board.columns, /status|priority/);
  if (statusCol) {
    await ensureLabelsExist(boardId, statusCol, PRIORITIES);
  }

  // Create profiles
  console.log(`\n[3/3] Creating ${count} profiles...`);
  const results: SeedProfilesResult["profiles"] = [];

  for (let i = 0; i < count; i++) {
    const profile = generateProfileData();
    const columnValues = buildProfileColumnValues(board.columns, profile);
    const item = await createItem(boardId, groupId, profile.name, columnValues);
    results.push({ item, profile });
    console.log(`  Created: ${item.name} (ID: ${item.id})`);
  }

  return {
    profiles: results,
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

  const count = parseInt(process.argv[2] || "") || DEFAULT_CONFIG.profileCount;
  const startTime = performance.now();

  console.log("=".repeat(60));
  console.log("Monday.com Profile Seeder");
  console.log("=".repeat(60));

  const result = await seedProfiles({ count });

  const elapsed = (performance.now() - startTime).toFixed(0);
  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`  Board: ${result.board.name}`);
  console.log(`  Profiles created: ${result.profiles.length}`);
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
