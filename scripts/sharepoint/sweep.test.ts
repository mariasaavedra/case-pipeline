import { describe, it, expect, vi, afterEach } from "vitest";
import { decide, perform, type SweepCandidate } from "./sweep.js";
import { staticAuth } from "./graph-client.js";

const auth = staticAuth("t");

const candidate = (over: Partial<SweepCandidate> = {}): SweepCandidate => ({
  profileLocalId: "p1",
  profileMondayId: "123",
  profileName: "Milton VENTURA",
  firstName: "Milton",
  lastName: "Ventura",
  consultDate: "2026-03-04",
  apptStatus: "Past Consult",
  existingLink: null,
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Graph stub: site/drive always resolve; `present` decides which paths exist. */
function stubGraph(present: (url: string) => boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("/sites/") && url.endsWith("/drive")) return json({ id: "drive1" });
      if (/\/sites\/[^:]+:\/sites\//.test(url) && !url.includes("/drive")) return json({ id: "site1", webUrl: "w" });
      if (url.includes("/drives/")) {
        return present(url)
          ? json({ id: "item1", name: "VENTURA, Milton", webUrl: "https://sp/found", folder: {} })
          : json({ error: { code: "itemNotFound" } }, 404);
      }
      return json({ error: { code: "unexpected" } }, 500);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("decide — what the sweep will do", () => {
  it("creates a consult folder when the client has none anywhere", async () => {
    stubGraph(() => false);
    const d = await decide(auth, candidate());
    expect(d.action).toMatchObject({ kind: "create", path: "2026 Consults/V/VENTURA, Milton" });
  });

  it("links the existing consult folder instead of creating a second one", async () => {
    stubGraph((url) => url.includes("2026 Consults/V/VENTURA, Milton"));
    const d = await decide(auth, candidate());
    expect(d.action).toMatchObject({ kind: "link", site: "scalconsults" });
  });

  it("never creates a consult folder for someone who already has an e-file", async () => {
    stubGraph((url) => url.includes("root:/V/VENTURA, Milton"));
    const d = await decide(auth, candidate());
    // Records it as an E-File, not a consult — they hired.
    expect(d.action).toMatchObject({ kind: "link", site: "scalefiles" });
    if (d.action.kind === "link") expect(d.action.target.columnId).toBe("e_file__1");
  });

  it("prefers a closed folder over everything else", async () => {
    stubGraph(() => true); // every path "exists"; Closed is checked first
    const d = await decide(auth, candidate());
    expect(d.action).toMatchObject({ kind: "link", site: "SCALClosed" });
  });

  it("does nothing for a consult that did not happen", async () => {
    stubGraph(() => false);
    for (const status of ["Cancelled/No Show", "Upcoming", "Some New Label", null]) {
      const d = await decide(auth, candidate({ apptStatus: status }));
      expect(d.action.kind).toBe("skip");
    }
  });

  it("does nothing when something is already recorded", async () => {
    stubGraph(() => false);
    const d = await decide(auth, candidate({ existingLink: "https://sp/whatever" }));
    expect(d.action).toMatchObject({ kind: "skip", reason: "already recorded" });
  });

  it("refuses a name a human should fix rather than guessing", async () => {
    stubGraph(() => false);
    const d = await decide(auth, candidate({ firstName: "RAKHIMOV,", lastName: "SHUKHRAT" }));
    expect(d.action.kind).toBe("skip");
  });
});

describe("perform", () => {
  it("records the URL when linking, and creates nothing", async () => {
    stubGraph((url) => url.includes("2026 Consults/V/VENTURA, Milton"));
    const d = await decide(auth, candidate());
    const writes: Array<[string, string]> = [];
    const result = await perform(auth, d, async (c, u) => void writes.push([c, u]));
    expect(result.outcome).toBe("linked");
    expect(writes).toEqual([["text_mkxphk77", "https://sp/found"]]);
  });

  it("writes nothing for a skip", async () => {
    stubGraph(() => false);
    const d = await decide(auth, candidate({ apptStatus: "Cancelled/No Show" }));
    const writes: string[] = [];
    const result = await perform(auth, d, async (c) => void writes.push(c));
    expect(result.outcome).toBe("skipped");
    expect(writes).toEqual([]);
  });
});
