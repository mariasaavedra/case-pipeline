// =============================================================================
// Analyze Command - Analyze board relationships and generate documentation
// =============================================================================

import { writeFile } from "node:fs/promises";
import { setApiToken, fetchBoardStructure } from "@case-pipeline/monday";
import { loadBoardsConfig } from "@case-pipeline/config";
import {
  analyzeBoards,
  renderMarkdownDocument,
  renderJSON,
  renderSimpleDiagram,
} from "@case-pipeline/relationship-map";

// =============================================================================
// Types
// =============================================================================

interface AnalyzeOptions {
  output?: string;
  format: "markdown" | "json" | "mermaid";
  includeMirrors: boolean;
  mainBoard?: string;
  trackedOnly: boolean;
}

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs(args: string[]): AnalyzeOptions {
  const options: AnalyzeOptions = {
    format: "markdown",
    includeMirrors: true,
    trackedOnly: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    }
    if (arg === "--no-mirrors") {
      options.includeMirrors = false;
    }
    if (arg.startsWith("--output=") || arg.startsWith("-o=")) {
      options.output = arg.split("=")[1];
    }
    if (arg.startsWith("--format=")) {
      const format = arg.slice(9);
      if (format === "markdown" || format === "json" || format === "mermaid") {
        options.format = format;
      }
    }
    if (arg.startsWith("--main-board=")) {
      options.mainBoard = arg.slice(13);
    }
    if (arg === "--tracked-only") {
      options.trackedOnly = true;
    }
  }

  // Infer format from output filename
  if (options.output) {
    if (options.output.endsWith(".json")) {
      options.format = "json";
    } else if (options.output.endsWith(".mmd") || options.output.endsWith(".mermaid")) {
      options.format = "mermaid";
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
Analyze Command - Analyze board relationships and generate documentation

Usage: bun cli.ts analyze [options]

Options:
  --output=<path>, -o=<path>   Output file path (default: stdout)
  --format=<type>              Output format: markdown, json, mermaid (default: markdown)
  --main-board=<key>           Specify main board by config key
  --tracked-only               Only show connections between tracked boards
  --no-mirrors                 Exclude mirror column details
  --help, -h                   Show this help

Examples:
  bun cli.ts analyze                           # Print to stdout
  bun cli.ts analyze -o=docs/boards.md         # Save as markdown
  bun cli.ts analyze -o=map.json               # Export as JSON
  bun cli.ts analyze --format=mermaid          # Generate Mermaid diagram
  bun cli.ts analyze --main-board=profiles     # Set profiles as main board
  bun cli.ts analyze --tracked-only            # Filter out phantom boards
`);
}

// =============================================================================
// Main Command
// =============================================================================

export async function analyzeCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);

  // Check for API token
  const apiToken = process.env.MONDAY_API_TOKEN;
  if (!apiToken) {
    throw new Error("MONDAY_API_TOKEN environment variable is required");
  }

  setApiToken(apiToken);

  console.log("Analyzing board relationships...\n");

  // Load board config and fetch all boards
  const boardsConfig = await loadBoardsConfig();
  const boards = new Map<string, Awaited<ReturnType<typeof fetchBoardStructure>>>();

  const boardKeys = Object.keys(boardsConfig);
  let fetched = 0;

  for (const [key, config] of Object.entries(boardsConfig)) {
    fetched++;
    process.stdout.write(`\r  Fetching boards... [${fetched}/${boardKeys.length}] ${key}`);
    const board = await fetchBoardStructure(config.id);
    boards.set(key, board);
  }

  console.log(`\r  Fetched ${boards.size} boards.                              \n`);

  // Analyze boards
  const data = analyzeBoards(boards, {
    mainBoardKey: options.mainBoard,
    trackedOnly: options.trackedOnly,
  });

  // Generate output based on format
  let output: string;

  switch (options.format) {
    case "json":
      output = renderJSON(data);
      break;
    case "mermaid":
      output = renderSimpleDiagram(data);
      break;
    case "markdown":
    default:
      output = renderMarkdownDocument(data, {
        includeMirrors: options.includeMirrors,
      });
      break;
  }

  // Output
  if (options.output) {
    await writeFile(options.output, output, "utf-8");
    console.log(`Written to: ${options.output}`);

    // Print summary
    console.log(`\nSummary:`);
    console.log(`  Boards: ${data.stats.totalBoards}`);
    console.log(`  Connections: ${data.stats.totalConnections}`);
    console.log(`  Bidirectional: ${data.stats.bidirectionalConnections}`);
    console.log(`  Mirrors: ${data.stats.totalMirrors}`);
  } else {
    console.log(output);
  }
}
