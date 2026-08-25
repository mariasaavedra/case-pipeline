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
  createItem as mondayCreateItem,
  createTimelineItem as mondayCreateTimelineItem,
} from "@case-pipeline/monday";
import type { CreateTimelineItemInput } from "@case-pipeline/monday";

export interface DataSource {
  /** Post a note/update on an item. Returns the new update id. */
  postUpdate(itemId: string, body: string, token?: string): Promise<string>;
  /** Set a simple column value (status label, date, number, text). */
  setColumnValue(boardId: string, itemId: string, columnId: string, value: string, token?: string): Promise<void>;
  /** Create an item with column values, optionally in a specific group. Returns the new item id. */
  createItem(boardId: string, itemName: string, columnValues: Record<string, unknown>, token?: string, groupId?: string): Promise<string>;
  /** Create an Emails & Activities timeline entry on an item. Returns the new timeline item id. */
  createTimelineItem(input: CreateTimelineItemInput, token?: string): Promise<string>;
}

/** Backed by Monday.com — the current, only implementation. */
export const mondayDataSource: DataSource = {
  postUpdate: (itemId, body, token) => createUpdate(itemId, body, token),
  setColumnValue: async (boardId, itemId, columnId, value, token) => {
    await changeSimpleColumnValue(boardId, itemId, columnId, value, token);
  },
  createItem: (boardId, itemName, columnValues, token, groupId) => mondayCreateItem(boardId, itemName, columnValues, token, groupId),
  createTimelineItem: (input, token) => mondayCreateTimelineItem(input, token),
};

/** The active data source the app writes through. Swap this one line the day a
 * local-authoritative backend replaces Monday. */
export const dataSource: DataSource = mondayDataSource;
