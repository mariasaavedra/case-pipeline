// =============================================================================
// Relationship Map - Board Analyzer
// =============================================================================
// Analyzes Monday.com board structures and extracts relationships.
// =============================================================================

import type { MondayBoard } from "../monday/types";
import type {
  RelationshipMapData,
  MapBoard,
  BoardConnection,
  MirrorColumn,
  BoardMirrors,
  AnalyzerOptions,
} from "./types";

interface BoardRelationSettings {
  boardIds?: number[];
  linkedBoardId?: number;
}

/**
 * Parse the settings_str from a board_relation column to extract ALL linked board IDs
 * A single column can connect to multiple boards
 */
function parseLinkedBoardIds(settingsStr: string): string[] {
  try {
    const settings: BoardRelationSettings = JSON.parse(settingsStr);
    const ids: string[] = [];

    // Handle multiple board connections (boardIds array)
    if (settings.boardIds && settings.boardIds.length > 0) {
      for (const id of settings.boardIds) {
        ids.push(id.toString());
      }
    }

    // Also check for single linkedBoardId (older format)
    if (settings.linkedBoardId && !ids.includes(settings.linkedBoardId.toString())) {
      ids.push(settings.linkedBoardId.toString());
    }

    return ids;
  } catch {
    // Ignore parse errors
  }
  return [];
}

/**
 * Analyze boards and extract all relationships into a structured format
 */
export function analyzeBoards(
  boards: Map<string, MondayBoard>,
  options: AnalyzerOptions = {}
): RelationshipMapData {
  const boardLookup = new Map<string, { board: MondayBoard; configKey: string }>();
  const connections: BoardConnection[] = [];
  const allMirrors: MirrorColumn[] = [];

  // Build board lookup by ID
  for (const [configKey, board] of boards) {
    boardLookup.set(board.id, { board, configKey });
  }

  // Track connection pairs to identify bidirectional relationships
  const connectionPairs = new Map<string, { forward: BoardConnection | null; reverse: BoardConnection | null }>();

  // Analyze each board
  for (const [configKey, board] of boards) {
    for (const column of board.columns) {
      // Extract board relations
      if (column.type === "board_relation") {
        const linkedBoardIds = parseLinkedBoardIds(column.settings_str);

        // Create a connection for EACH linked board
        for (const linkedBoardId of linkedBoardIds) {
          const linkedBoardInfo = boardLookup.get(linkedBoardId);

          // Skip connections to boards not in the config
          if (options.trackedOnly && !linkedBoardInfo) {
            continue;
          }

          const connection: BoardConnection = {
            id: `${board.id}-${column.id}-${linkedBoardId}`,
            sourceBoard: {
              id: board.id,
              name: board.name,
            },
            targetBoard: {
              id: linkedBoardId,
              name: linkedBoardInfo?.board.name || `Board ${linkedBoardId}`,
            },
            columnName: column.title,
            columnId: column.id,
            direction: "outgoing", // Will be updated to bidirectional if reverse exists
          };

          connections.push(connection);

          // Track for bidirectional detection
          const pairKey = [board.id, linkedBoardId].sort().join("-");
          const pair = connectionPairs.get(pairKey) || { forward: null, reverse: null };
          if (board.id < linkedBoardId) {
            pair.forward = connection;
          } else {
            pair.reverse = connection;
          }
          connectionPairs.set(pairKey, pair);
        }
      }

      // Extract mirror columns
      if (column.type === "mirror" || column.type === "lookup") {
        const mirror: MirrorColumn = {
          id: `${board.id}-${column.id}`,
          board: {
            id: board.id,
            name: board.name,
          },
          columnName: column.title,
          columnId: column.id,
          sourceBoard: null, // Could parse from settings if needed
        };
        allMirrors.push(mirror);
      }
    }
  }

  // Mark bidirectional connections
  let bidirectionalCount = 0;
  for (const pair of connectionPairs.values()) {
    if (pair.forward && pair.reverse) {
      pair.forward.direction = "bidirectional";
      pair.reverse.direction = "bidirectional";
      bidirectionalCount++;
    }
  }

  // Build MapBoard array with connection counts
  const connectionCountByBoard = new Map<string, number>();
  for (const conn of connections) {
    const srcCount = connectionCountByBoard.get(conn.sourceBoard.id) || 0;
    connectionCountByBoard.set(conn.sourceBoard.id, srcCount + 1);
    const tgtCount = connectionCountByBoard.get(conn.targetBoard.id) || 0;
    connectionCountByBoard.set(conn.targetBoard.id, tgtCount + 1);
  }

  // Determine main board
  let mainBoardId: string | null = null;
  if (options.mainBoardKey) {
    const mainBoardEntry = boards.get(options.mainBoardKey);
    if (mainBoardEntry) {
      mainBoardId = mainBoardEntry.id;
    }
  }

  // If no main board specified, pick the one with most connections
  if (!mainBoardId) {
    let maxConnections = 0;
    for (const [boardId, count] of connectionCountByBoard) {
      if (count > maxConnections) {
        maxConnections = count;
        mainBoardId = boardId;
      }
    }
  }

  // Build MapBoard array
  const mapBoards: MapBoard[] = [];
  for (const [configKey, board] of boards) {
    mapBoards.push({
      id: board.id,
      name: board.name,
      configKey,
      isMainBoard: board.id === mainBoardId,
      columnCount: board.columns.length,
      groupCount: board.groups?.length || 0,
    });
  }

  // Group mirrors by board
  const mirrorsByBoardMap = new Map<string, MirrorColumn[]>();
  for (const mirror of allMirrors) {
    const existing = mirrorsByBoardMap.get(mirror.board.id) || [];
    existing.push(mirror);
    mirrorsByBoardMap.set(mirror.board.id, existing);
  }

  const mirrorsByBoard: BoardMirrors[] = [];
  for (const [boardId, mirrors] of mirrorsByBoardMap) {
    const boardInfo = boardLookup.get(boardId);
    if (boardInfo) {
      mirrorsByBoard.push({
        board: {
          id: boardId,
          name: boardInfo.board.name,
        },
        mirrors,
      });
    }
  }

  const mainBoard = mapBoards.find((b) => b.isMainBoard) || null;

  return {
    generatedAt: new Date().toISOString(),
    version: "1.0.0",
    mainBoard,
    boards: mapBoards,
    connections,
    mirrorsByBoard,
    stats: {
      totalBoards: mapBoards.length,
      totalConnections: connections.length,
      totalMirrors: allMirrors.length,
      bidirectionalConnections: bidirectionalCount,
    },
  };
}
