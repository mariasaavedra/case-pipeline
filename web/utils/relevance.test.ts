import { test, expect, describe } from "bun:test";
import { filterRelevantUpdates, getMostRelevantUpdate } from "./relevance";
import type { ClientUpdate } from "../api";

function makeUpdate(overrides: Partial<ClientUpdate> = {}): ClientUpdate {
  return {
    localId: "u1",
    profileLocalId: "p1",
    boardItemLocalId: null,
    boardKey: null,
    authorName: "Test Author",
    authorEmail: null,
    textBody: "This is a meaningful update about the case progress.",
    bodyHtml: null,
    sourceType: "update",
    replyToUpdateId: null,
    createdAtSource: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

describe("filterRelevantUpdates", () => {
  test("filters out empty bodies", () => {
    const updates = [
      makeUpdate({ textBody: "" }),
      makeUpdate({ textBody: "Good content here" }),
    ];
    const result = filterRelevantUpdates(updates);
    expect(result).toHaveLength(1);
    expect(result[0]!.textBody).toBe("Good content here");
  });

  test("filters out very short bodies", () => {
    const updates = [
      makeUpdate({ textBody: "ok" }),
      makeUpdate({ textBody: "This is substantial" }),
    ];
    const result = filterRelevantUpdates(updates);
    expect(result).toHaveLength(1);
  });

  test("filters out status change patterns", () => {
    const updates = [
      makeUpdate({ textBody: "Status changed to Active" }),
      makeUpdate({ textBody: "Status changed from Pending to Active" }),
      makeUpdate({ textBody: "Real update about the case" }),
    ];
    const result = filterRelevantUpdates(updates);
    expect(result).toHaveLength(1);
    expect(result[0]!.textBody).toBe("Real update about the case");
  });
});

describe("getMostRelevantUpdate", () => {
  test("returns null for empty array", () => {
    expect(getMostRelevantUpdate([])).toBeNull();
  });

  test("prefers non-reply with boardKey", () => {
    const updates = [
      makeUpdate({ sourceType: "reply", textBody: "A reply to something" }),
      makeUpdate({ sourceType: "update", boardKey: "court_cases", textBody: "Filed motion in court" }),
      makeUpdate({ sourceType: "update", textBody: "General update note here" }),
    ];
    const result = getMostRelevantUpdate(updates);
    expect(result!.boardKey).toBe("court_cases");
  });

  test("prefers non-reply over reply when no boardKey", () => {
    const updates = [
      makeUpdate({ sourceType: "reply", textBody: "A reply with some content" }),
      makeUpdate({ sourceType: "update", textBody: "An update without board" }),
    ];
    const result = getMostRelevantUpdate(updates);
    expect(result!.sourceType).toBe("update");
  });

  test("falls back to first raw update when all are irrelevant", () => {
    const updates = [
      makeUpdate({ textBody: "ok", localId: "first" }),
      makeUpdate({ textBody: "", localId: "second" }),
    ];
    const result = getMostRelevantUpdate(updates);
    expect(result!.localId).toBe("first");
  });
});
