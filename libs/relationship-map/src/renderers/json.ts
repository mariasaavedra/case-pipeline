// =============================================================================
// Relationship Map - JSON Renderer
// =============================================================================
// Exports relationship map data as JSON for UI consumption.
// This format is designed to be easily consumed by frontend frameworks.
// =============================================================================

import type { RelationshipMapData } from "../types";

/**
 * UI-ready node representation for graph visualization libraries
 */
export interface UINode {
  id: string;
  label: string;
  type: "main" | "linked";
  data: {
    configKey: string;
    columnCount: number;
    groupCount: number;
    mirrors: string[];
  };
  position?: { x: number; y: number }; // Can be pre-calculated or left for UI
}

/**
 * UI-ready edge representation for graph visualization libraries
 */
export interface UIEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  type: "unidirectional" | "bidirectional";
  data: {
    sourceColumn: string;
    targetColumn?: string; // For bidirectional
  };
}

/**
 * Complete UI-ready data structure
 * Compatible with libraries like React Flow, D3, Cytoscape, etc.
 */
export interface UIGraphData {
  // Metadata
  meta: {
    generatedAt: string;
    version: string;
    mainBoardId: string | null;
  };

  // Graph elements
  nodes: UINode[];
  edges: UIEdge[];

  // Statistics for dashboard displays
  stats: {
    totalBoards: number;
    totalConnections: number;
    totalMirrors: number;
    bidirectionalConnections: number;
  };

  // Original detailed data for drill-down views
  details: {
    boards: Array<{
      id: string;
      name: string;
      configKey: string;
      isMain: boolean;
      columns: number;
      groups: number;
      outgoingConnections: Array<{
        to: string;
        toName: string;
        column: string;
        bidirectional: boolean;
      }>;
      mirrors: Array<{
        name: string;
        id: string;
      }>;
    }>;
  };
}

/**
 * Convert relationship map data to UI-ready format
 */
export function toUIFormat(data: RelationshipMapData): UIGraphData {
  const mirrorsMap = new Map(data.mirrorsByBoard.map((m) => [m.board.id, m.mirrors]));

  // Build nodes
  const nodes: UINode[] = data.boards.map((board) => {
    const mirrors = mirrorsMap.get(board.id) || [];
    return {
      id: board.id,
      label: board.name,
      type: board.isMainBoard ? "main" : "linked",
      data: {
        configKey: board.configKey,
        columnCount: board.columnCount,
        groupCount: board.groupCount,
        mirrors: mirrors.map((m) => m.columnName),
      },
    };
  });

  // Build edges (deduplicate bidirectional)
  const edges: UIEdge[] = [];
  const processedPairs = new Set<string>();

  for (const conn of data.connections) {
    const pairKey = [conn.sourceBoard.id, conn.targetBoard.id].sort().join("-");
    if (processedPairs.has(pairKey)) continue;
    processedPairs.add(pairKey);

    // Find reverse connection if bidirectional
    const reverseConn = data.connections.find(
      (c) => c.sourceBoard.id === conn.targetBoard.id && c.targetBoard.id === conn.sourceBoard.id
    );

    edges.push({
      id: `edge-${conn.sourceBoard.id}-${conn.targetBoard.id}`,
      source: conn.sourceBoard.id,
      target: conn.targetBoard.id,
      label: conn.direction === "bidirectional" ? "Linked" : conn.columnName,
      type: conn.direction === "bidirectional" ? "bidirectional" : "unidirectional",
      data: {
        sourceColumn: conn.columnName,
        targetColumn: reverseConn?.columnName,
      },
    });
  }

  // Build detailed board info
  const details = {
    boards: data.boards.map((board) => {
      const mirrors = mirrorsMap.get(board.id) || [];
      const outgoing = data.connections
        .filter((c) => c.sourceBoard.id === board.id)
        .map((c) => ({
          to: c.targetBoard.id,
          toName: c.targetBoard.name,
          column: c.columnName,
          bidirectional: c.direction === "bidirectional",
        }));

      return {
        id: board.id,
        name: board.name,
        configKey: board.configKey,
        isMain: board.isMainBoard,
        columns: board.columnCount,
        groups: board.groupCount,
        outgoingConnections: outgoing,
        mirrors: mirrors.map((m) => ({ name: m.columnName, id: m.columnId })),
      };
    }),
  };

  return {
    meta: {
      generatedAt: data.generatedAt,
      version: data.version,
      mainBoardId: data.mainBoard?.id || null,
    },
    nodes,
    edges,
    stats: data.stats,
    details,
  };
}

/**
 * Export as JSON string (formatted for readability)
 */
export function renderJSON(data: RelationshipMapData, pretty: boolean = true): string {
  const uiData = toUIFormat(data);
  return pretty ? JSON.stringify(uiData, null, 2) : JSON.stringify(uiData);
}

/**
 * Export as a JavaScript/TypeScript module string
 * Useful for generating importable data files
 */
export function renderJSModule(data: RelationshipMapData): string {
  const uiData = toUIFormat(data);
  const json = JSON.stringify(uiData, null, 2);

  return `// Auto-generated relationship map data
// Generated: ${data.generatedAt}

import type { UIGraphData } from "@case-pipeline/relationship-map/renderers/json";

export const relationshipMapData: UIGraphData = ${json};

export default relationshipMapData;
`;
}
