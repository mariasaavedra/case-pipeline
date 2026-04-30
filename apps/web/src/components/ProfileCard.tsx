import type { ProfileSummary } from "../api";
import { formatANumber } from "@case-pipeline/core";

const PRIORITY_STYLES: Record<string, { dot: string; label: string; bg: string; text: string }> = {
  Urgent: { dot: "priority-dot-urgent", label: "Urgent", bg: "#fef2f2", text: "#991b1b" },
  High: { dot: "priority-dot-high", label: "High", bg: "#fff7ed", text: "#9a3412" },
  Medium: { dot: "priority-dot-medium", label: "Medium", bg: "#fffbeb", text: "#92400e" },
  Low: { dot: "priority-dot-low", label: "Low", bg: "#f0fdf4", text: "#166534" },
};

function getInitials(name: string): string {
  const parts = name.replace(/\(.*\)/, "").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

export function ProfileCard({ profile }: { profile: ProfileSummary }) {
  const priority = profile.priority ? PRIORITY_STYLES[profile.priority] : null;
  const initials = getInitials(profile.name);

  return (
    <div className="card card-elevated overflow-hidden animate-in">
      {/* Accent strip */}
      <div className="h-1" style={{ backgroundColor: "var(--color-amber)" }} />

      <div className="p-6">
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: "var(--color-navy)",
              color: "#fff",
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {initials}
          </div>

          <div className="flex-1 min-w-0">
            {/* Name + priority */}
            <div className="flex items-center gap-3 mb-1">
              <h2
                className="text-2xl font-semibold tracking-tight truncate"
                style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}
              >
                {profile.name}
              </h2>
              {priority && (
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium flex-shrink-0"
                  style={{ backgroundColor: priority.bg, color: priority.text }}
                >
                  <span className={`priority-dot ${priority.dot}`} />
                  {priority.label}
                </span>
              )}
            </div>

            {/* Contact details */}
            <div className="flex flex-wrap gap-x-6 gap-y-1.5 mt-3">
              {profile.email && (
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M22 7l-10 6L2 7" />
                  </svg>
                  <span className="text-sm" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>
                    {profile.email}
                  </span>
                </div>
              )}
              {profile.phone && (
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                  </svg>
                  <span
                    className="text-sm"
                    style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}
                  >
                    {profile.phone}
                  </span>
                </div>
              )}
              {profile.address && (
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span className="text-sm" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>
                    {profile.address}
                  </span>
                </div>
              )}
            </div>

            {/* Additional details */}
            <div className="flex flex-wrap gap-x-6 gap-y-1.5 mt-2">
              {profile.dateOfBirth && (
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                  <span className="text-sm" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>
                    DOB: {profile.dateOfBirth}
                  </span>
                </div>
              )}
              {profile.placeOfBirth && (
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                  </svg>
                  <span className="text-sm" style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>
                    {profile.placeOfBirth}
                  </span>
                </div>
              )}
              {profile.aNumber && (
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5">
                    <path d="M4 7V4h16v3M9 20h6M12 4v16" />
                  </svg>
                  <span
                    className="text-sm"
                    style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}
                  >
                    {formatANumber(profile.aNumber)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
