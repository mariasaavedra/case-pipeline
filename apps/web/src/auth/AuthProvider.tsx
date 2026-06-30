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
}

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

// Singleton — created once, outside component lifecycle.
export const msalInstance = new PublicClientApplication(msalConfig);

function AuthConsumer({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
      setIsLoading(false);
      setUser(null);
      return;
    }

    async function initUser() {
      const account = instance.getActiveAccount() ?? accounts[0];
      if (!account) {
        setIsLoading(false);
        return;
      }

      try {
        const result = await instance.acquireTokenSilent({ ...loginRequest, account });
        const token = result.idToken;

        // Wire up the token getter for all subsequent API calls.
        setTokenGetter(async () => {
          const acc = instance.getActiveAccount();
          if (!acc) return null;
          const r = await instance.acquireTokenSilent({ ...loginRequest, account: acc });
          return r.idToken;
        });

        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const body = (await res.json()) as { data: AuthUser };
          setUser(body.data);
        }
      } catch (err) {
        console.error("[auth] init failed:", err);
      } finally {
        setIsLoading(false);
      }
    }

    initUser();
  }, [isAuthenticated, inProgress, instance, accounts]);

  const login = () => {
    instance.loginRedirect(loginRequest).catch((err) => {
      console.error("[auth] loginRedirect failed:", err);
      alert(`Login error: ${err?.message ?? err}`);
    });
  };

  const logout = () => {
    instance.logoutRedirect().catch(console.error);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
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
