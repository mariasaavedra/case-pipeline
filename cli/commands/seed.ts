// =============================================================================
// Seed Command - Wrapper for scripts/seed
// =============================================================================

import { Seeder } from "../../scripts/seed/lib/seeder";
import { setApiToken } from "../../lib/monday";

// =============================================================================
// Types
// =============================================================================

interface SeedOptions {
  profiles: number;
  contractsMin: number;
  contractsMax: number;
  seed?: number;
  dryRun: boolean;
  generateOnly: boolean;
  syncOnly: boolean;
  batchId?: number;
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
    dryRun: false,
    generateOnly: false,
    syncOnly: false,
    listBatches: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
    }
    if (arg === "--generate-only") {
      options.generateOnly = true;
    }
    if (arg === "--sync-only") {
      options.syncOnly = true;
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
    if (arg.startsWith("--batch-id=")) {
      options.batchId = parseInt(arg.slice(11), 10);
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
Seed Command - Generate and sync test data to Monday.com

Usage: bun cli.ts seed [options]

Options:
  --profiles=<n>      Number of profiles to generate (default: 5)
  --contracts=<n-m>   Contracts per profile, range (default: 1-3)
  --seed=<n>          Random seed for reproducible data
  --dry-run           Preview without syncing to Monday.com
  --generate-only     Generate data to SQLite only (no sync)
  --sync-only         Sync existing batch only (requires --batch-id)
  --batch-id=<n>      Batch ID to sync (for --sync-only)
  --list              List all existing batches
  --help, -h          Show this help

Examples:
  bun cli.ts seed                        # Generate 5 profiles with 1-3 contracts
  bun cli.ts seed --profiles=10          # Generate 10 profiles
  bun cli.ts seed --contracts=2-5        # 2-5 contracts per profile
  bun cli.ts seed --dry-run              # Preview without syncing
  bun cli.ts seed --seed=42              # Reproducible generation
  bun cli.ts seed --list                 # List previous batches
`);
}

// =============================================================================
// Main Command
// =============================================================================

export async function seedCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);

  // Check for API token (not needed for generate-only or list)
  const apiToken = process.env.MONDAY_API_TOKEN;
  if (!apiToken && !options.generateOnly && !options.listBatches) {
    throw new Error(
      "MONDAY_API_TOKEN environment variable is required for syncing"
    );
  }

  if (apiToken) {
    setApiToken(apiToken);
  }

  const seeder = new Seeder({
    dbPath: "data/seed.db",
    seed: options.seed,
    profileCount: options.profiles,
    contractsPerProfile: {
      min: options.contractsMin,
      max: options.contractsMax,
    },
    dryRun: options.dryRun,
    generateOnly: options.generateOnly,
    syncOnly: options.syncOnly,
    batchId: options.batchId,
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
        "  ID   Created              Status      Profiles  Contracts  Synced"
      );
      console.log("  " + "-".repeat(70));

      for (const batch of batches) {
        console.log(
          `  ${batch.id.toString().padStart(3)}  ` +
            `${batch.createdAt.slice(0, 19).padEnd(20)} ` +
            `${batch.status.padEnd(11)} ` +
            `${batch.profileCount.toString().padStart(8)}  ` +
            `${batch.contractCount.toString().padStart(9)}  ` +
            `${batch.profilesSynced}/${batch.contractsSynced}`
        );
      }
      console.log();
      return;
    }

    // Run seeding
    console.log("\nCase Pipeline - Test Data Seeder");
    console.log("================================\n");

    if (options.dryRun) {
      console.log("DRY RUN MODE - No data will be synced to Monday.com\n");
    }

    console.log(`Configuration:`);
    console.log(`  Profiles: ${options.profiles}`);
    console.log(
      `  Contracts per profile: ${options.contractsMin}-${options.contractsMax}`
    );
    if (options.seed !== undefined) {
      console.log(`  Seed: ${options.seed}`);
    }

    const result = await seeder.run();

    console.log("\n================================");
    console.log("Summary:");
    console.log(`  Batch ID: ${result.batchId}`);
    console.log(
      `  Profiles: ${result.profiles.generated} generated, ${result.profiles.synced} synced, ${result.profiles.failed} failed`
    );
    console.log(
      `  Contracts: ${result.contracts.generated} generated, ${result.contracts.synced} synced, ${result.contracts.failed} failed`
    );
    console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);
  } finally {
    seeder.cleanup();
  }
}
