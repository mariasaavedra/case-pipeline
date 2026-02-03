// =============================================================================
// Monday.com Data Factory - SQLite-backed Seed Data Generator
// =============================================================================
//
// Usage:
//   bun scripts/seed/factory                      # Full pipeline: generate + sync
//   bun scripts/seed/factory --generate-only      # Only generate to SQLite
//   bun scripts/seed/factory --sync-only --batch-id=1  # Sync existing batch
//   bun scripts/seed/factory --list-batches       # Show all batches
//   bun scripts/seed/factory --dry-run            # Test without API calls
//   bun scripts/seed/factory --help               # Show help
//
// Options:
//   --profiles=N       Number of profiles to create (default: 5)
//   --contracts=M-N    Contracts per profile range (default: 1-3)
//   --seed=N           Seed for reproducible generation
//   --db-path=PATH     SQLite database path (default: data/seed.db)
//   --batch-size=N     Items per sync batch (default: 10)
//   --generate-only    Only generate data, don't sync to Monday.com
//   --sync-only        Only sync existing batch (requires --batch-id)
//   --batch-id=N       Batch ID for --sync-only mode
//   --list-batches     List all batches
//   --dry-run          Skip actual Monday.com API calls
//
// =============================================================================

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONFIG } from "./lib/constants";
import { setApiToken } from "../../lib/monday";
import { Seeder } from "./lib/seeder";

const DEFAULT_DB_PATH = "data/seed.db";

interface FactoryConfig {
  command: "run" | "list" | "help";
  profileCount: number;
  contractsPerProfile: { min: number; max: number };
  seed?: number;
  dbPath: string;
  batchSize: number;
  generateOnly: boolean;
  syncOnly: boolean;
  batchId?: number;
  dryRun: boolean;
}

function printHelp(): void {
  console.log(`
Monday.com Data Factory - SQLite-backed Seed Data Generator

Usage:
  bun scripts/seed/factory                  Full pipeline: generate + sync
  bun scripts/seed/factory --generate-only  Only generate to SQLite
  bun scripts/seed/factory --sync-only      Sync existing batch (requires --batch-id)
  bun scripts/seed/factory --list-batches   Show all batches
  bun scripts/seed/factory --help           Show this help

Options:
  --profiles=N       Number of profiles to create (default: ${DEFAULT_CONFIG.profileCount})
  --contracts=M-N    Contracts per profile range (default: ${DEFAULT_CONFIG.contractsPerProfile.min}-${DEFAULT_CONFIG.contractsPerProfile.max})
  --seed=N           Seed for reproducible generation
  --db-path=PATH     SQLite database path (default: ${DEFAULT_DB_PATH})
  --batch-size=N     Items per sync batch (default: 10)
  --batch-id=N       Batch ID for --sync-only mode
  --dry-run          Skip actual Monday.com API calls

Examples:
  # Generate and sync 100 profiles with 1-3 contracts each
  bun scripts/seed/factory --profiles=100 --contracts=1-3

  # Reproducible generation (same seed = same data)
  bun scripts/seed/factory --profiles=50 --seed=42

  # Generate 1000 records without syncing
  bun scripts/seed/factory --generate-only --profiles=1000

  # Sync an existing batch
  bun scripts/seed/factory --sync-only --batch-id=1

  # Test sync without making API calls
  bun scripts/seed/factory --dry-run --profiles=10
`);
}

function parseArgs(): FactoryConfig {
  const args = process.argv.slice(2);
  const config: FactoryConfig = {
    command: "run",
    profileCount: DEFAULT_CONFIG.profileCount,
    contractsPerProfile: { ...DEFAULT_CONFIG.contractsPerProfile },
    dbPath: DEFAULT_DB_PATH,
    batchSize: 10,
    generateOnly: false,
    syncOnly: false,
    dryRun: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      config.command = "help";
    } else if (arg === "--list-batches") {
      config.command = "list";
    } else if (arg === "--generate-only") {
      config.generateOnly = true;
    } else if (arg === "--sync-only") {
      config.syncOnly = true;
    } else if (arg === "--dry-run") {
      config.dryRun = true;
    } else if (arg.startsWith("--profiles=")) {
      config.profileCount = parseInt(arg.split("=")[1] ?? "") || DEFAULT_CONFIG.profileCount;
    } else if (arg.startsWith("--contracts=")) {
      const range = arg.split("=")[1] ?? "";
      const [min, max] = range.split("-").map((n) => parseInt(n));
      if (min !== undefined && !isNaN(min)) config.contractsPerProfile.min = min;
      if (max !== undefined && !isNaN(max)) config.contractsPerProfile.max = max;
    } else if (arg.startsWith("--seed=")) {
      config.seed = parseInt(arg.split("=")[1] ?? "");
    } else if (arg.startsWith("--db-path=")) {
      config.dbPath = arg.split("=")[1] ?? DEFAULT_DB_PATH;
    } else if (arg.startsWith("--batch-size=")) {
      config.batchSize = parseInt(arg.split("=")[1] ?? "") || 10;
    } else if (arg.startsWith("--batch-id=")) {
      config.batchId = parseInt(arg.split("=")[1] ?? "");
    }
  }

  return config;
}

function printBatchList(seeder: Seeder): void {
  const batches = seeder.listBatches();

  if (batches.length === 0) {
    console.log("No batches found.");
    return;
  }

  console.log("\nSeed Batches:");
  console.log("─".repeat(90));
  console.log(
    "ID".padEnd(6) +
      "Status".padEnd(12) +
      "Profiles".padEnd(12) +
      "Contracts".padEnd(12) +
      "Synced".padEnd(15) +
      "Created"
  );
  console.log("─".repeat(90));

  for (const batch of batches) {
    const syncedStr = `${batch.profilesSynced}/${batch.profileCount} + ${batch.contractsSynced}/${batch.contractCount}`;
    console.log(
      String(batch.id).padEnd(6) +
        batch.status.padEnd(12) +
        String(batch.profileCount).padEnd(12) +
        String(batch.contractCount).padEnd(12) +
        syncedStr.padEnd(15) +
        batch.createdAt
    );
  }
  console.log("─".repeat(90));
}

async function main(): Promise<void> {
  const config = parseArgs();

  if (config.command === "help") {
    printHelp();
    return;
  }

  // Validate API token (not needed for list or generate-only)
  const token = process.env.MONDAY_API_TOKEN;
  if (!token && !config.generateOnly && config.command !== "list") {
    console.error("Error: MONDAY_API_TOKEN is required in .env");
    console.error("Use --generate-only to generate data without syncing.");
    process.exit(1);
  }

  if (token) {
    setApiToken(token);
  }

  // Ensure data directory exists
  await mkdir(dirname(config.dbPath), { recursive: true });

  const seeder = new Seeder({
    dbPath: config.dbPath,
    seed: config.seed,
    profileCount: config.profileCount,
    contractsPerProfile: config.contractsPerProfile,
    dryRun: config.dryRun,
    syncBatchSize: config.batchSize,
    generateOnly: config.generateOnly,
    syncOnly: config.syncOnly,
    batchId: config.batchId,
  });

  try {
    await seeder.initialize();

    if (config.command === "list") {
      printBatchList(seeder);
      return;
    }

    console.log("=".repeat(60));
    console.log("Monday.com Data Factory");
    console.log("=".repeat(60));

    if (config.dryRun) {
      console.log("  Mode: DRY RUN (no API calls)");
    }
    if (config.generateOnly) {
      console.log("  Mode: GENERATE ONLY (no sync)");
    }
    if (config.syncOnly) {
      console.log(`  Mode: SYNC ONLY (batch #${config.batchId})`);
    }
    if (config.seed !== undefined) {
      console.log(`  Seed: ${config.seed}`);
    }
    console.log(`  Database: ${config.dbPath}`);

    const result = await seeder.run();

    const elapsed = (result.duration / 1000).toFixed(2);

    console.log("\n" + "=".repeat(60));
    console.log("Summary");
    console.log("=".repeat(60));
    console.log(`  Batch ID: ${result.batchId}`);
    console.log(`  Profiles: ${result.profiles.generated} generated, ${result.profiles.synced} synced, ${result.profiles.failed} failed`);
    console.log(`  Contracts: ${result.contracts.generated} generated, ${result.contracts.synced} synced, ${result.contracts.failed} failed`);
    console.log(`  Duration: ${elapsed}s`);
    console.log("=".repeat(60));
  } finally {
    seeder.cleanup();
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
