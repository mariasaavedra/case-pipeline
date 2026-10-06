// =============================================================================
// GenerateDocModal (M23) — build a document for a client from P3.0
// =============================================================================
// First pick which document; today only the G-28 (Notice of Entry of
// Appearance). Its fields then show pre-filled — the attorney from Settings →
// Documents (the client's own attorney when it matches), the client from
// Monday, a detained client's facility as their mailing address — and every
// one is editable. Generate fills the official USCIS PDF on the server
// (apps/api/src/documents/g28.ts), downloads it, and puts a copy in the
// client's SharePoint folder with the user's own Microsoft 365 access.
// Nothing is written to Monday.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  fetchG28Form, generateG28,
  type AttorneyInfo, type ClientCaseSummary, type FirmInfo, type G28Address, type G28Form, type G28Input,
} from "../api";
import { collectClientFolders } from "../sharepoint/collectFolders";
import { GraphConsentRequiredError, getGraphToken, resolveFolder, uploadFile } from "../sharepoint/graph";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";

interface Props {
  data: ClientCaseSummary;
  onClose: () => void;
}

const DOCUMENTS = [{ value: "g28", label: "G-28 — Notice of Entry of Appearance" }];

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "PR",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const ROLES: { value: G28Input["matter"]["clientRole"]; label: string }[] = [
  { value: "respondent", label: "Respondent (ICE, CBP)" },
  { value: "applicant", label: "Applicant" },
  { value: "petitioner", label: "Petitioner" },
  { value: "requestor", label: "Requestor" },
  { value: "beneficiary", label: "Beneficiary / Derivative" },
];

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" } as const;
const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;
const inputClass = "w-full rounded-md px-2 py-1.5 text-sm";
const sectionTitle = { fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600, color: "var(--color-ink)" } as const;

const digits = (s: string) => s.replace(/\D/g, "");

/** Same as attorneyFields in apps/api/src/documents/g28.ts — switching attorney in the popup. */
function attorneyFields(a: AttorneyInfo, firm: FirmInfo, barState?: string): G28Input["attorney"] {
  const bar = a.bars.find((b) => b.state === (barState ?? a.defaultBar)) ?? a.bars[0];
  return {
    id: a.id, familyName: a.familyName, givenName: a.givenName, middleName: "", uscisAccount: a.uscisAccount,
    address: {
      street: firm.street, unitType: firm.suite ? "ste" : "", unit: firm.suite, city: firm.city, state: firm.state,
      zip: firm.zip, province: "", postalCode: "", country: "UNITED STATES OF AMERICA",
    },
    phone: digits(firm.phone), mobile: digits(a.mobile), email: a.email, fax: digits(firm.fax),
    licensingAuthority: bar?.state ?? "", barNumber: bar?.number ?? "", firmName: firm.name, subjectToOrders: false,
  };
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Field({ id, label, hint, children, wide }: { id: string; label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label style={labelStyle} htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: "var(--color-ink-faint)" }}>{hint}</p>}
    </div>
  );
}

type Saved = { kind: "sharepoint"; url: string; folder: string } | { kind: "no-folder" } | { kind: "failed"; message: string };

export function GenerateDocModal({ data, onClose }: Props) {
  const [docType, setDocType] = useState<string>("g28");
  const [form, setForm] = useState<G28Form | null>(null);
  const [input, setInput] = useState<G28Input | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ filename: string; saved: Saved } | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);

  const folders = useMemo(() => collectClientFolders(data).filter((f) => f.parsed), [data]);
  // The live e-file first; a consult folder only when there is no e-file.
  const [folderUrl, setFolderUrl] = useState<string>(() => (folders.find((f) => f.label === "e-file") ?? folders[0])?.url ?? "");

  useEffect(() => {
    if (docType !== "g28") return;
    fetchG28Form(data.profile.localId)
      .then((f) => { setForm(f); setInput(f.input); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the client"));
  }, [docType, data.profile.localId]);

  const limit = (key: string) => form?.limits[key];

  const setSection = <S extends keyof G28Input>(section: S, patch: Partial<G28Input[S]>) =>
    setInput((i) => (i ? { ...i, [section]: { ...i[section], ...patch } } : i));
  const setAddress = (section: "attorney" | "client", patch: Partial<G28Address>) =>
    setInput((i) => (i ? { ...i, [section]: { ...i[section], address: { ...i[section].address, ...patch } } } : i));

  const text = <S extends "attorney" | "matter" | "client">(
    section: S, key: keyof G28Input[S] & string, label: string, extra?: { hint?: string; placeholder?: string; wide?: boolean; upper?: boolean },
  ) => {
    if (!input) return null;
    const id = `m23-${section}-${key}`;
    return (
      <Field id={id} label={label} hint={extra?.hint} wide={extra?.wide}>
        <input id={id} className={inputClass} style={inputStyle} placeholder={extra?.placeholder} maxLength={limit(`${section}.${key}`)}
          value={String(input[section][key] ?? "")}
          onChange={(e) => setSection(section, { [key]: extra?.upper ? e.target.value.toUpperCase() : e.target.value } as Partial<G28Input[S]>)} />
      </Field>
    );
  };

  const address = (section: "attorney" | "client") => {
    if (!input) return null;
    const a = input[section].address;
    const id = (k: string) => `m23-${section}-addr-${k}`;
    const lim = (k: string) => limit(`${section}.address.${k}`);
    return (
      <>
        <Field id={id("street")} label="Street number and name" wide>
          <input id={id("street")} className={inputClass} style={inputStyle} maxLength={lim("street")} value={a.street} onChange={(e) => setAddress(section, { street: e.target.value })} />
        </Field>
        <Field id={id("unit")} label="Apt / Ste / Flr">
          <div className="flex gap-2">
            <select aria-label="Unit type" className="rounded-md px-2 py-1.5 text-sm" style={inputStyle} value={a.unitType}
              onChange={(e) => setAddress(section, { unitType: e.target.value as G28Address["unitType"] })}>
              <option value="">—</option><option value="apt">Apt.</option><option value="ste">Ste.</option><option value="flr">Flr.</option>
            </select>
            <input id={id("unit")} className={inputClass} style={inputStyle} maxLength={lim("unit")} value={a.unit} onChange={(e) => setAddress(section, { unit: e.target.value })} />
          </div>
        </Field>
        <Field id={id("city")} label="City or town">
          <input id={id("city")} className={inputClass} style={inputStyle} maxLength={lim("city")} value={a.city} onChange={(e) => setAddress(section, { city: e.target.value })} />
        </Field>
        <Field id={id("state")} label="State">
          <select id={id("state")} className={inputClass} style={inputStyle} value={a.state} onChange={(e) => setAddress(section, { state: e.target.value })}>
            <option value="">—</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field id={id("zip")} label="ZIP code">
          <input id={id("zip")} inputMode="numeric" className={inputClass} style={inputStyle} maxLength={lim("zip")} value={a.zip} onChange={(e) => setAddress(section, { zip: digits(e.target.value) })} />
        </Field>
        <Field id={id("country")} label="Country">
          <input id={id("country")} className={inputClass} style={inputStyle} value={a.country} onChange={(e) => setAddress(section, { country: e.target.value })} />
        </Field>
      </>
    );
  };

  const pickAttorney = (id: string) => {
    const a = form?.attorneys.find((x) => x.id === id);
    if (a && form) setSection("attorney", attorneyFields(a, form.firm));
  };
  const currentAttorney = form?.attorneys.find((a) => a.id === input?.attorney.id) ?? null;

  /** Upload to the chosen client folder; never throws — the PDF is already downloaded. */
  const saveToSharePoint = async (blob: Blob, filename: string): Promise<Saved> => {
    const folder = folders.find((f) => f.url === folderUrl);
    if (!folder?.parsed) return { kind: "no-folder" };
    try {
      const target = await resolveFolder(folder.parsed);
      const item = await uploadFile(target.driveId, target.itemId, new File([blob], filename, { type: "application/pdf" }));
      return { kind: "sharepoint", url: item.webUrl, folder: target.name };
    } catch (e) {
      if (e instanceof GraphConsentRequiredError) setNeedsConsent(true);
      return { kind: "failed", message: e instanceof Error ? e.message : "upload failed" };
    }
  };

  const generate = async () => {
    if (!input) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { blob, filename } = await generateG28(data.profile.localId, input);
      save(blob, filename);
      setDone({ filename, saved: await saveToSharePoint(blob, filename) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the G-28");
    } finally {
      setBusy(false);
    }
  };

  // From the click itself, so the browser allows the Microsoft popup.
  const allowMicrosoft = async () => {
    try {
      await getGraphToken(true);
      setNeedsConsent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microsoft 365 access was not granted");
    }
  };

  const clientName = data.profile.displayName || data.profile.name;
  const detained = form?.detainedAt;
  const m = input?.matter;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M23" className="gap-0 p-0 sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Generate document</DialogTitle>
          <DialogDescription>{clientName}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-5">
          <Field id="m23-doc" label="Document">
            <Select items={DOCUMENTS} value={docType} onValueChange={(v) => { setDone(null); setDocType(v as string); }}>
              <SelectTrigger id="m23-doc" aria-label="Document" size="sm" className="w-full border-border-light bg-surface">
                <SelectValue placeholder="Pick a document…" />
              </SelectTrigger>
              <SelectContent className="w-[var(--anchor-width)]">
                {DOCUMENTS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          {!input && !error && <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading the client…</p>}

          {input && form && m && (
            <>
              {detained && (
                <div className="text-sm rounded p-3 space-y-1" style={{ background: "var(--color-amber-light)", color: "var(--color-ink)" }}>
                  <div>
                    Detained at <strong>{detained}</strong>.{" "}
                    {form.facilityMissing
                      ? "That facility has no address in Settings → Documents, so the profile address is used — check it."
                      : "The mailing address is the facility's."}
                  </div>
                  {(form.profileContact.phone || form.profileContact.email) && (
                    <div style={{ color: "var(--color-ink-muted)" }}>
                      Left out (likely family's): {[form.profileContact.phone, form.profileContact.email].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              )}

              {/* ---- Part 1–2: attorney ---- */}
              <section className="space-y-3">
                <h3 style={sectionTitle}>Attorney</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="m23-attorney" label="Attorney" hint={form.mondayAttorney ? `Monday: ${form.mondayAttorney}` : undefined}>
                    <select id="m23-attorney" className={inputClass} style={inputStyle} value={input.attorney.id} onChange={(e) => pickAttorney(e.target.value)}>
                      {!currentAttorney && <option value="">— typed by hand —</option>}
                      {form.attorneys.map((a) => <option key={a.id} value={a.id}>{a.givenName} {a.familyName}</option>)}
                    </select>
                  </Field>
                  {currentAttorney && currentAttorney.bars.length > 1 ? (
                    <Field id="m23-bar" label="Bar admission">
                      <select id="m23-bar" className={inputClass} style={inputStyle} value={input.attorney.licensingAuthority}
                        onChange={(e) => {
                          const bar = currentAttorney.bars.find((b) => b.state === e.target.value);
                          if (bar) setSection("attorney", { licensingAuthority: bar.state, barNumber: bar.number });
                        }}>
                        {currentAttorney.bars.map((b) => <option key={b.state} value={b.state}>{b.state} — {b.number}</option>)}
                      </select>
                    </Field>
                  ) : <div className="hidden sm:block" />}
                  {text("attorney", "familyName", "Family name (last)")}
                  {text("attorney", "givenName", "Given name (first)")}
                  {text("attorney", "licensingAuthority", "Licensing authority")}
                  {text("attorney", "barNumber", "Bar number")}
                  {text("attorney", "uscisAccount", "USCIS online account no.")}
                  {text("attorney", "email", "Email")}
                  {text("attorney", "phone", "Daytime phone")}
                  {text("attorney", "mobile", "Mobile phone")}
                  {text("attorney", "fax", "Fax")}
                  {text("attorney", "firmName", "Law firm")}
                </div>
                <details>
                  <summary className="text-xs cursor-pointer" style={{ color: "var(--color-ink-muted)" }}>
                    Firm address — {[input.attorney.address.street, input.attorney.address.city, input.attorney.address.state].filter(Boolean).join(", ")}
                  </summary>
                  <div className="grid gap-3 sm:grid-cols-2 mt-3">{address("attorney")}</div>
                </details>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink)" }}>
                  <input type="checkbox" checked={input.attorney.subjectToOrders} onChange={(e) => setSection("attorney", { subjectToOrders: e.target.checked })} />
                  <span>The attorney <strong>is</strong> subject to an order restricting their practice (Part 2, 1.c)</span>
                </label>
              </section>

              {/* ---- Part 3: the appearance ---- */}
              <section className="space-y-3">
                <h3 style={sectionTitle}>Appearance</h3>
                <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Agency">
                  {(["uscis", "ice", "cbp"] as const).map((a) => (
                    <label key={a} className="flex items-center gap-1.5" style={{ color: "var(--color-ink)" }}>
                      <input type="radio" name="m23-agency" checked={m.agency === a} onChange={() => setSection("matter", { agency: a })} />
                      {a.toUpperCase()}
                    </label>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {m.agency === "uscis"
                    ? text("matter", "uscisForms", "Form number(s)", { placeholder: "I-589, I-765" })
                    : text("matter", "specificMatter", `Specific ${m.agency.toUpperCase()} matter`, { placeholder: "Consult only" })}
                  {text("matter", "receiptNumber", "Receipt number", { placeholder: "if any" })}
                  <Field id="m23-role" label="Appearing at the request of the">
                    <select id="m23-role" className={inputClass} style={inputStyle} value={m.clientRole}
                      onChange={(e) => setSection("matter", { clientRole: e.target.value as G28Input["matter"]["clientRole"] })}>
                      {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </Field>
                </div>
              </section>

              {/* ---- Part 3: client ---- */}
              <section className="space-y-3">
                <h3 style={sectionTitle}>Client</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {text("client", "familyName", "Family name (last)", { upper: true })}
                  {text("client", "givenName", "Given name (first)")}
                  {text("client", "middleName", "Middle name")}
                  {text("client", "aNumber", "A-Number", { placeholder: "9 digits" })}
                  {text("client", "phone", "Daytime phone")}
                  {text("client", "mobile", "Mobile phone")}
                  {text("client", "email", "Email")}
                  {text("client", "uscisAccount", "USCIS online account no.")}
                  {address("client")}
                </div>
              </section>

              {/* ---- Part 4: notices ---- */}
              <section className="space-y-2">
                <h3 style={sectionTitle}>USCIS notices (Part 4)</h3>
                {([
                  ["originalsToAttorney", "1.a — Send original notices to the attorney"],
                  ["cardsToAttorney", "1.b — Send secure identity documents (green card, EAD, travel document) to the attorney"],
                  ["i94ToClient", "1.c — Send the I-94 notice to the client's U.S. mailing address"],
                ] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink)" }}>
                    <input type="checkbox" checked={input.notices[k]} onChange={(e) => setSection("notices", { [k]: e.target.checked })} />
                    {label}
                  </label>
                ))}
                <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Signatures and dates are left blank, to sign by hand. Empty boxes print N/A.</p>
              </section>

              {/* ---- Where the copy goes ---- */}
              <section className="space-y-2">
                <h3 style={sectionTitle}>Save a copy in SharePoint</h3>
                {folders.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
                    This client has no SharePoint folder linked — the PDF is only downloaded.
                  </p>
                ) : (
                  <select aria-label="SharePoint folder" className={inputClass} style={inputStyle} value={folderUrl} onChange={(e) => setFolderUrl(e.target.value)}>
                    {folders.map((f) => <option key={f.url} value={f.url}>{f.label}{f.site ? ` (${f.site})` : ""}</option>)}
                    <option value="">Don't save a copy</option>
                  </select>
                )}
              </section>
            </>
          )}

          {needsConsent && (
            <div className="text-sm rounded p-3 flex items-center gap-2" style={{ background: "var(--color-amber-light)", color: "var(--color-ink)" }}>
              Saving to SharePoint uses your Microsoft 365 account, which needs your OK once. Allow, then Generate again.
              <Button type="button" size="sm" className="ml-auto" onClick={allowMicrosoft}>Allow</Button>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "var(--urgency-overdue)" }} role="alert">{error}</p>}
          {done && (
            <div className="text-sm space-y-0.5" style={{ color: "var(--color-ink)" }}>
              <div>✓ Downloaded {done.filename}</div>
              {done.saved.kind === "sharepoint" && (
                <div>✓ Saved in {done.saved.folder} — <a href={done.saved.url} target="_blank" rel="noopener noreferrer" className="underline">open in SharePoint ↗</a></div>
              )}
              {done.saved.kind === "failed" && (
                <div style={{ color: "var(--urgency-overdue)" }}>Not saved in SharePoint: {done.saved.message}</div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
            <Button type="button" className="ml-auto" disabled={!input || busy} onClick={generate}>
              {busy ? "Generating…" : "Generate G-28"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
