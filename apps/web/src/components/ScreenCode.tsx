// =============================================================================
// ScreenCode — the small grey code from docs/ui-map.md
// =============================================================================
// Every page, tab, popup and dropdown carries a code (P3.2, M5, D6…) so a
// change request can name exactly one thing. Popups show theirs under the ×
// (`code` on DialogContent); these two cover the rest:
//
//   PageCode  pinned to the bottom-right of the window, one per screen
//   MenuCode  a last line at the bottom-right of a dropdown menu, in flow so it
//             never sits on top of an option
//   SectionCode  a section inside a page (P2.3, P11.3.2…): after its heading
//             when it has one (`inline`), else a small line above its right edge
// =============================================================================

import { useScreenCodesVisible } from "../hooks/useScreenCodes";

// All of them hide together when "Show screen codes" is off (Settings →
// Preferences); see hooks/useScreenCodes.ts.

const TITLE = "Screen code: use it when asking for a change to this screen";

export function PageCode({ code }: { code: string }) {
  if (!useScreenCodesVisible()) return null;
  return (
    <span
      aria-hidden
      title={TITLE}
      style={{
        position: "fixed",
        right: 10,
        bottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
        zIndex: 30,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        lineHeight: 1,
        color: "var(--color-ink-faint)",
        userSelect: "all",
      }}
    >
      {code}
    </span>
  );
}

export function MenuCode({ code }: { code: string }) {
  if (!useScreenCodesVisible()) return null;
  return (
    <div
      aria-hidden
      title={TITLE}
      style={{
        textAlign: "right",
        marginTop: 4,
        paddingRight: 2,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        lineHeight: 1,
        color: "var(--color-ink-faint)",
        userSelect: "all",
      }}
    >
      {code}
    </div>
  );
}

export function SectionCode({ code, inline = false }: { code: string; inline?: boolean }) {
  const visible = useScreenCodesVisible();
  if (!visible) return null;
  const style = {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1,
    letterSpacing: "normal",
    textTransform: "none" as const,
    color: "var(--color-ink-faint)",
    userSelect: "all" as const,
  };
  return inline ? (
    <span aria-hidden title={TITLE} style={{ ...style, marginLeft: 8, verticalAlign: "middle" }}>
      {code}
    </span>
  ) : (
    <div aria-hidden title={TITLE} style={{ ...style, textAlign: "right", marginBottom: 3 }}>
      {code}
    </div>
  );
}
