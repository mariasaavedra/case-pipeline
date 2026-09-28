// =============================================================================
// MailReviewModal (M15) — settle one scanned notice the matcher couldn't
// =============================================================================
// Opened from Alerts → "Mail to review" and from the Mail page. The notice's
// own pages sit next to where it could go: the Open Forms the matcher found,
// every Open Form of each candidate client, "client only" for a notice that
// has no form yet, and a search for any other client. Or dismiss it, with a
// reason.
//
// Assigning records the decision (audited). It does not touch Monday yet —
// filling Receipt No. and attaching the PDF is the next step and will act on
// these decisions.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  fetchMailDocument,
  fetchMailDocumentPdf,
  fetchOpenFormsFor,
  resolveMailDocument,
  searchClients,
  type MailDocument,
  type MatchedOpenForm,
  type SearchResult,
} from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Link } from "./Link";
import { clientPath } from "../router";

interface ClientGroup {
  localId: string;
  name: string;
  forms: MatchedOpenForm[] | null; // null while loading
}

type Choice = { kind: "form"; formLocalId: string; profileLocalId: string } | { kind: "client"; profileLocalId: string };

const faint = { color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" } as const;
const ink = { color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5 min-w-[110px]">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={faint}>
        {label}
      </span>
      <span className="text-sm" style={{ ...ink, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

function formatA(a: string): string {
  return `A-${a.slice(0, 3)}-${a.slice(3, 6)}-${a.slice(6)}`;
}

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

export function MailReviewModal({
  documentId,
  onClose,
  onResolved,
}: {
  documentId: number;
  onClose: () => void;
  onResolved?: (doc: MailDocument) => void;
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
    // Pre-select the single obvious candidate, if there is one.
    if (m.candidateForms.length === 1 && m.candidateForms[0]!.profileLocalId) {
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

                <div className="flex flex-wrap gap-4">
                  <Field label="Receipt No." value={f!.receiptNumbers.join(", ")} />
                  <Field label="A-Number" value={f!.aNumbers.map(formatA).join(", ")} />
                  <Field label="Notice date" value={f!.noticeDate} />
                  {f!.people.map((p) => (
                    <Field key={`${p.role}-${p.name}`} label={p.role} value={p.name} />
                  ))}
                </div>

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
                ) : (
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
                      <Button type="button" disabled={saving || !choice} onClick={() => void submit("assign")}>
                        {saving ? "Saving…" : "Assign"}
                      </Button>
                    </div>
                    <p className="text-[11px]" style={faint}>
                      Assigning records the decision. Updating Monday (Receipt No., attaching the PDF) comes in a later step.
                    </p>
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
