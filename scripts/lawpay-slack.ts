// =============================================================================
// What the #payments reader would do — read-only
// =============================================================================
//   npm run lawpay:slack                  # last 3 days (LAWPAY_SLACK_SINCE_DAYS)
//   npm run lawpay:slack -- --db=seed
//   npm run lawpay:slack -- --start-now   # before LAWPAY_SLACK=on: skip the backlog
//
// Reads #payments with the app's Slack bot, picks the LawPay "Payment Bot"
// posts with one of our references, and prints which Fee K each one matches and
// how (code / link / name). Writes nothing, stores nothing, moves no cursor.
// The schedule (LAWPAY_SLACK=on) runs the same code for real.
// =============================================================================

import Database from "better-sqlite3";
import { runLawPaySlackJob, startFromNow } from "../apps/api/src/lawpay/slack-job.js";

if (process.argv.includes("--start-now")) {
  // The only write this script makes: where the reader starts.
  const ts = startFromNow();
  console.log(`The #payments reader will start with posts after ${new Date(Number(ts) * 1000).toISOString()}.`);
  process.exit(0);
}

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
  const outcome = p.feeK ? `${p.feeK} [by ${p.by}]`
    : p.closed ? `client's Fee K is already in ${p.closed} — recorded quietly, no alert`
      : "NO MATCH (would go to Slack 'Payment to match')";
  console.log(`  $${p.amount.toFixed(2)}  ${p.reference}  →  ${outcome}`);
}
