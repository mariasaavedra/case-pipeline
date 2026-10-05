// =============================================================================
// ConsultPrepModal (M18) — reception preps an existing consult for the attorney
// =============================================================================
// Opened from P17 on an appointment that already exists (Calendly or booked by
// staff). Type of appt, how it will happen, the documents to look at, and a
// description. Submitting posts one note three ways — an Update on the profile,
// a pinned Update on the appointment, and a Consult Prep Note in the profile's
// Emails & Activities — and writes edited fields back where they came from
// (phone → profile, description → appointment). See routes/reception.ts.
//
// Documents: the client's e-file / consult folder links, plus files picked or
// uploaded in M19 (the Documents tab's SharePoint browser in pick mode). A file
// uploaded there is also attached to the profile's Files column in Monday.
//
// A client with no folder on their profile gets one here: "Find or create"
// looks where the consult sweep looks (E-Files, Closed, then this year's
// Consults) and only creates a consult folder when none exists; or a link can
// be pasted. Either way the link is saved to the empty profile column on save.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import {
  APPT_TYPES,
  INTERPRETER_NEEDS,
  PREP_METHODS,
  attachConsultFile,
  prepConsult,
  type ApptType,
  type InterpreterNeed,
  type PrepMethod,
  type ReceptionConsult,
} from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { DocumentsTab, type PickedFile } from "./DocumentsTab";
import { findOrCreateClientFolder, folderNameOf, getGraphToken, GraphConsentRequiredError, type ClientFolderKind } from "../sharepoint/graph";
import { normalizeSharePointUrl } from "../sharepoint/parseLink";

type FolderLink = { kind: ClientFolderKind; url: string };
const FOLDER_LABEL: Record<ClientFolderKind, string> = { e_file: "E-File folder", consult_file: "Consult folder" };

const labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-ink-muted)",
  marginBottom: 4,
  fontFamily: "var(--font-body)",
} as const;

const fieldStyle = {
  border: "1px solid var(--color-border-light)",
  background: "var(--color-surface)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-body)",
} as const;

const hintStyle = {
  display: "block",
  fontSize: 11,
  color: "var(--color-ink-faint)",
  marginTop: 3,
  fontFamily: "var(--font-body)",
} as const;

/** A required pick from a fixed list (D23 type of appt, D24 how to proceed). */
function Dropdown<T extends string>({ options, value, onChange, label, code }: {
  options: readonly T[]; value: T | ""; onChange: (v: T) => void; label: string; code: string;
}) {
  // See KpiDetailModal: `items` is what lets the closed trigger show a label.
  const items = [{ value: "", label: "Select…" }, ...options.map((o) => ({ value: o, label: o }))];
  return (
    <Select items={items} value={value} onValueChange={(v) => { if (v) onChange(v as T); }}>
      <SelectTrigger aria-label={label} size="sm" className="w-full border-border-light bg-surface">
        <SelectValue />
      </SelectTrigger>
      <SelectContent code={code} className="w-[var(--anchor-width)]">
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** "Oct 3 · 2:30 PM" for the header. */
function when(c: ReceptionConsult): string {
  if (!c.date) return "No date";
  const day = new Date(`${c.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  if (!c.time) return day;
  const [h, m] = c.time.split(":").map(Number);
  const hour = h ?? 0;
  return `${day} · ${hour % 12 === 0 ? 12 : hour % 12}:${String(m ?? 0).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

type Attach = "attaching" | "attached" | "failed";

/**
 * "Needs interpreter?" pre-filled from the appointment's Language column
 * (labels as on the boards: "Espanol", "Portuguese", "Vietnamese"…). English and
 * the placeholder labels leave it to reception.
 */
function interpreterFromLanguage(language: string | null): { need: InterpreterNeed | ""; language: string } {
  const l = (language ?? "").trim();
  if (/^espa[nñ]ol$|^spanish$/i.test(l)) return { need: "Spanish", language: "" };
  if (/^portugu[eê]s(e)?$/i.test(l)) return { need: "Portuguese", language: "" };
  if (!l || /^(english|default|preferred language)$/i.test(l)) return { need: /^english$/i.test(l) ? "No" : "", language: "" };
  return { need: "Other language", language: l };
}

const INTERPRETER_HINT: Record<InterpreterNeed, string> = {
  No: "",
  Spanish: "The office interprets — reception arranges it.",
  Portuguese: "The office interprets — Rafael.",
  "Other language": "The client brings their own interpreter.",
};

interface Props {
  consult: ReceptionConsult;
  /** Open the appointment's focus view (M5) on top, to read the notes while prepping. */
  onFocus?: () => void;
  onClose: () => void;
  /** Called after a successful save, so P17 can refresh its "Prepped" marks. */
  onSaved: () => void;
}

export function ConsultPrepModal({ consult, onFocus, onClose, onSaved }: Props) {
  const profile = consult.profile;
  const startPhone = profile?.phone ?? consult.phone ?? "";
  const startDescription = consult.description ?? "";

  const [apptType, setApptType] = useState<ApptType | "">("");
  const [apptTypeOther, setApptTypeOther] = useState("");
  // Pre-filled from the client's open court case; reception checks it, not types it.
  const [detainedAt, setDetainedAt] = useState(consult.detainedAt ?? "");
  const [method, setMethod] = useState<PrepMethod | "">("");
  const [phone, setPhone] = useState(startPhone);
  const [zoomLink, setZoomLink] = useState("");
  const [methodOther, setMethodOther] = useState("");
  const [description, setDescription] = useState(startDescription);
  const startInterp = interpreterFromLanguage(consult.language);
  const [interpNeed, setInterpNeed] = useState<InterpreterNeed | "">(startInterp.need);
  const [interpLanguage, setInterpLanguage] = useState(startInterp.language);
  const [interpContact, setInterpContact] = useState("");

  // A folder found, created or pasted here, for a client whose profile had none.
  const [newFolder, setNewFolder] = useState<FolderLink | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderMsg, setFolderMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [pasteKind, setPasteKind] = useState<ClientFolderKind>("consult_file");
  const [pasteUrl, setPasteUrl] = useState("");

  // The folder's own name ("VENTURA, Milton") for its link in the note, looked
  // up per link; until it arrives (or if SharePoint can't say) the link keeps
  // its generic label.
  const [folderNames, setFolderNames] = useState<Record<string, string>>({});

  // The client's own folders, included by default — the attorney opens them first.
  // Scheme-less stored links ("sharmacrawford.sharepoint.com/sites/…") get
  // https:// so the note's link works and the API accepts it.
  const folders = useMemo<PickedFile[]>(() => {
    const out: PickedFile[] = [];
    const add = (raw: string, label: string) => {
      const url = normalizeSharePointUrl(raw) ?? raw;
      if (!out.some((f) => f.url === url)) out.push({ name: folderNames[url] ?? label, url });
    };
    if (profile?.eFile) add(profile.eFile, FOLDER_LABEL.e_file);
    if (profile?.consultFile) add(profile.consultFile, FOLDER_LABEL.consult_file);
    if (newFolder) add(newFolder.url, FOLDER_LABEL[newFolder.kind]);
    return out;
  }, [profile, newFolder, folderNames]);

  const askedNames = useRef(new Set<string>());
  useEffect(() => {
    for (const f of folders) {
      if (askedNames.current.has(f.url)) continue;
      askedNames.current.add(f.url);
      void folderNameOf(f.url).then((name) => {
        if (name) setFolderNames((m) => (m[f.url] ? m : { ...m, [f.url]: name }));
      });
    }
  }, [folders]);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const includeFolder = (url: string) => !excluded[url];
  const noFolder = !!profile && !profile.eFile && !profile.consultFile && !newFolder;
  const consultYear = Number((consult.date ?? "").slice(0, 4)) || new Date().getFullYear();

  const findOrCreate = async (interactive: boolean) => {
    if (!consult.folderName.ok) return;
    setFolderBusy(true);
    setFolderMsg(null);
    try {
      // The Graph scope is consented separately from sign-in; a click may run its popup.
      if (interactive) await getGraphToken(true);
      const r = await findOrCreateClientFolder({
        want: "consult_file", folder: consult.folderName.folder, initial: consult.folderName.initial, year: consultYear,
      });
      const name = r.path.split("/").pop();
      if (name) setFolderNames((m) => ({ ...m, [r.url]: name }));
      setNewFolder({ kind: r.kind, url: r.url });
      setFolderMsg({ text: `${r.created ? "Created" : "Found existing"} ${r.path}`, error: false });
    } catch (e) {
      if (e instanceof GraphConsentRequiredError && !interactive) {
        setFolderMsg({ text: "SharePoint access is needed first.", error: true });
      } else {
        setFolderMsg({ text: e instanceof Error ? e.message : "Could not reach SharePoint", error: true });
      }
    } finally {
      setFolderBusy(false);
    }
  };

  const addPasted = () => {
    const url = pasteUrl.trim();
    let ok = false;
    try { ok = /\.sharepoint\.com$/i.test(new URL(url).hostname); } catch { ok = false; }
    if (!ok) { setFolderMsg({ text: "Paste a SharePoint folder link (…sharepoint.com/…).", error: true }); return; }
    setNewFolder({ kind: pasteKind, url });
    setPasteUrl("");
    setFolderMsg(null);
  };
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [attach, setAttach] = useState<Record<string, Attach>>({});
  const [browsing, setBrowsing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ pending: boolean; wroteBack: string[] } | null>(null);

  const pickedUrls = useMemo(() => new Set(picked.map((p) => p.url)), [picked]);
  const togglePicked = (f: PickedFile) =>
    setPicked((cur) => (cur.some((p) => p.url === f.url) ? cur.filter((p) => p.url !== f.url) : [...cur, f]));

  const onUploaded = (file: File, item: { name: string; webUrl: string }) => {
    setPicked((cur) => (cur.some((p) => p.url === item.webUrl) ? cur : [...cur, { name: item.name, url: item.webUrl }]));
    setAttach((a) => ({ ...a, [item.webUrl]: "attaching" }));
    attachConsultFile(consult.localId, file)
      .then(() => setAttach((a) => ({ ...a, [item.webUrl]: "attached" })))
      .catch(() => setAttach((a) => ({ ...a, [item.webUrl]: "failed" })));
  };

  const phoneEdited = method === "Phone" && phone.trim() !== startPhone.trim();
  const descriptionEdited = description.trim() !== "" && description.trim() !== startDescription.trim();

  const submit = async () => {
    if (!apptType) { setError("Pick the type of appointment."); return; }
    if (!method) { setError("Pick how the consult will happen."); return; }
    if (!interpNeed) { setError("Pick whether the client needs an interpreter."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await prepConsult(consult.localId, {
        apptType,
        apptTypeOther: apptType === "Other" ? apptTypeOther : undefined,
        detainedAt: apptType === "Detained appt" ? detainedAt : undefined,
        method,
        phone: method === "Phone" ? phone : undefined,
        zoomLink: method === "Zoom" ? zoomLink : undefined,
        methodOther: method === "Other" ? methodOther : undefined,
        interpreter: interpNeed === "Other language"
          ? { need: interpNeed, language: interpLanguage, contact: interpContact }
          : { need: interpNeed },
        description,
        documents: [...folders.filter((f) => includeFolder(f.url)), ...picked],
        folderLinks: newFolder ? [newFolder] : undefined,
      });
      setDone({ pending: res.pending, wroteBack: res.wroteBack });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save the prep note");
    } finally {
      setSaving(false);
    }
  };

  const stillAttaching = Object.values(attach).some((s) => s === "attaching");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M18" className="gap-0 p-0 sm:max-w-[560px] max-h-[92vh] overflow-y-auto">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Prep consult</DialogTitle>
          <DialogDescription>
            {profile?.name ?? consult.name} · {when(consult)}
            {consult.attorney ? ` · ${consult.attorney}` : ""}
            {onFocus && (
              <>
                {" · "}
                <button type="button" onClick={onFocus}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-amber-dark)", fontSize: "inherit" }}>
                  Focus view — notes &amp; documents
                </button>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
          {done ? (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)" }}>
              <p style={{ marginBottom: 8 }}>
                ✓ Prep note {done.pending ? "saved — some of it is queued and will reach Monday shortly" : "posted in Monday"}.
              </p>
              <ul style={{ fontSize: 13, color: "var(--color-ink-muted)", listStyle: "disc", paddingLeft: 18, marginBottom: 8 }}>
                <li>Update on the client's profile</li>
                <li>Update on the appointment, pinned to the top</li>
                <li>Consult Prep Note in the profile's Emails &amp; Activities</li>
                {done.wroteBack.includes("phone") && <li>Profile phone updated</li>}
                {done.wroteBack.includes("description") && <li>Appointment description updated</li>}
              </ul>
              <button type="button" onClick={onClose} className="mt-1 rounded-md px-3 py-1.5 text-sm"
                style={{ background: "var(--color-amber-light)", color: "var(--color-amber)", border: "none", cursor: "pointer" }}>Done</button>
            </div>
          ) : (
            <>
              {!profile && (
                <p role="alert" style={{ fontSize: 13, color: "var(--color-status-red)", marginBottom: 12, fontFamily: "var(--font-body)" }}>
                  This appointment is not linked to a client profile in Monday. Link it there first — the prep note goes on the profile.
                </p>
              )}
              {consult.lastPrep && (
                <p style={{ fontSize: 12, color: "var(--color-ink-muted)", background: "var(--color-surface-warm)", borderRadius: 6, padding: "6px 10px", marginBottom: 12, fontFamily: "var(--font-body)" }}>
                  Already prepped by {consult.lastPrep.author ?? "someone"} ({consult.lastPrep.apptType}, {consult.lastPrep.method}). Saving again posts a new note.
                </p>
              )}

              {/* Type of appointment */}
              <div style={{ marginBottom: 14 }}>
                <span style={labelStyle}>Type of appt</span>
                <Dropdown options={APPT_TYPES} value={apptType} onChange={setApptType} label="Type of appt" code="D23" />
                {apptType === "Other" && (
                  <input type="text" value={apptTypeOther} onChange={(e) => setApptTypeOther(e.target.value)} maxLength={200}
                    placeholder="Specify…" aria-label="Specify the type of appointment" autoFocus
                    className="mt-2 w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
                )}
                {apptType === "Detained appt" && (
                  <input type="text" value={detainedAt} onChange={(e) => setDetainedAt(e.target.value)} maxLength={200}
                    placeholder="Where are they detained? (e.g. Chase Co. (KS))" aria-label="Where is the client detained" autoFocus
                    className="mt-2 w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
                )}
                {apptType === "Detained appt" && consult.detainedAt && detainedAt.trim() === consult.detainedAt && (
                  <span style={hintStyle}>From the client's open court case (Det. Facility) — change it if they have moved.</span>
                )}
              </div>

              {/* How to proceed */}
              <div style={{ marginBottom: 14 }}>
                <span style={labelStyle}>How to proceed</span>
                <Dropdown options={PREP_METHODS} value={method} onChange={setMethod} label="How to proceed" code="D24" />
                {method === "Phone" && (
                  <>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50}
                      placeholder="Phone number" aria-label="Phone number"
                      className="mt-2 w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
                    {phoneEdited && <span style={hintStyle}>The client's profile phone in Monday will be updated to this number.</span>}
                  </>
                )}
                {method === "Zoom" && (
                  <input type="url" value={zoomLink} onChange={(e) => setZoomLink(e.target.value)}
                    placeholder="https://zoom.us/j/…" aria-label="Zoom link" autoFocus
                    className="mt-2 w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
                )}
                {method === "Other" && (
                  <input type="text" value={methodOther} onChange={(e) => setMethodOther(e.target.value)} maxLength={200}
                    placeholder="Specify… (e.g. in person at the office)" aria-label="Specify how the consult will happen" autoFocus
                    className="mt-2 w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
                )}
              </div>

              {/* Needs interpreter? */}
              <div style={{ marginBottom: 14 }}>
                <span style={labelStyle}>Needs interpreter?</span>
                <Dropdown options={INTERPRETER_NEEDS} value={interpNeed} onChange={setInterpNeed} label="Needs interpreter?" code="D33" />
                {interpNeed === "Other language" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input type="text" value={interpLanguage} onChange={(e) => setInterpLanguage(e.target.value)} maxLength={200}
                      placeholder="Language (optional)" aria-label="Interpreter language"
                      className="rounded-md px-2 py-1.5 text-sm" style={{ ...fieldStyle, flex: 1, minWidth: 0 }} />
                    <input type="text" value={interpContact} onChange={(e) => setInterpContact(e.target.value)} maxLength={200}
                      placeholder="Interpreter's name / phone (optional)" aria-label="Interpreter contact"
                      className="rounded-md px-2 py-1.5 text-sm" style={{ ...fieldStyle, flex: 2, minWidth: 0 }} />
                  </div>
                )}
                {interpNeed && INTERPRETER_HINT[interpNeed] && <span style={hintStyle}>{INTERPRETER_HINT[interpNeed]}</span>}
              </div>

              {/* Documents */}
              <div style={{ marginBottom: 14 }}>
                <span style={labelStyle}>Documents</span>
                <ul style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
                  {folders.map((f) => (
                    <li key={f.url} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontFamily: "var(--font-body)" }}>
                      <input type="checkbox" checked={includeFolder(f.url)} aria-label={`Include ${f.name}`}
                        onChange={(e) => setExcluded((m) => ({ ...m, [f.url]: !e.target.checked }))} />
                      <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-amber-dark)" }}>📁 {f.name}</a>
                      {newFolder?.url === f.url && (
                        <>
                          <span style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>saved to the profile on save</span>
                          <button type="button" onClick={() => { setNewFolder(null); setFolderMsg(null); }} aria-label="Remove this folder link"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-ink-faint)", fontSize: 14 }}>×</button>
                        </>
                      )}
                    </li>
                  ))}
                  {picked.map((f) => (
                    <li key={f.url} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontFamily: "var(--font-body)" }}>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-amber-dark)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        📎 {f.name}
                      </a>
                      {attach[f.url] === "attaching" && <span style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>attaching to profile…</span>}
                      {attach[f.url] === "attached" && <span style={{ fontSize: 11, color: "var(--color-status-green, var(--color-ink-muted))" }}>✓ on profile Files</span>}
                      {attach[f.url] === "failed" && <span style={{ fontSize: 11, color: "var(--color-status-red)" }}>not attached in Monday (still in SharePoint)</span>}
                      <button type="button" onClick={() => togglePicked(f)} aria-label={`Remove ${f.name}`}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-ink-faint)", fontSize: 14 }}>×</button>
                    </li>
                  ))}
                </ul>
                {noFolder && (
                  <div style={{ border: "1px dashed var(--color-border)", borderRadius: 8, padding: "10px 12px", marginBottom: 8, fontFamily: "var(--font-body)" }}>
                    <p style={{ fontSize: 12, color: "var(--color-ink-muted)", marginBottom: 8 }}>
                      No e-file or consult folder on this client's profile.
                    </p>
                    {consult.folderName.ok ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                        <button type="button" className="action-btn" disabled={folderBusy} onClick={() => void findOrCreate(true)}>
                          {folderBusy ? "Looking in SharePoint…" : "Find or create folder"}
                        </button>
                        <span style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>
                          {consultYear} Consults / {consult.folderName.initial} / {consult.folderName.folder}
                          {" "}— uses the e-file instead if the client already has one
                        </span>
                      </div>
                    ) : (
                      <p style={{ fontSize: 11, color: "var(--color-ink-faint)", marginBottom: 8 }}>
                        Can't name a folder from this appointment ({consult.folderName.detail}) — paste the link instead, or fix the name in Monday.
                      </p>
                    )}
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <select value={pasteKind} onChange={(e) => setPasteKind(e.target.value as ClientFolderKind)} aria-label="Folder type"
                        className="rounded-md px-1.5 py-1.5 text-sm" style={fieldStyle}>
                        <option value="consult_file">Consult folder</option>
                        <option value="e_file">E-File folder</option>
                      </select>
                      <input type="url" value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} placeholder="or paste a SharePoint link…"
                        aria-label="SharePoint folder link" className="flex-1 min-w-0 rounded-md px-2 py-1.5 text-sm" style={fieldStyle}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPasted(); } }} />
                      <button type="button" className="action-btn" onClick={addPasted} disabled={!pasteUrl.trim()}>Add</button>
                    </div>
                  </div>
                )}
                {folderMsg && (
                  <p role={folderMsg.error ? "alert" : undefined} style={{ fontSize: 11, marginBottom: 6, fontFamily: "var(--font-body)", color: folderMsg.error ? "var(--color-status-red)" : "var(--color-ink-muted)" }}>
                    {folderMsg.text}
                  </p>
                )}
                {folders.length > 0 && (
                  <button type="button" className="action-btn" onClick={() => setBrowsing(true)} disabled={!profile}>
                    Browse SharePoint…
                  </button>
                )}
              </div>

              {/* Description */}
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={labelStyle}>Description</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={5000}
                  placeholder="What the client wants to discuss, anything the attorney should know…"
                  className="w-full rounded-md px-2 py-1.5 text-sm" style={{ ...fieldStyle, resize: "vertical" }} />
                {descriptionEdited && startDescription && <span style={hintStyle}>The appointment's Description in Monday will be updated.</span>}
                {consult.description2 && (
                  <span style={hintStyle}>Description 2 (from Monday): {consult.description2}</span>
                )}
              </label>

              {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{error}</p>}

              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 4 }}>
                {stillAttaching && <span style={{ fontSize: 11, color: "var(--color-ink-faint)", marginRight: "auto" }}>Still attaching files…</span>}
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="button" onClick={submit} disabled={saving || !profile}>
                  {saving ? "Saving…" : "Save prep note"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>

      {/* M19 — SharePoint picker, nested over M18 */}
      {browsing && profile && (
        <Dialog open onOpenChange={(open) => !open && setBrowsing(false)}>
          <DialogContent code="M19" className="gap-0 p-0 sm:max-w-[720px] max-h-[88vh] overflow-y-auto">
            <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
              <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Client documents</DialogTitle>
              <DialogDescription>
                {profile.name} · Attach files to the prep note, or upload new ones (they are also added to the profile's Files in Monday).
              </DialogDescription>
            </DialogHeader>
            <div className="px-5 py-4">
              <DocumentsTab
                data={{ profile: { eFile: profile.eFile ?? (newFolder?.kind === "e_file" ? newFolder.url : null), consultFile: profile.consultFile ?? (newFolder?.kind === "consult_file" ? newFolder.url : null) } }}
                pick={{ selected: pickedUrls, onToggle: togglePicked, onUploaded }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <Button type="button" onClick={() => setBrowsing(false)}>
                  Done{picked.length > 0 ? ` (${picked.length} attached)` : ""}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
