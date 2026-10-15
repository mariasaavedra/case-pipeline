// =============================================================================
// CaseCardModal (M27) — one case from P6 My Cases, editable in place
// =============================================================================
// A Paid Fee K (Prescheduling) or an Open Form, with what a paralegal does to
// it every day:
//   - E-File: open the client's SharePoint folder, browse it here (M26), or —
//     when the client has none — paste the link (saved to the profile's E-File
//     on Monday, only where none is).
//   - Status: PS Stage (Fee K) or Status (Open Form), from the board's real
//     labels, with a confirm step (D39).
//   - Dates: Reminder sent / Evidence received (Fee K); Forms appointment /
//     Target date / Forms sent (Open Form). "Today" sets one in one click.
//   - Notes tab: the client's timeline (notes, or all with emails; replies),
//     with a box to post a note on the profile — same feed as M3's Notes.
// Every write: PATCH /api/{contracts|open-forms}/:id/case-field with what the
// card showed (`from`) — refused if Monday changed since; queued on an outage.
// Plan = apps/api/src/routes/case-card-write.ts.
// =============================================================================

import { useEffect, useState } from "react";
import {
  updateCaseField,
  setProfileEFile,
  postProfileUpdate,
  fetchClientUpdates,
  type ClientUpdate,
  type CaseCardKind,
  type MyOpenForm,
  type MyPreschedulingCase,
  type StatusColumnOption,
} from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button, buttonVariants } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { ClientFilesModal } from "./ClientFilesModal";
import { UpdatesTimeline } from "./UpdatesTimeline";
import type { TimelineFilter } from "./TimelineFilters";
import { FormChip, Tag, formatDue, waitFg } from "./caseBoardParts";
import { openClientPeek } from "../router";
import { MONDAY_FEE_KS_BOARD_ID, MONDAY_OPEN_FORMS_BOARD_ID, mondayItemUrl } from "../config";

export type CaseCard =
  | { kind: "fee_k"; c: MyPreschedulingCase }
  | { kind: "open_form"; c: MyOpenForm };

interface Props {
  card: CaseCard;
  statuses: StatusColumnOption[];
  /** After any saved (or queued) change, so the page can refresh its list. */
  onChanged: () => void;
  onClose: () => void;
}

interface DateField {
  key: string;
  label: string;
  value: string | null;
  /** Editable on Monday from here; read-only otherwise. */
  editable: boolean;
  /** Records something that happened: never in the future, "Today" offered. */
  past?: boolean;
  hint?: string;
}

const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

function firmToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/** "today", "in 3d", "12d ago" for a YYYY-MM-DD. */
function relative(iso: string): string {
  const days = Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(`${firmToday()}T00:00:00`).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days}d` : `${-days}d ago`;
}

function datesOf(card: CaseCard, values: Record<string, string | null>): DateField[] {
  const v = (key: string, fallback: string | null) => (key in values ? values[key]! : fallback);
  if (card.kind === "fee_k") {
    const c = card.c;
    return [
      { key: "hire_date", label: "Hired", value: c.hireDate, editable: false, hint: c.daysWaiting !== null ? `${c.daysWaiting} days waiting` : undefined },
      { key: "reminder_sent_checked_on", label: "Reminder sent", value: v("reminder_sent_checked_on", c.reminderSentOn), editable: true, past: true },
      { key: "evidence_received_date", label: "Evidence received", value: v("evidence_received_date", c.evidenceReceivedOn), editable: true, past: true },
      ...(c.parked ? [{ key: "north_pole_until", label: "North Pole until", value: c.northPoleUntil, editable: false }] : []),
    ];
  }
  const c = card.c;
  return [
    { key: "on_open_forms_since", label: "On Open Forms since", value: c.onOpenFormsSince, editable: false },
    ...(c.hireDate ? [{ key: "hire_date", label: "Hired", value: c.hireDate, editable: false }] : []),
    { key: "forms_appt_date", label: "Forms appointment", value: v("forms_appt_date", c.formsApptDate), editable: true },
    { key: "target_date", label: "Target date", value: v("target_date", c.targetDate), editable: true },
    { key: "forms_sent_date", label: "Forms sent", value: v("forms_sent_date", c.formsSentDate), editable: true, past: true },
  ];
}

// -----------------------------------------------------------------------------
// Pieces
// -----------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-3.5" style={{ borderTop: "1px solid var(--color-border-light)" }}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-ink-faint)" }}>{title}</h3>
      {children}
    </section>
  );
}

function Dot({ color }: { color: string | null | undefined }) {
  return <span className="inline-block size-2.5 rounded-full shrink-0" style={{ background: color ?? "var(--color-ink-faint)" }} />;
}

function DateRow({ f, busy, onSave }: { f: DateField; busy: boolean; onSave: (value: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(f.value ?? "");
  const today = firmToday();

  const save = async (value: string) => {
    if (await onSave(value)) setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 min-h-8 py-0.5">
      <span className="text-sm w-40 shrink-0" style={{ color: "var(--color-ink-muted)" }}>{f.label}</span>
      {editing ? (
        <form className="flex items-center gap-1.5 flex-wrap" onSubmit={(e) => { e.preventDefault(); void save(draft); }}>
          <input type="date" value={draft} max={f.past ? today : undefined} autoFocus aria-label={f.label}
            onChange={(e) => setDraft(e.target.value)} className="rounded-md px-2 py-0.5 text-sm" style={inputStyle} />
          <Button type="submit" size="xs" disabled={busy || draft === (f.value ?? "")}>{busy ? "Saving…" : "Save"}</Button>
          {f.value && (
            <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void save("")}>Clear</Button>
          )}
          <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setDraft(f.value ?? ""); }}>Cancel</Button>
        </form>
      ) : (
        <>
          <span className="text-sm tabular-nums" style={{ color: f.value ? "var(--color-ink)" : "var(--color-ink-faint)" }}>
            {f.value ? formatDue(f.value) : "—"}
          </span>
          {(f.value || f.hint) && (
            <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>{f.hint ?? relative(f.value!)}</span>
          )}
          {f.editable && (
            <span className="ml-auto flex items-center gap-1">
              {f.past && f.value !== today && (
                <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void save(today)}
                  title={`Set ${f.label} to today`}>
                  Today
                </Button>
              )}
              <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => { setDraft(f.value ?? ""); setEditing(true); }}>
                {f.value ? "Edit" : "Set"}
              </Button>
            </span>
          )}
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Modal
// -----------------------------------------------------------------------------

export function CaseCardModal({ card, statuses, onChanged, onClose }: Props) {
  const { kind, c } = card;
  const statusField = kind === "fee_k" ? "ps_stage" : "status";
  const statusLabel = kind === "fee_k" ? "PS Stage" : "Status";
  const initialStatus = kind === "fee_k" ? card.c.psStage : card.c.status;

  // What Monday has as far as this card knows: starts as loaded, follows each save.
  const [values, setValues] = useState<Record<string, string | null>>({});
  const status = statusField in values ? values[statusField]! : initialStatus;
  const [eFile, setEFile] = useState<string | null>(c.eFile);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"details" | "notes">("details");
  const [notesFilter, setNotesFilter] = useState<TimelineFilter>("notes");
  // The client's timeline, fetched the first time the Notes tab opens (and per
  // filter, server-side, like M3 — `limit` caps the newest rows).
  const [feed, setFeed] = useState<ClientUpdate[] | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedVersion, setFeedVersion] = useState(0);
  useEffect(() => {
    if (tab !== "notes" || !c.clientLocalId) return;
    let live = true;
    setFeed(null);
    setFeedError(null);
    fetchClientUpdates(c.clientLocalId, { category: notesFilter, limit: 500 })
      .then((rows) => live && setFeed(rows))
      .catch((e: unknown) => live && setFeedError(e instanceof Error ? e.message : "Could not load the notes"));
    return () => {
      live = false;
    };
  }, [tab, notesFilter, c.clientLocalId, feedVersion]);

  const done = (what: string, pending: boolean) => {
    setMessage({ text: pending ? `${what} — saved here; Monday is unreachable, it will be sent when it's back.` : `${what} — saved to Monday.`, error: false });
    onChanged();
  };
  const fail = (e: unknown) => setMessage({ text: e instanceof Error ? e.message : "Could not save", error: true });

  const write = async (field: string, label: string, value: string, from: string | null, isDate: boolean): Promise<boolean> => {
    setBusy(field);
    setMessage(null);
    try {
      const r = await updateCaseField(kind as CaseCardKind, c.localId, field, value, from);
      setValues((v) => ({ ...v, [field]: r.value }));
      done(r.value ? `${label}: ${isDate ? formatDue(r.value) : r.value}` : `${label} cleared`, r.pending);
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveLink = async () => {
    if (!c.clientLocalId) return;
    setBusy("e_file");
    setMessage(null);
    try {
      // Only offered when the client has no E-File: nothing to replace.
      const r = await setProfileEFile(c.clientLocalId, linkDraft.trim());
      setEFile(r.eFile);
      setLinking(false);
      setLinkDraft("");
      done("E-File linked", r.pending);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const postNote = async () => {
    if (!c.clientLocalId || !note.trim()) return;
    setBusy("note");
    setMessage(null);
    try {
      await postProfileUpdate(c.clientLocalId, note.trim());
      setNote("");
      setFeedVersion((v) => v + 1);
      done("Note posted on the client's profile", false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const optionOf = (label: string | null) => statuses.find((o) => o.label === label);
  const items = statuses.map((o) => ({ value: o.label, label: o.label }));
  const boardId = kind === "fee_k" ? MONDAY_FEE_KS_BOARD_ID : MONDAY_OPEN_FORMS_BOARD_ID;
  const subtitle = kind === "fee_k"
    ? `Prescheduling · Fee K${card.c.itWillGoTo ? ` → ${card.c.itWillGoTo}` : ""}`
    : `${card.c.isCourtCase ? "Court Forms" : "Open Forms"} · ${card.c.formName}`;
  const people = kind === "fee_k" ? card.c.paralegals : card.c.assignees;
  const chips = kind === "fee_k" ? card.c.contractFor : card.c.forms;

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent code="M27" className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="gap-1 border-b border-border px-5 py-4 pr-12">
            <DialogTitle style={{ fontFamily: "var(--font-display)" }}>{c.clientName}</DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {chips.map((f) => <FormChip key={f} label={f} />)}
              {kind === "fee_k" && card.c.notCooperating && <Tag color="overdue" title="Reminder sent and no evidence received since">Not cooperating</Tag>}
              {kind === "fee_k" && card.c.daysWaiting !== null && (
                <span className="text-xs font-semibold" style={{ color: waitFg(card.c.waitLevel) }}>{card.c.daysWaiting}d since hire</span>
              )}
              {kind === "open_form" && card.c.urgent && <Tag color="overdue">Urgent</Tag>}
              {c.parked && <Tag color="snooze">North Pole</Tag>}
            </div>
          </DialogHeader>

          {c.clientLocalId && (
            <nav role="tablist" aria-label="Case card" className="flex gap-1 px-5 border-b border-border">
              {(["details", "notes"] as const).map((id) => (
                <button key={id} role="tab" type="button" id={`m27-tab-${id}`} aria-selected={tab === id}
                  aria-controls={`m27-panel-${id}`} className="tab-button" style={{ padding: "8px 14px", fontSize: 13 }}
                  onClick={() => setTab(id)}>
                  {id === "details" ? "Details" : "Notes"}
                </button>
              ))}
            </nav>
          )}

          {tab === "notes" && c.clientLocalId ? (
            <div role="tabpanel" id="m27-panel-notes" aria-labelledby="m27-tab-notes" className="overflow-y-auto px-5 py-3.5 min-h-[320px]">
              <form className="pb-3" onSubmit={(e) => { e.preventDefault(); void postNote(); }}>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                  placeholder="Add a note — posted as an update on the client's profile in Monday"
                  aria-label="Note" className="w-full rounded-md px-2 py-1.5 text-sm resize-y" style={inputStyle} />
                <div className="flex justify-end pt-1.5">
                  <Button type="submit" size="sm" disabled={busy === "note" || !note.trim()}>{busy === "note" ? "Posting…" : "Post note"}</Button>
                </div>
              </form>
              <div className="flex items-center gap-2 pb-3" role="group" aria-label="Timeline filter">
                {(["notes", "all"] as const).map((id) => (
                  <button key={id} type="button" className={`filter-chip ${notesFilter === id ? "filter-chip-active" : ""}`}
                    onClick={() => setNotesFilter(id)} aria-pressed={notesFilter === id}>
                    {id === "notes" ? "Notes" : "All (with emails)"}
                  </button>
                ))}
              </div>
              {feedError ? (
                <p className="text-sm" style={{ color: "var(--urgency-overdue)" }}>{feedError}</p>
              ) : (
                <UpdatesTimeline updates={feed ?? []} filter={notesFilter} loading={feed === null}
                  onReplyPosted={() => setFeedVersion((v) => v + 1)} />
              )}
            </div>
          ) : (
          <div role="tabpanel" id="m27-panel-details" aria-labelledby="m27-tab-details" className="overflow-y-auto">
            {/* E-File + links */}
            <section className="px-5 py-3.5 flex items-center gap-2 flex-wrap">
              {eFile ? (
                <>
                  <a href={eFile} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm" })}>
                    📁 Open E-File ↗
                  </a>
                  {c.clientLocalId && (
                    <Button type="button" size="sm" variant="outline" onClick={() => setBrowsing(true)}>Browse files here</Button>
                  )}
                </>
              ) : c.clientLocalId ? (
                !linking && (
                  <Button type="button" size="sm" onClick={() => setLinking(true)}>📁 Link E-File folder</Button>
                )
              ) : (
                <span className="text-sm" style={{ color: "var(--color-ink-faint)" }}>No client profile linked on Monday — no E-File.</span>
              )}
              <span className="ml-auto flex items-center gap-1">
                {c.clientLocalId && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => { onClose(); openClientPeek(c.clientLocalId!, c.clientName); }}>
                    Client
                  </Button>
                )}
                {c.mondayItemId && (
                  <a href={mondayItemUrl(boardId, c.mondayItemId)} target="_blank" rel="noreferrer"
                    className={buttonVariants({ size: "sm", variant: "ghost" })}>
                    Monday ↗
                  </a>
                )}
              </span>
              {linking && (
                <form className="w-full flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void saveLink(); }}>
                  <input value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)} autoFocus
                    placeholder="Paste the SharePoint folder link (https://…sharepoint.com/…)" aria-label="E-File folder link"
                    className="flex-1 min-w-0 rounded-md px-2 py-1 text-sm" style={inputStyle} />
                  <Button type="submit" size="sm" disabled={busy === "e_file" || !linkDraft.trim()}>{busy === "e_file" ? "Saving…" : "Save"}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setLinking(false); setLinkDraft(""); }}>Cancel</Button>
                </form>
              )}
              {linking && (
                <p className="w-full text-xs" style={{ color: "var(--color-ink-faint)" }}>Saved as the E-File on the client's profile in Monday.</p>
              )}
            </section>

            {/* Status / PS Stage */}
            <Section title={statusLabel}>
              {confirmStatus ? (
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span style={{ color: "var(--color-ink)" }}>
                    Change {statusLabel} to <strong>{confirmStatus}</strong>?
                  </span>
                  <Button type="button" size="sm" disabled={busy === statusField}
                    onClick={async () => { if (await write(statusField, statusLabel, confirmStatus, status, false)) setConfirmStatus(null); }}>
                    {busy === statusField ? "Saving…" : "Change"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy === statusField} onClick={() => setConfirmStatus(null)}>Cancel</Button>
                </div>
              ) : statuses.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>{status ?? "No status"} — the board's labels aren't synced yet.</p>
              ) : (
                <Select items={items} value={status ?? ""} onValueChange={(v) => v && v !== status && setConfirmStatus(v)}>
                  <SelectTrigger size="sm" className="bg-secondary text-[13px] min-w-60" aria-label={`${statusLabel} for ${c.clientName}`}>
                    <span className="flex items-center gap-2">
                      <Dot color={optionOf(status)?.color} />
                      <SelectValue placeholder={`No ${statusLabel}`} />
                    </span>
                  </SelectTrigger>
                  <SelectContent code="D39">
                    {statuses.map((o) => (
                      <SelectItem key={o.label} value={o.label}>
                        <span className="flex items-center gap-2"><Dot color={o.color} />{o.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Section>

            {/* Dates */}
            <Section title="Dates">
              {datesOf(card, values).map((f) => (
                <DateRow key={`${f.key}:${f.value ?? ""}`} f={f} busy={busy === f.key}
                  onSave={(value) => write(f.key, f.label, value, f.value, true)} />
              ))}
            </Section>

            {/* People */}
            <Section title="People">
              <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                <span style={{ color: "var(--color-ink-muted)" }}>Paralegal:</span> {people.length > 0 ? people.join(", ") : "Unassigned"}
                {c.attorney && <><span className="ml-3" style={{ color: "var(--color-ink-muted)" }}>Attorney:</span> {c.attorney}</>}
              </p>
            </Section>
          </div>
          )}

          {message && (
            <p className="px-5 py-2.5 text-sm border-t border-border"
              style={{ color: message.error ? "var(--urgency-overdue)" : "var(--color-ink-muted)" }} role="status">
              {message.text}
            </p>
          )}
        </DialogContent>
      </Dialog>
      {browsing && c.clientLocalId && (
        <ClientFilesModal clientLocalId={c.clientLocalId} clientName={c.clientName} onClose={() => setBrowsing(false)} />
      )}
    </>
  );
}
