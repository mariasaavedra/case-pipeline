// =============================================================================
// SharePoint folder creation — CLI
// =============================================================================
// Runs as a signed-in person via the device code flow (see sharepoint/auth.ts),
// using the delegated Files.ReadWrite.All grant the dashboard already has. No
// application permission, no client secret.
//
//   # 1. Sign in once. Prints a code to enter in a browser.
//   npm run sharepoint:folders -- --login
//
//   # 2. Verify access to a site (read-only)
//   npm run sharepoint:folders -- --site=scalconsults --check
//
//   # 3. Dry run — resolves and reports, writes NOTHING
//   npm run sharepoint:folders -- --site=scalconsults --path="ZZ Pipeline Test/Correspondence"
//
//   # 4. Same command with --apply actually creates it
//   npm run sharepoint:folders -- --site=scalconsults --path="ZZ Pipeline Test/..." --apply
//
// Writing requires --apply. That is not a formality: these are live client
// files, and a dry run is the difference between reading a plan and finding out
// what happened.
// =============================================================================

import { GraphError } from "./sharepoint/graph-client.js";
import { graphAuthFromEnv, deviceLogin, clearCachedLogin, cachedAccount } from "./sharepoint/auth.js";
import { resolveSiteDrive, ensureFolderPath, getItemByPath, listChildren } from "./sharepoint/folders.js";

const DEFAULT_HOST = "sharmacrawford.sharepoint.com";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  if (flag("logout")) {
    console.log(clearCachedLogin() ? "Saved sign-in removed." : "There was no saved sign-in.");
    return;
  }

  if (flag("login")) {
    await deviceLogin();
    return;
  }

  const site = arg("site");
  const host = arg("host") ?? DEFAULT_HOST;
  const path = arg("path");
  const apply = flag("apply");
  const check = flag("check");
  const list = flag("list");

  if (!site || (!path && !check && !list)) {
    console.error(
      "Usage:\n" +
        "  --login                                   sign in (device code), once\n" +
        "  --logout                                  forget the saved sign-in\n" +
        "  --site=<name> --check                     verify access to the site (read-only)\n" +
        "  --site=<name> [--path=<folder>] --list    list a folder's contents (read-only)\n" +
        "  --site=<name> --path=<folder/subfolder>   dry run\n" +
        "  --site=<name> --path=<...> --apply        create it\n" +
        "\nOptions:\n" +
        `  --host=<tenant host>   default ${DEFAULT_HOST}\n`,
    );
    process.exit(1);
  }

  const auth = graphAuthFromEnv();
  console.log(`Auth   ${auth.describe()}`);

  const drive = await resolveSiteDrive(auth, host, site);
  console.log(`Site   ${drive.siteName}  (${drive.webUrl})`);
  console.log(`Drive  ${drive.driveId}`);

  if (check) {
    const root = await getItemByPath(auth, drive.driveId, "");
    console.log(`Root   ${root?.folder?.childCount ?? 0} items — read access confirmed.`);
    console.log("\nRead access works. Write access is only proven by an --apply run.");
    return;
  }

  if (list) {
    const target = await getItemByPath(auth, drive.driveId, path ?? "");
    if (!target) {
      console.log(`\nNo such folder: ${path ?? "(root)"}`);
      return;
    }
    const kids = await listChildren(auth, drive.driveId, target.id);
    console.log(`\n${path ?? "(root)"} — ${kids.length} items\n`);
    for (const k of kids.slice(0, 40)) {
      console.log(`  ${k.folder ? "[dir]" : "     "}  ${k.name}`);
    }
    if (kids.length > 40) console.log(`  … and ${kids.length - 40} more`);
    return;
  }

  console.log(`Mode   ${apply ? "APPLY — this will create folders" : "dry run — nothing will be written"}\n`);

  const results = await ensureFolderPath(auth, drive.driveId, path!, apply);
  for (const r of results) {
    const mark = r.outcome === "created" ? "created  " : r.outcome === "existed" ? "exists   " : "would add";
    console.log(`  ${mark}  ${r.path}`);
  }

  const created = results.filter((r) => r.outcome === "created").length;
  const pending = results.filter((r) => r.outcome === "would-create").length;

  console.log(
    apply
      ? `\n${created} folder(s) created, ${results.length - created} already existed.`
      : `\n${pending} folder(s) would be created. Re-run with --apply to do it.`,
  );
}

main().catch((err) => {
  if (err instanceof GraphError) {
    const hint =
      err.status === 401
        ? "\nRun:  npm run sharepoint:folders -- --login"
        : err.status === 403
          ? `\n${cachedAccount() ?? "The signed-in account"} does not have access to this folder in SharePoint.` +
            "\nThis runs with that person's own rights — grant them access, or sign in as someone who has it."
          : err.status === 404
            ? "\nSite not found — check --site and --host."
            : err.code === "invalid_client" || /7000218/.test(err.message)
              ? "\n\"Allow public client flows\" is still disabled on the app registration."
              : "";
    console.error(`\nGraph ${err.status}${err.code ? ` (${err.code})` : ""}: ${err.message}${hint}`);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
