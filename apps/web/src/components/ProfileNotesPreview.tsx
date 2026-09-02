// =============================================================================
// ProfileNotesPreview — the linked client's recent 360 notes, inline
// =============================================================================
// Once a call is linked to a profile, whoever picked up the phone needs the
// same context the 360 view would give them — without leaving the popup and
// losing the half-typed call. This pulls the newest entries from that client's
// timeline (the same /api/clients/:id/updates feed the 360 view's Updates tab
// reads) and shows them collapsed under the link, expandable in place.
//
// Read-only on purpose: notes ABOUT this call belong on the call, and the
// modal's own note field already mirrors those onto the profile.
// =============================================================================

import { useState, useEffect } from "react";
import { fetchClientUpdates } from "../api";
import type { ClientUpdate } from "../api";
import { clientPath } from "../router";

interface Props {
  profileLocalId: string;
  profileName: string;
}

/** How many timeline entries to pull. Enough to cover "what happened recently"
 * without turning the popup into the 360 view. */
const PREVIEW_LIMIT = 8;

/** Entries shown before the reader has to expand. */
const COLLAPSED_COUNT = 2;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function NoteRow({ update }: { update: ClientUpdate }) {
  return (
    <div style={{ padding: "6px 0", borderTop: "1px solid var(--color-border-light)" }}>
      <div style={{ fontSize: 11, color: "var(--color-ink-faint)", marginBottom: 2 }}>
        <strong style={{ color: "var(--color-ink-muted)" }}>{update.authorName}</strong>
        {" · "}
        {formatWhen(update.createdAtSource)}
        {update.activityTypeName ? ` · ${update.activityTypeName}` : ""}
      </div>
      {update.title && (
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink)", marginBottom: 2 }}>{update.title}</div>
      )}
      <div style={{ fontSize: 12, color: "var(--color-ink)", whiteSpace: "pre-wrap" }}>
        {update.textBody.trim() || <em style={{ color: "var(--color-ink-faint)" }}>(no text)</em>}
      </div>
    </div>
  );
}

export function ProfileNotesPreview({ profileLocalId, profileName }: Props) {
  const [updates, setUpdates] = useState<ClientUpdate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUpdates(null);
    setError(null);
    setExpanded(false);
    fetchClientUpdates(profileLocalId, { limit: PREVIEW_LIMIT })
      .then((rows) => {
        if (!cancelled) setUpdates(rows);
      })
      .catch((e: unknown) => {
        // Non-fatal: the call can still be logged and linked without context.
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this client's notes");
      });
    return () => {
      cancelled = true;
    };
  }, [profileLocalId]);

  const shown = updates ? (expanded ? updates : updates.slice(0, COLLAPSED_COUNT)) : [];
  const hiddenCount = updates ? updates.length - shown.length : 0;

  return (
    <div
      style={{
        marginBottom: 12, padding: "8px 10px", borderRadius: 8,
        border: "1px solid var(--color-border-light)", background: "var(--color-surface-warm)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)" }}>
          Recent notes — {profileName}
        </span>
        {/* A new tab, not an SPA navigation: this renders inside the log-call
            popup, and routing away would throw out the call being typed. */}
        <a
          href={clientPath(profileLocalId)}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 11, color: "var(--color-amber)", whiteSpace: "nowrap" }}
        >
          Open 360 view ↗
        </a>
      </div>

      {error ? (
        <p style={{ fontSize: 12, color: "var(--color-ink-faint)", margin: 0 }}>{error}</p>
      ) : updates === null ? (
        <p style={{ fontSize: 12, color: "var(--color-ink-faint)", margin: 0 }}>Loading notes…</p>
      ) : updates.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-ink-faint)", margin: 0 }}>No notes on this client yet.</p>
      ) : (
        <>
          <div style={{ maxHeight: expanded ? 220 : undefined, overflowY: expanded ? "auto" : undefined }}>
            {shown.map((u) => <NoteRow key={u.localId} update={u} />)}
          </div>
          {(hiddenCount > 0 || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              style={{
                background: "none", border: "none", padding: "4px 0 0", cursor: "pointer",
                fontSize: 11, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)",
              }}
            >
              {expanded ? "▾ Show fewer" : `▸ Show ${hiddenCount} more`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
