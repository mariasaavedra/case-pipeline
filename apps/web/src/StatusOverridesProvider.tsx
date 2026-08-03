// =============================================================================
// StatusOverridesProvider — firm-wide status label/color overrides
// =============================================================================
// Fetches the admin-managed overrides once and merges them over the code-seeded
// base map (STATUS_OVERRIDES in config.ts), admin winning. Every status badge
// reads the merged map via useStatusOverrides() and passes it to translateStatus,
// so an admin's rename/recolor lands everywhere without prop-drilling.
//
// Before the fetch resolves (or if it fails / the user isn't signed in) badges
// still render from the base map — the overrides are additive, never required.
// =============================================================================

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { STATUS_OVERRIDES, type StatusRule } from "./config";
import { fetchStatusOverrides, type StatusOverrides } from "./api";
import { useAuth } from "./auth/useAuth";

interface StatusOverridesValue {
  /** Base ∪ admin, admin winning — pass straight to translateStatus. */
  merged: Record<string, StatusRule>;
  /** Just the admin layer, for the editor to show what's been customised. */
  admin: StatusOverrides;
  /** Re-fetch after the editor saves. */
  refresh: () => void;
}

const StatusOverridesContext = createContext<StatusOverridesValue>({
  merged: STATUS_OVERRIDES,
  admin: {},
  refresh: () => {},
});

export function StatusOverridesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [admin, setAdmin] = useState<StatusOverrides>({});

  const refresh = useCallback(() => {
    fetchStatusOverrides()
      .then(setAdmin)
      .catch(() => {
        /* offline / transient — base map still renders every badge */
      });
  }, []);

  // Fetch once authenticated: the API token getter is wired only after auth
  // resolves, so a mount-time fetch would 401 and never retry (the admin layer
  // would silently never load, leaving only the base map). Re-run on sign-in.
  useEffect(() => {
    if (!user) return;
    refresh();
  }, [user, refresh]);

  const merged = { ...STATUS_OVERRIDES, ...admin };
  return (
    <StatusOverridesContext.Provider value={{ merged, admin, refresh }}>
      {children}
    </StatusOverridesContext.Provider>
  );
}

/** The merged override map. Pass to translateStatus(status, overrides). */
export function useStatusOverrides(): Record<string, StatusRule> {
  return useContext(StatusOverridesContext).merged;
}

/** Full context — for the admin editor (admin layer + refresh). */
export function useStatusOverridesAdmin(): StatusOverridesValue {
  return useContext(StatusOverridesContext);
}
