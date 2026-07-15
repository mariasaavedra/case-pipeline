// =============================================================================
// Monday.com → SQLite column mapper
// =============================================================================
// Converts a Monday item's raw column_values into the JSON shape the query
// layer reads from `board_items.column_values` (and profiles/contracts
// raw_column_values). The shapes here MUST match what the seeder produces in
// libs/seed/src/factory/board-generators.ts, because the query layer extracts
// values with JSON paths like `$.status.label`, `$.target_date.date`,
// `$.type.labels`, and `$.paralegals.label`.
//
// This module is intentionally free of runtime imports from @case-pipeline/*
// packages (only type-only imports, which are erased at build time) so it can
// be unit-tested by the root vitest config without path-alias resolution.
// =============================================================================

import type { MondayColumnValue, MondayItem } from "@case-pipeline/monday";

/** A resolved column: the logical config key plus the live Monday id + type. */
export interface ResolvedColumnMeta {
  id: string;
  type: string;
}

// Mirrors NEXT_DATE_KEY in libs/seed/src/factory/board-item-factory.ts.
// Kept local (not imported) so this module stays alias-free for testing.
export const NEXT_DATE_KEY: Record<string, string> = {
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

/**
 * Shape a single Monday column value according to its column type, matching
 * the seeder's conventions. Returns `null` for empty values (caller skips them).
 */
export function shapeColumnValue(type: string, value: MondayColumnValue): unknown {
  const text = value.text ?? null;

  switch (type) {
    // Single-select → { label }
    case "status":
    case "color":
    case "people":
    case "multiple-person":
    case "person":
      return text ? { label: text } : null;

    // Multi-select → { labels: [...] } (Monday returns comma-separated text)
    case "dropdown":
    case "tags":
      if (!text) return null;
      return { labels: text.split(",").map((s) => s.trim()).filter(Boolean) };

    // Dates → { date } and optional { time } if Monday has a time set ("YYYY-MM-DD HH:MM")
    case "date":
    case "datetime": {
      if (!text) return null;
      const [date, time] = text.split(" ");
      return time ? { date, time } : { date };
    }

    // Relations → keep linked ids; profile resolution happens in a later pass
    case "board_relation":
    case "board-relation":
    case "dependency":
      if (value.linked_item_ids && value.linked_item_ids.length > 0) {
        return {
          linked_item_ids: value.linked_item_ids,
          display_value: value.display_value ?? text ?? null,
        };
      }
      return null;

    // Mirror/lookup columns expose their resolved text via display_value
    case "mirror":
    case "lookup":
      return value.display_value ?? text ?? null;

    // text, long_text, numbers, email, phone, etc. → raw string
    default:
      return text;
  }
}

/**
 * Build the `column_values` object for an item, keyed by logical config key.
 * Empty values are omitted so JSON stays compact and `json_extract` returns NULL.
 */
export function buildColumnValues(
  item: MondayItem,
  resolved: Record<string, ResolvedColumnMeta | undefined>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, col] of Object.entries(resolved)) {
    if (!col) continue;
    const cv = item.column_values.find((c) => c.id === col.id);
    if (!cv) continue;

    const shaped = shapeColumnValue(col.type, cv);
    if (shaped !== null && shaped !== undefined && shaped !== "") {
      out[key] = shaped;
    }
  }

  return out;
}

/** First-class board_items columns extracted from the shaped column_values. */
export interface BoardItemFields {
  status: string | null;
  nextDate: string | null;
  nextTime: string | null;
  attorney: string | null;
  paralegals: string | null;
}

/**
 * Extract the denormalized board_items columns the query layer indexes on,
 * mirroring BoardItemFactory.create().
 */
export function extractBoardItemFields(
  boardKey: string,
  columnValues: Record<string, unknown>,
): BoardItemFields {
  const label = (v: unknown): string | null =>
    v && typeof v === "object" && "label" in v
      ? ((v as { label?: string }).label ?? null)
      : null;

  // People columns come as { label } (single person) or { labels: [...] }
  // (multiple person). Join multiples with ", " so downstream code that splits
  // on commas (getActiveCases) sees every assignee.
  const people = (v: unknown): string | null => {
    if (v && typeof v === "object") {
      if ("labels" in v) {
        const arr = (v as { labels?: unknown[] }).labels;
        if (Array.isArray(arr) && arr.length) {
          return arr.filter((x) => typeof x === "string" && x.trim()).join(", ") || null;
        }
      }
      if ("label" in v) return (v as { label?: string }).label ?? null;
    }
    return null;
  };

  const status = label(columnValues.status);

  // All appointment boards share the same consult_date key; new boards inherit it.
  const dateKey = NEXT_DATE_KEY[boardKey] ?? (boardKey.startsWith("appointments_") ? "consult_date" : null);
  let nextDate: string | null = null;
  let nextTime: string | null = null;
  if (dateKey) {
    const dv = columnValues[dateKey];
    if (dv && typeof dv === "object" && "date" in dv) {
      nextDate = (dv as { date?: string; time?: string }).date ?? null;
      nextTime = (dv as { date?: string; time?: string }).time ?? null;
    }
  }

  return {
    status,
    nextDate,
    nextTime,
    // Config keys these people columns as `attorney` and `paralegal` (singular);
    // `columnValues.paralegals` was always undefined, so this column silently
    // stayed empty and broke the paralegal grouping in Active/My Cases.
    attorney: people(columnValues.attorney),
    paralegals: people(columnValues.paralegal ?? columnValues.paralegals),
  };
}

/**
 * Extract the first linked item id from a relation column's shaped value
 * (used to map a board item / contract back to its profile).
 */
export function firstLinkedId(shaped: unknown): string | null {
  if (
    shaped &&
    typeof shaped === "object" &&
    "linked_item_ids" in shaped &&
    Array.isArray((shaped as { linked_item_ids: unknown[] }).linked_item_ids)
  ) {
    const ids = (shaped as { linked_item_ids: string[] }).linked_item_ids;
    return ids[0] ?? null;
  }
  return null;
}
