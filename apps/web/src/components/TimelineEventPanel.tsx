import { useEffect, useState } from "react";
import { changeBoardItemColumn, fetchTimelineItem, postProfileUpdate, postTimelineReply } from "../api";
import type { TimelineEvent, TimelineFix, TimelineItem } from "../api";
import { mondayItemUrl } from "../config";
import { ColumnField } from "./ColumnField";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

// M29 Timeline event — opened from P3.9 (a marker, a story row, or "Fix" on a
// "Needs attention" item). Shows the event's Monday item with the fields the
// timeline reads first, so a missing outcome or filing can be recorded in
// place (PATCH /api/board-items/:localId/columns, local copy updated at once),
// plus a note: a reply under an E&A entry, else an update on the profile.

/** Calendaring statuses that say what happened at a hearing. */
const OUTCOME = /ATTENDED|NOT HAPPENING|WITHDREW|NO SHOW/i;

const FIX_HINT: Record<TimelineFix["kind"], string> = {
  hearing_outcome: "Nobody recorded what happened at this hearing. Pick the outcome below, and add a note if there's more to say.",
  deadline:
    "This deadline passed and the timeline found no filing. Record it below: the status (an RFE response “Sent out”, a Calendaring deadline “Deadline Complete”) or the filed date. Add a note if it didn't apply.",
  motion: "This motion is still marked Filed. When the judge has ruled, set the status (Granted / Denied) and the decision date.",
};

export interface TimelineEventTarget {
  /** The event clicked; absent for a "Needs attention" item with no dated event. */
  event?: TimelineEvent;
  /** The "Needs attention" item this was opened from. */
  fix?: TimelineFix;
  /** Title when there's no event (the attention item's text). */
  title?: string;
}

interface Props {
  profileLocalId: string;
  target: TimelineEventTarget;
  /** `changed` = something was written; the timeline reloads. */
  onClose: (changed: boolean) => void;
}

const fmtLong = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function TimelineEventPanel({ profileLocalId, target, onClose }: Props) {
  const { event, fix } = target;
  const itemLocalId = fix?.itemLocalId ?? (event?.boardKey ? event.itemLocalId : null);
  const isFeeK = !!event && event.track === "fees" && !event.boardKey && !!event.itemLocalId;
  const [item, setItem] = useState<TimelineItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!itemLocalId) return;
    let cancelled = false;
    fetchTimelineItem(itemLocalId)
      .then((i) => !cancelled && setItem(i))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [itemLocalId]);

  const title = event?.label ?? target.title ?? "Event";
  const onChanged = (columnId: string, v: string) => {
    setValues((prev) => ({ ...prev, [columnId]: v }));
    setChanged(true);
  };
  const fields = item?.fields.map((f) => ({ ...f, value: f.columnId in values ? values[f.columnId]! : f.value })) ?? [];
  const primary = fields.filter((f) => f.primary);
  const rest = fields.filter((f) => !f.primary);
  const statusField = fields.find((f) => f.key === "status");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(changed)}>
      <DialogContent code="M29" className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="flex-shrink-0 border-b border-border px-6 py-4 pr-12">
          <DialogTitle className="text-lg" style={{ fontFamily: "var(--font-display)" }}>{title}</DialogTitle>
          <DialogDescription>
            {[event ? fmtLong(event.date) : null, item ? item.boardName : event?.source].filter(Boolean).join(" · ")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4" style={{ fontFamily: "var(--font-body)" }}>
          {fix && (
            <p className="text-sm rounded-lg px-3 py-2 m-0" style={{ background: "color-mix(in srgb, var(--tl-warn) 12%, transparent)", color: "var(--color-ink)" }}>
              {FIX_HINT[fix.kind]}
            </p>
          )}

          {event?.detail && (
            <p className="text-sm m-0 whitespace-pre-wrap" style={{ color: "var(--color-ink-muted)" }}>{event.detail}</p>
          )}

          {itemLocalId && (
            <section>
              {error ? (
                <p role="alert" className="text-sm m-0" style={{ color: "var(--color-status-red)" }}>Couldn't load the item: {error}</p>
              ) : !item ? (
                <div className="h-24 rounded-lg loading-shimmer" />
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <div className="text-sm font-medium min-w-0 break-words" style={{ color: "var(--color-ink)" }}>{item.name}</div>
                    {item.mondayBoardId && item.mondayItemId && (
                      <a
                        href={mondayItemUrl(item.mondayBoardId, item.mondayItemId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs whitespace-nowrap"
                        style={{ color: "var(--color-status-blue)" }}
                      >
                        Monday ↗
                      </a>
                    )}
                  </div>

                  {fix?.kind === "hearing_outcome" && statusField && (
                    <OutcomeButtons
                      itemLocalId={item.localId}
                      columnId={statusField.columnId}
                      options={statusField.options.map((o) => o.label).filter((l) => OUTCOME.test(l))}
                      current={statusField.value}
                      onChanged={(v) => onChanged(statusField.columnId, v)}
                    />
                  )}

                  {fields.length === 0 ? (
                    <p className="text-xs m-0" style={{ color: "var(--color-ink-faint)" }}>
                      No editable fields synced for this board yet. Use the Monday link to change it there.
                    </p>
                  ) : (
                    <div className="rounded-lg px-3 py-2" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border-light)" }}>
                      {primary.map((f) => (
                        <ColumnField key={f.columnId} boardItemLocalId={item.localId} column={{ ...f, position: 0 }} value={f.value} onChanged={onChanged} />
                      ))}
                      {rest.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAll((s) => !s)}
                          className="text-xs py-1.5"
                          style={{ color: "var(--color-status-blue)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                        >
                          {showAll ? "Hide other fields" : `Other fields (${rest.length})`}
                        </button>
                      )}
                      {showAll &&
                        rest.map((f) => (
                          <ColumnField key={f.columnId} boardItemLocalId={item.localId} column={{ ...f, position: 0 }} value={f.value} onChanged={onChanged} />
                        ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {isFeeK && (
            <p className="text-xs m-0" style={{ color: "var(--color-ink-faint)" }}>
              This is a Fee K. Change it on the Contracts tab.
            </p>
          )}

          <NoteBox
            label={event?.updateLocalId ? "Reply to this entry" : "Add a note to the client's file"}
            onSend={async (text) => {
              if (event?.updateLocalId) await postTimelineReply(event.updateLocalId, text);
              else await postProfileUpdate(profileLocalId, `Re: ${title}${event ? ` (${fmtLong(event.date)})` : ""} — ${text}`);
              setChanged(true);
            }}
          />

          {item && <History changes={item.history} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Changes shown before "Show all". */
const HISTORY_PREVIEW = 8;

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * What changed on this item in Monday, newest first (item activity log): who
 * set which field from what to what. Saves made here show after Monday reports
 * them, usually within a minute.
 */
function History({ changes }: { changes: TimelineItem["history"] }) {
  const [all, setAll] = useState(false);
  const shown = all ? changes : changes.slice(0, HISTORY_PREVIEW);
  return (
    <section aria-label="History">
      <div className="text-xs mb-1.5" style={{ color: "var(--color-ink-faint)" }}>History</div>
      {changes.length === 0 ? (
        <p className="text-xs m-0" style={{ color: "var(--color-ink-faint)" }}>No changes recorded for this item.</p>
      ) : (
        <ol className="m-0 p-0 list-none">
          {shown.map((c, i) => (
            <li key={i} className="py-1.5 text-sm" style={{ borderTop: i ? "1px solid var(--color-border-light)" : undefined }}>
              <span className="font-medium" style={{ color: "var(--color-ink)" }}>{c.what}</span>
              {(c.from || c.to) && (
                <span style={{ color: "var(--color-ink-muted)" }}>
                  {": "}
                  {c.from ? <span style={{ textDecoration: "line-through" }}>{c.from}</span> : <em>empty</em>}
                  {" → "}
                  {c.to ?? <em>empty</em>}
                </span>
              )}
              <div className="text-xs" style={{ color: "var(--color-ink-faint)", fontVariantNumeric: "tabular-nums" }}>
                {fmtWhen(c.changedAt)}
                {c.by ? ` · ${c.by}` : ""}
              </div>
            </li>
          ))}
        </ol>
      )}
      {changes.length > HISTORY_PREVIEW && (
        <button
          type="button"
          onClick={() => setAll((a) => !a)}
          className="text-xs py-1"
          style={{ color: "var(--color-status-blue)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          {all ? "Show fewer" : `Show all ${changes.length}`}
        </button>
      )}
    </section>
  );
}

function OutcomeButtons({ itemLocalId, columnId, options, current, onChanged }: {
  itemLocalId: string;
  columnId: string;
  options: string[];
  current: string;
  onChanged: (v: string) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (options.length === 0) return null;
  const pick = async (label: string) => {
    setSaving(label);
    setError(null);
    try {
      await changeBoardItemColumn(itemLocalId, columnId, label);
      onChanged(label);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  };
  return (
    <div className="mb-3">
      <div className="text-xs mb-1.5" style={{ color: "var(--color-ink-faint)" }}>What happened?</div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Hearing outcome">
        {options.map((label) => (
          <button
            key={label}
            type="button"
            className={`filter-chip ${current === label ? "filter-chip-active" : ""}`}
            aria-pressed={current === label}
            disabled={saving !== null}
            onClick={() => pick(label)}
          >
            {saving === label ? "Saving…" : label}
          </button>
        ))}
      </div>
      {error && <div role="alert" className="text-xs mt-1" style={{ color: "var(--color-status-red)" }}>{error}</div>}
    </div>
  );
}

function NoteBox({ label, onSend }: { label: string; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!text.trim()) return;
    setState("saving");
    setError(null);
    try {
      await onSend(text.trim());
      setText("");
      setState("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
      setState("idle");
    }
  };
  return (
    <section>
      <label className="block text-xs mb-1" style={{ color: "var(--color-ink-faint)" }} htmlFor="tl-note">{label}</label>
      <textarea
        id="tl-note"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (state === "sent") setState("idle");
        }}
        rows={3}
        className="w-full rounded-md px-2 py-1.5 text-sm"
        style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "var(--font-body)", resize: "vertical" }}
      />
      <div className="flex items-center justify-end gap-3 mt-1.5">
        {error && <span role="alert" className="text-xs" style={{ color: "var(--color-status-red)" }}>{error}</span>}
        {state === "sent" && <span className="text-xs" style={{ color: "var(--tl-good)" }}>Saved to Monday</span>}
        <Button type="button" size="sm" disabled={!text.trim() || state === "saving"} onClick={send}>
          {state === "saving" ? "Posting…" : "Post note"}
        </Button>
      </div>
    </section>
  );
}
