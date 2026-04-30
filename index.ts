// =============================================================================
// Case Pipeline - Config-driven document generation from Monday.com
// =============================================================================

import Handlebars from "handlebars";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig } from "./lib/config";
import {
  setApiToken,
  fetchBoardStructure,
  fetchItem,
  resolveAllColumns,
} from "./lib/monday";
import { mapItemToTemplateVars, validateTemplateVars } from "./lib/template";

// =============================================================================
// Configuration
// =============================================================================

const envConfig = {
  mondayApiToken: process.env.MONDAY_API_TOKEN!,
  itemId: process.env.ITEM_ID!,
  templateName: process.env.TEMPLATE_NAME || "client_letter",
  outputDir: process.env.OUTPUT_DIR || "output",
  debug: process.argv.includes("--debug"),
};

if (!envConfig.mondayApiToken || !envConfig.itemId) {
  console.error("Error: MONDAY_API_TOKEN and ITEM_ID are required in .env");
  process.exit(1);
}

// =============================================================================
// Template rendering
// =============================================================================

async function renderTemplate(
  templatePath: string,
  vars: Record<string, string>,
  outputPath: string
): Promise<void> {
  const templateFile = Bun.file(templatePath);
  const templateSource = await templateFile.text();
  const template = Handlebars.compile(templateSource);
  const content = template(vars);
  await Bun.write(outputPath, content);
}

// =============================================================================
// Main execution
// =============================================================================

async function main() {
  const startTime = performance.now();

  try {
    // Step 1: Load configuration
    console.log("Loading configuration...");
    const config = await loadConfig();

    const templateConfig = config.templates[envConfig.templateName];
    if (!templateConfig) {
      throw new Error(`Template "${envConfig.templateName}" not found in config`);
    }

    const boardConfig = config.boards[templateConfig.source_board];
    if (!boardConfig) {
      throw new Error(`Board "${templateConfig.source_board}" not found in config`);
    }

    if (envConfig.debug) {
      console.log(`  Template: ${envConfig.templateName}`);
      console.log(`  Source board: ${templateConfig.source_board} (${boardConfig.id})`);
    }

    // Step 2: Initialize API
    setApiToken(envConfig.mondayApiToken);

    // Step 3: Fetch board structure for column resolution
    console.log(`\nFetching board structure...`);
    const board = await fetchBoardStructure(boardConfig.id);
    console.log(`  Board: "${board.name}" (${board.columns.length} columns)`);

    // Step 4: Resolve columns dynamically
    console.log("\nResolving columns...");
    const resolvedColumns = resolveAllColumns(board.columns, boardConfig, {
      debug: envConfig.debug,
    });

    if (envConfig.debug) {
      const resolved = Object.entries(resolvedColumns).filter(([_, col]) => col);
      const unresolved = Object.entries(resolvedColumns).filter(([_, col]) => !col);
      console.log(`  Resolved: ${resolved.length}, Unresolved: ${unresolved.length}`);
    }

    // Step 5: Fetch the item
    console.log(`\nFetching item ${envConfig.itemId}...`);
    const item = await fetchItem(envConfig.itemId);
    console.log(`  Item: "${item.name}"`);

    // Step 6: Map to template variables
    console.log("\nMapping to template variables...");
    const vars = mapItemToTemplateVars(item, templateConfig, resolvedColumns);

    if (envConfig.debug) {
      console.log("\nTemplate variables:");
      console.log(JSON.stringify(vars, null, 2));
    }

    // Step 7: Validate variables
    const validation = validateTemplateVars(vars, templateConfig);
    if (validation.warnings.length > 0) {
      console.log("\nWarnings:");
      validation.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
    }
    if (!validation.valid) {
      console.error("\nValidation errors:");
      validation.errors.forEach((e) => console.error(`  ✗ ${e}`));
      throw new Error("Template validation failed");
    }

    // Step 8: Render template
    await mkdir(envConfig.outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputFilename = `rendered-${envConfig.itemId}-${timestamp}.txt`;
    const outputPath = join(envConfig.outputDir, outputFilename);

    console.log("\nRendering template...");
    await renderTemplate(templateConfig.path, vars, outputPath);
    console.log(`  Output: ${outputPath}`);

    const elapsed = (performance.now() - startTime).toFixed(0);
    console.log(`\nDone in ${elapsed}ms`);
  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

main();
