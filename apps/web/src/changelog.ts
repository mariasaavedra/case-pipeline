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
    date: "2026-10-02",
    title: "Arrange the sidebar your way",
    items: [
      "Click Customize at the bottom of the sidebar, then drag pages by the dotted handle to put them in the order you like, or click the eye to hide a page you don't use.",
      "Click Done to save. Your layout follows you to any computer you sign in on, and doesn't change anyone else's. Reset puts everything back.",
    ],
  },
  {
    date: "2026-09-29",
    title: "Dropdowns on the last row open fully",
    items: [
      "On the Call Log, the Status and Highlighted For dropdowns on the bottom rows were cut off. They now open upward when there's no room below, so every option is visible.",
    ],
  },
  {
    date: "2026-09-29",
    title: "Settings, reorganized",
    items: [
      "Settings now has four tabs on the left: My account, Preferences, and, for admins, Firm setup and Admin. Each tab has its own link, so you can send someone straight to it.",
      "Language moved from My account to Preferences, next to the start page.",
      "The audit log (Admin tab) reads in plain English, such as “Changed status to Received · Ana Ruiz”. You can filter it by what happened, who did it and dates, it's grouped by day, and a client's name opens their page.",
      "Settings codes changed to match the tabs: Users is now P11.4.1 and the audit log P11.4.3. The UI map lists every old code next to its new one.",
    ],
  },
  {
    date: "2026-09-28",
    title: "Mail reads the whole notice, and you can correct it",
    items: [
      "Each scanned notice now shows everything read from it: notice type, case type, receipt number, received, priority and notice dates, petitioner, beneficiary or applicant, A-number, date of birth and section.",
      "Matching uses those too. A notice with no A-number (common for a first I-130) is matched by the beneficiary's or applicant's name. If the names don't fit the client the A-number or receipt points to, it's flagged for review instead of matched. When a client has two Open Forms of the same type, the received or priority date picks the right one.",
      "In the review popup, Edit lets you fix anything that was misread. Saving re-matches the notice straight away, and each corrected field still shows what was originally read.",
    ],
  },
  {
    date: "2026-09-28",
    title: "Mail: scan notices and match them to cases (trial)",
    items: [
      "New Mail page in the sidebar. Drop in a scanned PDF — one notice or a whole day's mail in one file — and each notice is matched to the client's Open Form by its receipt number or A-number.",
      "Plain scans work too: pages without text are read automatically. A notice read that way shows how sure the reading is, like OCR 93%.",
      "Notices that can't be matched to exactly one Open Form go to Alerts under \"Mail to review\". Open one to see the page next to the possible cases, then assign it or dismiss it with a note.",
      "Assigning a notice updates its Open Form in Monday.com: the receipt number is filled in (never overwritten if a different one is already there), Receipt Status is set to Received, and the notice is attached. The popup shows exactly what will change before you press Assign. Matched notices on the Mail page have a \"Confirm & send\" button for the same step.",
      "Notices from the sample buttons are never sent to Monday.com.",
    ],
  },
  {
    date: "2026-09-28",
    title: "Codes everywhere, and a switch to hide them",
    items: [
      "Appointments, Active Cases, My Cases, Calendar, Alerts, Jail Intakes and Call Log now show a code on each part of the page, like P10.1 for the Call Log filters.",
      "Every dropdown list carries one too, and the sidebar and top bar are G1 and G2.",
      "Don't want to see them? Settings → Preferences → Show screen codes turns them all off. The setting follows you to any computer you sign in on.",
    ],
  },
  {
    date: "2026-09-28",
    title: "Sections have codes as well",
    items: [
      "Parts of a page now carry their own code: each Settings section next to its title (Users is P11.9), and on Home and Clients a small code above each block, such as P2.3 for the filters.",
    ],
  },
  {
    date: "2026-09-28",
    title: "Pages and menus have codes too",
    items: [
      "Every page now shows its code in the bottom-right corner of the window, like P4 for Appointments. On a client's page it changes with the tab: P3.2 is their Appointments tab.",
      "Small menus, such as a status picker, show theirs on the last line of the menu, like D6.",
    ],
  },
  {
    date: "2026-09-28",
    title: "Every popup has a short code",
    items: [
      "Each popup now shows a small grey code under its close button, like M5. Put that code in a change request so everyone knows exactly which popup you mean.",
    ],
  },
  {
    date: "2026-09-28",
    title: "A client's profile while you log a call",
    items: [
      "In Log a call, the link under a client's recent notes now reads \"View profile\".",
      "The popup it opens starts with the same header as the client's full page: contact details, date and place of birth, A-number, the Monday.com link and the watchlist star.",
    ],
  },
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
