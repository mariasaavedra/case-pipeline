// =============================================================================
// Query Layer Types
// =============================================================================

export interface ProfileSummary {
  localId: string;
  name: string;
  email: string | null;
  phone: string | null;
  priority: string | null;
  address: string | null;
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

export interface ClientCaseSummary {
  profile: ProfileSummary;
  contracts: {
    active: ContractSummary[];
    closed: ContractSummary[];
  };
  boardItems: Record<string, BoardItemSummary[]>;
  appointments: BoardItemSummary[];
}

export interface SearchResult {
  localId: string;
  name: string;
  email: string | null;
  phone: string | null;
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
