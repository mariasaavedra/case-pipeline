// =============================================================================
// Monday.com Data Snapshot
// =============================================================================
// Fetches all items from all 18 boards and produces a distribution report.
// Usage: bun scripts/snapshot.ts
// =============================================================================

import { writeFile } from "node:fs/promises";
import {
  setApiToken,
  fetchBoardStructure,
  fetchAllBoardItems,
} from "@case-pipeline/monday";
import { loadBoardsConfig } from "@case-pipeline/config";
import type { MondayItem, MondayBoard } from "@case-pipeline/monday/types";

// =============================================================================
// Setup
// =============================================================================

const token = process.env.MONDAY_API_TOKEN;
if (!token) {
  console.error("Error: MONDAY_API_TOKEN is required");
  process.exit(1);
}
setApiToken(token);

interface BoardSnapshot {
  key: string;
  id: string;
  name: string;
  itemCount: number;
  groups: { id: string; title: string; itemCount: number }[];
  columns: { id: string; title: string; type: string }[];
  // Distribution data
  statusDistribution: Record<string, Record<string, number>>;
  dropdownDistribution: Record<string, Record<string, number>>;
  relationshipColumns: { key: string; title: string; linkedCounts: number[] }[];
  sampleItems: { name: string; group?: string }[];
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const boardsConfig = await loadBoardsConfig();
  const boardKeys = Object.keys(boardsConfig);

  console.log(`\nMonday.com Data Snapshot`);
  console.log(`=======================`);
  console.log(`Boards to fetch: ${boardKeys.length}\n`);

  const snapshots: BoardSnapshot[] = [];

  for (const key of boardKeys) {
    const config = boardsConfig[key]!;
    const boardId = config.id;

    process.stdout.write(`  Fetching ${key} (${boardId})...`);

    try {
      // Fetch structure (columns + groups)
      const structure = await fetchBoardStructure(boardId);

      // Fetch all items
      const items = await fetchAllBoardItems(boardId, {
        maxItems: 10000,
        onProgress: (count) => {
          process.stdout.write(`\r  Fetching ${key} (${boardId})... ${count} items`);
        },
      });

      process.stdout.write(`\r  Fetching ${key} (${boardId})... ${items.length} items ✓\n`);

      const snapshot = analyzeBoard(key, structure, items);
      snapshots.push(snapshot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(` ERROR: ${msg}`);
    }
  }

  // Generate report
  const report = generateReport(snapshots);
  const reportPath = "data/monday-snapshot.md";
  await writeFile(reportPath, report, "utf-8");
  console.log(`\nReport saved to ${reportPath}`);

  // Also save raw JSON for programmatic use
  const jsonPath = "data/monday-snapshot.json";
  await writeFile(jsonPath, JSON.stringify(snapshots, null, 2), "utf-8");
  console.log(`Raw data saved to ${jsonPath}`);
}

// =============================================================================
// Analysis
// =============================================================================

function analyzeBoard(
  key: string,
  structure: MondayBoard,
  items: MondayItem[]
): BoardSnapshot {
  // Count items per group
  const groupCounts = new Map<string, number>();
  for (const item of items) {
    const groupTitle = item.group?.title ?? "(no group)";
    groupCounts.set(groupTitle, (groupCounts.get(groupTitle) ?? 0) + 1);
  }

  const groups = structure.groups.map((g) => ({
    id: g.id,
    title: g.title,
    itemCount: groupCounts.get(g.title) ?? 0,
  }));

  // Status columns distribution
  const statusDistribution: Record<string, Record<string, number>> = {};
  const dropdownDistribution: Record<string, Record<string, number>> = {};
  const relationshipColumns: BoardSnapshot["relationshipColumns"] = [];

  for (const col of structure.columns) {
    if (col.type === "status" || col.type === "color") {
      const dist: Record<string, number> = {};
      for (const item of items) {
        const cv = item.column_values.find((c) => c.id === col.id);
        const text = cv?.text;
        if (text) {
          dist[text] = (dist[text] ?? 0) + 1;
        } else {
          dist["(empty)"] = (dist["(empty)"] ?? 0) + 1;
        }
      }
      if (Object.keys(dist).length > 1 || !dist["(empty)"]) {
        statusDistribution[`${col.title} [${col.id}]`] = dist;
      }
    }

    if (col.type === "dropdown" || col.type === "tags") {
      const dist: Record<string, number> = {};
      for (const item of items) {
        const cv = item.column_values.find((c) => c.id === col.id);
        const text = cv?.text;
        if (text) {
          // Dropdown values can be comma-separated
          const values = text.split(",").map((v) => v.trim());
          for (const v of values) {
            if (v) dist[v] = (dist[v] ?? 0) + 1;
          }
        }
      }
      if (Object.keys(dist).length > 0) {
        dropdownDistribution[`${col.title} [${col.id}]`] = dist;
      }
    }

    if (col.type === "board_relation") {
      const counts: number[] = [];
      for (const item of items) {
        const cv = item.column_values.find((c) => c.id === col.id);
        const linked = cv?.linked_item_ids?.length ?? 0;
        if (linked > 0) counts.push(linked);
      }
      if (counts.length > 0) {
        relationshipColumns.push({
          key: col.id,
          title: col.title,
          linkedCounts: counts,
        });
      }
    }
  }

  // Sample items (first 5)
  const sampleItems = items.slice(0, 5).map((item) => ({
    name: item.name,
    group: item.group?.title,
  }));

  return {
    key,
    id: structure.id,
    name: structure.name,
    itemCount: items.length,
    groups,
    columns: structure.columns.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
    })),
    statusDistribution,
    dropdownDistribution,
    relationshipColumns,
    sampleItems,
  };
}

// =============================================================================
// Report Generation
// =============================================================================

function generateReport(snapshots: BoardSnapshot[]): string {
  const lines: string[] = [];

  lines.push("# Monday.com Data Snapshot");
  lines.push(`\nGenerated: ${new Date().toISOString()}\n`);

  // Summary table
  lines.push("## Board Summary\n");
  lines.push("| Board | Items | Groups |");
  lines.push("|-------|------:|--------|");
  for (const s of snapshots) {
    const groupList = s.groups
      .filter((g) => g.itemCount > 0)
      .map((g) => `${g.title} (${g.itemCount})`)
      .join(", ");
    lines.push(`| ${s.name} | ${s.itemCount} | ${groupList || "(none)"} |`);
  }

  // Per-board detail
  for (const s of snapshots) {
    lines.push(`\n---\n`);
    lines.push(`## ${s.name} (\`${s.key}\`)`);
    lines.push(`- **Board ID:** ${s.id}`);
    lines.push(`- **Total items:** ${s.itemCount}`);

    // Groups
    if (s.groups.length > 0) {
      lines.push(`\n### Groups\n`);
      lines.push("| Group | Items |");
      lines.push("|-------|------:|");
      for (const g of s.groups.sort((a, b) => b.itemCount - a.itemCount)) {
        lines.push(`| ${g.title} | ${g.itemCount} |`);
      }
    }

    // Status distributions
    if (Object.keys(s.statusDistribution).length > 0) {
      lines.push(`\n### Status Columns\n`);
      for (const [colName, dist] of Object.entries(s.statusDistribution)) {
        lines.push(`**${colName}:**`);
        const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
        for (const [label, count] of sorted) {
          const pct = ((count / s.itemCount) * 100).toFixed(1);
          lines.push(`- ${label}: ${count} (${pct}%)`);
        }
        lines.push("");
      }
    }

    // Dropdown/tag distributions
    if (Object.keys(s.dropdownDistribution).length > 0) {
      lines.push(`\n### Dropdown/Tag Columns\n`);
      for (const [colName, dist] of Object.entries(s.dropdownDistribution)) {
        lines.push(`**${colName}:**`);
        const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
        const top = sorted.slice(0, 20); // Show top 20
        for (const [label, count] of top) {
          lines.push(`- ${label}: ${count}`);
        }
        if (sorted.length > 20) {
          lines.push(`- ... and ${sorted.length - 20} more`);
        }
        lines.push("");
      }
    }

    // Relationships
    if (s.relationshipColumns.length > 0) {
      lines.push(`\n### Relationships\n`);
      for (const rel of s.relationshipColumns) {
        const total = rel.linkedCounts.length;
        const avg = (
          rel.linkedCounts.reduce((a, b) => a + b, 0) / total
        ).toFixed(1);
        const max = Math.max(...rel.linkedCounts);
        lines.push(
          `- **${rel.title}** (${rel.key}): ${total} items linked, avg ${avg} links, max ${max}`
        );
      }
    }

    // Sample items
    if (s.sampleItems.length > 0) {
      lines.push(`\n### Sample Items\n`);
      for (const item of s.sampleItems) {
        lines.push(`- ${item.name}${item.group ? ` [${item.group}]` : ""}`);
      }
    }
  }

  return lines.join("\n");
}

// =============================================================================
// Run
// =============================================================================

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
