// =============================================================================
// "Consult ready" — the Slack message reception sends the attorney (M18 step 2)
// =============================================================================
// Reception used to post this by hand at the consult's time:
//
//   *LB's 1:00 PM Ready*
//   No Intr Needed
//   <https://us06web.zoom.us/j/…|Zoom>
//   <@U057V5Y497A>
//
// M18 now drafts it from the saved prep (interpreter, how to proceed) and the
// attorney's Slack member id on the staff roster, and queues it for the
// consult's time (slack-queue.ts). Reception can edit the words and the time
// before it goes, in M18 or on P17's Slack Queue tab.
//
// Content rule (sms-and-slack.md): no phone numbers — a phone consult says
// "Phone call". A Zoom link is fine; it is what the attorney clicks.
// =============================================================================

import { FIRM_TIMEZONE } from "@case-pipeline/core";
import { slackEscape, slackLink } from "./slack.js";

export interface ConsultReadyInput {
  /** The attorney's board badge ("LB"). */
  badge: string;
  /** "HH:MM", 24 h, firm time; null = no time on the appointment. */
  time: string | null;
  interpreter: { need: string; language?: string | null } | null;
  method: string | null;
  zoomLink?: string | null;
  methodOther?: string | null;
  attorneyName: string | null;
  /** Slack member id (U…) from the staff roster, else null (the name is written instead). */
  attorneySlackId: string | null;
}

/** "13:00" → "1:00 PM". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h ?? 0;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(m ?? 0).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export function interpreterLine(i: ConsultReadyInput["interpreter"]): string | null {
  if (!i) return null;
  if (i.need === "No") return "No Intr Needed";
  if (i.need === "Spanish" || i.need === "Portuguese") return `${i.need} Intr Needed`;
  return `${slackEscape(i.language?.trim() || "Other language")} Intr — client brings their own`;
}

export function methodLine(e: Pick<ConsultReadyInput, "method" | "zoomLink" | "methodOther">): string | null {
  if (e.method === "Zoom") return e.zoomLink ? slackLink(e.zoomLink, "Zoom") : "Zoom";
  if (e.method === "Phone") return "Phone call";
  if (e.method === "Other") return e.methodOther?.trim() ? slackEscape(e.methodOther.trim()) : null;
  return null;
}

export function consultReadyText(e: ConsultReadyInput): string {
  const when = e.time ? `${clock12(e.time)} ` : "";
  const lines = [
    `*${slackEscape(e.badge)}'s ${when}Ready*`,
    interpreterLine(e.interpreter),
    methodLine(e),
    e.attorneySlackId ? `<@${e.attorneySlackId}>` : e.attorneyName ? slackEscape(e.attorneyName) : null,
  ];
  return lines.filter((l): l is string => !!l).join("\n");
}

// -----------------------------------------------------------------------------
// Firm time ↔ UTC. The queue stores UTC; people type Central wall-clock times.
// -----------------------------------------------------------------------------

/** How far `tz` is ahead of UTC at instant `d`, in ms (negative in the US). */
function tzOffsetMs(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - d.getTime();
}

/** "2026-10-21" + "13:00" in the firm's timezone → ISO UTC. */
export function firmTimeToUtc(date: string, time: string, tz: string = FIRM_TIMEZONE): string {
  const wall = Date.parse(`${date}T${time}:00Z`);
  // Twice: the first guess can sit on the other side of a DST change.
  let t = wall - tzOffsetMs(new Date(wall), tz);
  t = wall - tzOffsetMs(new Date(t), tz);
  return new Date(t).toISOString();
}

/** ISO UTC → { date, time } on the firm's wall clock. */
export function utcToFirmTime(iso: string, tz: string = FIRM_TIMEZONE): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-CA", { timeZone: tz }),
    time: d.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

export const CONSULT_READY_TEXT_MAX = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A queued message's words + when (firm time), as typed in M18 or the Slack Queue tab. */
export function parseQueueInput(
  raw: unknown,
  opts: { partial?: boolean } = {},
): { ok: true; text?: string; sendAt?: string } | { ok: false; error: string } {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: { text?: string; sendAt?: string } = {};
  if (o.text !== undefined || !opts.partial) {
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) return { ok: false, error: "The message is empty." };
    if (text.length > CONSULT_READY_TEXT_MAX) return { ok: false, error: `Keep the message under ${CONSULT_READY_TEXT_MAX} characters.` };
    out.text = text;
  }
  if (o.sendDate !== undefined || o.sendTime !== undefined || !opts.partial) {
    const date = typeof o.sendDate === "string" ? o.sendDate : "";
    const time = typeof o.sendTime === "string" ? o.sendTime : "";
    if (!DATE_RE.test(date) || !TIME_RE.test(time)) return { ok: false, error: "Pick the day and time to send it." };
    out.sendAt = firmTimeToUtc(date, time);
  }
  return { ok: true, ...out };
}
