// =============================================================================
// Contract (Fee K) field values — the shape and the mapping onto the request
// =============================================================================
// Two screens create a Fee K: M11 (New contract) and the "this call requests a
// contract" section in M2 (Log a call). Both require everything a contract is
// generated from (CONTRACT_REQUIRED, the same five P14 flags as missing); M25
// Edit contract edits the same fields. Same lesson as jail-intake-fields.ts —
// two copies of one form drift — so both render ContractFields and map through
// here. Kept apart from the component so vitest can load it (ui/select uses a
// "@/" alias it does not resolve).
// =============================================================================

export interface ContractFieldValues {
  /** A label from the Fee Ks "Contract for…" dropdown — or a new one (below). */
  caseType: string;
  /** `caseType` is not on the dropdown yet: Monday adds it on create. */
  newCaseType?: boolean;
  af: string;
  ff: string;
  pf: string;
  description: string;
  /** The attorney's name (Fee K "Attorney" People column). */
  attorney: string;
  /** The client's e-mail and address — written to their PROFILE (the Fee K mirrors them). */
  email: string;
  address: string;
}

export const emptyContractFields: ContractFieldValues = {
  caseType: "",
  af: "",
  ff: "",
  pf: "",
  description: "",
  attorney: "",
  email: "",
  address: "",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What stops a contract from being created (M11, M2). Empty = OK. Mirrors P14's MISSING_FIELDS. */
export function contractFieldProblems(v: ContractFieldValues): string[] {
  const out: string[] = [];
  if (!v.caseType.trim()) out.push("case type");
  if (v.af.trim() === "" || !Number.isFinite(Number(v.af)) || Number(v.af) < 0) out.push("attorney fee (AF)");
  if (!v.attorney.trim()) out.push("attorney");
  if (!v.email.trim()) out.push("client e-mail");
  else if (!EMAIL_RE.test(v.email.trim())) out.push("a valid client e-mail");
  if (!v.address.trim()) out.push("client address");
  return out;
}

/** A fee as typed → what the API takes. Blank is "not set", not zero. */
function fee(v: string): number | null {
  return v.trim() === "" ? null : Number(v);
}

export function toCreateContractInput(v: ContractFieldValues) {
  return {
    caseType: v.caseType,
    ...(v.newCaseType ? { newCaseType: true } : {}),
    af: fee(v.af),
    ff: fee(v.ff),
    pf: fee(v.pf),
    description: v.description.trim() || undefined,
    attorney: v.attorney.trim(),
    email: v.email.trim(),
    address: v.address.trim().replace(/\s+/g, " "),
  };
}

/** P4's fee quote (case type + fees, no note), or null when the section was left empty. */
export function toConsultFees(v: ContractFieldValues) {
  const { description: _description, attorney: _a, email: _e, address: _ad, ...rest } = toCreateContractInput(v);
  return v.caseType || rest.af != null || rest.ff != null || rest.pf != null ? rest : null;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** A fee field as the note will print it — blank reads $0.00, same as the API. */
export const money = (v: string) => usd.format(v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));

/** The fixed header the Fee K note starts with (the API's contractNoteText). */
export function contractNoteHeader(v: ContractFieldValues): string {
  return `For: ${v.caseType || "___"}\nFees: ${money(v.af)} AF ${money(v.ff)} FF`;
}
