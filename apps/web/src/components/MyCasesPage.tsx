import { useState, useEffect } from "react";
import { getMyCases } from "../api";
import type { MyCasesResult } from "../api";
import type { ActiveCase, Urgency } from "../api";
import { navigate, clientPath } from "../router";

const URGENCY_META: Record<Urgency, { label: string; color: string; bg: string }> = {
  overdue: { label: "Overdue", color: "var(--color-status-red)", bg: "var(--color-status-red-bg)" },
  critical: { label: "Due ≤ 3 days", color: "#b45309", bg: "var(--color-amber-light)" },
  soon: { label: "Due ≤ 7 days", color: "var(--color-status-yellow)", bg: "var(--color-status-yellow-bg)" },
  later: { label: "Later", color: "var(--color-status-blue)", bg: "var(--color-status-blue-bg)" },
  none: { label: "No target date", color: "var(--color-ink-faint)", bg: "var(--color-surface-warm)" },
};

function CaseRow({ c }: { c: ActiveCase }) {
  const meta = URGENCY_META[c.urgency];
  return (
    <div
      className="result-row"
      onClick={() => c.clientLocalId && navigate(clientPath(c.clientLocalId))}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "12px 20px",
        borderTop: "1px solid var(--color-border-light)",
      }}
    >
      <span
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          background: meta.color,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 500, color: "var(--color-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {c.clientName}
          {c.isCourtCase && (
            <span className="board-tag" style={{ marginLeft: 8 }}>Court</span>
          )}
        </div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--color-ink-faint)" }}>
          {c.formName}
          {c.status ? ` · ${c.status}` : ""}
        </div>
      </div>
      <span className="status-pill" style={{ background: meta.bg, color: meta.color, flexShrink: 0 }}>
        {meta.label}
        {c.daysUntilTarget !== null && c.urgency !== "none"
          ? ` · ${c.daysUntilTarget < 0 ? `${-c.daysUntilTarget}d ago` : `${c.daysUntilTarget}d`}`
          : ""}
      </span>
    </div>
  );
}

export function MyCasesPage() {
  const [data, setData] = useState<MyCasesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyCases()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: "820px", margin: "0 auto" }}>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "22px",
          fontWeight: 600,
          color: "var(--color-ink)",
          marginBottom: "6px",
        }}
      >
        My Cases
      </h1>
      <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--color-ink-faint)", marginBottom: "24px" }}>
        {data?.paralegalLink
          ? `Open cases assigned to ${data.paralegalLink}, most urgent first.`
          : "Your open cases, most urgent first."}
      </p>

      {error && (
        <div
          style={{
            background: "var(--color-status-red-bg)",
            color: "var(--color-status-red)",
            border: "1px solid rgba(153,27,27,0.15)",
            borderRadius: "8px",
            padding: "10px 14px",
            fontSize: "13px",
            fontFamily: "var(--font-body)",
          }}
        >
          {error}
        </div>
      )}

      {loading && (
        <div style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", fontSize: "14px" }}>Loading…</div>
      )}

      {/* Not linked yet → prompt to set board identity in Settings */}
      {!loading && data?.needsLink && (
        <div className="card card-elevated" style={{ padding: "28px 24px", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "17px", color: "var(--color-ink)", marginBottom: "8px" }}>
            Link your board name to see your cases
          </div>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--color-ink-faint)", maxWidth: "440px", margin: "0 auto 18px" }}>
            We match cases by the paralegal/attorney name used on the Monday.com boards.
            Choose yours in Settings and your cases will show up here.
          </p>
          <button
            onClick={() => navigate("/settings")}
            style={{
              padding: "8px 18px",
              borderRadius: "8px",
              border: "none",
              background: "var(--color-amber)",
              color: "#fff",
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Go to Settings
          </button>
        </div>
      )}

      {/* Linked, with cases */}
      {!loading && data && !data.needsLink && data.cases.length > 0 && (
        <div className="card card-elevated" style={{ overflow: "hidden" }}>
          {data.cases.map((c) => (
            <CaseRow key={c.localId} c={c} />
          ))}
        </div>
      )}

      {/* Linked, no cases */}
      {!loading && data && !data.needsLink && data.cases.length === 0 && (
        <div className="card" style={{ padding: "28px 24px", textAlign: "center", color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", fontSize: "14px" }}>
          No open cases assigned to you right now. 🎉
        </div>
      )}
    </div>
  );
}
