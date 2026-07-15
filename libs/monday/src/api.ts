// =============================================================================
// Monday.com API utilities
// =============================================================================

import type {
  MondayBoard,
  MondayColumn,
  MondayItem,
  ColumnLabels,
  MondayUpdate,
  MondayTimelineItem,
  MondayCustomActivity,
} from "./types";

// =============================================================================
// Custom Error Types
// =============================================================================

export class MondayApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "MondayApiError";
  }
}

export class RateLimitError extends MondayApiError {
  public readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message, 429, true);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class AuthError extends MondayApiError {
  constructor(message: string) {
    super(message, 401, false);
    this.name = "AuthError";
  }
}

export class NetworkError extends MondayApiError {
  constructor(message: string, public override readonly cause?: Error) {
    super(message, undefined, true);
    this.name = "NetworkError";
  }
}

export class TimeoutError extends MondayApiError {
  constructor(message: string) {
    super(message, undefined, true);
    this.name = "TimeoutError";
  }
}

// =============================================================================
// API Configuration
// =============================================================================

interface ApiConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  apiVersion: string;
}

const DEFAULT_API_CONFIG: ApiConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  timeoutMs: 30000,
  apiVersion: "2024-10",
};

let apiConfig: ApiConfig = { ...DEFAULT_API_CONFIG };

export function setApiConfig(config: Partial<ApiConfig>): void {
  apiConfig = { ...apiConfig, ...config };
}

/** @deprecated Use setApiConfig instead */
export function setRetryConfig(config: Partial<Omit<ApiConfig, "apiVersion">>): void {
  apiConfig = { ...apiConfig, ...config };
}

// =============================================================================
// Retry Logic
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBackoff(attempt: number, baseDelay: number, maxDelay: number): number {
  // Exponential backoff with jitter: base * 2^attempt + random jitter
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelay * 0.5;
  return Math.min(exponentialDelay + jitter, maxDelay);
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseRetryAfter(response: Response): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }
  }
  // Default to 60 seconds if no Retry-After header
  return 60000;
}

function classifyError(response: Response): MondayApiError {
  const status = response.status;

  if (status === 401 || status === 403) {
    return new AuthError(`Authentication failed: ${status} ${response.statusText}`);
  }

  if (status === 429) {
    const retryAfterMs = parseRetryAfter(response);
    return new RateLimitError(
      `Rate limit exceeded. Retry after ${retryAfterMs}ms`,
      retryAfterMs
    );
  }

  // 5xx errors are retryable
  if (status >= 500) {
    return new MondayApiError(
      `Server error: ${status} ${response.statusText}`,
      status,
      true
    );
  }

  // Other 4xx errors are not retryable
  return new MondayApiError(
    `API error: ${status} ${response.statusText}`,
    status,
    false
  );
}

let apiToken: string | null = null;

export function setApiToken(token: string): void {
  apiToken = token;
}

export function getApiToken(): string {
  if (!apiToken) {
    throw new Error("Monday API token not set. Call setApiToken() first.");
  }
  return apiToken;
}

// =============================================================================
// Core API request function with retry logic
// =============================================================================

async function executeRequest(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<Response> {
  return fetchWithTimeout(
    "https://api.monday.com/v2",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
        "API-Version": apiConfig.apiVersion,
      },
      body: JSON.stringify({ query, variables }),
    },
    apiConfig.timeoutMs
  );
}

export async function mondayRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  tokenOverride?: string
): Promise<T> {
  const token = tokenOverride ?? getApiToken();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= apiConfig.maxRetries; attempt++) {
    try {
      const response = await executeRequest(token, query, variables);

      // Handle non-OK responses
      if (!response.ok) {
        const error = classifyError(response);

        // For rate limits, wait the specified time
        if (error instanceof RateLimitError) {
          if (attempt < apiConfig.maxRetries) {
            console.warn(
              `Rate limited. Waiting ${error.retryAfterMs}ms before retry ${attempt + 1}/${apiConfig.maxRetries}...`
            );
            await sleep(error.retryAfterMs);
            continue;
          }
        }

        // For other retryable errors, use exponential backoff
        if (error.retryable && attempt < apiConfig.maxRetries) {
          const delay = calculateBackoff(
            attempt,
            apiConfig.baseDelayMs,
            apiConfig.maxDelayMs
          );
          console.warn(
            `Request failed (${error.message}). Retrying in ${Math.round(delay)}ms (${attempt + 1}/${apiConfig.maxRetries})...`
          );
          await sleep(delay);
          continue;
        }

        throw error;
      }

      // Parse response
      const data = (await response.json()) as { errors?: unknown[]; data?: T };

      // Handle GraphQL errors
      if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
        const errorMessage = JSON.stringify(data.errors);

        // Check if it's a rate limit error in GraphQL response
        const isRateLimitError = data.errors.some(
          (e: unknown) =>
            typeof e === "object" &&
            e !== null &&
            "message" in e &&
            typeof (e as { message: string }).message === "string" &&
            (e as { message: string }).message.toLowerCase().includes("rate limit")
        );

        if (isRateLimitError && attempt < apiConfig.maxRetries) {
          const delay = calculateBackoff(
            attempt,
            apiConfig.baseDelayMs,
            apiConfig.maxDelayMs
          );
          console.warn(
            `GraphQL rate limit error. Retrying in ${Math.round(delay)}ms (${attempt + 1}/${apiConfig.maxRetries})...`
          );
          await sleep(delay);
          continue;
        }

        throw new MondayApiError(`Monday API errors: ${errorMessage}`);
      }

      return data as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry non-retryable errors
      if (error instanceof MondayApiError && !error.retryable) {
        throw error;
      }

      // Handle network errors with retry
      if (
        error instanceof TypeError ||
        error instanceof TimeoutError ||
        error instanceof NetworkError
      ) {
        if (attempt < apiConfig.maxRetries) {
          const delay = calculateBackoff(
            attempt,
            apiConfig.baseDelayMs,
            apiConfig.maxDelayMs
          );
          console.warn(
            `Network error: ${error.message}. Retrying in ${Math.round(delay)}ms (${attempt + 1}/${apiConfig.maxRetries})...`
          );
          await sleep(delay);
          continue;
        }
        throw new NetworkError(`Network error after ${apiConfig.maxRetries} retries: ${error.message}`, error);
      }

      // Re-throw unknown errors
      throw error;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new MondayApiError("Request failed after all retries");
}

// =============================================================================
// Board operations
// =============================================================================

export async function fetchBoardStructure(boardId: string): Promise<MondayBoard> {
  const query = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        id
        name
        columns {
          id
          title
          type
          settings_str
        }
        groups {
          id
          title
        }
      }
    }
  `;

  const result = await mondayRequest<{ data: { boards: MondayBoard[] } }>(query, {
    boardId: [boardId],
  });
  const board = result.data.boards[0];

  if (!board) {
    throw new Error(`Board ${boardId} not found`);
  }

  return board;
}

/**
 * Fetch all boards in the workspace (for discovery)
 */
export async function fetchAllBoards(): Promise<MondayBoard[]> {
  const query = `
    query {
      boards(limit: 100) {
        id
        name
        columns {
          id
          title
          type
          settings_str
        }
        groups {
          id
          title
        }
      }
    }
  `;

  const result = await mondayRequest<{ data: { boards: MondayBoard[] } }>(query);
  return result.data.boards || [];
}

export interface BoardItemsPage {
  items: MondayItem[];
  cursor: string | null;
  /** Total number of items Monday reports for the board (null if unavailable). */
  itemsCount: number | null;
}

/**
 * Fetches items from a board with pagination support
 */
export async function fetchBoardItems(
  boardId: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<BoardItemsPage> {
  const limit = options.limit ?? 50;

  const query = `
    query ($boardId: ID!, $limit: Int!, $cursor: String) {
      boards(ids: [$boardId]) {
        items_count
        items_page(limit: $limit, cursor: $cursor) {
          cursor
          items {
            id
            name
            group {
              id
              title
            }
            column_values {
              id
              text
              ... on BoardRelationValue {
                linked_item_ids
                display_value
              }
              ... on MirrorValue {
                display_value
              }
            }
          }
        }
      }
    }
  `;

  const result = await mondayRequest<{
    data: {
      boards: [{ items_count: number | null; items_page: { cursor: string | null; items: MondayItem[] } }];
    };
  }>(query, {
    boardId,
    limit,
    cursor: options.cursor ?? null,
  });

  const board = result.data.boards[0];
  if (!board) {
    throw new Error(`Board ${boardId} not found`);
  }

  return {
    items: board.items_page.items,
    cursor: board.items_page.cursor,
    itemsCount: board.items_count ?? null,
  };
}

/** Describes a board whose full item set was not fully retrieved. */
export interface BoardTruncation {
  boardId: string;
  /** Items actually returned by this call. */
  fetched: number;
  /** Total items Monday reports for the board (null if unavailable). */
  expected: number | null;
  reason: "max_items_cap" | "count_mismatch";
}

/**
 * Fetches all items from a board (handles pagination automatically).
 *
 * Two ways a board can come back short, both of which are surfaced via
 * `onTruncated` (the items fetched so far are still returned, never discarded):
 *  - `max_items_cap`: we hit the `maxItems` ceiling while a cursor remained.
 *  - `count_mismatch`: pagination ended (cursor exhausted) but we returned
 *    fewer items than Monday's `items_count` — e.g. a transient subgraph error
 *    made Monday hand back a null cursor mid-board. Without this check that
 *    truncation is silent and the board looks fully synced.
 */
export async function fetchAllBoardItems(
  boardId: string,
  options: {
    maxItems?: number;
    pageSize?: number;
    onProgress?: (count: number) => void;
    onTruncated?: (truncation: BoardTruncation) => void;
  } = {}
): Promise<MondayItem[]> {
  const maxItems = options.maxItems ?? 500;
  const pageSize = options.pageSize ?? 50;
  const allItems: MondayItem[] = [];
  let cursor: string | null = null;
  let expected: number | null = null;
  let cappedWithMore = false;

  do {
    const page = await fetchBoardItems(boardId, { limit: pageSize, cursor: cursor ?? undefined });
    if (expected === null) expected = page.itemsCount;
    allItems.push(...page.items);
    cursor = page.cursor;

    options.onProgress?.(allItems.length);

    if (allItems.length >= maxItems) {
      // Stopped at the safety ceiling. If a cursor remains, the board has more
      // items than we returned — a truncation the caller should know about.
      cappedWithMore = cursor !== null;
      break;
    }
  } while (cursor);

  const items = allItems.slice(0, maxItems);

  if (cappedWithMore) {
    options.onTruncated?.({ boardId, fetched: items.length, expected, reason: "max_items_cap" });
  } else if (expected !== null && items.length < expected) {
    // Pagination ran to completion (cursor exhausted) yet we came up short of the
    // board's reported item count — pagination was truncated mid-board.
    options.onTruncated?.({ boardId, fetched: items.length, expected, reason: "count_mismatch" });
  }

  return items;
}

export async function fetchItem(itemId: string): Promise<MondayItem> {
  const query = `
    query ($itemId: [ID!]) {
      items(ids: $itemId) {
        id
        name
        board {
          id
          name
        }
        group {
          id
          title
        }
        column_values {
          id
          text
          ... on BoardRelationValue {
            linked_item_ids
            display_value
            linked_items {
              id
              name
              column_values {
                id
                text
              }
            }
          }
          ... on MirrorValue {
            display_value
          }
        }
      }
    }
  `;

  const result = await mondayRequest<{ data: { items: MondayItem[] } }>(query, {
    itemId: [itemId],
  });
  const item = result.data.items[0];

  if (!item) {
    throw new Error(`Item ${itemId} not found`);
  }

  return item;
}

// =============================================================================
// Linked item utilities (read-only)
// =============================================================================

/**
 * Extracts linked item IDs from a board_relation column value.
 */
export function getLinkedItemIds(
  item: MondayItem,
  relationColumnId: string
): string[] {
  const columnValue = item.column_values.find((cv) => cv.id === relationColumnId);
  if (!columnValue || !columnValue.linked_item_ids) {
    return [];
  }
  return columnValue.linked_item_ids;
}

// =============================================================================
// Column utilities
// =============================================================================

export function findColumnByType(
  columns: MondayColumn[],
  type: string
): MondayColumn | undefined {
  return columns.find((c) => c.type === type);
}

export function findColumnByTitle(
  columns: MondayColumn[],
  titlePattern: RegExp
): MondayColumn | undefined {
  return columns.find((c) => titlePattern.test(c.title.toLowerCase()));
}

// =============================================================================
// Label management
// =============================================================================

export function parseColumnLabels(column: MondayColumn): ColumnLabels {
  try {
    const settings = JSON.parse(column.settings_str);
    if (settings.labels) {
      if (Array.isArray(settings.labels)) {
        const result: ColumnLabels = {};
        for (const label of settings.labels) {
          result[label.id.toString()] = label.name;
        }
        return result;
      } else {
        return settings.labels;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

export function getExistingLabelNames(column: MondayColumn): string[] {
  const labels = parseColumnLabels(column);
  return Object.values(labels);
}

// =============================================================================
// Updates fetching
// =============================================================================

/**
 * Fetch updates (and their replies) for a batch of item IDs in one request.
 * Returns a map of monday_item_id → updates array.
 * Batch size should stay at or below 25 to avoid complexity limits.
 */
export async function fetchItemUpdatesBatch(
  itemIds: string[],
  updatesLimit = 100
): Promise<Map<string, MondayUpdate[]>> {
  if (itemIds.length === 0) return new Map();

  const query = `
    query ($ids: [ID!], $limit: Int!) {
      items(ids: $ids) {
        id
        updates(limit: $limit) {
          id
          body
          created_at
          creator { name email }
          replies {
            id
            body
            created_at
            creator { name email }
          }
        }
      }
    }
  `;

  const result = await mondayRequest<{
    data: { items: Array<{ id: string; updates: MondayUpdate[] }> };
  }>(query, { ids: itemIds, limit: updatesLimit });

  const map = new Map<string, MondayUpdate[]>();
  for (const item of result.data.items ?? []) {
    map.set(item.id, item.updates ?? []);
  }
  return map;
}

/**
 * Post a new update (comment) to a Monday.com item.
 * Returns the Monday.com update ID of the newly created update.
 */
export async function createUpdate(itemId: string, body: string, tokenOverride?: string): Promise<string> {
  const result = await mondayRequest<{ data: { create_update: { id: string } } }>(
    `mutation CreateUpdate($itemId: ID!, $body: String!) {
       create_update(item_id: $itemId, body: $body) { id }
     }`,
    { itemId, body },
    tokenOverride
  );
  return result.data.create_update.id;
}

// =============================================================================
// Emails & Activities (E&A) timeline fetching (read)
// =============================================================================

const TIMELINE_ITEM_FIELDS = `
  id
  type
  title
  content
  created_at
  custom_activity_id
  user { id name }
`;

/**
 * GraphQL alias for an item's timeline in a batched request. Aliases must be
 * valid names (can't start with a digit), so we prefix the numeric id with "t".
 */
export function timelineAlias(itemId: string): string {
  return `t${itemId}`;
}

/**
 * Fetch the account's custom activity types as an id → name map. Used to label
 * E&A rows whose type is `custom` (e.g. "Consult note", "HEARING NOTES").
 */
export async function fetchCustomActivities(tokenOverride?: string): Promise<Map<string, string>> {
  const result = await mondayRequest<{ data: { custom_activity: MondayCustomActivity[] } }>(
    `query { custom_activity { id name } }`,
    undefined,
    tokenOverride
  );
  const map = new Map<string, string>();
  for (const a of result.data.custom_activity ?? []) {
    map.set(a.id, a.name);
  }
  return map;
}

/** Follow a single item's timeline pagination tail until the cursor runs out. */
async function fetchTimelineTail(
  itemId: string,
  firstCursor: string,
  pageLimit: number,
  tokenOverride?: string
): Promise<MondayTimelineItem[]> {
  const items: MondayTimelineItem[] = [];
  let cursor: string | null = firstCursor;

  while (cursor) {
    const result: {
      data: {
        timeline: { timeline_items_page: { cursor: string | null; timeline_items: MondayTimelineItem[] } } | null;
      };
    } = await mondayRequest(
      `query ($id: ID!, $cursor: String, $limit: Int!) {
         timeline(id: $id) {
           timeline_items_page(limit: $limit, cursor: $cursor) {
             cursor
             timeline_items { ${TIMELINE_ITEM_FIELDS} }
           }
         }
       }`,
      { id: itemId, cursor, limit: pageLimit },
      tokenOverride
    );
    const page = result.data.timeline?.timeline_items_page;
    if (!page) break;
    items.push(...(page.timeline_items ?? []));
    cursor = page.cursor;
  }
  return items;
}

type TimelineNode = {
  timeline_items_page: { cursor: string | null; timeline_items: MondayTimelineItem[] };
} | null;

/**
 * Fetch the E&A timeline for a batch of item IDs in one request.
 *
 * `timeline` is a top-level query (not an Item field), so we batch by emitting
 * one aliased `timeline(id: …)` selection per item. Any item whose first page
 * reports a cursor is then paginated individually. Returns a map of
 * monday_item_id → timeline items (newest-first, as Monday returns them).
 *
 * Keep batches modest (≤ ~15) — E&A queries are heavier than plain updates.
 */
export async function fetchTimelineBatch(
  itemIds: string[],
  pageLimit = 50,
  tokenOverride?: string
): Promise<Map<string, MondayTimelineItem[]>> {
  const map = new Map<string, MondayTimelineItem[]>();
  if (itemIds.length === 0) return map;

  const aliases = itemIds
    .map(
      (id) =>
        `${timelineAlias(id)}: timeline(id: ${JSON.stringify(id)}) {
          timeline_items_page(limit: ${pageLimit}) {
            cursor
            timeline_items { ${TIMELINE_ITEM_FIELDS} }
          }
        }`
    )
    .join("\n");

  const result = await mondayRequest<{ data: Record<string, TimelineNode> }>(
    `query { ${aliases} }`,
    undefined,
    tokenOverride
  );

  for (const id of itemIds) {
    const node = result.data?.[timelineAlias(id)];
    if (!node) {
      map.set(id, []);
      continue;
    }
    const page = node.timeline_items_page;
    const items = [...(page.timeline_items ?? [])];
    if (page.cursor) {
      items.push(...(await fetchTimelineTail(id, page.cursor, pageLimit, tokenOverride)));
    }
    map.set(id, items);
  }
  return map;
}

