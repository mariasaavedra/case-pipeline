// =============================================================================
// EditContractModal (M25) — edit everything a contract is generated from
// =============================================================================
// From P14.3: the ⋯ menu's "Edit contract…", or a click on the case type, the
// fees or the "Missing:" line. Same fields as M11 New contract (ContractFields,
// minus the note): case type, AF / FF / PF, attorney, and the client's e-mail
// and address. Only what changed is sent (PATCH /api/contracts/:id/fees):
// case type, fees and attorney in one write to the Fee K; e-mail / address to
// the client's PROFILE (the Fee K mirrors them). An empty fee clears it;
// e-mail and address can be corrected but not emptied. Refused (409) if Monday
// changed since the window opened. Queued on an outage like every write-back.
// Replaced EditFeesModal (fees + case type only) on 2026-10-14.
// "From fee sheet" (FeeSheetPicker) fills AF + FF from the firm's fee sheet.
// =============================================================================

import { useEffect, useState } from "react";
import { updateContract, type ContractFees, type PendingContract } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { FeeSheetPicker } from "./FeeSheetPicker";
import { ContractFields, contractFieldProblems, useContractCaseTypes, useContractInfo, type ContractFieldValues } from "./ContractFields";
import { useBoardColumnsMeta } from "../BoardColumnsProvider";

interface Props {
  contract: PendingContract;
  /** After a successful (or queued) save; `pending` = queued. */
  onSaved: (pending: boolean) => void;
  onClose: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const feeText = (n: number | null) => (n === null ? "" : String(n));

/** "" = no fee; otherwise a number (commas and $ allowed). undefined = not a number. */
function parseFee(text: string): number | null | undefined {
  const s = text.replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const FEE_KEYS: { key: keyof ContractFees; field: "af" | "ff" | "pf"; label: string }[] = [
  { key: "af", field: "af", label: "AF" },
  { key: "ff", field: "ff", label: "FF" },
  { key: "pf", field: "pf", label: "PF" },
];

export function EditContractModal({ contract: c, onSaved, onClose }: Props) {
  const caseTypes = useContractCaseTypes();
  const { refresh: refreshColumns } = useBoardColumnsMeta();
  const info = useContractInfo(c.clientLocalId);
  const seenFees: ContractFees = { af: c.attorneyFee, ff: c.filingFee, pf: c.processingFee };

  // What the window opened with — the client's e-mail / address come from their profile.
  const [seen, setSeen] = useState<ContractFieldValues | null>(null);
  const [value, setValue] = useState<ContractFieldValues | null>(null);
  useEffect(() => {
    if (!info || seen) return;
    const start: ContractFieldValues = {
      // One label shows as picked; none or several show "Select…" (a pick replaces them).
      caseType: c.contractFor.length === 1 ? c.contractFor[0]! : "",
      af: feeText(c.attorneyFee), ff: feeText(c.filingFee), pf: feeText(c.processingFee),
      description: "",
      attorney: c.mondayAttorneys.length === 1 ? c.mondayAttorneys[0]! : "",
      email: info.email, address: info.address,
    };
    setSeen(start);
    setValue(start);
  }, [info, seen, c]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const diff = (() => {
    if (!value || !seen) return null;
    const fees: Partial<ContractFees> = {};
    const invalid: string[] = [];
    for (const { key, field, label } of FEE_KEYS) {
      const v = parseFee(value[field]);
      if (v === undefined) invalid.push(label);
      else if (v !== seenFees[key]) fees[key] = v;
    }
    const typeChanged = value.caseType !== "" && value.caseType !== seen.caseType;
    const attorneyChanged = value.attorney !== "" && value.attorney !== seen.attorney;
    const email = value.email.trim(), address = value.address.trim().replace(/\s+/g, " ");
    const emailChanged = email !== seen.email.trim();
    const addressChanged = address !== seen.address.trim();
    if (emailChanged && !email) invalid.push("e-mail (can't be emptied)");
    else if (emailChanged && !EMAIL_RE.test(email)) invalid.push("e-mail");
    if (addressChanged && !address) invalid.push("address (can't be emptied)");
    const nothing = Object.keys(fees).length === 0 && !typeChanged && !attorneyChanged && !emailChanged && !addressChanged;
    return { fees, invalid, typeChanged, attorneyChanged, emailChanged, addressChanged, email, address, nothing };
  })();

  const save = async () => {
    if (!value || !seen || !diff || diff.invalid.length > 0 || diff.nothing) return;
    setSaving(true);
    setError(null);
    try {
      const from: Parameters<typeof updateContract>[2] = {};
      for (const k of Object.keys(diff.fees) as (keyof ContractFees)[]) from[k] = seenFees[k];
      if (diff.typeChanged) from.caseType = c.contractFor;
      if (diff.attorneyChanged) from.attorney = c.mondayAttorneys;
      if (diff.emailChanged) from.email = seen.email;
      if (diff.addressChanged) from.address = seen.address;
      const res = await updateContract(c.localId, {
        ...(Object.keys(diff.fees).length ? { fees: diff.fees } : {}),
        ...(diff.typeChanged ? { caseType: value.caseType, ...(value.newCaseType ? { newCaseType: true } : {}) } : {}),
        ...(diff.attorneyChanged ? { attorney: value.attorney } : {}),
        ...(diff.emailChanged ? { email: diff.email } : {}),
        ...(diff.addressChanged ? { address: diff.address } : {}),
      }, from);
      if (value.newCaseType) refreshColumns();
      onSaved(res.pending);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  };

  const stillMissing = value ? contractFieldProblems(value) : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M25" className="gap-0 p-0 sm:max-w-[460px] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Edit contract</DialogTitle>
          <DialogDescription>{c.clientName}{c.itemName !== c.clientName ? ` · ${c.itemName}` : ""}</DialogDescription>
        </DialogHeader>

        <form className="px-5 py-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {!value ? (
            <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading…</p>
          ) : (
            <>
              {c.contractFor.length > 1 && (
                <p className="text-xs mb-2" style={{ color: "var(--color-ink-faint)" }}>Case type now: {c.contractFor.join(", ")}. Picking one replaces them.</p>
              )}
              {c.attorneys.length > 1 && (
                <p className="text-xs mb-2" style={{ color: "var(--color-ink-faint)" }}>Attorney now: {c.attorneys.join(", ")}. Picking one replaces them.</p>
              )}
              <div className="mb-3">
                <FeeSheetPicker
                  onPick={(fees) => setValue((v) => (v ? {
                    ...v,
                    ...(fees.attorneyFee !== undefined ? { af: feeText(fees.attorneyFee) } : {}),
                    ...(fees.filingFee !== undefined ? { ff: feeText(fees.filingFee) } : {}),
                  } : v))}
                />
              </div>
              <ContractFields value={value} onChange={setValue} showNote={false} profileLocalId={c.clientLocalId} prefill={false} />
              {!c.clientLocalId && (
                <p className="text-xs mb-2" style={{ color: "var(--urgency-overdue)" }}>
                  This contract isn&apos;t linked to a client profile, so the e-mail and address can&apos;t be saved — link it in Monday first.
                </p>
              )}
              <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
                Saved on Monday. Leave a fee empty to clear it.
                {stillMissing.length > 0 && <> Still missing for the contract: {stillMissing.join(", ")}.</>}
              </p>
              {diff && diff.invalid.length > 0 && (
                <p className="text-sm mt-2" style={{ color: "var(--urgency-overdue)" }}>Check: {diff.invalid.join(", ")}.</p>
              )}
              {error && <p className="text-sm mt-2" style={{ color: "var(--urgency-overdue)" }}>{error}</p>}
            </>
          )}
          <div className="flex justify-end gap-2 pt-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !diff || diff.invalid.length > 0 || diff.nothing || caseTypes.length === 0}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
