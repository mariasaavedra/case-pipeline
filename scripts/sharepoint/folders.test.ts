import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateFolderName, ensureFolderPath, ensureFolder } from "./folders.js";
import { staticAuth } from "./graph-client.js";

const config = staticAuth("test-token");

/** Minimal Graph stub — auth is fixed, so only Graph itself needs handling. */
function stubGraph(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("validateFolderName", () => {
  it("accepts a normal client folder name", () => {
    expect(validateFolderName("MENDOZA, Aaron")).toBeNull();
  });

  it("rejects the characters SharePoint refuses", () => {
    for (const bad of ['a"b', "a*b", "a:b", "a<b", "a>b", "a?b", "a/b", "a\\b", "a|b"]) {
      expect(validateFolderName(bad)).not.toBeNull();
    }
  });

  it("rejects a trailing period, reserved names and empties", () => {
    expect(validateFolderName("Filings.")).not.toBeNull();
    expect(validateFolderName("..")).not.toBeNull();
    expect(validateFolderName("   ")).not.toBeNull();
  });
});

describe("ensureFolder", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports an existing folder as existed and does not POST", async () => {
    const fetchMock = stubGraph((url, init) => {
      if (init?.method === "POST") throw new Error("must not create an existing folder");
      return json({ id: "1", name: "Filings", webUrl: "w", folder: { childCount: 2 } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureFolder(config, "drive1", "Client", "Filings", true);
    expect(result.outcome).toBe("existed");
  });

  it("refuses to treat an existing FILE as the folder", async () => {
    vi.stubGlobal("fetch", stubGraph(() => json({ id: "1", name: "Filings", webUrl: "w" })));
    await expect(ensureFolder(config, "drive1", "", "Filings", true)).rejects.toThrow(/is a FILE/);
  });

  it("treats a 409 race as success", async () => {
    let lookups = 0;
    vi.stubGlobal(
      "fetch",
      stubGraph((_url, init) => {
        if (init?.method === "POST") return json({ error: { code: "nameAlreadyExists" } }, 409);
        lookups++;
        // First lookup: absent. Second (post-409): someone else created it.
        return lookups === 1
          ? json({ error: { code: "itemNotFound" } }, 404)
          : json({ id: "9", name: "Filings", webUrl: "w", folder: {} });
      }),
    );

    const result = await ensureFolder(config, "drive1", "", "Filings", true);
    expect(result.outcome).toBe("existed");
    expect(result.item?.id).toBe("9");
  });
});

describe("ensureFolderPath (dry run)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports every missing segment without writing", async () => {
    const fetchMock = stubGraph((_url, init) => {
      if (init?.method === "POST") throw new Error("dry run must not write");
      return json({ error: { code: "itemNotFound" } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await ensureFolderPath(config, "drive1", "2026 Consults/M/MENDOZA, Aaron", false);
    expect(results.map((r) => r.path)).toEqual([
      "2026 Consults",
      "2026 Consults/M",
      "2026 Consults/M/MENDOZA, Aaron",
    ]);
    expect(results.every((r) => r.outcome === "would-create")).toBe(true);
  });

  it("handles a repeated segment name in the path", async () => {
    vi.stubGlobal("fetch", stubGraph(() => json({ error: { code: "itemNotFound" } }, 404)));

    const results = await ensureFolderPath(config, "drive1", "Motions/2026/Motions", false);
    expect(results.map((r) => r.path)).toEqual(["Motions", "Motions/2026", "Motions/2026/Motions"]);
  });
});
