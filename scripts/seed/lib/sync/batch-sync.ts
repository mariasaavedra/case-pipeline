// =============================================================================
// Batch Synchronization
// =============================================================================
// Syncs generated data from SQLite to Monday.com with rate limiting

import type { Database } from "bun:sqlite";
import type { BoardConfig } from "../../../../lib/config/types";
import type { MondayColumn } from "../../../../lib/monday/types";
import {
  createItem,
  fetchBoardStructure,
  ensureLabelsExist,
  findColumnByType,
  findColumnByTitle,
} from "../../../../lib/monday";
import { resolveAllColumns } from "../../../../lib/monday/column-resolver";
import { PRIORITIES, CASE_TYPES, CONTRACT_STATUSES } from "../constants";

// =============================================================================
// Types
// =============================================================================

export interface SyncOptions {
  batchSize: number;
  delayBetweenBatches: number;
  dryRun: boolean;
  onProgress?: (current: number, total: number, item: string) => void;
}

export interface SyncResult {
  total: number;
  synced: number;
  failed: number;
  errors: Array<{ localId: string; error: string }>;
}

interface ProfileRow {
  id: number;
  local_id: string;
  name: string;
  raw_column_values: string;
}

interface ContractRow {
  id: number;
  local_id: string;
  name: string;
  profile_local_id: string;
  profile_monday_id: string | null;
  raw_column_values: string;
}

// =============================================================================
// Batch Syncer
// =============================================================================

export class BatchSyncer {
  private db: Database;
  private options: SyncOptions;

  constructor(db: Database, options: Partial<SyncOptions> = {}) {
    this.db = db;
    this.options = {
      batchSize: options.batchSize ?? 10,
      delayBetweenBatches: options.delayBetweenBatches ?? 1000,
      dryRun: options.dryRun ?? false,
      onProgress: options.onProgress,
    };
  }

  /**
   * Syncs all pending profiles for a batch
   */
  async syncProfiles(batchId: number, boardConfig: BoardConfig): Promise<SyncResult> {
    const result: SyncResult = { total: 0, synced: 0, failed: 0, errors: [] };

    // Fetch board structure
    const board = await fetchBoardStructure(boardConfig.id);
    const resolvedColumns = resolveAllColumns(board.columns, boardConfig);
    const groupId = board.groups[0]?.id;

    if (!groupId) {
      throw new Error(`No groups found in board ${boardConfig.id}`);
    }

    // Ensure required labels exist
    await this.ensureProfileLabels(boardConfig.id, board.columns);

    // Get pending profiles
    const profiles = this.db
      .prepare(
        `SELECT id, local_id, name, raw_column_values
         FROM profiles
         WHERE batch_id = ? AND sync_status = 'pending'
         ORDER BY id`
      )
      .all(batchId) as ProfileRow[];

    result.total = profiles.length;

    // Process in batches
    for (let i = 0; i < profiles.length; i += this.options.batchSize) {
      const batch = profiles.slice(i, i + this.options.batchSize);

      for (const profile of batch) {
        try {
          const columnValues = this.buildMondayColumnValues(
            JSON.parse(profile.raw_column_values),
            resolvedColumns
          );

          if (!this.options.dryRun) {
            const item = await createItem(
              boardConfig.id,
              groupId,
              profile.name,
              columnValues
            );

            this.db
              .prepare(
                `UPDATE profiles
                 SET monday_item_id = ?, sync_status = 'synced', synced_at = datetime('now')
                 WHERE local_id = ?`
              )
              .run(item.id, profile.local_id);
          } else {
            // Dry run - just mark as synced
            this.db
              .prepare(
                `UPDATE profiles
                 SET sync_status = 'synced', synced_at = datetime('now')
                 WHERE local_id = ?`
              )
              .run(profile.local_id);
          }

          result.synced++;
          this.options.onProgress?.(result.synced, result.total, profile.name);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.failed++;
          result.errors.push({ localId: profile.local_id, error: errorMsg });

          this.db
            .prepare(
              `UPDATE profiles
               SET sync_status = 'failed', sync_error = ?
               WHERE local_id = ?`
            )
            .run(errorMsg, profile.local_id);
        }
      }

      // Rate limiting delay
      if (i + this.options.batchSize < profiles.length) {
        await this.sleep(this.options.delayBetweenBatches);
      }
    }

    return result;
  }

  /**
   * Syncs all pending contracts for a batch
   */
  async syncContracts(batchId: number, boardConfig: BoardConfig): Promise<SyncResult> {
    const result: SyncResult = { total: 0, synced: 0, failed: 0, errors: [] };

    // Fetch board structure
    const board = await fetchBoardStructure(boardConfig.id);
    const resolvedColumns = resolveAllColumns(board.columns, boardConfig);
    const groupId = board.groups[0]?.id;

    if (!groupId) {
      throw new Error(`No groups found in board ${boardConfig.id}`);
    }

    // Ensure required labels exist
    await this.ensureContractLabels(boardConfig.id, board.columns);

    // Get pending contracts with their profile's Monday ID
    const contracts = this.db
      .prepare(
        `SELECT c.id, c.local_id, c.name, c.profile_local_id, c.raw_column_values,
                p.monday_item_id as profile_monday_id
         FROM contracts c
         JOIN profiles p ON c.profile_local_id = p.local_id
         WHERE c.batch_id = ? AND c.sync_status = 'pending'
         AND p.sync_status = 'synced'
         ORDER BY c.id`
      )
      .all(batchId) as ContractRow[];

    result.total = contracts.length;

    // Process in batches
    for (let i = 0; i < contracts.length; i += this.options.batchSize) {
      const batch = contracts.slice(i, i + this.options.batchSize);

      for (const contract of batch) {
        try {
          const columnValues = this.buildMondayColumnValues(
            JSON.parse(contract.raw_column_values),
            resolvedColumns
          );

          // Add profile relation if available
          if (contract.profile_monday_id && resolvedColumns.profile_relation) {
            columnValues[resolvedColumns.profile_relation.id] = {
              item_ids: [parseInt(contract.profile_monday_id)],
            };
          }

          if (!this.options.dryRun) {
            const item = await createItem(
              boardConfig.id,
              groupId,
              contract.name,
              columnValues
            );

            this.db
              .prepare(
                `UPDATE contracts
                 SET monday_item_id = ?, profile_monday_id = ?,
                     sync_status = 'synced', synced_at = datetime('now')
                 WHERE local_id = ?`
              )
              .run(item.id, contract.profile_monday_id, contract.local_id);
          } else {
            this.db
              .prepare(
                `UPDATE contracts
                 SET sync_status = 'synced', synced_at = datetime('now')
                 WHERE local_id = ?`
              )
              .run(contract.local_id);
          }

          result.synced++;
          this.options.onProgress?.(result.synced, result.total, contract.name);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.failed++;
          result.errors.push({ localId: contract.local_id, error: errorMsg });

          this.db
            .prepare(
              `UPDATE contracts
               SET sync_status = 'failed', sync_error = ?
               WHERE local_id = ?`
            )
            .run(errorMsg, contract.local_id);
        }
      }

      // Rate limiting delay
      if (i + this.options.batchSize < contracts.length) {
        await this.sleep(this.options.delayBetweenBatches);
      }
    }

    return result;
  }

  /**
   * Ensures required labels exist for profile board
   */
  private async ensureProfileLabels(boardId: string, columns: MondayColumn[]): Promise<void> {
    const statusCol =
      findColumnByType(columns, "status") ||
      findColumnByType(columns, "color") ||
      findColumnByTitle(columns, /status|priority/);

    if (statusCol) {
      await ensureLabelsExist(boardId, statusCol, PRIORITIES);
    }
  }

  /**
   * Ensures required labels exist for contracts board
   */
  private async ensureContractLabels(boardId: string, columns: MondayColumn[]): Promise<void> {
    const caseTypeCol = findColumnByTitle(columns, /case|type/);
    if (caseTypeCol && (caseTypeCol.type === "status" || caseTypeCol.type === "color")) {
      await ensureLabelsExist(boardId, caseTypeCol, CASE_TYPES);
    }

    const statusCol =
      findColumnByType(columns, "status") ||
      findColumnByTitle(columns, /status/);

    if (statusCol && statusCol.id !== caseTypeCol?.id) {
      await ensureLabelsExist(boardId, statusCol, CONTRACT_STATUSES);
    }
  }

  /**
   * Builds Monday.com column values from raw values using resolved column IDs
   */
  private buildMondayColumnValues(
    rawValues: Record<string, unknown>,
    resolvedColumns: Record<string, MondayColumn | undefined>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(rawValues)) {
      const column = resolvedColumns[key];
      if (column && value !== null && value !== undefined) {
        result[column.id] = value;
      }
    }

    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
