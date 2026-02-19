import type { ProfileSummary, ClientCaseSummary } from "../api";
import { ActionButtons } from "./ActionButtons";

const PRIORITY_DOT: Record<string, string> = {
  Urgent: "priority-dot-urgent",
  High: "priority-dot-high",
  Medium: "priority-dot-medium",
  Low: "priority-dot-low",
};

function getInitials(name: string): string {
  const parts = name.replace(/\(.*\)/, "").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

interface Props {
  profile: ProfileSummary;
  data: ClientCaseSummary;
  onViewRelations: () => void;
}

export function ClientHeaderSticky({ profile, data, onViewRelations }: Props) {
  return (
    <div className="client-header-sticky">
      <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center gap-4">
        {/* Left: Avatar + Name + ID + Priority */}
        <div className="flex items-center gap-3 min-w-0 flex-shrink">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: "var(--color-navy)",
              color: "#fff",
              fontFamily: "var(--font-display)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {getInitials(profile.name)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2
                className="text-base font-semibold tracking-tight truncate"
                style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
              >
                {profile.name}
              </h2>
              {profile.priority && PRIORITY_DOT[profile.priority] && (
                <span className={`priority-dot ${PRIORITY_DOT[profile.priority]} flex-shrink-0`} />
              )}
            </div>
            <span
              className="text-[11px]"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}
            >
              {profile.localId}
            </span>
          </div>
        </div>

        {/* Center: Contact */}
        <div className="flex items-center gap-4 flex-shrink-0 ml-auto mr-4">
          {profile.email && (
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M22 7l-10 6L2 7" />
              </svg>
              <span className="text-xs" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>
                {profile.email}
              </span>
            </div>
          )}
          {profile.phone && (
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
              </svg>
              <span
                className="text-xs"
                style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}
              >
                {profile.phone}
              </span>
            </div>
          )}
        </div>

        {/* Right: Action Buttons */}
        <ActionButtons data={data} onViewRelations={onViewRelations} />
      </div>
    </div>
  );
}
