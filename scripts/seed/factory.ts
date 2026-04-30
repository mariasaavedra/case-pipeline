// =============================================================================
// Data Factory - SQLite-backed Seed Data Generator
// =============================================================================
//
// Usage:
//   bun scripts/seed/factory                      # Generate data to SQLite
//   bun scripts/seed/factory --list-batches       # Show all batches
//   bun scripts/seed/factory --help               # Show help
//
// Options:
//   --profiles=N       Number of profiles to create (default: 5)
//   --contracts=M-N    Contracts per profile range (default: 1-3)
//   --seed=N           Seed for reproducible generation
//   --db-path=PATH     SQLite database path (default: data/seed.db)
//
// =============================================================================

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONFIG } from "./lib/constants";
import { Seeder } from "./lib/seeder";

const DEFAULT_DB_PATH = "data/seed.db";

interface FactoryConfig {
  command: "run" | "list" | "help";
  profileCount: number;
  contractsPerProfile: { min: number; max: number };
  seed?: number;
  dbPath: string;
}

function printHelp(): void {
  console.log(`
Data Factory - SQLite-backed Seed Data Generator (local only)

Usage:
  bun scripts/seed/factory                  Generate data to SQLite
  bun scripts/seed/factory --list-batches   Show all batches
  bun scripts/seed/factory --help           Show this help

Options:
  --profiles=N       Number of profiles to create (default: ${DEFAULT_CONFIG.profileCount})
  --contracts=M-N    Contracts per profile range (default: ${DEFAULT_CONFIG.contractsPerProfile.min}-${DEFAULT_CONFIG.contractsPerProfile.max})
  --seed=N           Seed for reproducible generation
  --db-path=PATH     SQLite database path (default: ${DEFAULT_DB_PATH})

Examples:
  # Generate 100 profiles with 1-3 contracts each
  bun scripts/seed/factory --profiles=100 --contracts=1-3

  # Reproducible generation (same seed = same data)
  bun scripts/seed/factory --profiles=50 --seed=42
`);
}

function parseArgs(): FactoryConfig {
  const args = process.argv.slice(2);
  const config: FactoryConfig = {
    command: "run",
    profileCount: DEFAULT_CONFIG.profileCount,
    contractsPerProfile: { ...DEFAULT_CONFIG.contractsPerProfile },
    dbPath: DEFAULT_DB_PATH,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      config.command = "help";
    } else if (arg === "--list-batches") {
      config.command = "list";
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
  console.log("-".repeat(62));
  console.log(
    "ID".padEnd(6) +
      "Status".padEnd(12) +
      "Profiles".padEnd(10) +
      "Fee Ks".padEnd(10) +
      "Items".padEnd(8) +
      "Created"
  );
  console.log("-".repeat(68));

  for (const batch of batches) {
    console.log(
      String(batch.id).padEnd(6) +
        batch.status.padEnd(12) +
        String(batch.profileCount).padEnd(10) +
        String(batch.contractCount).padEnd(10) +
        String(batch.boardItemCount).padEnd(8) +
        batch.createdAt
    );
  }
  console.log("-".repeat(68));
}

async function main(): Promise<void> {
  const config = parseArgs();

  if (config.command === "help") {
    printHelp();
    return;
  }

  // Ensure data directory exists
  await mkdir(dirname(config.dbPath), { recursive: true });

  const seeder = new Seeder({
    dbPath: config.dbPath,
    seed: config.seed,
    profileCount: config.profileCount,
    contractsPerProfile: config.contractsPerProfile,
  });

  try {
    await seeder.initialize();

    if (config.command === "list") {
      printBatchList(seeder);
      return;
    }

    console.log("=".repeat(60));
    console.log("Data Factory");
    console.log("=".repeat(60));

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
    console.log(`  Profiles generated: ${result.profiles.generated}`);
    console.log(`  Fee Ks generated: ${result.feeKs.generated}`);
    if (Object.keys(result.boardItems).length > 0) {
      console.log(`  Board items:`);
      for (const [board, count] of Object.entries(result.boardItems)) {
        console.log(`    ${board}: ${count}`);
      }
    }
    console.log(`  Relationships: ${result.relationships}`);
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
