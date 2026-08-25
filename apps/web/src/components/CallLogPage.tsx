// =============================================================================
// Call Log Page — spreadsheet view of the real Call Log board
// =============================================================================
// Filters (status, taken by, "unlinked to a profile") over board_items where
// board_key='call_log'. Status is editable inline via the existing generic
// StatusEditor. A row with a linked profile opens that client; the "+ Log
// call" button on this page (and the header everywhere else) opens the same
// LogCallModal quick-create popup.
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { fetchCallLog } from "../api";
import type { CallLogEntry } from "../api";
import { Link } from "./Link";
import { clientPath } from "../router";
import { StatusEditor } from "./StatusEditor";
import { LogCallModal } from "./LogCallModal";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useBoardStatusOptions } from "../StatusOptionsProvider";

const PAGE_SIZE = 50;

function formatWhen(entry: CallLogEntry): string {
  if (!entry.date) return "—";
  const parts = [entry.date];
  if (entry.time) parts.push(entry.time);
  return parts.join(" · ");
}

export function CallLogPage() {
  const statusDef = useBoardStatusOptions("call_log");

  const [entries, setEntries] = useState<CallLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [staffOptions, setStaffOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const [status, setStatus] = useState("");
  const [takenBy, setTakenBy] = useState("");
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);

  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async (nextOffset: number, replace: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCallLog({
        status: status || undefined,
        takenBy: takenBy || undefined,
        unlinkedOnly: unlinkedOnly || undefined,
        limit: PAGE_SIZE,
        offset: nextOffset,
      });
      setEntries((prev) => (replace ? res.entries : [...prev, ...res.entries]));
      setTotal(res.total);
      setStaffOptions(res.staffOptions);
      setOffset(nextOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the call log");
    } finally {
      setLoading(false);
    }
  }, [status, takenBy, unlinkedOnly]);

  useEffect(() => {
    load(0, true);
  }, [load]);

  const statusItems = [{ value: "", label: "All statuses" }, ...(statusDef?.options.map((o) => ({ value: o.label, label: o.label })) ?? [])];
  const staffItems = [{ value: "", label: "All staff" }, ...staffOptions.map((s) => ({ value: s, label: s }))];

  return (
    <div className="animate-in">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>Call Log</h1>
          <p style={{ fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            {total.toLocaleString()} call{total === 1 ? "" : "s"}
          </p>
        </div>
        <Button type="button" onClick={() => setShowModal(true)}>+ Log call</Button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ minWidth: 160 }}>
          <Select items={statusItems} value={status} onValueChange={(v) => setStatus(v ?? "")}>
            <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusItems.map((s) => <SelectItem key={s.value || "all"} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div style={{ minWidth: 200 }}>
          <Select items={staffItems} value={takenBy} onValueChange={(v) => setTakenBy(v ?? "")}>
            <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {staffItems.map((s) => <SelectItem key={s.value || "all"} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-ink-muted)", fontFamily: "var(--font-body)", cursor: "pointer" }}>
          <input type="checkbox" checked={unlinkedOnly} onChange={(e) => setUnlinkedOnly(e.target.checked)} />
          Unlinked to a client
        </label>
      </div>

      {error && (
        <div className="animate-in px-4 py-3 rounded-lg mb-4 text-sm" style={{ backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
          {error}
        </div>
      )}

      <div style={{ border: "1px solid var(--color-border-light)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 130px 110px 160px 160px", gap: 0, background: "var(--color-surface-warm)", borderBottom: "1px solid var(--color-border-light)", fontSize: 11, fontWeight: 600, color: "var(--color-ink-muted)", fontFamily: "var(--font-body)", textTransform: "uppercase", letterSpacing: 0.4 }}>
          {["When", "Name", "Phone", "Status", "Taken by", "Client"].map((h) => (
            <div key={h} style={{ padding: "8px 10px" }}>{h}</div>
          ))}
        </div>

        {entries.length === 0 && !loading ? (
          <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            No calls match these filters.
          </div>
        ) : (
          entries.map((e, i) => (
            <div
              key={e.localId}
              style={{
                display: "grid", gridTemplateColumns: "140px 1fr 130px 110px 160px 160px",
                borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)",
                fontSize: 13, fontFamily: "var(--font-body)", color: "var(--color-ink)",
                alignItems: "center",
              }}
            >
              <div style={{ padding: "8px 10px", color: "var(--color-ink-faint)", fontSize: 12 }}>{formatWhen(e)}</div>
              <div style={{ padding: "8px 10px" }}>{e.name}</div>
              <div style={{ padding: "8px 10px", color: "var(--color-ink-muted)", fontSize: 12 }}>{e.phone ?? "—"}</div>
              <div style={{ padding: "8px 10px" }}>
                <StatusEditor
                  boardKey="call_log"
                  boardItemLocalId={e.localId}
                  status={e.status}
                  onChanged={(newStatus) =>
                    setEntries((prev) => prev.map((row) => (row.localId === e.localId ? { ...row, status: newStatus } : row)))
                  }
                />
              </div>
              <div style={{ padding: "8px 10px", color: "var(--color-ink-muted)", fontSize: 12 }}>{e.takenBy ?? "—"}</div>
              <div style={{ padding: "8px 10px" }}>
                {e.profileLocalId ? (
                  <Link href={clientPath(e.profileLocalId)} style={{ fontSize: 12 }}>{e.profileName ?? "View client"}</Link>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--color-ink-faint)" }}>— unlinked —</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {entries.length < total && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          <Button type="button" variant="outline" onClick={() => load(offset + PAGE_SIZE, false)} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      {showModal && (
        <LogCallModal
          onClose={() => setShowModal(false)}
          onLogged={() => load(0, true)}
        />
      )}
    </div>
  );
}
