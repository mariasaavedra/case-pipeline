// =============================================================================
// Monday column value → display string
// =============================================================================
// The API hands back column values in the shape the sync stored them (see
// scripts/sync/mapper.ts: `{ label }`, `{ labels: [] }`, `{ date, time }`,
// `{ linked_item_ids, display_value }`, or a bare string/number). Formatting
// lives here rather than server-side so the dashboard can re-render instantly
// when the user picks a different column, with no extra round-trip.
// =============================================================================

export function formatColumnValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatColumnValue).filter(Boolean).join(", ");

  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.label === "string") return o.label;
    if (Array.isArray(o.labels)) return o.labels.filter((l) => typeof l === "string").join(", ");
    if (typeof o.date === "string") {
      return typeof o.time === "string" ? `${o.date} ${o.time.slice(0, 5)}` : o.date;
    }
    if (typeof o.display_value === "string") return o.display_value;
  }
  return "";
}

/**
 * True when the value came from a status-like column, i.e. one worth rendering
 * as a badge rather than plain text.
 */
export function isLabelValue(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).label === "string"
  );
}
