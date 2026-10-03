import { useState, useEffect, useCallback } from "react";
import { fetchAddressChanges, changeBoardItemStatus, changeBoardItemColumn } from "../api";
import type { AddressChangesResult, AddressChange, AddressChangePhase, AddressChangeFlag } from "../api";
import { ClientLink } from "./ClientPeek";
import { SectionCode } from "./ScreenCode";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { formatDue, Tag, ListSection, WAIT_TONE, waitFg } from "./caseBoardParts";

// =============================================================================
// P18 Address Changes
// =============================================================================
// The open changes of address as a queue. The firm files one only once it's
// paid, so items sit in a phase: our turn (paid) → with client / attorney →
// submitted → waiting on payment, plus on hold. Colour = days since Date
// Received, with tighter limits while it's our turn. A court change shows the
// client's next hearing: without the new address, the notice goes to the old
// one. The status can be changed here (written to Monday); "Sent Out" also
// stamps Date Sent with today. See docs/features/address-changes.md.

const PHASES: { id: AddressChangePhase; title: string; note: string }[] = [
  { id: "firm", title: "Paid: our turn", note: "File the change of address" },
  { id: "review", title: "With client or attorney", note: "Signature or attorney review" },
  { id: "submitted", title: "Submitted", note: "Waiting for approval" },
  { id: "payment", title: "Waiting on payment", note: "Logged, not paid yet" },
  { id: "hold", title: "On hold", note: "" },
];

const FLAG_LABEL: Record<AddressChangeFlag, string> = {
  stale_payment: "Unpaid 6+ months",
  no_with_who: "Court or USCIS not set",
  no_new_address: "No new address",
  no_date_received: "No date received",
  no_profile: "Profile not connected",
};
const FLAGS: AddressChangeFlag[] = ["stale_payment", "no_with_who", "no_new_address", "no_date_received", "no_profile"];

const SENT_OUT = "Sent Out";
const ALL = "";
const NO_ASSISTANT = "No assistant";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function countdown(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

// =============================================================================
// Status picker (writes to Monday after a confirm)
// =============================================================================

function StatusPicker({
  item,
  options,
  dateSentColumnId,
  onChanged,
}: {
  item: AddressChange;
  options: string[];
  dateSentColumnId: string | null;
  onChanged: (localId: string, pending: boolean) => void;
}) {
  const [to, setTo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = options.map((o) => ({ value: o, label: o }));

  const confirm = async () => {
    if (!to) return;
    setSaving(true);
    setError(null);
    try {
      const r = await changeBoardItemStatus(item.localId, to);
      let pending = r.pending;
      if (to === SENT_OUT && dateSentColumnId) {
        const d = await changeBoardItemColumn(item.localId, dateSentColumnId, today());
        pending = pending || d.pending;
      }
      setTo(null);
      onChanged(item.localId, pending);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the status");
    } finally {
      setSaving(false);
    }
  };

  if (to) {
    return (
      <div className="text-xs space-y-1.5">
        <div style={{ color: "var(--color-ink)" }}>
          Change to <strong>{to}</strong>?{to === SENT_OUT && dateSentColumnId ? " Date Sent = today." : ""}
        </div>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" disabled={saving} onClick={confirm}>
            {saving ? "Saving…" : "Change"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setTo(null)}>
            Cancel
          </Button>
        </div>
        {error && <div style={{ color: "var(--urgency-overdue)" }}>{error}</div>}
      </div>
    );
  }

  return (
    <Select items={items} value={item.status ?? ""} onValueChange={(v) => v && v !== item.status && setTo(v)}>
      <SelectTrigger size="sm" className="bg-secondary text-[13px] max-w-full" aria-label={`Status for ${item.clientName}`}>
        <SelectValue placeholder="No status" />
      </SelectTrigger>
      <SelectContent code="D31">
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// =============================================================================
// Row
// =============================================================================

function AddressRow({
  a,
  statusOptions,
  dateSentColumnId,
  pending,
  assistantFilter,
  onAssistant,
  onChanged,
}: {
  a: AddressChange;
  statusOptions: string[];
  dateSentColumnId: string | null;
  pending: boolean;
  assistantFilter: string;
  onAssistant: (name: string) => void;
  onChanged: (localId: string, pending: boolean) => void;
}) {
  const edge = a.hearingSoon ? "var(--urgency-critical)" : waitFg(a.ageLevel);
  return (
    <li
      className="grid gap-x-4 gap-y-1.5 px-4 py-3 items-center grid-cols-1 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.6fr)_8.5rem_minmax(0,0.8fr)_15rem]"
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${edge}` }}
    >
      {/* Client + where it goes */}
      <div className="min-w-0">
        {a.clientLocalId ? (
          <ClientLink clientId={a.clientLocalId} className="font-medium hover:underline truncate block" style={{ color: "var(--color-ink)" }}>
            {a.clientName}
          </ClientLink>
        ) : (
          <span className="font-medium truncate block" style={{ color: "var(--color-ink)" }}>{a.clientName}</span>
        )}
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-xs" style={{ color: "var(--color-ink-faint)" }}>
          {a.withWho && <Tag color={a.court ? "court" : "soon"}>{a.withWho}</Tag>}
          {a.method && <span>{a.method}</span>}
          {a.flags.map((f) => (
            <Tag key={f} color="overdue">{FLAG_LABEL[f]}</Tag>
          ))}
        </div>
      </div>

      {/* Old → new address */}
      <div className="text-xs min-w-0" style={{ color: "var(--color-ink-muted)" }}>
        {a.oldAddress || a.newAddress ? (
          <>
            <div className="truncate" title={a.oldAddress ?? undefined}>
              <span style={{ color: "var(--color-ink-faint)" }}>From </span>
              {a.oldAddress ?? "?"}
            </div>
            <div className="truncate" title={a.newAddress ?? undefined} style={{ color: "var(--color-ink)" }}>
              <span style={{ color: "var(--color-ink-faint)" }}>To </span>
              {a.newAddress ?? "?"}
            </div>
          </>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>No addresses on Monday</span>
        )}
      </div>

      {/* Received + age, next hearing */}
      <div className="text-sm whitespace-nowrap">
        {a.receivedOn ? (
          <>
            <span style={{ color: "var(--color-ink-muted)" }}>{formatDue(a.receivedOn)}</span>
            <span className="ml-1.5 font-semibold" style={{ color: waitFg(a.ageLevel) }}>{a.ageDays}d</span>
          </>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>No date</span>
        )}
        {a.hearingDate && a.daysToHearing !== null && (
          <div className="text-xs" title="Next hearing on the client's court case" style={{ color: a.hearingSoon ? "var(--urgency-critical)" : "var(--color-ink-faint)", fontWeight: a.hearingSoon ? 600 : 400 }}>
            Hearing {formatDue(a.hearingDate)} ({countdown(a.daysToHearing)})
          </div>
        )}
      </div>

      {/* Assistant */}
      <div className="text-xs min-w-0">
        {a.assistant ? (
          <button
            type="button"
            className="hover:underline truncate block max-w-full text-left"
            title="Show only this assistant's"
            style={{ color: assistantFilter === a.assistant ? "var(--color-amber-dark)" : "var(--color-ink-muted)" }}
            onClick={() => onAssistant(a.assistant!)}
          >
            {a.assistant}
          </button>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>{NO_ASSISTANT}</span>
        )}
      </div>

      {/* Status */}
      <div className="min-w-0">
        {statusOptions.length > 0 ? (
          <StatusPicker item={a} options={statusOptions} dateSentColumnId={dateSentColumnId} onChanged={onChanged} />
        ) : (
          <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>{a.status ?? "No status"}</span>
        )}
        {pending && (
          <div className="text-xs mt-1" style={{ color: "var(--urgency-missing)" }} title="Monday was unreachable; the change is queued and will be retried">
            Queued for Monday
          </div>
        )}
      </div>
    </li>
  );
}

// =============================================================================
// Page
// =============================================================================

export function AddressChangesPage() {
  const [data, setData] = useState<AddressChangesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assistant, setAssistant] = useState(ALL);
  const [problem, setProblem] = useState<AddressChangeFlag | null>(null);
  const [showStale, setShowStale] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    fetchAddressChanges()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);
  useEffect(load, [load]);

  const all = data?.items ?? [];
  const byAssistant = all.filter((a) => !assistant || (a.assistant ?? NO_ASSISTANT) === assistant);
  // Unpaid for 6+ months is a cleanup question, not a live one: hidden from the
  // list unless asked for (or picked from the cleanup strip).
  const visible = problem
    ? byAssistant.filter((a) => a.flags.includes(problem))
    : byAssistant.filter((a) => showStale || !a.flags.includes("stale_payment"));
  const assistants = [...new Set(all.map((a) => a.assistant ?? NO_ASSISTANT))].sort((x, y) =>
    x === NO_ASSISTANT ? 1 : y === NO_ASSISTANT ? -1 : x.localeCompare(y),
  );
  const ours = all.filter((a) => a.phase === "firm");
  const stale = byAssistant.filter((a) => a.flags.includes("stale_payment")).length;
  const t = data?.thresholds;

  const onChanged = (localId: string, pending: boolean) => {
    setPendingIds((s) => {
      const next = new Set(s);
      if (pending) next.add(localId);
      else next.delete(localId);
      return next;
    });
    // The server already updated the status locally; reload to re-phase (or drop a "Sent Out").
    load();
  };

  const assistantItems = [{ value: ALL, label: "All assistants" }, ...assistants.map((a) => ({ value: a, label: a }))];

  return (
    <div>
      {/* P18.1 — header */}
      <SectionCode code="P18.1" />
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          Address Changes
        </h1>
        {data && (
          <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {all.length} open ·{" "}
            <span style={{ color: ours.length ? waitFg("late") : undefined }}>{ours.length} paid, our turn</span> ·{" "}
            {all.filter((a) => a.phase === "payment").length} waiting on payment
          </span>
        )}
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-faint)" }}>
        Open changes of address by phase. Colour = days since Date Received
        {t && (
          <>
            {" "}(our turn: <span style={{ color: waitFg("waiting") }}>{t.firm.waitingDays}+</span> ·{" "}
            <span style={{ color: waitFg("late") }}>{t.firm.lateDays}+ days</span>; otherwise {t.payment.waitingDays}+ ·{" "}
            {t.payment.lateDays}+)
          </>
        )}
        . Court changes show the client's next hearing. Change a status here and it is written to Monday.
      </p>

      {!data && !error && <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading address changes…</div>}
      {error && (
        <div className="text-sm rounded p-3" style={{ color: "var(--urgency-overdue)", background: "var(--urgency-overdue-bg)" }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* P18.2 — filters + cleanup */}
          <SectionCode code="P18.2" />
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Select items={assistantItems} value={assistant} onValueChange={(v) => setAssistant(v ?? ALL)}>
              <SelectTrigger size="sm" className={`min-w-25 bg-secondary text-[13px] ${assistant ? "border-primary bg-primary/6" : ""}`} aria-label="Assistant">
                <SelectValue />
              </SelectTrigger>
              <SelectContent code="D30">
                {assistantItems.map((i) => (
                  <SelectItem key={i.value || "all"} value={i.value}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {stale > 0 && !problem && (
              <button type="button" className={`filter-chip ${showStale ? "filter-chip-active" : ""}`} onClick={() => setShowStale(!showStale)}>
                {showStale ? "Hide" : "Show"} {stale} unpaid 6+ months
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-5" role="group" aria-label="Data problems">
            <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Needs cleanup on Monday:</span>
            {FLAGS.map((f) => {
              const n = byAssistant.filter((a) => a.flags.includes(f)).length;
              return (
                <button
                  key={f}
                  type="button"
                  disabled={n === 0}
                  className={`filter-chip ${problem === f ? "filter-chip-active" : ""}`}
                  style={n > 0 && problem !== f ? { color: "var(--urgency-overdue)" } : undefined}
                  onClick={() => setProblem(problem === f ? null : f)}
                >
                  {FLAG_LABEL[f]} · {n}
                </button>
              );
            })}
          </div>

          {/* P18.3 — list by phase */}
          <SectionCode code="P18.3" />
          <div className="space-y-4">
            {visible.length === 0 && (
              <div className="card p-8 text-center text-sm" style={{ color: "var(--color-ink-faint)" }}>
                No address changes match these filters.
              </div>
            )}
            {PHASES.map((p) => {
              const inPhase = visible.filter((a) => a.phase === p.id);
              if (inPhase.length === 0) return null;
              const late = inPhase.filter((a) => a.ageLevel === "late").length;
              return (
                <ListSection
                  key={p.id}
                  title={p.title}
                  count={inPhase.length}
                  tone={p.id === "firm" && late ? WAIT_TONE.late : null}
                  note={[p.note, late ? `${late} overdue` : ""].filter(Boolean).join(" · ")}
                >
                  {inPhase.map((a) => (
                    <AddressRow
                      key={a.localId}
                      a={a}
                      statusOptions={data.statusColumnId ? data.statusOptions : []}
                      dateSentColumnId={data.dateSentColumnId}
                      pending={pendingIds.has(a.localId)}
                      assistantFilter={assistant}
                      onAssistant={(name) => setAssistant(assistant === name ? ALL : name)}
                      onChanged={onChanged}
                    />
                  ))}
                </ListSection>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
