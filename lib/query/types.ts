// =============================================================================
// Query Layer Types
// =============================================================================

export interface ProfileSummary {
  localId: string;
  name: string;
  email: string | null;
  phone: string | null;
  priority: string | null;
  groupTitle: string | null;
  address: string | null;
  dateOfBirth: string | null;
  placeOfBirth: string | null;
  aNumber: string | null;
}

export interface ContractSummary {
  localId: string;
  caseType: string;
  status: string;
  value: number;
  contractId: string;
}

export interface BoardItemSummary {
  localId: string;
  boardKey: string;
  name: string;
  status: string | null;
  nextDate: string | null;
  attorney: string | null;
  groupTitle: string | null;
  columnValues: Record<string, unknown>;
}

export interface ClientUpdate {
  localId: string;
  profileLocalId: string;
  boardItemLocalId: string | null;
  boardKey: string | null;
  authorName: string;
  authorEmail: string | null;
  textBody: string;
  bodyHtml: string | null;
  sourceType: "update" | "reply";
  replyToUpdateId: string | null;
  createdAtSource: string;
}

export interface ClientCaseSummary {
  profile: ProfileSummary;
  contracts: {
    active: ContractSummary[];
    closed: ContractSummary[];
  };
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
export const CLOSED_CONTRACT_STATUSES = new Set([
  "Completed",
  "Cancelled",
  "Refunded",
  "Withdrawn",
]);

// Board keys that represent appointment boards
export const APPOINTMENT_BOARD_KEYS = new Set([
  "appointments_r",
  "appointments_m",
  "appointments_lb",
  "appointments_wh",
]);

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
}

export interface KpiCard {
  key: string;
  label: string;
  count: number;
  items: KpiItem[];
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
