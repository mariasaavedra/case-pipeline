// =============================================================================
// Pending Contracts Query
// =============================================================================
// Pending Fee Ks: contracts that are drafted, sent or waiting on payment. The
// step before Prescheduling (prescheduling.ts). Each contract is aged from the
// day it was sent to the client, or from the day it was added when it hasn't
// been sent yet. Monday doesn't record when a stage last changed, so the age is
// "time in the pipeline", not "time in this stage".
// See docs/features/prescheduling-and-contracts.md.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { WaitLevel } from "./prescheduling";

// =============================================================================
// Types
// =============================================================================

export interface PendingContract {
  localId: string;
  clientName: string;
  clientLocalId: string | null;
  /** The Monday item's own name ("Areli REYES for … (copy)"). */
  itemName: string;
  contractFor: string[];
  /** Contract Stage (deal_stage). Null when not set. */
  contractStage: string | null;
  attorneys: string[];
  assistant: string | null;
  addedOn: string | null;
  sentOn: string | null;
  /** Signed Contract Received On — the client's signature came back. */
  signedOn: string | null;
  paymentLinkSentOn: string | null;
  /** The next signing / payment-link step for this contract's stage, or null. */
  nextStep: ContractStep | null;
  /** Days since sent, or since added when not sent yet. */
  ageDays: number | null;
  /** What `ageDays` counts from. */
  agedFrom: "sent" | "added" | null;
  ageLevel: WaitLevel;
  /** Attorney fee and filing fee, in dollars, when set on Monday. */
  attorneyFee: number | null;
  filingFee: number | null;
  /** Processing fee (PF), in dollars, when set on Monday. */
  processingFee: number | null;
}

export interface PendingContractsResult {
  /** Every Pending Fee K, oldest first. */
  contracts: PendingContract[];
  /** Contract Stages with at least one contract, in pipeline order. */
  stages: string[];
  thresholds: { waitingDays: number; lateDays: number };
}

export interface PendingContractsOptions {
  /** Days before a contract turns yellow. Default 30 (same as Prescheduling). */
  waitingDays?: number;
  /** Days before a contract turns red. Default 60. */
  lateDays?: number;
  /** ISO date to measure from (tests). Default today. */
  today?: string;
}

// =============================================================================
// Constants
// =============================================================================

export const PENDING_FEE_KS_GROUP = "Pending Fee Ks";
export const NO_CONTRACT_STAGE = "No stage";
export const NO_ATTORNEY = "No attorney";

// Pipeline order for the table columns. Labels not listed here follow in
// alphabetical order, then "No stage". Parked / exception stages go last.
const STAGE_ORDER = [
  "Needs to be sent",
  "Create to sign in office",
  "Ready to be sent",
  "Atty Reviewing",
  "Sent to Client",
  "Needs to be Amended",
  "Needs Payment Link",
  "Payment link sent",
  "Client coming to the office",
  "7 Days before Expiry",
  "Paid needs action",
  "Create Project",
  "Needs help",
  "HOLD",
  "Needs Refund",
];

// =============================================================================
// Signing steps (Acrobat Pro hand-off)
// =============================================================================
// Contracts are signed in Acrobat Pro (attorney first, then the client), which
// can't be connected to the app. Staff send from Acrobat and record each step
// here; every step moves the Contract Stage and stamps the date that goes with
// it. Payment links (LawPay) follow the client's signature. Written by
// apps/api/src/routes/contract-step.ts. See docs/features/contract-signing.md.

export type ContractStep = "sent_for_signature" | "attorney_signed" | "client_signed" | "payment_link_sent";

/** Fee Ks column ids (by_id in config/boards.yaml) and their raw_column_values keys. */
export const FEE_K_COLUMN_IDS = {
  contractStage: { id: "deal_stage", key: "contract_stage" },
  sentOn: { id: "date1__1", key: "contract_sent_on" },
  signedOn: { id: "date8__1", key: "signed_contract_received_on" },
  paymentLinkSentOn: { id: "date_mkzjh7f2", key: "payment_link_sent_on" },
} as const;

export interface ContractStepDef {
  /** Stages this step can be taken from (null = no stage set). */
  from: (string | null)[];
  /** The Contract Stage it moves to. */
  to: string;
  /** The date column stamped with today, if any. */
  date: keyof typeof FEE_K_COLUMN_IDS | null;
}

export const CONTRACT_STEPS: Record<ContractStep, ContractStepDef> = {
  // Sent from Acrobat to the attorney (who signs first; Acrobat then emails the client).
  sent_for_signature: {
    from: [null, "Needs to be sent", "Ready to be sent", "Create to sign in office", "Needs to be Amended"],
    to: "Atty Reviewing",
    date: null,
  },
  // The attorney signed, so Acrobat has now sent it to the client.
  attorney_signed: { from: ["Atty Reviewing"], to: "Sent to Client", date: "sentOn" },
  client_signed: { from: ["Sent to Client"], to: "Needs Payment Link", date: "signedOn" },
  payment_link_sent: { from: ["Needs Payment Link"], to: "Payment link sent", date: "paymentLinkSentOn" },
};

export function nextContractStep(stage: string | null): ContractStep | null {
  const s = stage?.trim() || null;
  for (const [step, def] of Object.entries(CONTRACT_STEPS) as [ContractStep, ContractStepDef][]) {
    if (def.from.includes(s)) return step;
  }
  return null;
}

const AGE_ORDER: Record<WaitLevel, number> = { late: 0, waiting: 1, fresh: 2, unknown: 3 };

// =============================================================================
// Helpers
// =============================================================================

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const labels: unknown = JSON.parse(raw);
    return Array.isArray(labels) ? labels.filter((l): l is string => typeof l === "string" && l.trim() !== "") : [];
  } catch {
    return [];
  }
}

// Monday people-style label: "A, B". Drops entries that are clearly not a
// name (a stray e-mail fragment like "Rekha@Sharma- com").
function splitNames(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => s && !s.includes("@")))];
}

function toAmount(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function stageRank(stage: string): number {
  if (stage === NO_CONTRACT_STAGE) return Number.MAX_SAFE_INTEGER;
  const i = STAGE_ORDER.indexOf(stage);
  // Unknown labels sit before the parked / exception tail (HOLD onward).
  return i === -1 ? STAGE_ORDER.indexOf("HOLD") - 0.5 : i;
}

// =============================================================================
// Query
// =============================================================================

interface RawRow {
  localId: string;
  name: string;
  clientLocalId: string | null;
  clientName: string | null;
  contractStage: string | null;
  contractFor: string | null;
  attorney: string | null;
  assistant: string | null;
  addedOn: string | null;
  sentOn: string | null;
  signedOn: string | null;
  paymentLinkSentOn: string | null;
  af: unknown;
  ff: unknown;
  pf: unknown;
}

export function getPendingContracts(db: Database, options: PendingContractsOptions = {}): PendingContractsResult {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  // 7 / 14 was tried first: most pending contracts are 30+ days old, so
  // everything went red. 30 / 60 separates them and matches Prescheduling.
  const waitingDays = options.waitingDays ?? 30;
  const lateDays = Math.max(waitingDays, options.lateDays ?? 60);

  const rows = db.prepare(`
    SELECT
      c.local_id AS localId,
      c.name,
      p.local_id AS clientLocalId,
      p.name     AS clientName,
      json_extract(c.raw_column_values, '$.contract_stage.label')       AS contractStage,
      json_extract(c.raw_column_values, '$.contract_for.labels')        AS contractFor,
      json_extract(c.raw_column_values, '$.attorney.label')             AS attorney,
      json_extract(c.raw_column_values, '$.assistant.label')            AS assistant,
      json_extract(c.raw_column_values, '$.contract_added_on.date')     AS addedOn,
      json_extract(c.raw_column_values, '$.contract_sent_on.date')      AS sentOn,
      json_extract(c.raw_column_values, '$.signed_contract_received_on.date') AS signedOn,
      json_extract(c.raw_column_values, '$.payment_link_sent_on.date')  AS paymentLinkSentOn,
      json_extract(c.raw_column_values, '$.af')                         AS af,
      json_extract(c.raw_column_values, '$.ff')                         AS ff,
      json_extract(c.raw_column_values, '$.pf')                         AS pf
    FROM contracts c
    LEFT JOIN profiles p ON p.local_id = c.profile_local_id
    WHERE c.group_title = ? AND c.deleted_at IS NULL
  `).all(PENDING_FEE_KS_GROUP) as RawRow[];

  const contracts: PendingContract[] = rows.map((r) => {
    const from = r.sentOn ?? r.addedOn;
    const ageDays = from ? daysBetween(from, today) : null;
    const ageLevel: WaitLevel =
      ageDays === null ? "unknown" : ageDays >= lateDays ? "late" : ageDays >= waitingDays ? "waiting" : "fresh";
    return {
      localId: r.localId,
      clientName: r.clientName ?? r.name,
      clientLocalId: r.clientLocalId,
      itemName: r.name,
      contractFor: parseLabels(r.contractFor),
      contractStage: r.contractStage?.trim() || null,
      nextStep: nextContractStep(r.contractStage),
      attorneys: splitNames(r.attorney),
      assistant: r.assistant?.trim() || null,
      addedOn: r.addedOn,
      sentOn: r.sentOn,
      signedOn: r.signedOn,
      paymentLinkSentOn: r.paymentLinkSentOn,
      ageDays,
      agedFrom: r.sentOn ? "sent" : r.addedOn ? "added" : null,
      ageLevel,
      attorneyFee: toAmount(r.af),
      filingFee: toAmount(r.ff),
      processingFee: toAmount(r.pf),
    };
  });

  contracts.sort(
    (a, b) =>
      AGE_ORDER[a.ageLevel] - AGE_ORDER[b.ageLevel] ||
      (b.ageDays ?? -1) - (a.ageDays ?? -1) ||
      a.clientName.localeCompare(b.clientName),
  );

  const stages = [...new Set(contracts.map((c) => c.contractStage ?? NO_CONTRACT_STAGE))].sort(
    (a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b),
  );

  return { contracts, stages, thresholds: { waitingDays, lateDays } };
}
