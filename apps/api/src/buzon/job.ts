// =============================================================================
// Buzón — the job (docs/features/buzon.md, Phases 2 + 4)
// =============================================================================
// Every 5 minutes (BUZON_CRON), when CLIENT_UPLOADS=on:
//   1. start: Fee Ks newly at "Paid needs action" (only with BUZON_AUTO=on and
//      BUZON_AUTO_SINCE, so turning it on never texts every old paid case);
//   2. reminders: a client still missing required documents gets the next
//      reminder on its day, in office hours, never twice a day; after the last
//      one, the Fee K's people are told the client hasn't sent them;
//   3. "we received": after a client's batch goes quiet (10 min), one thank-you
//      text saying what is still missing — when turned on in Settings;
//   4. a USCIS / court notice the client sent is read like scanned mail and
//      shows in Alerts → "Mail to review" (notices.ts, Phase 3).
// Each step's texts go through autoTextBlocked: a client set to "no automatic
// texts" never gets one.
// =============================================================================

import cron from "node-cron";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { usersDb } from "../db/users-db.js";
import { FIRM_TIMEZONE } from "../firm.js";
import { notifyOps } from "../notify/slack.js";
import { recordRun } from "../workflows/runs.js";
import { QUIET_MINUTES } from "../uploads/filing.js";
import { clientUploadsConfig } from "../uploads/rules.js";
import { checklistFor, publicChecklist } from "../uploads/checklist.js";
import { activeLink, buzonClient, clientSettings, type BuzonClient } from "./client.js";
import { autoTextBlocked, firmClock, inSendWindow, missingList, nextReminderAt, reminderDays, stillNeededSentence } from "./rules.js";
import { buzonAutoConfig, loadBuzonSettings } from "./settings.js";
import { startCandidates, startForFeeK } from "./start.js";
import { effectiveSmsMode, sendBuzonText, type BuzonTextDeps } from "./text.js";
import { tellFeeKTeam } from "./team.js";
import { readClientNotices } from "./notices.js";
import { DATA_DIR } from "../paths.js";

export interface BuzonJobDeps extends BuzonTextDeps {
  runs?: DatabaseInstance;
  now?: () => Date;
  /** Where uploads/ and mail/ are (tests). Default data/. */
  dataDir?: string;
}

let deps: BuzonJobDeps | null = null;
let running = false;

/** SQLite UTC text → Date. */
const utc = (s: string) => new Date(`${s.replace(" ", "T")}Z`);

/** What the client still has to send, in their language (required first). */
export function missingFor(db: DatabaseInstance, client: BuzonClient, lang: "es" | "en" = client.language): { names: string[]; feeKMondayId: string | null } {
  const rows = checklistFor(db, client);
  const open = publicChecklist(rows).filter((i) => i.required && !i.received);
  const firstFeeK = rows.find((r) => open.some((o) => o.id === r.id) && r.fee_k_monday_id)?.fee_k_monday_id ?? null;
  return { names: open.map((i) => (lang === "es" ? i.es : i.en)), feeKMondayId: firstFeeK };
}

/**
 * When the client was first texted this link: a Buzón text, else a staff text
 * from M30 / M28 (sms_messages context upload_link) since the link was made.
 */
function firstTextAt(db: DatabaseInstance, client: BuzonClient, link: { id: number; createdAt: string }): Date | null {
  const own = db.prepare(
    "SELECT MIN(sent_at) AS at FROM buzon_texts WHERE link_id = ? AND kind IN ('link', 'remind_now') AND status != 'failed'",
  ).get(link.id) as { at: string | null };
  let at = own.at ? utc(own.at) : null;
  if (client.mondayId) {
    const staff = usersDb.prepare(
      "SELECT MIN(created_at) AS at FROM sms_messages WHERE profile_monday_id = ? AND context = 'upload_link' AND error IS NULL AND created_at >= ?",
    ).get(client.mondayId, link.createdAt) as { at: string | null };
    if (staff.at && (!at || utc(staff.at) < at)) at = utc(staff.at);
  }
  return at;
}

export async function runReminders(d: BuzonJobDeps): Promise<{ sent: number; gaveUp: number }> {
  const { db } = d;
  const now = d.now?.() ?? new Date();
  const firm = loadBuzonSettings();
  const out = { sent: 0, gaveUp: 0 };
  const profiles = db.prepare(
    "SELECT DISTINCT profile_local_id AS id FROM upload_checklist_items WHERE status = 'missing' AND required = 1",
  ).all() as { id: string }[];

  for (const { id } of profiles) {
    const client = buzonClient(db, id);
    if (!client) continue;
    const settings = clientSettings(db, client);
    const days = reminderDays(firm, settings);
    if (!days) continue;
    const link = activeLink(db, client);
    if (!link?.url) continue;
    const { names, feeKMondayId } = missingFor(db, client);
    if (!names.length) continue;
    const first = firstTextAt(db, client, link);
    if (!first) continue;
    const sent = (db.prepare(
      "SELECT COUNT(*) AS n FROM buzon_texts WHERE link_id = ? AND kind = 'reminder' AND status != 'failed'",
    ).get(link.id) as { n: number }).n;
    const next = nextReminderAt(first, sent, days);

    if (!next) {
      const told = db.prepare("SELECT 1 FROM buzon_texts WHERE link_id = ? AND kind = 'gave_up'").get(link.id);
      if (told) continue;
      db.prepare("INSERT INTO buzon_texts (profile_local_id, profile_monday_id, link_id, kind, status) VALUES (?, ?, ?, 'gave_up', 'skipped')")
        .run(client.localId, client.mondayId, link.id);
      await tellFeeKTeam(db, d.mondayApiToken, feeKMondayId,
        `📤 ${client.name} hasn't sent: ${missingList(missingFor(db, client, "en").names, "en", 6)} — every reminder went. Time for a call?`,
        { text: `${client.name} hasn't sent everything after ${sent} reminder${sent === 1 ? "" : "s"}.`, profileMondayId: client.mondayId });
      out.gaveUp++;
      continue;
    }
    if (now < next || !inSendWindow(now, firm.reminders, FIRM_TIMEZONE)) continue;
    const today = firmClock(now, FIRM_TIMEZONE).date;
    const textedToday = (db.prepare(
      "SELECT sent_at FROM buzon_texts WHERE profile_local_id = ? AND status != 'failed' AND kind != 'gave_up' ORDER BY id DESC LIMIT 1",
    ).get(client.localId) as { sent_at: string } | undefined);
    if (textedToday && firmClock(utc(textedToday.sent_at), FIRM_TIMEZONE).date === today) continue;
    if (autoTextBlocked({ kind: "reminder", firm, client: settings, phoneE164: client.phone, smsMode: effectiveSmsMode(d.seed) })) continue;
    const r = await sendBuzonText(d, { client, kind: "reminder", vars: { uploadLink: link.url, missing: missingList(names, client.language) }, linkId: link.id });
    if (r.status !== "failed") out.sent++;
  }
  return out;
}

/** The thank-you text once a client's batch has gone quiet. Every upload is stamped, texted or not. */
export async function runReceivedTexts(d: BuzonJobDeps): Promise<number> {
  const { db } = d;
  const firm = loadBuzonSettings();
  const batches = db.prepare(`
    SELECT u.link_id AS linkId, l.profile_local_id AS profileLocalId, GROUP_CONCAT(u.id) AS ids
      FROM client_uploads u JOIN upload_links l ON l.id = u.link_id
     WHERE u.thanked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM client_uploads n WHERE n.link_id = u.link_id AND n.received_at > datetime('now', ?))
     GROUP BY u.link_id
  `).all(`-${QUIET_MINUTES} minutes`) as { linkId: number; profileLocalId: string; ids: string }[];
  let sent = 0;
  for (const b of batches) {
    const stamp = () => db.prepare(`UPDATE client_uploads SET thanked_at = datetime('now') WHERE id IN (${b.ids})`).run();
    const client = buzonClient(db, b.profileLocalId);
    if (!client || autoTextBlocked({ kind: "received", firm, client: clientSettings(db, client), phoneE164: client.phone, smsMode: effectiveSmsMode(d.seed) })) {
      stamp();
      continue;
    }
    const { names } = missingFor(db, client);
    const r = await sendBuzonText(d, { client, kind: "received", vars: { stillNeeded: stillNeededSentence(names, client.language) }, linkId: b.linkId });
    stamp();
    if (r.status !== "failed") sent++;
  }
  return sent;
}

export async function runBuzonJob(d: BuzonJobDeps): Promise<void> {
  if (running) return;
  running = true;
  const startedAt = new Date();
  try {
    let started = 0;
    const auto = buzonAutoConfig();
    if (auto) {
      for (const feeK of startCandidates(d.db, auto.since)) {
        if ((await startForFeeK(d, feeK)) !== "already") started++;
      }
    }
    const reminders = await runReminders(d);
    const thanked = await runReceivedTexts(d);
    const notices = await readClientNotices(d.db, d.dataDir ?? DATA_DIR);
    if (d.runs) recordRun(d.runs, "buzon", startedAt, { summary: `${started} started, ${reminders.sent} reminders, ${reminders.gaveUp} gave up, ${thanked} thank-you texts, ${notices} notices to mail review` });
  } catch (err) {
    console.error("[buzon] job failed:", err);
    if (d.runs) recordRun(d.runs, "buzon", startedAt, { error: (err as Error).message });
    await notifyOps("ops_buzon", `The Buzón job failed: ${(err as Error).message}`);
  } finally {
    running = false;
  }
}

/** LawPay just moved a Fee K to Paid needs action: start it now instead of waiting for the webhook. */
export function buzonFeeKPaid(feeKMondayId: string): void {
  if (!deps || !buzonAutoConfig()) return;
  void startForFeeK(deps, feeKMondayId).catch((err) => console.error("[buzon] start failed:", err));
}

/** At startup when CLIENT_UPLOADS=on. */
export function startBuzonJob(d: BuzonJobDeps): void {
  if (!clientUploadsConfig()) return;
  deps = d;
  const schedule = process.env.BUZON_CRON ?? "*/5 * * * *";
  cron.schedule(schedule, () => void runBuzonJob(d), { timezone: FIRM_TIMEZONE });
  const auto = buzonAutoConfig();
  if (!auto && process.env.BUZON_AUTO?.trim().toLowerCase() === "on") {
    console.error("[buzon] BUZON_AUTO=on but BUZON_AUTO_SINCE=YYYY-MM-DD is missing: the automatic start stays off.");
  }
  console.log(`[buzon] Buzón job scheduled — cron "${schedule}"; automatic start ${auto ? `on (Fee Ks paid since ${auto.since})` : "off (BUZON_AUTO)"}${d.seed ? ", seed data: dry run" : ""}.`);
}
