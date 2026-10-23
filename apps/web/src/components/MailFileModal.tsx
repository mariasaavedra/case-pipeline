// =============================================================================
// MailFileModal (M31) — file one piece of mail to a client
// =============================================================================
// Opens on the Mail page (P12) as soon as an upload has been read. The letter
// sits on the left; on the right, everything a person decides, pre-filled
// where the reading allows:
//
//   1. What was read (editable — a correction re-matches the client below)
//   2. The client (the match, other candidates, or a search) and, optionally,
//      the Open Form it belongs to (its Receipt No. / Status get updated)
//   3. The file name, saved in the client's E-File → CC folder
//   4. An e-mail to the client, English + Spanish, from your own Outlook,
//      with the letter attached when it's small enough
//   5. A note for the client's profile (posted automatically, with the link)
//
// "File it" then runs the steps in that order: SharePoint, e-mail, then the
// API (decision, Open Form, Monday note). A step that fails stops the run and
// the button resumes from it, so nothing is saved or sent twice.
//
// The PDF never goes to our server for keeping: it was read there in memory,
// and from here it goes only to SharePoint and Outlook.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  fetchMailClient,
  fetchMailWriteBackPlan,
  fileMailDocument,
  searchClients,
  updateMailFields,
  type MailClient,
  type MailDocument,
  type MailScanDocument,
  type MailWriteBackPlan,
  type NoticeFields,
  type SearchResult,
} from "../api";
import { useAuth } from "../auth/useAuth";
import {
  GraphConsentRequiredError,
  findCcFolder,
  getGraphToken,
  getMailToken,
  sendMailAsMe,
  uploadFile,
} from "../sharepoint/graph";
import {
  MAX_ATTACH_BYTES,
  cleanMailFileName,
  defaultMailFileName,
  mailClientEmail,
  toBase64,
} from "../lib/mail-filing";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { ClientLink } from "./ClientPeek";
import { NoticeFieldsEditor, NoticeFieldsGrid } from "./MailNoticeFields";
import { PlanPreview } from "./MailReviewModal";

const faint = { color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" } as const;
const ink = { color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;
const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", ...ink } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Candidate {
  localId: string;
  name: string;
}

interface Saved {
  url: string;
  fileName: string;
  folder: string;
}

export interface FiledMail {
  documentId: number;
  clientName: string;
  clientLocalId: string;
  saved: Saved;
  emailedTo: string | null;
  note: "posted" | "queued" | "skipped";
  writeback: MailDocument["writebackState"];
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={faint}>
          {title}
        </span>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Radio({ checked, onChange, disabled, children }: { checked: boolean; onChange: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <label
      className="flex items-start gap-2 px-3 py-2 rounded-md text-xs"
      style={{
        ...ink,
        cursor: disabled ? "default" : "pointer",
        background: checked ? "var(--color-amber-light)" : undefined,
        border: `1px solid ${checked ? "var(--color-amber)" : "var(--color-border-light)"}`,
      }}
    >
      <input type="radio" className="mt-0.5" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

function candidatesOf(doc: Pick<MailScanDocument, "match">): Candidate[] {
  const m = doc.match;
  const seen = new Map<string, string>();
  const add = (id: string | null | undefined, name: string | null | undefined) => {
    if (id && !seen.has(id)) seen.set(id, name ?? "Client");
  };
  add(m.profile?.localId, m.profile?.name);
  m.candidateProfiles.forEach((p) => add(p.localId, p.name));
  m.candidateForms.forEach((f) => add(f.profileLocalId, f.profileName));
  return [...seen].map(([localId, name]) => ({ localId, name }));
}

export function MailFileModal({
  doc: initial,
  pdf,
  onClose,
  onFiled,
}: {
  doc: MailScanDocument & { id: number };
  pdf: File;
  onClose: () => void;
  onFiled: (f: FiledMail) => void;
}) {
  const { user } = useAuth();
  const today = new Date().toLocaleDateString("en-CA");

  const [fields, setFields] = useState<NoticeFields>(initial.fields);
  const [match, setMatch] = useState(initial.match);
  const [editing, setEditing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savingFields, setSavingFields] = useState(false);

  const [candidates, setCandidates] = useState<Candidate[]>(() => candidatesOf(initial));
  const [clientId, setClientId] = useState<string | null>(() => initial.match.profile?.localId ?? candidatesOf(initial)[0]?.localId ?? null);
  const [client, setClient] = useState<MailClient | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [formId, setFormId] = useState<string | null>(initial.match.openForm?.localId ?? null);
  const [plan, setPlan] = useState<MailWriteBackPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  const [fileName, setFileName] = useState(() => defaultMailFileName(initial.fields, today));
  const [sendEmail, setSendEmail] = useState(true);
  const [emailTo, setEmailTo] = useState("");
  const canAttach = pdf.size <= MAX_ATTACH_BYTES;
  const [attach, setAttach] = useState(canAttach);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");

  const [running, setRunning] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Steps already done in this popup — a retry resumes after them.
  const [saved, setSaved] = useState<Saved | null>(null);
  const [emailed, setEmailed] = useState<string | null>(null);

  const pdfUrl = useMemo(() => URL.createObjectURL(pdf), [pdf]);
  useEffect(() => () => URL.revokeObjectURL(pdfUrl), [pdfUrl]);

  // The picked client's E-File, e-mail and Open Forms.
  useEffect(() => {
    setClient(null);
    setClientError(null);
    if (!clientId) return;
    let cancelled = false;
    fetchMailClient(clientId)
      .then((c) => {
        if (cancelled) return;
        setClient(c);
        setEmailTo(c.email ?? "");
        setSendEmail(Boolean(c.email));
        setFormId((prev) => (prev && c.openForms.some((f) => f.localId === prev) ? prev : null));
      })
      .catch((e) => !cancelled && setClientError(e instanceof Error ? e.message : "Could not load the client"));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // What the Open Form will get — the server's own plan, so it can't drift.
  useEffect(() => {
    if (!formId) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    fetchMailWriteBackPlan(initial.id, formId)
      .then((p) => !cancelled && setPlan(p))
      .catch(() => !cancelled && setPlan(null))
      .finally(() => !cancelled && setPlanLoading(false));
    return () => {
      cancelled = true;
    };
  }, [initial.id, formId, fields]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchClients(q, ctrl.signal)
        .then((r) => setResults(r.slice(0, 8)))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const pickClient = (c: Candidate) => {
    setCandidates((prev) => (prev.some((p) => p.localId === c.localId) ? prev : [...prev, c]));
    setClientId(c.localId);
  };

  const saveFields = async (edits: Parameters<typeof updateMailFields>[1]) => {
    if (Object.keys(edits).length === 0) {
      setEditing(false);
      return;
    }
    setSavingFields(true);
    setFieldErrors({});
    try {
      const r = await updateMailFields(initial.id, edits);
      if ("fieldErrors" in r) {
        setFieldErrors(r.fieldErrors);
        return;
      }
      setFields(r.doc.fields);
      setMatch(r.doc.match);
      setEditing(false);
      // The corrected reading may point at a client we hadn't listed.
      const more = candidatesOf(r.doc);
      setCandidates((prev) => [...prev, ...more.filter((m) => !prev.some((p) => p.localId === m.localId))]);
      if (!clientId && more[0]) setClientId(more[0].localId);
      if (!saved) setFileName(defaultMailFileName(r.doc.fields, today));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the correction");
    } finally {
      setSavingFields(false);
    }
  };

  const email = client
    ? mailClientEmail({ clientName: client.name, fields, attached: attach && canAttach, message, senderName: user?.name ?? "" })
    : null;
  const emailOk = !sendEmail || EMAIL_RE.test(emailTo.trim());
  const ready = Boolean(client?.eFile) && emailOk && !editing && !running;

  const run = async (interactive: boolean) => {
    if (!client?.eFile) return;
    setRunning(true);
    setError(null);
    try {
      if (interactive) {
        await getGraphToken(true);
        if (sendEmail && !emailed) await getMailToken(true);
      }
      let where = saved;
      if (!where) {
        const cc = await findCcFolder(client.eFile);
        const name = cleanMailFileName(fileName);
        const item = await uploadFile(cc.driveId, cc.itemId, new File([pdf], name, { type: "application/pdf" }));
        // SharePoint renames on a clash ("… 1.pdf"): record what it really is.
        where = { url: item.webUrl, fileName: item.name, folder: `E-File ${cc.eFileName} → ${cc.name}` };
        setSaved(where);
      }
      let to = emailed;
      if (sendEmail && !to && email) {
        to = emailTo.trim();
        await sendMailAsMe(
          {
            to,
            subject: email.subject,
            html: email.html,
            ...(attach && canAttach
              ? { attachments: [{ name: where.fileName, contentType: "application/pdf", contentBytes: await toBase64(pdf) }] }
              : {}),
          },
          interactive,
        );
        setEmailed(to);
      }
      const filed = await fileMailDocument(initial.id, {
        profileLocalId: client.localId,
        openFormLocalId: formId,
        savedTo: where,
        emailedTo: sendEmail ? to : null,
        note: note.trim() || null,
      });
      setNeedsConsent(false);
      onFiled({
        documentId: initial.id,
        clientName: client.name,
        clientLocalId: client.localId,
        saved: where,
        emailedTo: sendEmail ? to : null,
        note: filed.note,
        writeback: filed.writebackState,
      });
    } catch (e) {
      if (e instanceof GraphConsentRequiredError) setNeedsConsent(true);
      else setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRunning(false);
    }
  };

  const title = `${fields.noticeType ?? "Letter"}${fields.formType ? ` · ${fields.formType}` : ""}`;
  const done = (label: string) => (
    <span className="text-[11px] font-semibold" style={{ color: "var(--color-status-green)" }}>
      ✓ {label}
    </span>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent code="M31" className="gap-0 p-0 sm:max-w-[1100px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>File mail: {title}</DialogTitle>
          <DialogDescription>
            {pdf.name} · {initial.pages.length} page{initial.pages.length === 1 ? "" : "s"}
            {initial.ocrPages.length > 0 &&
              ` · read by OCR${initial.ocrConfidence != null ? ` (${initial.ocrConfidence}% confidence) — check the numbers against the page` : ""}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 max-h-[80vh] overflow-y-auto md:overflow-hidden">
          <div className="md:border-r border-border" style={{ background: "var(--color-surface-warm)" }}>
            <iframe title="The letter" src={`${pdfUrl}#view=FitH`} className="w-full block" style={{ height: "min(76vh, 860px)", border: 0 }} />
          </div>

          <div className="px-5 py-4 flex flex-col gap-5 md:max-h-[76vh] md:overflow-y-auto">
            <Section
              title="1 · Read from the letter"
              aside={
                !editing && !saved ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                ) : undefined
              }
            >
              {editing ? (
                <NoticeFieldsEditor
                  fields={fields}
                  saving={savingFields}
                  errors={fieldErrors}
                  onSave={(edits) => void saveFields(edits)}
                  onCancel={() => {
                    setEditing(false);
                    setFieldErrors({});
                  }}
                />
              ) : (
                <NoticeFieldsGrid fields={fields} />
              )}
              <p className="text-xs" style={faint}>
                {match.message}
              </p>
            </Section>

            <Section title="2 · Client">
              {candidates.length === 0 && (
                <p className="text-xs" style={faint}>
                  No client found on the letter. Search for one below.
                </p>
              )}
              {candidates.map((c) => (
                <Radio key={c.localId} checked={clientId === c.localId} disabled={running || Boolean(saved)} onChange={() => setClientId(c.localId)}>
                  <span className="font-medium">{c.name}</span>
                  {match.profile?.localId === c.localId && (
                    <span className="ml-1 text-[10px] font-semibold" style={{ color: "var(--color-amber)" }}>
                      matched
                    </span>
                  )}
                </Radio>
              ))}
              {!saved && (
                <div className="flex flex-col gap-1">
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Another client — name, phone, email…"
                    className="rounded-md px-2 py-1.5 text-sm"
                    style={inputStyle}
                  />
                  {results.length > 0 && (
                    <ul className="rounded-md overflow-hidden" style={{ border: "1px solid var(--color-border-light)" }}>
                      {results.map((r) => (
                        <li key={r.localId}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-1.5 text-xs"
                            style={{ ...ink, background: "var(--color-card)", cursor: "pointer" }}
                            onClick={() => {
                              pickClient({ localId: r.localId, name: r.name });
                              setQuery("");
                              setResults([]);
                            }}
                          >
                            {r.name}
                            {r.phone ? <span style={faint}> · {r.phone}</span> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {clientError && (
                <p role="alert" className="text-xs" style={{ color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
                  {clientError}
                </p>
              )}
              {clientId && !client && !clientError && (
                <p className="text-xs" style={faint}>
                  Loading the client…
                </p>
              )}
              {client && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs" style={faint}>
                    Open Form (optional — gets the Receipt No. / Receipt Status):
                  </span>
                  {client.openForms.map((f) => (
                    <Radio key={f.localId} checked={formId === f.localId} disabled={running || Boolean(saved)} onChange={() => setFormId(f.localId)}>
                      <span className="font-medium">{f.formType ?? "Form ?"}</span>
                      <span style={faint}>
                        {" "}· {f.name}
                        {f.status ? ` · ${f.status}` : ""} · {f.receiptNo ? `Receipt ${f.receiptNo}` : "no receipt yet"}
                      </span>
                    </Radio>
                  ))}
                  <Radio checked={formId === null} disabled={running || Boolean(saved)} onChange={() => setFormId(null)}>
                    <span className="font-medium">No Open Form</span>
                    <span style={faint}> · just file it for the client</span>
                  </Radio>
                  {formId && <PlanPreview plan={plan} loading={planLoading} action="Filing" />}
                </div>
              )}
            </Section>

            <Section title="3 · Save to the E-File → CC" aside={saved ? done("Saved") : undefined}>
              {client && !client.eFile ? (
                <p className="text-xs px-3 py-2 rounded-md" style={{ background: "var(--color-status-yellow-bg)", color: "var(--color-status-yellow)", fontFamily: "var(--font-body)" }}>
                  {client.name} has no E-File link yet. Open{" "}
                  <ClientLink clientId={client.localId} style={{ color: "inherit", fontWeight: 600 }}>
                    their profile
                  </ClientLink>{" "}
                  → Documents → <strong>Find or create e-file folder</strong>, then pick them again here.
                </p>
              ) : saved ? (
                <a href={saved.url} target="_blank" rel="noreferrer" className="text-xs" style={{ color: "var(--color-amber)" }}>
                  {saved.folder} / {saved.fileName}
                </a>
              ) : (
                <label className="flex flex-col gap-1 text-xs" style={faint}>
                  File name
                  <input value={fileName} onChange={(e) => setFileName(e.target.value)} disabled={running} className="rounded-md px-2 py-1.5 text-sm" style={inputStyle} />
                </label>
              )}
            </Section>

            <Section title="4 · E-mail the client" aside={emailed ? done("Sent") : undefined}>
              <label className="flex items-center gap-2 text-xs" style={ink}>
                <input type="checkbox" checked={sendEmail} disabled={running || Boolean(emailed)} onChange={(e) => setSendEmail(e.target.checked)} />
                Send an e-mail (English + Spanish) from your Outlook
              </label>
              {sendEmail && (
                <>
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    disabled={running || Boolean(emailed)}
                    placeholder="client@example.com"
                    aria-invalid={!emailOk || undefined}
                    className="rounded-md px-2 py-1.5 text-sm"
                    style={{ ...inputStyle, ...(emailOk ? {} : { borderColor: "var(--color-status-red)" }) }}
                  />
                  {client && !client.email && (
                    <span className="text-[11px]" style={faint}>
                      No e-mail on the profile — type one, or untick to skip the e-mail.
                    </span>
                  )}
                  <label className="flex items-center gap-2 text-xs" style={ink}>
                    <input type="checkbox" checked={attach && canAttach} disabled={!canAttach || running || Boolean(emailed)} onChange={(e) => setAttach(e.target.checked)} />
                    Attach the letter
                    {!canAttach && <span style={faint}>(too large to e-mail — it’s in their file)</span>}
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={running || Boolean(emailed)}
                    rows={2}
                    placeholder="Anything to add for the client (optional)"
                    className="rounded-md px-2 py-1.5 text-sm"
                    style={inputStyle}
                  />
                  {email && (
                    <details className="text-xs" style={faint}>
                      <summary style={{ cursor: "pointer" }}>Preview the e-mail</summary>
                      <p className="mt-1 font-semibold" style={ink}>
                        {email.subject}
                      </p>
                      <pre className="mt-1 whitespace-pre-wrap" style={{ ...ink, fontSize: 12 }}>
                        {email.text}
                      </pre>
                    </details>
                  )}
                </>
              )}
            </Section>

            <Section title="5 · Note on the client's profile">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={running}
                rows={2}
                placeholder="Optional — added to the automatic note (what came, where it’s saved, whether the client was e-mailed)"
                className="rounded-md px-2 py-1.5 text-sm"
                style={inputStyle}
              />
            </Section>

            {error && (
              <p role="alert" className="text-sm" style={{ color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
                {error}
                {(saved || emailed) && " — press the button again to continue from where it stopped."}
              </p>
            )}

            <div className="flex gap-2 justify-end flex-wrap pb-1">
              <Button type="button" variant="outline" disabled={running} onClick={onClose}>
                {saved ? "Close" : "Cancel"}
              </Button>
              {needsConsent ? (
                <Button type="button" disabled={!ready} onClick={() => void run(true)}>
                  Allow SharePoint{sendEmail ? " and Outlook" : ""}, then file it
                </Button>
              ) : (
                <Button type="button" disabled={!ready} onClick={() => void run(false)}>
                  {running ? "Filing…" : saved || emailed ? "Continue filing" : sendEmail ? "File it & e-mail the client" : "File it"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
