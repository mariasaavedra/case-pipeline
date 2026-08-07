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
    date: "2026-08-07",
    title: "New filters on a client's timeline",
    items: [
      "The seven filter buttons above a client's timeline are now two: All and Notes. Notes means everything that isn't an email — including notes written on a document or against an appointment, which the old Notes button was hiding.",
      "The \"Last 30 days\" toggle became a proper period: All time, 30 days, 90 days, 12 months, plus a date range for a specific stretch like a past month.",
      "On clients with a lot of email, picking an older period used to come back empty even when entries existed. It now looks at the whole history, not just the most recent page.",
      "More filters will be added over time — this is the foundation, not the finished set.",
    ],
  },
  {
    date: "2026-08-07",
    title: "Notes and status changes reach Monday again",
    items: [
      "If you connected your Monday account before August 4th, your status changes were not actually reaching Monday — the dashboard showed them as saved and then quietly put them back a while later. Notes were affected for anyone who connected on June 30th. This is fixed: the change now goes through either way.",
      "When your Monday connection is out of date, the change is saved under the firm's shared account instead of your name, and Settings turns amber asking you to reconnect. Reconnecting takes one click and restores your name on future changes.",
      "Changes that were lost over the past days were not recovered — they have to be redone. Anything you change from now on lands.",
      "Admins: Sync Health now shows why a write-back failed, not just how many did.",
    ],
  },
  {
    date: "2026-08-06",
    title: "Monday changes now show up in about a minute",
    items: [
      "The dashboard used to refresh on a timer, so a change made in Monday could take up to two hours to appear. Monday now tells us the moment something changes, and the dashboard catches up within about a minute.",
      "Deleted items disappear right away instead of waiting for the overnight sweep — and they are still archived first, so nothing is lost.",
      "New notes appear almost immediately, and editing a note in Monday now updates the text here too.",
      "The scheduled refreshes still run in the background as a safety net.",
    ],
  },
  {
    date: "2026-08-05",
    title: "Nothing can be silently deleted, and you can check",
    items: [
      "When the overnight sweep sees an item is gone from Monday, it files a full copy in an archive before removing it — every removal is recoverable in one click.",
      "It only removes anything when Monday confirms the whole board was read. If a board comes back short, everything is kept.",
      "A new Sync Health screen (admins) shows, board by board, that the data is complete.",
    ],
  },
  {
    date: "2026-08-04",
    title: "Edit case fields and create contracts, in place",
    items: [
      "Items under Active Cases expand with a click so you can change a status, date, amount, or text right there — it writes straight to Monday.com under your account.",
      "Contracts can be created from a client's page without leaving the dashboard.",
      "Only fields you can actually change are shown; calculated and mirrored fields are left out on purpose.",
    ],
  },
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
