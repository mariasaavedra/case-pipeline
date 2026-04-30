import type { BoardItemSummary } from "../api";
import { StatusBadge } from "./StatusBadge";

const BOARD_LABEL: Record<string, string> = {
  appointments_r: "R",
  appointments_m: "M",
  appointments_lb: "LB",
  appointments_wh: "WH",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  appointments: BoardItemSummary[];
}

export function AppointmentSection({ appointments }: Props) {
  if (appointments.length === 0) return null;

  const sorted = [...appointments].sort((a, b) => {
    if (!a.nextDate) return 1;
    if (!b.nextDate) return -1;
    return b.nextDate.localeCompare(a.nextDate);
  });

  return (
    <div className="card card-elevated overflow-hidden">
      <div
        className="px-5 py-3 flex items-center gap-3"
        style={{
          backgroundColor: "var(--color-surface-warm)",
          borderBottom: "1px solid var(--color-border-light)",
        }}
      >
        <h3
          className="text-sm font-semibold"
          style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
        >
          Appointments
        </h3>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: "var(--color-surface)",
            color: "var(--color-ink-faint)",
            fontFamily: "var(--font-mono)",
            border: "1px solid var(--color-border-light)",
          }}
        >
          {appointments.length}
        </span>
      </div>
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--color-border-light)" }}>
            <th
              className="text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Date
            </th>
            <th
              className="text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Attorney
            </th>
            <th
              className="text-left px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a, i) => (
            <tr
              key={a.localId}
              style={{
                borderBottom: i < sorted.length - 1 ? "1px solid var(--color-border-light)" : "none",
              }}
            >
              <td
                className="px-5 py-2.5 text-sm"
                style={{ color: "var(--color-ink)", fontFamily: "var(--font-mono)", fontSize: 13 }}
              >
                {formatDate(a.nextDate)}
              </td>
              <td className="px-5 py-2.5">
                <span className="board-tag">
                  {BOARD_LABEL[a.boardKey] ?? a.boardKey}
                </span>
              </td>
              <td className="px-5 py-2.5">
                <StatusBadge status={a.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
