// =============================================================================
// sync-config CLI - Synchronize Monday.com board structures with YAML config
// =============================================================================
//
// Usage:
//   bun scripts/sync-config                    # Sync all boards in config
//   bun scripts/sync-config --dry-run          # Preview changes without writing
//   bun scripts/sync-config --add-board=<id>   # Add a new board by ID
//   bun scripts/sync-config --help             # Show help
//
// Options:
//   --dry-run           Preview changes without modifying config
//   --add-board=<id>    Add a new board with the specified Monday.com board ID
//   --board-key=<key>   Key name for new board (with --add-board)
//   --verbose           Show detailed output including matched columns
//
// =============================================================================

import { setApiToken, fetchBoardStructure } from "../../lib/monday";
import { loadBoardsConfig } from "../../lib/config";
import type { BoardConfig } from "../../lib/config/types";
import type { SyncOptions, SyncReport, BoardSyncResult } from "./lib/types";
import { diffBoardColumns } from "./lib/differ";
import {
  generateConfigsForNewColumns,
  loadRawBoardsConfig,
  mergeColumnsIntoConfig,
  addNewBoardToConfig,
  writeConfigToFile,
} from "./lib/yaml-generator";
import { printBoardDiff, printSummary, printHeader, printHelp, exportBoardsToFile, type BoardExportData } from "./lib/reporter";

const DEFAULT_BOARDS_PATH = "config/boards.yaml";

function parseArgs(): SyncOptions & { showHelp: boolean } {
  const args = process.argv.slice(2);
  const options: SyncOptions & { showHelp: boolean } = {
    dryRun: false,
    boardsPath: DEFAULT_BOARDS_PATH,
    verbose: false,
    showHelp: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.showHelp = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg.startsWith("--add-board=")) {
      const boardId = arg.split("=")[1] ?? "";
      options.addBoard = { key: "", id: boardId };
    } else if (arg.startsWith("--board-key=")) {
      const key = arg.split("=")[1] ?? "";
      if (options.addBoard) {
        options.addBoard.key = key;
      }
    } else if (arg.startsWith("--env-var=")) {
      options.envVar = arg.split("=")[1] ?? "";
    } else if (arg.startsWith("--config=")) {
      options.boardsPath = arg.split("=")[1] ?? "";
    } else if (arg.startsWith("--export=")) {
      options.export = arg.split("=")[1] ?? "";
    }
  }

  return options;
}

interface SyncBoardResult {
  syncResult: BoardSyncResult;
  exportData: BoardExportData;
}

async function syncBoard(
  boardKey: string,
  boardConfig: BoardConfig
): Promise<SyncBoardResult> {
  console.log(`\nFetching board: ${boardKey} (${boardConfig.id})...`);

  const board = await fetchBoardStructure(boardConfig.id);
  console.log(`  Found: "${board.name}" with ${board.columns.length} columns`);

  const diff = diffBoardColumns(board.columns, boardConfig);

  const generatedConfig =
    diff.newColumns.length > 0
      ? generateConfigsForNewColumns(diff.newColumns, board.columns)
      : undefined;

  return {
    syncResult: {
      boardKey,
      boardId: boardConfig.id,
      boardName: board.name,
      diff,
      generatedConfig,
    },
    exportData: {
      boardKey,
      board,
    },
  };
}

async function addNewBoard(
  boardId: string,
  boardKey: string,
  envVar?: string
): Promise<BoardSyncResult> {
  console.log(`\nFetching new board: ${boardId}...`);

  const board = await fetchBoardStructure(boardId);
  console.log(`  Found: "${board.name}" with ${board.columns.length} columns`);

  // For a new board, all columns (except "name") are "new"
  const columnsToAdd = board.columns.filter((c) => c.id !== "name");
  const generatedConfig = generateConfigsForNewColumns(columnsToAdd, board.columns);

  return {
    boardKey: boardKey || board.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    boardId,
    boardName: board.name,
    diff: {
      newColumns: columnsToAdd,
      missingColumns: [],
      matchedColumns: [],
    },
    generatedConfig,
  };
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.showHelp) {
    printHelp();
    return;
  }

  // Validate API token
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    console.error("Error: MONDAY_API_TOKEN is required in environment");
    process.exit(1);
  }
  setApiToken(token);

  const startTime = performance.now();

  printHeader(options.dryRun);

  const report: SyncReport = {
    boards: [],
    hasChanges: false,
    timestamp: new Date().toISOString(),
  };

  try {
    // Load raw config (without env var substitution for writing back)
    let rawConfig = await loadRawBoardsConfig(options.boardsPath);

    if (options.addBoard) {
      // Adding a new board
      if (!options.addBoard.key) {
        console.error("Error: --board-key is required when using --add-board");
        process.exit(1);
      }

      const result = await addNewBoard(
        options.addBoard.id,
        options.addBoard.key,
        options.envVar
      );
      report.boards.push(result);
      printBoardDiff(result, options.verbose);

      // Add to config
      if (result.generatedConfig) {
        rawConfig = addNewBoardToConfig(
          rawConfig,
          result.boardKey,
          result.boardId,
          result.boardName,
          result.generatedConfig,
          options.envVar
        );
      }
    } else {
      // Sync existing boards - need to load with env var substitution for API calls
      const boardsConfig = await loadBoardsConfig(options.boardsPath);
      const exportDataList: BoardExportData[] = [];

      for (const [boardKey, boardConfig] of Object.entries(boardsConfig)) {
        const { syncResult, exportData } = await syncBoard(boardKey, boardConfig);
        report.boards.push(syncResult);
        exportDataList.push(exportData);

        // Show diff if there are changes or verbose mode
        if (
          options.verbose ||
          syncResult.diff.newColumns.length > 0 ||
          syncResult.diff.missingColumns.length > 0
        ) {
          printBoardDiff(syncResult, options.verbose);
        }

        // Merge new columns into raw config
        if (syncResult.generatedConfig && Object.keys(syncResult.generatedConfig).length > 0) {
          rawConfig = mergeColumnsIntoConfig(
            rawConfig,
            boardKey,
            syncResult.generatedConfig
          );
        }
      }

      // Export board reference if requested
      if (options.export) {
        await exportBoardsToFile(exportDataList, options.export);
      }
    }

    // Check if there are changes to write
    report.hasChanges = report.boards.some(
      (b) => b.generatedConfig && Object.keys(b.generatedConfig).length > 0
    );

    // Write changes if not dry run and there are changes
    if (!options.dryRun && report.hasChanges) {
      await writeConfigToFile(options.boardsPath, rawConfig);
      console.log(`\nUpdated: ${options.boardsPath}`);
    }

    printSummary(report.boards, options.dryRun);

    const elapsed = (performance.now() - startTime).toFixed(0);
    console.log(`\nCompleted in ${elapsed}ms`);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        console.error(`\nError: ${error.message}`);
        console.error("Check that the board ID is correct and accessible.");
      } else if (error.message.includes("token")) {
        console.error(`\nError: Authentication failed. Check your MONDAY_API_TOKEN.`);
      } else {
        console.error(`\nError: ${error.message}`);
      }
    } else {
      console.error("\nUnexpected error:", error);
    }
    process.exit(1);
  }
}

main();
