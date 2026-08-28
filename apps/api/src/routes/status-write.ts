// =============================================================================
// Status write-back — validation for PATCH /api/board-items/:localId/status
// =============================================================================
// Extracted from server.ts as a test seam, same rationale as call-log-write.ts:
// the route keeps the I/O (row lookup, Monday mutation, queue fallback, audit)
// and delegates the decisions.
//
// The decision that matters here is the ORDER of the checks. A status write
// touches a real client record, so it must refuse for the most specific
// reason available — "this item does not exist" before "this label is wrong",
// and never reach Monday with a label the board does not define.
// =============================================================================

import type { BoardStatusOptions } from "@case-pipeline/query";

/** The board_items columns this validation needs. */
export interface BoardItemStatusRow {
  monday_item_id: string | null;
  board_key: string;
  status: string | null;
}

export interface StatusWriteRejection {
  status: number;
  error: string;
  allowed?: string[];
}

/** Everything the route needs to perform the write, once validation passed. */
export interface StatusWritePlan {
  status: string;
  previous: string | null;
  boardKey: string;
  mondayItemId: string;
  mondayBoardId: string;
  statusColumnId: string;
}

/**
 * Validate a requested status change against the item and its board's synced
 * options. Returns either a rejection the route renders verbatim, or a plan
 * with the Monday ids narrowed to non-null.
 *
 * `item` is null when no row matched; `def` is null when the board's status
 * options have never been synced.
 */
export function planStatusWrite(
  rawStatus: unknown,
  item: BoardItemStatusRow | null,
  def: BoardStatusOptions | null,
): { plan: StatusWritePlan } | { rejection: StatusWriteRejection } {
  const status = (rawStatus ?? "").toString().trim();
  if (!status) {
    return { rejection: { status: 400, error: "status is required" } };
  }
  if (!item) {
    return { rejection: { status: 404, error: "Board item not found" } };
  }
  // A local-only row (created while Monday was down, not yet reconciled) has
  // nothing to write to — the pending create must land first.
  if (!item.monday_item_id) {
    return {
      rejection: { status: 400, error: "Board item has no Monday.com item ID — cannot change status" },
    };
  }
  if (!def) {
    return {
      rejection: { status: 409, error: "No status options synced for this board yet — run a sync first" },
    };
  }
  // Never invent a label Monday does not have.
  if (!def.options.some((o) => o.label === status)) {
    return {
      rejection: {
        status: 400,
        error: "Status is not a valid option for this board",
        allowed: def.options.map((o) => o.label),
      },
    };
  }
  return {
    plan: {
      status,
      previous: item.status,
      boardKey: item.board_key,
      mondayItemId: item.monday_item_id,
      mondayBoardId: def.mondayBoardId,
      statusColumnId: def.statusColumnId,
    },
  };
}
