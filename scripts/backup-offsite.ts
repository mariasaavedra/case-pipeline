// =============================================================================
// Off-site backups — the newest encrypted backups → a SharePoint folder
// =============================================================================
// The daily backup (server.ts runBackup) writes encrypted copies of live.db and
// users.db into data/backups/ — on the same disk as the databases. Losing the
// droplet lost every backup with it (audit 2026-10-24, H2). This copies the
// newest `live-…db.enc` and `users-…db.enc` to SharePoint and keeps the newest
// BACKUP_OFFSITE_KEEP (default 7) of each there.
//
// Only `.db.enc` files ever leave the server (refuseReason). The copies are
// useless without BACKUP_ENCRYPTION_KEY — and users.db's Monday tokens without
// APP_ENCRYPTION_KEY — so both keys must also live outside the server (the
// firm's password manager). Restore: docs/backups.md.
//
// Graph auth is the same delegated sign-in the consult sweep uses
// (`npm run sharepoint:folders -- --login` once on the host).
//
// Usage:
//   npm run backup:offsite                 # dry run: what would be uploaded / pruned
//   npm run backup:offsite -- --apply      # upload + prune
//
// Env: BACKUP_OFFSITE_SITE (SharePoint site name, required),
//      BACKUP_OFFSITE_PATH (folder in its library, default "App Backups/case-pipeline"),
//      BACKUP_OFFSITE_KEEP (copies per series, default 7). Run by the API after
//      each daily backup when BACKUP_OFFSITE=on.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { graphAuthFromEnv, cachedAccount } from "./sharepoint/auth.js";
import { graphFetch } from "./sharepoint/graph-client.js";
import { HOST } from "./sharepoint/scan.js";
import { resolveSiteDrive, ensureFolderPath, getItemByPath, listChildren, uploadFileFromPath } from "./sharepoint/folders.js";
import { newestPerSeries, refuseReason, remoteToPrune, chunkRanges, SERIES } from "./lib/offsite-backups.js";

const apply = process.argv.includes("--apply");
const BACKUP_DIR = path.join("data", "backups");

async function main(): Promise<void> {
  const site = process.env.BACKUP_OFFSITE_SITE?.trim();
  const folderPath = process.env.BACKUP_OFFSITE_PATH?.trim() || "App Backups/case-pipeline";
  const keep = Math.max(1, Number(process.env.BACKUP_OFFSITE_KEEP) || 7);
  if (!site) throw new Error("BACKUP_OFFSITE_SITE is not set — the SharePoint site to keep backups in");

  const local = newestPerSeries(fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR) : []);
  for (const s of SERIES) {
    const name = local[s];
    if (!name) throw new Error(`No ${s}-*.db.enc backup in ${BACKUP_DIR} — is BACKUP_ENCRYPTION_KEY set?`);
    const refused = refuseReason(name);
    if (refused) throw new Error(refused);
  }

  const auth = graphAuthFromEnv();
  console.log(`[offsite] ${apply ? "APPLY" : "dry run"} — ${HOST}/sites/${site}/${folderPath}, keep ${keep}, as ${cachedAccount() ?? "app-only"}`);
  const drive = await resolveSiteDrive(auth, HOST, site);
  await ensureFolderPath(auth, drive.driveId, folderPath, apply);
  const folder = await getItemByPath(auth, drive.driveId, folderPath);

  const remote = folder ? (await listChildren(auth, drive.driveId, folder.id)).filter((i) => i.file) : [];
  const remoteNames = new Set(remote.map((i) => i.name));

  for (const s of SERIES) {
    const name = local[s]!;
    const file = path.join(BACKUP_DIR, name);
    const size = fs.statSync(file).size;
    if (remoteNames.has(name)) {
      console.log(`[offsite] ${name} already uploaded`);
      continue;
    }
    if (!apply || !folder) {
      console.log(`[offsite] would upload ${name} (${(size / 1_048_576).toFixed(1)} MB)`);
      continue;
    }
    const started = Date.now();
    // "fail": a name is a timestamp, so an existing one is this same file.
    await uploadFileFromPath(auth, drive.driveId, folder.id, name, file, chunkRanges(size), "fail");
    remoteNames.add(name);
    console.log(`[offsite] uploaded ${name} (${(size / 1_048_576).toFixed(1)} MB, ${Math.round((Date.now() - started) / 1000)} s)`);
  }

  // Prune only after both uploads landed, and only names of our own two series.
  for (const name of remoteToPrune([...remoteNames], keep)) {
    const item = remote.find((i) => i.name === name);
    if (!apply || !item) {
      console.log(`[offsite] would delete old copy ${name}`);
      continue;
    }
    await graphFetch<void>(auth, `/drives/${drive.driveId}/items/${item.id}`, { method: "DELETE" });
    console.log(`[offsite] deleted old copy ${name}`);
  }
}

main().catch((err) => {
  console.error(`[offsite] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
