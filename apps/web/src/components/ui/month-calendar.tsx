// =============================================================================
// MonthCalendar — pick a day on a month grid
// =============================================================================
// Always open (not a popup), for dialogs where picking the day IS the task —
// M33 Move target date. Values are ISO YYYY-MM-DD; days before `min` are
// disabled, weekends dimmed. `today` is outlined, `marked` (the current date
// being moved) gets a dot, `value` is filled.
// =============================================================================

import { useState } from "react";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

interface Props {
  value: string;
  onChange: (iso: string) => void;
  today: string;
  min?: string;
  /** A date to point out (e.g. the one being moved). */
  marked?: string | null;
  markedLabel?: string;
}

export function MonthCalendar({ value, onChange, today, min, marked, markedLabel = "Current date" }: Props) {
  const start = value || marked || today;
  const [month, setMonth] = useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 }));

  // Follow a date picked elsewhere (typed, or a +days button) into its month.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value) setMonth({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 });
  }

  const first = new Date(Date.UTC(month.y, month.m, 1));
  const daysIn = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const title = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const step = (n: number) => setMonth(({ y, m }) => {
    const d = new Date(Date.UTC(y, m + n, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  const canGoBack = !min || iso(month.y, month.m, 1) > min;

  return (
    <div className="rounded-lg p-2 select-none" style={{ border: "1px solid var(--color-border-light)", background: "var(--color-surface)" }}>
      <div className="flex items-center justify-between mb-1">
        <button type="button" onClick={() => step(-1)} disabled={!canGoBack} aria-label="Previous month"
          className="size-7 rounded-md text-base disabled:opacity-30 hover:bg-secondary" style={{ color: "var(--color-ink-muted)" }}>‹</button>
        <span className="text-sm font-semibold" style={{ color: "var(--color-ink)" }} aria-live="polite">{title}</span>
        <button type="button" onClick={() => step(1)} aria-label="Next month"
          className="size-7 rounded-md text-base hover:bg-secondary" style={{ color: "var(--color-ink-muted)" }}>›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center" role="grid" aria-label={title}>
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-[11px] py-1" style={{ color: "var(--color-ink-faint)" }}>{w}</span>
        ))}
        {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} />)}
        {Array.from({ length: daysIn }, (_, i) => {
          const day = i + 1;
          const d = iso(month.y, month.m, day);
          const disabled = !!min && d < min;
          const selected = d === value;
          const weekend = (lead + i) % 7 === 0 || (lead + i) % 7 === 6;
          const label = new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => onChange(d)}
              aria-pressed={selected}
              aria-label={`${label}${d === today ? " (today)" : ""}${d === marked ? ` (${markedLabel.toLowerCase()})` : ""}`}
              title={d === marked ? markedLabel : d === today ? "Today" : undefined}
              className="relative h-8 rounded-md text-sm tabular-nums disabled:opacity-30 disabled:cursor-default enabled:hover:bg-secondary"
              style={{
                background: selected ? "var(--color-primary)" : undefined,
                color: selected ? "var(--color-primary-foreground)" : weekend ? "var(--color-ink-faint)" : "var(--color-ink)",
                fontWeight: selected || d === today ? 600 : undefined,
                boxShadow: d === today && !selected ? "inset 0 0 0 1px var(--color-ink-muted)" : undefined,
              }}
            >
              {day}
              {d === marked && (
                <span className="absolute left-1/2 bottom-0.5 -translate-x-1/2 size-1 rounded-full"
                  style={{ background: selected ? "var(--color-primary-foreground)" : "var(--urgency-overdue)" }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
