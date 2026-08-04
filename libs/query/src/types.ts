// =============================================================================
// Query Layer Types
// =============================================================================

export interface ProfileSummary {
  localId: string;
  mondayItemId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  priority: string | null;
  groupTitle: string | null;
  address: string | null;
  dateOfBirth: string | null;
  placeOfBirth: string | null;
  aNumber: string | null;
  /**
   * SharePoint folder links from the e_file / consult columns.
   *
   * Optional on purpose: only the full client detail (getClientProfile) reads
   * raw_column_values to populate them. The appointments query builds a
   * lightweight ProfileSummary without that JSON blob, so there they are
   * `undefined` ("not loaded") rather than a misleading `null` ("no e-file").
   */
  eFile?: string | null;
  consultFile?: string | null;
}

/**
 * A contract's status as it matters for understanding the CASE, not the daily
 * Monday workflow. Derived from the Monday group (the reliable signal), not the
 * raw status label:
 *   completed          — contracting done (paid, e-file created). "Create Project".
 *   paid               — paid, e-file being opened.
 *   pending            — genuinely awaiting something (payment, review, signature).
 *   not_going_forward  — dead.
 *   other              — anything the groups don't cover.
 */
export type ContractStatusKey =
  | "completed"
  | "paid"
  | "pending"
  | "not_going_forward"
  | "other";

/** Badge tone; matches the web's StatusBadge color keys. */
export type StatusTone = "green" | "blue" | "yellow" | "red" | "gray" | "purple";

/** The case (Open Form / Court Case / …) a contract represents, resolved live. */
export interface ContractLinkedCase {
  boardKey: string;
  name: string;
  status: string | null;
}

export interface ContractSummary {
  localId: string;
  caseType: string | null;
  /** Raw Monday status, kept for reference. Prefer statusLabel for display. */
  status: string;
  /** Legacy seed-only column; never populated by the live sync. */
  value: number | null;
  contractId: string | null;
  /** Normalized case-status classification (drives active/closed + paid totals). */
  statusKey: ContractStatusKey;
  /** Human label for the case view — e.g. "Create Project" → "Completed". */
  statusLabel: string;
  tone: StatusTone;
  /** Annual fee paid, in dollars (parsed from Monday). Null when unset. */
  af: number | null;
  /** Processing fee paid, in dollars. Null when unset. */
  pf: number | null;
  /** What the contract becomes (it_will_go_to): "Open Forms", "Court Cases", … */
  goesTo: string | null;
  /** The actual linked case + its current status, or null when not linked. */
  linkedCase: ContractLinkedCase | null;
}

/** Roll-up of a client's contract payments. */
export interface ContractTotals {
  /** Sum of AF across contracts whose contracting is paid/completed. */
  afPaid: number;
  /** Sum of PF across paid/completed contracts. */
  pfPaid: number;
  /** afPaid + pfPaid. */
  totalPaid: number;
  /** How many contracts are counted as paid. */
  paidCount: number;
}

export interface ClientContracts {
  active: ContractSummary[];
  closed: ContractSummary[];
  totals: ContractTotals;
}

export interface BoardItemSummary {
  localId: string;
  boardKey: string;
  name: string;
  status: string | null;
  nextDate: string | null;
  nextTime: string | null;
  attorney: string | null;
  groupTitle: string | null;
  columnValues: Record<string, unknown>;
}

/**
 * A single entry in a profile's unified timeline. Covers both Monday.com
 * updates/replies and Emails & Activities (E&A) items (emails, notes, calls,
 * custom activities). `sourceType` is the discriminator used for filtering.
 */
export type TimelineSourceType = "update" | "reply" | "email" | "note" | "activity" | "custom";

/** One selectable value of a board's status column, with its native Monday color. */
export interface StatusColumnOption {
  index: number;
  label: string;
  color: string | null;
  border: string | null;
}

/** A board's status column definition — its Monday ids and colored options. */
export interface BoardStatusOptions {
  boardKey: string;
  mondayBoardId: string;
  statusColumnId: string;
  options: StatusColumnOption[];
}

/** One column in a board's schema — id, title, type, and choice options if any. */
export interface BoardColumn {
  columnId: string;
  title: string;
  /** Monday column type: status, dropdown, color, date, numbers, text, mirror, … */
  type: string;
  /** Selectable options for status/dropdown/color columns; empty otherwise. */
  options: StatusColumnOption[];
  position: number;
}

/** A board's full column schema. */
export interface BoardColumns {
  boardKey: string;
  mondayBoardId: string;
  columns: BoardColumn[];
}

/** A file attached to a Monday update. `url` opens the asset in Monday. */
export interface ClientUpdateAttachment {
  name: string;
  url: string;
  thumbnailUrl: string | null;
  fileExtension: string | null;
  fileSize: number | null;
}

export interface ClientUpdate {
  localId: string;
  profileLocalId: string;
  boardItemLocalId: string | null;
  boardKey: string | null;
  authorName: string;
  authorEmail: string | null;
  /** E&A email subject / activity title; null for updates and replies. */
  title: string | null;
  textBody: string;
  bodyHtml: string | null;
  sourceType: TimelineSourceType;
  /** E&A custom activity label (e.g. "Consult note"); null otherwise. */
  activityTypeName: string | null;
  replyToUpdateId: string | null;
  createdAtSource: string;
  /** Files attached to a Monday update; empty when none. */
  attachments: ClientUpdateAttachment[];
}

export interface ClientCaseSummary {
  profile: ProfileSummary;
  contracts: ClientContracts;
  boardItems: Record<string, BoardItemSummary[]>;
  appointments: BoardItemSummary[];
  updates: ClientUpdate[];
  courtLinkedItemIds: string[];
}

export interface SearchResult {
  localId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

// =============================================================================
// Typed Search Types (cross-entity search)
// =============================================================================

export type SearchType =
  | "profiles"
  | "contracts"
  | "court_cases"
  | "open_forms"
  | "motions"
  | "appeals"
  | "foias"
  | "litigation"
  | "i918bs"
  | "rfes";

export interface TypedSearchResult {
  type: SearchType;
  localId: string;
  name: string;
  status: string | null;
  clientName: string | null;
  clientLocalId: string | null;
  boardKey: string | null;
  caseType: string | null;
}

// Contract statuses considered "closed"
//
// DEPRECATED for live data: these labels do not exist in the real Monday
// workspace (the real terminal statuses are "Create Project", "Not going
// forward", etc.), so this set never matched and left completed contracts
// showing as active. normalizeContractStatus() below is the live-data path;
// this stays only for the Faker seed generator, which emits these labels.
export const CLOSED_CONTRACT_STATUSES = new Set([
  "Completed",
  "Cancelled",
  "Refunded",
  "Withdrawn",
]);

// ---- Contract status translation (case view) -------------------------------
//
// The Monday group is the reliable classifier; the raw status label is for the
// daily workflow and often means little for "where is this case". This layer
// maps both into a case-oriented status. Domain staff can tune the labels/tones
// in CONTRACT_STATUS_LABELS without touching the classification logic.

/** Curated per-status display overrides. Falls back to a group-derived label. */
export const CONTRACT_STATUS_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  "Create Project": { label: "Completed", tone: "green" },
  "E-File opened": { label: "Paid · E-file open", tone: "green" },
  "Open E-File": { label: "Paid · opening e-file", tone: "blue" },
  "Payment link sent": { label: "Awaiting payment", tone: "yellow" },
  "Sent to Client": { label: "Sent to client", tone: "yellow" },
  "Client coming to the office": { label: "Client coming in", tone: "yellow" },
  "Atty Reviewing": { label: "Attorney reviewing", tone: "yellow" },
  HOLD: { label: "On hold", tone: "yellow" },
  "Needs to be sent": { label: "Needs to be sent", tone: "yellow" },
  "Needs to be Amended": { label: "Needs amendment", tone: "yellow" },
  "Not going forward": { label: "Not going forward", tone: "gray" },
  "Needs Refund": { label: "Needs refund", tone: "red" },
  "Paralegal to be assigned": { label: "Awaiting paralegal", tone: "yellow" },
};

const GROUP_DEFAULTS: Record<ContractStatusKey, { label: string; tone: StatusTone }> = {
  completed: { label: "Completed", tone: "green" },
  paid: { label: "Paid", tone: "blue" },
  pending: { label: "Pending", tone: "yellow" },
  not_going_forward: { label: "Not going forward", tone: "gray" },
  other: { label: "—", tone: "gray" },
};

/** Classify a contract by its Monday group (the reliable signal). */
export function contractStatusKey(groupTitle: string | null): ContractStatusKey {
  const g = (groupTitle ?? "").toLowerCase();
  if (g.includes("closed")) return "completed";
  if (g.includes("paid") || g.includes("waiver")) return "paid";
  if (g.includes("pending")) return "pending";
  if (g.includes("not going forward")) return "not_going_forward";
  return "other";
}

/** True when the contracting was settled — counts toward paid totals. */
export function isContractPaid(key: ContractStatusKey): boolean {
  return key === "completed" || key === "paid";
}

/**
 * Translate a contract's (group, raw status) into a case-oriented status.
 * The KEY comes from the group; the label/tone prefer a curated override for the
 * specific status, else the group's default.
 */
export function normalizeContractStatus(
  groupTitle: string | null,
  rawStatus: string | null,
): { key: ContractStatusKey; label: string; tone: StatusTone } {
  const key = contractStatusKey(groupTitle);
  const override = rawStatus ? CONTRACT_STATUS_LABELS[rawStatus] : undefined;
  const base = GROUP_DEFAULTS[key];
  return {
    key,
    label: override?.label ?? (key === "other" ? (rawStatus ?? "—") : base.label),
    tone: override?.tone ?? base.tone,
  };
}

// Board keys that represent appointment boards
export const APPOINTMENT_BOARD_KEYS = new Set([
  "appointments_r",
  "appointments_m",
  "appointments_lb",
  "appointments_wh",
]);

// Board keys whose timeline entries read as documents on the client timeline.
export const DOCUMENT_BOARD_KEYS = new Set([
  "rfes_all",
  "_na_originals_cards_notices",
  "nvc_notices",
  "address_changes",
]);

// Board keys whose timeline entries read as official notices / RFEs.
export const NOTICE_BOARD_KEYS = new Set([
  "rfes_all",
  "nvc_notices",
  "_na_originals_cards_notices",
]);

// Timeline filter categories, mirrored between the web chips and the server
// query so a filtered view is complete (not just the newest page filtered).
export type TimelineCategory =
  | "all"
  | "notes"
  | "emails"
  | "activities"
  | "documents"
  | "notices"
  | "appointments";

// Contract statuses considered "paid" (needs action)
export const PAID_CONTRACT_STATUSES = new Set([
  "Paid Needs Action",
  "E-File opened",
  "Create Project",
]);

// =============================================================================
// Dashboard KPI Types
// =============================================================================

export interface KpiItem {
  localId: string;
  name: string;
  date: string | null;
  clientName: string | null;
  clientLocalId: string | null;
  boardKey: string | null;
  status: string | null;
  /**
   * Raw Monday value of the card's configured display column (see KpiCard.columnId).
   * Still in Monday's shaped form — `{ label }`, `{ labels: [] }`, `{ date, time }`
   * or a plain string — because formatting belongs to the client. Null when the
   * card has no column configured or this row has no value for it.
   */
  columnValue: unknown;
}

export interface KpiCard {
  key: string;
  label: string;
  count: number;
  /**
   * The board column surfaced on this card's rows, resolved per request from the
   * viewer's preference falling back to the firm-wide default. Null = none set.
   */
  columnId: string | null;
  columnLabel: string | null;
  items: KpiItem[];
}

/** A column a KPI card can be configured to display. */
export interface KpiColumnOption {
  id: string;
  label: string;
  /** How many rows on this card actually carry a value — helps pick a useful column. */
  populatedCount: number;
}

export interface KpiDetailItem extends KpiItem {
  /** Every shaped Monday column on the row, so the client can re-pick instantly. */
  columnValues: Record<string, unknown>;
}

/** The full row set behind one KPI card, for the dashboard's click-through modal. */
export interface KpiCardDetail {
  key: string;
  label: string;
  count: number;
  columnId: string | null;
  columnLabel: string | null;
  columns: KpiColumnOption[];
  items: KpiDetailItem[];
}

// Board item statuses considered closed (not alertable)
export const CLOSED_BOARD_ITEM_STATUSES = new Set([
  "Done",
  "Completed",
  "Closed",
  "Cancelled",
  "Withdrawn",
]);

// =============================================================================
// Alert Types
// =============================================================================

export type AlertSeverity = "critical" | "warning" | "info";

export interface AlertItem {
  localId: string;
  name: string;
  boardKey: string | null;
  status: string | null;
  clientName: string | null;
  clientLocalId: string | null;
  attorney: string | null;
  date: string | null;
  daysOverdue?: number;
  daysSinceUpdate?: number;
  caseType?: string;
}

export interface AlertGroup {
  severity: AlertSeverity;
  label: string;
  description: string;
  count: number;
  items: AlertItem[];
}

export interface AlertsResult {
  groups: AlertGroup[];
  totalCount: number;
  attorneys: string[];
}

// Board display names for readable output
export const BOARD_DISPLAY_NAMES: Record<string, string> = {
  court_cases: "Court Cases",
  _cd_open_forms: "Open Forms",
  motions: "Motions",
  appeals: "Appeals",
  foias: "FOIAs",
  litigation: "Litigation",
  _lt_i918b_s: "I-918B",
  address_changes: "Address Changes",
  nvc_notices: "NVC Notices",
  _na_originals_cards_notices: "Originals/Cards/Notices",
  rfes_all: "RFEs",
  _fa_jail_intakes: "Jail Intakes",
  appointments_r: "Appointments (R)",
  appointments_m: "Appointments (M)",
  appointments_lb: "Appointments (LB)",
  appointments_wh: "Appointments (WH)",
};
