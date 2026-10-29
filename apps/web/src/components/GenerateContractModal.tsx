// =============================================================================
// GenerateContractModal (M22) — fill a contract template from SharePoint
// =============================================================================
// Templates are the firm's own Word files in the SharePoint folder
// CONTRACT_TEMPLATES_FOLDER, edited by staff in Word; a blank is a {{tag}}
// (lib/contract-fill.ts lists them). Picking one downloads it, checks it —
// broken or unknown tags are shown with a link to fix the file — and shows
// only the fields that template uses, pre-filled from Monday (client, e-mail,
// address, attorney, AF / FF, next hearing) and the signed-in user (initials).
// "From fee sheet" (FeeSheetPicker) fills AF + FF from the firm's fee sheet.
// Send for signature and each Download also make the user the Fee K's
// Assistant when it has none (routes/contract-document.ts).
// Preview fills it in the browser, converts it with the user's Microsoft 365
// (convertDocxToPdf) and shows the PDF in the window; from there it can be
// downloaded or — when the server has Zapier set up — sent for signature.
// Sending only happens from the preview and sends that exact PDF, so what staff
// looked at is what the client gets. Word downloads the filled .docx to edit.
// Nothing is written to Monday until Send; the generation is audited
// (template + fees). Send hands the PDF to Adobe Sign — attorney first, then
// the client — and the API moves the stage, leaves a note and follows the
// signatures (routes/esign.ts).
// A template with a {{#people}} loop or {{people_names}} gets a "Contract is
// for more than one person" box: ticked, everyone the contract covers is
// listed. The client signs and pays but is listed only when the contract is for
// them too (a relative often signs for someone detained); one fee. A Trial template asks for the prep and
// the trial fee separately, each with its own deadline. A template with the
// {{#pro_hac_vice}} clause (Habeas) gets "Includes a pro hac vice motion":
// ticked, the district and the fee; the fee is paid into Operating with the AF,
// so the form says what the Fee K's AF on Monday (= the payment link) should be.
// "Notes · Timeline · Documents" opens the client's case (M3, ClientCaseModal)
// stacked over this form, so checking what was quoted or what is on file never
// throws away a half-filled contract.
// Closing keeps the work: what was typed (fields, template, attorney e-mail) is
// saved in this browser per Fee K and comes back on the next open, with
// "Start over" to go back to the Monday pre-fill. Sending clears it; drafts
// older than 14 days are dropped.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchContractPrefill, fetchEsignStatus, fetchFeeKTypes, logContractGenerated, sendContractForSignature } from "../api";
import type { PendingContract } from "../api";
import { useAuth } from "../auth/useAuth";
import {
  convertDocxToPdf, downloadDriveFile, getGraphToken, listContractTemplates,
  CONTRACT_TEMPLATES_FOLDER, GraphConsentRequiredError, type DriveItem,
} from "../sharepoint/graph";
import {
  contractProblems, fillContractTemplate, inspectContractTemplate, surchargeOf, totalOf, money, halfOf, contractDocumentName, MOTIONS, motionEs, contractTitle, fromFeeKTypes, trialTotalOf,
  proHacViceFeeOf,
  type ContractInput, type ContractPerson, type FeeKTypeText, type TemplateCheck,
} from "../lib/contract-fill";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { FeeSheetPicker } from "./FeeSheetPicker";
import { ClientCaseModal } from "./ClientCaseModal";
import { DateInput } from "./ui/date-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";

interface Props {
  contract: PendingContract;
  onClose: () => void;
  /** After a send to Adobe Sign, with a line for the page. */
  onSent?: (message: string) => void;
}

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" } as const;
const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;
const inputClass = "w-full rounded-md px-2 py-1.5 text-sm";

const today = () => new Date().toISOString().slice(0, 10);
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join("").slice(0, 3);
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[$,\s]/g, "")));
const baseName = (file: string) => file.replace(/\.docx$/i, "");
/** How the COURT templates name a hearing (the API maps Monday's hearing types to these). */
const HEARING_TYPES = ["Master Hearing", "Individual Hearing"];
const NO_PERSON: ContractPerson = { name: "", aNumber: "", dob: "" };
/** The AF recorded with the generation: a Trial contract's is prep + trial; a pro hac vice fee is added (both go to Operating). */
const afOf = (f: ContractInput) => {
  const af = f.attorneyFee ?? (f.trialPrepFee !== null || f.trialFee !== null ? trialTotalOf(f) : null);
  return f.proHacVice && af !== null ? af + proHacViceFeeOf(f) : af;
};
/** Federal districts the firm files habeas petitions in most; any other can be typed. */
const DISTRICTS = ["Western District of Missouri", "Eastern District of Missouri", "District of Kansas"];

// ── Draft kept per Fee K, in this browser only ───────────────────────────────
interface Draft { input: ContractInput; templateId: string | null; attorneyEmail: string; savedAt: string }
const DRAFT_DAYS = 14;
const draftKey = (feeK: string) => `m22-draft:${feeK}`;

export function loadDraft(feeK: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(feeK));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d?.input || Date.now() - Date.parse(d.savedAt) > DRAFT_DAYS * 86_400_000) {
      localStorage.removeItem(draftKey(feeK));
      return null;
    }
    return d;
  } catch {
    return null;
  }
}
function storeDraft(feeK: string, d: Draft) {
  try { localStorage.setItem(draftKey(feeK), JSON.stringify(d)); } catch { /* storage off: nothing kept */ }
}
function clearDraft(feeK: string) {
  try { localStorage.removeItem(draftKey(feeK)); } catch { /* ignore */ }
}
const savedAtLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });

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
  form_name: ["formName"], form_name_es: ["formNameEs"],
  attorney_fee: ["attorneyFee"], filing_fee: ["filingFee"], postage_fee: ["postageFee"],
  surcharge: ["attorneyFee", "surcharge"], total_fee: ["attorneyFee", "filingFee", "postageFee", "surcharge"],
  interview_fee: ["interviewFee"],
  attorney_fee_surcharge: ["attorneyFee"], filing_fee_surcharge: ["filingFee"], postage_fee_surcharge: ["postageFee"],
  attorney_fee_half: ["attorneyFee"], attorney_fee_half_surcharge: ["attorneyFee"],
  bio_fee: ["bioFee"], bio_fee_surcharge: ["bioFee"],
  motion_name: ["motionName"], motion_name_es: ["motionNameEs"],
  motion_fee: ["motionFee"], motion_fee_surcharge: ["motionFee"], hearing_fee: ["hearingFee"], hearing_fee_surcharge: ["hearingFee"],
  people_names: ["people"], people_names_es: ["people"], people_count: ["people"],
  people: ["people"], person_name: ["people"], person_number: ["people"],
  person_a_number: ["people"], person_dob: ["people"], person_dob_es: ["people"], has_people: ["people"],
  trial_prep_fee: ["trialPrepFee"], trial_prep_fee_surcharge: ["trialPrepFee"],
  trial_prep_due_date: ["trialPrepDueDate"], trial_prep_due_date_es: ["trialPrepDueDate"],
  trial_fee: ["trialFee"], trial_fee_surcharge: ["trialFee"],
  trial_due_date: ["trialDueDate"], trial_due_date_es: ["trialDueDate"],
  trial_total_fee: ["trialPrepFee", "trialFee"],
  pro_hac_vice: ["proHacVice"], pro_hac_vice_fee: ["proHacVice", "proHacViceFee"],
  pro_hac_vice_fee_surcharge: ["proHacVice", "proHacViceFee"], pro_hac_vice_district: ["proHacVice", "proHacViceDistrict"],
  services: ["services"], services_es: ["servicesEs"], services_excluded: ["servicesExcluded"], services_excluded_es: ["servicesExcludedEs"],
  sign_by_date: ["signByDate"], sign_by_date_es: ["signByDate"],
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

export function GenerateContractModal({ contract: c, onClose, onSent }: Props) {
  const { user } = useAuth();
  const [input, setInput] = useState<ContractInput | null>(null);
  const [templates, setTemplates] = useState<{ driveId: string; items: DriveItem[] } | null>(null);
  const [picked, setPicked] = useState<DriveItem | null>(null);
  const [file, setFile] = useState<{ id: string; data: ArrayBuffer; check: TemplateCheck } | null>(null);
  // Monday's one-line address, and the same split for a letter (API: letterAddress).
  const [addr, setAddr] = useState<{ full: string; street: string; cityStateZip: string } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [busy, setBusy] = useState<"preview" | "docx" | "send" | null>(null);
  // The PDF being previewed. Leaving the preview drops it, so any edit makes a new one.
  const [preview, setPreview] = useState<{ pdf: Blob; url: string; name: string } | null>(null);
  const previewUrl = useRef<string | null>(null);
  const [esign, setEsign] = useState(false);
  const [attorneyEmail, setAttorneyEmail] = useState("");
  // Who can sign (active roster attorneys + e-mails), from the pre-fill.
  const [attorneys, setAttorneys] = useState<{ name: string; email: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [showCase, setShowCase] = useState(false);
  const [types, setTypes] = useState<{ labels: string[]; rows: FeeKTypeText[] } | null>(null);
  // "Edit the title": the matter typed by hand (a type not on the list, or a wording change).
  const [editTitle, setEditTitle] = useState(false);
  // The Monday pre-fill, for "Start over".
  const prefill = useRef<{ input: ContractInput; attorneyEmail: string } | null>(null);
  // Saved only once someone changes something, so opening and closing leaves no draft.
  const dirty = useRef(false);
  const draftTemplate = useRef<string | null>(null);
  const [resumedAt, setResumedAt] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      const list = await listContractTemplates();
      setTemplates(list);
      // Only one contract in the folder: nothing to choose.
      // A resumed draft's template, when it is still in the folder.
      const fromDraft = list.items.find((i) => i.id === draftTemplate.current);
      if (fromDraft) setPicked((p) => p ?? fromDraft);
      else if (list.items.length === 1) setPicked((p) => p ?? list.items[0]!);
      setNeedsConsent(false);
    } catch (e) {
      if (e instanceof GraphConsentRequiredError) setNeedsConsent(true);
      else setError(e instanceof Error ? `Templates folder: ${e.message}` : "Could not open the templates folder");
    }
  }, []);

  useEffect(() => {
    const draft = loadDraft(c.localId);
    draftTemplate.current = draft?.templateId ?? null;
    void loadTemplates();
    fetchEsignStatus().then((s) => setEsign(s.enabled)).catch(() => setEsign(false));
    // The Fee K Type list (Monday's labels) + each type's Spanish name and scope.
    fetchFeeKTypes()
      .then((t) => setTypes({ labels: t.feeKTypes.length > 0 ? t.feeKTypes : t.rows.map((r) => r.feeKType), rows: t.rows }))
      .catch(() => setTypes({ labels: [], rows: [] }));
    fetchContractPrefill(c.localId)
      .then((p) => {
        setAttorneyEmail(draft?.attorneyEmail ?? p.attorneyEmail ?? "");
        setAttorneys(p.attorneys ?? []);
        setAddr({ full: p.address, street: p.street ?? p.address, cityStateZip: p.cityStateZip ?? "" });
        return p;
      })
      .then((p) => {
        const fresh: ContractInput = {
        date: today(), clientName: p.clientName, salutation: p.clientName, email: p.email,
        // Monday keeps one line; split below when the picked template has a City, State zip line.
        address: p.address, cityStateZip: "",
        hearingType: p.hearingType, hearingDate: p.hearingDate,
        // The matter = the Fee K's type(s), as picked in Monday; changed with the type picker below.
        feeKTypes: p.contractFor, formName: p.formName ?? p.contractFor.join(", "), formNameEs: p.formNameEs ?? "",
        // The Fee K's PF is the postage.
        attorneyFee: p.attorneyFee, filingFee: p.filingFee, postageFee: p.processingFee, surcharge: null, interviewFee: null,
        bioFee: null, motionName: "", motionNameEs: "", motionFee: null, hearingFee: null,
        dueDate: "", signByDate: "", attorneyName: p.attorneyName, creatorInitials: initialsOf(user?.name ?? ""),
        multiplePeople: false, people: [],
        trialPrepFee: null, trialPrepDueDate: "", trialFee: null, trialDueDate: "",
        proHacVice: false, proHacViceFee: null, proHacViceDistrict: "",
        // The Fee K Type's scope of services (Settings → Firm → Fee K Types).
        services: p.scope?.services ?? "", servicesEs: p.scope?.servicesEs ?? "",
        servicesExcluded: p.scope?.excluded ?? "", servicesExcludedEs: p.scope?.excludedEs ?? "",
        };
        prefill.current = { input: fresh, attorneyEmail: p.attorneyEmail ?? "" };
        if (draft) {
          // A letter date left at the day it was saved means "today", so it moves on.
          const date = draft.input.date === draft.savedAt.slice(0, 10) ? today() : draft.input.date;
          setInput({ ...fresh, ...draft.input, date });
          setResumedAt(draft.savedAt);
          dirty.current = true;
        } else {
          setInput(fresh);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the contract"));
  }, [c.localId, loadTemplates, user?.name]);

  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  const showPreview = (next: { pdf: Blob; name: string } | null) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = next ? URL.createObjectURL(next.pdf) : null;
    setPreview(next && previewUrl.current ? { ...next, url: previewUrl.current } : null);
  };

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

  // A template with its own "City, State zip" line gets the address split;
  // one without keeps the whole line. Only while the fields are as pre-filled.
  const splitsAddress = shown.has("cityStateZip");
  useEffect(() => {
    if (!addr || !addr.cityStateZip) return;
    setInput((f) => {
      if (!f) return f;
      if (splitsAddress && f.address === addr.full && f.cityStateZip === "") return { ...f, address: addr.street, cityStateZip: addr.cityStateZip };
      if (!splitsAddress && f.address === addr.street && f.cityStateZip === addr.cityStateZip) return { ...f, address: addr.full, cityStateZip: "" };
      return f;
    });
  }, [splitsAddress, addr]);
  const problems = file && input ? contractProblems(file.check, input) : [];
  const templateBroken = !!file && (file.check.errors.length > 0 || file.check.unknown.length > 0);

  const set = <K extends keyof ContractInput>(k: K, v: ContractInput[K]) => {
    dirty.current = true;
    setInput((f) => (f ? { ...f, [k]: v } : f));
  };

  // Keep the draft as it is typed.
  useEffect(() => {
    if (!input || !dirty.current) return;
    storeDraft(c.localId, { input, templateId: picked?.id ?? null, attorneyEmail, savedAt: new Date().toISOString() });
  }, [c.localId, input, picked, attorneyEmail]);

  const startOver = () => {
    clearDraft(c.localId);
    dirty.current = false;
    draftTemplate.current = null;
    setResumedAt(null);
    showPreview(null);
    setDone(null);
    setError(null);
    if (prefill.current) {
      setInput(prefill.current.input);
      setAttorneyEmail(prefill.current.attorneyEmail);
    }
    const items = templates?.items ?? [];
    setPicked(items.length === 1 ? items[0]! : null);
  };

  const text = (k: keyof ContractInput, label: string, extra?: { type?: string; placeholder?: string; hint?: string }) =>
    shown.has(k) && input ? (
      <Field id={`m22-${k}`} label={label} hint={extra?.hint}>
        {extra?.type === "date" ? (
          <DateInput id={`m22-${k}`} className={inputClass} style={inputStyle}
            value={(input[k] as string | null) ?? ""} onChange={(e) => set(k, e.target.value as never)} />
        ) : (
          <input id={`m22-${k}`} type={extra?.type ?? "text"} placeholder={extra?.placeholder} className={inputClass} style={inputStyle}
            value={(input[k] as string | null) ?? ""} onChange={(e) => set(k, e.target.value as never)} />
        )}
      </Field>
    ) : null;
  const longText = (k: keyof ContractInput, label: string, hint?: string) =>
    shown.has(k) && input ? (
      <Field id={`m22-${k}`} label={label} hint={hint}>
        <textarea id={`m22-${k}`} rows={3} className={inputClass} style={inputStyle}
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

  const setPerson = (i: number, patch: Partial<ContractPerson>) => {
    dirty.current = true;
    setInput((f) => (f ? { ...f, people: f.people.map((p, j) => (j === i ? { ...p, ...patch } : p)) } : f));
  };
  const addPerson = (name = "") => {
    dirty.current = true;
    setInput((f) => {
      if (!f) return f;
      // Filling the first empty row beats adding one below it.
      const empty = name ? f.people.findIndex((p) => !p.name.trim()) : -1;
      const people = empty >= 0 ? f.people.map((p, j) => (j === empty ? { ...p, name } : p)) : [...f.people, { ...NO_PERSON, name }];
      return { ...f, people };
    });
  };
  /** Ticking starts two empty rows; unticking keeps what was typed, unused. */
  const setMultiple = (on: boolean) => {
    dirty.current = true;
    setInput((f) => (f ? { ...f, multiplePeople: on, people: on && f.people.length === 0 ? [NO_PERSON, NO_PERSON] : f.people } : f));
  };
  const removePerson = (i: number) => {
    dirty.current = true;
    setInput((f) => (f ? { ...f, people: f.people.filter((_, j) => j !== i) } : f));
  };

  /** Pick / drop a Fee K Type: the matter (EN + ES) and the scope follow. */
  const setTypesPicked = (picked: string[]) => {
    dirty.current = true;
    setInput((f) => (f ? { ...f, ...fromFeeKTypes(picked, types?.rows ?? []) } : f));
  };

  /** Pick the attorney: their name for the letter and their e-mail for Adobe Sign go together. */
  const pickAttorney = (name: string) => {
    const a = attorneys.find((x) => x.name === name);
    dirty.current = true;
    setInput((f) => (f ? { ...f, attorneyName: name } : f));
    if (a?.email) setAttorneyEmail(a.email);
  };
  const attorneyByEmail = (email: string) => attorneys.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());

  const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
  const sendReady = !!input && emailOk(attorneyEmail) && emailOk(input.email)
    && attorneyEmail.trim().toLowerCase() !== input.email.trim().toLowerCase();

  const sendForSignature = async () => {
    if (!input || !picked || !preview || !sendReady) return;
    setBusy("send");
    setError(null);
    setDone(null);
    try {
      // Exactly the PDF on screen.
      const res = await sendContractForSignature(c.localId, preview.pdf, {
        attorneyEmail: attorneyEmail.trim(), clientEmail: input.email.trim(), documentName: preview.name,
      });
      void logContractGenerated(c.localId, { template: picked.name, format: "pdf", attorneyFee: afOf(input), filingFee: input.filingFee });
      // Sent: nothing left to resume.
      dirty.current = false;
      clearDraft(c.localId);
      const msg = `${c.clientName}: sent to Adobe Sign (attorney first, then the client)${res.stage ? ` · stage → ${res.stage}` : ""}`;
      if (res.warning) setDone(`Sent to Adobe Sign. ${res.warning}`);
      else { onSent?.(msg); onClose(); }
    } catch (e) {
      if (e instanceof GraphConsentRequiredError) setNeedsConsent(true);
      else setError(e instanceof Error ? e.message : "Could not send the contract");
    } finally {
      setBusy(null);
    }
  };

  const generate = async (format: "preview" | "docx") => {
    if (!input || !file || !picked || problems.length > 0) return;
    setBusy(format);
    setError(null);
    setDone(null);
    try {
      const docx = fillContractTemplate(file.data, input);
      const name = contractDocumentName(input, file.check.tags);
      if (format === "docx") {
        save(docx, `${name}.docx`);
        setDone(`Downloaded ${name}.docx`);
        void logContractGenerated(c.localId, { template: picked.name, format: "docx", attorneyFee: afOf(input), filingFee: input.filingFee });
        return;
      }
      showPreview({ pdf: await convertDocxToPdf(docx, `${name}.docx`), name });
    } catch (e) {
      if (e instanceof GraphConsentRequiredError) setNeedsConsent(true);
      else setError(e instanceof Error ? e.message : "Could not generate the contract");
    } finally {
      setBusy(null);
    }
  };

  const downloadPdf = () => {
    if (!preview || !input || !picked) return;
    save(preview.pdf, `${preview.name}.pdf`);
    setDone(`Downloaded ${preview.name}.pdf`);
    void logContractGenerated(c.localId, { template: picked.name, format: "pdf", attorneyFee: afOf(input), filingFee: input.filingFee });
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
      <DialogContent code="M22" className={`gap-0 p-0 max-h-[94vh] overflow-y-auto ${preview ? "sm:max-w-[960px]" : "sm:max-w-[640px]"}`}>
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Generate contract</DialogTitle>
          <DialogDescription>{c.clientName}{c.contractFor.length > 0 ? ` · ${c.contractFor.join(", ")}` : ""}</DialogDescription>
          {c.clientLocalId && (
            <button type="button" onClick={() => setShowCase(true)}
              className="self-start text-xs underline mt-1" style={{ color: "var(--color-amber)", fontFamily: "var(--font-body)" }}
              title="The client's notes, timeline and documents, over this form — nothing here is lost">
              Notes · Timeline · Documents
            </button>
          )}
        </DialogHeader>

        {preview && input ? (
          <div className="px-5 py-4 space-y-3">
            <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
              Check every page — this exact PDF is what {esign ? "goes to Adobe Sign" : "you download"}. To change something, go back to the form.
            </p>
            <iframe title="Contract preview" src={`${preview.url}#view=FitH`} className="w-full block rounded"
              style={{ height: "min(70vh, 900px)", border: "1px solid var(--color-border-light)" }} />
            {esign && (
              <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                Signers: <strong>{attorneyEmail.trim() || "attorney e-mail missing"}</strong> first, then <strong>{input.email.trim() || "client e-mail missing"}</strong>.
                {!sendReady && " Go back and fix the e-mails to send."}
              </p>
            )}
            {error && <p className="text-sm" style={{ color: "var(--urgency-overdue)" }}>{error}</p>}
            {done && <p className="text-sm" style={{ color: "var(--color-ink)" }}>✓ {done}</p>}
            <div className="flex items-center gap-2 pt-1">
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => { showPreview(null); setDone(null); setError(null); }}>
                ← Back to edit
              </Button>
              <div className="ml-auto flex gap-2">
                <Button type="button" variant={esign ? "outline" : undefined} disabled={busy !== null} onClick={downloadPdf}
                  title={esign ? "Download this PDF instead of sending it" : "Download this PDF — send it from Acrobat (attorney first, then the client)"}>
                  Download PDF
                </Button>
                {esign && (
                  <Button type="button" disabled={!sendReady || busy !== null} onClick={sendForSignature}
                    title="Send this PDF to Adobe Sign: attorney first, then the client">
                    {busy === "send" ? "Sending…" : "Send for signature"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : (
        <div className="px-5 py-4 space-y-4">
          {resumedAt && (
            <div className="text-sm rounded p-3 flex items-center gap-2" style={{ background: "var(--color-surface-warm)", border: "1px solid var(--color-border-light)", color: "var(--color-ink)" }}>
              Picked up where you left off — saved {savedAtLabel(resumedAt)}.
              <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={startOver}
                title="Drop this draft and start again from what Monday has">
                Start over
              </Button>
            </div>
          )}
          {needsConsent && (
            <div className="text-sm rounded p-3 flex items-center gap-2" style={{ background: "var(--color-amber-light)", color: "var(--color-ink)" }}>
              The templates and the PDF use your Microsoft 365 account, which needs your OK once.
              <Button type="button" size="sm" className="ml-auto" onClick={allowMicrosoft}>Allow</Button>
            </div>
          )}

          <Field id="m22-template" label="Contract template"
            hint={templates && items.length === 0 ? "No Word templates in the folder yet." : undefined}>
            <div className="flex items-center gap-2">
              <Select items={selectItems} value={picked?.id ?? ""} onValueChange={(v) => { dirty.current = true; setDone(null); setError(null); setPicked(items.find((i) => i.id === v) ?? null); }}>
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
                {shown.has("hearingType") && (
                  <Field id="m22-hearingType" label="Hearing type">
                    <select id="m22-hearingType" className={inputClass} style={inputStyle} value={input.hearingType}
                      onChange={(e) => set("hearingType", e.target.value)}>
                      <option value="">Select…</option>
                      {HEARING_TYPES.map((h) => <option key={h} value={h}>{h}</option>)}
                      {/* A label Monday had that isn't one of the two stays visible, to be changed. */}
                      {input.hearingType && !HEARING_TYPES.includes(input.hearingType) && <option value={input.hearingType}>{input.hearingType}</option>}
                    </select>
                  </Field>
                )}
                {text("hearingDate", "Hearing date", { type: "date" })}
                {(shown.has("formName") || shown.has("formNameEs")) && (() => {
                  const labels = types?.labels ?? [];
                  const picked = input.feeKTypes;
                  return (
                    <div className="sm:col-span-2 rounded-md p-3 space-y-2" style={{ border: "1px solid var(--color-border-light)" }}>
                      <label style={labelStyle} htmlFor="m22-feeKType">Case type (Fee K Type)</label>
                      {picked.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {picked.map((t) => (
                            <span key={t} className="text-xs rounded px-2 py-1 inline-flex items-center gap-1"
                              style={{ background: "var(--color-surface-warm)", border: "1px solid var(--color-border-light)", color: "var(--color-ink)" }}>
                              {contractTitle(t)}
                              <button type="button" aria-label={`Remove ${t}`} title="Remove"
                                onClick={() => setTypesPicked(picked.filter((x) => x !== t))}>✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <select id="m22-feeKType" aria-label="Add a case type" className={inputClass} style={inputStyle} value=""
                        disabled={!types} onChange={(e) => { if (e.target.value) setTypesPicked([...picked, e.target.value]); }}>
                        <option value="">{!types ? "Loading types…" : picked.length > 0 ? "+ Add another type…" : "Pick a type…"}</option>
                        {labels.filter((l) => !picked.includes(l)).map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                        Prints: <strong>{input.formName || "—"}</strong>
                        {shown.has("formNameEs") && <> / <em>{input.formNameEs || input.formName || "—"}</em></>}
                        {" · "}
                        <button type="button" className="underline" onClick={() => setEditTitle((v) => !v)}>
                          {editTitle ? "Done" : "Edit the title"}
                        </button>
                      </p>
                      {editTitle && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input aria-label="Title in English" className={inputClass} style={inputStyle} value={input.formName}
                            onChange={(e) => set("formName", e.target.value)} />
                          {shown.has("formNameEs") && (
                            <input aria-label="Title in Spanish" className={inputClass} style={inputStyle} value={input.formNameEs}
                              onChange={(e) => set("formNameEs", e.target.value)} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {shown.has("motionName") && (
                  <Field id="m22-motionName" label="Motion" hint="Pick one, or type another.">
                    <input id="m22-motionName" list="m22-motions" placeholder="Motion to Recalendar" className={inputClass} style={inputStyle}
                      value={input.motionName}
                      onChange={(e) => {
                        const en = e.target.value;
                        // A listed motion brings its Spanish name; a typed one leaves Spanish to the user.
                        const es = motionEs(en);
                        dirty.current = true;
                        setInput((f) => (f ? { ...f, motionName: en, motionNameEs: es || (motionEs(f.motionName) ? "" : f.motionNameEs) } : f));
                      }} />
                    <datalist id="m22-motions">{MOTIONS.map((m) => <option key={m.en} value={m.en} />)}</datalist>
                  </Field>
                )}
                {text("motionNameEs", "Motion, Spanish", { placeholder: "Moción para Recalendarizar" })}
                {shown.has("attorneyName") && (
                  <Field id="m22-attorneyName" label="Attorney (signs the letter)"
                    hint={input.attorneyName && !attorneys.some((a) => a.name === input.attorneyName) ? "Not an active attorney on the staff roster — pick one." : undefined}>
                    <select id="m22-attorneyName" className={inputClass} style={inputStyle} value={input.attorneyName}
                      onChange={(e) => pickAttorney(e.target.value)}>
                      <option value="">Select…</option>
                      {attorneys.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                      {input.attorneyName && !attorneys.some((a) => a.name === input.attorneyName) && <option value={input.attorneyName}>{input.attorneyName}</option>}
                    </select>
                  </Field>
                )}
                {text("creatorInitials", "Your initials")}
                {text("date", "Letter date", { type: "date" })}
                {text("signByDate", "Signed contract due", { type: "date" })}
                {text("dueDate", "Payment deadline", { type: "date" })}
                {text("trialPrepDueDate", "Trial prep fee due", { type: "date" })}
                {text("trialDueDate", "Trial fee due", { type: "date" })}
              </div>
              {shown.has("people") && (() => {
                const withANumber = file.check.tags.includes("person_a_number");
                const withDob = file.check.tags.includes("person_dob") || file.check.tags.includes("person_dob_es");
                const cols = `1.5rem minmax(0,1fr)${withANumber ? " 9rem" : ""}${withDob ? " 9.5rem" : ""} 2rem`;
                const signer = input.clientName.trim();
                const signerListed = input.people.some((p) => p.name.trim().toLowerCase() === signer.toLowerCase());
                return (
                  <div className="rounded-md p-3 space-y-2" style={{ border: "1px solid var(--color-border-light)" }}>
                    <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                      <input type="checkbox" checked={input.multiplePeople} onChange={(e) => setMultiple(e.target.checked)} />
                      Contract is for more than one person
                    </label>
                    {input.multiplePeople && (
                      <>
                        <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
                          List everyone the contract covers. One fee; only {signer || "the client"} signs and pays, and is listed only if the contract is for them too.
                        </p>
                        <div className="grid gap-2 items-center text-xs" style={{ gridTemplateColumns: cols, color: "var(--color-ink-muted)" }}>
                          <span />
                          <span>Name</span>{withANumber && <span>A#</span>}{withDob && <span>Date of birth</span>}<span />
                        </div>
                        {input.people.map((p, i) => (
                          <div key={i} className="grid gap-2 items-center" style={{ gridTemplateColumns: cols }}>
                            <span className="text-xs text-right" style={{ color: "var(--color-ink-faint)" }}>{i + 1}.</span>
                            <input aria-label={`Person ${i + 1} name`} placeholder="Name" className={inputClass} style={inputStyle} value={p.name}
                              onChange={(e) => setPerson(i, { name: e.target.value })} />
                            {withANumber && <input aria-label={`Person ${i + 1} A#`} className={inputClass} style={inputStyle} value={p.aNumber}
                              onChange={(e) => setPerson(i, { aNumber: e.target.value })} />}
                            {withDob && <DateInput aria-label={`Person ${i + 1} date of birth`} className={inputClass} style={inputStyle} value={p.dob}
                              onChange={(e) => setPerson(i, { dob: e.target.value })} />}
                            <button type="button" onClick={() => removePerson(i)} aria-label={`Remove person ${i + 1}`} title="Remove"
                              className="text-sm rounded hover:underline" style={{ color: "var(--color-ink-muted)" }}>✕</button>
                          </div>
                        ))}
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => addPerson()}>+ Add person</Button>
                          {signer && !signerListed && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => addPerson(signer)}
                              title="Only when the contract also covers the person who signs">
                              + Add {signer} (signer)
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
              {shown.has("proHacVice") && (() => {
                // Paid into Operating with the AF: the AF link is Monday's AF, so it should include the fee.
                const operating = (input.attorneyFee ?? 0) + proHacViceFeeOf(input);
                const mondayAf = prefill.current?.input.attorneyFee ?? null;
                return (
                  <div className="rounded-md p-3 space-y-2" style={{ border: "1px solid var(--color-border-light)" }}>
                    <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                      <input type="checkbox" checked={input.proHacVice} onChange={(e) => set("proHacVice", e.target.checked)} />
                      Includes a pro hac vice motion
                    </label>
                    {input.proHacVice && (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {shown.has("proHacViceDistrict") && (
                            <Field id="m22-proHacViceDistrict" label="Federal district" hint="Pick one, or type another.">
                              <input id="m22-proHacViceDistrict" list="m22-districts" placeholder="Western District of Missouri" className={inputClass} style={inputStyle}
                                value={input.proHacViceDistrict} onChange={(e) => set("proHacViceDistrict", e.target.value)} />
                              <datalist id="m22-districts">{DISTRICTS.map((d) => <option key={d} value={d} />)}</datalist>
                            </Field>
                          )}
                          {amount("proHacViceFee", "Pro hac vice fee $", "As agreed with the attorney")}
                        </div>
                        {input.proHacViceFee !== null && input.proHacViceFee > 0 && (
                          <p className="text-xs rounded p-2" style={mondayAf === operating ? { color: "var(--color-ink-faint)" } : { background: "var(--color-amber-light)", color: "var(--color-ink)" }}>
                            Paid into Operating with the attorney fee: the AF payment link should be <strong>{money(operating)}</strong> (+ 3% by card).
                            {mondayAf !== operating && <> The Fee K&apos;s AF on Monday is {mondayAf === null ? "empty" : money(mondayAf)} — change it with <strong>Edit contract…</strong> (Contracts) before sending the payment links.</>}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
              {(shown.has("services") || shown.has("servicesExcluded")) && (
                <div className="rounded-md p-3 space-y-3" style={{ border: "1px solid var(--color-border-light)" }}>
                  <div className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>Scope of services</div>
                  <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
                    From the Fee K Type (Settings → Firm → Fee K Types). Change it here for this contract only; empty prints nothing extra.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {longText("services", "Included")}
                    {longText("servicesEs", "Included, Spanish")}
                    {longText("servicesExcluded", "Not included")}
                    {longText("servicesExcludedEs", "Not included, Spanish")}
                  </div>
                </div>
              )}
              {(shown.has("attorneyFee") || shown.has("filingFee")) && (
                <FeeSheetPicker onPick={(fees) => { dirty.current = true; setInput((f) => (f ? { ...f, ...fees } : f)); }} />
              )}
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                {amount("attorneyFee", "Attorney fee $", file.check.tags.includes("attorney_fee_half") ? `Printed as two halves of ${money(halfOf(input.attorneyFee))}` : undefined)}
                {amount("trialPrepFee", "Trial prep fee $")}
                {amount("trialFee", "Trial fee $")}
                {amount("motionFee", "Motion fee $")}
                {amount("hearingFee", "Hearing fee $")}
                {amount("filingFee", "Filing fee $")}
                {amount("postageFee", "Postage $", "Empty prints N/A", "N/A")}
                {amount("interviewFee", "Interview fee $")}
                {amount("bioFee", "DHS bio fee $", "Empty prints N/A", "N/A")}
                {amount("surcharge", "Surcharge $", input.surcharge === null ? `3% of AF + FF + postage${input.proHacVice ? " + pro hac vice" : ""} = ${money(surchargeOf(input))}` : undefined, money(surchargeOf(input)))}
              </div>
              {file.check.tags.includes("trial_total_fee") && (
                <p className="text-sm" style={{ color: "var(--color-ink)" }}>Trial prep + trial: <strong className="tabular-nums">{money(trialTotalOf(input))}</strong></p>
              )}
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

          {esign && file && input && !templateBroken && (
            <div className="rounded-md p-3 space-y-2" style={{ border: "1px solid var(--color-border-light)" }}>
              <div className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>Send for signature (Adobe Sign)</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="m22-atty-email" label="1. Attorney signs first"
                  hint={!attorneyEmail ? "Pick the attorney." : attorneyByEmail(attorneyEmail) ? attorneyEmail : `${attorneyEmail} — not an attorney's e-mail on the staff roster`}>
                  <select id="m22-atty-email" className={inputClass} style={inputStyle} value={attorneyEmail}
                    onChange={(e) => {
                      dirty.current = true;
                      setAttorneyEmail(e.target.value);
                      // The letter's signer follows, when the template names one.
                      const a = attorneyByEmail(e.target.value);
                      if (a) setInput((f) => (f ? { ...f, attorneyName: a.name } : f));
                    }}>
                    <option value="">Select…</option>
                    {attorneys.filter((a) => a.email).map((a) => <option key={a.email} value={a.email}>{a.name}</option>)}
                    {attorneyEmail && !attorneyByEmail(attorneyEmail) && <option value={attorneyEmail}>{attorneyEmail}</option>}
                  </select>
                </Field>
                <Field id="m22-client-email" label="2. Then the client">
                  <input id="m22-client-email" type="email" className={inputClass} style={inputStyle}
                    value={input.email} onChange={(e) => set("email", e.target.value)} />
                </Field>
              </div>
              {file.check.signTags.length === 0 && (
                <p className="text-xs rounded p-2" style={{ background: "var(--color-amber-light)", color: "var(--color-ink)" }}>
                  This template has no Adobe signing tags, so Adobe will add a signature page at the end instead of using the
                  contract&apos;s own signature, initials and address lines. Add the tags to the Word template (see the READ ME in the folder).
                </p>
              )}
              <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
                Preview first, then send from the preview. Sending moves the stage to Atty Reviewing and leaves a note on Monday.
                Each signature updates the stage by itself; you get a Monday notification when the client signs.
              </p>
            </div>
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
              <Button type="button" disabled={!file || templateBroken || problems.length > 0 || busy !== null} onClick={() => generate("preview")}
                title="Make the PDF and show it here, to check before downloading or sending">
                {busy === "preview" ? "Making PDF…" : "Preview PDF"}
              </Button>
            </div>
          </div>
        </div>
        )}
        {showCase && c.clientLocalId && (
          <ClientCaseModal
            profileLocalId={c.clientLocalId}
            profileName={c.clientName}
            onClose={() => setShowCase(false)}
            behind="the contract"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
