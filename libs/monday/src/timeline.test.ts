// =============================================================================
// Tests for E&A timeline fetching (fetchTimelineBatch / fetchCustomActivities)
// =============================================================================

import { test, expect, describe, beforeEach, afterEach, vi } from "vitest";
import { fetchTimelineBatch, fetchCustomActivities, timelineAlias, setApiToken } from "./api";

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
