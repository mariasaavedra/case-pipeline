// =============================================================================
// ClientPeek — client names open the case (M3) over the page, not the 360 view
// =============================================================================
// Outside P2 a client name is clicked to glance at the notes or the documents
// and then get back to the list. Leaving the page for the 360 view threw away
// the scroll position, the filters and whatever popup was open; the peek keeps
// all of it underneath. M3 still offers "Open full 360 view →" for when the
// glance turns into real work.
//
// ClientLink keeps a real href to the 360 view, so Ctrl/Cmd-click, middle-click
// and "Copy link" behave like any link. ClientPeekHost is mounted once by the
// app and renders whichever client ?client= names.
// =============================================================================

import { useEffect, useState } from "react";
import type { AnchorHTMLAttributes } from "react";
import { clientPath, closeClientPeek, openClientPeek, readClientPeek } from "../router";
import type { ClientPeek } from "../router";
import { ClientCaseModal } from "./ClientCaseModal";

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  clientId: string;
  /** Shown as the popup's title while the case loads; defaults to the link text. */
  clientName?: string;
}

export function ClientLink({ clientId, clientName, onClick, children, ...rest }: LinkProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onClick) onClick(e);
    // Modifier keys and non-primary buttons keep the browser's new-tab behaviour.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    openClientPeek(clientId, clientName ?? (typeof children === "string" ? children : undefined));
  };

  return (
    <a href={clientPath(clientId)} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

export function ClientPeekHost() {
  const [peek, setPeek] = useState<ClientPeek | null>(readClientPeek);

  useEffect(() => {
    // Deferred: App's route guards call navigate() mid-render, and a setState
    // here would then land inside App's render.
    const onNav = () => queueMicrotask(() => setPeek(readClientPeek()));
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  if (!peek) return null;
  return (
    <ClientCaseModal
      profileLocalId={peek.localId}
      profileName={peek.name ?? "Client"}
      onClose={closeClientPeek}
      allowOpenFullView
    />
  );
}
