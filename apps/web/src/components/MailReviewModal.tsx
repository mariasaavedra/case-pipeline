// =============================================================================
// MailReviewModal (M15) — settle one scanned notice the matcher couldn't
// =============================================================================
// Opened from Alerts → "Mail to review" and from the Mail page. The notice's
// own pages sit next to where it could go: the Open Forms the matcher found,
// every Open Form of each candidate client, "client only" for a notice that
// has no form yet, and a search for any other client. Or dismiss it, with a
// reason.
//
// Everything read off the notice is shown, and editable while the notice is
// open: a correction is saved, the notice is re-matched on it, and the
// candidates below refresh. The original reading stays visible next to any
// field that was changed.
//
// Assigning to an Open Form records the decision and then updates Monday:
// Receipt No., Receipt Status, and the notice attached. Before the button is
// pressed, the popup shows that exact plan (fetched from the server, which runs
// it), including what it will NOT touch and why. Afterwards it shows what
// happened per step, with Retry for anything that failed.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  fetchMailDocument,
  fetchMailDocumentPdf,
  fetchOpenFormsFor,
  fetchMailWriteBackPlan,
  retryMailWriteBack,
  resolveMailDocument,
  updateMailFields,
  searchClients,
  type MailDocument,
  type MailWriteBackPlan,
  type MatchedOpenForm,
  type SearchResult,
} from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Link } from "./Link";
import { NoticeFieldsEditor, NoticeFieldsGrid } from "./MailNoticeFields";
import { clientPath } from "../router";

interface ClientGroup {
  localId: string;
  name: string;
  forms: MatchedOpenForm[] | null; // null while loading
}

type Choice = { kind: "form"; formLocalId: string; profileLocalId: string } | { kind: "client"; profileLocalId: string };

const faint = { color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" } as const;
const ink = { color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

function sameChoice(a: Choice | null, b: Choice): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === "form" ? a.formLocalId === (b as { formLocalId: string }).formLocalId : a.profileLocalId === b.profileLocalId;
}

function ChoiceRow({
  choice,
  selected,
  onSelect,
  disabled,
  children,
}: {
  choice: Choice;
  selected: Choice | null;
  onSelect: (c: Choice) => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const on = sameChoice(selected, choice);
  return (
    <label
      className="flex items-start gap-2 px-3 py-2 rounded-md text-xs"
      style={{
        ...ink,
        cursor: disabled ? "default" : "pointer",
        background: on ? "var(--color-amber-light)" : undefined,
        border: `1px solid ${on ? "var(--color-amber)" : "var(--color-border-light)"}`,
      }}
    >
      <input
        type="radio"
        name="mail-choice"
        className="mt-0.5"
        checked={on}
        disabled={disabled}
        onChange={() => onSelect(choice)}
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

const STEP_LABEL = { receipt_no: "Receipt No.", receipt_status: "Receipt Status", attach: "Attach notice" } as const;

function PlanPreview({ plan, loading }: { plan: MailWriteBackPlan | null; loading: boolean }) {
  if (loading && !plan) {
    return (
      <p className="text-xs" style={faint}>
        Checking what this would change in Monday…
      </p>
    );
  }
  if (!plan) return null;
  if (plan.blockers.length > 0) {
    return (
      <div className="text-xs px-3 py-2 rounded-md" style={{ background: "var(--color-status-gray-bg)", color: "var(--color-status-gray)", fontFamily: "var(--font-body)" }}>
        <span className="font-semibold">Nothing will be written to Monday.</span> {plan.blockers.join(" ")}
      </div>
    );
  }
  return (
    <div className="text-xs px-3 py-2 rounded-md flex flex-col gap-1" style={{ background: "var(--color-status-blue-bg)", color: "var(--color-status-blue)", fontFamily: "var(--font-body)" }}>
      <span className="font-semibold">{plan.steps.length > 0 ? "Assign will update Monday:" : "Assign changes nothing in Monday:"}</span>
      {plan.steps.map((st) => (
        <span key={st.kind}>
          • {st.kind === "attach" ? `${st.columnTitle}: attach “${st.value}”` : `${st.columnTitle}: ${st.current ?? "empty"} → ${st.value}`}
        </span>
      ))}
      {plan.skipped.map((sk) => (
        <span key={sk.kind} style={{ opacity: 0.75 }}>
          • {STEP_LABEL[sk.kind]} left as is — {sk.reason}
        </span>
      ))}
    </div>
  );
}

const RESULT_STYLE = {
  done: { text: "✓", color: "var(--color-status-green)" },
  queued: { text: "…", color: "var(--color-status-blue)" },
  failed: { text: "✗", color: "var(--color-status-red)" },
  skipped: { text: "–", color: "var(--color-ink-faint)" },
} as const;

const STATE_TEXT: Record<string, string> = {
  done: "Updated in Monday",
  queued: "Monday didn't answer — retrying in the background",
  partial: "Partly updated in Monday",
  failed: "Monday update failed",
  skipped: "Not written to Monday",
  none: "Not sent to Monday",
};

function WriteBackResult({ doc, onRetry, retrying }: { doc: MailDocument; onRetry: () => void; retrying: boolean }) {
  if (doc.reviewState !== "assigned" || !doc.openForm) return null;
  const canRetry = ["failed", "partial", "none"].includes(doc.writebackState) || (doc.writebackState === "skipped" && !doc.isSample);
  return (
    <div className="flex flex-col gap-1 text-xs px-3 py-2 rounded-md" style={{ border: "1px solid var(--color-border-light)", fontFamily: "var(--font-body)", color: "var(--color-ink)" }}>
      <span className="font-semibold">{STATE_TEXT[doc.writebackState] ?? doc.writebackState}</span>
      {doc.writebackSteps.map((st, i) => (
        <span key={`${st.kind}-${i}`} style={{ color: RESULT_STYLE[st.result].color }}>
          {RESULT_STYLE[st.result].text} {st.columnTitle || STEP_LABEL[st.kind]}
          {st.result !== "skipped" && st.value ? `: ${st.value}` : ""}
          {st.detail ? ` — ${st.detail}` : ""}
        </span>
      ))}
      {doc.writebackError && doc.writebackSteps.length === 0 && <span style={faint}>{doc.writebackError}</span>}
      {canRetry && (
        <div>
          <Button type="button" size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
            {retrying ? "Sending…" : "Retry sending to Monday"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function MailReviewModal({
  documentId,
  onClose,
  onResolved,
  onUpdated,
}: {
  documentId: number;
  onClose: () => void;
  onResolved?: (doc: MailDocument) => void;
  /** Fields were corrected and the notice re-matched (still open). */
  onUpdated?: (doc: MailDocument) => void;
}) {
  const [doc, setDoc] = useState<MailDocument | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [groups, setGroups] = useState<ClientGroup[]>([]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<MailWriteBackPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // The notice, then its pages.
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetchMailDocument(documentId)
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
        if (!d.hasPdf) return;
        return fetchMailDocumentPdf(documentId).then((blob) => {
          if (cancelled) return;
          url = URL.createObjectURL(blob);
          setPdfUrl(url);
        });
      })
      .catch((e) => !cancelled && setPdfError(e instanceof Error ? e.message : "Could not load the notice"));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [documentId]);

  const addClient = (localId: string, name: string) => {
    setGroups((prev) => {
      if (prev.some((g) => g.localId === localId)) return prev;
      return [...prev, { localId, name, forms: null }];
    });
    fetchOpenFormsFor(localId)
      .then((forms) => setGroups((prev) => prev.map((g) => (g.localId === localId ? { ...g, forms } : g))))
      .catch(() => setGroups((prev) => prev.map((g) => (g.localId === localId ? { ...g, forms: [] } : g))));
  };

  // Every client the matcher pointed at, with ALL their Open Forms — the right
  // one is often a form the matcher ruled out on type.
  useEffect(() => {
    if (!doc) return;
    // A re-match (after a correction) brings new candidates: start over.
    setGroups([]);
    setChoice(null);
    const m = doc.match;
    const seen = new Map<string, string>();
    const add = (id: string | null | undefined, name: string | null | undefined) => {
      if (id && !seen.has(id)) seen.set(id, name ?? "Client");
    };
    add(m.profile?.localId, m.profile?.name);
    m.candidateProfiles.forEach((p) => add(p.localId, p.name));
    m.candidateForms.forEach((f) => add(f.profileLocalId, f.profileName));
    if (m.openForm) add(m.openForm.profileLocalId, m.profile?.name);
    seen.forEach((name, id) => addClient(id, name));
    // Pre-select the obvious answer: the matcher's own form, or a lone candidate.
    if (m.openForm?.profileLocalId) {
      setChoice({ kind: "form", formLocalId: m.openForm.localId, profileLocalId: m.openForm.profileLocalId });
    } else if (m.candidateForms.length === 1 && m.candidateForms[0]!.profileLocalId) {
      setChoice({ kind: "form", formLocalId: m.candidateForms[0]!.localId, profileLocalId: m.candidateForms[0]!.profileLocalId });
    }
  }, [doc]);

  const candidateFormIds = useMemo(() => new Set(doc?.match.candidateForms.map((f) => f.localId) ?? []), [doc]);

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

  const open = doc?.reviewState === "open";

  // The write-back plan for whatever form is picked — the server's own plan,
  // so the preview can't drift from what actually runs.
  const pickedForm = choice?.kind === "form" ? choice.formLocalId : null;
  useEffect(() => {
    if (!doc || !open || !pickedForm) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    fetchMailWriteBackPlan(doc.id, pickedForm)
      .then((p) => !cancelled && setPlan(p))
      .catch(() => !cancelled && setPlan(null))
      .finally(() => !cancelled && setPlanLoading(false));
    return () => {
      cancelled = true;
    };
  }, [doc, open, pickedForm]);

  const retry = async () => {
    if (!doc) return;
    setRetrying(true);
    setError(null);
    try {
      const updated = await retryMailWriteBack(doc.id);
      setDoc(updated);
      onResolved?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not retry");
    } finally {
      setRetrying(false);
    }
  };

  const willWrite = choice?.kind === "form" && plan != null && plan.blockers.length === 0 && plan.steps.length > 0;

  const submit = async (action: "assign" | "dismiss") => {
    if (!doc) return;
    setSaving(true);
    setError(null);
    try {
      const updated =
        action === "dismiss"
          ? await resolveMailDocument(doc.id, { action: "dismiss", note: note.trim() })
          : await resolveMailDocument(doc.id, {
              action: "assign",
              ...(choice?.kind === "form"
                ? { openFormLocalId: choice.formLocalId, profileLocalId: choice.profileLocalId }
                : { profileLocalId: choice!.profileLocalId }),
              ...(note.trim() ? { note: note.trim() } : {}),
            });
      setDoc(updated);
      onResolved?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const saveFields = async (edits: Parameters<typeof updateMailFields>[1]) => {
    if (!doc) return;
    if (Object.keys(edits).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setFieldErrors({});
    setError(null);
    try {
      const r = await updateMailFields(doc.id, edits);
      if ("fieldErrors" in r) {
        setFieldErrors(r.fieldErrors);
        return;
      }
      setDoc(r.doc);
      setEditing(false);
      onUpdated?.(r.doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const f = doc?.fields;
  const title = f ? `${f.noticeType ?? "Unknown document"}${f.formType ? ` · ${f.formType}` : ""}` : "Loading…";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent code="M15" className="gap-0 p-0 sm:max-w-[1040px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>
            {title}
            {doc?.isSample && (
              <span
                className="ml-2 align-middle text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: "var(--color-status-gray-bg)", color: "var(--color-status-gray)" }}
              >
                SAMPLE
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {doc
              ? `${doc.fileName} · page${doc.pages.length > 1 ? "s" : ""} ${doc.pages.join(", ")} · scanned ${doc.uploadedAt.slice(0, 10)}${doc.uploadedByName ? ` by ${doc.uploadedByName}` : ""}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 max-h-[78vh] overflow-y-auto md:overflow-hidden">
          {/* The notice itself */}
          <div className="md:border-r border-border" style={{ background: "var(--color-surface-warm)" }}>
            {pdfUrl ? (
              <iframe title="Notice" src={`${pdfUrl}#view=FitH`} className="w-full block" style={{ height: "min(74vh, 820px)", border: 0 }} />
            ) : (
              <p className="px-5 py-10 text-center text-sm" style={faint}>
                {pdfError ?? (doc && !doc.hasPdf ? "The scan file wasn't stored for this notice." : "Loading pages…")}
              </p>
            )}
          </div>

          {/* Where it goes */}
          <div className="px-5 py-4 flex flex-col gap-4 md:max-h-[74vh] md:overflow-y-auto">
            {doc && (
              <>
                <p
                  className="text-sm px-3 py-2 rounded-md"
                  style={{ background: "var(--color-status-yellow-bg)", color: "var(--color-status-yellow)", fontFamily: "var(--font-body)" }}
                >
                  {doc.match.message}
                  {doc.ocrConfidence != null && ` Read by OCR (${doc.ocrConfidence}% confidence) — check the numbers against the page.`}
                  {doc.uncertainPages.length > 0 && ` Page ${doc.uncertainPages.join(", ")} may belong to another notice.`}
                </p>

                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={faint}>
                      Read from the notice
                      {doc.fieldsEditedByName ? ` · corrected by ${doc.fieldsEditedByName}` : ""}
                    </span>
                    {open && !editing && (
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                        Edit
                      </Button>
                    )}
                  </div>
                  {editing ? (
                    <NoticeFieldsEditor
                      fields={f!}
                      saving={saving}
                      errors={fieldErrors}
                      onSave={(edits) => void saveFields(edits)}
                      onCancel={() => {
                        setEditing(false);
                        setFieldErrors({});
                      }}
                    />
                  ) : (
                    <NoticeFieldsGrid fields={f!} original={doc.originalFields} showEmpty />
                  )}
                </section>

                {!open ? (
                  <div
                    className="text-sm px-3 py-2 rounded-md"
                    style={{ background: "var(--color-status-green-bg)", color: "var(--color-status-green)", fontFamily: "var(--font-body)" }}
                  >
                    {doc.reviewState === "assigned" ? "Assigned" : "Dismissed"}
                    {doc.resolvedByName ? ` by ${doc.resolvedByName}` : ""}
                    {doc.resolvedAt ? ` on ${doc.resolvedAt.slice(0, 10)}` : ""}
                    {doc.reviewState === "assigned" && (doc.openForm || doc.profile) && (
                      <>
                        {" → "}
                        {doc.profile ? (
                          <Link href={clientPath(doc.profile.localId)} style={{ color: "inherit", fontWeight: 600 }}>
                            {doc.profile.name}
                          </Link>
                        ) : null}
                        {doc.openForm ? ` · ${doc.openForm.formType ?? doc.openForm.name}` : " (client only)"}
                      </>
                    )}
                    {doc.resolutionNote ? ` — “${doc.resolutionNote}”` : ""}
                  </div>
                ) : null}

                {!open && <WriteBackResult doc={doc} onRetry={() => void retry()} retrying={retrying} />}
                {!open && error && (
                  <p role="alert" className="text-sm" style={{ color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
                    {error}
                  </p>
                )}

                {open && (
                  <div className="flex flex-col gap-3">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={faint}>
                      Where does it go?
                    </span>

                    {groups.length === 0 && (
                      <p className="text-xs" style={faint}>
                        No client matched. Search for one below, or dismiss it.
                      </p>
                    )}

                    {groups.map((g) => (
                      <div key={g.localId} className="flex flex-col gap-1.5">
                        <Link href={clientPath(g.localId)} className="text-sm font-semibold" style={{ color: "var(--color-amber)" }}>
                          {g.name}
                        </Link>
                        {g.forms === null ? (
                          <span className="text-xs" style={faint}>
                            Loading Open Forms…
                          </span>
                        ) : (
                          <>
                            {g.forms.map((form) => (
                              <ChoiceRow
                                key={form.localId}
                                choice={{ kind: "form", formLocalId: form.localId, profileLocalId: g.localId }}
                                selected={choice}
                                onSelect={setChoice}
                                disabled={saving}
                              >
                                <span className="font-medium">{form.formType ?? "Form ?"}</span>
                                <span style={faint}>
                                  {" "}
                                  · {form.name}
                                  {form.status ? ` · ${form.status}` : ""} ·{" "}
                                  {form.receiptNo ? `Receipt ${form.receiptNo}` : "no receipt yet"}
                                </span>
                                {candidateFormIds.has(form.localId) && (
                                  <span className="ml-1 text-[10px] font-semibold" style={{ color: "var(--color-amber)" }}>
                                    suggested
                                  </span>
                                )}
                              </ChoiceRow>
                            ))}
                            <ChoiceRow
                              choice={{ kind: "client", profileLocalId: g.localId }}
                              selected={choice}
                              onSelect={setChoice}
                              disabled={saving}
                            >
                              <span className="font-medium">Client only</span>
                              <span style={faint}> · no Open Form for this yet</span>
                            </ChoiceRow>
                          </>
                        )}
                      </div>
                    ))}

                    <div className="flex flex-col gap-1">
                      <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Another client — name, phone, email…"
                        className="rounded-md px-2 py-1.5 text-sm"
                        style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", ...ink }}
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
                                  addClient(r.localId, r.name);
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

                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="Note (required to dismiss) — e.g. “duplicate of yesterday’s scan”"
                      className="rounded-md px-2 py-1.5 text-sm"
                      style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", ...ink }}
                    />

                    {choice?.kind === "form" && <PlanPreview plan={plan} loading={planLoading} />}
                    {choice?.kind === "client" && (
                      <p className="text-xs" style={faint}>
                        Client only: the decision is recorded; nothing is written to Monday.
                      </p>
                    )}

                    {error && (
                      <p role="alert" className="text-sm" style={{ color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
                        {error}
                      </p>
                    )}

                    <div className="flex gap-2 justify-end flex-wrap">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={saving || !note.trim()}
                        title={note.trim() ? undefined : "Add a note saying why"}
                        onClick={() => void submit("dismiss")}
                      >
                        Dismiss
                      </Button>
                      <Button
                        type="button"
                        disabled={saving || !choice || (choice.kind === "form" && planLoading)}
                        onClick={() => void submit("assign")}
                      >
                        {saving ? (willWrite ? "Updating Monday…" : "Saving…") : willWrite ? "Assign & update Monday" : "Assign"}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
