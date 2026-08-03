// =============================================================================
// Changelog — user-facing "what's new", newest first
// =============================================================================
// Plain-language entries shown when the version badge is clicked. Add a new
// block at the top when shipping something users would notice. Keep it short
// and non-technical; this is for the firm, not for developers.
// =============================================================================

export interface ChangelogEntry {
  date: string; // YYYY-MM-DD
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-07-30",
    title: "Edit statuses from the dashboard",
    items: [
      "Change a case's status without leaving the dashboard — it writes straight to Monday.com.",
      "Status choices are limited to each board's real labels and shown in their actual Monday colors.",
      "Admins get a Debug tab on each client to review and change every board entry's status.",
      "New version stamp (shown here) so we always know which build is running.",
    ],
  },
  {
    date: "2026-07-30",
    title: "Attachments & links on notes",
    items: [
      "Files attached to a note now appear as clickable chips that open in Monday.com.",
      "Web links inside notes and emails are now clickable instead of plain text.",
    ],
  },
  {
    date: "2026-07-29",
    title: "Timeline fixes",
    items: [
      "Fixed notes that were showing up several times — duplicates are collapsed and can't recur.",
      "Activities now load in full when you filter for them (they were being cut off before).",
    ],
  },
];
