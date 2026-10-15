// =============================================================================
// SMS routes — text a client through RingCentral
// =============================================================================
//   GET  /api/sms/config               mode, sending number, templates, firm name/phone
//   PUT  /api/settings/sms-templates   admin: replace the template list (audited)
//   POST /api/sms/send                 send one text (click-to-send, never automatic)
//   GET  /api/profiles/:localId/sms    texts sent to a client
//
// A send:
//   1. refuses when SMS_MODE=off, the number isn't a US number, the text still
//      has an unfilled {{placeholder}}, or the same text went to the same
//      number in the last 2 minutes (double click);
//   2. sends through RingCentral — or, in dry-run, only logs. Seed data is
//      always dry-run: Faker's phone numbers can be somebody's real phone;
//   3. records it in sms_messages and the audit log (last 4 digits only);
//   4. when the text is linked to a client and really went out, logs it in the
//      profile's Emails & Activities ("Text message" if that type exists in
//      Monday, else "Casenote"). An outage queues that entry; the text itself is
//      never queued — a text that lands an hour late is worse than staff
//      knowing it didn't go.
// Plan + rules = sms/send-plan.ts. See docs/features/sms-and-slack.md.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { auditFromReq } from "../audit/log.js";
import { currentUserId } from "../db/user-context.js";
import { fetchCustomActivities } from "@case-pipeline/monday";
import { formatUsPhone, smsSegments } from "@case-pipeline/core";
import { smsMode, ringCentral, RingCentralError, type SmsMode } from "../sms/ringcentral.js";
import { loadSmsTemplates, saveSmsTemplates } from "../sms/templates.js";
import { recordSms, recentlySent, smsHistoryForProfile } from "../sms/log.js";
import { parseSmsSendBody, smsActivity } from "../sms/send-plan.js";
import { loadDocumentSettings } from "../documents/document-settings.js";
import { CASENOTE_ACTIVITY_ID } from "./detention-write.js";
import { getBoardColumnsFor } from "@case-pipeline/query";
import { notifyEvent, inBackground, mondayItemUrl } from "../notify/slack.js";
import { smsSentEvent } from "../notify/events.js";

/** The E&A type a sent text is logged under, looked up by name in Monday. */
export const SMS_ACTIVITY_NAME = "Text message";

export interface SmsDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
  /** True on seed data: every send becomes a dry run. */
  forceDryRun: boolean;
}

export function registerSmsRoutes(app: Express, deps: SmsDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions, forceDryRun } = deps;

  const effectiveMode = (): SmsMode => {
    const m = smsMode();
    return m === "on" && forceDryRun ? "dry-run" : m;
  };

  /** "Text message" by name once someone creates it in Monday, cached; Casenote until then. */
  let activityCache: { id: string; at: number } | null = null;
  async function smsActivityId(): Promise<string> {
    if (activityCache && Date.now() - activityCache.at < 30 * 60 * 1000) return activityCache.id;
    let id = CASENOTE_ACTIVITY_ID;
    try {
      for (const [actId, name] of await fetchCustomActivities(MONDAY_API_TOKEN)) {
        if (name.trim().toLowerCase() === SMS_ACTIVITY_NAME.toLowerCase()) id = actId;
      }
    } catch (err) {
      console.error("[sms] could not list E&A activity types; using Casenote:", err);
    }
    activityCache = { id, at: Date.now() };
    return id;
  }

  app.get("/api/sms/config", requireAuth, (_req, res) => {
    const firm = loadDocumentSettings().firm;
    res.json({
      data: {
        mode: effectiveMode(),
        fromNumber: process.env.RINGCENTRAL_FROM_NUMBER ? formatUsPhone(process.env.RINGCENTRAL_FROM_NUMBER) : null,
        templates: loadSmsTemplates(),
        firm: { firmName: firm.name, firmPhone: formatUsPhone(firm.phone) },
      },
    });
  });

  app.put("/api/settings/sms-templates", requireAuth, requireAdmin, (req, res) => {
    try {
      const saved = saveSmsTemplates(req.body);
      auditFromReq(req, "sms_templates.updated", {
        targetType: "settings",
        targetId: "sms-templates",
        metadata: { keys: saved.map((t) => t.key) },
      });
      res.json({ data: saved });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/api/profiles/:localId/sms", requireAuth, (req, res) => {
    const p = db.prepare("SELECT monday_item_id FROM profiles WHERE local_id = ?").get(req.params.localId) as
      | { monday_item_id: string | null }
      | undefined;
    if (!p) return res.status(404).json({ error: "profile not found" });
    res.json({ data: p.monday_item_id ? smsHistoryForProfile(p.monday_item_id) : [] });
  });

  app.post("/api/sms/send", requireAuth, async (req, res) => {
    const mode = effectiveMode();
    if (mode === "off") return res.status(503).json({ error: "Texting is turned off (SMS_MODE)." });

    const parsed = parseSmsSendBody(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const sms = parsed.value;

    let profileMondayId: string | null = null;
    let profileName: string | null = null;
    if (sms.profileLocalId) {
      const p = db.prepare("SELECT monday_item_id, name FROM profiles WHERE local_id = ?").get(sms.profileLocalId) as
        | { monday_item_id: string | null; name: string }
        | undefined;
      if (!p) return res.status(404).json({ error: "profile not found" });
      profileMondayId = p.monday_item_id;
      profileName = p.name;
    }

    if (recentlySent(sms.to, sms.body)) {
      return res.status(409).json({ error: "This exact text was just sent to this number." });
    }

    const userId = currentUserId(req);
    const segments = smsSegments(sms.body).segments;
    const auditMeta = {
      context: sms.context,
      templateKey: sms.templateKey,
      language: sms.language,
      toLast4: sms.to.slice(-4),
      segments,
      mode,
    };
    const log = (rcMessageId: string | null, status: string, error: string | null) =>
      recordSms({
        userId, toNumber: sms.to, body: sms.body, templateKey: sms.templateKey, language: sms.language,
        context: sms.context, profileLocalId: sms.profileLocalId, profileMondayId,
        mode: mode === "on" ? "on" : "dry-run", rcMessageId, status, error,
      });

    let rcId: string | null = null;
    let status = "DryRun";
    if (mode === "on") {
      const rc = ringCentral();
      if (!rc) return res.status(503).json({ error: "RingCentral is not configured on the server." });
      try {
        const sent = await rc.sendSms(sms.to, sms.body);
        rcId = sent.id;
        status = sent.status;
      } catch (err) {
        const message = err instanceof RingCentralError ? err.message : (err as Error).message;
        log(null, "Failed", message);
        auditFromReq(req, "sms.failed", {
          targetType: profileMondayId ? "profile" : null,
          targetId: sms.profileLocalId,
          targetMondayId: profileMondayId,
          metadata: { ...auditMeta, error: message },
        });
        console.error(`[sms] send to …${sms.to.slice(-4)} failed:`, message);
        return res.status(502).json({ error: `The text was not sent: ${message}` });
      }
    } else {
      console.log(`[sms] DRY RUN — would text …${sms.to.slice(-4)} (${sms.body.length} chars, ${segments} segment(s))`);
    }
    const logId = log(rcId, status, null);

    // E&A on the profile — only for a text that really went out. A dry run on
    // a real client's profile would read as if they had been texted.
    let activity: "logged" | "queued" | "none" = "none";
    if (mode === "on" && profileMondayId) {
      const input = smsActivity(sms, profileMondayId, await smsActivityId());
      try {
        await withTokenFallback((token) => dataSource.createTimelineItem(input, token), writeTokenOptions(req));
        activity = "logged";
      } catch (err) {
        console.error("[write-back] SMS activity failed; queueing for retry:", err);
        enqueueWrite(db, {
          opType: "create_timeline_item", targetTable: "profiles", targetLocalId: sms.profileLocalId!,
          mondayItemId: profileMondayId, authorOid: req.user?.oid ?? null, payload: { ...input },
        });
        activity = "queued";
      }
    }

    auditFromReq(req, "sms.sent", {
      targetType: profileMondayId ? "profile" : null,
      targetId: sms.profileLocalId,
      targetMondayId: profileMondayId,
      metadata: { ...auditMeta, logId, activity },
    });

    res.json({ data: { mode, status, activity, segments } });

    // Slack: real texts only — never the number or the words.
    if (mode === "on") {
      inBackground(notifyEvent(smsSentEvent({
        clientName: profileName,
        templateLabel: loadSmsTemplates().find((t) => t.key === sms.templateKey)?.label ?? null,
        context: sms.context,
        by: req.user?.name,
        link: mondayItemUrl(getBoardColumnsFor(db, "profiles")?.mondayBoardId, profileMondayId),
      })));
    }
  });
}
