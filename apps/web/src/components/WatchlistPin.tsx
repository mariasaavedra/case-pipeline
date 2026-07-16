import { useState, useEffect } from "react";
import { getWatchlist, addWatchlist, removeWatchlist } from "../api";

/**
 * Star toggle that pins/unpins a client to the current user's watchlist.
 * Self-contained: checks membership on mount, then optimistically toggles.
 */
export function WatchlistPin({ mondayItemId }: { mondayItemId: string }) {
  const [watched, setWatched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWatchlist()
      .then((items) => {
        if (!cancelled) setWatched(items.some((i) => i.mondayItemId === mondayItemId));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mondayItemId]);

  async function toggle() {
    const next = !watched;
    setWatched(next); // optimistic
    setBusy(true);
    try {
      if (next) await addWatchlist(mondayItemId);
      else await removeWatchlist(mondayItemId);
    } catch {
      setWatched(!next); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy || !ready}
      title={watched ? "Remove from watchlist" : "Add to watchlist"}
      className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-colors"
      style={{
        color: watched ? "var(--color-amber)" : "var(--color-ink-muted)",
        backgroundColor: watched ? "var(--color-amber-light)" : "var(--color-surface-warm)",
        border: `1px solid ${watched ? "var(--color-amber)" : "var(--color-border-light)"}`,
        fontFamily: "var(--font-body)",
        cursor: busy ? "wait" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill={watched ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
        <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" />
      </svg>
      {watched ? "Saved" : "Watch"}
    </button>
  );
}
