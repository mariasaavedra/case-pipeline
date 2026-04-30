// =============================================================================
// Dashboard Display Configuration
// =============================================================================
// Edit this file to control which boards appear, in what order, and how
// statuses are colored. No React code changes needed.

export interface BoardDisplayConfig {
  key: string;
  label: string;
  section: "cases" | "mail" | "admin";
}

export const BOARD_CONFIG: BoardDisplayConfig[] = [
  // Active cases
  { key: "court_cases",                 label: "Court Cases",              section: "cases" },
  { key: "_cd_open_forms",              label: "Open Forms",               section: "cases" },
  { key: "motions",                     label: "Motions",                  section: "cases" },
  { key: "appeals",                     label: "Appeals",                  section: "cases" },
  { key: "foias",                       label: "FOIAs",                    section: "cases" },
  { key: "litigation",                  label: "Litigation",               section: "cases" },
  { key: "_lt_i918b_s",                 label: "I-918B",                   section: "cases" },
  // Mail & documents
  { key: "rfes_all",                    label: "RFEs",                     section: "mail" },
  { key: "_na_originals_cards_notices",  label: "Originals/Cards/Notices",  section: "mail" },
  { key: "nvc_notices",                  label: "NVC Notices",              section: "mail" },
  { key: "address_changes",             label: "Address Changes",          section: "mail" },
  // Admin
  { key: "_fa_jail_intakes",            label: "Jail Intakes",             section: "admin" },
];

export const SECTION_LABELS: Record<string, string> = {
  cases: "Active Cases",
  mail: "Mail & Documents",
  admin: "Administrative",
};

export const SECTIONS = ["cases", "mail", "admin"] as const;

const STATUS_COLORS: Record<string, string> = {
  // Active / positive
  "Active": "green",
  "Signed": "green",
  "Approved": "green",
  "Granted": "green",
  "Atty Approved": "green",
  "Filed": "blue",
  "Set for Hearing": "blue",
  "In Progress": "blue",
  "Submitted": "blue",
  "Sent": "blue",
  // Waiting
  "Pending": "yellow",
  "Waiting": "yellow",
  "Payment link sent": "yellow",
  "Create Project": "yellow",
  "Forms Appt Scheduled": "yellow",
  // Attention
  "Urgent": "red",
  "Overdue": "red",
  "RFE Received": "red",
  "Denied": "red",
  "Received": "red",
  // Closed
  "Completed": "gray",
  "Cancelled": "gray",
  "Withdrawn": "gray",
  "Refunded": "gray",
  "No Action Needed": "gray",
};

export function getStatusColor(status: string | null): string {
  if (!status) return "gray";
  return STATUS_COLORS[status] ?? "blue";
}

const PRIORITY_COLORS: Record<string, string> = {
  High: "red",
  Medium: "yellow",
  Low: "green",
};

export function getPriorityColor(priority: string | null): string {
  if (!priority) return "gray";
  return PRIORITY_COLORS[priority] ?? "gray";
}

/** Board keys shown in the Documents & Notices tab */
export const DOCUMENT_BOARD_KEYS = new Set([
  "rfes_all",
  "_na_originals_cards_notices",
  "nvc_notices",
  "address_changes",
]);
