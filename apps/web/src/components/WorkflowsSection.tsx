// =============================================================================
// WorkflowsSection (P11.7) — everything the app does on its own
// =============================================================================
// One card per automation: when it runs and what it does, on/off (and the
// setting that's missing when off), the schedule, the last run and the
// failures this week. Read-only: the switches live in the server's .env.
// Admin-only (the tab is). Catalog = apps/api/src/workflows/catalog.ts.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { fetchWorkflows, type Workflow, type WorkflowsReport } from "../api";
import { SectionCode } from "./ScreenCode";
import { settingsSectionTitle } from "./settingsStyles";

const POLL_MS = 60_000;

const desc = { fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", marginBottom: 12, lineHeight: 1.5 } as const;
const groupTitle = { fontSize: 13, fontWeight: 600, color: "var(--color-ink)", fontFamily: "var(--font-body)", margin: "24px 0 8px" } as const;
const card = { border: "1px solid var(--color-border-light)", borderRadius: 10, padding: "12px 16px", marginBottom: 10, fontFamily: "var(--font-body)" } as const;
const meta = { fontSize: 12, color: "var(--color-ink-muted)", lineHeight: 1.6 } as const;
const red = "var(--color-status-red)";

const PILL = {
  on: { text: "On", bg: "rgba(22,163,74,0.12)", fg: "#166534" },
  test: { text: "Test mode", bg: "var(--color-amber-light)", fg: "var(--color-ink)" },
  off: { text: "Off", bg: "var(--color-status-red-bg)", fg: red },
  external: { text: "Outside the app", bg: "var(--color-surface-alt, rgba(0,0,0,0.05))", fg: "var(--color-ink-muted)" },
} as const;

function pillFor(w: Workflow): keyof typeof PILL {
  if (w.kind === "external") return "external";
  if (!w.on) return "off";
  return w.reason?.startsWith("Dry run") || w.reason?.startsWith("Seed data") ? "test" : "on";
}

/** "just now", "4 min ago", "3 h ago", else "Oct 21, 9:00 AM". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function LastRun({ w }: { w: Workflow }) {
  if (w.kind === "external") return <>We can't see when it runs — check it in {w.reason?.replace("Managed in ", "") ?? "its app"}.</>;
  if (w.historyError) return <span style={{ color: red }}>History unavailable: {w.historyError}</span>;
  if (!w.tracked) return <>Runs aren't recorded.</>;
  const r = w.lastRun;
  if (!r) return <>{w.kind === "event" ? "Nothing yet." : "No runs recorded yet."}</>;
  const label = w.kind === "event" ? "Last event" : "Last run";
  if (r.status === "running") return <>{label}: started {ago(r.at)}, still running</>;
  return (
    <>
      {label}: {ago(r.at)} ·{" "}
      {r.status === "ok"
        ? <span style={{ color: "#166534" }}>OK</span>
        : <span style={{ color: red }}>Failed{r.error ? ` — ${r.error}` : ""}</span>}
      {r.summary && ` · ${r.summary}`}
    </>
  );
}

function WorkflowCard({ w, windowDays }: { w: Workflow; windowDays: number }) {
  const [open, setOpen] = useState(false);
  const p = PILL[pillFor(w)];
  const dim = !w.on && w.kind !== "external";
  return (
    <div style={{ ...card, opacity: dim ? 0.75 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>{w.name}</span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: p.bg, color: p.fg }}>{p.text}</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--color-ink)", margin: "4px 0 6px", lineHeight: 1.5 }}>
        <span style={{ color: "var(--color-ink-faint)" }}>When</span> {w.when.charAt(0).toLowerCase() + w.when.slice(1)}{" "}
        <span style={{ color: "var(--color-ink-faint)" }}>→</span> {w.then.charAt(0).toLowerCase() + w.then.slice(1)}
      </div>
      <div style={meta}>
        {w.reason && w.kind !== "external" && <div style={{ color: dim ? red : "var(--color-ink-muted)" }}>{w.reason}</div>}
        {w.schedule && <div>Schedule: {w.schedule.words}{w.schedule.firmTime ? " (Central)" : " (server time)"}</div>}
        <div><LastRun w={w} /></div>
        {w.failures > 0 && (
          <div>
            <button type="button" onClick={() => setOpen((o) => !o)}
              style={{ color: red, background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}>
              {w.failures} failure{w.failures === 1 ? "" : "s"} in the last {windowDays} days {open ? "▾" : "▸"}
            </button>
            {open && (
              <ul style={{ margin: "4px 0 0 16px", listStyle: "disc" }}>
                {w.recentFailures.map((f, i) => (
                  <li key={i}>{ago(f.at)} — {f.error ?? "failed"}</li>
                ))}
                {w.failures > w.recentFailures.length && <li>…and {w.failures - w.recentFailures.length} more</li>}
              </ul>
            )}
          </div>
        )}
        {w.doc && <div style={{ color: "var(--color-ink-faint)" }}>How it works: <code>{w.doc}</code></div>}
      </div>
    </div>
  );
}

export function WorkflowsSection() {
  const [report, setReport] = useState<WorkflowsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchWorkflows()
      .then((r) => { setReport(r); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (error && !report) {
    return <div className="px-4 py-2 rounded-lg text-sm" style={{ backgroundColor: "var(--color-status-red-bg)", color: red }}>{error}</div>;
  }
  if (!report) return <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading…</p>;

  const ours = report.workflows.filter((w) => w.kind !== "external");
  const on = ours.filter((w) => w.on).length;
  const failing = ours.filter((w) => w.failures > 0).length;

  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={settingsSectionTitle}>Workflows<SectionCode code="P11.7" inline /></h2>
      <p style={desc}>
        Everything the app does on its own, when it last ran and what went wrong. Read-only: turning one on or off is a
        setting in the server's .env, and each card names it.
      </p>
      <p style={{ ...desc, color: "var(--color-ink)", fontWeight: 600 }}>
        {on} of {ours.length} on
        {failing > 0
          ? <span style={{ color: red }}> · {failing} with failures in the last {report.failureWindowDays} days</span>
          : ` · no failures in the last ${report.failureWindowDays} days`}
      </p>
      {report.groups.map((g) => {
        const items = report.workflows.filter((w) => w.group === g.id);
        if (!items.length) return null;
        return (
          <div key={g.id}>
            <h3 style={groupTitle}>{g.label}</h3>
            {items.map((w) => <WorkflowCard key={w.key} w={w} windowDays={report.failureWindowDays} />)}
          </div>
        );
      })}
    </section>
  );
}
