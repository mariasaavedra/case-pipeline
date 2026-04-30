// =============================================================================
// Constants for Monday.com seeding
// =============================================================================
// Status labels and distributions derived from production snapshot (2026-02-16)

import { loadBoardsConfig } from "../../../lib/config";

// =============================================================================
// Board IDs - loaded from config/boards.yaml
// =============================================================================

export interface BoardIds {
  profilesBoardId: string;
  feeKsBoardId: string;
}

export async function loadBoardIds(): Promise<BoardIds> {
  const boards = await loadBoardsConfig();
  const profilesBoard = boards.profiles;
  const feeKsBoard = boards.fee_ks;

  if (!profilesBoard) {
    throw new Error("Missing 'profiles' board configuration in config/boards.yaml");
  }
  if (!feeKsBoard) {
    throw new Error("Missing 'fee_ks' board configuration in config/boards.yaml");
  }

  return {
    profilesBoardId: profilesBoard.id,
    feeKsBoardId: feeKsBoard.id,
  };
}

// =============================================================================
// Name generation data
// =============================================================================

export const FIRST_NAMES = [
  "James", "Maria", "Robert", "Linda", "Michael", "Barbara", "William", "Elizabeth",
  "David", "Jennifer", "Carlos", "Patricia", "Jose", "Susan", "Ahmed", "Sarah",
  "Wei", "Karen", "Raj", "Nancy", "Yuki", "Lisa", "Omar", "Margaret", "Ivan", "Rafael"
];

export const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson"
];

export const EMAIL_DOMAINS = [
  "gmail.com", "yahoo.com", "outlook.com", "company.com", "business.org"
];

// =============================================================================
// Case Fee Schedule (from firm fee schedule)
// =============================================================================

export interface CaseFee {
  caseType: string;
  fee: number;
}

export const CASE_FEE_SCHEDULE: CaseFee[] = [
  // Address Changes
  { caseType: "Address Change (Immig Court)", fee: 25 },
  { caseType: "Address Change (U/T/VAWA/751)", fee: 25 },
  { caseType: "USCIS Address Change", fee: 25 },
  { caseType: "BIA Address Change", fee: 25 },

  // Affidavits & Appeals
  { caseType: "Affidavit", fee: 750 },
  { caseType: "BIA Appeal", fee: 5000 },
  { caseType: "Case Status Update", fee: 500 },
  { caseType: "Circuit Appeal", fee: 7500 },

  // Consular & Criminal
  { caseType: "Consular Processing", fee: 4000 },
  { caseType: "Criminal Consequence Letter", fee: 500 },

  // DACA
  { caseType: "DACA Renewal (not client)", fee: 800 },
  { caseType: "DACA Renewal (client)", fee: 800 },
  { caseType: "DACA Initial", fee: 3000 },
  { caseType: "Deferred Action (non DACA)", fee: 1000 },

  // DS-160 / EOIR
  { caseType: "DS-160 (NVC)", fee: 1500 },
  { caseType: "EOIR 42A (emergency)", fee: 3500 },
  { caseType: "EOIR 42A (non emergency)", fee: 2000 },
  { caseType: "EOIR 42B (emergency)", fee: 3500 },
  { caseType: "EOIR 42B (non emergency)", fee: 2000 },

  // Extensions & Misc
  { caseType: "EAD Extension Letters", fee: 25 },
  { caseType: "Extension I-539", fee: 800 },
  { caseType: "File Copy", fee: 50 },
  { caseType: "Fingerprints Only", fee: 25 },

  // FOIA
  { caseType: "FOIA (EOIR)", fee: 600 },
  { caseType: "FOIA (G639)", fee: 600 },
  { caseType: "FOIA (OBIM + FBI)", fee: 750 },

  // Full Packets
  { caseType: "Full Packet w/ Travel Doc", fee: 4000 },
  { caseType: "Full Packet", fee: 4000 },
  { caseType: "Full Packet (complex)", fee: 4500 },
  { caseType: "Full Packet (needs J5)", fee: 4300 },
  { caseType: "Full Packet (in proceedings)", fee: 4000 },
  { caseType: "Full Packet 245i (I-485A)", fee: 4300 },
  { caseType: "Full Packet (child under 14)", fee: 4000 },

  // I-129F
  { caseType: "I-129F (K-1)", fee: 3500 },
  { caseType: "I-129F (K-3)", fee: 3000 },

  // I-130
  { caseType: "I-130 (Online)", fee: 3000 },
  { caseType: "I-130 (Paper)", fee: 3000 },

  // I-131
  { caseType: "I-131", fee: 1000 },
  { caseType: "I-131 Re-entry Permit", fee: 900 },
  { caseType: "I-131 Travel Doc (Refugee)", fee: 900 },
  { caseType: "I-131 Travel Doc (Asylee/LPR)", fee: 900 },
  { caseType: "I-131 Advance Parole", fee: 1000 },
  { caseType: "I-131F Family/PP", fee: 3000 },
  { caseType: "I-131 PP (Military)", fee: 2500 },

  // I-539 / I-192 / I-212
  { caseType: "I-539 (Multi Status Change)", fee: 1000 },
  { caseType: "I-539 (Status Change)", fee: 1500 },
  { caseType: "I-192 (not U/T visa)", fee: 3500 },
  { caseType: "I-212", fee: 4000 },
  { caseType: "I-212 (form only)", fee: 1000 },
  { caseType: "I-290B", fee: 4800 },

  // I-485
  { caseType: "I-485 (Family Based)", fee: 3800 },
  { caseType: "I-485 (Adjustment in Court)", fee: 4500 },
  { caseType: "I-485 (Refugee/SIJ)", fee: 2800 },
  { caseType: "I-485 (Asylum)", fee: 2800 },
  { caseType: "I-485 (child under 14)", fee: 3800 },
  { caseType: "I-485 (U-Visa)", fee: 4000 },

  // I-589 / I-601
  { caseType: "I-589 (Asylum)", fee: 4000 },
  { caseType: "I-601", fee: 4000 },
  { caseType: "I-601 (EOIR)", fee: 5000 },
  { caseType: "I-601A Waiver", fee: 6000 },

  // I-730 / I-751
  { caseType: "I-730", fee: 3000 },
  { caseType: "I-751 (Removal of Conditions)", fee: 4000 },

  // I-765
  { caseType: "I-765 (online c08+c11)", fee: 800 },
  { caseType: "I-765 (c09, paid FF)", fee: 800 },
  { caseType: "I-765 (U visa c14/SIJ)", fee: 800 },
  { caseType: "I-765", fee: 800 },

  // I-824 / I-864 / I-881
  { caseType: "I-824", fee: 800 },
  { caseType: "I-864 (Affidavit of Support)", fee: 1500 },
  { caseType: "I-881", fee: 3000 },
  { caseType: "I-881 (EOIR)", fee: 8000 },

  // I-90 / I-944
  { caseType: "I-90", fee: 1000 },
  { caseType: "I-944 (or similar)", fee: 500 },

  // I-914 / I-918
  { caseType: "I-914/I-192 (T-Visa)", fee: 4500 },
  { caseType: "I-918/I-192 (U-Visa)", fee: 4500 },
  { caseType: "I-918/I-192 (U-Visa Complex)", fee: 6000 },
  { caseType: "I-918B", fee: 600 },
  { caseType: "I-929", fee: 3000 },

  // Infopass / Interviews
  { caseType: "Infopass (not our client)", fee: 500 },
  { caseType: "Interview (KC complex)", fee: 2000 },
  { caseType: "Interview (KC only)", fee: 900 },
  { caseType: "Interview (not our forms)", fee: 2800 },
  { caseType: "Interview (out of town)", fee: 2500 },
  { caseType: "Interview Prep", fee: 750 },
  { caseType: "Investigation Fee", fee: 750 },

  // Background Checks
  { caseType: "KBI Criminal History Check", fee: 35 },
  { caseType: "Lexis Criminal History Check", fee: 150 },
  { caseType: "Missouri Criminal History Check", fee: 25 },

  // Mandamus / Master Hearing
  { caseType: "Mandamus", fee: 7500 },
  { caseType: "Master Hearing", fee: 850 },
  { caseType: "Master Hearing (late hire)", fee: 1500 },
  { caseType: "Mendez-Rojas Motion", fee: 1500 },

  // Motions
  { caseType: "Motion to Consolidate", fee: 1500 },
  { caseType: "Motion to Admin Close", fee: 1500 },
  { caseType: "Motion to Reopen/Terminate", fee: 2000 },
  { caseType: "Motion for Bond (emergency)", fee: 5000 },
  { caseType: "Motion for Bond (non emergency)", fee: 3500 },
  { caseType: "Motion to Change Venue", fee: 3000 },
  { caseType: "Motion to Continue Master", fee: 1000 },
  { caseType: "Motion for VD for Crp", fee: 1000 },
  { caseType: "Motion to Set for Trial", fee: 1800 },
  { caseType: "Motion to Re-Open In-Absentia", fee: 5000 },

  // N-400 / N-600
  { caseType: "N-400", fee: 3000 },
  { caseType: "N-600 (complex)", fee: 4000 },
  { caseType: "N-600 (simple)", fee: 2500 },

  // NOID
  { caseType: "NOID (messy case)", fee: 4500 },
  { caseType: "NOID (simple)", fee: 3500 },

  // Misc Services
  { caseType: "NRC FOIA", fee: 800 },
  { caseType: "Office Visit", fee: 125 },
  { caseType: "Ombudsman Inquiry", fee: 800 },
  { caseType: "Oral Argument", fee: 3000 },
  { caseType: "PD Requests (Immig Court)", fee: 2000 },
  { caseType: "Postage (FedEx)", fee: 100 },
  { caseType: "Request to Schedule USCIS", fee: 800 },

  // RFE
  { caseType: "RFE (not our forms)", fee: 1500 },
  { caseType: "RFE", fee: 800 },
  { caseType: "RFE for U Visas", fee: 1500 },

  // SIJ / TPS
  { caseType: "SIJ (I-360)", fee: 1500 },
  { caseType: "TPS (initial/late initial)", fee: 2500 },
  { caseType: "TPS (EOIR)", fee: 1500 },
  { caseType: "TPS (renewal)", fee: 1000 },

  // Translations
  { caseType: "Translations (complex)", fee: 50 },
  { caseType: "Translations (simple)", fee: 20 },

  // Trial
  { caseType: "Trial", fee: 4500 },
  { caseType: "Trial Briefs (complex)", fee: 4800 },
  { caseType: "Trial Briefs/Motion to Terminate", fee: 4000 },
  { caseType: "Trial Prep", fee: 3500 },

  // VAWA
  { caseType: "VAWA (I-360)", fee: 3000 },
  { caseType: "VAWA Full Packet (I-360+I-485)", fee: 4000 },
];

// Derived arrays
export const CASE_TYPES = CASE_FEE_SCHEDULE.map((c) => c.caseType);
export const CONTRACT_VALUES = [...new Set(CASE_FEE_SCHEDULE.map((c) => c.fee))].sort((a, b) => a - b);

export const PRIORITIES = ["High", "Medium", "Low", "No priority"];

export const SAMPLE_NOTES = [
  "Initial consultation completed. Client is responsive and engaged.",
  "Awaiting documentation from client. Follow up scheduled.",
  "Case review in progress. Strong documentation provided.",
  "Client requested expedited timeline. Prioritizing accordingly.",
  "All paperwork received. Moving to next phase.",
  "Meeting scheduled to discuss strategy and next steps.",
  "Client has questions about timeline. Need to clarify expectations.",
];

// Default configuration
export const DEFAULT_CONFIG = {
  profileCount: 5,
  contractsPerProfile: { min: 1, max: 3 },
};

// =============================================================================
// Board Routing — Case Type → Board Destination
// =============================================================================
// Derived from Fee K "It will go to..." column in production snapshot.
// Court Cases = EOIR immigration court MONITORING only.
// Court-related FORMS (42A/B, I-589, etc.) go to Open Forms → "Court Forms" group.
// Motions go to Motions board only (they link to existing court cases, don't create new ones).

export interface BoardDestination {
  board: string;
  group?: string;
}

export const CASE_TYPE_BOARD_MAP: Record<string, BoardDestination[]> = {
  // ── Court Cases (EOIR immigration court monitoring) ──────────────────────
  "Master Hearing": [{ board: "court_cases" }],
  "Master Hearing (late hire)": [{ board: "court_cases" }],
  "Trial": [{ board: "court_cases" }],
  "Trial Prep": [{ board: "court_cases" }],
  "Trial Briefs (complex)": [{ board: "court_cases" }],
  "Trial Briefs/Motion to Terminate": [{ board: "court_cases" }],
  "Oral Argument": [{ board: "court_cases" }],
  "PD Requests (Immig Court)": [{ board: "court_cases" }],

  // ── Motions (standalone — link to existing court case, don't create one) ─
  "Motion to Consolidate": [{ board: "motions" }],
  "Motion to Admin Close": [{ board: "motions" }],
  "Motion to Reopen/Terminate": [{ board: "motions" }],
  "Motion for Bond (emergency)": [{ board: "motions" }],
  "Motion for Bond (non emergency)": [{ board: "motions" }],
  "Motion to Change Venue": [{ board: "motions" }],
  "Motion to Continue Master": [{ board: "motions" }],
  "Motion for VD for Crp": [{ board: "motions" }],
  "Motion to Set for Trial": [{ board: "motions" }],
  "Motion to Re-Open In-Absentia": [{ board: "motions" }],
  "Mendez-Rojas Motion": [{ board: "motions" }],

  // ── Open Forms → Court Forms group (forms filed in immigration court) ────
  "EOIR 42A (emergency)": [{ board: "_cd_open_forms", group: "Court Forms" }],
  "EOIR 42A (non emergency)": [{ board: "_cd_open_forms", group: "Court Forms" }],
  "EOIR 42B (emergency)": [{ board: "_cd_open_forms", group: "Court Forms" }],
  "EOIR 42B (non emergency)": [{ board: "_cd_open_forms", group: "Court Forms" }],
  "I-589 (Asylum)": [{ board: "_cd_open_forms", group: "Court Forms" }],
  "I-601 (EOIR)": [{ board: "_cd_open_forms", group: "Court Forms" }],
  "I-881 (EOIR)": [{ board: "_cd_open_forms", group: "Court Forms" }],
  "TPS (EOIR)": [{ board: "_cd_open_forms", group: "Court Forms" }],
  "I-485 (Adjustment in Court)": [{ board: "_cd_open_forms", group: "Court Forms" }],
  "Full Packet (in proceedings)": [{ board: "_cd_open_forms", group: "Court Forms" }],

  // ── Open Forms → Open Forms group (USCIS / NVC track) ───────────────────
  "Full Packet w/ Travel Doc": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "Full Packet": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "Full Packet (complex)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "Full Packet (needs J5)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "Full Packet 245i (I-485A)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "Full Packet (child under 14)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-129F (K-1)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-129F (K-3)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-130 (Online)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-130 (Paper)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-131": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-131 Re-entry Permit": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-131 Travel Doc (Refugee)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-131 Travel Doc (Asylee/LPR)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-131 Advance Parole": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-131F Family/PP": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-131 PP (Military)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-539 (Multi Status Change)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-539 (Status Change)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-192 (not U/T visa)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-212": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-212 (form only)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-290B": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-485 (Family Based)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-485 (Refugee/SIJ)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-485 (Asylum)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-485 (child under 14)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-485 (U-Visa)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-601": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-601A Waiver": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-730": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-751 (Removal of Conditions)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-765 (online c08+c11)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-765 (c09, paid FF)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-765 (U visa c14/SIJ)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-765": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-824": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-864 (Affidavit of Support)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-881": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-90": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-944 (or similar)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-914/I-192 (T-Visa)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-918/I-192 (U-Visa)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-918/I-192 (U-Visa Complex)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "I-929": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "N-400": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "N-600 (complex)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "N-600 (simple)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "DACA Renewal (not client)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "DACA Renewal (client)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "DACA Initial": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "Deferred Action (non DACA)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "DS-160 (NVC)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "Consular Processing": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "EAD Extension Letters": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "Extension I-539": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "SIJ (I-360)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "TPS (initial/late initial)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "TPS (renewal)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "VAWA (I-360)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "VAWA Full Packet (I-360+I-485)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "NOID (messy case)": [{ board: "_cd_open_forms", group: "Open Forms" }],
  "NOID (simple)": [{ board: "_cd_open_forms", group: "Open Forms" }],

  // ── Appeals ──────────────────────────────────────────────────────────────
  "BIA Appeal": [{ board: "appeals" }],
  "Circuit Appeal": [{ board: "appeals" }],

  // ── FOIAs ────────────────────────────────────────────────────────────────
  "FOIA (EOIR)": [{ board: "foias" }],
  "FOIA (G639)": [{ board: "foias" }],
  "FOIA (OBIM + FBI)": [{ board: "foias" }],
  "NRC FOIA": [{ board: "foias" }],

  // ── Litigation ───────────────────────────────────────────────────────────
  "Mandamus": [{ board: "litigation" }],

  // ── I918B ────────────────────────────────────────────────────────────────
  "I-918B": [{ board: "_lt_i918b_s" }],
};

// =============================================================================
// Real Status Labels (from production Monday.com snapshot)
// =============================================================================

// ── Fee K Contract Stage (deal_stage column) ───────────────────────────────
export const CONTRACT_STATUSES = [
  "Create Project",
  "E-File opened",
  "Payment link sent",
  "Sent to Client",
  "Atty Reviewing",
  "Needs to be sent",
  "HOLD",
];

// ── Fee K "It will go to..." routing percentages ───────────────────────────
// Used for reference / logging, not directly in generation (routing is via CASE_TYPE_BOARD_MAP)
export const FEE_K_ROUTING_DISTRIBUTION = {
  "Open Forms": 53.3,
  "Court Cases": 14.0,
  "Motions": 10.6,
  "Already in board": 7.6,
  "FOIA requests": 4.0,
  "Open Forms-Court Forms": 2.4,
  "I-918Bs": 1.2,
  "Litigations": 1.1,
  "Waivers": 1.1,
  "Interviews": 1.0,
  "RFEs": 0.7,
  "Appeals": 0.4,
};

// ── Court Cases ────────────────────────────────────────────────────────────

/** Hearing type status column (from snapshot) */
export const COURT_HEARING_TYPES = [
  { value: "MCH", weight: 30 },
  { value: "Trial", weight: 17 },
  { value: "Bond Hearing", weight: 5 },
  { value: "Detained  MCH", weight: 3 },
  { value: "Detained Trial", weight: 3 },
  { value: "Re-open/Re-cal", weight: 2 },
];

/** Hearing Status (project_status column) — active cases only */
export const COURT_HEARING_STATUSES = [
  { value: "Set for Hearing", weight: 45 },
  { value: "Awaiting New Date - INACTIVE", weight: 10 },
  { value: "Re-open/ Re-cal", weight: 5 },
];

/** Seeking (project_priority column) */
export const COURT_SEEKING = [
  "IJ Grant",
  "IJ - App Adjudication",
  "Term -> Outside Relief",
  "Litigation",
  "Bond",
  "VD",
  "Admin Closure",
];

/** Entry type */
export const COURT_ENTRY_TYPES = [
  { value: "NOT Admitted/Paroled EWI", weight: 60 },
  { value: "Admitted/Paroled", weight: 20 },
  { value: "Arriving Alien", weight: 15 },
  { value: "OSUP", weight: 5 },
];

/** Year for next hearing */
export const COURT_HEARING_YEARS = ["2026", "2027", "2028", "2029"];

/** ECAS or eService */
export const COURT_ECAS_OPTIONS = [
  { value: "ECAS", weight: 45 },
  { value: "eService", weight: 41 },
];

/** Court Case groups (from snapshot) */
export const COURT_CASE_GROUPS = [
  "Court Case",
  "Inactive Court Cases",
  "Ordered Removed/VD",
  "Withdrew",
  "Granted",
];

/** Relief tags (from snapshot) */
export const COURT_RELIEF_TAGS = [
  "I589", "E42B", "I130", "AOSinProceedings", "UVisa", "SIJS",
  "I601A", "VD", "DACA", "I485", "FullPacket", "VAWA", "T-Visa",
  "CVP", "MTT", "I601",
];

/** Det. Facility (from snapshot) */
export const COURT_DETENTION_FACILITIES = [
  "Greene Co. (MO)",
  "Chase Co. (KS)",
  "Ste. Genevieve (MO)",
];

// ── Open Forms ─────────────────────────────────────────────────────────────

/** Status (project_status column) — for items in progress */
export const OPEN_FORM_STATUSES = [
  { value: "Prepping for Atty Review", weight: 15 },
  { value: "For Client Signature", weight: 15 },
  { value: "Waiting for client", weight: 10 },
  { value: "Needs Forms Appt", weight: 10 },
  { value: "Forms Appt Scheduled", weight: 15 },
  { value: "Atty Approved", weight: 10 },
  { value: "OTG to pay FF/Fee Bills", weight: 5 },
  { value: "Send to North Pole", weight: 10 },
  { value: "Ready for Atty Review", weight: 10 },
];

/** Open Forms groups (from snapshot) */
export const OPEN_FORM_GROUPS = [
  "Court Forms",
  "Open Forms",
  "Interview",
  "Filed",
  "Filed PIPS",
  "Closed",
  "Denied",
];

/** Forms tags (from snapshot, top values) */
export const OPEN_FORM_TAGS = [
  "FullPacket", "I765", "I130", "N400", "CVP", "I485",
  "EAD", "FileCopy", "I90", "I589", "DACARENEWAL",
  "I601A", "FamPIP", "E42B", "I918", "I751",
];

// ── Motions ────────────────────────────────────────────────────────────────

/** Motion type tags (from snapshot) */
export const MOTION_TYPE_TAGS = [
  "MTAC", "MTT", "BONDMTN", "MTWD", "MTC", "SUPPRESS",
  "MTNtoSetforT", "MTACorMTCinAlt.", "MTSC", "MTCV", "MTD",
  "MTRO", "MTN-RECAL",
];

/** Motion status labels (from snapshot) */
export const MOTION_STATUSES = [
  "CONNECT PROFILE and COURT CASE",
  "Granted",
  "Pending",
  "Filed",
  "Denied",
];

/** Motion groups (from snapshot) */
export const MOTION_GROUPS = [
  "Motions to be sent",
  "Awaiting on decision",
  "Granted",
  "Denied",
];

// ── Appeals ────────────────────────────────────────────────────────────────

export const APPEAL_STATUSES = [
  "Working on it",
  "CONNECT PROFILE and COURT CASE",
  "Brief Due",
  "Brief Filed",
  "Decision Pending",
];

// ── FOIAs ──────────────────────────────────────────────────────────────────

/** FOIA type tags (from snapshot) */
export const FOIA_TYPE_TAGS = ["OBIM", "FBI", "USCIS", "EOIR"];

/** FOIA statuses (from snapshot) */
export const FOIA_STATUSES = [
  "CONNECT PROFILE",
  "Atty Approved",
  "Reviewing Docs",
  "Submitted",
  "Received",
];

/** FOIA groups (from snapshot) */
export const FOIA_GROUPS = ["Pending FOIAs", "Filed"];

// ── Litigation ─────────────────────────────────────────────────────────────

export const LITIGATION_COMPLAINT_STATUSES = ["Filed", "Dismissed"];
export const LITIGATION_CURRENT_STATUSES = [
  "Case  Dismissed",
  "Need to discuss with AUSA before due date",
  "Case held in Abeyance",
];

// ── I918Bs ─────────────────────────────────────────────────────────────────

export const I918B_STATUSES = [
  { value: "918b Request pending", weight: 40 },
  { value: "Agency did not sign", weight: 20 },
  { value: "Not Hiring", weight: 15 },
  { value: "Client has deadlines", weight: 12 },
  { value: "On Open Forms", weight: 4 },
  { value: "On Fee Ks for U Visa", weight: 4 },
  { value: "Expired", weight: 4 },
];

export const I918B_GROUPS = [
  "To Be Requested",
  "Pending I918 B's",
  "Signed I918 B's",
  "Agency did not sign",
  "Did not hire",
  "Hired for U-visa",
  "Extension Letters",
  "Expired",
];

// ── Address Changes ────────────────────────────────────────────────────────

export const ADDRESS_CHANGE_STATUSES = [
  { value: "Needs Address Change", weight: 20 },
  { value: "SENT FOR ATTY REVIEW", weight: 15 },
  { value: "Waiting for Payment", weight: 15 },
  { value: "Sent Out", weight: 50 },
];

export const ADDRESS_CHANGE_COURT_OR_USCIS = [
  { value: "USCIS", weight: 28 },
  { value: "COURT", weight: 20 },
  { value: "COURT & USCIS", weight: 6 },
];

export const ADDRESS_CHANGE_ECAS_OPTIONS = [
  { value: "Paper", weight: 40 },
  { value: "ECAS", weight: 35 },
  { value: "E-service", weight: 25 },
];

export const ADDRESS_CHANGE_GROUPS = [
  "Address Changes",
  "Address Change (payment Pending)",
  "EAD Extension Letters",
  "Completed Changes of Address",
];

// ── RFEs ───────────────────────────────────────────────────────────────────

export const RFE_STATUSES = [
  { value: "RFE/Denial received please check", weight: 30 },
  { value: "Appointment to be Scheduled", weight: 20 },
  { value: "Appt Scheduled", weight: 15 },
  { value: "Waiting on client to send docs + fees", weight: 10 },
  { value: "Sent out", weight: 25 },
];

export const RFE_TYPE_TAGS = ["RFE", "DENIAL", "NOID", "NOC", "NOIT"];

export const RFE_GROUPS = [
  "USCIS RFEs",
  "NVC RFEs",
  "Sent Out",
  "No Action Needed/ Completed/ Denied",
];

// ── Originals + Cards + Notices ────────────────────────────────────────────

export const ORIGINALS_STATUSES = [
  { value: "Picked Up", weight: 50 },
  { value: "SENT OUT", weight: 30 },
  { value: "E-mailed Client", weight: 5 },
  { value: "Contact Client", weight: 5 },
  { value: "Client Picking Up", weight: 5 },
  { value: "Waiting for card/notice", weight: 5 },
];

export const ORIGINALS_RECEIPT_TYPES = [
  { value: "I765", weight: 32 },
  { value: "I485", weight: 8 },
  { value: "I918", weight: 6 },
  { value: "I130", weight: 5 },
  { value: "I601A", weight: 3 },
  { value: "I821D", weight: 3 },
  { value: "I90", weight: 3 },
  { value: "N400", weight: 2 },
  { value: "I129F", weight: 2 },
  { value: "I751", weight: 1 },
  { value: "I360", weight: 1 },
];

export const ORIGINALS_WHAT_WE_HAVE = [
  "EAD", "I-765 Approval", "GC", "I-485 Approval", "I-130 Approval",
  "Bona Fide Determination", "SSN", "N-400 Receipt", "Approval Notice",
  "I-601A Approval", "Green Card", "I-90 Receipt", "I-821D Approval",
];

export const ORIGINALS_GROUPS = [
  "Cards",
  "Green Notices",
  "CYF Appts",
  "Sent To Client",
];

// ── Appointments ───────────────────────────────────────────────────────────

/** Combined from all 4 attorney appointment boards */
export const APPOINTMENT_STATUSES = [
  { value: "Hire", weight: 30 },
  { value: "No Hire", weight: 15 },
  { value: "Past Consult", weight: 12 },
  { value: "Follow up", weight: 8 },
  { value: "No Action Needed", weight: 6 },
  { value: "Today's consult (1st time)", weight: 5 },
  { value: "Cancelled/No Show", weight: 4 },
  { value: "Hold for Docs", weight: 4 },
  { value: "Close File", weight: 3 },
  { value: "Upcoming", weight: 3 },
  { value: "Det Hire", weight: 3 },
  { value: "To be rescheduled", weight: 2 },
  { value: "No Hire for Now", weight: 2 },
  { value: "Refund", weight: 1 },
  { value: "Det No Hire", weight: 1 },
];

/** Language distribution (combined from all appointment + jail intake boards) */
export const LANGUAGES = [
  { value: "Espanol", weight: 50 },
  { value: "English", weight: 35 },
  { value: "Portuguese", weight: 8 },
  { value: "Arabic", weight: 3 },
  { value: "Hindi", weight: 2 },
  { value: "Creole", weight: 1 },
  { value: "Russian", weight: 1 },
];

export const APPOINTMENT_GROUPS = [
  "Today's consults",
  "Upcoming",
  "Past Consults",
  "No Hire",
  "Hire",
];

export const ATTORNEY_BOARDS = [
  "appointments_r", "appointments_m", "appointments_lb", "appointments_wh",
] as const;

// ── Jail Intakes ───────────────────────────────────────────────────────────

export const JAIL_INTAKE_STATUSES = [
  { value: "New Detainee", weight: 25 },
  { value: "Scheduled", weight: 40 },
  { value: "Not Proceeding", weight: 15 },
  { value: "Payment link sent. Waiting on payment", weight: 8 },
  { value: "Not enough info", weight: 5 },
  { value: "Needs to be scheduled", weight: 4 },
  { value: "Does not have consult money or POC", weight: 2 },
  { value: "Needs consult payment link", weight: 1 },
];

/** Attorney assignment for jail intakes */
export const JAIL_INTAKE_ATTORNEYS = [
  { value: "WH", weight: 36 },
  { value: "M", weight: 13 },
  { value: "LB", weight: 7 },
  { value: "R", weight: 1 },
];

export const DETENTION_FACILITIES = [
  { value: "Chase Co. (KS)", weight: 50 },
  { value: "Greene Co. (MO)", weight: 35 },
  { value: "Kay Co. (MO)", weight: 10 },
  { value: "Other", weight: 5 },
];

export const JAIL_INTAKE_GROUPS = [
  "Jail Intakes",
  "Scheduled",
  "NEED TO BE SCHEDULED",
];

/** Removed been ever removed — from snapshot */
export const JAIL_EVER_REMOVED = [
  { value: "No", weight: 47 },
  { value: "Yes", weight: 13 },
];

// ── Profiles ───────────────────────────────────────────────────────────────

export const PROFILE_STATUSES = [
  "Active Client",
];

export const PROFILE_LANGUAGES = [
  { value: "Espanol", weight: 37 },
  { value: "English", weight: 36 },
  { value: "Hindi", weight: 1 },
  { value: "Arabic", weight: 1 },
  { value: "Portuguese", weight: 1 },
  { value: "Creole", weight: 1 },
];

export const PROFILE_GROUPS = [
  "Non-clients",
  "Active Clients",
  "Closed clients",
  "Clinic Profiles (non clients)",
];

// ── NVC Notices ────────────────────────────────────────────────────────────
// Per user: leave empty for now — too specific (only CVP cases or I-130+I-601A)

export const NVC_NOTICE_TYPES = [
  "Case Created",
  "Submit Documents for Review",
  "Documentarily Qualified",
  "Action Required",
];

export const NVC_NOTICE_STATUSES = ["Done"];
