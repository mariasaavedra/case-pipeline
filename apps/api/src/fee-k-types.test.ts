import { describe, expect, it } from "vitest";
import { feeKTypeLookup, sanitizeFeeKTypes } from "./fee-k-types.js";
import { DRAFT_FEE_K_TYPES } from "./fee-k-types-draft.js";

describe("sanitizeFeeKTypes", () => {
  it("keeps the Fee K Type's exact spelling, tidies the rest, drops rows with nothing set", () => {
    expect(sanitizeFeeKTypes([
      { feeKType: " Bond MTN  (c) ", spanish: "  Moción   de fianza ", board: "Motions", feeSheetJob: "" },
      { feeKType: "Master (c)", spanish: "", board: "", feeSheetJob: "" },
      { spanish: "sin tipo" },
      "junk",
    ])).toEqual([{ feeKType: "Bond MTN  (c)", spanish: "Moción de fianza", board: "Motions", feeSheetJob: "" }]);
  });

  it("one row per Fee K Type, any case — the first wins", () => {
    const rows = sanitizeFeeKTypes([
      { feeKType: "I-130 - Petition for Alien Relative", board: "Open Forms" },
      { feeKType: "i-130 - petition for alien relative", board: "Court Cases" },
    ]);
    expect(rows.map((r) => r.board)).toEqual(["Open Forms"]);
  });

  it("anything but a list is an empty table", () => {
    expect(sanitizeFeeKTypes({ rows: [] })).toEqual([]);
    expect(sanitizeFeeKTypes(null)).toEqual([]);
  });
});

describe("feeKTypeLookup", () => {
  it("finds a row by Fee K Type, any case and inner spacing", () => {
    const find = feeKTypeLookup([{ feeKType: "Bond MTN  (c)", spanish: "", board: "Motions", feeSheetJob: "" }]);
    expect(find("bond mtn (c)")?.board).toBe("Motions");
    expect(find("Master (c)")).toBeUndefined();
  });
});

describe("the starting draft", () => {
  // Monday's "It will go to…" labels on 2026-10-20.
  const BOARDS = ["Open Forms", "Court Cases", "Waivers", "RFEs", "I-918Bs", "Motions", "FOIA requests", "Appeals",
    "Open Forms-Court Forms", "Interviews", "Litigations", "Already in board"];

  it("survives the sanitizer unchanged: one row per type, every one with a Spanish name", () => {
    expect(sanitizeFeeKTypes(DRAFT_FEE_K_TYPES)).toEqual(DRAFT_FEE_K_TYPES);
    expect(DRAFT_FEE_K_TYPES.every((r) => r.spanish)).toBe(true);
  });

  it("only names real boards", () => {
    expect(DRAFT_FEE_K_TYPES.filter((r) => r.board && !BOARDS.includes(r.board))).toEqual([]);
  });
});
