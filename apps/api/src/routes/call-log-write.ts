// =============================================================================
// Call Log write — request parsing, validation, and payload construction
// =============================================================================
// Extracted from server.ts's POST /api/call-log purely to create a test seam.
// Everything here is a pure function of its arguments: no Express, no database,
// no clock, no Monday.com client. The route still owns all the I/O — reading
// the schema, the Monday mutations, the local mirror insert, the audit entry.
//
// The point of the split is that the risky part of logging a call is not the
// I/O, it's the decisions: which status label is legal, which Monday column id
// a field maps to, and what the locally mirrored row must look like so the next
// sync reads it back unchanged. Those had no coverage at all, and getting them
// wrong writes bad data into a law firm's real client records.
// =============================================================================

import type { BoardColumns, BoardColumn, BoardStatusOptions } from "@case-pipeline/query";
import type { UpdateMention } from "@case-pipeline/monday";
import { parseMentions } from "./note-write.js";

/** The request body, after coercion. Strings are trimmed; ids are numbers. */
export interface ParsedCallLogBody {
  name: string;
  note: string;
  phone: string;
  language: string;
  requestedStatus: string;
  profileLocalId: string | null;
  takenByUserId: number | null;
  highlightedForUserId: number | null;
  noteMentions: UpdateMention[];
}

/** A refusal the route turns straight into a JSON error response. */
export interface CallLogRejection {
  status: number;
  error: string;
  allowed?: string[];
}

/**
 * Coerce an untrusted JSON body into known shapes. Deliberately total — it
 * never throws and never rejects; emptiness is a validation concern, handled
 * by validateCallLogBody so a caller can parse once and validate against a
 * schema it may still be loading.
 */
export function parseCallLogBody(raw: unknown): ParsedCallLogBody {
  const body = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (v ?? "").toString().trim();

  // Monday person ids arrive as either "12345" (form value) or 12345 (JSON).
  // Anything non-numeric is dropped rather than sent on as NaN, which Monday
  // would reject for the whole mutation.
  const toId = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    name: str(body.name),
    note: str(body.note),
    phone: str(body.phone),
    language: str(body.language),
    requestedStatus: str(body.status),
    profileLocalId: body.profileLocalId ? String(body.profileLocalId) : null,
    takenByUserId: toId(body.takenByUserId),
    highlightedForUserId: toId(body.highlightedForUserId),
    noteMentions: parseMentions(body.mentionedUserIds),
  };
}

/** Find a column by its Monday title, case- and whitespace-insensitively. */
export function columnByTitle(schema: BoardColumns, title: string): BoardColumn | undefined {
  return schema.columns.find((c) => c.title.trim().toLowerCase() === title.trim().toLowerCase());
}

/**
 * Resolve the status label to write: the caller's choice if they made a legal
 * one, else "Pending", else whatever the board lists first. Returns a rejection
 * when the caller named a label the board does not have — Monday is called with
 * create_labels_if_missing:false, so an unknown label fails the mutation
 * permanently rather than degrading.
 */
export function resolveCallLogStatus(
  requestedStatus: string,
  statusDef: BoardStatusOptions | null,
): { status: string | null } | { rejection: CallLogRejection } {
  if (requestedStatus && statusDef && !statusDef.options.some((o) => o.label === requestedStatus)) {
    return {
      rejection: {
        status: 400,
        error: "status is not a valid option",
        allowed: statusDef.options.map((o) => o.label),
      },
    };
  }
  return {
    status:
      requestedStatus ||
      statusDef?.options.find((o) => o.label.toLowerCase() === "pending")?.label ||
      statusDef?.options[0]?.label ||
      null,
  };
}

/**
 * Same contract as status, for the Language column. The web modal ships a
 * hardcoded option list that can drift from Monday's real labels, so the
 * synced schema — not the client — is the authority.
 *
 * A Language column with no synced options is treated as "unknown, allow it":
 * refusing there would block call logging entirely whenever the schema is
 * partially synced, which is worse than sending a label Monday may reject.
 */
export function validateCallLogLanguage(
  language: string,
  languageCol: BoardColumn | undefined,
): CallLogRejection | null {
  if (!language || !languageCol || languageCol.options.length === 0) return null;
  if (languageCol.options.some((o) => o.label === language)) return null;
  return {
    status: 400,
    error: "language is not a valid option",
    allowed: languageCol.options.map((o) => o.label),
  };
}

/** Validate what can be judged without the board schema. */
export function validateCallLogBody(parsed: ParsedCallLogBody): CallLogRejection | null {
  if (!parsed.name) return { status: 400, error: "name is required" };
  return null;
}

/**
 * Build the `column_values` for Monday's create_item mutation, keyed by real
 * Monday column id. A column absent from the synced schema is skipped rather
 * than guessed — sending an unknown column id fails the whole mutation.
 */
export function buildCallLogColumnValues(args: {
  schema: BoardColumns;
  parsed: ParsedCallLogBody;
  status: string | null;
  today: string;
  profileMondayItemId: string | null;
}): Record<string, unknown> {
  const { schema, parsed, status, today, profileMondayItemId } = args;
  const col = (t: string) => columnByTitle(schema, t);
  const out: Record<string, unknown> = {};

  const phoneCol = col("Phone");
  const statusCol = col("Status");
  const dateCol = col("Date");
  const languageCol = col("Language");
  const takenByCol = col("Taken by");
  const highlightedForCol = col("Highlighted For");
  const profileCol = col("link to Profiles");

  if (phoneCol && parsed.phone) out[phoneCol.columnId] = parsed.phone;
  if (statusCol && status) out[statusCol.columnId] = { label: status };
  if (dateCol) out[dateCol.columnId] = today;
  if (languageCol && parsed.language) out[languageCol.columnId] = { label: parsed.language };
  if (takenByCol && parsed.takenByUserId) {
    out[takenByCol.columnId] = { personsAndTeams: [{ id: parsed.takenByUserId, kind: "person" }] };
  }
  if (highlightedForCol && parsed.highlightedForUserId) {
    out[highlightedForCol.columnId] = { personsAndTeams: [{ id: parsed.highlightedForUserId, kind: "person" }] };
  }
  if (profileCol && profileMondayItemId) {
    out[profileCol.columnId] = { item_ids: [Number(profileMondayItemId)] };
  }
  return out;
}

/**
 * Build the LOCAL mirror of the row, keyed by the logical config keys from
 * config/boards.yaml — NOT Monday's column ids. This must match what
 * scripts/sync/mapper.ts's shapeColumnValue() would have produced, so the row
 * this write inserts reads back identically to one the next sync writes. A
 * drift here shows up as a call that renders fine today and changes shape
 * after the nightly sync.
 */
export function buildMirroredColumnValues(args: {
  parsed: ParsedCallLogBody;
  status: string | null;
  today: string;
  nowTime: string;
  lastUpdated: string;
  takenByName: string | null;
  highlightedForName: string | null;
}): Record<string, unknown> {
  const { parsed, status, today, nowTime, lastUpdated, takenByName, highlightedForName } = args;
  return {
    ...(parsed.phone ? { phone: parsed.phone } : {}),
    ...(status ? { status: { label: status } } : {}),
    date: { date: today },
    hour: nowTime,
    ...(parsed.language ? { language: { label: parsed.language } } : {}),
    ...(takenByName ? { taken_by: { label: takenByName } } : {}),
    ...(highlightedForName ? { highlighted_for: { label: highlightedForName } } : {}),
    last_updated: lastUpdated,
  };
}
