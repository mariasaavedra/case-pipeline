// =============================================================================
// Remove duplicate consult folders the backfill should not have created
// =============================================================================
//   npx tsx --env-file-if-exists=.env scripts/consult-delete-dupes.ts <list.txt>
//   … --apply
//
// Reads one folder path per line. Refuses anything that is not empty or was not
// created recently (see sharepoint/delete-empty.ts). Deletions go to the
// SharePoint recycle bin and are recoverable there.
// =============================================================================

import fs from "node:fs";
import { graphAuthFromEnv } from "./sharepoint/auth.js";
import { resolveSiteDrive } from "./sharepoint/folders.js";
import { deleteEmptyFolder } from "./sharepoint/delete-empty.js";

const HOST = "sharmacrawford.sharepoint.com";
const SITE = "scalconsults";

async function main() {
  const listPath = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!listPath || listPath.startsWith("--")) {
    console.error("Usage: scripts/consult-delete-dupes.ts <paths.txt> [--apply]");
    process.exit(1);
  }

  const paths = fs.readFileSync(listPath, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const auth = graphAuthFromEnv();
  const drive = await resolveSiteDrive(auth, HOST, SITE);

  console.log(`${apply ? "Deleting" : "Dry run"} — ${paths.length} folder(s) in ${drive.siteName}\n`);

  const tally = { deleted: 0, would: 0, skipped: 0 };
  const receipt = ["path,outcome,reason"];

  for (const path of paths) {
    const result = await deleteEmptyFolder(auth, drive.driveId, path, { apply, maxAgeHours: 24 });
    if (result.kind === "deleted") { tally.deleted++; console.log(`  deleted       ${path}`); }
    else if (result.kind === "would-delete") { tally.would++; console.log(`  would delete  ${path}`); }
    else { tally.skipped++; console.log(`  SKIPPED       ${path}\n                ${result.reason}`); }
    receipt.push(`"${path}","${result.kind}","${result.kind === "skipped" ? result.reason : ""}"`);
  }

  if (apply) {
    fs.mkdirSync("output", { recursive: true });
    const p = `output/consult-deleted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    fs.writeFileSync(p, receipt.join("\n"));
    console.log(`\n  receipt: ${p}`);
  }
  console.log(`\n  deleted ${tally.deleted}   would delete ${tally.would}   skipped ${tally.skipped}`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
