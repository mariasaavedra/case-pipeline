// =============================================================================
// Generic Board Item Factory
// =============================================================================
// Creates items for any board using the board_items table.

import type { Database } from "bun:sqlite";
import type { BoardConfig } from "../../../../lib/config/types";
import { generateColumnValue } from "./column-generators";
import { faker } from "./column-generators";

// =============================================================================
// Types
// =============================================================================

export interface GeneratedBoardItem {
  localId: string;
  boardKey: string;
  groupTitle?: string;
  name: string;
  columnValues: Record<string, unknown>;
}

export interface BoardItemCreateOptions {
  batchId: number;
  boardKey: string;
  boardConfig: BoardConfig;
  name: string;
  /** Monday.com group title for the item */
  groupTitle?: string;
  /** Override auto-generated values for specific columns */
  overrides?: Record<string, unknown>;
}

export interface ItemRelationship {
  sourceTable: string;
  sourceLocalId: string;
  targetTable: string;
  targetLocalId: string;
  relationshipType: string;
  columnKey: string;
}

// Read-only column types that should be skipped during generation
const SKIP_TYPES = new Set([
  "mirror", "lookup", "item_id", "creation_log",
  "button", "subtasks", "file", "people", "last_updated",
  "direct_doc", "doc", "link", "tags",
]);

// =============================================================================
// BoardItemFactory
// =============================================================================

export class BoardItemFactory {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Creates a board item with auto-generated column values + overrides
   */
  create(options: BoardItemCreateOptions): GeneratedBoardItem {
    const localId = faker.string.uuid();
    const columnValues: Record<string, unknown> = {};

    // Auto-generate values for writable column types
    for (const [key, resolution] of Object.entries(options.boardConfig.columns)) {
      const type = resolution.type ?? resolution.types?.[0];
      if (!type || SKIP_TYPES.has(type)) continue;

      // Skip board_relation — handled by relationships
      if (type === "board_relation") continue;

      // Use override if provided
      if (options.overrides && key in options.overrides) {
        columnValues[key] = options.overrides[key];
        continue;
      }

      // Auto-generate based on type
      const value = generateColumnValue(type);
      if (value !== null) {
        columnValues[key] = value;
      }
    }

    // Apply any remaining overrides not in board config
    if (options.overrides) {
      for (const [key, value] of Object.entries(options.overrides)) {
        if (!(key in columnValues)) {
          columnValues[key] = value;
        }
      }
    }

    const item: GeneratedBoardItem = {
      localId,
      boardKey: options.boardKey,
      groupTitle: options.groupTitle,
      name: options.name,
      columnValues,
    };

    this.persist(item, options.batchId);
    return item;
  }

  /**
   * Creates a relationship between two items
   */
  createRelationship(batchId: number, rel: ItemRelationship): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO item_relationships (
        batch_id, source_table, source_local_id,
        target_table, target_local_id,
        relationship_type, column_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      rel.sourceTable,
      rel.sourceLocalId,
      rel.targetTable,
      rel.targetLocalId,
      rel.relationshipType,
      rel.columnKey
    );
  }

  /**
   * Persists a board item to the database
   */
  private persist(item: GeneratedBoardItem, batchId: number): void {
    this.db.prepare(`
      INSERT INTO board_items (
        batch_id, local_id, board_key, group_title, name, column_values
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      item.localId,
      item.boardKey,
      item.groupTitle ?? null,
      item.name,
      JSON.stringify(item.columnValues)
    );
  }
}
