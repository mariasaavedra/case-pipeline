// =============================================================================
// MondayConnectPrompt (M16) — asks a signed-in user to connect Monday.com
// =============================================================================
// Without a personal connection, notes and status changes are written under
// the firm's shared Monday account instead of the person who made them. The
// Settings page has the same button (P11.1.3), but nobody visits Settings, so
// this asks once after sign-in. "Not now" snoozes it (see lib/monday-prompt.ts).
//
// After Monday's consent screen the API sends the user back to the page they
// were on with ?monday=connected; this component strips that and confirms.
// =============================================================================

import { useEffect, useState } from "react";
import { fetchMondayStatus } from "../api";
import type { MondayConnectionStatus } from "../api";
import { useMondayConnect } from "../hooks/useMondayConnect";
import { MONDAY_PROMPT_DISMISSED_KEY, shouldPromptMondayConnect } from "../lib/monday-prompt";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

type View = { kind: "hidden" } | { kind: "ask"; status: MondayConnectionStatus } | { kind: "connected"; name?: string };

function readDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(MONDAY_PROMPT_DISMISSED_KEY);
    return raw ? Number(raw) || null : null;
  } catch {
    return null;
  }
}

function writeDismissedAt(now: number): void {
  try {
    localStorage.setItem(MONDAY_PROMPT_DISMISSED_KEY, String(now));
  } catch {
    // Private window / blocked storage — the prompt just asks again next load.
  }
}

/** Removes ?monday=… from the address bar; returns what it was. */
function takeReturnFlag(): string | null {
  const url = new URL(window.location.href);
  const flag = url.searchParams.get("monday");
  if (flag === null) return null;
  url.searchParams.delete("monday");
  url.searchParams.delete("reason");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return flag;
}

export function MondayConnectPrompt() {
  const [view, setView] = useState<View>({ kind: "hidden" });
  const { connect, connecting, error } = useMondayConnect();

  useEffect(() => {
    const justConnected = takeReturnFlag() === "connected";
    let cancelled = false;
    fetchMondayStatus()
      .then((status) => {
        if (cancelled) return;
        if (justConnected && status.connected && !status.needsReconnect) {
          setView({ kind: "connected", name: status.mondayName });
        } else if (shouldPromptMondayConnect(status, readDismissedAt(), Date.now())) {
          setView({ kind: "ask", status });
        }
      })
      // A status failure is not worth interrupting anyone over.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (view.kind === "hidden") return null;

  const close = () => setView({ kind: "hidden" });

  if (view.kind === "connected") {
    return (
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent code="M16">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Monday.com connected</DialogTitle>
            <DialogDescription>
              {view.name ? `You're connected as ${view.name}. ` : ""}
              Notes and changes you make here now show your name in Monday.com.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={close}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const reconnect = !!view.status.needsReconnect;
  const notNow = () => {
    writeDismissedAt(Date.now());
    close();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && notNow()}>
      <DialogContent code="M16">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>
            {reconnect ? "Reconnect your Monday.com account" : "Connect your Monday.com account"}
          </DialogTitle>
          <DialogDescription>
            {reconnect
              ? "Monday.com stopped accepting your connection. Your changes are still saved, but under the firm's shared account instead of your name. Reconnecting takes one click."
              : "Notes and status changes you make here are saved to Monday.com. Connect your account so they show your name instead of the firm's shared account. It takes one click."}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm" style={{ color: "var(--color-status-red)" }}>
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={notNow} disabled={connecting}>
            Not now
          </Button>
          <Button onClick={() => connect(window.location.pathname + window.location.search)} disabled={connecting}>
            {connecting ? "Redirecting…" : reconnect ? "Reconnect Monday.com" : "Connect Monday.com"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
