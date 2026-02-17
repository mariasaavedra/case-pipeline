import type { BoardItemSummary } from "../api";
import { StatusBadge } from "./StatusBadge";

const BOARD_LABEL: Record<string, string> = {
  appointments_r: "R",
  appointments_m: "M",
  appointments_lb: "LB",
  appointments_wh: "WH",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
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
    <div className="bg-white rounded-lg shadow overflow-hidden mb-4">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700">
          Appointments
          <span className="ml-2 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
            {appointments.length}
          </span>
        </h3>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Date</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Attorney</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => (
            <tr key={a.localId} className="border-b border-gray-100 last:border-0">
              <td className="px-4 py-2 text-sm text-gray-700">{formatDate(a.nextDate)}</td>
              <td className="px-4 py-2">
                <span className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded font-mono">
                  {BOARD_LABEL[a.boardKey] ?? a.boardKey}
                </span>
              </td>
              <td className="px-4 py-2"><StatusBadge status={a.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
