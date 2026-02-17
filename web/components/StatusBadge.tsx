import { getStatusColor } from "../config";

const COLOR_CLASSES: Record<string, string> = {
  green:  "bg-green-100 text-green-800",
  blue:   "bg-blue-100 text-blue-800",
  yellow: "bg-yellow-100 text-yellow-800",
  red:    "bg-red-100 text-red-800",
  gray:   "bg-gray-100 text-gray-600",
  purple: "bg-purple-100 text-purple-800",
};

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const color = getStatusColor(status);
  const classes = COLOR_CLASSES[color] ?? COLOR_CLASSES.gray;

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${classes}`}>
      {status}
    </span>
  );
}
