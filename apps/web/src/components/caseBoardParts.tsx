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

// =============================================================================
// CountTable — people × columns, each cell a count that filters the list
// =============================================================================
// Used by P13 Prescheduling and P14 Contracts. An item can belong to several
// rows (shared cases); the "All" row counts each item once. `cellTone` picks the
// --urgency-* token that tints a non-empty cell (null = neutral).

export interface CountSelection {
  row: string | null;
  col: string | null;
}

export function CountTable<T>({
  items,
  rowHeader,
  rowsOf,
  lastRow,
  columns,
  colOf,
  cellTone,
  cellTitle,
  selected,
  onPick,
}: {
  items: T[];
  rowHeader: string;
  rowsOf: (item: T) => string[];
  /** A row label that always sorts last ("Unassigned", "No attorney"). */
  lastRow?: string;
  columns: string[];
  colOf: (item: T) => string;
  cellTone: (items: T[]) => string | null;
  cellTitle?: (items: T[]) => string | undefined;
  selected: CountSelection;
  onPick: (s: CountSelection) => void;
}) {
  const rows = [...new Set(items.flatMap(rowsOf))].sort((a, b) =>
    a === lastRow ? 1 : b === lastRow ? -1 : a.localeCompare(b),
  );

  // `strong` = the "All" row: heavier rule, bold numbers.
  const cell = (row: string | null, col: string | null, strong = false) => {
    const inCell = items.filter((i) => (row === null || rowsOf(i).includes(row)) && (col === null || colOf(i) === col));
    const n = inCell.length;
    const tone = col !== null && n > 0 ? cellTone(inCell) : null;
    const isSelected = selected.row === row && selected.col === col && (row !== null || col !== null);
    return (
      <td
        key={col ?? "total"}
        className="p-0.5"
        style={{ borderTop: `1px solid var(${strong ? "--color-border" : "--color-border-light"})` }}
      >
        <button
          type="button"
          disabled={n === 0}
          onClick={() => onPick(isSelected ? { row: null, col: null } : { row, col })}
          className="w-full h-9 rounded-md text-sm tabular-nums transition-shadow disabled:cursor-default"
          style={{
            background: tone ? `var(--urgency-${tone}-bg)` : "transparent",
            color: n === 0 ? "var(--color-ink-faint)" : tone ? `var(--urgency-${tone})` : "var(--color-ink)",
            fontWeight: strong || tone ? 600 : 400,
            boxShadow: isSelected ? "inset 0 0 0 2px var(--color-amber)" : undefined,
          }}
          aria-pressed={isSelected}
          aria-label={`${row ?? "Everyone"}, ${col ?? "all"}: ${n}`}
          title={n > 0 && col !== null ? cellTitle?.(inCell) : undefined}
        >
          {n === 0 ? "–" : n}
        </button>
      </td>
    );
  };

  const nameStyle = (strong: boolean): React.CSSProperties => ({
    borderTop: `1px solid var(${strong ? "--color-border" : "--color-border-light"})`,
    background: "var(--color-card)",
  });

  return (
    <div className="card overflow-x-auto p-2">
      <table className="w-full border-separate" style={{ borderSpacing: 0, minWidth: 120 + columns.length * 96 }}>
        <thead>
          <tr>
            <th
              className="text-left text-xs font-medium px-2 pb-2 sticky left-0 align-bottom"
              style={{ color: "var(--color-ink-faint)", background: "var(--color-card)" }}
            >
              {rowHeader}
            </th>
            {columns.map((c) => (
              <th
                key={c}
                className="text-xs font-semibold px-1 pb-2 align-bottom leading-tight"
                style={{ color: "var(--color-ink-muted)", minWidth: 88 }}
              >
                {c}
              </th>
            ))}
            <th className="text-xs font-medium px-1 pb-2 align-bottom" style={{ color: "var(--color-ink-faint)" }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rowActive = selected.row === r && selected.col === null;
            return (
              <tr key={r}>
                <td className="px-2 text-sm whitespace-nowrap sticky left-0 z-10" style={nameStyle(false)}>
                  <button
                    type="button"
                    onClick={() => onPick(rowActive ? { row: null, col: null } : { row: r, col: null })}
                    className="hover:underline text-left"
                    style={{
                      color: r === lastRow ? "var(--color-ink-faint)" : "var(--color-ink)",
                      fontWeight: rowActive ? 600 : 500,
                    }}
                  >
                    {r}
                  </button>
                </td>
                {columns.map((c) => cell(r, c))}
                {cell(r, null)}
              </tr>
            );
          })}
          <tr>
            <td
              className="px-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap sticky left-0 z-10"
              style={{ ...nameStyle(true), color: "var(--color-ink-muted)" }}
              title="Each item counted once, even when it is shared"
            >
              All
            </td>
            {columns.map((c) => cell(null, c, true))}
            {cell(null, null, true)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// ListSection — a titled card holding one group of the list
// =============================================================================

export function ListSection({
  title,
  count,
  note,
  tone,
  children,
}: {
  title: React.ReactNode;
  count: number;
  note?: string;
  /** --urgency-* token for the heading; null = neutral. */
  tone: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <h2
        className="flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide"
        style={{
          color: tone ? `var(--urgency-${tone})` : "var(--color-ink-muted)",
          background: tone ? `var(--urgency-${tone}-bg)` : "var(--color-surface-warm)",
        }}
      >
        {title}
        <span className="font-medium" style={{ color: "var(--color-ink-muted)" }}>· {count}</span>
        {note && (
          <span className="ml-auto normal-case tracking-normal font-normal" style={{ color: "var(--color-ink-muted)" }}>
            {note}
          </span>
        )}
      </h2>
      {count === 0 ? (
        <p className="px-4 py-3 text-sm" style={{ color: "var(--color-ink-faint)" }}>Nothing matches these filters.</p>
      ) : (
        <ul>{children}</ul>
      )}
    </section>
  );
}

// =============================================================================
// Wait levels (days since hire on P13, days since sent on P14)
// =============================================================================

type Level = "late" | "waiting" | "fresh" | "unknown";

/** The --urgency-* token for a wait level (null = no date, neutral). */
export const WAIT_TONE: Record<Level, string | null> = {
  late: "overdue",
  waiting: "missing",
  fresh: "later",
  unknown: null,
};

const WAIT_RANK: Record<Level, number> = { late: 0, waiting: 1, fresh: 2, unknown: 3 };

/** The most overdue of some wait levels. */
export function worstWait(levels: Level[]): Level {
  return levels.reduce<Level>((w, l) => (WAIT_RANK[l] < WAIT_RANK[w] ? l : w), "unknown");
}

export const waitFg = (l: Level) => (WAIT_TONE[l] ? `var(--urgency-${WAIT_TONE[l]})` : "var(--color-ink-muted)");
