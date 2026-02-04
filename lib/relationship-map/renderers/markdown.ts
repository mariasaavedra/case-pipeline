// =============================================================================
// Relationship Map - Markdown Renderer
// =============================================================================
// Renders relationship map data as a complete Markdown document.
// =============================================================================

import type { RelationshipMapData, RenderOptions } from "../types";
import { renderMentalMap, renderDataFlowDiagram } from "./mermaid";

/**
 * Render the complete markdown document
 */
export function renderMarkdownDocument(
  data: RelationshipMapData,
  options: RenderOptions = {}
): string {
  const lines: string[] = [];
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Header
  lines.push("# Board Relationship Map");
  lines.push("");
  lines.push(`> Last updated: ${dateStr}`);
  lines.push("");

  // Main mental map diagram - the star of the show
  lines.push("## Structure");
  lines.push("");
  lines.push(renderMentalMap(data, options));
  lines.push("");

  lines.push("---");
  lines.push("");

  // Quick stats
  lines.push("## Summary");
  lines.push("");

  if (data.mainBoard) {
    lines.push(`**Main Board:** ${data.mainBoard.name}`);
    lines.push("");
  }

  lines.push(`- **${data.stats.totalBoards}** boards`);
  lines.push(`- **${data.stats.totalConnections}** connections`);
  lines.push(`- **${data.stats.totalMirrors}** mirror columns (shared data)`);
  lines.push("");

  lines.push("---");
  lines.push("");

  // Board details
  lines.push("## Board Details");
  lines.push("");

  for (const board of data.boards) {
    const badge = board.isMainBoard ? " (Main)" : "";

    lines.push(`### ${board.name}${badge}`);
    lines.push("");

    // Outgoing connections from this board
    const outgoing = data.connections.filter((c) => c.sourceBoard.id === board.id);
    if (outgoing.length > 0) {
      lines.push("**Links to:**");
      for (const conn of outgoing) {
        lines.push(`- ${conn.targetBoard.name} (via "${conn.columnName}")`);
      }
      lines.push("");
    }

    // Mirrors on this board
    const boardMirrors = data.mirrorsByBoard.find((m) => m.board.id === board.id);
    if (boardMirrors && boardMirrors.mirrors.length > 0) {
      lines.push("**Displays from linked boards:**");
      for (const mirror of boardMirrors.mirrors) {
        lines.push(`- ${mirror.columnName}`);
      }
      lines.push("");
    }
  }

  // Footer
  lines.push("---");
  lines.push("");
  lines.push(`<sub>Generated: ${data.generatedAt}</sub>`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Render an illustrated/detailed markdown document with multiple views
 */
export function renderIllustratedDocument(
  data: RelationshipMapData,
  options: RenderOptions = {}
): string {
  const lines: string[] = [];
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Header with emoji
  lines.push("# 🗺️ Board Relationship Map");
  lines.push("");
  lines.push(`> 📅 Last updated: ${dateStr}`);
  lines.push("");

  // Quick stats card
  lines.push("## 📊 Overview");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| 📋 Total Boards | ${data.stats.totalBoards} |`);
  lines.push(`| 🔗 Connections | ${data.stats.totalConnections} |`);
  lines.push(`| ↔️ Bidirectional | ${data.stats.bidirectionalConnections} |`);
  lines.push(`| 🪞 Mirror Columns | ${data.stats.totalMirrors} |`);
  lines.push("");

  if (data.mainBoard) {
    lines.push(`**🏠 Central Hub:** ${data.mainBoard.name}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // Mental map diagram
  lines.push("## 🧠 Mental Map");
  lines.push("");
  lines.push("*Clean hierarchical view with main board at top*");
  lines.push("");
  lines.push(renderMentalMap(data, options));
  lines.push("");

  lines.push("---");
  lines.push("");

  // Data flow diagram
  lines.push("## 🔄 Data Flow");
  lines.push("");
  lines.push("*Shows how data flows between boards*");
  lines.push("");
  lines.push(renderDataFlowDiagram(data, options));
  lines.push("");

  lines.push("---");
  lines.push("");

  // Detailed board cards
  lines.push("## 📋 Board Details");
  lines.push("");

  for (const board of data.boards) {
    const icon = board.isMainBoard ? "🏠" : "📋";
    const badge = board.isMainBoard ? " ⭐ Main Board" : "";

    lines.push(`### ${icon} ${board.name}${badge}`);
    lines.push("");

    // Board info table
    lines.push("| Property | Value |");
    lines.push("|----------|-------|");
    lines.push(`| ID | \`${board.id}\` |`);
    lines.push(`| Config Key | \`${board.configKey}\` |`);
    lines.push(`| Columns | ${board.columnCount} |`);
    lines.push(`| Groups | ${board.groupCount} |`);
    lines.push("");

    // Outgoing connections
    const outgoing = data.connections.filter((c) => c.sourceBoard.id === board.id);
    if (outgoing.length > 0) {
      lines.push("**🔗 Links to:**");
      lines.push("");
      for (const conn of outgoing) {
        const dirIcon = conn.direction === "bidirectional" ? "↔️" : "→";
        lines.push(`- ${dirIcon} **${conn.targetBoard.name}** via \`${conn.columnName}\``);
      }
      lines.push("");
    }

    // Incoming connections
    const incoming = data.connections.filter((c) => c.targetBoard.id === board.id && c.direction !== "bidirectional");
    if (incoming.length > 0) {
      lines.push("**📥 Linked from:**");
      lines.push("");
      for (const conn of incoming) {
        lines.push(`- ← **${conn.sourceBoard.name}** via \`${conn.columnName}\``);
      }
      lines.push("");
    }

    // Mirrors
    const boardMirrors = data.mirrorsByBoard.find((m) => m.board.id === board.id);
    if (boardMirrors && boardMirrors.mirrors.length > 0) {
      lines.push("**🪞 Mirror Columns (displays data from linked boards):**");
      lines.push("");
      for (const mirror of boardMirrors.mirrors) {
        lines.push(`- ${mirror.columnName} (\`${mirror.columnId}\`)`);
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  // Connection matrix
  lines.push("## 🔗 Connection Matrix");
  lines.push("");
  lines.push("| From | To | Column | Type |");
  lines.push("|------|-----|--------|------|");
  for (const conn of data.connections) {
    const typeIcon = conn.direction === "bidirectional" ? "↔️" : "→";
    lines.push(`| ${conn.sourceBoard.name} | ${conn.targetBoard.name} | ${conn.columnName} | ${typeIcon} |`);
  }
  lines.push("");

  // Footer
  lines.push("---");
  lines.push("");
  lines.push(`<sub>🤖 Generated: ${data.generatedAt}</sub>`);
  lines.push("");

  return lines.join("\n");
}
