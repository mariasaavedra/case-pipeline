// =============================================================================
// VersionBadge — the running build stamp + a changelog popover
// =============================================================================
// Shows the build's short SHA and date. Click to see a plain-language changelog.
// Doubles as a deploy check: if the badge SHA doesn't match the latest commit,
// the browser is on a stale bundle (hard refresh / cache).
// =============================================================================

import { useState } from "react";
import { SHORT_SHA, BUILD_DAY, VERSION_LABEL } from "../version";
import { CHANGELOG } from "../changelog";
import { ModalPortal } from "./ModalPortal";

export function VersionBadge({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const label = VERSION_LABEL || SHORT_SHA;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`version-badge ${className}`}
        title="What's new — click for the changelog"
        aria-label={`Version ${label}. Click for the changelog.`}
      >
        <span aria-hidden>●</span>
        <span style={{ fontFamily: "var(--font-mono)" }}>{label}</span>
      </button>

      {open && (
        <ModalPortal>
          <div
            className="version-modal-backdrop"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Changelog"
          >
            <div className="version-modal" onClick={(e) => e.stopPropagation()}>
              <div className="version-modal-head">
                <div>
                  <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--color-ink)", margin: 0 }}>
                    What's new
                  </h2>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-ink-faint)", margin: "2px 0 0" }}>
                    build {SHORT_SHA}{BUILD_DAY ? ` · ${BUILD_DAY}` : ""}
                  </p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="version-modal-close" aria-label="Close">
                  ✕
                </button>
              </div>

              <div className="version-modal-body">
                {CHANGELOG.map((entry, i) => (
                  <section key={i} style={{ marginBottom: 18 }}>
                    <div className="flex items-baseline gap-2" style={{ marginBottom: 6 }}>
                      <h3 style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600, color: "var(--color-ink)", margin: 0 }}>
                        {entry.title}
                      </h3>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-ink-faint)" }}>
                        {entry.date}
                      </span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {entry.items.map((it, j) => (
                        <li
                          key={j}
                          style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink-muted)", lineHeight: 1.5, marginBottom: 3 }}
                        >
                          {it}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
