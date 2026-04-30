// =============================================================================
// Tests for Relationship Map Analyzer
// =============================================================================

import { test, expect, describe } from "vitest";
import { analyzeBoards } from "./analyzer";
import type { MondayBoard } from "../monday/types";

// =============================================================================
// Test fixtures
// =============================================================================

function createMockBoard(
  id: string,
  name: string,
  columns: Array<{
    id: string;
    title: string;
    type: string;
    settings_str?: string;
  }>,
  groups: Array<{ id: string; title: string }> = []
): MondayBoard {
  return {
    id,
    name,
    columns: columns.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      settings_str: c.settings_str || "{}",
    })),
    groups,
  };
}

// Simple two-board setup with one-way connection
const twoBoards = new Map<string, MondayBoard>([
  [
    "profiles",
    createMockBoard("board1", "Client Profiles", [
      { id: "email", title: "Email", type: "email" },
      {
        id: "contracts_rel",
        title: "Contracts",
        type: "board_relation",
        settings_str: JSON.stringify({ boardIds: [2] }),
      },
    ]),
  ],
  [
    "contracts",
    createMockBoard("board2", "Contracts", [
      { id: "value", title: "Value", type: "numbers" },
      { id: "status", title: "Status", type: "status" },
    ]),
  ],
]);

// Bidirectional connection between boards
// Note: Using numeric string IDs that match the linkedBoardId values
const bidirectionalBoards = new Map<string, MondayBoard>([
  [
    "profiles",
    createMockBoard("1", "Client Profiles", [
      {
        id: "contracts_rel",
        title: "Contracts",
        type: "board_relation",
        settings_str: JSON.stringify({ boardIds: [2] }),
      },
    ]),
  ],
  [
    "contracts",
    createMockBoard("2", "Contracts", [
      {
        id: "profile_rel",
        title: "Profile",
        type: "board_relation",
        settings_str: JSON.stringify({ linkedBoardId: 1 }),
      },
    ]),
  ],
]);

// Board with mirror columns
const boardsWithMirrors = new Map<string, MondayBoard>([
  [
    "profiles",
    createMockBoard("board1", "Client Profiles", [
      {
        id: "contracts_rel",
        title: "Contracts",
        type: "board_relation",
        settings_str: JSON.stringify({ boardIds: [2] }),
      },
      { id: "contract_value_mirror", title: "Contract Value", type: "mirror" },
      { id: "contract_status_lookup", title: "Contract Status", type: "lookup" },
    ]),
  ],
  [
    "contracts",
    createMockBoard("board2", "Contracts", [
      { id: "value", title: "Value", type: "numbers" },
    ]),
  ],
]);

// Complex multi-board setup
const complexBoards = new Map<string, MondayBoard>([
  [
    "profiles",
    createMockBoard(
      "board1",
      "Client Profiles",
      [
        {
          id: "contracts_rel",
          title: "Contracts",
          type: "board_relation",
          settings_str: JSON.stringify({ boardIds: [2] }),
        },
        {
          id: "rfes_rel",
          title: "RFEs",
          type: "board_relation",
          settings_str: JSON.stringify({ boardIds: [3] }),
        },
      ],
      [{ id: "group1", title: "Active" }]
    ),
  ],
  [
    "contracts",
    createMockBoard("board2", "Contracts", [
      {
        id: "profile_rel",
        title: "Profile",
        type: "board_relation",
        settings_str: JSON.stringify({ linkedBoardId: 1 }),
      },
    ]),
  ],
  [
    "rfes",
    createMockBoard("board3", "RFEs", [
      {
        id: "profile_rel",
        title: "Profile",
        type: "board_relation",
        settings_str: JSON.stringify({ linkedBoardId: 1 }),
      },
    ]),
  ],
  [
    "court_cases",
    createMockBoard("board4", "Court Cases", [
      { id: "status", title: "Status", type: "status" },
    ]),
  ],
]);

// =============================================================================
// analyzeBoards tests
// =============================================================================

describe("analyzeBoards", () => {
  describe("basic functionality", () => {
    test("returns correct structure with metadata", () => {
      const result = analyzeBoards(twoBoards);

      expect(result.version).toBe("1.0.0");
      expect(result.generatedAt).toBeDefined();
      expect(result.boards).toBeDefined();
      expect(result.connections).toBeDefined();
      expect(result.stats).toBeDefined();
    });

    test("counts total boards correctly", () => {
      const result = analyzeBoards(twoBoards);

      expect(result.stats.totalBoards).toBe(2);
      expect(result.boards).toHaveLength(2);
    });

    test("extracts board info with config keys", () => {
      const result = analyzeBoards(twoBoards);

      const profilesBoard = result.boards.find((b) => b.configKey === "profiles");
      expect(profilesBoard).toBeDefined();
      expect(profilesBoard!.id).toBe("board1");
      expect(profilesBoard!.name).toBe("Client Profiles");
      expect(profilesBoard!.columnCount).toBe(2);
    });
  });

  describe("connection extraction", () => {
    test("extracts board_relation connections", () => {
      const result = analyzeBoards(twoBoards);

      expect(result.connections).toHaveLength(1);
      expect(result.stats.totalConnections).toBe(1);
    });

    test("connection has correct source and target", () => {
      const result = analyzeBoards(twoBoards);
      const connection = result.connections[0]!;

      expect(connection.sourceBoard.id).toBe("board1");
      expect(connection.sourceBoard.name).toBe("Client Profiles");
      expect(connection.targetBoard.id).toBe("2");
      expect(connection.columnName).toBe("Contracts");
    });

    test("handles linkedBoardId format (older format)", () => {
      const boardsWithOldFormat = new Map<string, MondayBoard>([
        [
          "test",
          createMockBoard("board1", "Test", [
            {
              id: "rel",
              title: "Relation",
              type: "board_relation",
              settings_str: JSON.stringify({ linkedBoardId: 999 }),
            },
          ]),
        ],
      ]);

      const result = analyzeBoards(boardsWithOldFormat);

      expect(result.connections).toHaveLength(1);
      expect(result.connections[0]!.targetBoard.id).toBe("999");
    });

    test("handles multiple boardIds in single column", () => {
      const boardWithMultipleLinks = new Map<string, MondayBoard>([
        [
          "hub",
          createMockBoard("board1", "Hub", [
            {
              id: "multi_rel",
              title: "Multi Relation",
              type: "board_relation",
              settings_str: JSON.stringify({ boardIds: [2, 3, 4] }),
            },
          ]),
        ],
      ]);

      const result = analyzeBoards(boardWithMultipleLinks);

      expect(result.connections).toHaveLength(3);
    });

    test("handles invalid settings_str gracefully", () => {
      const boardWithBadSettings = new Map<string, MondayBoard>([
        [
          "test",
          createMockBoard("board1", "Test", [
            {
              id: "rel",
              title: "Relation",
              type: "board_relation",
              settings_str: "invalid json",
            },
          ]),
        ],
      ]);

      const result = analyzeBoards(boardWithBadSettings);

      expect(result.connections).toHaveLength(0);
    });
  });

  describe("bidirectional detection", () => {
    test("detects bidirectional connections", () => {
      const result = analyzeBoards(bidirectionalBoards);

      expect(result.stats.bidirectionalConnections).toBe(1);
    });

    test("marks both connections as bidirectional", () => {
      const result = analyzeBoards(bidirectionalBoards);

      const bidirectionalConnections = result.connections.filter(
        (c) => c.direction === "bidirectional"
      );
      expect(bidirectionalConnections).toHaveLength(2);
    });

    test("one-way connections are marked as outgoing", () => {
      const result = analyzeBoards(twoBoards);

      expect(result.connections[0]!.direction).toBe("outgoing");
      expect(result.stats.bidirectionalConnections).toBe(0);
    });
  });

  describe("mirror column extraction", () => {
    test("extracts mirror columns", () => {
      const result = analyzeBoards(boardsWithMirrors);

      expect(result.stats.totalMirrors).toBe(2);
    });

    test("groups mirrors by board", () => {
      const result = analyzeBoards(boardsWithMirrors);

      expect(result.mirrorsByBoard).toHaveLength(1);
      expect(result.mirrorsByBoard[0]!.board.id).toBe("board1");
      expect(result.mirrorsByBoard[0]!.mirrors).toHaveLength(2);
    });

    test("includes both mirror and lookup types", () => {
      const result = analyzeBoards(boardsWithMirrors);

      const mirrorNames = result.mirrorsByBoard[0]!.mirrors.map((m) => m.columnName);
      expect(mirrorNames).toContain("Contract Value");
      expect(mirrorNames).toContain("Contract Status");
    });

    test("mirror has correct board info", () => {
      const result = analyzeBoards(boardsWithMirrors);

      const mirror = result.mirrorsByBoard[0]!.mirrors[0]!;
      expect(mirror.board.id).toBe("board1");
      expect(mirror.board.name).toBe("Client Profiles");
      expect(mirror.columnId).toBeDefined();
    });
  });

  describe("main board detection", () => {
    test("selects board with most connections as main board", () => {
      const result = analyzeBoards(complexBoards);

      // board1 (profiles) has 4 connections (2 outgoing + 2 incoming)
      expect(result.mainBoard).toBeDefined();
      expect(result.mainBoard!.id).toBe("board1");
      expect(result.mainBoard!.isMainBoard).toBe(true);
    });

    test("respects mainBoardKey option", () => {
      const result = analyzeBoards(complexBoards, { mainBoardKey: "contracts" });

      expect(result.mainBoard!.configKey).toBe("contracts");
      expect(result.mainBoard!.id).toBe("board2");
    });

    test("marks only one board as main board", () => {
      const result = analyzeBoards(complexBoards);

      const mainBoards = result.boards.filter((b) => b.isMainBoard);
      expect(mainBoards).toHaveLength(1);
    });

    test("handles empty boards map", () => {
      const result = analyzeBoards(new Map());

      expect(result.mainBoard).toBeNull();
      expect(result.boards).toHaveLength(0);
      expect(result.stats.totalBoards).toBe(0);
    });
  });

  describe("complex scenarios", () => {
    test("handles boards with no connections", () => {
      const result = analyzeBoards(complexBoards);

      // court_cases has no relations
      const courtCases = result.boards.find((b) => b.configKey === "court_cases");
      expect(courtCases).toBeDefined();
    });

    test("counts groups correctly", () => {
      const result = analyzeBoards(complexBoards);

      const profiles = result.boards.find((b) => b.configKey === "profiles");
      expect(profiles!.groupCount).toBe(1);
    });

    test("generates unique connection IDs", () => {
      const result = analyzeBoards(complexBoards);

      const connectionIds = result.connections.map((c) => c.id);
      const uniqueIds = new Set(connectionIds);
      expect(uniqueIds.size).toBe(connectionIds.length);
    });

    test("handles external board references", () => {
      // When a connection points to a board not in our map
      const boardWithExternalRef = new Map<string, MondayBoard>([
        [
          "test",
          createMockBoard("board1", "Test", [
            {
              id: "ext_rel",
              title: "External",
              type: "board_relation",
              settings_str: JSON.stringify({ boardIds: [99999] }),
            },
          ]),
        ],
      ]);

      const result = analyzeBoards(boardWithExternalRef);

      expect(result.connections).toHaveLength(1);
      expect(result.connections[0]!.targetBoard.name).toBe("Board 99999");
    });
  });
});
