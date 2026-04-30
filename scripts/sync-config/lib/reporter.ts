// =============================================================================
// Console Reporting for Sync Results
// Colored output for diff visualization
// =============================================================================

import { writeFile } from "node:fs/promises";
import type { BoardSyncResult, ColumnDiff } from "./types";
import type { MondayColumn, MondayBoard } from "../../../lib/monday/types";
import type { ColumnResolution } from "../../../lib/config/types";

export interface BoardExportData {
  boardKey: string;
  board: MondayBoard;
}

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function formatColumn(col: MondayColumn): string {
  return `${col.title} (${COLORS.dim}${col.id}, ${col.type}${COLORS.reset})`;
}

function formatResolution(resolution: ColumnResolution): string {
  switch (resolution.resolve) {
    case "by_type":
      return `by_type: ${resolution.type}`;
    case "by_title":
      return `by_title: "${resolution.pattern}"`;
    case "by_id":
      return `by_id: ${resolution.id}`;
    default:
      return resolution.resolve;
  }
}

export function printBoardDiff(
  result: BoardSyncResult,
  verbose: boolean = false
): void {
  const { diff } = result;
  const hasChanges =
    diff.newColumns.length > 0 || diff.missingColumns.length > 0;

  console.log(`\n${"─".repeat(60)}`);
  console.log(
    `${COLORS.bold}Board: ${result.boardName}${COLORS.reset}`
  );
  console.log(`Key: ${result.boardKey} | ID: ${result.boardId}`);
  console.log("─".repeat(60));

  // New columns (in Monday.com but not in config)
  if (diff.newColumns.length > 0) {
    console.log(
      `\n${COLORS.green}+ NEW COLUMNS${COLORS.reset} (in Monday.com, not in config):`
    );
    for (const col of diff.newColumns) {
      console.log(`  ${COLORS.green}+${COLORS.reset} ${formatColumn(col)}`);
    }
  }

  // Missing columns (in config but not in Monday.com)
  if (diff.missingColumns.length > 0) {
    console.log(
      `\n${COLORS.yellow}! MISSING COLUMNS${COLORS.reset} (in config, not in Monday.com):`
    );
    for (const missing of diff.missingColumns) {
      console.log(
        `  ${COLORS.yellow}!${COLORS.reset} ${missing.configKey} (${formatResolution(missing.resolution)})`
      );
    }
  }

  // Matched columns (verbose mode only)
  if (verbose && diff.matchedColumns.length > 0) {
    console.log(`\n${COLORS.dim}= MATCHED COLUMNS:${COLORS.reset}`);
    for (const matched of diff.matchedColumns) {
      console.log(
        `  ${COLORS.dim}=${COLORS.reset} ${matched.configKey} → ${formatColumn(matched.mondayColumn)}`
      );
    }
  }

  // Generated config preview
  if (result.generatedConfig && Object.keys(result.generatedConfig).length > 0) {
    console.log(
      `\n${COLORS.cyan}Generated config for new columns:${COLORS.reset}`
    );
    for (const [key, resolution] of Object.entries(result.generatedConfig)) {
      console.log(`  ${key}:`);
      console.log(`    resolve: ${resolution.resolve}`);
      if (resolution.type) console.log(`    type: ${resolution.type}`);
      if (resolution.pattern) console.log(`    pattern: "${resolution.pattern}"`);
      if (resolution.types) console.log(`    types: [${resolution.types.join(", ")}]`);
    }
  }

  if (!hasChanges && !verbose) {
    console.log(`\n${COLORS.dim}No changes detected${COLORS.reset}`);
  }
}

export function printSummary(
  boards: BoardSyncResult[],
  dryRun: boolean
): void {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`${COLORS.bold}SUMMARY${COLORS.reset}`);
  console.log("═".repeat(60));

  let totalNew = 0;
  let totalMissing = 0;

  for (const board of boards) {
    totalNew += board.diff.newColumns.length;
    totalMissing += board.diff.missingColumns.length;
  }

  console.log(`  Boards analyzed: ${boards.length}`);
  console.log(`  New columns found: ${totalNew}`);
  console.log(`  Missing columns (warnings): ${totalMissing}`);

  if (dryRun) {
    console.log(`\n${COLORS.yellow}DRY RUN - No changes written${COLORS.reset}`);
    if (totalNew > 0) {
      console.log(`Run without --dry-run to update config/boards.yaml`);
    }
  } else if (totalNew > 0) {
    console.log(`\n${COLORS.green}Config updated successfully${COLORS.reset}`);
  } else {
    console.log(`\n${COLORS.green}Config is up to date${COLORS.reset}`);
  }
}

export function printHeader(dryRun: boolean): void {
  console.log("═".repeat(60));
  console.log(`${COLORS.bold}Monday.com Config Sync${COLORS.reset}`);
  console.log("═".repeat(60));

  if (dryRun) {
    console.log(`Mode: ${COLORS.yellow}DRY RUN${COLORS.reset} (no changes will be written)`);
  }
}

export function printHelp(): void {
  console.log(`
${COLORS.bold}sync-config${COLORS.reset} - Synchronize Monday.com board structures with YAML config

${COLORS.bold}USAGE${COLORS.reset}
  bun scripts/sync-config                         Sync all boards in config
  bun scripts/sync-config --discover              Discover all boards in workspace
  bun scripts/sync-config --add-all               Add all new boards from workspace
  bun scripts/sync-config --add-board=<id>        Add a new board by ID
  bun scripts/sync-config --relationship-map=<path>  Export board relationship map

${COLORS.bold}OPTIONS${COLORS.reset}
  --discover             Discover all boards in workspace and show add commands
  --add-all              Add all new boards from workspace to config
  --add-board=<id>       Add a single board by ID (requires --board-key)
  --board-key=<key>      Key name for new board (with --add-board)
  --relationship-map=<path>  Export visual map showing how boards are connected
  --dry-run              Preview changes without modifying config

${COLORS.bold}EXAMPLES${COLORS.reset}
  bun scripts/sync-config --discover
  bun scripts/sync-config --add-all
  bun scripts/sync-config --add-all --relationship-map=output/relationship-map.md
`);
}

// =============================================================================
// Board Export - Generate readable reference file
// =============================================================================

function generateBoardMarkdown(boardKey: string, board: MondayBoard): string {
  const lines: string[] = [];

  lines.push(`## ${board.name}`);
  lines.push("");
  lines.push(`- **Config Key:** \`${boardKey}\``);
  lines.push(`- **Board ID:** \`${board.id}\``);
  lines.push(`- **Total Columns:** ${board.columns.length}`);
  lines.push("");

  // Columns table
  lines.push("### Columns");
  lines.push("");
  lines.push("| Column Name | Column ID | Type |");
  lines.push("|-------------|-----------|------|");

  for (const col of board.columns) {
    // Escape pipe characters in column names
    const safeName = col.title.replace(/\|/g, "\\|");
    lines.push(`| ${safeName} | \`${col.id}\` | \`${col.type}\` |`);
  }

  lines.push("");

  // Groups table (if any)
  if (board.groups && board.groups.length > 0) {
    lines.push("### Groups");
    lines.push("");
    lines.push("| Group Name | Group ID |");
    lines.push("|------------|----------|");

    for (const group of board.groups) {
      const safeName = group.title.replace(/\|/g, "\\|");
      lines.push(`| ${safeName} | \`${group.id}\` |`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

export async function exportBoardsToFile(
  boards: BoardExportData[],
  outputPath: string
): Promise<void> {
  const lines: string[] = [];

  // Header
  lines.push("# Monday.com Boards Reference");
  lines.push("");
  lines.push(`> Generated on ${new Date().toISOString()}`);
  lines.push(">");
  lines.push("> This file contains all board IDs, column IDs, and group IDs for quick reference.");
  lines.push("");

  // Table of contents
  lines.push("## Table of Contents");
  lines.push("");
  for (const { boardKey, board } of boards) {
    const anchor = board.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    lines.push(`- [${board.name}](#${anchor}) (\`${boardKey}\`)`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Board sections
  for (const { boardKey, board } of boards) {
    lines.push(generateBoardMarkdown(boardKey, board));
    lines.push("---");
    lines.push("");
  }

  // Write the file
  await writeFile(outputPath, lines.join("\n"), "utf-8");
  console.log(`\n${COLORS.green}Exported board reference to: ${outputPath}${COLORS.reset}`);
}
