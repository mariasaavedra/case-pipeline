// =============================================================================
// GenerateContractModal (M22) — fill a contract template from SharePoint
// =============================================================================
// Templates are the firm's own Word files in the SharePoint folder
// CONTRACT_TEMPLATES_FOLDER, edited by staff in Word; a blank is a {{tag}}
// (lib/contract-fill.ts lists them). Picking one downloads it, checks it —
// broken or unknown tags are shown with a link to fix the file — and shows
// only the fields that template uses, pre-filled from Monday (client, e-mail,
// address, attorney, AF / FF, next hearing) and the signed-in user (initials).
// Generate PDF fills it in the browser and converts it with the user's
// Microsoft 365 (convertDocxToPdf); Word downloads the filled .docx to edit.
// Nothing is written to Monday; the generation is audited (template + fees).
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchContractPrefill, logContractGenerated } from "../api";
import type { PendingContract } from "../api";
import { useAuth } from "../auth/useAuth";
import {
  convertDocxToPdf, downloadDriveFile, getGraphToken, listContractTemplates,
  CONTRACT_TEMPLATES_FOLDER, GraphConsentRequiredError, type DriveItem,
} from "../sharepoint/graph";
import {
  contractProblems, fillContractTemplate, inspectContractTemplate, surchargeOf, totalOf, money,
  type ContractInput, type TemplateCheck,
} from "../lib/contract-fill";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";

interface Props {
  contract: PendingContract;
  onClose: () => void;
}

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" } as const;
const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;
const inputClass = "w-full rounded-md px-2 py-1.5 text-sm";

const today = () => new Date().toISOString().slice(0, 10);
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join("").slice(0, 3);
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[$,\s]/g, "")));
const baseName = (file: string) => file.replace(/\.docx$/i, "");

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Which form inputs each template tag needs. */
const INPUTS_FOR: Record<string, (keyof ContractInput)[]> = {
  date: ["date"], date_es: ["date"],
  client_name: ["clientName"], salutation: ["salutation"], email: ["email"],
  address: ["address"], city_state_zip: ["cityStateZip"], address_full: ["address", "cityStateZip"],
  hearing_type: ["hearingType"], hearing_date: ["hearingDate"], hearing_date_es: ["hearingDate"],
  form_name: ["formName"],
  attorney_fee: ["attorneyFee"], filing_fee: ["filingFee"], postage_fee: ["postageFee"],
  surcharge: ["attorneyFee", "surcharge"], total_fee: ["attorneyFee", "filingFee", "postageFee", "surcharge"],
  interview_fee: ["interviewFee"],
  due_date: ["dueDate"], due_date_es: ["dueDate"], due_date_short: ["dueDate"],
  attorney_name: ["attorneyName"], creator_initials: ["creatorInitials"],
};

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle} htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: "var(--color-ink-faint)" }}>{hint}</p>}
    </div>
  );
}

export function GenerateContractModal({ contract: c, onClose }: Props) {
  const { user } = useAuth();
  const [input, setInput] = useState<ContractInput | null>(null);
  const [templates, setTemplates] = useState<{ driveId: string; items: DriveItem[] } | null>(null);
  const [picked, setPicked] = useState<DriveItem | null>(null);
  const [file, setFile] = useState<{ id: string; data: ArrayBuffer; check: TemplateCheck } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "docx" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      setTemplates(await listContractTemplates());
      setNeedsConsent(false);
    } catch (e) {
      if (e instanceof GraphConsentRequiredError) setNeedsConsent(true);
      else setError(e instanceof Error ? `Templates folder: ${e.message}` : "Could not open the templates folder");
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
    fetchContractPrefill(c.localId)
      .then((p) => setInput({
        date: today(), clientName: p.clientName, salutation: p.clientName, email: p.email,
        // Monday keeps one line; staff move the city part to its own field when the contract splits them.
        address: p.address, cityStateZip: "",
        hearingType: p.hearingType, hearingDate: p.hearingDate, formName: p.contractFor.join(", "),
        attorneyFee: p.attorneyFee, filingFee: p.filingFee, postageFee: null, surcharge: null, interviewFee: null,
        dueDate: "", attorneyName: p.attorneyName, creatorInitials: initialsOf(user?.name ?? ""),
      }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the contract"));
  }, [c.localId, loadTemplates, user?.name]);

  // Download + check the picked template.
  useEffect(() => {
    if (!picked || !templates) return;
    let cancelled = false;
    setLoadingFile(true);
    setFile(null);
    downloadDriveFile(templates.driveId, picked.id)
      .then((blob) => blob.arrayBuffer())
      .then((data) => { if (!cancelled) setFile({ id: picked.id, data, check: inspectContractTemplate(data) }); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not download the template"); })
      .finally(() => { if (!cancelled) setLoadingFile(false); });
    return () => { cancelled = true; };
  }, [picked, templates]);

  const shown = useMemo(() => new Set((file?.check.tags ?? []).flatMap((t) => INPUTS_FOR[t] ?? [])), [file]);
  const problems = file && input ? contractProblems(file.check, input) : [];
  const templateBroken = !!file && (file.check.errors.length > 0 || file.check.unknown.length > 0);

  const set = <K extends keyof ContractInput>(k: K, v: ContractInput[K]) => setInput((f) => (f ? { ...f, [k]: v } : f));

  const text = (k: keyof ContractInput, label: string, extra?: { type?: string; placeholder?: string; hint?: string }) =>
    shown.has(k) && input ? (
      <Field id={`m22-${k}`} label={label} hint={extra?.hint}>
        <input id={`m22-${k}`} type={extra?.type ?? "text"} placeholder={extra?.placeholder} className={inputClass} style={inputStyle}
          value={(input[k] as string | null) ?? ""} onChange={(e) => set(k, e.target.value as never)} />
      </Field>
    ) : null;
  const amount = (k: keyof ContractInput, label: string, hint?: string, placeholder?: string) =>
    shown.has(k) && input ? (
      <Field id={`m22-${k}`} label={label} hint={hint}>
        <input id={`m22-${k}`} inputMode="decimal" placeholder={placeholder} className={`${inputClass} tabular-nums`} style={inputStyle}
          value={(input[k] as number | null) ?? ""} onChange={(e) => set(k, num(e.target.value) as never)} />
      </Field>
    ) : null;

  const generate = async (format: "pdf" | "docx") => {
    if (!input || !file || !picked || problems.length > 0) return;
    setBusy(format);
    setError(null);
    setDone(null);
    try {
      const docx = fillContractTemplate(file.data, input);
      const name = `${baseName(picked.name)} - ${input.clientName.replace(/[\\/:*?"<>|]+/g, " ").trim()}`;
      if (format === "docx") save(docx, `${name}.docx`);
      else save(await convertDocxToPdf(docx, `${name}.docx`), `${name}.pdf`);
      setDone(format === "pdf" ? `Downloaded ${name}.pdf — send it from Acrobat (attorney first, then the client).` : `Downloaded ${name}.docx`);
      void logContractGenerated(c.localId, { template: picked.name, format, attorneyFee: input.attorneyFee, filingFee: input.filingFee });
    } catch (e) {
      if (e instanceof GraphConsentRequiredError) setNeedsConsent(true);
      else setError(e instanceof Error ? e.message : "Could not generate the contract");
    } finally {
      setBusy(null);
    }
  };

  // From the click itself, so the browser allows the Microsoft popup.
  const allowMicrosoft = async () => {
    try {
      await getGraphToken(true);
      setNeedsConsent(false);
      await loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microsoft 365 access was not granted");
    }
  };

  const items = templates?.items ?? [];
  const selectItems = items.map((i) => ({ value: i.id, label: baseName(i.name) }));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M22" className="gap-0 p-0 sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Generate contract</DialogTitle>
          <DialogDescription>{c.clientName}{c.contractFor.length > 0 ? ` · ${c.contractFor.join(", ")}` : ""}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          {needsConsent && (
            <div className="text-sm rounded p-3 flex items-center gap-2" style={{ background: "var(--color-amber-light)", color: "var(--color-ink)" }}>
              The templates and the PDF use your Microsoft 365 account, which needs your OK once.
              <Button type="button" size="sm" className="ml-auto" onClick={allowMicrosoft}>Allow</Button>
            </div>
          )}

          <Field id="m22-template" label="Contract template"
            hint={templates && items.length === 0 ? "No Word templates in the folder yet." : undefined}>
            <div className="flex items-center gap-2">
              <Select items={selectItems} value={picked?.id ?? ""} onValueChange={(v) => { setDone(null); setError(null); setPicked(items.find((i) => i.id === v) ?? null); }}>
                <SelectTrigger id="m22-template" aria-label="Contract template" size="sm" className="w-full border-border-light bg-surface">
                  <SelectValue placeholder={templates ? "Pick a contract…" : "Loading templates…"} />
                </SelectTrigger>
                <SelectContent className="w-[var(--anchor-width)]">
                  {selectItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <a href={CONTRACT_TEMPLATES_FOLDER} target="_blank" rel="noopener noreferrer" className="text-xs whitespace-nowrap hover:underline" style={{ color: "var(--color-ink-muted)" }}>
                Open folder ↗
              </a>
            </div>
          </Field>

          {loadingFile && <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Reading the template…</p>}

          {file && picked && templateBroken && (
            <div className="text-sm rounded p-3 space-y-1" style={{ background: "var(--urgency-overdue-bg)", color: "var(--urgency-overdue)" }}>
              <div className="font-medium">This template needs fixing before it can be used:</div>
              {[...file.check.errors, ...(file.check.unknown.length ? [`Unknown field(s): ${file.check.unknown.map((t) => `{{${t}}}`).join(", ")} — check the spelling against the READ ME in the folder.`] : [])]
                .map((p) => <div key={p}>• {p}</div>)}
              <a href={picked.webUrl} target="_blank" rel="noopener noreferrer" className="underline">Open the template in Word ↗</a>
            </div>
          )}

          {file && input && !templateBroken && (
            <>
              {file.check.tags.length === 0 && (
                <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
                  This template has no {"{{fields}}"} — it will print as it is.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {text("clientName", "Client name")}
                {text("salutation", '"Dear …"')}
                {text("email", "Email", { type: "email" })}
                {text("address", "Address", { hint: shown.has("cityStateZip") ? "Street only — the city goes in the next field." : undefined })}
                {text("cityStateZip", "City, State zip", { placeholder: "Kansas City, MO 64105" })}
                {text("hearingType", "Hearing type", { placeholder: "Master Hearing / Individual Hearing" })}
                {text("hearingDate", "Hearing date", { type: "date" })}
                {text("formName", "Form(s) / matter", { placeholder: "I-130" })}
                {text("attorneyName", "Attorney (signs the letter)")}
                {text("creatorInitials", "Your initials")}
                {text("date", "Letter date", { type: "date" })}
                {text("dueDate", "Payment deadline", { type: "date" })}
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                {amount("attorneyFee", "Attorney fee $")}
                {amount("filingFee", "Filing fee $")}
                {amount("postageFee", "Postage $", "Empty prints N/A", "N/A")}
                {amount("interviewFee", "Interview fee $")}
                {amount("surcharge", "Surcharge $", input.surcharge === null ? `3% of AF = ${money(surchargeOf(input))}` : undefined, money(surchargeOf(input)))}
              </div>
              {file.check.tags.includes("total_fee") && (
                <p className="text-sm" style={{ color: "var(--color-ink)" }}>Total fee: <strong className="tabular-nums">{money(totalOf(input))}</strong></p>
              )}
              {problems.length > 0 && (
                <div className="text-sm" style={{ color: "var(--urgency-overdue)" }}>
                  {problems.map((p) => <div key={p}>• {p}</div>)}
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm" style={{ color: "var(--urgency-overdue)" }}>{error}</p>}
          {done && <p className="text-sm" style={{ color: "var(--color-ink)" }}>✓ {done}</p>}

          <div className="flex items-center gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" disabled={!file || templateBroken || problems.length > 0 || busy !== null} onClick={() => generate("docx")}
                title="Download the filled Word file, to make changes before sending">
                {busy === "docx" ? "Filling…" : "Word"}
              </Button>
              <Button type="button" disabled={!file || templateBroken || problems.length > 0 || busy !== null} onClick={() => generate("pdf")}>
                {busy === "pdf" ? "Making PDF…" : "Generate PDF"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
