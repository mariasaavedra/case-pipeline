// =============================================================================
// StatusOptionsProvider — per-board status column options (native Monday colors)
// =============================================================================
// Fetches every board's status column definition once and exposes a lookup by
// board_key. The status editor uses it to (a) restrict choices to the labels that
// exist in Monday and (b) render each in its real Monday color. Read-only mirror
// of what the sync captured; a failed fetch just means no inline editing yet.
// =============================================================================

import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { fetchBoardStatusOptions, type BoardStatusOptions } from "./api";
import { useAuth } from "./auth/useAuth";

interface StatusOptionsValue {
  /** board_key → its status column definition (id + colored options). */
  byBoard: Record<string, BoardStatusOptions>;
  /** True once the initial fetch has resolved (success or failure). */
  loaded: boolean;
  /** The last fetch error message, if any (so the UI can show why it's empty). */
  error: string | null;
  refresh: () => void;
}

const StatusOptionsContext = createContext<StatusOptionsValue>({
  byBoard: {},
  loaded: false,
  error: null,
  refresh: () => {},
});

// The fetch must never leave the UI stuck on "loading": bound it so a hung
// request resolves to an error the user can see (and retry).
const FETCH_TIMEOUT_MS = 12000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms)),
  ]);
}

export function StatusOptionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [byBoard, setByBoard] = useState<Record<string, BoardStatusOptions>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    withTimeout(fetchBoardStatusOptions(), FETCH_TIMEOUT_MS)
      .then((list) => {
        const map: Record<string, BoardStatusOptions> = {};
        for (const b of list) map[b.boardKey] = b;
        setByBoard(map);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[status-options] fetch failed:", msg);
        setError(msg);
      })
      .finally(() => setLoaded(true));
  }, []);

  // Fetch once the user is authenticated. The API token getter is only wired
  // AFTER auth resolves, so fetching on mount would go out unauthenticated (401)
  // and never retry — leaving every status non-editable. Keying on `user` re-runs
  // the fetch the moment sign-in completes (token ready) and on account switch.
  useEffect(() => {
    if (!user) return;
    refresh();
  }, [user, refresh]);

  const value = useMemo(() => ({ byBoard, loaded, error, refresh }), [byBoard, loaded, error, refresh]);
  return <StatusOptionsContext.Provider value={value}>{children}</StatusOptionsContext.Provider>;
}

/** The full board_key → status-options map plus load state. */
export function useStatusOptions(): StatusOptionsValue {
  return useContext(StatusOptionsContext);
}

/** One board's status options, or null if the board has none synced. */
export function useBoardStatusOptions(boardKey: string | null | undefined): BoardStatusOptions | null {
  const { byBoard } = useContext(StatusOptionsContext);
  return boardKey ? byBoard[boardKey] ?? null : null;
}
