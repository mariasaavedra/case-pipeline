// =============================================================================
// Render Command - Generate documents from Monday.com items
// =============================================================================

import Handlebars from "handlebars";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { loadConfig } from "../../lib/config";
import {
  setApiToken,
  fetchBoardStructure,
  fetchAllBoardItems,
  fetchItem,
  resolveAllColumns,
} from "../../lib/monday";
import { mapItemToTemplateVars, validateTemplateVars } from "../../lib/template";
import type { MondayItem } from "../../lib/monday/types";

// =============================================================================
// Types
// =============================================================================

interface RenderOptions {
  itemId?: string;
  template?: string;
  outputDir?: string;
  debug?: boolean;
}

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs(args: string[]): RenderOptions {
  const options: RenderOptions = {};

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    }
    if (arg === "--debug") {
      options.debug = true;
    }
    if (arg.startsWith("--item=")) {
      options.itemId = arg.slice(7);
    }
    if (arg.startsWith("--template=")) {
      options.template = arg.slice(11);
    }
    if (arg.startsWith("--output=")) {
      options.outputDir = arg.slice(9);
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
Render Command - Generate documents from Monday.com items

Usage: bun cli.ts render [options]

Options:
  --item=<id>        Item ID to render (optional, interactive if not provided)
  --template=<name>  Template name from config (default: client_letter)
  --output=<dir>     Output directory (default: output)
  --debug            Show debug information
  --help, -h         Show this help

Examples:
  bun cli.ts render                      # Interactive profile selector
  bun cli.ts render --item=123456789     # Render specific item
  bun cli.ts render --template=contract  # Use different template
`);
}

// =============================================================================
// Interactive Profile Selector
// =============================================================================

async function selectProfile(
  boardId: string,
  boardName: string
): Promise<MondayItem | null> {
  console.log(`\nFetching profiles from "${boardName}"...`);

  const items = await fetchAllBoardItems(boardId, {
    maxItems: 100,
    onProgress: (count) => process.stdout.write(`\r  Loaded ${count} items...`),
  });

  console.log(`\r  Found ${items.length} profiles.          \n`);

  if (items.length === 0) {
    console.log("No profiles found in this board.");
    return null;
  }

  // Group items by their group
  const groupedItems = new Map<string, MondayItem[]>();
  for (const item of items) {
    const groupTitle = item.group?.title || "No Group";
    const group = groupedItems.get(groupTitle) || [];
    group.push(item);
    groupedItems.set(groupTitle, group);
  }

  // Display profiles
  console.log("Available profiles:\n");

  let index = 1;
  const indexMap = new Map<number, MondayItem>();

  for (const [groupTitle, groupItems] of groupedItems) {
    console.log(`  ${groupTitle}:`);
    for (const item of groupItems) {
      // Get email if available
      const emailCol = item.column_values.find(
        (cv) => cv.id.includes("email") || cv.text?.includes("@")
      );
      const email = emailCol?.text || "";

      console.log(
        `    [${index.toString().padStart(2)}] ${item.name.padEnd(30)} ${email}`
      );
      indexMap.set(index, item);
      index++;
    }
    console.log();
  }

  // Prompt for selection
  const input = await promptUser("Enter profile number (or 'q' to quit): ");

  if (input.toLowerCase() === "q" || input === "") {
    return null;
  }

  const selectedIndex = parseInt(input, 10);
  const selectedItem = indexMap.get(selectedIndex);

  if (!selectedItem) {
    console.error(`Invalid selection: ${input}`);
    return null;
  }

  return selectedItem;
}

async function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// =============================================================================
// Template Rendering
// =============================================================================

async function renderTemplate(
  templatePath: string,
  vars: Record<string, string>,
  outputPath: string
): Promise<void> {
  const exists = await access(templatePath).then(() => true).catch(() => false);
  if (!exists) {
    throw new Error(`Template file not found: ${templatePath}`);
  }

  const templateSource = await readFile(templatePath, "utf-8");
  const template = Handlebars.compile(templateSource);
  const content = template(vars);
  await writeFile(outputPath, content, "utf-8");
}

// =============================================================================
// Main Command
// =============================================================================

export async function renderCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const startTime = performance.now();

  // Check for API token
  const apiToken = process.env.MONDAY_API_TOKEN;
  if (!apiToken) {
    throw new Error("MONDAY_API_TOKEN environment variable is required");
  }

  setApiToken(apiToken);

  // Load configuration
  console.log("Loading configuration...");
  const config = await loadConfig();

  const templateName = options.template || "client_letter";
  const templateConfig = config.templates[templateName];

  if (!templateConfig) {
    const available = Object.keys(config.templates).join(", ");
    throw new Error(
      `Template "${templateName}" not found. Available: ${available}`
    );
  }

  const boardConfig = config.boards[templateConfig.source_board];
  if (!boardConfig) {
    throw new Error(`Board "${templateConfig.source_board}" not found in config`);
  }

  if (options.debug) {
    console.log(`  Template: ${templateName}`);
    console.log(`  Source board: ${templateConfig.source_board} (${boardConfig.id})`);
  }

  // Get item ID (either from args or interactive selection)
  let itemId = options.itemId;

  if (!itemId) {
    // Interactive mode: fetch and display profiles
    const board = await fetchBoardStructure(boardConfig.id);
    const selectedItem = await selectProfile(boardConfig.id, board.name);

    if (!selectedItem) {
      console.log("\nNo profile selected. Exiting.");
      return;
    }

    itemId = selectedItem.id;
    console.log(`\nSelected: ${selectedItem.name} (ID: ${itemId})`);
  }

  // Fetch board structure for column resolution
  console.log("\nFetching board structure...");
  const board = await fetchBoardStructure(boardConfig.id);
  console.log(`  Board: "${board.name}" (${board.columns.length} columns)`);

  // Resolve columns dynamically
  console.log("\nResolving columns...");
  const resolvedColumns = resolveAllColumns(board.columns, boardConfig, {
    debug: options.debug,
  });

  if (options.debug) {
    const resolved = Object.entries(resolvedColumns).filter(([_, col]) => col);
    const unresolved = Object.entries(resolvedColumns).filter(([_, col]) => !col);
    console.log(`  Resolved: ${resolved.length}, Unresolved: ${unresolved.length}`);
  }

  // Fetch the full item with all column values
  console.log(`\nFetching item ${itemId}...`);
  const item = await fetchItem(itemId);
  console.log(`  Item: "${item.name}"`);

  // Map to template variables
  console.log("\nMapping to template variables...");
  const vars = mapItemToTemplateVars(item, templateConfig, resolvedColumns);

  if (options.debug) {
    console.log("\nTemplate variables:");
    console.log(JSON.stringify(vars, null, 2));
  }

  // Validate variables
  const validation = validateTemplateVars(vars, templateConfig);
  if (validation.warnings.length > 0) {
    console.log("\nWarnings:");
    validation.warnings.forEach((w) => console.log(`  ! ${w}`));
  }
  if (!validation.valid) {
    console.error("\nValidation errors:");
    validation.errors.forEach((e) => console.error(`  x ${e}`));
    throw new Error("Template validation failed");
  }

  // Render template
  const outputDir = options.outputDir || "output";
  await mkdir(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = item.name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
  const outputFilename = `${safeName}-${timestamp}.txt`;
  const outputPath = join(outputDir, outputFilename);

  console.log("\nRendering template...");
  await renderTemplate(templateConfig.path, vars, outputPath);
  console.log(`  Output: ${outputPath}`);

  const elapsed = (performance.now() - startTime).toFixed(0);
  console.log(`\nDone in ${elapsed}ms`);
}
