// =============================================================================
// Monday.com Test Data Seeder - Main Entry Point
// =============================================================================
//
// Usage:
//   bun scripts/seed                     # Seed profiles + contracts (default)
//   bun scripts/seed profiles            # Seed only profiles
//   bun scripts/seed contracts <ids...>  # Seed contracts for specific profile IDs
//   bun scripts/seed --help              # Show help
//
// Options:
//   --profiles=N    Number of profiles to create (default: 5)
//   --contracts=M-N Contracts per profile range (default: 1-3)
//
// =============================================================================

import { DEFAULT_CONFIG } from "./lib/constants";
import { setApiToken } from "../../lib/monday";
import { seedProfiles } from "./seed-profiles";
import { seedContracts, type ProfileReference } from "./seed-contracts";

function printHelp() {
  console.log(`
Monday.com Test Data Seeder

Usage:
  bun scripts/seed                     Seed profiles + contracts (default)
  bun scripts/seed profiles            Seed only profiles
  bun scripts/seed contracts <ids...>  Seed contracts for specific profile IDs
  bun scripts/seed --help              Show this help

Options:
  --profiles=N    Number of profiles to create (default: ${DEFAULT_CONFIG.profileCount})
  --contracts=M-N Contracts per profile range (default: ${DEFAULT_CONFIG.contractsPerProfile.min}-${DEFAULT_CONFIG.contractsPerProfile.max})

Examples:
  bun scripts/seed
  bun scripts/seed --profiles=10
  bun scripts/seed profiles --profiles=3
  bun scripts/seed contracts 123456789 987654321
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    command: "all" as "all" | "profiles" | "contracts" | "help",
    profileCount: DEFAULT_CONFIG.profileCount,
    contractsPerProfile: { ...DEFAULT_CONFIG.contractsPerProfile },
    profileIds: [] as string[],
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      config.command = "help";
    } else if (arg === "profiles") {
      config.command = "profiles";
    } else if (arg === "contracts") {
      config.command = "contracts";
    } else if (arg.startsWith("--profiles=")) {
      config.profileCount = parseInt(arg.split("=")[1] ?? "") || DEFAULT_CONFIG.profileCount;
    } else if (arg.startsWith("--contracts=")) {
      const range = arg.split("=")[1] ?? "";
      const [min, max] = range.split("-").map((n) => parseInt(n));
      if (min !== undefined && !isNaN(min)) config.contractsPerProfile.min = min;
      if (max !== undefined && !isNaN(max)) config.contractsPerProfile.max = max;
    } else if (/^\d+$/.test(arg)) {
      config.profileIds.push(arg);
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

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    console.error("Error: MONDAY_API_TOKEN is required in .env");
    process.exit(1);
  }

  setApiToken(token);

  const startTime = performance.now();

  console.log("=".repeat(60));
  console.log("Monday.com Test Data Seeder");
  console.log("=".repeat(60));

  let profilesCreated = 0;
  let contractsCreated = 0;

  if (config.command === "profiles") {
    // Seed only profiles
    const result = await seedProfiles({ count: config.profileCount });
    profilesCreated = result.profiles.length;
  } else if (config.command === "contracts") {
    // Seed contracts for specific profile IDs
    if (config.profileIds.length === 0) {
      console.error("\nError: No profile IDs provided.");
      console.error("Usage: bun scripts/seed contracts <profile_id1> [profile_id2] ...");
      process.exit(1);
    }

    const profiles: ProfileReference[] = config.profileIds.map((id) => ({
      id,
      name: `Profile ${id}`,
    }));

    const result = await seedContracts({ profiles, contractsPerProfile: config.contractsPerProfile });
    contractsCreated = result.contracts.length;
  } else {
    // Seed both profiles and contracts
    console.log(`\nSeeding ${config.profileCount} profiles with ${config.contractsPerProfile.min}-${config.contractsPerProfile.max} contracts each...\n`);

    const profilesResult = await seedProfiles({ count: config.profileCount });
    profilesCreated = profilesResult.profiles.length;

    const profiles: ProfileReference[] = profilesResult.profiles.map((p) => ({
      id: p.item.id,
      name: p.item.name,
    }));

    const contractsResult = await seedContracts({ profiles, contractsPerProfile: config.contractsPerProfile });
    contractsCreated = contractsResult.contracts.length;
  }

  const elapsed = (performance.now() - startTime).toFixed(0);

  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  if (profilesCreated > 0) {
    console.log(`  Profiles created: ${profilesCreated}`);
  }
  if (contractsCreated > 0) {
    console.log(`  Contracts created: ${contractsCreated}`);
  }
  console.log(`  Total time: ${elapsed}ms`);
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
