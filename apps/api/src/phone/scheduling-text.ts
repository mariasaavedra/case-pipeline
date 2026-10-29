// =============================================================================
// IVR "press 1" → the scheduling link by text (docs/features/phone-ivr.md)
// =============================================================================
// A caller who presses 1 is connected to an announcement-only extension
// (RC_SCHEDULING_EXTENSION) that tells them a text is on its way; the call
// event (call-events.ts) brings us here with their number. The words are the
// `ivr_scheduling_link` SMS template (Settings → Firm), the link written into
// it — so staff change the link without a deploy.
//
// The same steps as the Buzón's texts (buzon/text.ts): RingCentral or a dry
// run (seed data is always a dry run), sms_messages, the audit log with the
// last 4 digits only, and — when the number is exactly one client's — that
// client's language and an E&A "Text message" entry on their profile (queued on
// an outage). Not a client: Spanish, the firm's default. Every call is a row in
// job_runs (Settings → Workflows).
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { formatUsPhone, renderSmsTemplate, smsSegments, toUsE164 } from "@case-pipeline/core";
import { searchClients } from "@case-pipeline/query";
import { dataSource } from "../data-source/index.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { recordAudit } from "../audit/log.js";
import { recordSms, recentlySent } from "../sms/log.js";
import { ringCentral, RingCentralError } from "../sms/ringcentral.js";
import { loadSmsTemplates, withRequiredTemplates, DEFAULT_SMS_TEMPLATES } from "../sms/templates.js";
import { smsActivity } from "../sms/send-plan.js";
import { loadDocumentSettings } from "../documents/document-settings.js";
import { buzonClient, type BuzonClient } from "../buzon/client.js";
import { effectiveSmsMode, smsActivityTypeId } from "../buzon/text.js";
import { recordRun } from "../workflows/runs.js";
import { usersDb } from "../db/users-db.js";
import { reachedExtension, schedulingExtension, SeenCalls, type CallEvent } from "./call-events.js";

export const SCHEDULING_TEMPLATE_KEY = "ivr_scheduling_link";
export const IVR_JOB = "ivr_scheduling_text";

/** A caller who called again within this long gets no second text. */
const REPEAT_WINDOW_SECONDS = 10 * 60;

export interface SchedulingTextDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  /** Seed data: every text is a dry run (Faker's numbers can be real phones). */
  seed: boolean;
}

export interface SchedulingTextResult {
  status: "sent" | "dry_run" | "skipped" | "failed";
  reason?: string;
}

/** The one client this number belongs to, else null (none, or more than one). */
export function clientForNumber(db: DatabaseInstance, e164: string): BuzonClient | null {
  const matches = searchClients(db, e164.slice(-10));
  if (matches.length !== 1) return null;
  return buzonClient(db, matches[0]!.localId);
}

/** The words, filled in. Throws when a placeholder is left — the link not written into the template yet, say. */
export function schedulingTextBody(language: "es" | "en"): string {
  const t = withRequiredTemplates(loadSmsTemplates()).find((x) => x.key === SCHEDULING_TEMPLATE_KEY)
    ?? DEFAULT_SMS_TEMPLATES.find((x) => x.key === SCHEDULING_TEMPLATE_KEY)!;
  const firm = loadDocumentSettings().firm;
  const text = (language === "en" ? t.en : t.es) || t.es || t.en;
  const { body, missing } = renderSmsTemplate(text, { firmName: firm.name, firmPhone: formatUsPhone(firm.phone) });
  if (missing.length) throw new Error(`the "${t.label}" text needs ${missing.map((m) => `{{${m}}}`).join(", ")}`);
  return body;
}

/** Text the scheduling link to `rawNumber` (the caller, as RingCentral sent it). */
export async function sendSchedulingText(deps: SchedulingTextDeps, rawNumber: string | null): Promise<SchedulingTextResult> {
  const mode = effectiveSmsMode(deps.seed);
  if (mode === "off") return { status: "failed", reason: "texting is off on this server (SMS_MODE)" };
  const phone = rawNumber ? toUsE164(rawNumber) : null;
  if (!phone) return { status: "skipped", reason: rawNumber ? "not a US number" : "the caller's number is hidden" };

  const client = clientForNumber(deps.db, phone);
  const language = client?.language ?? "es";
  let body: string;
  try {
    body = schedulingTextBody(language);
  } catch (err) {
    return { status: "failed", reason: (err as Error).message };
  }
  if (recentlySent(phone, body, REPEAT_WINDOW_SECONDS)) return { status: "skipped", reason: "already texted this number in the last 10 minutes" };

  const log = (rcId: string | null, status: string, error: string | null) =>
    recordSms({
      userId: null, toNumber: phone, body, templateKey: SCHEDULING_TEMPLATE_KEY, language,
      context: "ivr", profileLocalId: client?.localId ?? null, profileMondayId: client?.mondayId ?? null,
      mode: mode === "on" ? "on" : "dry-run", rcMessageId: rcId, status, error,
    });
  const audit = (action: string, extra: Record<string, unknown>) =>
    recordAudit({
      actor: { userId: null, email: "ivr" },
      action,
      targetType: client?.mondayId ? "profile" : null, targetId: client?.localId ?? null, targetMondayId: client?.mondayId ?? null,
      metadata: { context: "ivr", templateKey: SCHEDULING_TEMPLATE_KEY, language, toLast4: phone.slice(-4), segments: smsSegments(body).segments, mode, auto: true, ...extra },
    });

  if (mode === "dry-run") {
    console.log(`[ivr] DRY RUN — would text …${phone.slice(-4)} the scheduling link (${language})`);
    log(null, "DryRun", null);
    audit("sms.sent", {});
    return { status: "dry_run" };
  }

  const rc = ringCentral();
  if (!rc) return { status: "failed", reason: "RingCentral is not configured on the server" };
  try {
    const sent = await rc.sendSms(phone, body);
    log(sent.id, sent.status, null);
  } catch (err) {
    const message = err instanceof RingCentralError ? err.message : (err as Error).message;
    log(null, "Failed", message);
    audit("sms.failed", { error: message });
    return { status: "failed", reason: message };
  }
  if (client?.mondayId) {
    const entry = smsActivity({ to: phone, body }, client.mondayId, await smsActivityTypeId(deps.mondayApiToken));
    try {
      if (!deps.mondayApiToken) throw new Error("MONDAY_API_TOKEN is not set");
      await dataSource.createTimelineItem(entry, deps.mondayApiToken);
    } catch (err) {
      console.error("[ivr] text E&A entry failed; queueing:", err);
      enqueueWrite(deps.db, {
        opType: "create_timeline_item", targetTable: "profiles", targetLocalId: client.localId,
        mondayItemId: client.mondayId, authorOid: null, payload: { ...entry },
      });
    }
  }
  audit("sms.sent", {});
  return { status: "sent" };
}

// --- The listener on call events ------------------------------------------------

/**
 * The extension's RingCentral id, looked up once from its number (needs the
 * app's ReadAccounts permission, which the SMS setup check already asks for).
 * Unknown (RingCentral not configured, lookup failed) = match by number only.
 */
let extensionIdCache: { number: string; id: string | null; at: number } | null = null;
async function extensionId(number: string): Promise<string | null> {
  if (extensionIdCache?.number === number && (extensionIdCache.id || Date.now() - extensionIdCache.at < 10 * 60_000)) {
    return extensionIdCache.id;
  }
  let id: string | null = null;
  try {
    const rc = ringCentral();
    if (rc) {
      const r = await rc.getJson<{ records?: { id?: number | string }[] }>(
        `/restapi/v1.0/account/~/extension?extensionNumber=${encodeURIComponent(number)}`,
      );
      id = r.records?.[0]?.id != null ? String(r.records[0].id) : null;
    }
  } catch (err) {
    console.error(`[ivr] could not look up extension ${number}; matching by number only:`, err);
  }
  extensionIdCache = { number, id, at: Date.now() };
  return id;
}

/** The call-event listener: a call that reached the scheduling extension → one text. */
export function schedulingTextListener(deps: SchedulingTextDeps): (event: CallEvent) => Promise<void> {
  const seen = new SeenCalls();
  return async (event) => {
    const number = schedulingExtension();
    if (!number) return;
    if (!reachedExtension(event, { id: await extensionId(number), number })) return;
    if (!seen.first(event.telephonySessionId)) return;

    const startedAt = new Date();
    const result = await sendSchedulingText(deps, event.callerNumber);
    const last4 = event.callerNumber ? `…${event.callerNumber.slice(-4)}` : "hidden number";
    const summary = `${last4}: ${result.status.replace("_", " ")}${result.reason ? ` — ${result.reason}` : ""}`;
    console.log(`[ivr] scheduling link ${summary}`);
    recordRun(usersDb, IVR_JOB, startedAt, result.status === "failed" ? { error: summary } : { summary });
  };
}
