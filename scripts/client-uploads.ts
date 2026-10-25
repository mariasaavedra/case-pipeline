// =============================================================================
// Client uploads → the client's E-File → CAF (docs/features/client-uploads.md)
// =============================================================================
//   npm run uploads:file                  # dry run: where each waiting file would go
//   npm run uploads:file -- --apply       # upload to SharePoint + stamp the rows
//   --db=seed | live (default live)       # seed: never writes to SharePoint
//   --quiet=10                            # minutes since the link's last file (0 = now)
//   --data-dir=data                       # where live.db / seed.db / uploads/ are (tests)
//
// Started by the API (apps/api/src/uploads/job.ts) after a batch goes quiet
// and every 15 min as a sweep. Files wait in data/uploads/ (client_uploads,
// schema v37). Destination: the profile's E-File link, else its Consult File
// link (pickLink, as Drive intake and esign:efile), → its CAF folder, or for a
// Buzón checklist document its case's "EVIDENCE <Fee K Type>" folder
// (docs/features/buzon.md), created when missing. Never creates the client folder itself: no link = "waiting",
// tried again on the next run.
//
// A consult's checklist documents (Phase 5) go to the Consult File (else the
// E-File) → CONSULT. iPhone photos (HEIC) go up as JPG, and several photos for
// one checklist document in one batch go up as one PDF (Phase 3,
// apps/api/src/uploads/convert.ts); each row still gets the SharePoint link.
//
// Each file's filing is stamped on its row (filed_at …) so a retry only redoes
// what failed; a file already in CAF with the same name and size counts as
// filed. Telling staff (Monday update + Slack) is the API's half.
//
// The LAST stdout line is the JSON result the API reads.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { graphAuthFromEnv } from "./sharepoint/auth.js";
import { GraphError, graphFetch, type GraphAuth } from "./sharepoint/graph-client.js";
import { listChildren, uploadFile, type DriveItem } from "./sharepoint/folders.js";
import { openClientFolder, pickLink } from "./drive/destination.js";
import { MAX_ATTEMPTS, QUIET_MINUTES, alreadyFiled, folderFor, pickFolder } from "../apps/api/src/uploads/filing.js";
import { imagesToPdf, openable, toUnits, type FileBytes, type Unit } from "../apps/api/src/uploads/convert.js";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

interface Row {
  id: number;
  link_id: number;
  stored_name: string;
  local_file: string;
  size: number;
  content_type: string;
  profile_local_id: string;
  profile_monday_id: string | null;
  item_id: number | null;
  /** The checklist document's Fee K Type → EVIDENCE <type>; NULL → CAF. */
  fee_k_type: string | null;
  /** A consult's document → Consult File → CONSULT. */
  appointment_monday_id: string | null;
  /** That appointment's own consult folder link, if any. */
  appt_consult: string | null;
}

interface Result {
  ok: boolean;
  dry: boolean;
  filed: number;
  already: number;
  /** Profiles (Monday id, else local id) with files and no folder recorded yet. */
  waiting: { profile: string; files: number; reason: string }[];
  failed: { upload: number; reason: string }[];
  plan?: { upload: number; where: string; folder: string; name: string }[];
  reason?: string;
}

function done(r: Result): never {
  console.log(JSON.stringify(r));
  process.exit(0);
}

async function main() {
  const dbKind = arg("db") ?? "live";
  const seed = dbKind === "seed";
  const dry = !process.argv.includes("--apply") || seed;
  const quiet = Number(arg("quiet") ?? QUIET_MINUTES);
  if (!Number.isInteger(quiet) || quiet < 0) {
    return done({ ok: false, dry, filed: 0, already: 0, waiting: [], failed: [], reason: "--quiet must be whole minutes" });
  }
  if (seed && process.argv.includes("--apply")) console.error("[uploads] seed data: dry run only, nothing goes to SharePoint.");

  const dataDir = arg("data-dir") ?? "data";
  // fileMustExist: a wrong folder must fail, not create an empty database.
  const db = new Database(path.join(dataDir, seed ? "seed.db" : "live.db"), { readonly: dry, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  const uploadDir = path.join(dataDir, "uploads");

  // A link's batch is ready once nothing new has come in on it for `quiet` minutes.
  const rows = db.prepare(`
    SELECT u.id, u.link_id, u.item_id, u.stored_name, u.local_file, u.size, u.content_type, l.profile_local_id, l.profile_monday_id,
           i.fee_k_type, i.appointment_monday_id,
           (SELECT json_extract(b.column_values, '$.consult_sharepoint') FROM board_items b
             WHERE b.monday_item_id = i.appointment_monday_id AND b.deleted_at IS NULL LIMIT 1) AS appt_consult
      FROM client_uploads u JOIN upload_links l ON l.id = u.link_id
      LEFT JOIN upload_checklist_items i ON i.id = u.item_id
     WHERE u.filed_at IS NULL AND u.local_file IS NOT NULL AND u.attempts < ?
       AND NOT EXISTS (SELECT 1 FROM client_uploads n WHERE n.link_id = u.link_id AND n.received_at > datetime('now', ?))
     ORDER BY u.id
  `).all(MAX_ATTEMPTS, `-${quiet} minutes`) as Row[];

  const result: Result = { ok: true, dry, filed: 0, already: 0, waiting: [], failed: [], ...(dry ? { plan: [] } : {}) };
  if (!rows.length) {
    db.close();
    return done(result);
  }

  const stampFiled = dry ? null : db.prepare(`
    UPDATE client_uploads SET filed_at = datetime('now'), sharepoint_item_id = ?, sharepoint_url = ?, filed_where = ?, last_error = NULL
     WHERE id = ?`);
  const stampFailed = dry ? null : db.prepare("UPDATE client_uploads SET attempts = attempts + 1, last_error = ? WHERE id = ?");
  const stampWaiting = dry ? null : db.prepare("UPDATE client_uploads SET last_error = ? WHERE id = ?");
  const fail = (ids: number[], reason: string) => {
    for (const id of ids) {
      stampFailed?.run(reason.slice(0, 300), id);
      result.failed.push({ upload: id, reason });
    }
  };

  // One client at a time: one folder lookup per client, not per file.
  const byProfile = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.profile_monday_id ?? `local:${r.profile_local_id}`;
    byProfile.set(key, [...(byProfile.get(key) ?? []), r]);
  }

  const profileLinks = db.prepare(`
    SELECT json_extract(raw_column_values, '$.e_file') AS eFile, json_extract(raw_column_values, '$.consult_file') AS consultFile
      FROM profiles WHERE deleted_at IS NULL AND (monday_item_id = ? OR (? IS NULL AND local_id = ?))
     LIMIT 1`);

  const stampCombined = dry ? null : db.prepare("UPDATE client_uploads SET combined_into = ? WHERE id = ?");

  let auth: GraphAuth | null = null;
  clients: for (const [key, files] of byProfile) {
    const first = files[0]!;
    const links = profileLinks.get(first.profile_monday_id, first.profile_monday_id, first.profile_local_id) as
      { eFile: string | null; consultFile: string | null } | undefined;

    // Each file's client folder: a consult's document prefers the consult folder, the rest the E-File.
    const byDest = new Map<string, { link: { url: string; label: string }; rows: Row[] }>();
    const nowhere: Row[] = [];
    for (const f of files) {
      const link = !links ? null : f.appointment_monday_id
        ? pickLink({ eFile: null, consultFile: links.consultFile, apptConsult: f.appt_consult }) ?? pickLink({ eFile: links.eFile, consultFile: null, apptConsult: null })
        : pickLink({ eFile: links.eFile, consultFile: links.consultFile, apptConsult: null });
      if (!link) nowhere.push(f);
      else byDest.set(link.url, { link, rows: [...(byDest.get(link.url)?.rows ?? []), f] });
    }
    if (nowhere.length) {
      const reason = links ? "waiting: no E-File or Consult File link on the profile" : "waiting: profile not found";
      for (const f of nowhere) stampWaiting?.run(reason, f.id);
      result.waiting.push({ profile: key, files: nowhere.length, reason });
    }

    for (const { link, rows: destRows } of byDest.values()) {
      const ids = destRows.map((f) => f.id);
      try {
        auth ??= graphAuthFromEnv();
        const client = await openClientFolder(auth, link.url);
        if (!client.ok) {
          fail(ids, client.reason.replace(/^Link/, `${link.label} link`));
          continue;
        }
        const { driveId, item } = client;
        const top = await listChildren(auth, driveId, item.id);
        // CAF, EVIDENCE <case type> or CONSULT: one lookup per folder.
        const byFolder = new Map<string, Row[]>();
        for (const f of destRows) {
          const name = folderFor(f.fee_k_type, f.appointment_monday_id);
          byFolder.set(name, [...(byFolder.get(name) ?? []), f]);
        }

        for (const [name, inIt] of byFolder) {
          const units = toUnits(inIt);
          if (dry) {
            const found = pickFolder(top, name);
            for (const u of units) {
              for (const f of u.rows) result.plan!.push({ upload: f.id, where: link.label, folder: `${item.name}/${found?.name ?? `${name} (would be created)`}`, name: u.name });
            }
            continue;
          }
          const folder = pickFolder(top, name) ?? (await createFolder(auth, driveId, item.id, name));
          const inFolder = await listChildren(auth, driveId, folder.id);
          for (const u of units) {
            const unitIds = u.rows.map((f) => f.id);
            const missing = u.rows.find((f) => !fs.existsSync(path.join(uploadDir, f.local_file)));
            if (missing) {
              fail(unitIds, "the file is missing from data/uploads");
              continue;
            }
            try {
              const file = await unitFile(u, uploadDir);
              const existing = alreadyFiled(inFolder, file.name, file.bytes.length);
              const up = existing ?? (await uploadFile(auth, driveId, folder.id, file.name, file.bytes, file.contentType, "rename"));
              for (const f of u.rows) {
                stampFiled!.run(up.id, up.webUrl, link.label, f.id);
                if (f !== u.rows[0]) stampCombined!.run(u.rows[0]!.id, f.id);
              }
              if (existing) result.already += u.rows.length;
              else result.filed += u.rows.length;
            } catch (err) {
              fail(unitIds, err instanceof Error ? err.message.slice(0, 200) : "upload failed");
            }
          }
        }
      } catch (err) {
        // Sign-in lapsed, Graph down: nothing for this client was filed. The next run retries.
        fail(ids, err instanceof Error ? err.message.slice(0, 200) : "error");
        if (err instanceof GraphError && err.status === 401) break clients;
      }
    }
  }

  db.close();
  done(result);
}

/** The bytes that go up: one file as it is (HEIC → JPG), or the photos as one PDF. */
async function unitFile(u: Unit<Row>, uploadDir: string): Promise<FileBytes> {
  const files = await Promise.all(u.rows.map((f) =>
    openable({ bytes: fs.readFileSync(path.join(uploadDir, f.local_file)), contentType: f.content_type, name: f.stored_name })));
  if (files.length === 1) return { ...files[0]!, name: u.name };
  return { bytes: await imagesToPdf(files), contentType: "application/pdf", name: u.name };
}

/** CAF / EVIDENCE … under the client folder; one made by someone else meanwhile is reused. */
async function createFolder(auth: GraphAuth, driveId: string, parentId: string, name: string): Promise<DriveItem> {
  try {
    return await graphFetch<DriveItem>(auth, `/drives/${driveId}/items/${parentId}/children`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
  } catch (err) {
    if (err instanceof GraphError && err.status === 409) {
      const existing = pickFolder(await listChildren(auth, driveId, parentId), name);
      if (existing) return existing;
    }
    throw err;
  }
}

main().catch((err) =>
  done({ ok: false, dry: true, filed: 0, already: 0, waiting: [], failed: [], reason: err instanceof Error ? err.message.slice(0, 200) : "error" }),
);
