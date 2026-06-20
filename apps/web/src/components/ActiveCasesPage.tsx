import { useState, useEffect } from "react";
import { fetchActiveCases } from "../api";
import type { ActiveCasesResult, ActiveCasesAssignee, ActiveCase, Urgency } from "../api";
import { Link } from "./Link";
import { StatusBadge } from "./StatusBadge";
import { clientPath } from "../router";

// =============================================================================
// Constants
// =============================================================================

const URGENCY_COLUMNS: { key: Urgency; label: string }[] = [
  { key: "overdue",  label: "Overdue"    },
  { key: "critical", label: "1–3 Days"   },
  { key: "soon",     label: "This Week"  },
  { key: "later",    label: "Later"      },
  { key: "none",     label: "No Date"    },
];

const URGENCY_HEADER_STYLE: Record<Urgency, React.CSSProperties> = {
  overdue:  { color: "var(--color-red,  #dc2626)" },
  critical: { color: "var(--color-orange, #ea580c)" },
  soon:     { color: "var(--color-amber, #d97706)" },
  later:    { color: "var(--color-green, #16a34a)" },
  none:     { color: "var(--color-muted, #6b7280)" },
};

const URGENCY_CARD_BORDER: Record<Urgency, string> = {
  overdue:  "border-l-[3px] border-l-red-500",
  critical: "border-l-[3px] border-l-orange-500",
  soon:     "border-l-[3px] border-l-amber-400",
  later:    "border-l-[3px] border-l-green-500",
  none:     "border-l-[3px] border-l-gray-300",
};

// Court cases get blue/purple accent regardless of urgency
const COURT_CARD_BORDER = "border-l-[3px] border-l-blue-500";

// =============================================================================
// Countdown label
// =============================================================================

function countdownLabel(urgency: Urgency, days: number | null): string {
  if (urgency === "none" || days === null) return "—";
  if (days === 0) return "TODAY";
  if (days > 0) return `${days}d`;
  return `${Math.abs(days)}d overdue`;
}

// =============================================================================
// CaseCard
// =============================================================================

function CaseCard({ c }: { c: ActiveCase }) {
  const borderClass = c.isCourtCase ? COURT_CARD_BORDER : URGENCY_CARD_BORDER[c.urgency];
  const countdown = countdownLabel(c.urgency, c.daysUntilTarget);

  return (
    <div
      className={`bg-white rounded shadow-sm p-3 flex flex-col gap-1 text-sm ${borderClass}`}
      style={{ minWidth: 0 }}
    >
      {/* Client name + badges */}
      <div className="flex items-start justify-between gap-1 flex-wrap">
        {c.clientLocalId ? (
          <Link
            href={clientPath(c.clientLocalId)}
            className="font-medium text-blue-700 hover:underline truncate"
          >
            {c.clientName}
          </Link>
        ) : (
          <span className="font-medium truncate">{c.clientName}</span>
        )}
        <div className="flex items-center gap-1 flex-shrink-0">
          {c.assignees.length > 1 && (
            <span
              className="text-xs font-semibold px-1.5 py-0.5 rounded"
              style={{ background: "#cffafe", color: "#0e7490" }}
              title={`Shared: ${c.assignees.join(", ")}`}
            >
              SHARED
            </span>
          )}
          {c.isCourtCase && (
            <span
              className="text-xs font-semibold px-1.5 py-0.5 rounded"
              style={{ background: "#ede9fe", color: "#6d28d9" }}
            >
              COURT
            </span>
          )}
        </div>
      </div>

      {/* Form name */}
      <span className="text-gray-600 truncate" title={c.formName}>{c.formName}</span>

      {/* Status + countdown */}
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <StatusBadge status={c.status} />
        <span
          className="text-xs font-medium flex-shrink-0"
          style={
            c.urgency === "overdue"
              ? { color: "#dc2626" }
              : c.urgency === "none"
              ? { color: "#9ca3af" }
              : { color: "#374151" }
          }
        >
          {countdown}
        </span>
      </div>
    </div>
  );
}

// =============================================================================
// AssigneeRow
// =============================================================================

function AssigneeRow({ assignee }: { assignee: ActiveCasesAssignee }) {
  const casesByUrgency = new Map<Urgency, ActiveCase[]>();
  for (const col of URGENCY_COLUMNS) casesByUrgency.set(col.key, []);
  for (const c of assignee.cases) casesByUrgency.get(c.urgency)!.push(c);

  return (
    <div className="contents">
      {/* Row label */}
      <div
        className="flex items-center px-3 py-2 font-medium text-sm border-t border-gray-100"
        style={{
          gridColumn: "1",
          alignSelf: "start",
          paddingTop: "12px",
          color: assignee.name === "Unassigned" ? "#9ca3af" : "#111827",
        }}
      >
        {assignee.name}
      </div>

      {/* One cell per urgency column */}
      {URGENCY_COLUMNS.map((col) => {
        const cards = casesByUrgency.get(col.key) ?? [];
        return (
          <div
            key={col.key}
            className="p-2 border-t border-gray-100 flex flex-col gap-2 min-h-[48px]"
          >
            {cards.map((c) => <CaseCard key={c.localId} c={c} />)}
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// ActiveCasesPage
// =============================================================================

export function ActiveCasesPage() {
  const [data, setData] = useState<ActiveCasesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchActiveCases()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  // Count each case once — a shared case is fanned out across multiple rows.
  const totalCases = data
    ? new Set(data.assignees.flatMap((a) => a.cases.map((c) => c.localId))).size
    : 0;

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Active Cases
        </h1>
        {data && (
          <span
            className="text-sm font-medium px-2 py-0.5 rounded-full"
            style={{ background: "var(--color-surface-2, #f3f4f6)", color: "#374151" }}
          >
            {totalCases} case{totalCases !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {loading && (
        <div className="text-gray-500 text-sm">Loading active cases…</div>
      )}

      {error && (
        <div className="text-red-600 text-sm bg-red-50 rounded p-3">{error}</div>
      )}

      {data && data.assignees.length === 0 && (
        <div className="text-gray-500 text-sm">No active cases found.</div>
      )}

      {data && data.assignees.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          {/* Grid: 1 label col + 5 urgency cols */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "160px repeat(5, minmax(160px, 1fr))",
              minWidth: "960px",
            }}
          >
            {/* Column headers */}
            <div /> {/* empty label header */}
            {URGENCY_COLUMNS.map((col) => (
              <div
                key={col.key}
                className="text-xs font-semibold uppercase tracking-wide px-2 pb-2"
                style={URGENCY_HEADER_STYLE[col.key]}
              >
                {col.label}
              </div>
            ))}

            {/* Assignee rows */}
            {data.assignees.map((assignee) => (
              <AssigneeRow key={assignee.name} assignee={assignee} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
