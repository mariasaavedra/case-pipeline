// =============================================================================
// Staff import — the firm's staff table → the roster (users.db)
// =============================================================================
//   npm run staff:import -- staff.csv            dry run: prints what would change
//   npm run staff:import -- staff.csv --apply    writes it (audited staff.imported)
//   … -                                          read the CSV from stdin
//
// Columns: name, email, monday_user_id, monday_status (active / disabled),
// slack_user_id (U…), initials, class, rc_number, rc_ext. Rules (match by
// Monday id → email → name, Settings-reviewed roles kept, retired = inactive
// only) are in apps/api/src/staff/import.ts. Nothing is written to Monday or
// Slack. On the server: docker exec -i <api> npm run staff:import -- - < staff.csv
// =============================================================================

import fs from "node:fs";
import { usersDb } from "../apps/api/src/db/users-db.js";
import { recordAudit } from "../apps/api/src/audit/log.js";
import { applyStaffImport, parseStaffCsv, planStaffImport } from "../apps/api/src/staff/import.js";

const apply = process.argv.includes("--apply");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: npm run staff:import -- <staff.csv | -> [--apply]");
  process.exit(1);
}

const text = fs.readFileSync(file === "-" ? 0 : file, "utf8");
const { rows, problems } = parseStaffCsv(text);
for (const p of problems) console.log(`  ! ${p}`);

const plan = planStaffImport(usersDb, rows);
for (const step of plan) {
  const who = step.rosterName && step.rosterName !== step.row.name ? `${step.row.name} (roster: ${step.rosterName})` : step.row.name;
  console.log(`${step.action.toUpperCase().padEnd(6)} ${who}`);
  for (const c of step.changes) console.log(`         ${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`);
  if (step.note) console.log(`         note: ${step.note}`);
}

const count = (a: string) => plan.filter((s) => s.action === a).length;
console.log(
  `\n${rows.length} rows: ${count("create")} new, ${count("update")} to update, ${count("same")} unchanged, ` +
    `${count("skip")} skipped, ${problems.length} unreadable`,
);

if (!apply) {
  console.log("Dry run — nothing written. Re-run with --apply.");
  process.exit(0);
}
const result = applyStaffImport(usersDb, plan);
recordAudit({
  actor: { userId: null, email: "script:staff-import" },
  action: "staff.imported",
  targetType: "staff",
  metadata: { ...result, unreadable: problems.length },
});
console.log(`Applied: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped} skipped.`);
