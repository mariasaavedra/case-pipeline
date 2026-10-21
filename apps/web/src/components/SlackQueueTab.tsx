import { useState } from "react";
import { deleteSlackQueued, editSlackQueued, type SlackEventStatus, type SlackQueueMessage } from "../api";
import { SectionCode } from "./ScreenCode";
import { Tag, ListSection } from "./caseBoardParts";
import { Button } from "./ui/button";
import { SlackMessageEditor, SlackPreview, slackWarning, type SlackMessageValue } from "./SlackMessageEditor";

// =============================================================================
// P17.3 Slack Queue — the messages reception queued from M18 step 2
// =============================================================================
// Everything still waiting, anything that failed, and what went out today.
// Waiting and failed ones can be edited (words, time) or deleted; editing a
// failed one puts it back in the queue (Retry). "Send now" moves its time to
// now — the job posts within a minute. Each row shows the consult's CURRENT
// time, flagged when the consult moved after the message was queued.
// =============================================================================

function timeLabel(hhmm: string | null): string {
  if (!hhmm) return "No time";
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h ?? 0;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(m ?? 0).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

function dayLabel(ymd: string, today: string): string {
  if (ymd === today) return "Today";
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

const nowCentral = () => {
  const d = new Date();
  return {
    sendDate: d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }),
    sendTime: d.toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
};

function QueueRow({ m, today, onChanged }: { m: SlackQueueMessage; today: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<SlackMessageValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = m.status === "queued" || m.status === "failed";
  const a = m.appointment;
  const moved = !!a && (a.date !== m.sendDate || (a.time ?? null) !== m.sendTime);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const tone = m.status === "failed" ? "var(--urgency-overdue)" : m.status === "sent" ? "var(--urgency-later)" : "var(--urgency-soon)";
  return (
    <li className="px-4 py-3" style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${tone}` }}>
      <div className="grid gap-x-4 gap-y-1.5 items-start grid-cols-1 md:grid-cols-[7rem_minmax(0,1.3fr)_minmax(0,2fr)_13rem]">
        <div className="text-sm font-semibold whitespace-nowrap" style={{ color: "var(--color-ink)", fontFamily: "var(--font-mono)" }}>
          {timeLabel(m.sendTime)}
          {m.sendDate !== today && <div className="text-xs font-normal" style={{ color: "var(--color-ink-faint)" }}>{dayLabel(m.sendDate, today)}</div>}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{a?.client ?? "Consult not found"}</span>
            {m.badge && <span className="board-tag">{m.badge}</span>}
          </div>
          <div className="text-xs mt-0.5" style={{ color: moved ? "var(--urgency-soon)" : "var(--color-ink-faint)" }}>
            {a ? `Consult ${dayLabel(a.date ?? "", today)} · ${timeLabel(a.time)}` : "Deleted in Monday?"}
            {moved && open ? " — moved since queued" : ""}
          </div>
        </div>

        <div className="min-w-0">
          {editing ? (
            <SlackMessageEditor value={editing} onChange={setEditing} mention={a?.attorney ?? "attorney"} disabled={busy} />
          ) : (
            <SlackPreview text={m.text} mention={a?.attorney ?? "attorney"} />
          )}
          {m.error && m.status === "failed" && <div className="text-xs mt-1" style={{ color: "var(--urgency-overdue)" }}>{m.error}</div>}
          {error && <div role="alert" className="text-xs mt-1" style={{ color: "var(--urgency-overdue)" }}>{error}</div>}
        </div>

        <div className="flex flex-col items-start md:items-end gap-1">
          {m.status === "queued" && <Tag color="soon">Queued{m.updatedBy ? ` · ${m.updatedBy.split(" ")[0]}` : ""}</Tag>}
          {m.status === "sending" && <Tag color="soon">Sending…</Tag>}
          {m.status === "failed" && <Tag color="overdue">Not sent</Tag>}
          {m.status === "sent" && <Tag color="later">{m.dryRun ? "Dry run (logged)" : "Sent"}</Tag>}
          {open && (
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {editing ? (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
                  <Button type="button" size="sm" onClick={() => void run(() => editSlackQueued(m.id, editing))} disabled={busy}>
                    {m.status === "failed" ? "Save & retry" : "Save"}
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" size="sm" variant="outline" disabled={busy}
                    onClick={() => setEditing({ text: m.text, sendDate: m.sendDate, sendTime: m.sendTime })}>Edit</Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} title="Posts within a minute"
                    onClick={() => void run(() => editSlackQueued(m.id, nowCentral()))}>
                    {m.status === "failed" ? "Retry now" : "Send now"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy}
                    onClick={() => { if (window.confirm("Delete this Slack message? It won't be posted.")) void run(() => deleteSlackQueued(m.id)); }}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export function SlackQueueTab({ data, error, onChanged }: {
  data: { today: string; slack: SlackEventStatus; messages: SlackQueueMessage[] } | null;
  error: string | null;
  onChanged: () => void;
}) {
  if (error) {
    return <div className="text-sm rounded p-3" style={{ color: "var(--urgency-overdue)", background: "var(--urgency-overdue-bg)" }}>{error}</div>;
  }
  if (!data) return <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading the Slack queue…</div>;
  const warning = slackWarning(data.slack);
  const waiting = data.messages.filter((m) => m.status !== "sent");
  const sent = data.messages.filter((m) => m.status === "sent").reverse();
  return (
    <div>
      <SectionCode code="P17.3" />
      {warning && (
        <div className="text-sm rounded p-3 mb-3" style={{ color: "var(--urgency-soon)", background: "var(--urgency-soon-bg)" }}>{warning}</div>
      )}
      <div className="flex flex-col gap-4">
        {waiting.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            Nothing queued. Prep a consult, then use step 2 to queue the attorney's message.
          </div>
        ) : (
          <ListSection title="Waiting" count={waiting.length} tone={null}>
            {waiting.map((m) => <QueueRow key={m.id} m={m} today={data.today} onChanged={onChanged} />)}
          </ListSection>
        )}
        {sent.length > 0 && (
          <ListSection title="Sent today" count={sent.length} tone={null}>
            {sent.map((m) => <QueueRow key={m.id} m={m} today={data.today} onChanged={onChanged} />)}
          </ListSection>
        )}
      </div>
    </div>
  );
}
