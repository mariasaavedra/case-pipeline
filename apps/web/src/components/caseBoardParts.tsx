// =============================================================================
// Shared pieces for the case-board pages (P5 Active Cases, P13 Prescheduling)
// =============================================================================
// Colours come from the --urgency-* tokens in styles.css (overdue, missing,
// critical, soon, later, court, snooze), which have dark-theme values.

export const UNASSIGNED = "Unassigned";

/** "Sep 12", or "Sep 12, 2025" outside the current year. */
export function formatDue(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** A small uppercase tag tinted with one --urgency-* token. */
export function Tag({ children, color, title }: { children: React.ReactNode; color: string; title?: string }) {
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ color: `var(--urgency-${color})`, background: `var(--urgency-${color}-bg)` }}
      title={title}
    >
      {children}
    </span>
  );
}

/** A person's name as a chip; clicking it filters the page to their cases. */
export function PersonChip({ name, active, onClick }: { name: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors"
      style={{
        borderColor: active ? "var(--color-amber)" : "var(--color-border)",
        background: active ? "var(--color-amber-light)" : "var(--color-surface-warm)",
        color: active ? "var(--color-amber-dark)" : "var(--color-ink-muted)",
      }}
      title={`Show only ${name}'s cases`}
    >
      {name}
    </button>
  );
}

/** Small outlined label for a form / contract type (I-130, Full Packet…). */
export function FormChip({ label }: { label: string }) {
  return (
    <span
      className="text-[11px] font-medium px-1.5 rounded whitespace-nowrap"
      style={{ color: "var(--color-ink-muted)", border: "1px solid var(--color-border)" }}
    >
      {label}
    </span>
  );
}
