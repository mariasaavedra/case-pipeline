// =============================================================================
// Types for sync-config CLI
// =============================================================================

import type { MondayColumn } from "../../../lib/monday/types";
import type { ColumnResolution } from "../../../lib/config/types";

export interface ColumnDiff {
  // Columns in Monday.com that are NOT in the YAML config
  newColumns: MondayColumn[];

  // Columns in YAML config that no longer exist in Monday.com
  missingColumns: {
    configKey: string;
    resolution: ColumnResolution;
  }[];

  // Columns that exist in both (for verbose output)
  matchedColumns: {
    configKey: string;
    mondayColumn: MondayColumn;
    resolution: ColumnResolution;
  }[];
}

export interface BoardSyncResult {
  boardKey: string;
  boardId: string;
  boardName: string;
  diff: ColumnDiff;
  generatedConfig?: Record<string, ColumnResolution>;
}

export interface SyncReport {
  boards: BoardSyncResult[];
  hasChanges: boolean;
  timestamp: string;
}

export interface SyncOptions {
  dryRun: boolean;
  boardsPath: string;
  addBoard?: {
    key: string;
    id: string;
  };
  envVar?: string;
  verbose: boolean;
  export?: string; // Path to export board/column reference file
  relationshipMap?: string; // Path to export board relationship map
  discover?: boolean; // Discover all boards in workspace
  addAll?: boolean; // Add all new boards from workspace
}
