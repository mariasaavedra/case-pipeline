import { useState } from "react";
import type { ClientCaseSummary } from "../api";
import { BOARD_DISPLAY_NAMES } from "../../lib/query/types";

interface Props {
  data: ClientCaseSummary;
  onViewRelations: () => void;
}

function generateSummaryText(data: ClientCaseSummary): string {
  const lines: string[] = [];
  lines.push(`Client: ${data.profile.name}`);
  if (data.profile.email) lines.push(`Email: ${data.profile.email}`);
  if (data.profile.phone) lines.push(`Phone: ${data.profile.phone}`);
  if (data.profile.address) lines.push(`Address: ${data.profile.address}`);
  if (data.profile.priority) lines.push(`Priority: ${data.profile.priority}`);
  lines.push("");

  const activeTypes = data.contracts.active.map((c) => c.caseType).join(", ");
  lines.push(`Active Contracts: ${activeTypes || "None"}`);
  lines.push("");

  for (const [boardKey, items] of Object.entries(data.boardItems)) {
    if (items.length === 0) continue;
    lines.push(`${BOARD_DISPLAY_NAMES[boardKey] ?? boardKey}: ${items.length} item(s)`);
    for (const item of items) {
      lines.push(`  - ${item.name} [${item.status ?? "No status"}]`);
    }
  }

  if (data.appointments.length > 0) {
    lines.push("");
    lines.push(`Appointments: ${data.appointments.length}`);
  }

  return lines.join("\n");
}

export function ActionButtons({ data, onViewRelations }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = generateSummaryText(data);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <button onClick={handleCopy} className="action-btn" title="Copy client summary to clipboard">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {copied ? (
            <path d="M20 6L9 17l-5-5" />
          ) : (
            <>
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </>
          )}
        </svg>
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>

      <button className="action-btn" disabled title="Coming soon">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span>Generate Doc</span>
      </button>

      <button className="action-btn" disabled title="Coming soon">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        <span>Monday</span>
      </button>

      <button onClick={onViewRelations} className="action-btn" title="View item relationships">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        <span>Relations</span>
      </button>
    </div>
  );
}
