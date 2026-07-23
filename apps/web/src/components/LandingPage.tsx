import { useState, useEffect } from "react";
import { fetchDashboard, getPreferences, updatePreferences } from "../api";
import type { KpiCard, KpiItem } from "../api";
import { Link } from "./Link";
import { QuickAccess } from "./QuickAccess";
import { KpiDetailModal } from "./KpiDetailModal";
import { formatColumnValue } from "../utils/columnValue";
import { useAuth } from "../auth/useAuth";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const KPI_ICONS: Record<string, React.ReactNode> = {
  open_forms: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  pending_contracts: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  paid_fee_ks: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  ),
  upcoming_deadlines: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  upcoming_hearings: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4l3 3" />
    </svg>
  ),
  alerts: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 3L2 21h20L12 3z" />
      <path d="M12 10v4M12 17v1" />
    </svg>
  ),
};

const KPI_EMPTY_MESSAGES: Record<string, string> = {
  open_forms: "No open forms at this time",
  pending_contracts: "All contracts are paid or closed",
  paid_fee_ks: "No clients in prescheduling",
  upcoming_deadlines: "Nothing due in the next 7 days",
  upcoming_hearings: "No hearings scheduled this period",
  alerts: "No active alerts — all clear",
};

function formatItemDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function KpiItemRow({ item, columnLabel }: { item: KpiItem; columnLabel: string | null }) {
  // The configured column is the useful signal. Fall back to the board tag only
  // when no column is set — on a single-board card it just repeats the heading.
  const columnText = formatColumnValue(item.columnValue);

  return (
    <div className="kpi-item-row">
      <div className="kpi-item-name" title={item.name}>
        {item.name}
      </div>
      <div className="kpi-item-meta">
        {item.date && (
          <span className="kpi-item-date">{formatItemDate(item.date)}</span>
        )}
        {columnText ? (
          <span className="board-tag" title={columnLabel ?? undefined}>
            {columnText}
          </span>
        ) : (
          item.boardKey && (
            <span className="board-tag">{BOARD_DISPLAY_NAMES[item.boardKey] ?? item.boardKey}</span>
          )
        )}
        {item.clientName && item.clientLocalId && (
          <Link
            href={`/clients/${encodeURIComponent(item.clientLocalId)}`}
            className="kpi-item-client"
            onClick={(e) => e.stopPropagation()}
          >
            {item.clientName}
          </Link>
        )}
      </div>
    </div>
  );
}

function getKpiFilterUrl(key: string, hearingRange?: string): string | null {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  switch (key) {
    case "open_forms":
      return "/clients?board_type=_cd_open_forms";
    case "pending_contracts":
      return "/clients?status=pending_contracts";
    case "paid_fee_ks":
      return "/clients?status=paid_fee_ks";
    case "upcoming_deadlines": {
      const weekOut = new Date(today);
      weekOut.setDate(weekOut.getDate() + 7);
      return `/clients?date_from=${todayStr}&date_to=${weekOut.toISOString().split("T")[0]}`;
    }
    case "upcoming_hearings": {
      const end = new Date(today);
      if (hearingRange === "month") {
        end.setMonth(end.getMonth() + 1);
      } else {
        end.setDate(end.getDate() + 7);
      }
      return `/clients?board_type=court_cases&date_from=${todayStr}&date_to=${end.toISOString().split("T")[0]}`;
    }
    case "alerts":
      return "/alerts";
    default:
      return null;
  }
}

function KpiCardComponent({
  card,
  index,
  onHearingToggle,
  hearingRange,
  onOpen,
}: {
  card: KpiCard;
  index: number;
  onHearingToggle?: () => void;
  hearingRange?: string;
  onOpen: () => void;
}) {
  const filterUrl = getKpiFilterUrl(card.key, hearingRange);

  return (
    <div
      className={`kpi-card card card-elevated animate-in animate-in-delay-${index + 1}`}
      role="button"
      tabIndex={0}
      style={{ cursor: "pointer" }}
      title={`See all ${card.label.toLowerCase()}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="kpi-card-header">
        <div className="kpi-card-icon">
          {KPI_ICONS[card.key]}
        </div>
        <div className="kpi-card-title">
          <span className="kpi-card-label">{card.label}</span>
          <span className="kpi-card-count">{card.count}</span>
        </div>
      </div>

      {card.key === "upcoming_hearings" && onHearingToggle && (
        <div className="kpi-hearing-toggle" onClick={(e) => e.stopPropagation()}>
          <button
            className={`filter-chip ${hearingRange === "7d" ? "filter-chip-active" : ""}`}
            onClick={onHearingToggle}
          >
            7 days
          </button>
          <button
            className={`filter-chip ${hearingRange === "month" ? "filter-chip-active" : ""}`}
            onClick={onHearingToggle}
          >
            This month
          </button>
        </div>
      )}

      <div className="kpi-card-body">
        {card.items.length === 0 ? (
          <div className="kpi-empty">{KPI_EMPTY_MESSAGES[card.key] ?? "No items"}</div>
        ) : (
          card.items.map((item) => (
            <KpiItemRow key={item.localId} item={item} columnLabel={card.columnLabel} />
          ))
        )}
      </div>

      {card.count > card.items.length && (
        <div className="kpi-card-footer">
          <button
            className="kpi-card-more"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            See all {card.count}
          </button>
          {filterUrl && (
            <Link href={filterUrl} className="kpi-card-more" onClick={(e) => e.stopPropagation()}>
              Open in Clients →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export function LandingPage() {
  const { user } = useAuth();
  const [cards, setCards] = useState<KpiCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hearingRange, setHearingRange] = useState<"7d" | "month">("7d");
  const [openCardKey, setOpenCardKey] = useState<string | null>(null);
  /**
   * This user's own per-card column choices. The server already folded the
   * firm-wide default into the cards it returned; this map exists so the modal
   * can tell "I picked this" from "this is the house default" and offer a reset.
   */
  const [myColumns, setMyColumns] = useState<Record<string, string>>({});

  const loadDashboard = async (range: "7d" | "month") => {
    try {
      const data = await fetchDashboard(range);
      setCards(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard(hearingRange);
  }, [hearingRange]);

  useEffect(() => {
    getPreferences()
      .then((prefs) => setMyColumns(prefs.kpiColumns ?? {}))
      .catch(() => {
        /* offline or not signed in — the firm-wide default still applies */
      });
  }, []);

  const toggleHearingRange = () => {
    setHearingRange((prev) => (prev === "7d" ? "month" : "7d"));
  };

  /** Save (or clear, with null) this user's column choice for one card. */
  const selectColumn = (cardKey: string, columnId: string | null) => {
    const next = { ...myColumns };
    if (columnId) next[cardKey] = columnId;
    else delete next[cardKey];

    setMyColumns(next);
    // Optimistic on the cards too, so the previews behind the modal update now.
    setCards((prev) =>
      prev.map((c) => (c.key === cardKey ? { ...c, columnId, columnLabel: null } : c)),
    );
    updatePreferences({ kpiColumns: next })
      .then(() => loadDashboard(hearingRange))
      .catch((e: Error) => setError(e.message));
  };

  const openCard = openCardKey ? cards.find((c) => c.key === openCardKey) : undefined;

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center gap-3 animate-in">
        <div className="flex gap-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out infinite" }}
          />
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out 0.2s infinite" }}
          />
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "var(--color-amber)", animation: "pulse-subtle 1s ease-in-out 0.4s infinite" }}
          />
        </div>
        <span className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
          Loading dashboard…
        </span>
      </div>
    );
  }

  return (
    <div className="animate-in">
      {/* Greeting */}
      <div className="mb-6">
        <h1
          className="text-2xl mb-1"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
        >
          {getGreeting()}
        </h1>
        <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>
          Here's what needs your attention today.
        </p>
      </div>

      {error && (
        <div
          className="px-4 py-3 rounded-lg mb-5 text-sm"
          style={{
            backgroundColor: "var(--color-status-red-bg)",
            color: "var(--color-status-red)",
            border: "1px solid rgba(153,27,27,0.15)",
            fontFamily: "var(--font-body)",
          }}
        >
          {error}
        </div>
      )}

      {/* Quick access — watchlist + recently viewed (hidden when both empty) */}
      <QuickAccess />

      {/* KPI Grid */}
      <div className="kpi-grid">
        {cards.map((card, i) => (
          <KpiCardComponent
            key={card.key}
            card={card}
            index={i}
            onHearingToggle={card.key === "upcoming_hearings" ? toggleHearingRange : undefined}
            hearingRange={card.key === "upcoming_hearings" ? hearingRange : undefined}
            onOpen={() => setOpenCardKey(card.key)}
          />
        ))}
      </div>

      {openCard && (
        <KpiDetailModal
          cardKey={openCard.key}
          cardLabel={openCard.label}
          hearingRange={openCard.key === "upcoming_hearings" ? hearingRange : undefined}
          columnId={openCard.columnId}
          isPersonalChoice={openCard.key in myColumns}
          isAdmin={user?.role === "admin"}
          onSelectColumn={(columnId) => selectColumn(openCard.key, columnId)}
          onClose={() => setOpenCardKey(null)}
        />
      )}
    </div>
  );
}
