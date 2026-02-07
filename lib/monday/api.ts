// =============================================================================
// Monday.com API utilities
// =============================================================================

import type { MondayBoard, MondayColumn, MondayItem, ColumnLabels } from "./types";

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
  variables?: Record<string, unknown>
): Promise<T> {
  const token = getApiToken();
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
    data: { boards: [{ items_page: { cursor: string | null; items: MondayItem[] } }] };
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
  };
}

/**
 * Fetches all items from a board (handles pagination automatically)
 */
export async function fetchAllBoardItems(
  boardId: string,
  options: { maxItems?: number; onProgress?: (count: number) => void } = {}
): Promise<MondayItem[]> {
  const maxItems = options.maxItems ?? 500;
  const allItems: MondayItem[] = [];
  let cursor: string | null = null;

  do {
    const page = await fetchBoardItems(boardId, { limit: 50, cursor: cursor ?? undefined });
    allItems.push(...page.items);
    cursor = page.cursor;

    options.onProgress?.(allItems.length);

    if (allItems.length >= maxItems) {
      break;
    }
  } while (cursor);

  return allItems.slice(0, maxItems);
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

