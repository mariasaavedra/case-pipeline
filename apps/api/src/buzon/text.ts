// =============================================================================
// Buzón — sending one of its texts (docs/features/buzon.md)
// =============================================================================
// The same steps as a staff text (routes/sms.ts): RingCentral (or a dry run;
// seed data is always a dry run), sms_messages, the E&A "Text message" entry on
// the profile (queued on an outage), the audit log with the last 4 digits only.
// Plus a buzon_texts row, which the reminders count. Only the words come from
// the Buzón templates (sms/templates.ts: buzon_link / buzon_reminder /
// buzon_received), in the client's language.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { renderSmsTemplate, smsSegments } from "@case-pipeline/core";
import { fetchCustomActivities } from "@case-pipeline/monday";
import { dataSource } from "../data-source/index.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { recordAudit } from "../audit/log.js";
import { recordSms, recentlySent } from "../sms/log.js";
import { ringCentral, smsMode, RingCentralError, type SmsMode } from "../sms/ringcentral.js";
import { loadSmsTemplates, withRequiredTemplates, DEFAULT_SMS_TEMPLATES } from "../sms/templates.js";
import { smsActivity } from "../sms/send-plan.js";
import { loadDocumentSettings } from "../documents/document-settings.js";
import { formatUsPhone } from "@case-pipeline/core";
import { CASENOTE_ACTIVITY_ID } from "../routes/detention-write.js";
import { SMS_ACTIVITY_NAME } from "../routes/sms.js";
import type { BuzonClient } from "./client.js";

export type BuzonTextKind = "link" | "reminder" | "received" | "remind_now";

export interface BuzonTextDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  /** Seed data: every text is a dry run (Faker's numbers can be real phones). */
  seed: boolean;
}

export interface BuzonTextResult {
  status: "sent" | "dry_run" | "failed";
  error?: string;
}

const TEMPLATE_FOR: Record<BuzonTextKind, string> = {
  link: "buzon_link",
  reminder: "buzon_reminder",
  remind_now: "buzon_reminder",
  received: "buzon_received",
};

export function effectiveSmsMode(seed: boolean): SmsMode {
  const m = smsMode();
  return m === "on" && seed ? "dry-run" : m;
}

let activityCache: { id: string; at: number } | null = null;
async function activityId(token: string | undefined): Promise<string> {
  if (activityCache && Date.now() - activityCache.at < 30 * 60_000) return activityCache.id;
  let id = CASENOTE_ACTIVITY_ID;
  try {
    for (const [actId, name] of await fetchCustomActivities(token)) {
      if (name.trim().toLowerCase() === SMS_ACTIVITY_NAME.toLowerCase()) id = actId;
    }
  } catch (err) {
    console.error("[buzon] could not list E&A activity types; using Casenote:", err);
  }
  activityCache = { id, at: Date.now() };
  return id;
}

/** The words, filled in. Throws when a placeholder is left (a broken template must not go out). */
export function buzonTextBody(kind: BuzonTextKind, client: BuzonClient, vars: Record<string, string>): string {
  const key = TEMPLATE_FOR[kind];
  const t = withRequiredTemplates(loadSmsTemplates()).find((x) => x.key === key) ?? DEFAULT_SMS_TEMPLATES.find((x) => x.key === key)!;
  const firm = loadDocumentSettings().firm;
  const text = (client.language === "es" ? t.es : t.en) || t.en || t.es;
  const { body, missing } = renderSmsTemplate(text, {
    firstName: client.firstName, firmName: firm.name, firmPhone: formatUsPhone(firm.phone), ...vars,
  });
  if (missing.length) throw new Error(`the "${t.label}" text needs ${missing.map((m) => `{{${m}}}`).join(", ")}`);
  return body;
}

/**
 * Send one Buzón text to `client.phone` (the caller checked autoTextBlocked).
 * `by` = the staff member for Remind now; null = the app on its own.
 */
export async function sendBuzonText(
  deps: BuzonTextDeps,
  input: { client: BuzonClient; kind: BuzonTextKind; vars: Record<string, string>; linkId: number | null; by?: { userId: number | null; name: string | null; email?: string | null } },
): Promise<BuzonTextResult> {
  const { db } = deps;
  const { client, kind, linkId } = input;
  const record = (status: BuzonTextResult["status"], error: string | null) => {
    db.prepare("INSERT INTO buzon_texts (profile_local_id, profile_monday_id, link_id, kind, status, error, by_name) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(client.localId, client.mondayId, linkId, kind, status, error, input.by?.name ?? null);
    return error ? { status, error } : { status };
  };
  const mode = effectiveSmsMode(deps.seed);
  if (mode === "off") return record("failed", "texting is off on this server (SMS_MODE)");
  if (!client.phone) return record("failed", "no US phone number on the profile");

  let body: string;
  try {
    body = buzonTextBody(kind, client, input.vars);
  } catch (err) {
    return record("failed", (err as Error).message);
  }
  if (recentlySent(client.phone, body)) return record("failed", "this exact text was just sent to this number");

  const templateKey = TEMPLATE_FOR[kind];
  const log = (rcId: string | null, status: string, error: string | null) =>
    recordSms({
      userId: input.by?.userId ?? null, toNumber: client.phone!, body, templateKey, language: client.language,
      context: "buzon", profileLocalId: client.localId, profileMondayId: client.mondayId,
      mode: mode === "on" ? "on" : "dry-run", rcMessageId: rcId, status, error,
    });
  const audit = (action: string, extra: Record<string, unknown>) =>
    recordAudit({
      actor: input.by ? { userId: input.by.userId, email: input.by.email ?? input.by.name ?? "staff" } : { userId: null, email: "buzon" },
      action,
      targetType: client.mondayId ? "profile" : null, targetId: client.localId, targetMondayId: client.mondayId,
      metadata: { context: "buzon", kind, templateKey, language: client.language, toLast4: client.phone!.slice(-4), segments: smsSegments(body).segments, mode, auto: !input.by, ...extra },
    });

  if (mode === "on") {
    const rc = ringCentral();
    if (!rc) return record("failed", "RingCentral is not configured on the server");
    try {
      const sent = await rc.sendSms(client.phone, body);
      log(sent.id, sent.status, null);
    } catch (err) {
      const message = err instanceof RingCentralError ? err.message : (err as Error).message;
      log(null, "Failed", message);
      audit("sms.failed", { error: message });
      return record("failed", message);
    }
    if (client.mondayId) {
      const entry = smsActivity({ to: client.phone, body }, client.mondayId, await activityId(deps.mondayApiToken));
      try {
        if (!deps.mondayApiToken) throw new Error("MONDAY_API_TOKEN is not set");
        await dataSource.createTimelineItem(entry, deps.mondayApiToken);
      } catch (err) {
        console.error("[buzon] text E&A entry failed; queueing:", err);
        enqueueWrite(db, {
          opType: "create_timeline_item", targetTable: "profiles", targetLocalId: client.localId,
          mondayItemId: client.mondayId, authorOid: null, payload: { ...entry },
        });
      }
    }
    audit("sms.sent", {});
    return record("sent", null);
  }
  console.log(`[buzon] DRY RUN — would text …${client.phone.slice(-4)} (${kind}, ${body.length} chars)`);
  log(null, "DryRun", null);
  audit("sms.sent", {});
  return record("dry_run", null);
}
