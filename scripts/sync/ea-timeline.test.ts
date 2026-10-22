import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import type { MondayTimelineItem } from "@case-pipeline/monday";
import { initializeSchema } from "../../libs/seed/src/db/schema.js";
import { timelineWriter, contentSig, type ItemMeta } from "./ea-timeline.js";

// Monday's page gives the first ~250 characters as plain text; timeline_item(id:)
// gives the whole entry as HTML.
const LONG = "Charged with trespassing, not an issue. Waiting on OPT or CPT. ".repeat(8).trim();
const PREVIEW = LONG.slice(0, 250);
const FULL = `<div>${LONG}</div><div>lots of questions for pub defender</div>`;

const entry = (id: string, content = PREVIEW): MondayTimelineItem => ({
  id, type: "custom", title: null, content, created_at: "2026-02-16T21:00:00.000Z",
  custom_activity_id: "a1", user: { id: "1", name: "Michael Sharma-Crawford" },
} as MondayTimelineItem);

// The same event on the profile and on a connected court case.
const itemMeta = new Map<string, ItemMeta>([
  ["100", { profile_local_id: "p1", board_item_local_id: null, board_key: null }],
  ["200", { profile_local_id: "p1", board_item_local_id: "b1", board_key: "court_cases" }],
]);
const bothSurfaces = () => new Map([["100", [entry("t-profile")]], ["200", [entry("t-case")]]]);

function setup() {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (id, batch_name) VALUES (1, 'test')").run();
  return db;
}

function writer(db: Database.Database, fetchContents: (ids: string[]) => Promise<Map<string, string>>, budget = 100) {
  return timelineWriter(db, { batchId: 1, itemMeta, activityNames: new Map([["a1", "Consult note"]]), budget, fetchContents });
}

const rows = (db: Database.Database) =>
  db.prepare("SELECT text_body, body_html, content_sig, activity_type_name FROM client_updates").all() as
    Array<{ text_body: string; body_html: string; content_sig: string; activity_type_name: string }>;

describe("E&A timeline writer — full text", () => {
  it("stores a cut entry in full, once, fetched once for both surfaces", async () => {
    const db = setup();
    const fetchContents = vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, FULL])));
    const w = writer(db, fetchContents);
    const timelines = bothSurfaces();
    w.insert(timelines, await w.fullTextFor(timelines));

    expect(fetchContents).toHaveBeenCalledTimes(1);
    expect(fetchContents.mock.calls[0]![0]).toHaveLength(1);
    const [row, ...rest] = rows(db);
    expect(rest).toEqual([]);
    expect(row!.body_html).toBe(FULL);
    expect(row!.text_body).toContain("lots of questions for pub defender");
    expect(row!.activity_type_name).toBe("Consult note");
    // The dedup key stays the preview's, as on every row stored before.
    expect(row!.content_sig).toBe(contentSig("2026-02-16T21:00:00.000Z", "Michael Sharma-Crawford", PREVIEW));
    expect(w.totals).toEqual({ inserted: 1, fullText: 1 });
  });

  it("upgrades a row stored earlier from the preview, without a duplicate", async () => {
    const db = setup();
    writer(db, async () => new Map()).insert(bothSurfaces()); // the old sync
    expect(rows(db)[0]!.body_html).toBe(PREVIEW);

    const w = writer(db, async (ids) => new Map(ids.map((id) => [id, FULL])));
    const timelines = bothSurfaces();
    w.insert(timelines, await w.fullTextFor(timelines));
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]!.body_html).toBe(FULL);
    expect(w.totals).toEqual({ inserted: 0, fullText: 1 });
  });

  it("does not fetch an entry already stored in full, nor a short one", async () => {
    const db = setup();
    const first = writer(db, async (ids) => new Map(ids.map((id) => [id, FULL])));
    first.insert(bothSurfaces(), await first.fullTextFor(bothSurfaces()));

    const fetchContents = vi.fn(async () => new Map<string, string>());
    const w = writer(db, fetchContents);
    const timelines = new Map([...bothSurfaces(), ["300", [entry("t-short", "Short note")]]]);
    itemMeta.set("300", { profile_local_id: "p2", board_item_local_id: null, board_key: null });
    expect(await w.fullTextFor(timelines)).toEqual(new Map());
    expect(fetchContents).not.toHaveBeenCalled();
    itemMeta.delete("300");
  });

  it("leaves emails as previews: Monday has no full body for them", async () => {
    const db = setup();
    const fetchContents = vi.fn(async () => new Map<string, string>());
    const w = writer(db, fetchContents);
    const email = { ...entry("t-email"), type: "email" } as MondayTimelineItem;
    expect(await w.fullTextFor(new Map([["100", [email]]]))).toEqual(new Map());
    expect(fetchContents).not.toHaveBeenCalled();
  });

  it("fetches no more than its budget", async () => {
    const db = setup();
    const fetchContents = vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, FULL])));
    const w = writer(db, fetchContents, 0);
    w.insert(bothSurfaces(), await w.fullTextFor(bothSurfaces()));
    expect(fetchContents).not.toHaveBeenCalled();
    expect(rows(db)[0]!.body_html).toBe(PREVIEW);
  });

  it("keeps the preview when Monday's full-text fetch fails", async () => {
    const db = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = writer(db, async () => { throw new Error("complexity budget exhausted"); });
    w.insert(bothSurfaces(), await w.fullTextFor(bothSurfaces()));
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]!.body_html).toBe(PREVIEW);
  });
});
