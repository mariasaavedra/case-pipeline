import { getStatusColor } from "../config";

const COLOR_STYLES: Record<string, { bg: string; text: string }> = {
  green:  { bg: "var(--color-status-green-bg)", text: "var(--color-status-green)" },
  blue:   { bg: "var(--color-status-blue-bg)", text: "var(--color-status-blue)" },
  yellow: { bg: "var(--color-status-yellow-bg)", text: "var(--color-status-yellow)" },
  red:    { bg: "var(--color-status-red-bg)", text: "var(--color-status-red)" },
  gray:   { bg: "var(--color-status-gray-bg)", text: "var(--color-status-gray)" },
  purple: { bg: "var(--color-status-purple-bg)", text: "var(--color-status-purple)" },
};

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const color = getStatusColor(status);
  const style = COLOR_STYLES[color] ?? COLOR_STYLES.gray!;

  return (
    <span
      className="status-pill"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {status}
    </span>
  );
}
