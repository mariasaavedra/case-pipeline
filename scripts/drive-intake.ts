// =============================================================================
// Drive intake — client consult uploads → SharePoint + Monday
// =============================================================================
// When a consult is booked, Zapier makes the client a Google Drive folder to
// upload documents to. Reception then copied each upload by hand into the
// client's SharePoint CONSULT folder and onto the Monday appointment. This
// does both:
//
//   npm run drive:intake                       # dry run: what would be copied where
//   npm run drive:intake -- --apply            # copy
//   npm run drive:intake -- --since=2026-10-01 # only files uploaded on/after this day
//
// Per file:
//   1. Read who/when from its folders (scripts/drive/folder-names.ts).
//   2. Match to the attorney's appointment by name + nearest date
//      (scripts/drive/match.ts). Unmatched or ambiguous → left for a person,
//      re-tried every run (the Monday item may simply not have synced yet).
//   3. SharePoint: upload into the client's CONSULT folder. A file with the
//      same name and size already there counts as done — reception may have
//      copied it by hand. Same name, different size → uploaded beside it.
//   4. Monday: one update per appointment per run ("Documents received via
//      Google Drive"), files attached — they show in the item's Files gallery,
//      which works on boards without a file column. A file already on the item
//      with the same name and size is skipped.
//
// Each step is stamped in drive_intake_files separately, so a failure in one
// does not repeat the other. Nothing in Drive is moved, renamed or deleted.
//
// Per upload folder ("Consult Documents …", with or without files in it):
//   5. Match it to the appointment the same way and record its link in
//      drive_folders (M18 shows it). Write the link to the appointment's
//      "Google Drive Folder" column when empty (scripts/drive/folder-links.ts).
//      Folders made since --links-since (default: the same day as --since).
// =============================================================================

import Database from "better-sqlite3";
import fs from "node:fs";
import { loadBoardsConfig } from "@case-pipeline/config";
import { addFileToUpdate, changeSimpleColumnValue, createUpdate, fetchItem, fetchItemAssets, setApiToken } from "@case-pipeline/monday";
import { driveClientFromEnv, FOLDER_MIME, type DriveClient, type DriveFile } from "./drive/drive-client.js";
import { isMonthFolder, parseUploadFolder, readContext } from "./drive/folder-names.js";
import { matchUpload, WINDOW_DAYS, type AppointmentRow, type MatchResult } from "./drive/match.js";
import { resolveDestination, type ClientLinks, type Destination } from "./drive/destination.js";
import { columnDecision, driveFolderUrl, newestPerAppointment } from "./drive/folder-links.js";
import { graphAuthFromEnv } from "./sharepoint/auth.js";
import { listChildren, uploadFile } from "./sharepoint/folders.js";
import type { GraphAuth } from "./sharepoint/graph-client.js";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const flag = (n: string) => process.argv.includes(`--${n}`);

/** Monday caps a file at 500 MB; anything near that is not a client scan. */
const MAX_BYTES = 200 * 1024 * 1024;

interface LedgerRow {
  drive_file_id: string;
  match_status: string;
  sp_done_at: string | null;
  monday_done_at: string | null;
}

interface Planned {
  file: DriveFile;
  folderPath: string;
  match: MatchResult | { kind: "unsupported"; detail: string };
}

// ---- Drive: which files, and where they sit -----------------------------------

/** Folder names from just under the root down to the file's folder, or null if outside the tree. */
async function ancestorsOf(
  drive: DriveClient,
  rootId: string,
  file: DriveFile,
  cache: Map<string, DriveFile>,
): Promise<string[] | null> {
  const names: string[] = [];
  let parentId = file.parents?.[0];
  for (let depth = 0; parentId && depth < 10; depth++) {
    if (parentId === rootId) return names.reverse();
    let folder = cache.get(parentId);
    if (!folder) {
      folder = await drive.get(parentId);
      cache.set(parentId, folder);
    }
    names.push(folder.name);
    parentId = folder.parents?.[0];
  }
  return null;
}

// ---- Local data: appointments and client folder links ----------------------------

function loadAppointments(db: Database.Database, since: string): AppointmentRow[] {
  const from = new Date(Date.parse(`${since}T00:00:00Z`) - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT local_id AS localId, monday_item_id AS mondayItemId, board_key AS boardKey, name,
              json_extract(column_values, '$.first_name') AS firstName,
              json_extract(column_values, '$.last_name')  AS lastName,
              COALESCE(json_extract(column_values, '$.consult_date.date'), next_date) AS consultDate,
              profile_local_id AS profileLocalId
         FROM board_items
        WHERE board_key GLOB 'appointments_*'
          AND COALESCE(json_extract(column_values, '$.consult_date.date'), next_date) >= ?`,
    )
    .all(from) as AppointmentRow[];
}

function loadLinks(db: Database.Database, appt: AppointmentRow): ClientLinks {
  const row = db
    .prepare(
      `SELECT json_extract(p.raw_column_values, '$.e_file')       AS eFile,
              json_extract(p.raw_column_values, '$.consult_file') AS consultFile,
              json_extract(bi.column_values, '$.consult_sharepoint') AS apptConsult
         FROM board_items bi LEFT JOIN profiles p ON p.local_id = bi.profile_local_id
        WHERE bi.local_id = ?`,
    )
    .get(appt.localId) as ClientLinks | undefined;
  return row ?? { eFile: null, consultFile: null, apptConsult: null };
}

// ---- Copy steps ---------------------------------------------------------------

async function copyToSharePoint(
  auth: GraphAuth,
  dest: Destination,
  file: DriveFile,
  bytes: Buffer,
): Promise<{ url: string; note?: string }> {
  const folder = dest.folder!;
  const existing = (await listChildren(auth, dest.driveId, folder.id)).find((c) => c.name === file.name && c.file);
  if (existing && existing.size === bytes.length) {
    return { url: existing.webUrl, note: "already in SharePoint" };
  }
  // Same name but different content: keep both rather than overwrite.
  const item = await uploadFile(
    auth,
    dest.driveId,
    folder.id,
    file.name,
    bytes,
    file.mimeType || "application/octet-stream",
    existing ? "rename" : "fail",
  );
  return { url: item.webUrl };
}

function updateBody(files: DriveFile[], dest: Destination | null): string {
  const items = files.map((f) => `<li>${escapeHtml(f.name)}</li>`).join("");
  const where = dest?.folder
    ? ` Also copied to the client's ${dest.label} → <a href="${dest.folder.webUrl}">${escapeHtml(dest.folder.name)}</a>.`
    : "";
  return `<p>📎 Documents the client uploaded to Google Drive (${files.length}).${where}</p><ul>${items}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// ---- Upload folder links --------------------------------------------------------

interface LinkedFolder {
  id: string;
  name: string;
  createdTime: string;
  folderPath: string;
  appointmentLocalId: string;
  appt: AppointmentRow | null;
  fromLedger: boolean;
}

/** The "Google Drive Folder" column per appointment board, from config/boards.yaml. */
async function driveColumns(): Promise<Map<string, { boardId: string; columnId: string }>> {
  const out = new Map<string, { boardId: string; columnId: string }>();
  for (const [key, board] of Object.entries(await loadBoardsConfig())) {
    const col = board.columns.google_drive_folder;
    if (col?.resolve === "by_id" && col.id) out.set(key, { boardId: String(board.id), columnId: col.id });
  }
  return out;
}

async function linkFolders(o: {
  db: Database.Database;
  drive: DriveClient;
  rootId: string;
  since: string;
  apply: boolean;
  appointments: AppointmentRow[];
  folderCache: Map<string, DriveFile>;
  receipt: string[];
}) {
  const tally = { written: 0, already: 0, kept: 0, noColumn: 0, review: 0, failed: 0 };
  const hasTable = !!o.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'drive_folders'`).get();
  if (!hasTable && o.apply) {
    console.error("[drive] drive_folders is missing — the database is older than schema v31. Start the API once to migrate it.");
    tally.failed++;
    return tally;
  }

  const ledger = hasTable
    ? (o.db.prepare(`SELECT drive_folder_id AS id, name, drive_created_at AS createdTime, folder_path AS folderPath,
                            appointment_local_id AS appointmentLocalId, match_status AS status, monday_done_at AS doneAt
                       FROM drive_folders`).all() as Array<{
        id: string; name: string; createdTime: string; folderPath: string;
        appointmentLocalId: string | null; status: string; doneAt: string | null;
      }>)
    : [];
  const done = new Set(ledger.filter((r) => r.doneAt).map((r) => r.id));

  const folders = (
    await o.drive.list(
      `mimeType = '${FOLDER_MIME}' and trashed = false and name contains 'Consult Documents' and createdTime >= '${o.since}T00:00:00'`,
    )
  ).filter((f) => parseUploadFolder(f.name) && !done.has(f.id));

  const record = o.db.prepare(`
    INSERT INTO drive_folders
      (drive_folder_id, name, url, folder_path, drive_created_at, match_status, match_detail,
       appointment_local_id, appointment_monday_id, profile_local_id)
    VALUES (@id, @name, @url, @path, @created, @status, @detail, @appt, @apptMonday, @profile)
    ON CONFLICT(drive_folder_id) DO UPDATE SET
      name = excluded.name, folder_path = excluded.folder_path,
      match_status = excluded.match_status, match_detail = excluded.match_detail,
      appointment_local_id = excluded.appointment_local_id,
      appointment_monday_id = excluded.appointment_monday_id,
      profile_local_id = excluded.profile_local_id,
      updated_at = datetime('now')`);
  const finish = (id: string, note: string) =>
    o.db.prepare(`UPDATE drive_folders SET monday_done_at = datetime('now'), monday_note = ?, last_error = NULL, updated_at = datetime('now') WHERE drive_folder_id = ?`)
      .run(note, id);
  const fail = (id: string, message: string) =>
    o.db.prepare(`UPDATE drive_folders SET last_error = ?, updated_at = datetime('now') WHERE drive_folder_id = ?`).run(message, id);

  // Match this run's folders; earlier matched ones come from the ledger.
  const matched: LinkedFolder[] = ledger
    .filter((r) => r.status === "matched" && r.appointmentLocalId)
    .map((r) => ({ ...r, appointmentLocalId: r.appointmentLocalId!, appt: null, fromLedger: true }));
  for (const folder of folders) {
    const ancestors = await ancestorsOf(o.drive, o.rootId, folder, o.folderCache);
    if (!ancestors || !isMonthFolder(ancestors[0])) continue;
    const path = [...ancestors, folder.name];
    const placed = readContext(path);
    const match: MatchResult = placed.ok ? matchUpload(placed.context, o.appointments) : { kind: "unmatched", detail: placed.reason };
    const appt = match.kind === "matched" ? match.appointment : null;
    if (o.apply) {
      record.run({
        id: folder.id, name: folder.name, url: driveFolderUrl(folder.id), path: path.join(" / "),
        created: folder.createdTime, status: match.kind, detail: match.detail,
        appt: appt?.localId ?? null, apptMonday: appt?.mondayItemId ?? null, profile: appt?.profileLocalId ?? null,
      });
    }
    if (!appt) {
      tally.review++;
      console.log(`  review  folder ${folder.name} — ${match.kind}: ${match.detail}`);
      o.receipt.push(row([folder.name, path.join(" / "), `folder-${match.kind}`, "", "", "", match.detail]));
      continue;
    }
    const prior = matched.findIndex((m) => m.id === folder.id);
    if (prior >= 0) matched.splice(prior, 1);
    matched.push({ id: folder.id, name: folder.name, createdTime: folder.createdTime, folderPath: path.join(" / "), appointmentLocalId: appt.localId, appt, fromLedger: false });
  }

  const columns = await driveColumns();
  const newest = newestPerAppointment(matched);
  for (const f of matched) {
    // An earlier booking of an appointment that has a newer folder: nothing to write.
    if (!f.fromLedger && newest.get(f.appointmentLocalId)!.id !== f.id && o.apply) finish(f.id, "superseded");
  }

  for (const f of newest.values()) {
    if (f.fromLedger || !f.appt) continue; // written (or decided) on an earlier run
    const appt = f.appt;
    const who = `${appt.name} (${appt.boardKey}, ${appt.consultDate})`;
    const url = driveFolderUrl(f.id);
    const olderIds = new Set(matched.filter((m) => m.appointmentLocalId === f.appointmentLocalId && m.id !== f.id).map((m) => m.id));
    const column = columns.get(appt.boardKey);

    if (!column || !appt.mondayItemId) {
      tally.noColumn++;
      if (o.apply) finish(f.id, "no-column");
      console.log(`  link    ${who}: ${url} — kept in the app only (no "Google Drive Folder" column on ${appt.boardKey})`);
      o.receipt.push(row([f.name, f.folderPath, "folder-local-only", who, "", appt.mondayItemId, url]));
      continue;
    }

    try {
      // Monday's value, not the synced copy: Zapier or reception may have set it since.
      const current = o.apply
        ? ((await fetchItem(appt.mondayItemId)).column_values.find((c) => c.id === column.columnId)?.text ?? null)
        : localColumnText(o.db, appt.localId, "google_drive_folder");
      const decision = columnDecision(current, f.id, olderIds);
      if (decision === "write" && o.apply) await changeSimpleColumnValue(column.boardId, appt.mondayItemId, column.columnId, url);
      if (o.apply) finish(f.id, decision === "write" ? "written" : decision);
      if (decision === "write") tally.written++;
      else if (decision === "already-set") tally.already++;
      else tally.kept++;
      const verb = decision === "write" ? (o.apply ? "linked" : "would link") : decision === "already-set" ? "already linked" : `kept "${current}"`;
      console.log(`  ${verb}  ${who}  →  ${url}`);
      o.receipt.push(row([f.name, f.folderPath, `folder-${decision}`, who, "", appt.mondayItemId, url]));
    } catch (err) {
      tally.failed++;
      const message = err instanceof Error ? err.message : String(err);
      if (o.apply) fail(f.id, message);
      console.error(`  FAILED  folder link → ${who}: ${message}`);
      o.receipt.push(row([f.name, f.folderPath, "folder-failed", who, "", appt.mondayItemId, message]));
    }
  }
  return tally;
}

function localColumnText(db: Database.Database, localId: string, key: string): string | null {
  const r = db.prepare(`SELECT json_extract(column_values, '$.' || ?) AS v FROM board_items WHERE local_id = ?`).get(key, localId) as
    | { v: unknown }
    | undefined;
  return typeof r?.v === "string" ? r.v : null;
}

// ---- Main -----------------------------------------------------------------------

async function main() {
  const apply = flag("apply");
  const dbPath = (arg("db") ?? "live") === "live" ? "data/live.db" : "data/seed.db";
  const since = arg("since") ?? process.env.DRIVE_INTAKE_SINCE?.trim();
  const rootId = process.env.DRIVE_INTAKE_ROOT_ID?.trim();
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    // Required, never defaulted: the tree holds months of uploads reception
    // already copied by hand, and a default would quietly copy them twice.
    console.error("Set DRIVE_INTAKE_SINCE (or --since=YYYY-MM-DD): files uploaded before it are left alone.");
    process.exit(1);
  }
  if (!rootId) {
    console.error('DRIVE_INTAKE_ROOT_ID is not set (the Drive id of "Virtual Appointments - NEW").');
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: !apply });
  if (apply) db.pragma("busy_timeout = 10000");
  const drive = driveClientFromEnv();
  const auth = graphAuthFromEnv();

  if (apply) {
    const token = process.env.MONDAY_API_TOKEN?.trim();
    if (!token) {
      console.error("MONDAY_API_TOKEN is not set.");
      process.exit(1);
    }
    setApiToken(token);
  }

  console.log(`[drive] ${apply ? "APPLY" : "dry run"} — files uploaded since ${since}`);
  console.log(`[drive] ${drive.describe()} · ${auth.describe()}`);

  const files = await drive.list(
    `mimeType != '${FOLDER_MIME}' and trashed = false and createdTime >= '${since}T00:00:00'`,
  );
  const hasLedger = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'drive_intake_files'`).get();
  if (!hasLedger && apply) {
    console.error("drive_intake_files is missing — the database is older than schema v30. Start the API once to migrate it.");
    process.exit(1);
  }
  const ledger = new Map(
    (hasLedger
      ? (db.prepare(`SELECT drive_file_id, match_status, sp_done_at, monday_done_at FROM drive_intake_files`).all() as LedgerRow[])
      : []
    ).map((r) => [r.drive_file_id, r]),
  );
  const appointments = loadAppointments(db, since);

  // 1–2. Place and match every file not already fully copied.
  const folderCache = new Map<string, DriveFile>();
  const planned: Planned[] = [];
  let outsideTree = 0;
  for (const file of files) {
    const done = ledger.get(file.id);
    if (done && ((done.sp_done_at && done.monday_done_at) || done.match_status === "unsupported")) continue;

    const ancestors = await ancestorsOf(drive, rootId, file, folderCache);
    // Outside the root, or in one of the firm's own folders beside the months.
    if (!ancestors || !isMonthFolder(ancestors[0])) {
      outsideTree++;
      continue;
    }
    const folderPath = ancestors.join(" / ");
    if (file.mimeType.startsWith("application/vnd.google-apps.")) {
      planned.push({ file, folderPath, match: { kind: "unsupported", detail: `Google ${file.mimeType.split(".").pop()} — not a file` } });
      continue;
    }
    if (Number(file.size ?? 0) > MAX_BYTES) {
      planned.push({ file, folderPath, match: { kind: "unsupported", detail: `${file.size} bytes — too large` } });
      continue;
    }
    const placed = readContext(ancestors);
    planned.push({
      file,
      folderPath,
      match: placed.ok ? matchUpload(placed.context, appointments) : { kind: "unmatched", detail: placed.reason },
    });
  }

  const record = db.prepare(`
    INSERT INTO drive_intake_files
      (drive_file_id, name, mime_type, size, drive_created_at, folder_path, match_status, match_detail,
       appointment_local_id, appointment_monday_id, profile_local_id)
    VALUES (@id, @name, @mime, @size, @created, @path, @status, @detail, @appt, @apptMonday, @profile)
    ON CONFLICT(drive_file_id) DO UPDATE SET
      name = excluded.name, folder_path = excluded.folder_path,
      match_status = excluded.match_status, match_detail = excluded.match_detail,
      appointment_local_id = excluded.appointment_local_id,
      appointment_monday_id = excluded.appointment_monday_id,
      profile_local_id = excluded.profile_local_id,
      updated_at = datetime('now')`);
  const stamp = (column: "sp" | "monday", id: string, value: string | null, url?: string) =>
    db.prepare(
      column === "sp"
        ? `UPDATE drive_intake_files SET sp_done_at = datetime('now'), sp_url = ?, last_error = NULL, updated_at = datetime('now') WHERE drive_file_id = ?`
        : `UPDATE drive_intake_files SET monday_done_at = datetime('now'), monday_update_id = ?, last_error = NULL, updated_at = datetime('now') WHERE drive_file_id = ?`,
    ).run(column === "sp" ? (url ?? null) : value, id);
  const fail = (id: string, message: string) =>
    db.prepare(`UPDATE drive_intake_files SET last_error = ?, attempts = attempts + 1, updated_at = datetime('now') WHERE drive_file_id = ?`)
      .run(message, id);

  if (apply) {
    for (const p of planned) {
      const appt = p.match.kind === "matched" ? p.match.appointment : null;
      record.run({
        id: p.file.id,
        name: p.file.name,
        mime: p.file.mimeType,
        size: p.file.size ? Number(p.file.size) : null,
        created: p.file.createdTime,
        path: p.folderPath,
        status: p.match.kind,
        detail: p.match.detail,
        appt: appt?.localId ?? null,
        apptMonday: appt?.mondayItemId ?? null,
        profile: appt?.profileLocalId ?? null,
      });
    }
  }

  // 3–4. Copy, grouped by appointment so each gets one Monday update per run.
  const byAppt = new Map<string, { appt: AppointmentRow; files: DriveFile[] }>();
  for (const p of planned) {
    if (p.match.kind !== "matched") continue;
    const key = p.match.appointment.localId;
    const group = byAppt.get(key) ?? { appt: p.match.appointment, files: [] };
    group.files.push(p.file);
    byAppt.set(key, group);
  }

  const tally = { sharepoint: 0, monday: 0, already: 0, waiting: 0, review: 0, failed: 0 };
  const receipt: string[] = ["file,drive_path,status,appointment,sharepoint,monday,detail"];

  for (const p of planned) {
    if (p.match.kind === "matched") continue;
    tally.review++;
    console.log(`  review  ${p.file.name}   [${p.folderPath}] — ${p.match.kind}: ${p.match.detail}`);
    receipt.push(row([p.file.name, p.folderPath, p.match.kind, "", "", "", p.match.detail]));
  }

  for (const { appt, files: group } of byAppt.values()) {
    const who = `${appt.name} (${appt.boardKey}, ${appt.consultDate})`;
    let dest: Destination | null = null;
    let destProblem: string | null = null;
    try {
      const r = await resolveDestination(auth, loadLinks(db, appt), apply);
      if (r.ok) dest = r.destination;
      else destProblem = r.reason;
    } catch (err) {
      destProblem = `SharePoint lookup failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (!apply) {
      for (const f of group) {
        const sp = dest ? `${dest.label}/${dest.folder?.name ?? "CONSULT (new)"}` : `waiting — ${destProblem}`;
        console.log(`  would copy  ${f.name}  →  ${who}  ·  SharePoint: ${sp}  ·  Monday: update + file`);
        receipt.push(row([f.name, "", "would-copy", who, sp, appt.mondayItemId, ""]));
      }
      continue;
    }

    const toMonday: Array<{ file: DriveFile; bytes: Buffer }> = [];
    const mondayAssets = appt.mondayItemId ? await fetchItemAssets(appt.mondayItemId).catch(() => []) : [];

    for (const file of group) {
      const state = ledger.get(file.id);
      try {
        const bytes = await drive.download(file.id);

        if (!state?.sp_done_at) {
          if (dest?.folder) {
            const r = await copyToSharePoint(auth, dest, file, bytes);
            stamp("sp", file.id, null, r.url);
            if (r.note) tally.already++;
            else tally.sharepoint++;
          } else {
            tally.waiting++;
            fail(file.id, destProblem ?? "no SharePoint folder");
          }
        }

        if (!state?.monday_done_at) {
          if (mondayAssets.some((a) => a.name === file.name && Number(a.file_size) === bytes.length)) {
            stamp("monday", file.id, "already-on-item");
            tally.already++;
          } else {
            toMonday.push({ file, bytes });
          }
        }
        receipt.push(row([file.name, "", "copied", who, dest?.folder?.webUrl ?? destProblem, appt.mondayItemId, ""]));
      } catch (err) {
        tally.failed++;
        const message = err instanceof Error ? err.message : String(err);
        fail(file.id, message);
        console.error(`  FAILED  ${file.name} → ${who}: ${message}`);
        receipt.push(row([file.name, "", "failed", who, "", "", message]));
      }
    }

    if (toMonday.length && appt.mondayItemId) {
      try {
        const updateId = await createUpdate(appt.mondayItemId, updateBody(toMonday.map((t) => t.file), dest));
        for (const { file, bytes } of toMonday) {
          try {
            await addFileToUpdate(updateId, file.name, new Uint8Array(bytes), file.mimeType || "application/octet-stream");
            stamp("monday", file.id, updateId);
            tally.monday++;
          } catch (err) {
            tally.failed++;
            fail(file.id, `Monday attach: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        tally.failed++;
        for (const { file } of toMonday) fail(file.id, `Monday update: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log(`  ${who}: ${group.length} file(s)${dest ? "" : ` — SharePoint waiting: ${destProblem}`}`);
  }

  console.log(
    `[drive] ${files.length} file(s) since ${since}` +
      (outsideTree ? ` (${outsideTree} outside the month folders, ignored)` : "") +
      ` · to SharePoint ${tally.sharepoint} · to Monday ${tally.monday} · already there ${tally.already}` +
      ` · waiting for a folder ${tally.waiting} · for review ${tally.review} · failed ${tally.failed}`,
  );

  // 5. Upload folder links. Harmless to backfill (nothing is copied), so the
  // window can start earlier than the files'.
  const linksSince = arg("links-since") ?? process.env.DRIVE_LINKS_SINCE?.trim() ?? since;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(linksSince)) {
    console.error("--links-since / DRIVE_LINKS_SINCE must be YYYY-MM-DD.");
    process.exit(1);
  }
  const links = await linkFolders({
    db, drive, rootId, since: linksSince, apply, folderCache, receipt,
    appointments: linksSince < since ? loadAppointments(db, linksSince) : appointments,
  });
  console.log(
    `[drive] folder links since ${linksSince}: ${apply ? "written" : "to write"} ${links.written}` +
      ` · already set ${links.already} · other link kept ${links.kept} · app only ${links.noColumn}` +
      ` · for review ${links.review} · failed ${links.failed}`,
  );
  tally.failed += links.failed;

  if (receipt.length > 1) {
    fs.mkdirSync("output", { recursive: true });
    const path = `output/drive-intake-${apply ? "" : "plan-"}${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    fs.writeFileSync(path, receipt.join("\n"));
    console.log(`[drive] ${apply ? "receipt" : "plan"}: ${path}`);
  }
  if (tally.failed) process.exitCode = 1;
}

function row(values: Array<string | null>): string {
  return values.map((v) => `"${(v ?? "").replace(/"/g, '""')}"`).join(",");
}

main().catch((err) => {
  console.error("[drive]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
