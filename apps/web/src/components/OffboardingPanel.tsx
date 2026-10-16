// =============================================================================
// Settings → Staff → person → Offboard (P11.6.3)
// =============================================================================
// Four steps, top to bottom: hand over their open work (per column, with a
// default replacement and per-item overrides), turn off their access, tick the
// things the app can't do (Monday seat, Microsoft 365, RingCentral, Slack),
// then finish. Writes to Monday under the admin's own token; on seed data the
// app's copy alone changes. API = apps/api/src/routes/staff-offboarding.ts.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  fetchOffboarding,
  reassignOffboarding,
  patchOffboarding,
  STAFF_ROLE_LABEL,
  type OffboardingState,
  type OffboardingItemResult,
  type OffboardingStep,
  type StaffRole,
  type WorkloadColumn,
} from "../api";

const STEP_LABEL: Record<OffboardingStep, string> = {
  monday_seat: "Monday.com seat deactivated",
  microsoft_365: "Microsoft 365 account blocked / mailbox handed over",
  ringcentral: "RingCentral extension reassigned",
  slack: "Removed from Slack",
};

const COLUMN_LABEL: Record<WorkloadColumn, string> = {
  paralegal: "Paralegal work",
  attorney: "Attorney work",
  assistant: "Fee K assistant work",
};

/** Who may take each kind of work (the picker's first group); anyone else is still offered below. */
const FITS: Record<WorkloadColumn, StaffRole[]> = {
  paralegal: ["paralegal", "court_paralegal"],
  attorney: ["attorney"],
  assistant: ["reception", "billing", "paralegal", "manager"],
};

const SOURCE_LABEL: Record<string, string> = {
  open_forms: "Open Form",
  prescheduling: "Prescheduling",
  contracts: "Pending Fee K",
  court_cases: "Court case",
  foias: "FOIA",
};

const UNASSIGN = "none";
const DEFAULT = "";

type RowKey = string;
const rowKey = (source: string, localId: string, column: string): RowKey => `${source}|${localId}|${column}`;

export function OffboardingPanel({ staffId, onChanged }: { staffId: number; onChanged: () => void }) {
  const [state, setState] = useState<OffboardingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Partial<Record<WorkloadColumn, string>>>({});
  const [overrides, setOverrides] = useState<Record<RowKey, string>>({});
  const [results, setResults] = useState<OffboardingItemResult[] | null>(null);

  useEffect(() => {
    fetchOffboarding(staffId).then(setState).catch((e: Error) => setError(e.message));
  }, [staffId]);

  const rows = useMemo(
    () => (state?.items ?? []).flatMap(({ item, columns }) => columns.map((column) => ({ item, column }))),
    [state],
  );
  const columnsPresent = [...new Set(rows.map((r) => r.column))];

  const choiceFor = (source: string, localId: string, column: WorkloadColumn) => {
    const o = overrides[rowKey(source, localId, column)];
    return o && o !== DEFAULT ? o : defaults[column] ?? DEFAULT;
  };
  const ready = rows.filter((r) => choiceFor(r.item.source, r.item.localId, r.column) !== DEFAULT);

  async function run(key: string, fn: () => Promise<OffboardingState>) {
    setBusy(key);
    setError(null);
    try {
      setState(await fn());
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function reassign() {
    if (!state) return;
    const where = state.liveWrites ? "on Monday.com" : "in this app (seed data — nothing goes to Monday)";
    if (!window.confirm(`Reassign ${ready.length} item${ready.length === 1 ? "" : "s"} ${where}?`)) return;
    const assignments = ready.map((r) => {
      const c = choiceFor(r.item.source, r.item.localId, r.column);
      return { source: r.item.source, localId: r.item.localId, column: r.column, toStaffId: c === UNASSIGN ? null : Number(c) };
    });
    await run("reassign", async () => {
      const r = await reassignOffboarding(staffId, assignments);
      setResults(r.results);
      setOverrides({});
      return r;
    });
  }

  if (error && !state) return <div style={styles.error}>{error}</div>;
  if (!state) return <div style={styles.faint}>Loading…</div>;

  const s = state.staff;
  const picker = (column: WorkloadColumn, value: string, onChange: (v: string) => void, withDefault: boolean) => {
    const fits = state.candidates.filter((c) => c.roles.some((r) => FITS[column].includes(r)));
    const others = state.candidates.filter((c) => !fits.includes(c));
    const opt = (c: OffboardingState["candidates"][number]) => (
      <option key={c.id} value={String(c.id)} disabled={state.liveWrites && !c.hasMonday}>
        {c.name}
        {c.roles.length ? ` · ${c.roles.map((r) => STAFF_ROLE_LABEL[r]).join(", ")}` : ""}
        {state.liveWrites && !c.hasMonday ? " (no Monday account)" : ""}
      </option>
    );
    return (
      <select style={styles.select} value={value} onChange={(e) => onChange(e.target.value)} disabled={busy !== null}>
        <option value={DEFAULT}>{withDefault ? "Use the default" : "Choose…"}</option>
        <option value={UNASSIGN}>Leave unassigned</option>
        {fits.length > 0 && <optgroup label="Fits this work">{fits.map(opt)}</optgroup>}
        {others.length > 0 && <optgroup label="Everyone else">{others.map(opt)}</optgroup>}
      </select>
    );
  };

  return (
    <div style={styles.panel} aria-label={`Offboard ${s.name}`}>
      <div style={styles.head}>
        <strong>Offboard {s.name}</strong>
        <span style={styles.faint}>
          {state.done
            ? `Finished ${fmt(state.record!.completedAt!)}`
            : state.record
              ? `Started ${fmt(state.record.startedAt)}`
              : "Not started"}
        </span>
      </div>
      {!state.liveWrites && (
        <div style={styles.note}>Seed data: reassignments change this app’s copy only. Nothing is sent to Monday.com.</div>
      )}
      {error && <div style={styles.error} role="alert">{error}</div>}

      {/* 1. Open work */}
      <Step n={1} title={`Hand over open work (${rows.length})`} done={rows.length === 0}>
        {rows.length === 0 ? (
          <p style={styles.faint}>Nothing open is assigned to {s.name}.</p>
        ) : (
          <>
            <div style={styles.defaults}>
              {columnsPresent.map((col) => (
                <label key={col} style={styles.defaultRow}>
                  <span style={styles.label}>{COLUMN_LABEL[col]} → </span>
                  {picker(col, defaults[col] ?? DEFAULT, (v) => setDefaults({ ...defaults, [col]: v }), false)}
                </label>
              ))}
            </div>
            <ul style={styles.list}>
              {rows.map(({ item, column }) => {
                const key = rowKey(item.source, item.localId, column);
                return (
                  <li key={key} style={styles.itemRow}>
                    <span style={styles.src}>{SOURCE_LABEL[item.source] ?? item.source}</span>
                    <span style={{ flex: 1, minWidth: 140 }}>
                      {itemLabel(item)}
                      <span style={styles.faintSmall}> · as {column}</span>
                      {item.level === "critical" && <span style={styles.critical}> {item.levelLabel}</span>}
                    </span>
                    {picker(column, overrides[key] ?? DEFAULT, (v) => setOverrides({ ...overrides, [key]: v }), true)}
                  </li>
                );
              })}
            </ul>
            <button style={{ ...styles.primary, ...(ready.length === 0 || busy !== null ? styles.off : null) }} disabled={ready.length === 0 || busy !== null} onClick={reassign}>
              {busy === "reassign" ? "Reassigning…" : `Reassign ${ready.length} of ${rows.length}`}
            </button>
          </>
        )}
        {results && <ResultSummary results={results} />}
      </Step>

      {/* 2. Access */}
      <Step n={2} title="Turn off their access" done={!s.active}>
        <p style={styles.faint}>
          Marks {s.name} inactive (end date today){s.login ? " and disables their app login" : ""}. Their history stays.
        </p>
        <button
          style={{ ...styles.btn, ...(!s.active || busy !== null ? styles.off : null) }}
          disabled={!s.active || busy !== null}
          onClick={() => {
            if (window.confirm(`Turn off ${s.name}'s access?`)) run("deactivate", () => patchOffboarding(staffId, { deactivate: true }));
          }}
        >
          {s.active ? "Turn off access" : `Done${s.endDate ? ` · ended ${s.endDate}` : ""}`}
        </button>
      </Step>

      {/* 3. Outside the app */}
      <Step n={3} title="Outside this app" done={state.steps.every((st) => state.record?.steps[st])}>
        {state.steps.map((st) => {
          const done = state.record?.steps[st];
          return (
            <label key={st} style={styles.check}>
              <input
                type="checkbox"
                checked={!!done}
                disabled={busy !== null}
                onChange={(e) => run(`step:${st}`, () => patchOffboarding(staffId, { step: st, done: e.target.checked }))}
              />
              {STEP_LABEL[st]}
              {done && <span style={styles.faintSmall}> · {done.by ?? "done"} {fmt(done.at)}</span>}
            </label>
          );
        })}
      </Step>

      {/* 4. Finish */}
      <Step n={4} title="Finish" done={state.done}>
        <button
          style={{ ...styles.primary, ...(!state.canComplete || state.done || busy !== null ? styles.off : null) }}
          disabled={!state.canComplete || state.done || busy !== null}
          onClick={() => run("complete", () => patchOffboarding(staffId, { complete: true }))}
          title={state.canComplete ? undefined : "Needs: no open work, access off, every step ticked"}
        >
          {state.done ? "Offboarding finished" : "Finish offboarding"}
        </button>
      </Step>
    </div>
  );
}

function ResultSummary({ results }: { results: OffboardingItemResult[] }) {
  const n = (o: OffboardingItemResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  const skipped = results.filter((r) => r.outcome === "skipped");
  return (
    <div style={styles.note} role="status">
      {[
        n("written") && `${n("written")} changed on Monday`,
        n("queued") && `${n("queued")} queued (Monday busy — retried automatically)`,
        n("local_only") && `${n("local_only")} changed in this app`,
        skipped.length && `${skipped.length} skipped`,
      ]
        .filter(Boolean)
        .join(" · ") || "Nothing changed."}
      {skipped.length > 0 && (
        <ul style={{ margin: "4px 0 0 16px" }}>
          {skipped.map((r) => (
            <li key={`${r.source}|${r.localId}|${r.column}`}>
              {SOURCE_LABEL[r.source] ?? r.source} ({r.column}): {r.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section style={styles.step}>
      <h4 style={styles.stepTitle}>
        <span style={{ ...styles.stepNum, ...(done ? styles.stepDone : null) }} aria-hidden>{done ? "✓" : n}</span>
        {title}
      </h4>
      <div style={{ paddingLeft: 30 }}>{children}</div>
    </section>
  );
}

/** "Client · what it is", without repeating a client name the item's title already carries. */
export function itemLabel(item: { clientName: string | null; title: string }): string {
  if (!item.clientName || item.title.toLowerCase().includes(item.clientName.toLowerCase())) return item.title;
  return `${item.clientName} · ${item.title}`;
}

function fmt(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const font = "var(--font-body)";
const styles: Record<string, React.CSSProperties> = {
  panel: { marginTop: 16, padding: 16, border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-card)", fontFamily: font, fontSize: 13, color: "var(--color-ink)" },
  head: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, marginBottom: 8, fontSize: 14 },
  step: { marginTop: 14 },
  stepTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, margin: "0 0 6px" },
  stepNum: {
    width: 22, height: 22, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "1px solid var(--color-border)", fontSize: 12, color: "var(--color-ink-muted)", flexShrink: 0,
  },
  stepDone: { background: "var(--color-status-green)", borderColor: "var(--color-status-green)", color: "#fff" },
  defaults: { display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8 },
  defaultRow: { display: "flex", alignItems: "center", gap: 6 },
  list: { listStyle: "none", margin: "0 0 10px", padding: 0, maxHeight: 320, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 8 },
  itemRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "6px 10px", borderTop: "1px solid var(--color-border-light)" },
  src: { fontSize: 11, color: "var(--color-ink-muted)", width: 96, flexShrink: 0 },
  critical: { fontSize: 11, fontWeight: 600, color: "var(--urgency-overdue)" },
  label: { fontSize: 12, fontWeight: 500, color: "var(--color-ink-muted)" },
  select: { padding: "4px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-ink)", fontFamily: font, fontSize: 12, maxWidth: 260 },
  check: { display: "flex", alignItems: "center", gap: 8, padding: "3px 0" },
  btn: { padding: "6px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-ink)", fontFamily: font, fontSize: 13, cursor: "pointer" },
  primary: { padding: "6px 14px", borderRadius: 8, border: "1px solid var(--color-amber)", background: "var(--color-amber)", color: "#fff", fontFamily: font, fontSize: 13, fontWeight: 500, cursor: "pointer" },
  off: { opacity: 0.45, cursor: "not-allowed" },
  note: { background: "var(--color-surface-warm)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "8px 12px", margin: "8px 0", lineHeight: 1.5 },
  error: { background: "var(--color-status-red-bg)", color: "var(--color-status-red)", borderRadius: 8, padding: "8px 12px", margin: "8px 0" },
  faint: { color: "var(--color-ink-faint)", fontSize: 13, margin: "2px 0 6px" },
  faintSmall: { color: "var(--color-ink-faint)", fontSize: 12 },
};
