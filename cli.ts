#!/usr/bin/env bun
// =============================================================================
// Case Pipeline CLI - Unified command-line interface
// =============================================================================

import { renderCommand } from "./cli/commands/render";
import { seedCommand } from "./cli/commands/seed";
import { syncCommand } from "./cli/commands/sync";
import { analyzeCommand } from "./cli/commands/analyze";
import { lookupCommand } from "./cli/commands/lookup";

// =============================================================================
// CLI Configuration
// =============================================================================

const COMMANDS = {
  render: {
    description: "Generate documents from Monday.com items",
    handler: renderCommand,
  },
  seed: {
    description: "Generate test data to local SQLite database",
    handler: seedCommand,
  },
  sync: {
    description: "Sync board configuration with Monday.com",
    handler: syncCommand,
  },
  analyze: {
    description: "Analyze board relationships and generate maps",
    handler: analyzeCommand,
  },
  lookup: {
    description: "Search clients and view 360 case summary",
    handler: lookupCommand,
  },
} as const;

type CommandName = keyof typeof COMMANDS;

// =============================================================================
// Help Text
// =============================================================================

function showHelp(): void {
  console.log(`
Case Pipeline CLI

Usage: bun cli.ts <command> [options]

Commands:
${Object.entries(COMMANDS)
  .map(([name, cmd]) => `  ${name.padEnd(12)} ${cmd.description}`)
  .join("\n")}

Examples:
  bun cli.ts render              # Interactive profile selector
  bun cli.ts render --item=123   # Render specific item
  bun cli.ts seed --profiles=5   # Seed 5 test profiles
  bun cli.ts sync --dry-run      # Preview config changes
  bun cli.ts analyze             # Generate relationship map

Run 'bun cli.ts <command> --help' for command-specific help.
`);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }

  if (!isValidCommand(command)) {
    console.error(`Unknown command: ${command}`);
    console.error(`Run 'bun cli.ts --help' for available commands.`);
    process.exit(1);
  }

  try {
    await COMMANDS[command].handler(args.slice(1));
  } catch (error) {
    console.error("\nError:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function isValidCommand(cmd: string): cmd is CommandName {
  return cmd in COMMANDS;
}

main();
