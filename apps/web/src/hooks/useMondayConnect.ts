import { useState } from "react";
import { getAzureToken } from "../api";

/**
 * Starts the personal Monday.com OAuth connection. A full-page navigation,
 * because the consent screen lives on monday.com — so the Azure token rides in
 * the query string (a navigation can't set headers). `returnTo` is the app path
 * Monday sends the user back to; the API only accepts same-origin paths.
 */
export function useMondayConnect() {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function connect(returnTo?: string) {
    setConnecting(true);
    setError(null);
    getAzureToken()
      .then((token) => {
        const qs = new URLSearchParams();
        if (token) qs.set("az_token", token);
        if (returnTo) qs.set("return_to", returnTo);
        const query = qs.toString();
        window.location.href = `/api/auth/monday${query ? `?${query}` : ""}`;
      })
      .catch((err: unknown) => {
        setConnecting(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  return { connect, connecting, error };
}
