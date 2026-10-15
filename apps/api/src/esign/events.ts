// =============================================================================
// Adobe Sign (via Zapier) — what an event means for a contract
// =============================================================================
// Pure rules, no I/O, so they are unit-tested on their own. routes/esign.ts
// applies the result (Monday stage + date, a note, notifications).
//
// Zapier relays Adobe's events to the app with whatever name its trigger gives
// them: "AGREEMENT_WORKFLOW_COMPLETED", "Agreement Signed by All Participants",
// "AGREEMENT_ACTION_COMPLETED"… `classifyEsignEvent` reads all of those. Zap 1
// adds two of its own: "sent" (with Adobe's agreement id) and "signed_pdf"
// (with the signed copy's URL).
//
// The agreement name carries the app's reference, "[CP-12]", so an event can be
// matched even when it outruns Zap 1's "sent" (Adobe fires "created" first).
// =============================================================================

import type { ContractStep } from "@case-pipeline/query";

export type EsignStatus =
  | "sending" | "out_for_signature" | "attorney_signed" | "signed"
  | "rejected" | "expired" | "recalled" | "send_failed";

export type EsignEventKind =
  | "sent" | "participant_signed" | "completed" | "rejected" | "expired" | "recalled" | "signed_pdf" | "ignored";

/** Still waiting on a signature — a second send for the same Fee K is refused. */
export const OPEN_STATUSES: EsignStatus[] = ["sending", "out_for_signature", "attorney_signed"];

export function classifyEsignEvent(raw: unknown): EsignEventKind {
  const s = typeof raw === "string" ? raw.toUpperCase().replace(/[^A-Z]/g, "") : "";
  if (!s) return "ignored";
  if (s === "SENT") return "sent";
  if (s === "SIGNEDPDF") return "signed_pdf";
  if (s.includes("WORKFLOWCOMPLETED") || s.includes("SIGNEDBYALL") || s === "AGREEMENTCOMPLETED" || s === "COMPLETED" || s === "SIGNED") {
    return "completed";
  }
  if (s.includes("ACTIONCOMPLETED") || s.includes("PARTICIPANTCOMPLETED") || s.includes("SIGNEDBYAPARTICIPANT") || s.includes("SIGNEDBYPARTICIPANT")) {
    return "participant_signed";
  }
  if (s.includes("REJECTED")) return "rejected";
  if (s.includes("EXPIRED")) return "expired";
  if (s.includes("RECALLED") || s.includes("CANCELLED") || s.includes("CANCELED")) return "recalled";
  return "ignored";
}

/** The app's own reference, "CP-12", from a `ref` field or the agreement name. */
export function esignRefOf(...texts: unknown[]): number | null {
  for (const t of texts) {
    const m = typeof t === "string" ? /\bCP-(\d{1,9})\b/i.exec(t) : null;
    if (m) return Number(m[1]);
  }
  return null;
}

export const agreementNameFor = (clientName: string, id: number) =>
  `Fee K - ${clientName.replace(/\s+/g, " ").trim()} [CP-${id}]`;

export interface EsignRow {
  status: EsignStatus;
  attorney_email: string;
  client_email: string;
  client_name: string;
}

export interface EsignPlan {
  /** New status; absent = unchanged. */
  status?: EsignStatus;
  /** Contract steps to record, in order. */
  steps: ContractStep[];
  /** Monday update on the Fee K — and, with `title`, an E&A entry on the client's profile. */
  note?: string;
  title?: string;
  /** Monday bell + Slack. */
  notify?: string;
}

const same = (a: string | null | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What an event does to the agreement. Events arrive more than once (Zapier
 * retries, and "State Changed" overlaps the specific triggers), so every
 * branch only moves forward and a repeat is a no-op.
 */
export function planEsignEvent(row: EsignRow, kind: EsignEventKind, participantEmail?: string | null): EsignPlan {
  const waiting = row.status === "sending" || row.status === "out_for_signature";
  const open = OPEN_STATUSES.includes(row.status);
  const who = row.client_name;

  switch (kind) {
    case "sent":
      return row.status === "sending" ? { status: "out_for_signature", steps: [] } : { steps: [] };

    case "participant_signed":
      // Order 1 is the attorney. With no e-mail on the event, the first
      // signature can only be theirs.
      if (waiting && (!participantEmail || same(participantEmail, row.attorney_email))) {
        return {
          status: "attorney_signed",
          steps: ["attorney_signed"],
          title: "Contract signed by the attorney",
          note: `✍️ The attorney signed the contract in Adobe Sign. Adobe has sent it to the client (${row.client_email}).`,
        };
      }
      return { steps: [] };

    case "completed":
      if (!open) return { steps: [] };
      return {
        status: "signed",
        // A missed attorney event still has to pass through "Sent to Client".
        steps: waiting ? ["attorney_signed", "client_signed"] : ["client_signed"],
        title: "Contract signed",
        note: `✅ ${who} signed the contract in Adobe Sign. Next: send the payment link.`,
        notify: `✅ Contract signed: ${who}. Next: send the payment link.`,
      };

    case "rejected":
    case "expired":
    case "recalled": {
      if (!open) return { steps: [] };
      const what = kind === "rejected" ? "was rejected" : kind === "expired" ? "expired" : "was recalled";
      return {
        status: kind,
        steps: [],
        title: `Contract ${kind}`,
        note: `⚠️ The contract ${what} in Adobe Sign. The Contract Stage was left as it is: decide the next step.`,
        notify: `⚠️ Contract ${what} in Adobe Sign: ${who}.`,
      };
    }

    default:
      return { steps: [] };
  }
}
