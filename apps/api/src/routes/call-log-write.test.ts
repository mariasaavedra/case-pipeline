// =============================================================================
// Call Log write logic tests
// =============================================================================
// These cover the decisions behind POST /api/call-log — the part that, when
// wrong, writes bad data into real client records. No Express, no database,
// no network: every function under test is pure.
// =============================================================================

import { describe, it, expect } from "vitest";
import type { BoardColumns, BoardColumn, BoardStatusOptions } from "@case-pipeline/query";
import {
  parseCallLogBody,
  validateCallLogBody,
  validateCallLogLanguage,
  resolveCallLogStatus,
  columnByTitle,
  buildCallLogColumnValues,
  buildMirroredColumnValues,
} from "./call-log-write";

// --- Fixtures ---------------------------------------------------------------

const opt = (index: number, label: string) => ({ index, label, color: null, border: null });

const col = (columnId: string, title: string, type = "text", options: BoardColumn["options"] = []): BoardColumn =>
  ({ columnId, title, type, options, position: 0 });

/** A Call Log board schema shaped like the real one. */
const schema: BoardColumns = {
  boardKey: "call_log",
  mondayBoardId: "board-1",
  columns: [
    col("phone_1", "Phone", "phone"),
    col("status_1", "Status", "status", [opt(0, "Pending"), opt(1, "Done")]),
    col("date_1", "Date", "date"),
    col("lang_1", "Language", "dropdown", [opt(0, "English"), opt(1, "Spanish")]),
    col("person_1", "Taken by", "people"),
    col("person_2", "Highlighted For", "people"),
    col("link_1", "link to Profiles", "board_relation"),
  ],
};

const statusDef: BoardStatusOptions = {
  boardKey: "call_log",
  mondayBoardId: "board-1",
  statusColumnId: "status_1",
  options: [opt(0, "Pending"), opt(1, "Done")],
};

const parse = parseCallLogBody;

// --- parseCallLogBody -------------------------------------------------------

describe("parseCallLogBody", () => {
  it("trims every string field", () => {
    const p = parse({ name: "  Ana  ", note: " called ", phone: " 555 ", language: " Spanish ", status: " Done " });
    expect(p).toMatchObject({ name: "Ana", note: "called", phone: "555", language: "Spanish", requestedStatus: "Done" });
  });

  it("treats a missing or non-object body as empty rather than throwing", () => {
    for (const raw of [undefined, null, {}]) {
      expect(parse(raw)).toMatchObject({ name: "", note: "", profileLocalId: null, noteMentions: [] });
    }
  });

  it("accepts person ids as either a number or a form string", () => {
    expect(parse({ takenByUserId: 42, highlightedForUserId: "77" })).toMatchObject({
      takenByUserId: 42,
      highlightedForUserId: 77,
    });
  });

  // A NaN would be serialized into the Monday mutation and fail the whole
  // create_item — dropping the bad id still logs the call.
  it("drops a non-numeric person id instead of passing NaN on to Monday", () => {
    const p = parse({ takenByUserId: "not-a-number", highlightedForUserId: "" });
    expect(p.takenByUserId).toBeNull();
    expect(p.highlightedForUserId).toBeNull();
  });

  it("normalizes mentioned user ids to Monday's UpdateMention shape", () => {
    expect(parse({ mentionedUserIds: [12, "34"] }).noteMentions).toEqual([
      { id: "12", type: "User" },
      { id: "34", type: "User" },
    ]);
  });

  it("discards null and empty entries in the mention list", () => {
    expect(parse({ mentionedUserIds: [null, "", 5, undefined] }).noteMentions).toEqual([{ id: "5", type: "User" }]);
  });

  it("ignores mentionedUserIds when it is not an array", () => {
    expect(parse({ mentionedUserIds: "12" }).noteMentions).toEqual([]);
  });
});

// --- validateCallLogBody ----------------------------------------------------

describe("validateCallLogBody", () => {
  it("requires a name", () => {
    expect(validateCallLogBody(parse({}))).toEqual({ status: 400, error: "name is required" });
  });

  it("rejects a whitespace-only name", () => {
    expect(validateCallLogBody(parse({ name: "   " }))?.status).toBe(400);
  });

  it("accepts a real name", () => {
    expect(validateCallLogBody(parse({ name: "Ana" }))).toBeNull();
  });
});

// --- resolveCallLogStatus ---------------------------------------------------

describe("resolveCallLogStatus", () => {
  it("keeps a status the board actually offers", () => {
    expect(resolveCallLogStatus("Done", statusDef)).toEqual({ status: "Done" });
  });

  // create_labels_if_missing is false, so an unknown label would fail the
  // mutation permanently — refuse up front and say what is allowed.
  it("rejects a label the board does not have, listing the legal ones", () => {
    expect(resolveCallLogStatus("Escalated", statusDef)).toEqual({
      rejection: { status: 400, error: "status is not a valid option", allowed: ["Pending", "Done"] },
    });
  });

  it("defaults to Pending when the caller did not choose", () => {
    expect(resolveCallLogStatus("", statusDef)).toEqual({ status: "Pending" });
  });

  it("matches the Pending default case-insensitively", () => {
    const lower: BoardStatusOptions = { ...statusDef, options: [opt(0, "Done"), opt(1, "pending")] };
    expect(resolveCallLogStatus("", lower)).toEqual({ status: "pending" });
  });

  it("falls back to the board's first option when there is no Pending", () => {
    const noPending: BoardStatusOptions = { ...statusDef, options: [opt(0, "New"), opt(1, "Done")] };
    expect(resolveCallLogStatus("", noPending)).toEqual({ status: "New" });
  });

  it("yields a null status when the board has no status options at all", () => {
    expect(resolveCallLogStatus("", null)).toEqual({ status: null });
  });

  // Without a synced definition there is nothing to validate against, so the
  // caller's value passes through rather than blocking the write.
  it("passes a requested status through unvalidated when no definition is synced", () => {
    expect(resolveCallLogStatus("Anything", null)).toEqual({ status: "Anything" });
  });
});

// --- validateCallLogLanguage ------------------------------------------------

describe("validateCallLogLanguage", () => {
  const languageCol = columnByTitle(schema, "Language");

  it("accepts a language the board offers", () => {
    expect(validateCallLogLanguage("Spanish", languageCol)).toBeNull();
  });

  it("rejects one it does not, listing the legal ones", () => {
    expect(validateCallLogLanguage("Klingon", languageCol)).toEqual({
      status: 400,
      error: "language is not a valid option",
      allowed: ["English", "Spanish"],
    });
  });

  it("accepts an empty language", () => {
    expect(validateCallLogLanguage("", languageCol)).toBeNull();
  });

  it("accepts anything when the board has no Language column", () => {
    expect(validateCallLogLanguage("Spanish", undefined)).toBeNull();
  });

  // Blocking here would stop the front desk logging calls whenever the schema
  // is only partially synced — worse than sending a label Monday may reject.
  it("accepts anything when the Language column synced without options", () => {
    expect(validateCallLogLanguage("Spanish", col("lang_1", "Language", "dropdown", []))).toBeNull();
  });
});

// --- columnByTitle ----------------------------------------------------------

describe("columnByTitle", () => {
  it("matches ignoring case and surrounding whitespace", () => {
    expect(columnByTitle(schema, "  taken BY  ")?.columnId).toBe("person_1");
  });

  it("returns undefined for a column the board does not have", () => {
    expect(columnByTitle(schema, "Nonexistent")).toBeUndefined();
  });
});

// --- buildCallLogColumnValues -----------------------------------------------

describe("buildCallLogColumnValues", () => {
  const base = { schema, status: "Pending", today: "2026-08-28", profileMondayItemId: null };

  it("keys every value by the board's real Monday column id", () => {
    const cv = buildCallLogColumnValues({
      ...base,
      parsed: parse({ name: "Ana", phone: "555", language: "Spanish", takenByUserId: 42 }),
    });
    expect(cv).toEqual({
      phone_1: "555",
      status_1: { label: "Pending" },
      date_1: "2026-08-28",
      lang_1: { label: "Spanish" },
      person_1: { personsAndTeams: [{ id: 42, kind: "person" }] },
    });
  });

  it("always stamps the date", () => {
    expect(buildCallLogColumnValues({ ...base, parsed: parse({ name: "Ana" }) })).toHaveProperty("date_1", "2026-08-28");
  });

  it("omits optional fields the caller left blank", () => {
    const cv = buildCallLogColumnValues({ ...base, parsed: parse({ name: "Ana" }) });
    expect(cv).not.toHaveProperty("phone_1");
    expect(cv).not.toHaveProperty("lang_1");
    expect(cv).not.toHaveProperty("person_1");
  });

  // Monday's board_relation column wants numbers, not the string the DB holds.
  it("links the profile as a numeric item id", () => {
    const cv = buildCallLogColumnValues({
      ...base,
      parsed: parse({ name: "Ana" }),
      profileMondayItemId: "998877",
    });
    expect(cv.link_1).toEqual({ item_ids: [998877] });
  });

  // Sending a column id the board does not have fails the entire mutation, so
  // an unsynced column must be skipped rather than guessed at.
  it("skips columns the synced schema does not contain", () => {
    const sparse: BoardColumns = { ...schema, columns: [col("status_1", "Status", "status", statusDef.options)] };
    const cv = buildCallLogColumnValues({
      ...base,
      schema: sparse,
      parsed: parse({ name: "Ana", phone: "555", takenByUserId: 42 }),
    });
    expect(cv).toEqual({ status_1: { label: "Pending" } });
  });

  it("omits the status when the board resolved none", () => {
    const cv = buildCallLogColumnValues({ ...base, status: null, parsed: parse({ name: "Ana" }) });
    expect(cv).not.toHaveProperty("status_1");
  });
});

// --- buildMirroredColumnValues ----------------------------------------------

describe("buildMirroredColumnValues", () => {
  const base = {
    status: "Pending",
    today: "2026-08-28",
    nowTime: "2:05 PM",
    lastUpdated: "2026-08-28 19:05:00 UTC",
    takenByName: null,
    highlightedForName: null,
  };

  // Keys here are the logical config keys from boards.yaml, NOT Monday column
  // ids — they must match scripts/sync/mapper.ts so the next sync reads this
  // row back unchanged.
  it("keys by logical config name, not Monday column id", () => {
    const mv = buildMirroredColumnValues({
      ...base,
      parsed: parse({ name: "Ana", phone: "555", language: "Spanish" }),
      takenByName: "Maria",
      highlightedForName: "Luis",
    });
    expect(mv).toEqual({
      phone: "555",
      status: { label: "Pending" },
      date: { date: "2026-08-28" },
      hour: "2:05 PM",
      language: { label: "Spanish" },
      taken_by: { label: "Maria" },
      highlighted_for: { label: "Luis" },
      last_updated: "2026-08-28 19:05:00 UTC",
    });
  });

  it("always carries date, hour and last_updated", () => {
    const mv = buildMirroredColumnValues({ ...base, parsed: parse({ name: "Ana" }) });
    expect(mv).toMatchObject({ date: { date: "2026-08-28" }, hour: "2:05 PM", last_updated: base.lastUpdated });
  });

  // A staff-name lookup is best-effort: if Monday is unreachable the call still
  // gets logged, just without a readable name until the next sync.
  it("omits the person labels when the name lookup came back empty", () => {
    const mv = buildMirroredColumnValues({ ...base, parsed: parse({ name: "Ana", phone: "555" }) });
    expect(mv).not.toHaveProperty("taken_by");
    expect(mv).not.toHaveProperty("highlighted_for");
  });

  it("omits blank optional fields entirely rather than writing empty strings", () => {
    const mv = buildMirroredColumnValues({ ...base, status: null, parsed: parse({ name: "Ana" }) });
    expect(mv).not.toHaveProperty("phone");
    expect(mv).not.toHaveProperty("language");
    expect(mv).not.toHaveProperty("status");
  });
});
