// =============================================================================
// Sync Command - Synchronize board configuration with Monday.com
// =============================================================================
// Delegates to the existing sync-config script

import { spawn } from "bun";

// =============================================================================
// Help Text
// =============================================================================

function showHelp(): void {
  console.log(`
Sync Command - Synchronize board configuration with Monday.com

Usage: bun cli.ts sync [options]

Options:
  --dry-run                    Preview changes without writing
  --verbose, -v                Show detailed output
  --add-board=<id>             Add a new board by Monday.com ID
  --board-key=<key>            Key name for new board (with --add-board)
  --discover                   Discover all boards in workspace
  --relationship-map=<path>    Export relationship map to file
  --help, -h                   Show this help

Examples:
  bun cli.ts sync                              # Sync all configured boards
  bun cli.ts sync --dry-run                    # Preview changes
  bun cli.ts sync --add-board=123 --board-key=tasks  # Add new board
  bun cli.ts sync --discover                   # List all workspace boards
  bun cli.ts sync --relationship-map=map.md   # Generate relationship map
`);
}

// =============================================================================
// Main Command
// =============================================================================

export async function syncCommand(args: string[]): Promise<void> {
  // Check for help
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    return;
  }

  // Delegate to existing sync-config script
  const proc = spawn({
    cmd: [process.execPath, "scripts/sync-config/index.ts", ...args],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: process.env,
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
