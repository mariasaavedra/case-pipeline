// =============================================================================
// Lookup Command — Client 360 View from CLI
// =============================================================================

import { Database } from "bun:sqlite";
import { validateSchema } from "../../scripts/seed/lib/db/schema";
import {
  searchClients,
  getClientCaseSummary,
  BOARD_DISPLAY_NAMES,
} from "../../lib/query";
import type { ClientCaseSummary, BoardItemSummary } from "../../lib/query";

const DB_PATH = "data/seed.db";

// =============================================================================
// Help
// =============================================================================

function showHelp(): void {
  console.log(`
Lookup Command - Client 360 View

Usage: bun cli.ts lookup <query>       Search by name/email/phone
       bun cli.ts lookup --id=<id>     Full 360 view by profile ID

Options:
  --id=<local_id>    Look up by exact profile local_id
  --help, -h         Show this help

Examples:
  bun cli.ts lookup Garcia
  bun cli.ts lookup "Tracy Miller"
  bun cli.ts lookup --id=abc123-def456
`);
}

// =============================================================================
// Formatters
// =============================================================================

function formatStatus(status: string | null): string {
  if (!status) return "—";
  return status;
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  return date;
}

function printSummary(summary: ClientCaseSummary): void {
  const { profile, contracts, boardItems, appointments } = summary;

  // Profile header
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${profile.name}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Email:    ${profile.email ?? "—"}`);
  console.log(`  Phone:    ${profile.phone ?? "—"}`);
  console.log(`  Priority: ${profile.priority ?? "—"}`);
  if (profile.address) console.log(`  Address:  ${profile.address}`);

  // Contracts
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  CONTRACTS (${contracts.active.length} active, ${contracts.closed.length} closed)`);
  console.log(`${"─".repeat(60)}`);

  if (contracts.active.length > 0) {
    for (const c of contracts.active) {
      console.log(`  * ${c.caseType.padEnd(35)} ${c.status.padEnd(20)} $${c.value}`);
    }
  }
  if (contracts.closed.length > 0) {
    console.log(`  Closed:`);
    for (const c of contracts.closed) {
      console.log(`    ${c.caseType.padEnd(35)} ${c.status}`);
    }
  }

  // Board items by type
  const boardKeys = Object.keys(boardItems);
  if (boardKeys.length > 0) {
    for (const boardKey of boardKeys) {
      const items = boardItems[boardKey];
      if (!items) continue;
      const displayName = BOARD_DISPLAY_NAMES[boardKey] ?? boardKey;

      console.log(`\n${"─".repeat(60)}`);
      console.log(`  ${displayName.toUpperCase()} (${items.length})`);
      console.log(`${"─".repeat(60)}`);

      for (const item of items) {
        printBoardItem(item);
      }
    }
  }

  // Appointments
  if (appointments.length > 0) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  APPOINTMENTS (${appointments.length})`);
    console.log(`${"─".repeat(60)}`);

    for (const appt of appointments) {
      const board = BOARD_DISPLAY_NAMES[appt.boardKey] ?? appt.boardKey;
      console.log(`  ${board}: ${formatStatus(appt.status)} | ${formatDate(appt.nextDate)}`);
    }
  }

  console.log("");
}

function printBoardItem(item: BoardItemSummary): void {
  const parts = [
    `  ${item.name}`,
    `    Status: ${formatStatus(item.status)}`,
  ];

  if (item.nextDate) parts.push(`    Next:   ${item.nextDate}`);
  if (item.attorney) parts.push(`    Atty:   ${item.attorney}`);

  console.log(parts.join("\n"));
}

// =============================================================================
// Main
// =============================================================================

export async function lookupCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    return;
  }

  const db = new Database(DB_PATH, { readonly: true });
  validateSchema(db);

  try {
    // Check for --id flag
    const idArg = args.find((a) => a.startsWith("--id="));
    if (idArg) {
      const localId = idArg.split("=")[1] ?? "";
      const summary = getClientCaseSummary(db, localId);
      if (!summary) {
        console.error(`No profile found with ID: ${localId}`);
        process.exit(1);
      }
      printSummary(summary);
      return;
    }

    // Search mode
    const query = args.filter((a) => !a.startsWith("--")).join(" ");
    if (!query) {
      showHelp();
      return;
    }

    const results = searchClients(db, query);

    if (results.length === 0) {
      console.log(`\nNo clients found matching "${query}"`);
      return;
    }

    // If exactly one result, show full summary
    if (results.length === 1) {
      const summary = getClientCaseSummary(db, results[0]!.localId);
      if (summary) {
        printSummary(summary);
        return;
      }
    }

    // Multiple results — list them
    console.log(`\n${results.length} clients matching "${query}":\n`);
    for (const r of results) {
      console.log(`  ${r.name.padEnd(30)} ${(r.email ?? "").padEnd(30)} ${r.phone ?? ""}`);
      console.log(`    ID: ${r.localId}`);
    }
    console.log(`\nUse --id=<local_id> for full 360 view.`);
  } finally {
    db.close();
  }
}
