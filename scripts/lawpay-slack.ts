// =============================================================================
// What the #payments reader would do — read-only
// =============================================================================
//   npm run lawpay:slack                  # last 3 days (LAWPAY_SLACK_SINCE_DAYS)
//   npm run lawpay:slack -- --db=seed
//
// Reads #payments with the app's Slack bot, picks the LawPay "Payment Bot"
// posts with one of our references, and prints which Fee K each one matches and
// how (code / link / name). Writes nothing, stores nothing, moves no cursor.
// The schedule (LAWPAY_SLACK=on) runs the same code for real.
// =============================================================================

import Database from "better-sqlite3";
import { runLawPaySlackJob } from "../apps/api/src/lawpay/slack-job.js";

const dbArg = process.argv.find((a) => a.startsWith("--db="))?.split("=")[1] ?? "live";
const db = new Database(dbArg === "live" ? "data/live.db" : "data/seed.db", { readonly: true });
const r = await runLawPaySlackJob({ db, mondayApiToken: undefined }, { dryRun: true });
if (!r) process.exit(0);
if (!r.ok) {
  console.error(`Failed: ${r.error}`);
  process.exit(1);
}
console.log(`${r.read} post(s) read, ${r.payments} LawPay payment(s) with one of our references:`);
for (const p of r.dryRun ?? []) {
  console.log(`  $${p.amount.toFixed(2)}  ${p.reference}  →  ${p.feeK ? `${p.feeK} [by ${p.by}]` : "NO MATCH (would go to Slack 'Payment to match')"}`);
}
