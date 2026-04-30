// =============================================================================
// Relationship Map - Mermaid Renderer
// =============================================================================
// Renders relationship map data as Mermaid diagrams in mental map style.
// Clean, simple tree structure with main board at top.
// =============================================================================

import type { RelationshipMapData, RenderOptions } from "../types";

/**
 * Create a safe Mermaid node ID from a board ID
 */
function nodeId(boardId: string): string {
  return `board_${boardId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * Render a simple overview diagram - horizontal layout
 */
export function renderSimpleDiagram(
  data: RelationshipMapData,
  _options: RenderOptions = {}
): string {
  const lines: string[] = [];

  lines.push("```mermaid");
  lines.push("flowchart LR");
  lines.push("");

  // Simple styling - orange boxes like the example
  lines.push("  classDef default fill:#F5A623,stroke:#000,stroke-width:1px,color:#000,font-weight:bold");
  lines.push("  classDef main fill:#F5A623,stroke:#000,stroke-width:2px,color:#000,font-weight:bold,font-size:16px");
  lines.push("");

  // Main board
  if (data.mainBoard) {
    lines.push(`  ${nodeId(data.mainBoard.id)}["${data.mainBoard.name.toUpperCase()}"]:::main`);
  }

  // Other boards
  for (const board of data.boards.filter(b => !b.isMainBoard)) {
    lines.push(`  ${nodeId(board.id)}["${board.name}"]`);
  }

  lines.push("");

  // Connections - show from main board outward
  const processedPairs = new Set<string>();
  for (const conn of data.connections) {
    const pairKey = [conn.sourceBoard.id, conn.targetBoard.id].sort().join("-");
    if (processedPairs.has(pairKey)) continue;
    processedPairs.add(pairKey);

    const src = nodeId(conn.sourceBoard.id);
    const tgt = nodeId(conn.targetBoard.id);

    lines.push(`  ${src} --> ${tgt}`);
  }

  lines.push("```");
  return lines.join("\n");
}

/**
 * Render a mental map style diagram - clean tree structure
 * Main board at top, connected boards branching down
 */
export function renderMentalMap(
  data: RelationshipMapData,
  _options: RenderOptions = {}
): string {
  const lines: string[] = [];

  lines.push("```mermaid");
  lines.push("flowchart TB");
  lines.push("");

  // Clean styling - orange boxes like the example image
  lines.push("  %% Styling");
  lines.push("  classDef default fill:#F5A623,stroke:#000,stroke-width:1px,color:#000,font-weight:bold");
  lines.push("  classDef main fill:#F5A623,stroke:#000,stroke-width:2px,color:#000,font-weight:bold,font-size:18px");
  lines.push("");

  const mainBoard = data.mainBoard;

  if (!mainBoard) {
    // No main board - just show all boards
    for (const board of data.boards) {
      lines.push(`  ${nodeId(board.id)}["${board.name}"]`);
    }
  } else {
    // Main board at top - uppercase for emphasis
    lines.push(`  ${nodeId(mainBoard.id)}["${mainBoard.name.toUpperCase()}"]:::main`);
    lines.push("");

    // Other boards
    for (const board of data.boards.filter(b => !b.isMainBoard)) {
      lines.push(`  ${nodeId(board.id)}["${board.name}"]`);
    }
  }

  lines.push("");

  // Connections - simple arrows, main board connections first
  // Build a tree structure: main -> direct children, children -> grandchildren
  const mainId = mainBoard?.id;
  const drawnConnections = new Set<string>();

  if (mainId) {
    // First: connections FROM main board
    for (const conn of data.connections) {
      if (conn.sourceBoard.id === mainId) {
        const src = nodeId(conn.sourceBoard.id);
        const tgt = nodeId(conn.targetBoard.id);
        const key = `${conn.sourceBoard.id}-${conn.targetBoard.id}`;
        if (!drawnConnections.has(key)) {
          lines.push(`  ${src} --> ${tgt}`);
          drawnConnections.add(key);
          drawnConnections.add(`${conn.targetBoard.id}-${conn.sourceBoard.id}`); // Mark reverse as drawn too
        }
      }
    }

    // Second: connections between non-main boards
    for (const conn of data.connections) {
      if (conn.sourceBoard.id !== mainId && conn.targetBoard.id !== mainId) {
        const src = nodeId(conn.sourceBoard.id);
        const tgt = nodeId(conn.targetBoard.id);
        const key = `${conn.sourceBoard.id}-${conn.targetBoard.id}`;
        if (!drawnConnections.has(key)) {
          lines.push(`  ${src} --> ${tgt}`);
          drawnConnections.add(key);
          drawnConnections.add(`${conn.targetBoard.id}-${conn.sourceBoard.id}`);
        }
      }
    }
  } else {
    // No main board - draw all connections
    const processedPairs = new Set<string>();
    for (const conn of data.connections) {
      const pairKey = [conn.sourceBoard.id, conn.targetBoard.id].sort().join("-");
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      const src = nodeId(conn.sourceBoard.id);
      const tgt = nodeId(conn.targetBoard.id);
      lines.push(`  ${src} --> ${tgt}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

/**
 * Render a detailed diagram showing data flow between boards
 */
export function renderDataFlowDiagram(
  data: RelationshipMapData,
  _options: RenderOptions = {}
): string {
  const lines: string[] = [];

  lines.push("```mermaid");
  lines.push("flowchart LR");
  lines.push("");

  // Styling
  lines.push("  %% Styling");
  lines.push("  classDef board fill:#3b82f6,stroke:#1d4ed8,stroke-width:3px,color:#fff,font-weight:bold");
  lines.push("  classDef data fill:#fef3c7,stroke:#f59e0b,stroke-width:1px,color:#000,font-size:10px");
  lines.push("  linkStyle default stroke:#6366f1,stroke-width:2px");
  lines.push("");

  const mainBoard = data.mainBoard;
  const mirrorsMap = new Map(data.mirrorsByBoard.map((m) => [m.board.id, m.mirrors]));

  if (mainBoard) {
    // Main board in center
    lines.push(`  ${nodeId(mainBoard.id)}[["🏠 ${mainBoard.name}"]]:::board`);
    lines.push("");

    // Show each connected board with its data exchange
    for (const board of data.boards.filter((b) => !b.isMainBoard)) {
      lines.push(`  ${nodeId(board.id)}["📋 ${board.name}"]:::board`);

      // Find connection from main to this board
      const outConn = data.connections.find(
        (c) => c.sourceBoard.id === mainBoard.id && c.targetBoard.id === board.id
      );

      // Find connection from this board to main
      const inConn = data.connections.find(
        (c) => c.sourceBoard.id === board.id && c.targetBoard.id === mainBoard.id
      );

      const mainNode = nodeId(mainBoard.id);
      const otherNode = nodeId(board.id);

      if (outConn && inConn) {
        // Bidirectional - show one thick line
        lines.push(`  ${mainNode} <--->|"🔗"| ${otherNode}`);
      } else if (outConn) {
        lines.push(`  ${mainNode} --->|"${outConn.columnName}"| ${otherNode}`);
      } else if (inConn) {
        lines.push(`  ${otherNode} --->|"${inConn.columnName}"| ${mainNode}`);
      }

      // Show what data flows from this board to main via mirrors
      const mainMirrors = mirrorsMap.get(mainBoard.id) || [];
      const mirrorsFromThisBoard = mainMirrors.filter((m) => {
        // In a real implementation, we'd check the mirror source
        // For now, show all mirrors
        return true;
      });

      lines.push("");
    }
  }

  lines.push("```");
  return lines.join("\n");
}

/**
 * Generate all Mermaid diagrams for a relationship map
 */
export function renderAllDiagrams(
  data: RelationshipMapData,
  options: RenderOptions = {}
): { simple: string; mentalMap: string; dataFlow: string } {
  return {
    simple: renderSimpleDiagram(data, options),
    mentalMap: renderMentalMap(data, options),
    dataFlow: renderDataFlowDiagram(data, options),
  };
}
