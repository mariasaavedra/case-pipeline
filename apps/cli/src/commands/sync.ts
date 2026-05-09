// =============================================================================
// Sync Command - Synchronize board configuration with Monday.com
// =============================================================================
// Delegates to the existing sync-config script

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);

// =============================================================================
// Help Text
// =============================================================================

function showHelp(): void {
  console.log(`
Sync Command - Synchronize board configuration with Monday.com

Usage: tsx cli.ts sync [options]

Options:
  --dry-run                    Preview changes without writing
  --verbose, -v                Show detailed output
  --add-board=<id>             Add a new board by Monday.com ID
  --board-key=<key>            Key name for new board (with --add-board)
  --discover                   Discover all boards in workspace
  --relationship-map=<path>    Export relationship map to file
  --help, -h                   Show this help

Examples:
  tsx cli.ts sync                              # Sync all configured boards
  tsx cli.ts sync --dry-run                    # Preview changes
  tsx cli.ts sync --add-board=123 --board-key=tasks  # Add new board
  tsx cli.ts sync --discover                   # List all workspace boards
  tsx cli.ts sync --relationship-map=map.md   # Generate relationship map
`);
}

// =============================================================================
// Main Command
// =============================================================================

export async function syncCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [
        `--env-file=${path.join(repoRoot, ".env")}`,
        "--import",
        "tsx/esm",
        path.join(repoRoot, "scripts/sync-config/index.ts"),
        ...args,
      ],
      { stdio: "inherit", env: process.env, cwd: repoRoot },
    );
    proc.on("close", (code) => {
      if (code !== 0) process.exit(code ?? 1);
      resolve();
    });
    proc.on("error", reject);
  });
}
