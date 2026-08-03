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
  refresh: () => void;
}

const StatusOptionsContext = createContext<StatusOptionsValue>({
  byBoard: {},
  loaded: false,
  refresh: () => {},
});

export function StatusOptionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [byBoard, setByBoard] = useState<Record<string, BoardStatusOptions>>({});
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    fetchBoardStatusOptions()
      .then((list) => {
        const map: Record<string, BoardStatusOptions> = {};
        for (const b of list) map[b.boardKey] = b;
        setByBoard(map);
      })
      .catch(() => {
        /* offline / transient — inline editing simply won't offer options this load */
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

  const value = useMemo(() => ({ byBoard, loaded, refresh }), [byBoard, loaded, refresh]);
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
