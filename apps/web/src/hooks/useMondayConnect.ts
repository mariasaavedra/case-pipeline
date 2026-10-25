import { useState } from "react";
import { startMondayConnect } from "../api";

/**
 * Starts the personal Monday.com OAuth connection. The API is asked first, with
 * the normal bearer token, for the consent URL — that call also sets a cookie
 * tying the flow to this browser — then the page navigates to monday.com.
 * `returnTo` is the app path Monday sends the user back to; the API only
 * accepts same-origin paths.
 */
export function useMondayConnect() {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function connect(returnTo?: string) {
    setConnecting(true);
    setError(null);
    startMondayConnect(returnTo)
      .then((url) => {
        window.location.href = url;
      })
      .catch((err: unknown) => {
        setConnecting(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  return { connect, connecting, error };
}
