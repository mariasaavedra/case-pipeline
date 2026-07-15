import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { getRecentlyViewed, getWatchlist } from "../api";
import type { RecentlyViewedItem, WatchlistItem } from "../api";
import { Link } from "./Link";

const STAR = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" />
  </svg>
);
const CLOCK = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

function MiniList({
  title,
  icon,
  items,
  empty,
}: {
  title: string;
  icon: ReactNode;
  items: { id: string; name: string | null }[];
  empty: string;
}) {
  return (
    <div className="card card-elevated" style={{ padding: "16px 18px", flex: 1, minWidth: 220 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ color: "var(--color-amber)", display: "flex" }}>{icon}</span>
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--color-ink-faint)",
          }}
        >
          {title}
        </span>
      </div>
      {items.length === 0 ? (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink-faint)", fontStyle: "italic" }}>
          {empty}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {items.map((it) => (
            <Link
              key={it.id}
              href={`/clients/${encodeURIComponent(it.id)}`}
              className="kpi-item-client"
              style={{ padding: "5px 0", fontSize: 14 }}
            >
              {it.name ?? it.id}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Landing widget: the user's watchlist + recently viewed clients. Hidden when both are empty. */
export function QuickAccess() {
  const [recent, setRecent] = useState<RecentlyViewedItem[]>([]);
  const [watch, setWatch] = useState<WatchlistItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.allSettled([getRecentlyViewed(), getWatchlist()]).then(([r, w]) => {
      if (r.status === "fulfilled") setRecent(r.value.slice(0, 6));
      if (w.status === "fulfilled") setWatch(w.value.slice(0, 6));
      setLoaded(true);
    });
  }, []);

  if (!loaded || (recent.length === 0 && watch.length === 0)) return null;

  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
      <MiniList
        title="Watchlist"
        icon={STAR}
        items={watch.map((w) => ({ id: w.profileLocalId, name: w.name }))}
        empty="Pin clients to see them here"
      />
      <MiniList
        title="Recently viewed"
        icon={CLOCK}
        items={recent.map((r) => ({ id: r.profileLocalId, name: r.name }))}
        empty="Clients you open appear here"
      />
    </div>
  );
}
