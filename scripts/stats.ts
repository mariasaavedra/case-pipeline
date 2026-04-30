// =============================================================================
// Database Stats — Internal diagnostic tool
//
// Usage:
//   bun scripts/stats.ts              # seed.db (default)
//   bun scripts/stats.ts --db=live    # live.db
//
// Also importable as a module — call printStats(db) after a sync run.
// =============================================================================

import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { validateSchema } from "./seed/lib/db/schema";

const BOARD_LABELS: Record<string, string> = {
  profiles:                    "Profiles",
  fee_ks:                      "Fee Ks (Contracts)",
  appointments_wh:             "Appointments WH",
  appointments_lb:             "Appointments LB",
  appointments_m:              "Appointments M",
  appointments_r:              "Appointments R",
  court_cases:                 "Court Cases",
  _cd_open_forms:              "Open Forms",
  foias:                       "FOIAs",
  appeals:                     "Appeals",
  motions:                     "Motions",
  litigation:                  "Litigation",
  rfes_all:                    "RFEs",
  nvc_notices:                 "NVC Notices",
  address_changes:             "Address Changes",
  _fa_jail_intakes:            "Jail Intakes",
  _na_originals_cards_notices: "Originals / Cards / Notices",
  calendaring:                 "Calendaring",
};

interface BoardStat {
  boardKey: string;
  label: string;
  total: number;
  withProfile: number;
  orphaned: number;
}

export interface GroupStat {
  boardKey: string;
  boardLabel: string;
  groupTitle: string;
  count: number;
}

interface ProfileStat {
  total: number;
  withANumber: number;
  withDob: number;
  withEmail: number;
  withPhone: number;
}

interface ContractStat {
  total: number;
  active: number;
  closed: number;
}

interface UpdateStat {
  total: number;
  linkedToProfile: number;
}

export interface StatsReport {
  dbPath: string;
  generatedAt: string;
  profiles: ProfileStat;
  contracts: ContractStat;
  updates: UpdateStat;
  boards: BoardStat[];
  groups: GroupStat[];
  totalItems: number;
  totalOrphaned: number;
}

export function gatherStats(db: DatabaseInstance, dbPath: string): StatsReport {
  // Profile stats
  const profileRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN a_number IS NOT NULL AND a_number != '' THEN 1 ELSE 0 END) AS withANumber,
      SUM(CASE WHEN date_of_birth IS NOT NULL THEN 1 ELSE 0 END) AS withDob,
      SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS withEmail,
      SUM(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 ELSE 0 END) AS withPhone
    FROM profiles
  `).get() as any;

  // Contract stats
  const contractRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status NOT IN ('Closed','Paid','Cancelled','Done') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status IN ('Closed','Paid','Cancelled','Done') THEN 1 ELSE 0 END) AS closed
    FROM contracts
  `).get() as any;

  // Update stats
  const updateRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN profile_local_id IS NOT NULL AND profile_local_id != '' THEN 1 ELSE 0 END) AS linkedToProfile
    FROM client_updates
  `).get() as any;

  // Per-board stats
  const boardRows = db.prepare(`
    SELECT
      board_key AS boardKey,
      COUNT(*) AS total,
      SUM(CASE WHEN profile_local_id IS NOT NULL AND profile_local_id != '' THEN 1 ELSE 0 END) AS withProfile
    FROM board_items
    GROUP BY board_key
    ORDER BY total DESC
  `).all() as { boardKey: string; total: number; withProfile: number }[];

  // Per-board, per-group breakdown
  const groupRows = db.prepare(`
    SELECT
      board_key AS boardKey,
      COALESCE(group_title, '(no group)') AS groupTitle,
      COUNT(*) AS count
    FROM board_items
    GROUP BY board_key, group_title
    ORDER BY board_key, count DESC
  `).all() as { boardKey: string; groupTitle: string; count: number }[];

  const boards: BoardStat[] = boardRows.map((r) => ({
    boardKey: r.boardKey,
    label: BOARD_LABELS[r.boardKey] ?? r.boardKey,
    total: r.total,
    withProfile: r.withProfile,
    orphaned: r.total - r.withProfile,
  }));

  const groups: GroupStat[] = groupRows.map((r) => ({
    boardKey: r.boardKey,
    boardLabel: BOARD_LABELS[r.boardKey] ?? r.boardKey,
    groupTitle: r.groupTitle,
    count: r.count,
  }));

  const totalItems = boards.reduce((s, b) => s + b.total, 0);
  const totalOrphaned = boards.reduce((s, b) => s + b.orphaned, 0);

  return {
    dbPath,
    generatedAt: new Date().toISOString(),
    profiles: {
      total: profileRow.total,
      withANumber: profileRow.withANumber,
      withDob: profileRow.withDob,
      withEmail: profileRow.withEmail,
      withPhone: profileRow.withPhone,
    },
    contracts: {
      total: contractRow.total,
      active: contractRow.active,
      closed: contractRow.closed,
    },
    updates: {
      total: updateRow.total,
      linkedToProfile: updateRow.linkedToProfile,
    },
    boards,
    groups,
    totalItems,
    totalOrphaned,
  };
}

export function printStats(report: StatsReport): void {
  const line = "─".repeat(62);
  const db = report.dbPath.split("/").pop();

  console.log(`\n${line}`);
  console.log(`  DB Stats — ${db}  (${report.generatedAt.replace("T", " ").slice(0, 16)})`);
  console.log(line);

  // Profiles
  const p = report.profiles;
  console.log(`\n  PROFILES    ${String(p.total).padStart(6)}`);
  console.log(`    with A-Number  ${String(p.withANumber).padStart(6)}  (${pct(p.withANumber, p.total)}%)`);
  console.log(`    with DOB       ${String(p.withDob).padStart(6)}  (${pct(p.withDob, p.total)}%)`);
  console.log(`    with email     ${String(p.withEmail).padStart(6)}  (${pct(p.withEmail, p.total)}%)`);
  console.log(`    with phone     ${String(p.withPhone).padStart(6)}  (${pct(p.withPhone, p.total)}%)`);

  // Contracts
  const c = report.contracts;
  console.log(`\n  CONTRACTS   ${String(c.total).padStart(6)}`);
  console.log(`    active         ${String(c.active).padStart(6)}`);
  console.log(`    closed         ${String(c.closed).padStart(6)}`);

  // Updates
  const u = report.updates;
  console.log(`\n  NOTES       ${String(u.total).padStart(6)}  (${pct(u.linkedToProfile, u.total)}% linked to profile)`);

  // Board items
  console.log(`\n  BOARD ITEMS ${String(report.totalItems).padStart(6)}`);
  console.log(`  ${"Board".padEnd(32)} ${"Total".padStart(6)}  ${"Orphaned".padStart(8)}`);
  console.log(`  ${"─".repeat(50)}`);
  for (const b of report.boards) {
    const orphanNote = b.orphaned > 0 ? `  ← ${b.orphaned} no profile` : "";
    console.log(`  ${b.label.padEnd(32)} ${String(b.total).padStart(6)}${orphanNote}`);
  }

  if (report.totalOrphaned > 0) {
    console.log(`\n  ⚠  ${report.totalOrphaned} items total have no profile link`);
  }

  console.log(`\n${line}\n`);
}

function pct(n: number, total: number): string {
  if (total === 0) return "0";
  return Math.round((n / total) * 100).toString();
}

// =============================================================================
// CLI entry point
// =============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dbArg = args.find((a) => a.startsWith("--db="))?.split("=")[1] ?? "seed";
  const dbPath = dbArg === "live" ? "data/live.db" : "data/seed.db";

  let db: DatabaseInstance;
  try {
    db = new Database(dbPath, { readonly: true });
    validateSchema(db);
  } catch (e) {
    console.error(`\n  Error: ${(e as Error).message}\n`);
    process.exit(1);
  }

  const report = gatherStats(db, dbPath);
  printStats(report);
  db.close();
}
