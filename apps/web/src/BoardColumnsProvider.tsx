// =============================================================================
// BoardColumnsProvider — full per-board column schema (titles, types, options)
// =============================================================================
// Fetches every board's column schema once (after auth) and exposes a lookup by
// board_key. Powers the all-columns expand/edit view: which fields exist, their
// types (which editor to render), and choice options. Same auth-gated,
// timeout-bounded pattern as StatusOptionsProvider so it can't hang forever.
// =============================================================================

import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { fetchBoardColumns, type BoardColumns } from "./api";
import { useAuth } from "./auth/useAuth";

interface Value {
  byBoard: Record<string, BoardColumns>;
  loaded: boolean;
  error: string | null;
  refresh: () => void;
}

const Ctx = createContext<Value>({ byBoard: {}, loaded: false, error: null, refresh: () => {} });

const TIMEOUT_MS = 15000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`timed out after ${ms / 1000}s`)), ms))]);
}

export function BoardColumnsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [byBoard, setByBoard] = useState<Record<string, BoardColumns>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    withTimeout(fetchBoardColumns(), TIMEOUT_MS)
      .then((list) => {
        const map: Record<string, BoardColumns> = {};
        for (const b of list) map[b.boardKey] = b;
        setByBoard(map);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[board-columns] fetch failed:", msg);
        setError(msg);
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh();
  }, [user, refresh]);

  const value = useMemo(() => ({ byBoard, loaded, error, refresh }), [byBoard, loaded, error, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBoardColumns(boardKey: string | null | undefined): BoardColumns | null {
  const { byBoard } = useContext(Ctx);
  return boardKey ? byBoard[boardKey] ?? null : null;
}
