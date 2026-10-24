// =============================================================================
// Buzón routes (docs/features/buzon.md)
// =============================================================================
//   GET  /api/settings/buzon                  anyone: the firm's Buzón settings + whether the automatic start is on
//   PUT  /api/settings/buzon                  admin: replace them (audited buzon.settings_updated)
//   GET  /api/profiles/:localId/buzon         the client's switches, the texts the Buzón sent them, the next reminder
//   PUT  /api/profiles/:localId/buzon         {noAutoTexts, reminders: null|"off"|"custom", days?} (audited)
//   POST /api/profiles/:localId/buzon/remind  "Remind now" (Phase 4): the reminder text, now, by this staff member.
//                                             A person pressed it, so it is allowed for a "no automatic texts" client.
// Rules = buzon/rules.ts, sending = buzon/text.ts, the job = buzon/job.ts.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { auditFromReq } from "../audit/log.js";
import { currentUserId } from "../db/user-context.js";
import { activeLink, buzonClient, clientSettings, saveClientSettings } from "../buzon/client.js";
import { missingFor } from "../buzon/job.js";
import { missingList, nextReminderAt, reminderDays } from "../buzon/rules.js";
import { buzonAutoConfig, loadBuzonSettings, saveBuzonSettings, sanitizeDays } from "../buzon/settings.js";
import { effectiveSmsMode, sendBuzonText } from "../buzon/text.js";

export function registerBuzonRoutes(app: Express, deps: { db: DatabaseInstance; mondayApiToken: string | undefined; seed: boolean }): void {
  const { db } = deps;

  app.get("/api/settings/buzon", requireAuth, (_req, res) => {
    const auto = buzonAutoConfig();
    res.json({ data: { settings: loadBuzonSettings(), autoStart: auto ? { since: auto.since } : null, smsMode: effectiveSmsMode(deps.seed) } });
  });

  app.put("/api/settings/buzon", requireAuth, requireAdmin, (req, res) => {
    try {
      const saved = saveBuzonSettings(req.body);
      auditFromReq(req, "buzon.settings_updated", { targetType: "settings", targetId: "buzon", metadata: { ...saved } });
      const auto = buzonAutoConfig();
      res.json({ data: { settings: saved, autoStart: auto ? { since: auto.since } : null, smsMode: effectiveSmsMode(deps.seed) } });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  function view(localId: string) {
    const client = buzonClient(db, localId);
    if (!client) return null;
    const settings = clientSettings(db, client);
    const firm = loadBuzonSettings();
    const link = activeLink(db, client);
    const texts = db.prepare(
      `SELECT kind, sent_at AS sentAt, status, error, by_name AS byName FROM buzon_texts
        WHERE profile_local_id = ? OR (? IS NOT NULL AND profile_monday_id = ?) ORDER BY id DESC LIMIT 30`,
    ).all(client.localId, client.mondayId, client.mondayId);
    const days = reminderDays(firm, settings);
    let nextReminder: string | null = null;
    if (link && days) {
      const first = db.prepare(
        "SELECT MIN(sent_at) AS at FROM buzon_texts WHERE link_id = ? AND kind IN ('link', 'remind_now') AND status != 'failed'",
      ).get(link.id) as { at: string | null };
      const sent = (db.prepare("SELECT COUNT(*) AS n FROM buzon_texts WHERE link_id = ? AND kind = 'reminder' AND status != 'failed'").get(link.id) as { n: number }).n;
      const next = first.at ? nextReminderAt(new Date(`${first.at.replace(" ", "T")}Z`), sent, days) : null;
      nextReminder = next ? next.toISOString() : null;
    }
    return {
      client: { name: client.name, hasPhone: !!client.phone, language: client.language },
      settings,
      firmReminders: firm.reminders,
      reminderDays: days,
      nextReminder,
      /** Remind now can resend the active link (its token can be read back). */
      canRemind: !!link?.url && !!client.phone && effectiveSmsMode(deps.seed) !== "off",
      missing: missingFor(db, client).names,
      texts,
    };
  }

  app.get("/api/profiles/:localId/buzon", requireAuth, (req, res) => {
    const v = view(String(req.params.localId));
    if (!v) return res.status(404).json({ error: "Client not found" });
    res.json({ data: v });
  });

  app.put("/api/profiles/:localId/buzon", requireAuth, (req, res) => {
    const client = buzonClient(db, String(req.params.localId));
    if (!client) return res.status(404).json({ error: "Client not found" });
    const b = (req.body ?? {}) as { noAutoTexts?: unknown; reminders?: unknown; days?: unknown };
    const reminders = b.reminders === "off" || b.reminders === "custom" ? b.reminders : null;
    const days = reminders === "custom" ? sanitizeDays(b.days) : null;
    if (reminders === "custom" && !days?.length) return res.status(400).json({ error: "Give at least one reminder day (1 to 90)" });
    const saved = saveClientSettings(db, client, { noAutoTexts: b.noAutoTexts === true, reminders, days }, req.user?.name ? String(req.user.name) : null);
    auditFromReq(req, "buzon.client_settings", {
      targetType: "profile", targetId: client.localId, targetMondayId: client.mondayId, metadata: { ...saved },
    });
    res.json({ data: view(client.localId) });
  });

  app.post("/api/profiles/:localId/buzon/remind", requireAuth, async (req, res) => {
    const client = buzonClient(db, String(req.params.localId));
    if (!client) return res.status(404).json({ error: "Client not found" });
    const link = activeLink(db, client);
    if (!link) return res.status(409).json({ error: "This client has no active link. Make one first." });
    if (!link.url) return res.status(409).json({ error: "This link can't be sent again (made before reminders existed, or no APP_ENCRYPTION_KEY). Make a new link." });
    if (!client.phone) return res.status(409).json({ error: "No US phone number on the profile." });
    const { names } = missingFor(db, client);
    if (!names.length) return res.status(409).json({ error: "Nothing is missing on this client's list." });
    const sent = await sendBuzonText(
      { db, mondayApiToken: deps.mondayApiToken, seed: deps.seed },
      {
        client, kind: "remind_now", linkId: link.id,
        vars: { uploadLink: link.url, missing: missingList(names, client.language) },
        by: { userId: currentUserId(req), name: req.user?.name ? String(req.user.name) : null, email: req.user?.preferred_username ?? null },
      },
    );
    if (sent.status === "failed") return res.status(502).json({ error: `The reminder was not sent: ${sent.error}` });
    res.json({ data: { status: sent.status, ...view(client.localId) } });
  });
}
