import { useState } from "react";
import type { ClientCaseSummary, ProfileSummary } from "../api";
import { GenerateDocModal } from "./GenerateDocModal";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { mondayItemUrl, MONDAY_PROFILES_BOARD_ID } from "../config";
import { boardDisplayName } from "@case-pipeline/query/types";
import { collectClientFolders } from "../sharepoint/collectFolders";

// P3.0's ⋯ menu (D37): every header action except Watch, which stays a button
// beside it. Open in DMS only when the profile has a DMS link (cases up to the
// end of 2024); Open e-file only when there is an e-file (or closed e-file)
// folder link, Open consult folder only when there is a consult folder link.
// The M3 popup header passes no `data`, so it gets just the links.

interface Props {
  profile: ProfileSummary;
  /** The full 360 data — Copy summary / Generate Doc need it. */
  data?: ClientCaseSummary;
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
    lines.push(`${boardDisplayName(boardKey)}: ${items.length} item(s)`);
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

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // No clipboard API, or the page lacks focus/permission — use the old way.
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

/**
 * DMS won't load inside the dashboard (it sends X-Frame-Options: SAMEORIGIN and
 * needs its own login), so it opens in a separate window. One named window for
 * every client: the next "Open in DMS" replaces it instead of piling up windows.
 */
function openDms(url: string) {
  // No `noopener` feature: with it the browser may skip reusing the named window.
  // Cut the link back to the dashboard by hand instead.
  const w = window.open(url, "dms", "popup,width=1200,height=900");
  if (w) {
    w.opener = null;
    w.focus();
  }
}

const menuItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px",
  borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", textDecoration: "none",
  fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink)",
};

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: "var(--color-ink-muted)" }}>
    {children}
  </svg>
);

const ExternalIcon = () => (
  <Icon>
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </Icon>
);

export function ActionButtons({ profile, data }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const handleCopy = async () => {
    if (!data) return;
    await copyText(generateSummaryText(data));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // The live e-file first (the profile's own link leads the list), then a closed
  // one (SCALClosed). The consult folder is its own item: the profile's Consult
  // File first, then one mirrored from a board item or appointment. Repeats are
  // labelled "e-file (2)" / "Consult (2)".
  const folders = collectClientFolders(data ?? { profile });
  const eFile = folders.find((f) => f.label.startsWith("e-file")) ?? folders.find((f) => f.label.startsWith("Archived")) ?? null;
  const consult = folders.find((f) => f.label.startsWith("Consult")) ?? null;

  const hasLinks = !!profile.dmsUrl || !!profile.mondayItemId || !!eFile || !!consult;
  if (!hasLinks && !data) return null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="action-btn"
          title={copied ? "Client summary copied" : "More actions"}
          aria-label="More actions"
        >
          {copied ? (
            <>
              <Icon><path d="M20 6L9 17l-5-5" /></Icon>
              <span>Copied</span>
            </>
          ) : (
            <span style={{ fontSize: 15, lineHeight: 1, padding: "0 2px" }}>⋯</span>
          )}
        </PopoverTrigger>
        <PopoverContent code="D37" align="end" sideOffset={6} className="w-60 p-1">
          <div role="menu">
            {profile.dmsUrl && (
              <button type="button" role="menuitem" className="status-menu-item" style={menuItemStyle} onClick={pick(() => openDms(profile.dmsUrl!))}>
                <ExternalIcon />
                Open in DMS
              </button>
            )}
            {profile.mondayItemId && (
              <a
                role="menuitem"
                className="status-menu-item"
                style={menuItemStyle}
                href={mondayItemUrl(MONDAY_PROFILES_BOARD_ID, profile.mondayItemId)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <ExternalIcon />
                Open in Monday.com
              </a>
            )}
            {eFile && (
              <a
                role="menuitem"
                className="status-menu-item"
                style={menuItemStyle}
                href={eFile.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <ExternalIcon />
                {eFile.label.startsWith("Archived") ? "Open closed e-file in SharePoint" : "Open e-file in SharePoint"}
              </a>
            )}
            {consult && (
              <a
                role="menuitem"
                className="status-menu-item"
                style={menuItemStyle}
                href={consult.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <ExternalIcon />
                Open consult folder in SharePoint
              </a>
            )}
            {data && (
              <>
                {hasLinks && <div style={{ height: 1, margin: "4px 6px", background: "var(--color-border-light)" }} />}
                <button type="button" role="menuitem" className="status-menu-item" style={menuItemStyle} onClick={pick(handleCopy)}>
                  <Icon>
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </Icon>
                  Copy client summary
                </button>
                <button type="button" role="menuitem" className="status-menu-item" style={menuItemStyle} onClick={pick(() => setGenerateOpen(true))}>
                  <Icon>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </Icon>
                  Generate document…
                </button>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {generateOpen && data && <GenerateDocModal data={data} onClose={() => setGenerateOpen(false)} />}
    </>
  );
}
