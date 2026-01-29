// =============================================================================
// Monday.com API utilities
// =============================================================================

import type { MondayBoard, MondayColumn, MondayItem, CreatedItem, ColumnLabels } from "./types";

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
// Retry Configuration
// =============================================================================

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  timeoutMs: 30000,
};

let retryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG };

export function setRetryConfig(config: Partial<RetryConfig>): void {
  retryConfig = { ...retryConfig, ...config };
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
        "API-Version": "2023-04",
      },
      body: JSON.stringify({ query, variables }),
    },
    retryConfig.timeoutMs
  );
}

export async function mondayRequest<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = getApiToken();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const response = await executeRequest(token, query, variables);

      // Handle non-OK responses
      if (!response.ok) {
        const error = classifyError(response);

        // For rate limits, wait the specified time
        if (error instanceof RateLimitError) {
          if (attempt < retryConfig.maxRetries) {
            console.warn(
              `Rate limited. Waiting ${error.retryAfterMs}ms before retry ${attempt + 1}/${retryConfig.maxRetries}...`
            );
            await sleep(error.retryAfterMs);
            continue;
          }
        }

        // For other retryable errors, use exponential backoff
        if (error.retryable && attempt < retryConfig.maxRetries) {
          const delay = calculateBackoff(
            attempt,
            retryConfig.baseDelayMs,
            retryConfig.maxDelayMs
          );
          console.warn(
            `Request failed (${error.message}). Retrying in ${Math.round(delay)}ms (${attempt + 1}/${retryConfig.maxRetries})...`
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

        if (isRateLimitError && attempt < retryConfig.maxRetries) {
          const delay = calculateBackoff(
            attempt,
            retryConfig.baseDelayMs,
            retryConfig.maxDelayMs
          );
          console.warn(
            `GraphQL rate limit error. Retrying in ${Math.round(delay)}ms (${attempt + 1}/${retryConfig.maxRetries})...`
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
        if (attempt < retryConfig.maxRetries) {
          const delay = calculateBackoff(
            attempt,
            retryConfig.baseDelayMs,
            retryConfig.maxDelayMs
          );
          console.warn(
            `Network error: ${error.message}. Retrying in ${Math.round(delay)}ms (${attempt + 1}/${retryConfig.maxRetries})...`
          );
          await sleep(delay);
          continue;
        }
        throw new NetworkError(`Network error after ${retryConfig.maxRetries} retries: ${error.message}`, error);
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

export async function createItem(
  boardId: string,
  groupId: string,
  itemName: string,
  columnValues: Record<string, unknown>
): Promise<CreatedItem> {
  const query = `
    mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id: $boardId
        group_id: $groupId
        item_name: $itemName
        column_values: $columnValues
      ) {
        id
        name
      }
    }
  `;

  const result = await mondayRequest<{ data: { create_item: CreatedItem } }>(query, {
    boardId,
    groupId,
    itemName,
    columnValues: JSON.stringify(columnValues),
  });

  return result.data.create_item;
}

export async function updateColumnValue(
  boardId: string,
  itemId: string,
  columnId: string,
  value: unknown
): Promise<{ id: string }> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId
        item_id: $itemId
        column_id: $columnId
        value: $value
      ) {
        id
      }
    }
  `;

  const result = await mondayRequest<{ data: { change_column_value: { id: string } } }>(
    query,
    {
      boardId,
      itemId,
      columnId,
      value: JSON.stringify(value),
    }
  );

  return result.data.change_column_value;
}

// =============================================================================
// Linked item utilities
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

/**
 * Updates a column value on all linked items (or a specific one).
 * Useful for updating data on connected boards through a relation.
 *
 * @param item - The source item containing the board relation
 * @param relationColumnId - The column ID of the board_relation in the source item
 * @param targetBoardId - The board ID where linked items live
 * @param targetColumnId - The column ID to update on linked items
 * @param value - The new value (will be JSON stringified)
 * @param options.itemIndex - If provided, only update this specific linked item (0-indexed)
 */
export async function updateLinkedItemColumn(
  item: MondayItem,
  relationColumnId: string,
  targetBoardId: string,
  targetColumnId: string,
  value: unknown,
  options?: { itemIndex?: number }
): Promise<{ id: string }[]> {
  const linkedIds = getLinkedItemIds(item, relationColumnId);

  if (linkedIds.length === 0) {
    return [];
  }

  // Filter to specific index if provided
  const idsToUpdate =
    options?.itemIndex !== undefined
      ? [linkedIds[options.itemIndex]].filter((id): id is string => Boolean(id))
      : linkedIds;

  const results: { id: string }[] = [];

  for (const linkedItemId of idsToUpdate) {
    const result = await updateColumnValue(
      targetBoardId,
      linkedItemId,
      targetColumnId,
      value
    );
    results.push(result);
  }

  return results;
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

function findNextLabelIndex(column: MondayColumn): number {
  const labels = parseColumnLabels(column);
  const indices = Object.keys(labels)
    .map((k) => parseInt(k))
    .filter((n) => !isNaN(n));
  if (indices.length === 0) return 1;
  return Math.max(...indices) + 1;
}

async function addStatusLabels(
  boardId: string,
  columnId: string,
  column: MondayColumn,
  newLabels: string[]
): Promise<void> {
  let nextIndex = findNextLabelIndex(column);

  for (const label of newLabels) {
    const query = `
      mutation ($boardId: ID!, $columnId: String!, $value: String!) {
        change_column_metadata(
          board_id: $boardId
          column_id: $columnId
          column_property: labels
          value: $value
        ) {
          id
        }
      }
    `;

    const labelValue = JSON.stringify({ labels: { [nextIndex]: label } });
    await mondayRequest(query, {
      boardId,
      columnId,
      value: labelValue,
    });
    nextIndex++;
  }
}

export async function ensureLabelsExist(
  boardId: string,
  column: MondayColumn,
  requiredLabels: string[]
): Promise<void> {
  // Dropdown columns auto-create labels when setting values
  if (column.type === "dropdown") {
    console.log(`  Skipping "${column.title}" (dropdown) - labels auto-create on use`);
    return;
  }

  // Only handle status/color columns which require pre-created labels
  if (column.type !== "status" && column.type !== "color") {
    return;
  }

  const existingLabels = getExistingLabelNames(column);
  const missingLabels = requiredLabels.filter(
    (label) =>
      !existingLabels.some(
        (existing) => existing.toLowerCase() === label.toLowerCase()
      )
  );

  if (missingLabels.length === 0) {
    console.log(`  "${column.title}" - all labels exist`);
    return;
  }

  console.log(
    `  Adding missing labels to "${column.title}": ${missingLabels.join(", ")}`
  );
  await addStatusLabels(boardId, column.id, column, missingLabels);
}
