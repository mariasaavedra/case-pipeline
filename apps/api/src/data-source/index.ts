// =============================================================================
// DataSource — the app's write seam (first step toward Monday-independence)
// =============================================================================
// The app's write endpoints talk to this interface, NOT to Monday's GraphQL
// shape directly. Today the only implementation is `mondayDataSource` (current
// behavior, unchanged). The point is the decoupling: the day we want a
// local-authoritative backend, we implement `DataSource` once and the endpoints
// don't change. Reads still go through the local mirror (`libs/query`); only the
// mutating operations flow through here.
// =============================================================================

import {
  createUpdate,
  changeSimpleColumnValue,
  changeColumnValue,
  createItem as mondayCreateItem,
  createTimelineItem as mondayCreateTimelineItem,
  addFileToColumn,
  pinUpdateToTop,
  moveItemToBoard,
  changeMultipleColumnValues,
  fetchItem,
} from "@case-pipeline/monday";
import type { CreateTimelineItemInput, UpdateMention } from "@case-pipeline/monday";

export interface DataSource {
  /** Post a note/update on an item, or a threaded reply when `parentId` is given; `mentions` notifies those users. Returns the new update id. */
  postUpdate(itemId: string, body: string, token?: string, parentId?: string, mentions?: UpdateMention[]): Promise<string>;
  /** Pin an existing update to the top of its item's feed. */
  pinUpdate(updateId: string, itemId: string, token?: string): Promise<void>;
  /** Set a simple column value (status label, date, number, text). */
  setColumnValue(boardId: string, itemId: string, columnId: string, value: string, token?: string): Promise<void>;
  /** Set a JSON-valued column (people, board_relation, …) on an existing item. */
  setColumnValueJson(boardId: string, itemId: string, columnId: string, value: Record<string, unknown>, token?: string): Promise<void>;
  /** Create an item with column values, optionally in a specific group. Returns the new item id. */
  createItem(boardId: string, itemName: string, columnValues: Record<string, unknown>, token?: string, groupId?: string, createLabelsIfMissing?: boolean): Promise<string>;
  /** Create an Emails & Activities timeline entry on an item. Returns the new timeline item id. */
  createTimelineItem(input: CreateTimelineItemInput, token?: string): Promise<string>;
  /** Set several columns on one item at once (createItem's per-column shapes). */
  setColumnValues(boardId: string, itemId: string, columnValues: Record<string, unknown>, token?: string, createLabelsIfMissing?: boolean): Promise<void>;
  /** Move an item to another board and group; Monday carries columns over by title + type. */
  moveItem(boardId: string, groupId: string, itemId: string, token?: string): Promise<void>;
  /** Upload a file into an item's file column. Returns the new asset id. */
  addFile(itemId: string, columnId: string, fileName: string, bytes: Uint8Array, contentType: string, token?: string): Promise<string>;
  /** A column's display text on Monday right now ("" when empty), for "only if empty" writes. */
  getColumnText(itemId: string, columnId: string): Promise<string>;
}

/** Told which columns of an item a direct write just set, after it succeeded. */
export type ColumnWriteListener = (itemId: string, columnIds: string[]) => void;

let columnWriteListener: ColumnWriteListener | null = null;

/**
 * Register the one listener for successful direct column writes. server.ts uses
 * it to retire queued writes to the same columns, which would otherwise retry
 * later and put the older value back (write-queue/processor.ts).
 */
export function onDirectColumnWrite(listener: ColumnWriteListener | null): void {
  columnWriteListener = listener;
}

function columnsWritten(itemId: string, columnIds: string[]): void {
  // The Monday write already landed; bookkeeping must never fail the request.
  try {
    columnWriteListener?.(itemId, columnIds);
  } catch (err) {
    console.warn(`[data-source] column-write listener failed for item ${itemId}:`, err);
  }
}

/** Backed by Monday.com — the current, only implementation. */
export const mondayDataSource: DataSource = {
  postUpdate: (itemId, body, token, parentId, mentions) => createUpdate(itemId, body, token, parentId, mentions),
  pinUpdate: (updateId, itemId, token) => pinUpdateToTop(updateId, itemId, token),
  setColumnValue: async (boardId, itemId, columnId, value, token) => {
    await changeSimpleColumnValue(boardId, itemId, columnId, value, token);
    columnsWritten(itemId, [columnId]);
  },
  setColumnValueJson: async (boardId, itemId, columnId, value, token) => {
    await changeColumnValue(boardId, itemId, columnId, value, token);
    columnsWritten(itemId, [columnId]);
  },
  createItem: (boardId, itemName, columnValues, token, groupId, createLabelsIfMissing) =>
    mondayCreateItem(boardId, itemName, columnValues, token, groupId, createLabelsIfMissing),
  createTimelineItem: (input, token) => mondayCreateTimelineItem(input, token),
  setColumnValues: async (boardId, itemId, columnValues, token, createLabelsIfMissing) => {
    await changeMultipleColumnValues(boardId, itemId, columnValues, token, createLabelsIfMissing);
    columnsWritten(itemId, Object.keys(columnValues));
  },
  moveItem: async (boardId, groupId, itemId, token) => {
    await moveItemToBoard(boardId, groupId, itemId, token);
  },
  addFile: (itemId, columnId, fileName, bytes, contentType, token) =>
    addFileToColumn(itemId, columnId, fileName, bytes, contentType, token),
  getColumnText: async (itemId, columnId) =>
    ((await fetchItem(itemId)).column_values.find((c) => c.id === columnId)?.text ?? "").trim(),
};

/** The active data source the app writes through. Swap this one line the day a
 * local-authoritative backend replaces Monday. */
export const dataSource: DataSource = mondayDataSource;
