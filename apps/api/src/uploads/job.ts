// =============================================================================
// Client uploads — the API's half of filing (docs/features/client-uploads.md)
// =============================================================================
// Runs scripts/client-uploads.ts (it has the SharePoint sign-in, like Drive
// intake and esign:efile) when a link's batch has gone quiet, and every 15
// minutes as a sweep. Then, from the rows the script stamped:
//   - filed, not yet told → one Monday update on the client's profile per
//     batch (shared token: the client did this, not a staff member; queued on
//     an outage) + a Slack "client_upload" post;
//   - waiting a day with no folder, or given up after MAX_ATTEMPTS → Slack ops.
// Off unless CLIENT_UPLOADS=on.
// =============================================================================

import { spawn } from "node:child_process";
import cron from "node-cron";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { getBoardColumnsFor } from "@case-pipeline/query";
import { REPO_ROOT } from "../paths.js";
import { FIRM_TIMEZONE } from "../firm.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { mondayItemUrl, notifyEvent, notifyOps } from "../notify/slack.js";
import { clientUploadEvent } from "../notify/events.js";
import { MAX_ATTEMPTS, QUIET_MINUTES, WAITING_ALERT_HOURS, kindSummary, uploadNoteHtml, type FiledFile } from "./filing.js";

export interface FilingResult {
  ok: boolean;
  filed?: number;
  waiting?: { profile: string; files: number; reason: string }[];
  failed?: { upload: number; reason: string }[];
  reason?: string;
}

export interface FilingDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  seed: boolean;
  /** Tests replace the script run. */
  runScript?: (args: string[]) => Promise<FilingResult>;
}

let deps: FilingDeps | null = null;
let inFlight: Promise<void> | null = null;
let again = false;
let soon: NodeJS.Timeout | null = null;

/** Run the script; its last stdout line is the JSON result. */
function runFilingScript(args: string[]): Promise<FilingResult> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn("npm", ["run", "--silent", "uploads:file", "--", ...args], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), 10 * 60_000);
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const last = out.trim().split("\n").pop() ?? "";
      try {
        resolve(JSON.parse(last) as FilingResult);
      } catch {
        resolve({ ok: false, reason: `the filing script exited with code ${code} and no result` });
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: err.message });
    });
  });
}

/** One run at a time; a request during a run starts one more right after. */
export function runFilingNow(quietMinutes = QUIET_MINUTES): Promise<void> {
  if (!deps) return Promise.resolve();
  if (inFlight) {
    again = true;
    return inFlight;
  }
  const d = deps;
  inFlight = (async () => {
    try {
      const args = ["--apply", `--quiet=${quietMinutes}`, ...(d.seed ? ["--db=seed"] : [])];
      const result = await (d.runScript ?? runFilingScript)(args);
      if (!result.ok) {
        console.error("[uploads] filing failed:", result.reason);
        await notifyOps("ops_client_uploads", `Filing client uploads failed: ${result.reason ?? "unknown error"}. Their files are safe on the server and will be filed on a later run.`);
      }
      await tellStaff(d);
    } catch (err) {
      console.error("[uploads] filing job error:", err);
    } finally {
      inFlight = null;
      if (again) {
        again = false;
        void runFilingNow(quietMinutes);
      }
    }
  })();
  return inFlight;
}

/** After each upload: file the batch once the link has been quiet QUIET_MINUTES (the timer restarts per file). */
export function fileSoon(): void {
  if (!deps) return;
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => {
    soon = null;
    void runFilingNow();
  }, (QUIET_MINUTES + 1) * 60_000);
  soon.unref?.();
}

interface FiledRow {
  id: number;
  link_id: number;
  stored_name: string;
  kind: string;
  note: string | null;
  sharepoint_url: string;
  filed_where: string;
  profile_local_id: string;
  profile_monday_id: string | null;
}

function clientName(db: DatabaseInstance, mondayId: string | null, localId: string): string | null {
  const row = (mondayId ? db.prepare("SELECT name FROM profiles WHERE monday_item_id = ?").get(mondayId) : undefined)
    ?? db.prepare("SELECT name FROM profiles WHERE local_id = ?").get(localId);
  return (row as { name: string } | undefined)?.name ?? null;
}

/** Monday + Slack for what was filed; ops posts for what is stuck. Exported for tests. */
export async function tellStaff(d: Pick<FilingDeps, "db" | "mondayApiToken">): Promise<void> {
  const { db } = d;
  const filed = db.prepare(`
    SELECT u.id, u.link_id, u.stored_name, u.kind, u.note, u.sharepoint_url, u.filed_where, l.profile_local_id, l.profile_monday_id
      FROM client_uploads u JOIN upload_links l ON l.id = u.link_id
     WHERE u.filed_at IS NOT NULL AND u.notified_at IS NULL
     ORDER BY u.id
  `).all() as FiledRow[];

  const batches = new Map<number, FiledRow[]>();
  for (const r of filed) batches.set(r.link_id, [...(batches.get(r.link_id) ?? []), r]);
  const stamp = db.prepare("UPDATE client_uploads SET notified_at = datetime('now') WHERE id = ?");
  const profilesBoard = getBoardColumnsFor(db, "profiles")?.mondayBoardId;

  for (const rows of batches.values()) {
    const first = rows[0]!;
    const files: FiledFile[] = rows.map((r) => ({
      storedName: r.stored_name, kind: r.kind, note: r.note, sharepointUrl: r.sharepoint_url, filedWhere: r.filed_where,
    }));
    if (first.profile_monday_id) {
      const body = uploadNoteHtml(files);
      try {
        if (!d.mondayApiToken) throw new Error("MONDAY_API_TOKEN is not set");
        await withTokenFallback((token) => dataSource.postUpdate(first.profile_monday_id!, body, token), { sharedToken: d.mondayApiToken });
      } catch (err) {
        console.error("[uploads] Monday update failed; queueing:", err);
        enqueueWrite(db, { opType: "create_update", targetTable: "profiles", mondayItemId: first.profile_monday_id, payload: { body } });
      }
    }
    await notifyEvent("client_upload", clientUploadEvent({
      clientName: clientName(db, first.profile_monday_id, first.profile_local_id),
      files: rows.length,
      kinds: kindSummary(rows.map((r) => r.kind)),
      where: first.filed_where,
      link: mondayItemUrl(profilesBoard, first.profile_monday_id),
    }));
    // Stamped after the post, so a crash in between tells staff twice, never zero times.
    db.transaction(() => rows.forEach((r) => stamp.run(r.id)))();
  }

  const stuck = db.prepare(`
    SELECT l.profile_local_id, l.profile_monday_id, COUNT(*) AS n,
           SUM(u.attempts >= ?) AS gaveUp, MIN(u.last_error) AS reason
      FROM client_uploads u JOIN upload_links l ON l.id = u.link_id
     WHERE u.filed_at IS NULL AND u.local_file IS NOT NULL
       AND (u.attempts >= ? OR (u.last_error LIKE 'waiting:%' AND u.received_at < datetime('now', ?)))
     GROUP BY l.profile_local_id, l.profile_monday_id
  `).all(MAX_ATTEMPTS, MAX_ATTEMPTS, `-${WAITING_ALERT_HOURS} hours`) as
    { profile_local_id: string; profile_monday_id: string | null; n: number; gaveUp: number; reason: string | null }[];
  for (const s of stuck) {
    const name = clientName(db, s.profile_monday_id, s.profile_local_id) ?? "A client";
    const what = s.n === 1 ? "1 file" : `${s.n} files`;
    const text = s.gaveUp
      ? `${what} from ${name}'s upload link could not be filed after ${MAX_ATTEMPTS} tries (${s.reason ?? "unknown error"}). They are safe on the server.`
      : `${what} from ${name}'s upload link have had nowhere to go for a day: set their E-File (or Consult File) on the profile and they file on the next run.`;
    await notifyOps("ops_client_uploads", text, `client_uploads:stuck:${s.profile_monday_id ?? s.profile_local_id}`);
  }
}

/** At startup when CLIENT_UPLOADS=on: the sweep schedule + the after-upload trigger. */
export function startClientUploadFiling(d: FilingDeps): void {
  deps = d;
  const sweep = process.env.CLIENT_UPLOADS_CRON ?? "*/15 * * * *";
  cron.schedule(sweep, () => void runFilingNow(), { timezone: FIRM_TIMEZONE });
  console.log(`[uploads] Client upload filing scheduled — cron "${sweep}" (${FIRM_TIMEZONE})${d.seed ? ", seed data: dry run" : ""}.`);
}

/** Tests only. */
export function _setFilingDeps(d: FilingDeps | null): void {
  deps = d;
}
