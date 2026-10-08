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
// uploaded in M19 (the Documents tab's SharePoint browser in pick mode). On save,
// each of those files is also copied into the APPOINTMENT's Files column in
// Monday (reception, 2026-10-05) — an upload from the browser's copy, a picked
// file downloaded from SharePoint first.
//
// Folders live behind the Documents ⋯ menu (reception, 2026-10-05) — never
// automatic: "Find or create" looks where the consult sweep looks (E-Files,
// Closed, then this year's Consults) and only creates a folder when none
// exists; "Use a different folder" takes a pasted link when the one on the
// profile is wrong or a better one exists. Either way the link is saved to the
// profile on save — filling an empty column, or replacing the link that was
// there (only if Monday still holds it).
//
// A Calendly client's own words ("Client wrote") can be corrected too; they
// replace the client's part of the Description, reception's part stays below.
//
// A "Detained appt" picks the detention center from the Court Cases board's
// Det. Facility labels (D36), "Other" for one not on the list. "Has DMS?"
// (the old CRM, cases until 2024) adds the client's DMS record to the note —
// the profile's DMS URL, else one built from the Case No.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import {
  APPT_TYPES,
  DMS_RECORD_BASE,
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
import { MenuCode } from "./ScreenCode";
import { downloadDriveFile, findOrCreateClientFolder, folderNameOf, getGraphToken, GraphConsentRequiredError, type ClientFolderKind } from "../sharepoint/graph";
import { normalizeSharePointUrl } from "../sharepoint/parseLink";

const FOLDER_KINDS: ClientFolderKind[] = ["e_file", "consult_file"];
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

const menuItemStyle = {
  display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6, border: "none",
  background: "transparent", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink)",
} as const;

const menuHintStyle = { display: "block", fontSize: 11, color: "var(--color-ink-faint)", marginTop: 1 } as const;

/** A required pick from a fixed list (D23 type of appt, D24 how to proceed, D36 detention center). */
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

type Attach = "attaching" | "attached" | "failed" | "too-large";

function AttachState({ state }: { state: Attach | undefined }) {
  const style = { fontSize: 11, flexShrink: 0 } as const;
  if (state === "attached") return <span style={{ ...style, color: "var(--color-status-green, var(--color-ink-muted))" }}>✓ added</span>;
  if (state === "failed") return <span style={{ ...style, color: "var(--color-status-red)" }}>not added — the link is in the note</span>;
  if (state === "too-large") return <span style={{ ...style, color: "var(--color-ink-faint)" }}>over 25 MB — the link is in the note</span>;
  return <span style={{ ...style, color: "var(--color-ink-faint)" }}>adding…</span>;
}

/** Same cap as the API's PREP_FILE_MAX_BYTES. */
const FILE_MAX_BYTES = 25 * 1024 * 1024;

/** Same split as the API's splitDescription: the client's words, then "Reception: …". */
function splitDescription(d: string | null): { client: string; reception: string } {
  const mark = "\n\nReception: ";
  const s = (d ?? "").trim();
  const i = s.indexOf(mark);
  if (i === -1) return { client: s, reception: "" };
  return { client: s.slice(0, i).trim(), reception: s.slice(i + mark.length).trim() };
}

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

/** "Other" in the detention-center list: a place typed in. */
const OTHER_FACILITY = "Other";

/** The DMS link to start from: the profile's (when it names a record), else one built from the Case No. */
function defaultDmsUrl(profile: ReceptionConsult["profile"]): string {
  if (profile?.dmsUrl && /\/records\/\d+/.test(profile.dmsUrl)) return profile.dmsUrl;
  const digits = (profile?.caseNo ?? "").replace(/\D/g, "");
  return digits ? `${DMS_RECORD_BASE}${digits}` : DMS_RECORD_BASE;
}

interface Props {
  consult: ReceptionConsult;
  /** Det. Facility labels on the Court Cases board, for "Detained appt". */
  facilities: string[];
  /** Open the appointment's focus view (M5) on top, to read the notes while prepping. */
  onFocus?: () => void;
  onClose: () => void;
  /** Called after a successful save, so P17 can refresh its "Prepped" marks. */
  onSaved: () => void;
}

export function ConsultPrepModal({ consult, facilities, onFocus, onClose, onSaved }: Props) {
  const profile = consult.profile;
  const startPhone = profile?.phone ?? consult.phone ?? "";
  // A Calendly booking's Description is the client's own words: they stay, read
  // only, and the box is reception's part, saved below them (routes/reception.ts).
  const split = splitDescription(consult.description);
  const clientWrote = consult.fromCalendly ? split.client : "";
  const [clientText, setClientText] = useState(clientWrote);
  const startDescription = consult.fromCalendly ? split.reception : consult.description ?? "";

  const [apptType, setApptType] = useState<ApptType | "">("");
  const [apptTypeOther, setApptTypeOther] = useState("");
  // Pre-filled from the client's open court case; reception checks it, not types it.
  // A facility not on the list (renamed, or typed in Monday) starts as Other.
  const facilityOptions = useMemo(() => [...facilities.filter((f) => f !== OTHER_FACILITY), OTHER_FACILITY], [facilities]);
  const startFacility = consult.detainedAt
    ? facilities.includes(consult.detainedAt) ? consult.detainedAt : OTHER_FACILITY
    : "";
  const [facility, setFacility] = useState(startFacility);
  const [facilityOther, setFacilityOther] = useState(startFacility === OTHER_FACILITY ? consult.detainedAt ?? "" : "");
  const detainedAt = facility === OTHER_FACILITY ? facilityOther : facility;
  const [hasDms, setHasDms] = useState(false);
  const [dmsUrl, setDmsUrl] = useState(() => defaultDmsUrl(profile));
  const [method, setMethod] = useState<PrepMethod | "">("");
  const [phone, setPhone] = useState(startPhone);
  const [zoomLink, setZoomLink] = useState("");
  const [methodOther, setMethodOther] = useState("");
  const [description, setDescription] = useState(startDescription);
  const startInterp = interpreterFromLanguage(consult.language);
  const [interpNeed, setInterpNeed] = useState<InterpreterNeed | "">(startInterp.need);
  const [interpLanguage, setInterpLanguage] = useState(startInterp.language);
  const [interpContact, setInterpContact] = useState("");

  // Folder links found, created or pasted here (⋯ menu) — saved to the profile on save.
  const [changed, setChanged] = useState<Partial<Record<ClientFolderKind, string>>>({});
  const [folderMenu, setFolderMenu] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderMsg, setFolderMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [pasteKind, setPasteKind] = useState<ClientFolderKind>("consult_file");
  const [pasteUrl, setPasteUrl] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!folderMenu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setFolderMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [folderMenu]);

  /** The link on the profile as loaded (raw, as Monday stores it). */
  const original = (k: ClientFolderKind): string | null => (k === "e_file" ? profile?.eFile : profile?.consultFile) ?? null;
  /** The link the prep will use: changed here, else the profile's. */
  const current = (k: ClientFolderKind): string | null => changed[k] ?? original(k);
  const sameLink = (a: string | null, b: string | null) =>
    !!a && !!b && (normalizeSharePointUrl(a) ?? a).replace(/\/+$/, "").toLowerCase() === (normalizeSharePointUrl(b) ?? b).replace(/\/+$/, "").toLowerCase();

  /** Use `url` as the client's `kind` folder; the profile's own link means "no change". */
  const pickFolder = (kind: ClientFolderKind, url: string): boolean => {
    if (sameLink(url, original(kind))) {
      setChanged(({ [kind]: _drop, ...rest }) => rest);
      return false;
    }
    setChanged((c) => ({ ...c, [kind]: url }));
    return true;
  };

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
    for (const k of FOLDER_KINDS) {
      const url = changed[k] ?? (k === "e_file" ? profile?.eFile : profile?.consultFile);
      if (url) add(url, FOLDER_LABEL[k]);
    }
    return out;
  }, [profile, changed, folderNames]);
  /** Which kind a listed folder was changed as, if it was. */
  const changedKind = (url: string) => FOLDER_KINDS.find((k) => changed[k] && (normalizeSharePointUrl(changed[k]!) ?? changed[k]) === url);

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
  const noFolder = !!profile && !current("e_file") && !current("consult_file");
  const consultYear = Number((consult.date ?? "").slice(0, 4)) || new Date().getFullYear();

  const findOrCreate = async (want: ClientFolderKind) => {
    if (!consult.folderName.ok) return;
    setFolderMenu(false);
    setFolderBusy(true);
    setFolderMsg(null);
    try {
      // The Graph scope is consented separately from sign-in; a click may run its popup.
      await getGraphToken(true);
      const r = await findOrCreateClientFolder({
        want, folder: consult.folderName.folder, initial: consult.folderName.initial, year: consultYear,
      });
      const name = r.path.split("/").pop();
      if (name) setFolderNames((m) => ({ ...m, [normalizeSharePointUrl(r.url) ?? r.url]: name }));
      const isNew = pickFolder(r.kind, r.url);
      setFolderMsg({
        text: isNew
          ? `${r.created ? "Created" : "Found existing"} ${r.path}${original(r.kind) ? ` — replaces the ${FOLDER_LABEL[r.kind]} on save` : ""}`
          : `${r.path} is already the ${FOLDER_LABEL[r.kind]} on the profile.`,
        error: false,
      });
    } catch (e) {
      setFolderMsg({
        text: e instanceof GraphConsentRequiredError ? "SharePoint access is needed first." : e instanceof Error ? e.message : "Could not reach SharePoint",
        error: true,
      });
    } finally {
      setFolderBusy(false);
    }
  };

  const addPasted = () => {
    const url = pasteUrl.trim();
    let ok = false;
    try { ok = /\.sharepoint\.com$/i.test(new URL(url).hostname); } catch { ok = false; }
    if (!ok) { setFolderMsg({ text: "Paste a SharePoint folder link (…sharepoint.com/…).", error: true }); return; }
    const isNew = pickFolder(pasteKind, url);
    setPasteUrl("");
    setPasting(false);
    setFolderMsg(isNew ? null : { text: `That is already the ${FOLDER_LABEL[pasteKind]} on the profile.`, error: false });
  };
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [attach, setAttach] = useState<Record<string, Attach>>({});
  // Files uploaded here, by SharePoint URL: copied to Monday from these bytes, not re-downloaded.
  const uploads = useRef(new Map<string, File>());
  const [browsing, setBrowsing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ pending: boolean; wroteBack: string[] } | null>(null);

  const pickedUrls = useMemo(() => new Set(picked.map((p) => p.url)), [picked]);
  const togglePicked = (f: PickedFile) =>
    setPicked((cur) => (cur.some((p) => p.url === f.url) ? cur.filter((p) => p.url !== f.url) : [...cur, f]));

  const onUploaded = (file: File, item: { name: string; webUrl: string }) => {
    uploads.current.set(item.webUrl, file);
    setPicked((cur) => (cur.some((p) => p.url === item.webUrl) ? cur : [...cur, { name: item.name, url: item.webUrl }]));
  };

  /** After the note is saved: copy each picked / uploaded file into the appointment's Files. */
  const copyFilesToAppointment = async (files: PickedFile[]) => {
    for (const f of files) {
      setAttach((a) => ({ ...a, [f.url]: "attaching" }));
      try {
        const uploaded = uploads.current.get(f.url);
        if ((uploaded?.size ?? f.size ?? 0) > FILE_MAX_BYTES) {
          setAttach((a) => ({ ...a, [f.url]: "too-large" }));
          continue;
        }
        let blob: Blob | undefined = uploaded;
        if (!blob && f.driveId && f.itemId) blob = await downloadDriveFile(f.driveId, f.itemId);
        if (!blob) throw new Error("No way to read this file");
        if (blob.size > FILE_MAX_BYTES) {
          setAttach((a) => ({ ...a, [f.url]: "too-large" }));
          continue;
        }
        await attachConsultFile(consult.localId, blob, f.name);
        setAttach((a) => ({ ...a, [f.url]: "attached" }));
      } catch {
        setAttach((a) => ({ ...a, [f.url]: "failed" }));
      }
    }
  };

  const phoneEdited = method === "Phone" && phone.trim() !== startPhone.trim();
  // An emptied box leaves the client's words as they are (no erasing).
  const clientEdited = !!clientWrote && clientText.trim() !== "" && clientText.trim() !== clientWrote.trim();
  const descriptionEdited = description.trim() !== "" && description.trim() !== startDescription.trim();

  const submit = async () => {
    if (!apptType) { setError("Pick the type of appointment."); return; }
    if (apptType === "Detained appt" && !detainedAt.trim()) {
      setError(facility === OTHER_FACILITY ? "Type where the client is detained." : "Pick where the client is detained.");
      return;
    }
    if (hasDms && !/\/records\/\d+/.test(dmsUrl)) { setError("Add the client's DMS record number to the link, or untick Has DMS."); return; }
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
        clientWrote: clientEdited ? clientText : undefined,
        documents: [...folders.filter((f) => includeFolder(f.url)), ...picked],
        folderLinks: FOLDER_KINDS.flatMap((kind) => {
          const url = changed[kind];
          return url ? [{ kind, url, replaces: original(kind) ?? undefined }] : [];
        }),
        dmsUrl: hasDms ? dmsUrl.trim() : undefined,
      });
      setDone({ pending: res.pending, wroteBack: res.wroteBack });
      onSaved();
      void copyFilesToAppointment(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save the prep note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M18" className="gap-0 p-0 sm:max-w-[560px] max-h-[92vh] overflow-y-auto">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Prep consult</DialogTitle>
          <DialogDescription>
            {profile?.name ?? consult.name} · {when(consult)}
            {consult.attorney ? ` · ${consult.attorney}` : ""}
          </DialogDescription>
          {onFocus && (
            <Button type="button" size="sm" variant="outline" onClick={onFocus} className="mt-2 self-start"
              title="Opens the appointment's focus view on top — this prep stays as you left it">
              Focus view — notes &amp; documents
            </Button>
          )}
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
                {done.wroteBack.includes("e_file") && <li>Profile E-File link updated</li>}
                {done.wroteBack.includes("consult_file") && <li>Profile Consult File link updated</li>}
                {done.wroteBack.includes("dms_url") && <li>Profile DMS URL saved</li>}
              </ul>
              {picked.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <p style={{ fontSize: 13, color: "var(--color-ink-muted)", marginBottom: 4 }}>Files added to the appointment's Files in Monday:</p>
                  <ul style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 2 }}>
                    {picked.map((f) => (
                      <li key={f.url} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📎 {f.name}</span>
                        <AttachState state={attach[f.url]} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
                  <div className="mt-2">
                    <Dropdown options={facilityOptions} value={facility} onChange={setFacility} label="Detention center" code="D36" />
                    {facility === OTHER_FACILITY && (
                      <input type="text" value={facilityOther} onChange={(e) => setFacilityOther(e.target.value)} maxLength={200}
                        placeholder="Where are they detained?" aria-label="Where is the client detained" autoFocus
                        className="mt-2 w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
                    )}
                  </div>
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

              {/* Has DMS? — the old CRM, cases until 2024 */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontFamily: "var(--font-body)", color: "var(--color-ink)", cursor: "pointer" }}>
                  <input type="checkbox" checked={hasDms} onChange={(e) => setHasDms(e.target.checked)} disabled={!profile} />
                  Has DMS?
                  <span style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>(optional — cases until 2024)</span>
                </label>
                {hasDms && (
                  <>
                    <input type="url" value={dmsUrl} onChange={(e) => setDmsUrl(e.target.value)} maxLength={500}
                      placeholder={`${DMS_RECORD_BASE}21164`} aria-label="DMS URL"
                      className="mt-2 w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
                    <span style={hintStyle}>
                      {profile?.dmsUrl && /\/records\/\d+/.test(profile.dmsUrl)
                        ? "From the client's profile (DMS URL)."
                        : profile?.caseNo
                          ? `Built from Case No. ${profile.caseNo} — saved to the profile's DMS URL.`
                          : "No Case No. on the profile — add the record number at the end."}
                      {" "}Added to the prep note.
                    </span>
                  </>
                )}
              </div>

              {/* Documents */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ ...labelStyle, marginBottom: 0 }}>Documents</span>
                  {profile && (
                    <div ref={menuRef} style={{ position: "relative" }}>
                      <button type="button" aria-label="Folder options" aria-haspopup="menu" aria-expanded={folderMenu}
                        title="Change or create the client's folder" disabled={folderBusy}
                        onClick={() => setFolderMenu((o) => !o)}
                        className="rounded-md px-2 py-0.5 text-base leading-none"
                        style={{ color: "var(--color-ink-muted)", border: "1px solid var(--color-border-light)", background: folderMenu ? "var(--color-surface-warm)" : "transparent", cursor: "pointer" }}>
                        ⋯
                      </button>
                      {folderMenu && (
                        <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 10, minWidth: 260, padding: 4, borderRadius: 8, background: "var(--color-surface)", border: "1px solid var(--color-border-light)", boxShadow: "0 6px 20px rgba(0,0,0,0.12)" }}>
                          <button type="button" role="menuitem" style={menuItemStyle}
                            onClick={() => { setFolderMenu(false); setPasting(true); setFolderMsg(null); }}>
                            Use a different folder…
                            <span style={menuHintStyle}>Paste a SharePoint link — replaces the one on the profile</span>
                          </button>
                          {FOLDER_KINDS.map((k) => (
                            <button key={k} type="button" role="menuitem" style={menuItemStyle} disabled={!consult.folderName.ok}
                              onClick={() => void findOrCreate(k)}>
                              Find or create {k === "e_file" ? "e-file" : "consult"} folder
                              <span style={menuHintStyle}>
                                {consult.folderName.ok
                                  ? k === "e_file"
                                    ? `E-Files / ${consult.folderName.initial} / ${consult.folderName.folder} (or Closed)`
                                    : `${consultYear} Consults / ${consult.folderName.initial} / ${consult.folderName.folder} — the e-file instead if there is one`
                                  : `Can't name a folder (${consult.folderName.detail}) — paste the link instead`}
                              </span>
                            </button>
                          ))}
                          <MenuCode code="D35" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <ul style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
                  {folders.map((f) => {
                    const kind = changedKind(f.url);
                    return (
                      <li key={f.url} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontFamily: "var(--font-body)" }}>
                        <input type="checkbox" checked={includeFolder(f.url)} aria-label={`Include ${f.name}`}
                          onChange={(e) => setExcluded((m) => ({ ...m, [f.url]: !e.target.checked }))} />
                        <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-amber-dark)" }}>📁 {f.name}</a>
                        {kind && (
                          <>
                            <span style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>
                              {original(kind) ? `replaces the ${FOLDER_LABEL[kind]} on save` : "saved to the profile on save"}
                            </span>
                            <button type="button" onClick={() => { setChanged(({ [kind]: _drop, ...rest }) => rest); setFolderMsg(null); }}
                              aria-label="Undo this folder change" title="Undo — keep the profile's folder"
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-ink-faint)", fontSize: 14 }}>×</button>
                          </>
                        )}
                      </li>
                    );
                  })}
                  {consult.driveFolder && (
                    <li style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontFamily: "var(--font-body)" }}>
                      {/* Not in the prep note: the intake job copies these uploads into the client's SharePoint folder. */}
                      <span style={{ width: 13 }} aria-hidden />
                      <a href={consult.driveFolder} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-amber-dark)" }}>
                        📤 Client's Google Drive uploads
                      </a>
                    </li>
                  )}
                  {picked.map((f) => (
                    <li key={f.url} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontFamily: "var(--font-body)" }}>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-amber-dark)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        📎 {f.name}
                      </a>
                      <button type="button" onClick={() => togglePicked(f)} aria-label={`Remove ${f.name}`}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-ink-faint)", fontSize: 14 }}>×</button>
                    </li>
                  ))}
                </ul>
                {noFolder && !pasting && (
                  <p style={{ fontSize: 12, color: "var(--color-ink-muted)", marginBottom: 6, fontFamily: "var(--font-body)" }}>
                    No e-file or consult folder on this client's profile — use ⋯ to find, create or paste one.
                  </p>
                )}
                {folderBusy && (
                  <p style={{ fontSize: 11, marginBottom: 6, color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>Looking in SharePoint…</p>
                )}
                {pasting && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    <select value={pasteKind} onChange={(e) => setPasteKind(e.target.value as ClientFolderKind)} aria-label="Folder type"
                      className="rounded-md px-1.5 py-1.5 text-sm" style={fieldStyle}>
                      <option value="consult_file">Consult folder</option>
                      <option value="e_file">E-File folder</option>
                    </select>
                    <input type="url" value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} placeholder="Paste a SharePoint folder link…"
                      aria-label="SharePoint folder link" className="flex-1 min-w-0 rounded-md px-2 py-1.5 text-sm" style={fieldStyle} autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPasted(); } }} />
                    <button type="button" className="action-btn" onClick={addPasted} disabled={!pasteUrl.trim()}>
                      {current(pasteKind) ? "Replace" : "Add"}
                    </button>
                    <button type="button" onClick={() => { setPasting(false); setPasteUrl(""); setFolderMsg(null); }} aria-label="Cancel"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-ink-faint)", fontSize: 14 }}>×</button>
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
              {clientWrote && (
                <label style={{ display: "block", marginBottom: 8 }}>
                  <span style={labelStyle}>Client wrote (Calendly)</span>
                  <textarea value={clientText} onChange={(e) => setClientText(e.target.value)} rows={3} maxLength={5000}
                    aria-label="What the client wrote"
                    className="w-full rounded-md px-2 py-1.5 text-sm" style={{ ...fieldStyle, background: "var(--color-surface-warm)", resize: "vertical" }} />
                  {clientEdited && <span style={hintStyle}>Replaces the client's words in the appointment's Description — reception's part stays below.</span>}
                  {!clientText.trim() && <span style={hintStyle}>Left empty, the client's words stay as they are.</span>}
                </label>
              )}
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={labelStyle}>{clientWrote ? "Reception's description" : "Description"}</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={5000}
                  placeholder="What the client wants to discuss, anything the attorney should know…"
                  className="w-full rounded-md px-2 py-1.5 text-sm" style={{ ...fieldStyle, resize: "vertical" }} />
                {descriptionEdited && clientWrote && <span style={hintStyle}>Added below the client's words in the appointment's Description.</span>}
                {descriptionEdited && !clientWrote && startDescription && <span style={hintStyle}>The appointment's Description in Monday will be updated.</span>}
                {consult.description2 && (
                  <span style={hintStyle}>Description 2 (from Monday): {consult.description2}</span>
                )}
              </label>

              {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{error}</p>}

              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 4 }}>
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
                {profile.name} · Attach files to the prep note, or upload new ones. On save they are also added to the appointment's Files in Monday.
              </DialogDescription>
            </DialogHeader>
            <div className="px-5 py-4">
              <DocumentsTab
                data={{ profile: { eFile: current("e_file"), consultFile: current("consult_file") } }}
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
