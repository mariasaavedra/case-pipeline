import { translateStatus } from "../config";
import { useStatusOverrides } from "../StatusOverridesProvider";

const COLOR_STYLES: Record<string, { bg: string; text: string }> = {
  green:  { bg: "var(--color-status-green-bg)", text: "var(--color-status-green)" },
  blue:   { bg: "var(--color-status-blue-bg)", text: "var(--color-status-blue)" },
  yellow: { bg: "var(--color-status-yellow-bg)", text: "var(--color-status-yellow)" },
  red:    { bg: "var(--color-status-red-bg)", text: "var(--color-status-red)" },
  gray:   { bg: "var(--color-status-gray-bg)", text: "var(--color-status-gray)" },
  purple: { bg: "var(--color-status-purple-bg)", text: "var(--color-status-purple)" },
};

/**
 * A Monday status rendered case-oriented: the translated label + tone (see
 * translateStatus). `raw` shows the original Monday label instead — for places
 * that must mirror Monday exactly. The original status is always the tooltip.
 */
export function StatusBadge({ status, raw = false }: { status: string | null; raw?: boolean }) {
  const overrides = useStatusOverrides();
  if (!status) return null;
  const { label, tone, urgency } = translateStatus(status, overrides);
  const style = COLOR_STYLES[tone] ?? COLOR_STYLES.gray!;

  return (
    <span
      className="status-pill"
      style={{ backgroundColor: style.bg, color: style.text }}
      title={urgency ? `${status} · ${urgency}` : status}
    >
      {/* Urgency marker — an admin can flag a status as urgent regardless of its
          date; a dot shows it wherever the badge appears. */}
      {urgency && (
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            marginRight: 5,
            verticalAlign: "middle",
            backgroundColor:
              urgency === "overdue"
                ? "var(--color-status-red)"
                : urgency === "critical"
                  ? "var(--color-status-red)"
                  : "var(--color-status-yellow)",
          }}
        />
      )}
      {raw ? status : label}
    </span>
  );
}
