// =============================================================================
// Fee K auto-fill — what the scheduled job would write, or write it now
// =============================================================================
//   npm run feek:autofill -- --since=2026-10-01            dry run (default)
//   npm run feek:autofill -- --since=2026-10-01 --apply    write to Monday
//
// Same code the API runs every 15 min when FEE_K_AUTOFILL=on
// (apps/api/src/fee-k-autofill.ts). --since defaults to FEE_K_AUTOFILL_SINCE.
// A dry run opens live.db read-only and never calls Monday.
// =============================================================================

import Database from "better-sqlite3";
import { setApiToken } from "@case-pipeline/monday";
import { mondayFeeKIo, runFeeKAutofill } from "../apps/api/src/fee-k-autofill.js";
import { feeKTypeLookup, initFeeKTypes, loadFeeKTypes } from "../apps/api/src/fee-k-types.js";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const apply = process.argv.includes("--apply");
const since = arg("since") ?? process.env.FEE_K_AUTOFILL_SINCE?.trim();
if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error("Pass --since=YYYY-MM-DD (or set FEE_K_AUTOFILL_SINCE): only Fee Ks added on/after it are filled.");
  process.exit(1);
}
const dbPath = (arg("db") ?? "live") === "live" ? "data/live.db" : "data/seed.db";
const db = new Database(dbPath, { readonly: !apply });

let io = { read: async () => null, write: async () => {} } as Awaited<ReturnType<typeof mondayFeeKIo>>;
if (apply) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    console.error("MONDAY_API_TOKEN is not set.");
    process.exit(1);
  }
  setApiToken(token);
  io = await mondayFeeKIo();
}

// The Fee K Types table the API saved (Settings → Firm): fills "It will go to…".
initFeeKTypes("data");
const routing = feeKTypeLookup(loadFeeKTypes());
const r = await runFeeKAutofill({ db, since, apply, ...io, boardFor: (t) => routing(t)?.board || null, log: (l) => console.log(l) });
console.log(
  `\n${apply ? "" : "DRY RUN — "}${r.candidates} Fee K(s) since ${since} with something to fill; ` +
    `${apply ? "filled" : "would fill"} ${r.written.length}, skipped ${r.skipped.length}, failed ${r.failed.length}.`,
);
for (const s of r.skipped) console.log(`  skipped ${s.name} (${s.mondayItemId}): ${s.reason}`);
for (const f of r.failed) console.log(`  FAILED ${f.name} (${f.mondayItemId}): ${f.error}`);
if (!apply) console.log("Nothing was written. Add --apply to write.");
db.close();
process.exit(r.failed.length ? 1 : 0);
