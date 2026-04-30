// =============================================================================
// Monday.com Test Data Seeder - Main Entry Point
// =============================================================================
//
// Usage:
//   bun scripts/seed                     # Generate profiles + contracts to SQLite
//   bun scripts/seed --help              # Show help
//
// Options:
//   --profiles=N    Number of profiles to create (default: 5)
//   --contracts=M-N Contracts per profile range (default: 1-3)
//   --seed=N        Seed for reproducible generation
//   --list          List all batches
//
// =============================================================================

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONFIG } from "./lib/constants";
import { Seeder } from "./lib/seeder";

const DEFAULT_DB_PATH = "data/seed.db";

function printHelp() {
  console.log(`
Monday.com Test Data Generator (local SQLite only)

Usage:
  bun scripts/seed                     Generate profiles + contracts
  bun scripts/seed --list              List all batches
  bun scripts/seed --help              Show this help

Options:
  --profiles=N    Number of profiles to create (default: ${DEFAULT_CONFIG.profileCount})
  --contracts=M-N Contracts per profile range (default: ${DEFAULT_CONFIG.contractsPerProfile.min}-${DEFAULT_CONFIG.contractsPerProfile.max})
  --seed=N        Seed for reproducible generation

Examples:
  bun scripts/seed
  bun scripts/seed --profiles=10
  bun scripts/seed --profiles=50 --seed=42
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    command: "run" as "run" | "list" | "help",
    profileCount: DEFAULT_CONFIG.profileCount,
    contractsPerProfile: { ...DEFAULT_CONFIG.contractsPerProfile },
    seed: undefined as number | undefined,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      config.command = "help";
    } else if (arg === "--list") {
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
    }
  }

  return config;
}

async function main() {
  const config = parseArgs();

  if (config.command === "help") {
    printHelp();
    return;
  }

  await mkdir(dirname(DEFAULT_DB_PATH), { recursive: true });

  const seeder = new Seeder({
    dbPath: DEFAULT_DB_PATH,
    seed: config.seed,
    profileCount: config.profileCount,
    contractsPerProfile: config.contractsPerProfile,
  });

  try {
    await seeder.initialize();

    if (config.command === "list") {
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
      return;
    }

    const startTime = performance.now();

    console.log("=".repeat(60));
    console.log("Test Data Generator");
    console.log("=".repeat(60));

    if (config.seed !== undefined) {
      console.log(`  Seed: ${config.seed}`);
    }
    console.log(`  Profiles: ${config.profileCount}`);
    console.log(`  Contracts per profile: ${config.contractsPerProfile.min}-${config.contractsPerProfile.max}`);

    const result = await seeder.run();

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

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
