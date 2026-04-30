// =============================================================================
// sync-config CLI - Synchronize Monday.com board structures with YAML config
// =============================================================================
//
// Usage:
//   bun scripts/sync-config                    # Sync all boards in config
//   bun scripts/sync-config --dry-run          # Preview changes without writing
//   bun scripts/sync-config --add-board=<id>   # Add a new board by ID
//   bun scripts/sync-config --relationship-map=<path>  # Export board relationship map
//   bun scripts/sync-config --help             # Show help
//
// Options:
//   --dry-run           Preview changes without modifying config
//   --add-board=<id>    Add a new board with the specified Monday.com board ID
//   --board-key=<key>   Key name for new board (with --add-board)
//   --verbose           Show detailed output including matched columns
//   --relationship-map  Export visual map of board connections
//
// =============================================================================

import { setApiToken, fetchBoardStructure, fetchAllBoards } from "../../lib/monday";
import { loadBoardsConfig } from "../../lib/config";
import type { BoardConfig } from "../../lib/config/types";
import type { MondayBoard } from "../../lib/monday/types";
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
import { generateRelationshipMap } from "../../lib/relationship-map";

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
    } else if (arg.startsWith("--relationship-map=")) {
      options.relationshipMap = arg.split("=")[1] ?? "";
    } else if (arg === "--discover") {
      options.discover = true;
    } else if (arg === "--add-all") {
      options.addAll = true;
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
    // Discover mode - fetch all boards from workspace
    if (options.discover) {
      console.log("\nDiscovering boards in workspace...\n");

      const allBoards = await fetchAllBoards();
      const boardsConfig = await loadBoardsConfig(options.boardsPath);
      const existingIds = new Set(Object.values(boardsConfig).map((b) => b.id));

      const newBoards = allBoards.filter((b) => !existingIds.has(b.id));
      const existingBoards = allBoards.filter((b) => existingIds.has(b.id));

      console.log(`Found ${allBoards.length} boards in workspace:\n`);

      if (existingBoards.length > 0) {
        console.log("\x1b[32m✓ Already in config:\x1b[0m");
        for (const board of existingBoards) {
          console.log(`  • ${board.name} (${board.id})`);
        }
        console.log("");
      }

      if (newBoards.length > 0) {
        console.log("\x1b[33m+ New boards (not in config):\x1b[0m");
        for (const board of newBoards) {
          const suggestedKey = board.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
          console.log(`  • ${board.name}`);
          console.log(`    ID: ${board.id}`);
          console.log(`    Add with: bun scripts/sync-config --add-board=${board.id} --board-key=${suggestedKey}`);
          console.log("");
        }

        console.log("─".repeat(60));
        console.log("\nTo add all new boards at once, run:\n");
        for (const board of newBoards) {
          const suggestedKey = board.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
          console.log(`bun scripts/sync-config --add-board=${board.id} --board-key=${suggestedKey}`);
        }
      } else {
        console.log("\x1b[32mAll workspace boards are already in config!\x1b[0m");
      }

      const elapsed = (performance.now() - startTime).toFixed(0);
      console.log(`\nCompleted in ${elapsed}ms`);
      return;
    }

    // Load raw config (without env var substitution for writing back)
    let rawConfig = await loadRawBoardsConfig(options.boardsPath);

    // Add all new boards from workspace
    if (options.addAll) {
      console.log("\nAdding all new boards from workspace...\n");

      const allBoards = await fetchAllBoards();
      const boardsConfig = await loadBoardsConfig(options.boardsPath);
      const existingIds = new Set(Object.values(boardsConfig).map((b) => b.id));

      const newBoards = allBoards.filter((b) => !existingIds.has(b.id));

      if (newBoards.length === 0) {
        console.log("\x1b[32mAll workspace boards are already in config!\x1b[0m");
        const elapsed = (performance.now() - startTime).toFixed(0);
        console.log(`\nCompleted in ${elapsed}ms`);
        return;
      }

      console.log(`Found ${newBoards.length} new boards to add:\n`);

      for (const board of newBoards) {
        const boardKey = board.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
        console.log(`\x1b[33m+ Adding: ${board.name}\x1b[0m (${boardKey})`);

        const columnsToAdd = board.columns.filter((c) => c.id !== "name");
        const generatedConfig = generateConfigsForNewColumns(columnsToAdd, board.columns);

        rawConfig = addNewBoardToConfig(
          rawConfig,
          boardKey,
          board.id,
          board.name,
          generatedConfig
        );
      }

      // Write the config
      if (!options.dryRun) {
        await writeConfigToFile(options.boardsPath, rawConfig);
        console.log(`\n\x1b[32mAdded ${newBoards.length} boards to ${options.boardsPath}\x1b[0m`);
      } else {
        console.log(`\n\x1b[33mDRY RUN - Would add ${newBoards.length} boards\x1b[0m`);
      }

      const elapsed = (performance.now() - startTime).toFixed(0);
      console.log(`\nCompleted in ${elapsed}ms`);
      return;
    }

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

      // Export relationship map if requested
      if (options.relationshipMap) {
        const boardsMap = new Map<string, MondayBoard>();
        for (const { boardKey, board } of exportDataList) {
          boardsMap.set(boardKey, board);
        }

        // Generate with profiles as main board, include JSON and illustrated version
        const output = generateRelationshipMap(boardsMap, {
          mainBoardKey: "profiles",
          includeJSON: true,
          includeIllustrated: true,
        });

        // Write markdown (clean version)
        await Bun.write(options.relationshipMap, output.markdown);
        console.log(`\n\x1b[32mExported relationship map to: ${options.relationshipMap}\x1b[0m`);

        // Write illustrated/detailed version
        if (output.illustrated) {
          const illustratedPath = options.relationshipMap.replace(/\.md$/, "-detailed.md");
          await Bun.write(illustratedPath, output.illustrated);
          console.log(`\x1b[32mExported detailed map to: ${illustratedPath}\x1b[0m`);
        }

        // Write JSON alongside for future UI consumption
        if (output.json) {
          const jsonPath = options.relationshipMap.replace(/\.md$/, ".json");
          await Bun.write(jsonPath, output.json);
          console.log(`\x1b[32mExported JSON data to: ${jsonPath}\x1b[0m`);
        }
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
