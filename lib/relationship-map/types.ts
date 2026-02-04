// =============================================================================
// Relationship Map - Core Types
// =============================================================================
// These types define the data structure for board relationships.
// Designed to be consumed by multiple renderers (Mermaid, JSON, future UI).
// =============================================================================

/**
 * Represents a Monday.com board in the relationship map
 */
export interface MapBoard {
  id: string;
  name: string;
  configKey: string;
  isMainBoard: boolean; // True if this is the primary/central board
  columnCount: number;
  groupCount: number;
}

/**
 * Represents a connection between two boards via a board_relation column
 */
export interface BoardConnection {
  id: string; // Unique identifier for this connection
  sourceBoard: {
    id: string;
    name: string;
  };
  targetBoard: {
    id: string;
    name: string;
  };
  columnName: string; // The column that creates this connection
  columnId: string;
  direction: "outgoing" | "incoming" | "bidirectional";
}

/**
 * Represents a mirror column that displays data from a linked board
 */
export interface MirrorColumn {
  id: string;
  board: {
    id: string;
    name: string;
  };
  columnName: string;
  columnId: string;
  sourceBoard: {
    id: string;
    name: string;
  } | null;
}

/**
 * Group of mirror columns organized by board
 */
export interface BoardMirrors {
  board: {
    id: string;
    name: string;
  };
  mirrors: MirrorColumn[];
}

/**
 * The complete relationship map data structure
 * This is the main output that renderers consume
 */
export interface RelationshipMapData {
  // Metadata
  generatedAt: string;
  version: string;

  // The main/central board (typically the one with most connections)
  mainBoard: MapBoard | null;

  // All boards in the map
  boards: MapBoard[];

  // Connections between boards
  connections: BoardConnection[];

  // Mirror columns grouped by board
  mirrorsByBoard: BoardMirrors[];

  // Statistics
  stats: {
    totalBoards: number;
    totalConnections: number;
    totalMirrors: number;
    bidirectionalConnections: number;
  };
}

/**
 * Options for analyzing relationships
 */
export interface AnalyzerOptions {
  /**
   * The config key of the board to treat as the main/central board.
   * If not specified, the board with the most connections is used.
   */
  mainBoardKey?: string;
}

/**
 * Options for rendering
 */
export interface RenderOptions {
  /**
   * Include detailed mirror column information
   */
  includeMirrors?: boolean;

  /**
   * Color scheme for visual renderers
   */
  colorScheme?: "default" | "monochrome" | "colorful";

  /**
   * Layout direction for diagrams
   */
  layout?: "horizontal" | "vertical" | "radial";
}
