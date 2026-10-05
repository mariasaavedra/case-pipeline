// =============================================================================
// Contract (Fee K) field values — the shape and the mapping onto the request
// =============================================================================
// Two screens create a Fee K: M11 (New contract) and the "this call requests a
// contract" section in M2 (Log a call). Same lesson as jail-intake-fields.ts —
// two copies of one form drift — so both render ContractFields and map through
// here. Kept apart from the component so vitest can load it (ui/select uses a
// "@/" alias it does not resolve).
// =============================================================================

export interface ContractFieldValues {
  /** A label from the Fee Ks "Contract for…" dropdown. */
  caseType: string;
  af: string;
  ff: string;
  pf: string;
  description: string;
}

export const emptyContractFields: ContractFieldValues = {
  caseType: "",
  af: "",
  ff: "",
  pf: "",
  description: "",
};

/** A fee as typed → what the API takes. Blank is "not set", not zero. */
function fee(v: string): number | null {
  return v.trim() === "" ? null : Number(v);
}

export function toCreateContractInput(v: ContractFieldValues) {
  return {
    caseType: v.caseType,
    af: fee(v.af),
    ff: fee(v.ff),
    pf: fee(v.pf),
    description: v.description.trim() || undefined,
  };
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** A fee field as the note will print it — blank reads $0.00, same as the API. */
export const money = (v: string) => usd.format(v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));

/** The fixed header the Fee K note starts with (the API's contractNoteText). */
export function contractNoteHeader(v: ContractFieldValues): string {
  return `For: ${v.caseType || "___"}\nFees: ${money(v.af)} AF ${money(v.ff)} FF`;
}
