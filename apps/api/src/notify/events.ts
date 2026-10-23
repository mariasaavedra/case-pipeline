// =============================================================================
// Workflow events → the Slack events channel: the message for each, as pure
// functions (tested in events.test.ts). Routes call these, then notifyEvent.
//
// Content rule (docs/features/sms-and-slack.md): who, which client, what kind of
// case, a link. Never A#, date of birth, receipt numbers, phone numbers, note or
// text bodies — Slack is a chat tool, not the case file.
// =============================================================================

import { slackEscape, withLink } from "./slack.js";

const who = (by: string | null | undefined) => (by?.trim() ? ` — ${slackEscape(by.trim())}` : "");
const caseTypes = (types: string[]) => (types.length ? ` (${slackEscape(types.join(", "))})` : "");

/** Only the steps staff care to hear about; the others are internal hand-offs. */
const CONTRACT_STEP_TEXT: Partial<Record<string, string>> = {
  client_signed: ":writing_hand: *{client}* signed their contract{types}",
  payment_link_sent: ":money_with_wings: Payment link sent to *{client}*{types}",
};

export function contractStepEvent(e: {
  step: string; clientName: string; contractFor: string[]; by?: string | null; link: string | null;
}): string | null {
  const t = CONTRACT_STEP_TEXT[e.step];
  if (!t) return null;
  const text = t.replace("{client}", slackEscape(e.clientName)).replace("{types}", caseTypes(e.contractFor)) + who(e.by);
  return withLink(text, e.link, "Fee K");
}

export function consultPrepEvent(e: {
  clientName: string; attorney: string | null; date: string | null; time: string | null; by?: string | null; link: string | null;
}): string {
  const when = [e.date, e.time].filter(Boolean).join(" ");
  const text =
    `:clipboard: Consult prepped: *${slackEscape(e.clientName)}*` +
    (e.attorney ? ` with ${slackEscape(e.attorney)}` : "") +
    (when ? `, ${slackEscape(when)}` : "") +
    who(e.by);
  return withLink(text, e.link, "Monday");
}

/** A piece of mail filed from the Mail page (P12 → M31). */
export function mailFiledEvent(e: { clientName: string; noticeType: string | null; emailed: boolean; by?: string | null; link: string | null }): string {
  const text =
    `:envelope: Mail filed for *${slackEscape(e.clientName)}*` +
    (e.noticeType ? ` (${slackEscape(e.noticeType)})` : "") +
    (e.emailed ? ", client e-mailed" : "") +
    who(e.by);
  return withLink(text, e.link, "Monday");
}

const SMS_CONTEXT_TEXT: Record<string, string> = {
  call_log: "after a call",
  payment_links: "payment links",
  client: "from the client page",
  upload_link: "upload link",
};

export function smsSentEvent(e: {
  clientName: string | null; templateLabel: string | null; context: string; by?: string | null; link: string | null;
}): string {
  const what = e.templateLabel ? slackEscape(e.templateLabel) : SMS_CONTEXT_TEXT[e.context] ?? "text";
  const text = `:speech_balloon: Text sent to *${slackEscape(e.clientName ?? "an unlinked caller")}* (${what})` + who(e.by);
  return withLink(text, e.clientName ? e.link : null, "Monday");
}

/** Never the file names or notes: clients name files after themselves and their case. */
export function clientUploadEvent(e: { clientName: string | null; files: number; kinds: string; where: string; link: string | null }): string {
  const text =
    `:inbox_tray: *${slackEscape(e.clientName ?? "A client")}* sent ${e.files === 1 ? "1 document" : `${e.files} documents`}` +
    ` (${slackEscape(e.kinds)}) — filed in their ${slackEscape(e.where)} → CAF`;
  return withLink(text, e.link, "Monday");
}
