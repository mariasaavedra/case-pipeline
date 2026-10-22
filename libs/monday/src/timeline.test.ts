// =============================================================================
// Tests for E&A timeline fetching (fetchTimelineBatch / fetchCustomActivities)
// =============================================================================

import { test, expect, describe, beforeEach, afterEach, vi } from "vitest";
import { fetchTimelineBatch, fetchTimelineItemContents, fetchCustomActivities, timelineAlias, setApiToken, normalizeEmailMetadata } from "./api";

describe("normalizeEmailMetadata", () => {
  test("turns Monday's null lists into empty ones and trims addresses", () => {
    expect(normalizeEmailMetadata({ from: " a@x.com ", to: ["b@x.com", " "], cc: null, bcc: null })).toEqual({
      from: "a@x.com",
      to: ["b@x.com"],
      cc: [],
      bcc: [],
    });
  });

  test("is null for a non-email entry or an empty record", () => {
    expect(normalizeEmailMetadata(null)).toBeNull();
    expect(normalizeEmailMetadata(undefined)).toBeNull();
    expect(normalizeEmailMetadata({ from: "", to: null, cc: [], bcc: null })).toBeNull();
  });
});

function mockResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

describe("fetchTimelineBatch", () => {
  beforeEach(() => setApiToken("test-token"));
  afterEach(() => vi.unstubAllGlobals());

  test("batches items via aliases in one request and maps by item id", async () => {
    let capturedBody: { query: string } | null = null;
    const fetchMock = vi.fn(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return mockResponse({
        data: {
          [timelineAlias("111")]: {
            timeline_items_page: {
              cursor: null,
              timeline_items: [
                { id: "e1", type: "email", title: "Hi", content: "<p>x</p>", created_at: "2026-01-01", custom_activity_id: null, user: { id: "1", name: "Ana" } },
              ],
            },
          },
          [timelineAlias("222")]: { timeline_items_page: { cursor: null, timeline_items: [] } },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const map = await fetchTimelineBatch(["111", "222"], 50);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedBody!.query).toContain(timelineAlias("111"));
    expect(capturedBody!.query).toContain(timelineAlias("222"));
    expect(map.get("111")).toHaveLength(1);
    expect(map.get("111")![0]!.type).toBe("email");
    expect(map.get("222")).toEqual([]);
  });

  test("follows the pagination tail when a cursor is returned", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          data: { [timelineAlias("111")]: { timeline_items_page: { cursor: "CURSOR1", timeline_items: [{ id: "p1", type: "email" }] } } },
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          data: { timeline: { timeline_items_page: { cursor: null, timeline_items: [{ id: "p2", type: "note" }] } } },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const map = await fetchTimelineBatch(["111"], 1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(map.get("111")!.map((i) => i.id)).toEqual(["p1", "p2"]);
  });

  // metadata is an unknown field on the pinned version, which fails the whole query.
  test("asks for email metadata on an API version that has it, on every page", async () => {
    const headers: string[] = [];
    const bodies: string[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: string, opts: { body: string; headers: Record<string, string> }) => {
        headers.push(opts.headers["API-Version"]!);
        bodies.push(opts.body);
        return mockResponse({
          data: { [timelineAlias("111")]: { timeline_items_page: { cursor: "C1", timeline_items: [] } } },
        });
      })
      .mockImplementationOnce(async (_url: string, opts: { body: string; headers: Record<string, string> }) => {
        headers.push(opts.headers["API-Version"]!);
        bodies.push(opts.body);
        return mockResponse({ data: { timeline: { timeline_items_page: { cursor: null, timeline_items: [] } } } });
      });
    vi.stubGlobal("fetch", fetchMock);

    await fetchTimelineBatch(["111"], 1);

    expect(headers).toEqual(["2026-07", "2026-07"]);
    for (const b of bodies) expect(b).toContain("EmailTimelineItemMetadata");
  });

  test("missing alias node yields an empty list for that item", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse({ data: {} })));
    const map = await fetchTimelineBatch(["999"], 50);
    expect(map.get("999")).toEqual([]);
  });

  test("empty input returns an empty map without hitting the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const map = await fetchTimelineBatch([], 50);
    expect(map.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchCustomActivities", () => {
  beforeEach(() => setApiToken("test-token"));
  afterEach(() => vi.unstubAllGlobals());

  test("maps custom activity ids to names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse({ data: { custom_activity: [{ id: "abc", name: "Consult note", color: null, icon_id: null }] } })
      )
    );
    const map = await fetchCustomActivities();
    expect(map.get("abc")).toBe("Consult note");
    expect(map.size).toBe(1);
  });
});

describe("fetchTimelineItemContents", () => {
  beforeEach(() => setApiToken("test-token"));
  afterEach(() => vi.unstubAllGlobals());

  test("fetches full content by timeline item id, batched, skipping missing ids and previews", async () => {
    const queries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: { body: string }) => {
      const { query } = JSON.parse(opts.body) as { query: string };
      queries.push(query);
      if (query.includes('"b"')) return mockResponse({ data: { c0: null } });
      if (query.includes('"c"')) return mockResponse({ data: { c0: { id: "c", content: "a plain preview, as for an email" } } });
      return mockResponse({ data: { c0: { id: "a", content: "<div>full note</div>" } } });
    }));

    const map = await fetchTimelineItemContents(["a", "b", "c"], undefined, 1);
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain('timeline_item(id: "a") { content }'); // `id` too → previews
    expect(map).toEqual(new Map([["a", "<div>full note</div>"]]));
  });
});

test("asks for at most 12 entries per request — Monday answers 13+ with previews", async () => {
  setApiToken("test-token");
  const sizes: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: { body: string }) => {
    const { query } = JSON.parse(opts.body) as { query: string };
    sizes.push((query.match(/timeline_item\(/g) ?? []).length);
    return mockResponse({ data: {} });
  }));
  await fetchTimelineItemContents(Array.from({ length: 30 }, (_, i) => `id${i}`));
  expect(sizes).toEqual([12, 12, 6]);
  vi.unstubAllGlobals();
});

test("drops an entry deleted in Monday and fetches the rest of its batch", async () => {
  setApiToken("test-token");
  const queries: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: { body: string }) => {
    const { query } = JSON.parse(opts.body) as { query: string };
    queries.push(query);
    if (query.includes('"gone"')) {
      return mockResponse({
        data: null,
        errors: [{ message: "Timeline item not found.", path: ["c1"], extensions: { code: "NOT_FOUND" } }],
      });
    }
    return mockResponse({ data: { c0: { content: "<div>a</div>" }, c1: { content: "<div>b</div>" } } });
  }));
  const map = await fetchTimelineItemContents(["a", "gone", "b"]);
  expect(queries).toHaveLength(2);
  expect(map).toEqual(new Map([["a", "<div>a</div>"], ["b", "<div>b</div>"]]));
  vi.unstubAllGlobals();
});

test("still throws an error that is not NOT_FOUND", async () => {
  setApiToken("test-token");
  vi.stubGlobal("fetch", vi.fn(async () =>
    mockResponse({ data: null, errors: [{ message: "Parse error", extensions: { code: "PARSE" } }] })));
  await expect(fetchTimelineItemContents(["a"])).rejects.toThrow("Parse error");
  vi.unstubAllGlobals();
});
