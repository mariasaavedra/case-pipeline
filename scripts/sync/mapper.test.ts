// =============================================================================
// Column mapper tests (offline — no Monday API token required)
// =============================================================================
// Verifies that Monday column values are reshaped into the exact JSON the query
// layer reads. Uses synthetic MondayItem-shaped objects.

import { describe, it, expect } from "vitest";
import {
  shapeColumnValue,
  buildColumnValues,
  extractBoardItemFields,
  firstLinkedId,
  type ResolvedColumnMeta,
} from "./mapper";

// Minimal column-value factory (structurally a MondayColumnValue)
function cv(id: string, text: string | null, extra: Record<string, unknown> = {}) {
  return { id, text, ...extra };
}

describe("shapeColumnValue", () => {
  it("shapes status/color as { label }", () => {
    expect(shapeColumnValue("status", cv("c", "Filed"))).toEqual({ label: "Filed" });
    expect(shapeColumnValue("color", cv("c", "Granted"))).toEqual({ label: "Granted" });
  });

  it("shapes people as { label }", () => {
    expect(shapeColumnValue("people", cv("c", "Laura Torres, Mayra Ruiz"))).toEqual({
      label: "Laura Torres, Mayra Ruiz",
    });
  });

  it("shapes dropdown/tags as { labels: [...] }", () => {
    expect(shapeColumnValue("dropdown", cv("c", "Mandamus"))).toEqual({ labels: ["Mandamus"] });
    expect(shapeColumnValue("tags", cv("c", "A2, B1 , C"))).toEqual({ labels: ["A2", "B1", "C"] });
  });

  it("shapes dates as { date } and datetimes as { date, time }", () => {
    expect(shapeColumnValue("date", cv("c", "2026-07-01"))).toEqual({ date: "2026-07-01" });
    expect(shapeColumnValue("datetime", cv("c", "2026-07-01 09:30:00"))).toEqual({
      date: "2026-07-01",
      time: "09:30:00",
    });
  });

  it("shapes board_relation keeping linked ids", () => {
    const shaped = shapeColumnValue(
      "board_relation",
      cv("c", "Maria Garcia", { linked_item_ids: ["999"], display_value: "Maria Garcia" }),
    );
    expect(shaped).toEqual({ linked_item_ids: ["999"], display_value: "Maria Garcia" });
  });

  it("uses display_value for mirror/lookup", () => {
    expect(shapeColumnValue("mirror", cv("c", null, { display_value: "U-visa" }))).toBe("U-visa");
    expect(shapeColumnValue("lookup", cv("c", "A123"))).toBe("A123");
  });

  it("returns raw text for text-like columns", () => {
    expect(shapeColumnValue("text", cv("c", "hello"))).toBe("hello");
    expect(shapeColumnValue("long_text", cv("c", "a sentence"))).toBe("a sentence");
    expect(shapeColumnValue("numbers", cv("c", "5000"))).toBe("5000");
  });

  it("returns null for empty values", () => {
    expect(shapeColumnValue("status", cv("c", null))).toBeNull();
    expect(shapeColumnValue("dropdown", cv("c", ""))).toBeNull();
    expect(shapeColumnValue("board_relation", cv("c", null))).toBeNull();
  });
});

describe("buildColumnValues", () => {
  const resolved: Record<string, ResolvedColumnMeta | undefined> = {
    status: { id: "status", type: "status" },
    target_date: { id: "date_mkm", type: "date" },
    paralegals: { id: "people__1", type: "people" },
    type: { id: "tags_x", type: "tags" },
    missing_col: undefined, // unresolved → skipped
  };

  const item = {
    id: "1",
    name: "Maria Garcia - Asylum",
    group: { id: "g", title: "Open Forms" },
    column_values: [
      cv("status", "Filed"),
      cv("date_mkm", "2026-07-01"),
      cv("people__1", "Laura Torres"),
      cv("tags_x", ""), // empty → omitted
    ],
  };

  it("keys shaped values by logical config key and omits empties/unresolved", () => {
    expect(buildColumnValues(item as never, resolved)).toEqual({
      status: { label: "Filed" },
      target_date: { date: "2026-07-01" },
      paralegals: { label: "Laura Torres" },
    });
  });
});

describe("extractBoardItemFields", () => {
  it("pulls status, next_date (per board), attorney, paralegals", () => {
    const columnValues = {
      status: { label: "Open" },
      target_date: { date: "2026-07-04" },
      attorney: { label: "WH" },
      paralegals: { label: "Mayra Ruiz" },
    };
    expect(extractBoardItemFields("_cd_open_forms", columnValues)).toEqual({
      status: "Open",
      nextDate: "2026-07-04",
      nextTime: null,
      attorney: "WH",
      paralegals: "Mayra Ruiz",
    });
  });

  it("uses the board-specific next_date key (court_cases → x_next_hearing_date)", () => {
    const columnValues = { x_next_hearing_date: { date: "2026-09-01" } };
    expect(extractBoardItemFields("court_cases", columnValues).nextDate).toBe("2026-09-01");
  });

  it("returns nulls when fields are absent", () => {
    expect(extractBoardItemFields("foias", {})).toEqual({
      status: null,
      nextDate: null,
      nextTime: null,
      attorney: null,
      paralegals: null,
    });
  });
});

describe("firstLinkedId", () => {
  it("returns the first linked id", () => {
    expect(firstLinkedId({ linked_item_ids: ["77", "88"] })).toBe("77");
  });
  it("returns null when no relation", () => {
    expect(firstLinkedId(null)).toBeNull();
    expect(firstLinkedId({ label: "x" })).toBeNull();
    expect(firstLinkedId({ linked_item_ids: [] })).toBeNull();
  });
});
