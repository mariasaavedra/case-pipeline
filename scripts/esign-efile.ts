// =============================================================================
// Signed contract → the client's E-File (FEE Ks folder), else their consult folder
// =============================================================================
//   npm run esign:efile -- --agreement=<id> [--db=seed]
//   npm run esign:efile -- --profile=<mondayId> --dry-run   # where would it go? (writes nothing)
//
// Started by the API (apps/api/src/esign/efile.ts) once Zap 3's signed copy is
// saved in data/esign/signed-<id>.pdf. File name: ESIGN_DOCUMENT_NAME (the
// standard "Client - Matter - MM-DD-YYYY"). Destination: the profile's E-File
// link, else its Consult File link (a client signs before staff open the
// E-File — decided 2026-10-19), → its Fee K folder
// (scripts/sharepoint/fee-k-folder.ts), created as "FEE Ks" when the client has
// none. Never creates the client folder itself.
// A file of the same name already there = already filed (Zapier retries).
//
// The LAST stdout line is the JSON result the API reads.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { graphAuthFromEnv } from "./sharepoint/auth.js";
import { GraphError, graphFetch } from "./sharepoint/graph-client.js";
import { listChildren, uploadFile, type DriveItem } from "./sharepoint/folders.js";
import { openClientFolder, pickLink } from "./drive/destination.js";
import { FEE_K_FOLDER, pickFeeKFolder } from "./sharepoint/fee-k-folder.js";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const done = (r: Record<string, unknown>) => {
  console.log(JSON.stringify(r));
  process.exit(0);
};

async function main() {
  const dry = process.argv.includes("--dry-run");
  const profile = arg("profile");
  const id = Number(arg("agreement"));
  if (!(dry && profile) && (!Number.isInteger(id) || id <= 0)) return done({ ok: false, reason: "no agreement id" });
  const dbPath = (arg("db") ?? "live") === "live" ? "data/live.db" : "data/seed.db";
  const name = `${(process.env.ESIGN_DOCUMENT_NAME ?? "").trim() || `Signed Fee K ${id}`}.pdf`;

  const db = new Database(dbPath, { readonly: true });
  const row = (dry && profile
    ? db.prepare(`
    SELECT monday_item_id AS profileId, json_extract(raw_column_values, '$.e_file') AS eFile,
           json_extract(raw_column_values, '$.consult_file') AS consultFile
      FROM profiles WHERE monday_item_id = ?`).get(profile)
    : db.prepare(`
    SELECT a.profile_monday_id AS profileId, json_extract(p.raw_column_values, '$.e_file') AS eFile,
           json_extract(p.raw_column_values, '$.consult_file') AS consultFile
      FROM esign_agreements a LEFT JOIN profiles p ON p.monday_item_id = a.profile_monday_id
     WHERE a.id = ?`).get(id)) as { profileId: string | null; eFile: string | null; consultFile: string | null } | undefined;
  db.close();
  if (!row) return done({ ok: false, reason: "agreement not found" });
  if (!row.profileId) return done({ ok: false, reason: "the Fee K is not linked to a client profile" });
  const link = pickLink({ eFile: row.eFile, consultFile: row.consultFile, apptConsult: null });
  if (!link) return done({ ok: false, reason: "the client has no E-File or Consult File link on their profile" });
  const where = link.label;

  const file = path.join("data", "esign", `signed-${id}.pdf`);
  if (!dry && !fs.existsSync(file)) return done({ ok: false, reason: "the signed PDF was not saved" });

  const auth = graphAuthFromEnv();
  const client = await openClientFolder(auth, link.url);
  if (!client.ok) return done({ ok: false, reason: client.reason.replace(/^Link/, `${where} link`) });
  const { driveId, item } = client;

  let folder = pickFeeKFolder(await listChildren(auth, driveId, item.id));
  if (dry) return done({ ok: true, dry: true, where, client: item.name, folder: folder?.name ?? `${FEE_K_FOLDER} (would be created)`, name });
  if (!folder) {
    try {
      folder = await graphFetch<DriveItem>(auth, `/drives/${driveId}/items/${item.id}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: FEE_K_FOLDER, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      });
    } catch (err) {
      if (!(err instanceof GraphError && err.status === 409)) throw err;
      folder = pickFeeKFolder(await listChildren(auth, driveId, item.id));
      if (!folder) throw err;
    }
  }

  const existing = (await listChildren(auth, driveId, folder.id)).find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return done({ ok: true, already: true, where, folder: folder.name, name, webUrl: existing.webUrl });
  const up = await uploadFile(auth, driveId, folder.id, name, fs.readFileSync(file), "application/pdf", "fail");
  done({ ok: true, where, folder: folder.name, name: up.name, webUrl: up.webUrl });
}

main().catch((err) => done({ ok: false, reason: err instanceof Error ? err.message.slice(0, 200) : "error" }));
