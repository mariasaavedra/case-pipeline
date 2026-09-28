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
// =============================================================================

const TITLE = "Screen code: use it when asking for a change to this screen";

export function PageCode({ code }: { code: string }) {
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
