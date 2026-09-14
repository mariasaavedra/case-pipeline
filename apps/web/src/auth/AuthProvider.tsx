import { createContext, useState, useEffect, type ReactNode } from "react";
import { PublicClientApplication, InteractionStatus } from "@azure/msal-browser";
import { MsalProvider, useMsal, useIsAuthenticated } from "@azure/msal-react";
import { msalConfig, loginRequest } from "./msal-config";
import { setTokenGetter } from "../api";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  // Profile fields returned by /api/auth/me (present after login).
  paralegal_link?: string | null;
  locale?: string | null;
  timezone?: string | null;
  phone_ext?: string | null;
  job_title?: string | null;
  mondayConnected?: boolean;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  /**
   * Why a completed Microsoft sign-in still left us signed OUT of the app.
   *
   * These are two different gates — Microsoft authenticates, then /api/auth/me
   * authorizes — and only the first one has a screen of its own. When the
   * second failed, this used to be swallowed (a bare `if (res.ok)`), so the
   * route guard sent the user back to /login with no explanation and clicking
   * "Sign in with Microsoft" silently reused the cached account for the exact
   * same failure. That is the sign-in screen that "repeats itself".
   */
  error: string | null;
  /** The Microsoft account that was used, so a wrong-account error is obvious. */
  signedInAs: string | null;
  login: (opts?: { chooseAccount?: boolean }) => void;
  logout: () => void;
  /** Re-run the /api/auth/me check without a fresh Microsoft round trip. */
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  error: null,
  signedInAs: null,
  login: () => {},
  logout: () => {},
  retry: () => {},
});

// Singleton — created once, outside component lifecycle.
export const msalInstance = new PublicClientApplication(msalConfig);

function AuthConsumer({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Set active account whenever accounts change.
  useEffect(() => {
    if (accounts.length > 0 && !instance.getActiveAccount()) {
      instance.setActiveAccount(accounts[0]!);
    }
  }, [accounts, instance]);

  useEffect(() => {
    // Wait until any in-flight redirect/login interaction finishes.
    if (inProgress !== InteractionStatus.None) return;

    if (!isAuthenticated) {
      setTokenGetter(null); // release API calls waiting on auth — they'd hang otherwise
      setIsLoading(false);
      setUser(null);
      setError(null);
      return;
    }

    async function initUser() {
      const account = instance.getActiveAccount() ?? accounts[0];
      if (!account) {
        setTokenGetter(null);
        setIsLoading(false);
        return;
      }

      // Registered before the first token is fetched: the getter acquires its
      // own token lazily, and API calls made while this runs must not slip out
      // unauthenticated (that was the 401-on-refresh bug).
      setTokenGetter(async () => {
        const acc = instance.getActiveAccount();
        if (!acc) return null;
        const r = await instance.acquireTokenSilent({ ...loginRequest, account: acc });
        return r.idToken;
      });

      try {
        const result = await instance.acquireTokenSilent({ ...loginRequest, account });
        const token = result.idToken;

        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const body = (await res.json()) as { data: AuthUser };
          setUser(body.data);
          setError(null);
        } else {
          // The server's own words where it has them: "Access restricted to
          // @… accounts", "Account disabled", "Invalid or expired token".
          let reason = "";
          try {
            reason = ((await res.json()) as { error?: string }).error ?? "";
          } catch {
            // Not JSON — a proxy error page, or the API is down behind nginx.
          }
          setUser(null);
          // No JSON error means the answer did not come from the API at all.
          // In dev that is Vite's proxy, which returns a plain-text 500 when
          // nothing is listening on the API port — indistinguishable from a
          // real server fault unless it is named here. In production it is
          // nginx's own page, i.e. the API container is down.
          setError(
            reason
              ? `${reason} (HTTP ${res.status})`
              : `The API did not answer (HTTP ${res.status}) — it is most likely not running or not reachable from the web server.`,
          );
        }
      } catch (err) {
        console.error("[auth] init failed:", err);
        setUser(null);
        setError(err instanceof Error ? err.message : "Could not reach the server to verify your account.");
      } finally {
        setIsLoading(false);
      }
    }

    initUser();
  }, [isAuthenticated, inProgress, instance, accounts, attempt]);

  // `chooseAccount` forces Microsoft to show the account picker. Without it,
  // an SSO session signs the same account straight back in — so someone who
  // landed here with the wrong account (a personal login, another tenant, a
  // guest outside the firm's domain) can never get to a different one, and the
  // sign-in screen just reappears.
  const login = (opts?: { chooseAccount?: boolean }) => {
    const request = opts?.chooseAccount
      ? { ...loginRequest, prompt: "select_account" as const }
      : loginRequest;
    instance.loginRedirect(request).catch((err) => {
      console.error("[auth] loginRedirect failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  const logout = () => {
    instance.logoutRedirect().catch(console.error);
  };

  const retry = () => {
    setError(null);
    setIsLoading(true);
    setAttempt((n) => n + 1);
  };

  const signedInAs = accounts[0]?.username ?? null;

  return (
    <AuthContext.Provider value={{ user, isLoading, error, signedInAs, login, logout, retry }}>
      {children}
    </AuthContext.Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <MsalProvider instance={msalInstance}>
      <AuthConsumer>{children}</AuthConsumer>
    </MsalProvider>
  );
}
