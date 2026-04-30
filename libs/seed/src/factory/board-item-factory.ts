// =============================================================================
// Generic Board Item Factory
// =============================================================================
// Creates items for any board using the board_items table.
// Override-only mode: column_values contains only explicitly set overrides,
// no auto-generated noise.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { BoardConfig } from "@case-pipeline/config/types";
import { faker } from "./column-generators";

// =============================================================================
// Types
// =============================================================================

export interface GeneratedBoardItem {
  localId: string;
  boardKey: string;
  groupTitle?: string;
  name: string;
  status?: string;
  nextDate?: string;
  attorney?: string;
  profileLocalId?: string;
  columnValues: Record<string, unknown>;
}

export interface BoardItemCreateOptions {
  batchId: number;
  boardKey: string;
  boardConfig: BoardConfig;
  name: string;
  /** Monday.com group title for the item */
  groupTitle?: string;
  /** Explicit column values from board generators */
  overrides?: Record<string, unknown>;
  /** Denormalized profile link for fast queries */
  profileLocalId?: string;
  /** Attorney initials (WH, LB, M, R) */
  attorney?: string;
}

export interface ItemRelationship {
  sourceTable: string;
  sourceLocalId: string;
  targetTable: string;
  targetLocalId: string;
  relationshipType: string;
  columnKey: string;
}

// =============================================================================
// Next-date key mapping per board
// =============================================================================

const NEXT_DATE_KEY: Record<string, string> = {
  court_cases: "x_next_hearing_date",
  motions: "next_hearing_date",
  _cd_open_forms: "target_date",
  appeals: "appeal_due",
  rfes_all: "due_date",
  litigation: "due_date",
  _lt_i918b_s: "due_date_for_u_visa_hire",
  address_changes: "date_sent",
  _na_originals_cards_notices: "date_received",
  appointments_r: "consult_date",
  appointments_m: "consult_date",
  appointments_lb: "consult_date",
  appointments_wh: "consult_date",
  _fa_jail_intakes: "consult_date",
};

// =============================================================================
// BoardItemFactory
// =============================================================================

export class BoardItemFactory {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Creates a board item using only explicit overrides (no auto-generation).
   * Extracts status and next_date into first-class columns.
   */
  create(options: BoardItemCreateOptions): GeneratedBoardItem {
    const localId = faker.string.uuid();

    // Only use explicitly provided overrides — no auto-generation
    const columnValues: Record<string, unknown> = options.overrides
      ? { ...options.overrides }
      : {};

    // Extract status from overrides
    const statusObj = columnValues.status as { label?: string } | undefined;
    const status = statusObj?.label ?? undefined;

    // Extract next_date from board-specific key
    const dateKey = NEXT_DATE_KEY[options.boardKey];
    let nextDate: string | undefined;
    if (dateKey && columnValues[dateKey]) {
      const dateObj = columnValues[dateKey] as { date?: string } | undefined;
      nextDate = dateObj?.date ?? undefined;
    }

    const item: GeneratedBoardItem = {
      localId,
      boardKey: options.boardKey,
      groupTitle: options.groupTitle,
      name: options.name,
      status,
      nextDate,
      attorney: options.attorney,
      profileLocalId: options.profileLocalId,
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
        batch_id, local_id, board_key, group_title, name,
        status, next_date, attorney, profile_local_id,
        column_values
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      item.localId,
      item.boardKey,
      item.groupTitle ?? null,
      item.name,
      item.status ?? null,
      item.nextDate ?? null,
      item.attorney ?? null,
      item.profileLocalId ?? null,
      JSON.stringify(item.columnValues)
    );
  }
}
