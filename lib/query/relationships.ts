// =============================================================================
// Item Relationships Query
// =============================================================================

import type { Database } from "bun:sqlite";

export interface RelationshipWithDetails {
  sourceTable: string;
  sourceLocalId: string;
  targetTable: string;
  targetLocalId: string;
  relationshipType: string;
  columnKey: string | null;
  sourceName: string | null;
  sourceStatus: string | null;
  sourceBoardKey: string | null;
  targetName: string | null;
  targetStatus: string | null;
  targetBoardKey: string | null;
}

interface RelationshipRow {
  source_table: string;
  source_local_id: string;
  target_table: string;
  target_local_id: string;
  relationship_type: string;
  column_key: string | null;
  source_name: string | null;
  source_status: string | null;
  source_board_key: string | null;
  target_name: string | null;
  target_status: string | null;
  target_board_key: string | null;
}

/**
 * Get all item relationships for a client's board items,
 * with resolved names and statuses from the board_items table.
 */
export function getClientRelationships(
  db: Database,
  profileLocalId: string
): RelationshipWithDetails[] {
  const rows = db
    .query(
      `SELECT
        ir.source_table,
        ir.source_local_id,
        ir.target_table,
        ir.target_local_id,
        ir.relationship_type,
        ir.column_key,
        sb.name AS source_name,
        sb.status AS source_status,
        sb.board_key AS source_board_key,
        tb.name AS target_name,
        tb.status AS target_status,
        tb.board_key AS target_board_key
      FROM item_relationships ir
      LEFT JOIN board_items sb ON sb.local_id = ir.source_local_id
      LEFT JOIN board_items tb ON tb.local_id = ir.target_local_id
      WHERE sb.profile_local_id = ?
         OR tb.profile_local_id = ?
      ORDER BY ir.relationship_type, ir.source_local_id`
    )
    .all(profileLocalId, profileLocalId) as RelationshipRow[];

  return rows.map((row) => ({
    sourceTable: row.source_table,
    sourceLocalId: row.source_local_id,
    targetTable: row.target_table,
    targetLocalId: row.target_local_id,
    relationshipType: row.relationship_type,
    columnKey: row.column_key,
    sourceName: row.source_name,
    sourceStatus: row.source_status,
    sourceBoardKey: row.source_board_key,
    targetName: row.target_name,
    targetStatus: row.target_status,
    targetBoardKey: row.target_board_key,
  }));
}
