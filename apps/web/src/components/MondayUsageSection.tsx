// =============================================================================
// MondayUsageSection — Monday API calls vs the account's daily limit (Settings)
// =============================================================================
// Monday caps the whole account at a number of API calls per day (every token
// and integration together, Zapier included) and resets at midnight UTC. Two
// sources side by side: Monday's own count per day (platform_api — the number
// the limit is enforced on) and ours per job (monday_api_calls), which says
// which job spent them. Ours can run a little under Monday's: it misses calls
// made outside this server (a script on a laptop, Zapier).
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { fetchMondayUsage, type MondayUsage } from "../api";

const JOB_LABELS: Record<string, string> = {
  "sync:full": "Nightly full sync",
  "sync:incremental": "Daytime sync (every 2 h)",
  "sync:webhook": "Webhook syncs (changed items)",
  "sync:manual": "Manual sync",
  webhooks: "Webhook processing",
  "write-queue": "Write queue (queued writes)",
  "fee-k-autofill": "Fee K auto-fill",
  "drive-intake": "Drive intake",
  "consult-sweep": "Consult folder sweep",
  "schema-refresh": "Board schema refresh",
  "usage-report": "This usage report",
  app: "Staff actions in the app",
};

const n = (v: number) => v.toLocaleString("en-US");

function levelColor(pct: number): string {
  return pct >= 90 ? "var(--color-status-red)" : pct >= 70 ? "var(--color-amber)" : "var(--color-status-green)";
}

/** Monday's day ends at midnight UTC — shown in the viewer's own time. */
function resetTime(): string {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return next.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function MondayUsageSection() {
  const [usage, setUsage] = useState<MondayUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDay, setSelectedDay] = useState(today);

  const load = useCallback((refresh = false) => {
    fetchMondayUsage(refresh).then(setUsage).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <p style={{ color: "var(--color-status-red)", fontSize: 13 }}>Couldn't load Monday API usage: {error}</p>;
  if (!usage) return <p style={{ color: "var(--color-ink-faint)", fontSize: 13 }}>Loading Monday API usage…</p>;

  const limit = usage.platform?.dailyLimit ?? null;
  const mondayByDay = new Map((usage.platform?.byDay ?? []).map((d) => [d.day, d.usage]));
  const oursByDay = new Map<string, number>();
  for (const j of usage.jobs) oursByDay.set(j.day, (oursByDay.get(j.day) ?? 0) + j.calls);
  const days = [...new Set([today, ...mondayByDay.keys(), ...oursByDay.keys()])].sort().reverse().slice(0, 14);

  const todayUsage = mondayByDay.get(today) ?? oursByDay.get(today) ?? 0;
  const todayPct = limit ? Math.round((todayUsage / limit) * 100) : null;
  const jobsForDay = usage.jobs.filter((j) => j.day === selectedDay).sort((a, b) => b.calls - a.calls);
  const dayTotal = jobsForDay.reduce((s, j) => s + j.calls, 0);

  return (
    <div style={{ fontFamily: "var(--font-body)", marginBottom: 24 }}>
      <div className="flex flex-wrap items-center gap-4 mb-2 text-sm">
        <span>
          Monday API calls today: <strong style={{ color: todayPct != null ? levelColor(todayPct) : undefined }}>{n(todayUsage)}</strong>
          {limit != null && <> of {n(limit)} ({todayPct}%)</>}
        </span>
        <span style={{ color: "var(--color-ink-faint)", fontSize: 12 }}>Resets {resetTime()} (midnight UTC)</span>
        <button type="button" onClick={() => load(true)} style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-status-blue)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Refresh</button>
      </div>
      <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 8 }}>
        The limit is for the whole Monday account — every token and integration (Zapier too). When it runs out, all of
        them stop until the reset.
        {usage.platform?.lastUpdated && <> Monday's numbers as of {new Date(usage.platform.lastUpdated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.</>}
      </p>
      {usage.platformError && (
        <p style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8, wordBreak: "break-word" }}>
          Couldn't read Monday's report: {usage.platformError}
        </p>
      )}

      {/* Per day: Monday's count (the one the limit uses) with ours alongside. Click a day for its jobs. */}
      <div style={{ border: "1px solid var(--color-border-light)", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, padding: "4px 10px", fontSize: 11, color: "var(--color-ink-faint)", background: "var(--color-surface-warm)" }}>
          <span style={{ flex: "0 0 90px" }}>Day (UTC)</span>
          <span style={{ flex: 1 }}>Monday's count{limit != null ? ` vs ${n(limit)} limit` : ""}</span>
          <span style={{ flex: "0 0 120px", textAlign: "right" }}>Monday · ours</span>
        </div>
        {days.map((day) => {
          const monday = mondayByDay.get(day);
          const ours = oursByDay.get(day);
          const shown = monday ?? ours ?? 0;
          const pct = limit ? Math.min(100, Math.round((shown / limit) * 100)) : 0;
          const selected = day === selectedDay;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setSelectedDay(day)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "5px 10px", fontSize: 12,
                border: "none", borderTop: "1px solid var(--color-border-light)", textAlign: "left", cursor: "pointer",
                background: selected ? "var(--color-surface-warm)" : "transparent", color: "var(--color-ink)",
              }}
            >
              <span style={{ flex: "0 0 90px", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: selected ? 600 : 400 }}>{day}</span>
              <div style={{ flex: 1, height: 8, background: "var(--color-surface-warm)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: levelColor(pct) }} />
              </div>
              <span style={{ flex: "0 0 120px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-ink-faint)" }}>
                {monday != null ? n(monday) : "—"} · {ours != null ? n(ours) : "—"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Which job spent them, for the selected day. */}
      <div style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 6 }}>
        Calls by job on <strong>{selectedDay}</strong>{dayTotal > 0 && <> — {n(dayTotal)} counted by this server</>}
      </div>
      <div style={{ border: "1px solid var(--color-border-light)", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
        {jobsForDay.length === 0 && (
          <p style={{ padding: 10, fontSize: 12, color: "var(--color-ink-faint)" }}>
            No calls counted for this day. Counting started with this release, so earlier days only have Monday's total.
          </p>
        )}
        {jobsForDay.map((j, i) => {
          const share = dayTotal ? Math.round((j.calls / dayTotal) * 100) : 0;
          return (
            <div key={j.job} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 10px", fontSize: 12, borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)" }}>
              <span style={{ flex: "0 0 40%", wordBreak: "break-word" }}>
                {JOB_LABELS[j.job] ?? j.job}
              </span>
              <div style={{ flex: 1, height: 8, background: "var(--color-surface-warm)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${share}%`, height: "100%", background: "var(--color-status-blue)" }} />
              </div>
              <span style={{ flex: "0 0 100px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-ink-faint)" }}>
                {n(j.calls)} ({share}%)
              </span>
            </div>
          );
        })}
      </div>

      {/* Monday's own split over its ~2-week window: catches calls this server doesn't see. */}
      {usage.platform && (usage.platform.byApp.length > 0 || usage.platform.byUser.length > 0) && (
        <div style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>
          <div style={{ marginBottom: 2 }}>
            <span style={{ color: "var(--color-ink-faint)" }}>Last 2 weeks by app: </span>
            {usage.platform.byApp.map((a) => `${a.name ?? (a.appId === "11" ? "Personal API token" : `app ${a.appId}`)} ${n(a.usage)}`).join(" · ")}
          </div>
          <div>
            <span style={{ color: "var(--color-ink-faint)" }}>By user (whose token): </span>
            {usage.platform.byUser.map((u) => `${u.name ?? "?"} ${n(u.usage)}`).join(" · ")}
          </div>
        </div>
      )}
    </div>
  );
}
