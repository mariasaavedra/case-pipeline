// =============================================================================
// Note write-back parsing tests
// =============================================================================
// Shared by all three routes that post a note to Monday. Mentions decide who
// gets notified, so the rules live in one tested place rather than three
// hand-copied expressions.
// =============================================================================

import { describe, it, expect } from "vitest";
import { parseMentions, parseNoteBody } from "./note-write";

describe("parseMentions", () => {
  it("normalizes ids to Monday's UpdateMention shape", () => {
    expect(parseMentions([12, "34"])).toEqual([
      { id: "12", type: "User" },
      { id: "34", type: "User" },
    ]);
  });

  it("drops null, undefined and empty-string entries", () => {
    expect(parseMentions([null, undefined, "", 7])).toEqual([{ id: "7", type: "User" }]);
  });

  it("yields an empty list for anything that is not an array", () => {
    for (const raw of [undefined, null, "12", 12, {}]) {
      expect(parseMentions(raw)).toEqual([]);
    }
  });

  it("yields an empty list for an empty array", () => {
    expect(parseMentions([])).toEqual([]);
  });

  // Losing a notification is recoverable; losing the note is not. A malformed
  // mention list must never be able to fail the write.
  it("never throws on a malformed list", () => {
    expect(() => parseMentions([{ nested: true }, [], NaN])).not.toThrow();
  });

  it("keeps zero, which is a legal id and not an empty value", () => {
    expect(parseMentions([0])).toEqual([{ id: "0", type: "User" }]);
  });
});

describe("parseNoteBody", () => {
  it("reads the text field the route names", () => {
    expect(parseNoteBody({ text: " hello " }, "text").text).toBe("hello");
    expect(parseNoteBody({ note: " hello " }, "note").text).toBe("hello");
  });

  it("does not read the other route's field name", () => {
    expect(parseNoteBody({ note: "hello" }, "text").text).toBe("");
  });

  it("returns empty text for a missing or non-object body", () => {
    for (const raw of [undefined, null, {}]) {
      expect(parseNoteBody(raw, "text")).toEqual({ text: "", mentions: [] });
    }
  });

  it("parses text and mentions together", () => {
    expect(parseNoteBody({ note: "call back", mentionedUserIds: ["9"] }, "note")).toEqual({
      text: "call back",
      mentions: [{ id: "9", type: "User" }],
    });
  });

  it("treats a whitespace-only note as empty so the route can refuse it", () => {
    expect(parseNoteBody({ text: "   \n  " }, "text").text).toBe("");
  });
});
