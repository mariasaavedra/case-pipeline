// =============================================================================
// Audit log (P11.4.3, admin) — who changed what, in plain English
// =============================================================================
// Filters map straight onto /api/admin/audit's query params (action prefix,
// actor, date range), so they search the whole log, not just the loaded page.
// Entries are grouped by the reader's local day; "Load more" pages backwards.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { fetchAuditLog, fetchAdminUsers } from "../api";
import type { AuditEntry, AuditFilters, PublicUser } from "../api";
import { SectionCode } from "./ScreenCode";
import { settingsSectionTitle } from "./settingsStyles";
import { AUDIT_FAMILIES, describeAudit, localDayKey, ymd } from "../utils/audit-labels";
import { ClientLink } from "./ClientPeek";

const PAGE = 50;

function dayHeading(key: string): string {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === ymd(now)) return "Today";
  if (key === ymd(yesterday)) return "Yesterday";
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function timeOf(createdAt: string): string {
  return new Date(createdAt.replace(" ", "T") + "Z").toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function AuditLogSection() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminUsers().then(setUsers).catch(() => {});
  }, []);

  // Any filter change reloads from the newest entry.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAuditLog(PAGE, 0, filters)
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows);
        setHasMore(rows.length === PAGE);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const rows = await fetchAuditLog(PAGE, entries.length, filters);
      setEntries((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const byDay = useMemo(() => {
    const groups: { key: string; rows: AuditEntry[] }[] = [];
    for (const e of entries) {
      const key = localDayKey(e.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.rows.push(e);
      else groups.push({ key, rows: [e] });
    }
    return groups;
  }, [entries]);

  const set = (patch: Partial<AuditFilters>) => setFilters((f) => {
    const next = { ...f, ...patch };
    for (const k of Object.keys(next) as (keyof AuditFilters)[]) if (!next[k]) delete next[k];
    return next;
  });
  const filtered = Object.keys(filters).length > 0;

  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={settingsSectionTitle}>Audit log<SectionCode code="P11.4.3" inline /></h2>
      <p style={s.desc}>
        Every change made through this app: status changes and notes sent to Monday.com, mail
        assignments, role changes and firm settings. Click a client's name to open their page.
      </p>

      <div style={s.filters}>
        <label style={s.filterLabel}>
          What
          <select value={filters.action ?? ""} onChange={(e) => set({ action: e.target.value || undefined })} style={s.select}>
            <option value="">All activity</option>
            {AUDIT_FAMILIES.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label style={s.filterLabel}>
          Who
          <select
            value={filters.actor ?? ""}
            onChange={(e) => set({ actor: e.target.value ? Number(e.target.value) : undefined })}
            style={s.select}
          >
            <option value="">Everyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
        <label style={s.filterLabel}>
          From
          <input type="date" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} style={s.select} />
        </label>
        <label style={s.filterLabel}>
          To
          <input type="date" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} style={s.select} />
        </label>
        {filtered && (
          <button onClick={() => setFilters({})} style={s.clear}>Clear filters</button>
        )}
      </div>

      {error && <div style={s.error}>{error}</div>}

      {loading ? (
        <div style={s.faint}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ ...s.card, padding: "14px 20px" }}>
          <span style={s.faint}>{filtered ? "Nothing matches these filters." : "No audit entries yet."}</span>
        </div>
      ) : (
        <>
          {byDay.map((g) => (
            <div key={g.key} style={{ marginBottom: 16 }}>
              <div style={s.day}>{dayHeading(g.key)}</div>
              <div style={s.card}>
                {g.rows.map((e, i) => {
                  const text = describeAudit(e.action, e.metadata);
                  return (
                    <div key={e.id} style={{ ...s.row, borderTop: i === 0 ? "none" : "1px solid var(--color-border)" }}>
                      <span style={s.time}>{timeOf(e.createdAt)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={s.title}>
                          {text.title}
                          {e.target && (
                            <>
                              {" · "}
                              {e.target.profileLocalId ? (
                                <ClientLink clientId={e.target.profileLocalId} style={s.link}>
                                  {e.target.name}
                                </ClientLink>
                              ) : (
                                <span>{e.target.name}</span>
                              )}
                            </>
                          )}
                          {text.queued && <span style={s.badge} title="Monday.com was unavailable; the change was queued and sent later">queued</span>}
                        </div>
                        {text.detail && <div style={s.detail}>{text.detail}</div>}
                        <div style={s.meta}>
                          {e.actorEmail ?? "system"}
                          <span style={s.code} title="Internal action name">{e.action}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {hasMore && (
            <button onClick={loadMore} disabled={loadingMore} style={s.more}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

const s: Record<string, React.CSSProperties> = {
  desc: { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink-faint)", marginBottom: 12, lineHeight: 1.5 },
  filters: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 16 },
  filterLabel: {
    display: "flex", flexDirection: "column", gap: 4,
    fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
    color: "var(--color-ink-faint)",
  },
  select: {
    padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-border)",
    backgroundColor: "var(--color-card)", color: "var(--color-ink)", fontFamily: "var(--font-body)", fontSize: 13,
    textTransform: "none", letterSpacing: "normal", fontWeight: 400, minWidth: 0, maxWidth: "100%",
  },
  clear: {
    padding: "6px 10px", border: "none", background: "none", cursor: "pointer",
    fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-amber)",
  },
  error: {
    padding: "8px 12px", borderRadius: 8, marginBottom: 12, fontSize: 13, fontFamily: "var(--font-body)",
    backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)",
  },
  faint: { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink-faint)" },
  card: { backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" },
  day: {
    fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", margin: "0 0 6px 2px",
  },
  row: { display: "flex", gap: 16, padding: "12px 20px", alignItems: "flex-start" },
  time: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-ink-faint)", width: 64, flexShrink: 0, paddingTop: 1 },
  title: { fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)", lineHeight: 1.4, overflowWrap: "anywhere" },
  link: { color: "var(--color-amber)", textDecoration: "none", fontWeight: 500 },
  detail: { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink-muted)", marginTop: 2, overflowWrap: "anywhere" },
  meta: {
    display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4,
    fontFamily: "var(--font-body)", fontSize: 12, color: "var(--color-ink-faint)",
  },
  code: { fontFamily: "var(--font-mono)", fontSize: 11, opacity: 0.7 },
  badge: {
    marginLeft: 8, padding: "1px 6px", borderRadius: 4, fontSize: 11, fontFamily: "var(--font-body)",
    backgroundColor: "var(--color-amber-light)", color: "var(--color-amber)", verticalAlign: "middle",
  },
  more: {
    display: "block", margin: "8px auto 0", padding: "8px 16px", borderRadius: 8, cursor: "pointer",
    border: "1px solid var(--color-border)", backgroundColor: "var(--color-card)",
    fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink)",
  },
};
