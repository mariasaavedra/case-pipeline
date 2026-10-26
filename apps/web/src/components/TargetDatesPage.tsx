import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchTargetDates, fetchStaff, moveTargetDate } from "../api";
import type { TargetDatesView, TargetDateCaseView, StaffMember } from "../api";
import type { TargetBucket } from "@case-pipeline/query";
import { ClientLink } from "./ClientPeek";
import { SectionCode } from "./ScreenCode";
import { FormChip, ListSection, PersonChip, Tag, formatDue } from "./caseBoardParts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { DateInput } from "./ui/date-input";
import { MONDAY_OPEN_FORMS_BOARD_ID, mondayItemUrl } from "../config";

// =============================================================================
// P24 Target Dates — the admin's internal goal for each Open Form
// =============================================================================
// Every open Open Form (P5's list) by how close its Target date is: overdue,
// due within 7 days, within 14, later, no date. The admin reads it to nudge a
// paralegal, or — when an attorney grants an extension — moves the date with
// Move date (M33), which writes Monday and posts an update on the Open Form
// saying who granted it and why. Each row says how often the date has moved,
// and flags a change made by someone other than an admin (Monday lets anyone
// edit the column). Admin-only. API = GET /api/target-dates
// (libs/query/src/target-dates.ts); the weekday 8 AM Slack DM is
// apps/api/src/notify/target-dates-digest.ts.

const BUCKETS: { id: TargetBucket; title: string; note: string; tone: string | null }[] = [
  { id: "overdue", title: "Overdue", note: "Past the target date", tone: "overdue" },
  { id: "week", title: "Due in 7 days", note: "Today through next week", tone: "critical" },
  { id: "twoWeeks", title: "Due in 8–14 days", note: "Coming up", tone: "soon" },
  { id: "later", title: "Later", note: "More than two weeks out", tone: null },
  { id: "none", title: "No target date", note: "Set one", tone: "missing" },
];

/** Shown open on load; the others behind a click. */
const OPEN_BY_DEFAULT = new Set<TargetBucket>(["overdue", "week", "twoWeeks"]);

const ALL = "";
const NO_PARALEGAL = "No paralegal";

function firmToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysLabel(d: number | null): string {
  if (d === null) return "";
  if (d < 0) return `${-d}d late`;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  return `in ${d}d`;
}

export function TargetDatesPage() {
  const [data, setData] = useState<TargetDatesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paralegal, setParalegal] = useState(ALL);
  const [open, setOpen] = useState<Set<TargetBucket>>(OPEN_BY_DEFAULT);
  const [moving, setMoving] = useState<TargetDateCaseView | null>(null);
  const [attorneys, setAttorneys] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchTargetDates().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    fetchStaff()
      .then((r) => setAttorneys(r.staff.filter((s: StaffMember) => s.active && s.roles.includes("attorney")).map((s) => s.name).sort()))
      .catch(() => {});
  }, [load]);

  const cases = useMemo(() => {
    if (!data) return [];
    if (paralegal === ALL) return data.cases;
    return data.cases.filter((c) => (c.assignees.length > 0 ? c.assignees : [NO_PARALEGAL]).includes(paralegal));
  }, [data, paralegal]);

  const toggle = (b: TargetBucket) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(b)) next.delete(b);
    else next.add(b);
    return next;
  });

  if (error) return <div className="max-w-6xl mx-auto px-6 py-8 text-sm" style={{ color: "var(--color-status-red)" }}>{error}</div>;
  if (!data) return <div className="max-w-6xl mx-auto px-6 py-8 text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading target dates…</div>;

  const countOf = (b: TargetBucket) => cases.filter((c) => c.bucket === b).length;
  const paralegals = [...data.paralegals, ...(data.cases.some((c) => c.assignees.length === 0) ? [NO_PARALEGAL] : [])];

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold flex items-center" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          Target Dates<SectionCode code="P24" inline />
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-ink-faint)" }}>
          Open Forms by how close their target date is. Only admins change a target date — Move date writes Monday and tells the paralegal on the Open Form.
        </p>
      </header>

      <div className="grid gap-2 grid-cols-2 md:grid-cols-5 mb-4">
        {BUCKETS.map((b) => {
          const n = countOf(b.id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setOpen((s) => new Set(s).add(b.id));
                document.getElementById(`bucket-${b.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="card px-3 py-2 text-left"
            >
              <span className="block text-2xl font-semibold tabular-nums"
                style={{ color: n && b.tone ? `var(--urgency-${b.tone})` : "var(--color-ink)" }}>{n}</span>
              <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>{b.title}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <PersonChip name="Everyone" label="Everyone" active={paralegal === ALL} onClick={() => setParalegal(ALL)} />
        {paralegals.map((p) => (
          <PersonChip key={p} name={p} active={paralegal === p} onClick={() => setParalegal(paralegal === p ? ALL : p)} />
        ))}
        {data.snoozedCount > 0 && (
          <span className="text-xs ml-auto" style={{ color: "var(--color-ink-faint)" }}>
            {data.snoozedCount} parked at the North Pole not shown
          </span>
        )}
      </div>

      {flash && (
        <p role="status" className="text-sm mb-3" style={{ color: "var(--color-status-green)" }}>{flash}</p>
      )}

      <div className="flex flex-col gap-4">
        {BUCKETS.map((b) => {
          const list = cases.filter((c) => c.bucket === b.id);
          const isOpen = open.has(b.id);
          return (
            <div key={b.id} id={`bucket-${b.id}`}>
              <ListSection
                title={
                  <button type="button" onClick={() => toggle(b.id)} aria-expanded={isOpen} className="uppercase tracking-wide font-semibold">
                    {isOpen ? "▾" : "▸"} {b.title}
                  </button>
                }
                count={list.length}
                note={b.note}
                tone={b.tone}
              >
                {isOpen && list.map((c) => <Row key={c.localId} c={c} onMove={() => setMoving(c)} />)}
              </ListSection>
            </div>
          );
        })}
      </div>

      {moving && (
        <MoveDateDialog
          c={moving}
          attorneys={attorneys}
          onClose={() => setMoving(null)}
          onSaved={(text) => {
            setMoving(null);
            setFlash(text);
            load();
          }}
        />
      )}
    </div>
  );
}

function Row({ c, onMove }: { c: TargetDateCaseView; onMove: () => void }) {
  const tone = c.bucket === "overdue" ? "overdue" : c.bucket === "week" ? "critical" : c.bucket === "twoWeeks" ? "soon" : null;
  const edge = tone ? `var(--urgency-${tone})` : "transparent";
  const changedByOther = c.lastChange?.byAdmin === false;
  const monday = c.mondayItemId ? mondayItemUrl(MONDAY_OPEN_FORMS_BOARD_ID, c.mondayItemId) : null;
  return (
    <li
      className="grid gap-x-4 gap-y-1.5 px-4 py-3 items-center grid-cols-1 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_9rem_auto]"
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${edge}` }}
    >
      <div className="min-w-0">
        {c.clientLocalId ? (
          <ClientLink clientId={c.clientLocalId} className="font-medium hover:underline truncate block" style={{ color: "var(--color-ink)" }}>
            {c.clientName}
          </ClientLink>
        ) : (
          <span className="font-medium truncate block" style={{ color: "var(--color-ink)" }}>{c.clientName}</span>
        )}
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          {c.forms.map((f) => <FormChip key={f} label={f} />)}
          {c.isCourtCase && <Tag color="court">Court</Tag>}
          {c.urgent && <Tag color="overdue">Urgent</Tag>}
        </div>
      </div>

      <div className="text-sm min-w-0 truncate" style={{ color: "var(--color-ink-muted)" }} title="Open Forms status">
        {c.status ?? "—"}
      </div>

      <div className="text-sm min-w-0 truncate" style={{ color: "var(--color-ink-muted)" }}>
        {c.assignees.length > 0 ? c.assignees.join(", ") : <span style={{ color: "var(--color-ink-faint)" }}>{NO_PARALEGAL}</span>}
      </div>

      <div className="text-sm">
        {c.targetDate ? (
          <>
            <span className="font-medium tabular-nums" style={{ color: tone ? `var(--urgency-${tone})` : "var(--color-ink)" }}>
              {formatDue(c.targetDate)}
            </span>
            <span className="text-xs ml-1.5" style={{ color: "var(--color-ink-faint)" }}>{daysLabel(c.daysLeft)}</span>
          </>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>—</span>
        )}
        <div className="flex gap-1 mt-0.5 flex-wrap">
          {c.moves > 0 && (
            <Tag color={c.moves >= 3 ? "missing" : "later"} title="Times the target date moved to another day">Moved {c.moves}×</Tag>
          )}
          {changedByOther && (
            <Tag color="overdue" title={`Changed ${formatDue(c.lastChange!.at.slice(0, 10))}${c.lastChange!.from ? ` from ${c.lastChange!.from.slice(0, 10)}` : ""} — not by an admin`}>
              Changed by {c.lastChange!.by ?? "someone else"}
            </Tag>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 md:justify-end">
        {monday && (
          <a href={monday} target="_blank" rel="noreferrer" className="text-xs hover:underline" style={{ color: "var(--color-ink-muted)" }}>
            Monday ↗
          </a>
        )}
        <Button size="sm" variant="outline" onClick={onMove} disabled={!c.mondayItemId}>
          {c.targetDate ? "Move date" : "Set date"}
        </Button>
      </div>
    </li>
  );
}

function MoveDateDialog({
  c, attorneys, onClose, onSaved,
}: {
  c: TargetDateCaseView;
  attorneys: string[];
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const base = c.targetDate && c.targetDate > firmToday() ? c.targetDate : firmToday();
  const [date, setDate] = useState("");
  const [grantedBy, setGrantedBy] = useState(c.targetDate ? c.attorney ?? "" : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isMove = c.targetDate !== null;

  const save = async () => {
    if (!date) {
      setErr("Pick the new target date");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await moveTargetDate(c.localId, date, c.targetDate, isMove ? { grantedBy, reason } : { reason });
      onSaved(`${c.clientName}: target date ${isMove ? "moved" : "set"} to ${formatDue(date)}${r.pending ? " (Monday is slow — it will be written shortly)" : ""}.`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent code="M33" className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>{isMove ? "Move target date" : "Set target date"}</DialogTitle>
          <DialogDescription>
            {c.clientName} — {c.forms.length > 0 ? c.forms.join(", ") : c.formName}
            {isMove && <> · now {formatDue(c.targetDate!)}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span style={{ color: "var(--color-ink-muted)" }}>New target date</span>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} min={firmToday()} aria-label="New target date" autoFocus />
          </label>
          <div className="flex gap-1.5">
            {[7, 14, 30].map((d) => (
              <Button key={d} size="sm" variant="outline" type="button" onClick={() => setDate(addDays(base, d))}>+{d} days</Button>
            ))}
          </div>

          {isMove && (
            <label className="flex flex-col gap-1">
              <span style={{ color: "var(--color-ink-muted)" }}>Extension granted by</span>
              <input
                list="target-date-attorneys"
                value={grantedBy}
                onChange={(e) => setGrantedBy(e.target.value)}
                className="rounded-md px-2 py-1"
                style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)" }}
              />
              <datalist id="target-date-attorneys">
                {attorneys.map((a) => <option key={a} value={a} />)}
              </datalist>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span style={{ color: "var(--color-ink-muted)" }}>Reason <span style={{ color: "var(--color-ink-faint)" }}>(optional)</span></span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="rounded-md px-2 py-1"
              style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)" }}
            />
          </label>

          <p className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
            Writes the date on Monday and adds an update on the Open Form{isMove ? " with who granted the extension" : ""}.
          </p>
          {err && <p className="text-sm" style={{ color: "var(--color-status-red)" }}>{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : isMove ? "Move date" : "Set date"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
