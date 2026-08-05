// =============================================================================
// SyncHealthSection — admin visibility into sync completeness (Settings)
// =============================================================================
// Shows the last sync run, per-board coverage (fetched vs what Monday reports),
// archived (reconciled-away, recoverable) rows, and the write-queue depth /
// dead-letters. Turns "I hope it synced" into something you can see.
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { fetchSyncHealth, fetchArchivedRows, restoreArchivedRow } from "../api";
import type { SyncHealth, ArchivedRow } from "@case-pipeline/query";

function ago(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function SyncHealthSection() {
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [archived, setArchived] = useState<ArchivedRow[] | null>(null);

  const load = useCallback(() => {
    fetchSyncHealth().then(setHealth).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadArchive = () => {
    setShowArchive(true);
    fetchArchivedRows(100).then(setArchived).catch(() => setArchived([]));
  };
  const restore = async (id: number) => {
    await restoreArchivedRow(id);
    setArchived((prev) => prev?.filter((r) => r.id !== id) ?? null);
    load();
  };

  if (error) return <p style={{ color: "var(--color-status-red)", fontSize: 13 }}>Couldn't load sync health: {error}</p>;
  if (!health) return <p style={{ color: "var(--color-ink-faint)", fontSize: 13 }}>Loading sync health…</p>;

  const statusColor = health.lastRun?.status === "synced" ? "var(--color-status-green)"
    : health.lastRun?.status === "partial" ? "var(--color-amber)"
    : health.lastRun?.status === "error" ? "var(--color-status-red)" : "var(--color-ink-faint)";

  return (
    <div style={{ fontFamily: "var(--font-body)" }}>
      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
        <span>Last run: <strong>{ago(health.lastRun?.finishedAt ?? health.lastRun?.startedAt ?? null)}</strong> ({health.lastRun?.mode ?? "—"})</span>
        <span style={{ color: statusColor }}>● {health.lastRun?.status ?? "no runs yet"}</span>
        <span>Queue: <strong>{health.queue.pending}</strong> pending{health.queue.failed > 0 && <span style={{ color: "var(--color-status-red)" }}>, {health.queue.failed} stuck</span>}</span>
        <span>Archived: <strong>{health.archivedTotal}</strong></span>
        <button type="button" onClick={load} style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-status-blue)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Refresh</button>
      </div>

      {/* Per-board coverage */}
      <div style={{ border: "1px solid var(--color-border-light)", borderRadius: 8, overflow: "hidden" }}>
        {health.boards.length === 0 && <p style={{ padding: 12, fontSize: 13, color: "var(--color-ink-faint)" }}>No board data in the last run.</p>}
        {health.boards.map((b, i) => {
          const pct = b.coveragePct;
          const bad = b.truncated || !!b.error || (pct != null && pct < 100);
          const barColor = pct == null ? "var(--color-ink-faint)" : pct >= 100 ? "var(--color-status-green)" : pct >= 90 ? "var(--color-amber)" : "var(--color-status-red)";
          return (
            <div key={b.boardKey} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)" }}>
              <span style={{ flex: "0 0 30%", fontSize: 12, color: "var(--color-ink)", wordBreak: "break-word" }}>{b.boardKey}</span>
              <div style={{ flex: 1, height: 8, background: "var(--color-surface-warm)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${pct ?? 0}%`, height: "100%", background: barColor }} />
              </div>
              <span style={{ flex: "0 0 130px", fontSize: 11, fontFamily: "var(--font-mono)", color: bad ? "var(--color-status-red)" : "var(--color-ink-faint)", textAlign: "right" }}>
                {b.fetched ?? "?"}/{b.expected ?? "?"}{pct != null ? ` (${pct}%)` : " (n/a)"}
                {b.archived > 0 && ` · ${b.archived}📥`}
                {b.truncated && " · trunc"}
              </span>
            </div>
          );
        })}
      </div>

      {health.archivedTotal > 0 && (
        <div style={{ marginTop: 12 }}>
          {!showArchive ? (
            <button type="button" onClick={loadArchive} style={{ fontSize: 12, color: "var(--color-status-blue)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
              View archived rows ({health.archivedTotal}) — reconciled-away, restorable
            </button>
          ) : (
            <div style={{ border: "1px solid var(--color-border-light)", borderRadius: 8, overflow: "hidden", marginTop: 6 }}>
              {archived == null ? <p style={{ padding: 10, fontSize: 12, color: "var(--color-ink-faint)" }}>Loading…</p> :
                archived.length === 0 ? <p style={{ padding: 10, fontSize: 12, color: "var(--color-ink-faint)" }}>None.</p> :
                archived.map((r, i) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)", fontSize: 12 }}>
                    <span style={{ flex: 1, minWidth: 0 }} className="truncate">{r.name ?? r.mondayItemId ?? r.localId} <span style={{ color: "var(--color-ink-faint)" }}>· {r.boardKey ?? r.sourceTable} · {ago(r.archivedAt)}</span></span>
                    <button type="button" onClick={() => restore(r.id)} style={{ fontSize: 11, color: "var(--color-status-blue)", background: "none", border: "1px solid var(--color-border-light)", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>Restore</button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
