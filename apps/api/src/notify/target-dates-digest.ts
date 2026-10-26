// =============================================================================
// Target dates digest — weekdays 8 AM, a Slack DM to each admin
// =============================================================================
// The target date is the admin's internal goal for an Open Form; this tells
// them each morning which ones are overdue or due within 7 days, per
// paralegal, so they can nudge the paralegal or get an extension from the
// attorney. Counts first, then the cases (client — forms · when), capped per
// section, and a link to P24.
//
// Recipients: active admins whose staff roster entry has a Slack member id
// (Settings → Staff). On/off: Settings → Integrations → "Target dates
// digest"; SLACK_MODE applies as for every post. Scheduled in server.ts
// (TARGET_DATES_DIGEST_CRON, default "0 8 * * 1-5", firm time, live data).
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import type { TargetDateCase, TargetDatesResult } from "@case-pipeline/query";
import { slackEscape, slackLink, appUrl, dmEvent, slackEventStatus, SLACK_USER_ID_RE } from "./slack.js";
import { getTargetDatesView } from "../routes/target-dates.js";

/** Cases listed per section; the rest are a count. */
export const DIGEST_MAX_LINES = 20;

const NO_PARALEGAL = "No paralegal";

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function weekday(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function when(c: Pick<TargetDateCase, "daysLeft" | "targetDate">): string {
  const d = c.daysLeft ?? 0;
  const date = c.targetDate ? ` (${shortDate(c.targetDate)})` : "";
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} late${date}`;
  if (d === 0) return `due today${date}`;
  if (d === 1) return `due tomorrow${date}`;
  return `in ${d} days${date}`;
}

function line(c: TargetDateCase): string {
  const what = c.forms.length > 0 ? c.forms.join(", ") : c.formName;
  const moved = c.moves > 0 ? ` · moved ${c.moves}×` : "";
  return `• ${slackEscape(c.clientName)} — ${slackEscape(what)} · ${when(c)}${moved}`;
}

/** One section: cases grouped by paralegal (a shared case under each), capped. */
function section(title: string, cases: TargetDateCase[]): string[] {
  if (cases.length === 0) return [];
  const byPerson = new Map<string, TargetDateCase[]>();
  for (const c of cases) {
    for (const p of c.assignees.length > 0 ? c.assignees : [NO_PARALEGAL]) {
      byPerson.set(p, [...(byPerson.get(p) ?? []), c]);
    }
  }
  const people = [...byPerson.keys()].sort((a, b) =>
    a === NO_PARALEGAL ? 1 : b === NO_PARALEGAL ? -1 : a.localeCompare(b));
  const out = [`*${title} (${cases.length})*`];
  let shown = 0;
  for (const p of people) {
    if (shown >= DIGEST_MAX_LINES) break;
    out.push(`_${slackEscape(p)}_`);
    for (const c of byPerson.get(p)!) {
      if (shown >= DIGEST_MAX_LINES) break;
      out.push(line(c));
      shown++;
    }
  }
  const lines = [...byPerson.values()].reduce((n, l) => n + l.length, 0);
  if (lines > shown) out.push(`…and ${lines - shown} more`);
  return out;
}

export function buildTargetDatesDigest(data: Pick<TargetDatesResult, "today" | "cases" | "counts">, link: string | null): string {
  const { counts } = data;
  const head = `:dart: *Target dates — ${weekday(data.today)}*`;
  const tally = [
    `${counts.overdue} overdue`,
    `${counts.week} due this week`,
    `${counts.twoWeeks} next week`,
    `${counts.none} with no date`,
  ].join(" · ");
  const body = [
    ...section("Overdue", data.cases.filter((c) => c.bucket === "overdue")),
    ...section("Due in the next 7 days", data.cases.filter((c) => c.bucket === "week")),
  ];
  const parts = [head, tally];
  if (body.length === 0) parts.push("Nothing overdue or due this week.");
  else parts.push("", ...body);
  if (link) parts.push("", slackLink(link, "Open Target Dates"));
  return parts.join("\n");
}

/** Slack member ids of the active admins (staff roster link). */
export function digestRecipients(usersDb: DatabaseInstance): string[] {
  try {
    const rows = usersDb
      .prepare(`SELECT s.slack_user_id AS id FROM users u JOIN staff s ON s.id = u.staff_id
                 WHERE u.role = 'admin' AND u.active = 1 AND s.slack_user_id IS NOT NULL`)
      .all() as { id: string }[];
    return [...new Set(rows.map((r) => r.id.trim()).filter((id) => SLACK_USER_ID_RE.test(id)))];
  } catch {
    return [];
  }
}

/** The scheduled run. Returns a count line for the Workflows screen; throws only on a failed send. */
export async function runTargetDatesDigest(db: DatabaseInstance, usersDb: DatabaseInstance): Promise<string> {
  const status = slackEventStatus("target_dates_digest");
  if (!status.enabled) return "turned off in Settings → Integrations — nothing sent";
  if (status.mode === "off") return "SLACK_MODE is off — nothing sent";
  const recipients = digestRecipients(usersDb);
  if (recipients.length === 0) return "no admin has a Slack id in the staff roster — nothing sent";
  const data = getTargetDatesView(db, usersDb);
  const text = buildTargetDatesDigest(data, appUrl("/target-dates"));
  const r = await dmEvent("target_dates_digest", recipients, text);
  if (r.sent === 0 && r.errors.length > 0) throw new Error(`target dates digest not sent: ${r.errors[0]}`);
  return `${data.counts.overdue} overdue, ${data.counts.week} due this week — sent to ${r.sent} of ${recipients.length}`;
}
