// =============================================================================
// Seed Command - Generate test data to local SQLite
// =============================================================================

import { Seeder } from "../../scripts/seed/lib/seeder";

// =============================================================================
// Types
// =============================================================================

interface SeedOptions {
  profiles: number;
  contractsMin: number;
  contractsMax: number;
  seed?: number;
  listBatches: boolean;
}

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs(args: string[]): SeedOptions {
  const options: SeedOptions = {
    profiles: 5,
    contractsMin: 1,
    contractsMax: 3,
    listBatches: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    }
    if (arg === "--list") {
      options.listBatches = true;
    }
    if (arg.startsWith("--profiles=")) {
      options.profiles = parseInt(arg.slice(11), 10);
    }
    if (arg.startsWith("--contracts=")) {
      const range = arg.slice(12);
      if (range.includes("-")) {
        const [min, max] = range.split("-").map((n) => parseInt(n, 10));
        options.contractsMin = min!;
        options.contractsMax = max!;
      } else {
        options.contractsMin = options.contractsMax = parseInt(range, 10);
      }
    }
    if (arg.startsWith("--seed=")) {
      options.seed = parseInt(arg.slice(7), 10);
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
Seed Command - Generate test data to local SQLite

Usage: bun cli.ts seed [options]

Options:
  --profiles=<n>      Number of profiles to generate (default: 5)
  --contracts=<n-m>   Contracts per profile, range (default: 1-3)
  --seed=<n>          Random seed for reproducible data
  --list              List all existing batches
  --help, -h          Show this help

Examples:
  bun cli.ts seed                        # Generate 5 profiles with 1-3 contracts
  bun cli.ts seed --profiles=10          # Generate 10 profiles
  bun cli.ts seed --contracts=2-5        # 2-5 contracts per profile
  bun cli.ts seed --seed=42              # Reproducible generation
  bun cli.ts seed --list                 # List previous batches
`);
}

// =============================================================================
// Main Command
// =============================================================================

export async function seedCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);

  const seeder = new Seeder({
    dbPath: "data/seed.db",
    seed: options.seed,
    profileCount: options.profiles,
    contractsPerProfile: {
      min: options.contractsMin,
      max: options.contractsMax,
    },
  });

  try {
    await seeder.initialize();

    // List batches mode
    if (options.listBatches) {
      const batches = seeder.listBatches();

      if (batches.length === 0) {
        console.log("No batches found.");
        return;
      }

      console.log("\nExisting batches:\n");
      console.log(
        "  ID   Created              Status      Profiles  Fee Ks  Board Items"
      );
      console.log("  " + "-".repeat(74));

      for (const batch of batches) {
        console.log(
          `  ${batch.id.toString().padStart(3)}  ` +
            `${batch.createdAt.slice(0, 19).padEnd(20)} ` +
            `${batch.status.padEnd(11)} ` +
            `${batch.profileCount.toString().padStart(8)}  ` +
            `${batch.contractCount.toString().padStart(6)}  ` +
            `${batch.boardItemCount.toString().padStart(11)}`
        );
      }
      console.log();
      return;
    }

    // Run generation
    console.log("\nCase Pipeline - Test Data Generator");
    console.log("====================================\n");

    console.log(`Configuration:`);
    console.log(`  Profiles: ${options.profiles}`);
    console.log(
      `  Contracts per profile: ${options.contractsMin}-${options.contractsMax}`
    );
    if (options.seed !== undefined) {
      console.log(`  Seed: ${options.seed}`);
    }

    const result = await seeder.run();

    console.log("\n====================================");
    console.log("Summary:");
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
    console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);
  } finally {
    seeder.cleanup();
  }
}
