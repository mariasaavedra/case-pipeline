import { describe, it, expect, vi, afterEach } from "vitest";
import PizZip from "pizzip";
import {
  decide, perform, ensureConsultDoc, resolveLinkedFolder, resetSweepCaches, CONSULT_SUBFOLDER, type SweepCandidate,
} from "./sweep.js";
import { MISSING_NOTE } from "./consult-doc.js";
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
const requested: string[] = [];

function stubGraph(present: (url: string) => boolean, neighbours: string[] = [], years = ["2025 Consults", "2026 Consults"]) {
  requested.length = 0;
  resetSweepCaches();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = decodeURIComponent(String(input));
      requested.push(url);
      // The library root itself, and the year folders it contains.
      if (/\/drives\/[^/]+\/root$/.test(url)) {
        return json({ id: "root", name: "", webUrl: "w", folder: {} });
      }
      if (/\/drives\/[^/]+\/items\/root\/children/.test(url)) {
        return json({ value: years.map((y, i) => ({ id: `y${i}`, name: y, webUrl: "w", folder: {} })) });
      }
      if (url.includes("/sites/") && url.endsWith("/drive")) return json({ id: "drive1" });
      if (/\/sites\/[^:]+:\/sites\//.test(url) && !url.includes("/drive")) return json({ id: "site1", webUrl: "w" });
      // What else is sitting in the initial folder / found by search.
      if (url.includes("/children") || url.includes("/search(")) {
        return json({ value: neighbours.map((n, i) => ({ id: `n${i}`, name: n, webUrl: "w", folder: {} })) });
      }
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

  it("does nothing for a consult that will never happen", async () => {
    stubGraph(() => false);
    for (const status of ["Cancelled/No Show", "Some New Label", null]) {
      const d = await decide(auth, candidate({ apptStatus: status }));
      expect(d.action.kind, `${status}`).toBe("skip");
    }
  });

  it("DOES make a folder for a consult that is merely upcoming", async () => {
    // The attorney needs somewhere to put material during the meeting. The
    // document waits until the consult has actually taken place.
    stubGraph(() => false);
    for (const status of ["Upcoming", "Scheduled", "To be rescheduled"]) {
      const d = await decide(auth, candidate({ apptStatus: status }));
      expect(d.action.kind, `${status}`).toBe("create");
    }
  });

  it("does nothing when something is already recorded", async () => {
    stubGraph(() => false);
    const d = await decide(auth, candidate({ existingLink: "https://sp/whatever" }));
    expect(d.action).toMatchObject({ kind: "skip", reason: "already recorded" });
  });

  it("links a folder whose name carries a case number instead of creating one", async () => {
    // Real case: the e-file is "HAMSHARI, Raghad - 20221". The exact path misses
    // it, but normalised it is plainly the same person.
    stubGraph(() => false, ["VENTURA, Milton - 22016"]);
    const d = await decide(auth, candidate());
    expect(d.action.kind).toBe("link");
    if (d.action.kind === "link") expect(d.action.path).toBe("VENTURA, Milton - 22016");
  });

  it("refuses to create beside the SAME person under a fuller given name", async () => {
    // The 2026-09-03 duplicate: Monday says "Milton", the folder says
    // "Milton Cesar". Exact paths miss it; this must not become a new folder.
    stubGraph(() => false, ["VENTURA, Milton Cesar"]);
    const d = await decide(auth, candidate());
    expect(d.action.kind).toBe("skip");
    if (d.action.kind === "skip") expect(d.action.reason).toMatch(/possible existing folder/);
  });

  it("still creates when the neighbours are different people", async () => {
    stubGraph(() => false, ["VENTURA, Rosa", "VENTURI, Milton", "VASQUEZ, Milton"]);
    const d = await decide(auth, candidate());
    expect(d.action).toMatchObject({ kind: "create" });
  });

  it("looks in EVERY consult year, not just the year of this appointment", async () => {
    // A repeat consultee has their folder under an earlier year. Checking only
    // the current one is what produced duplicates on 2026-09-03.
    stubGraph(() => false, [], ["2024 Consults", "2025 Consults", "2026 Consults"]);
    await decide(auth, candidate());
    for (const year of ["2024 Consults/V", "2025 Consults/V", "2026 Consults/V"]) {
      expect(requested.some((u) => u.includes(year)), year).toBe(true);
    }
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

describe("ensureConsultDoc", () => {
  const sources = {
    profileName: "Milton VENTURA",
    profile: { consultation_notes: "seen 30 min, wants I-589" } as Record<string, unknown>,
    appointment: {} as Record<string, unknown>,
    apptStatus: "Past Consult",
    consultDate: "2026-03-04",
    now: new Date("2026-09-03T16:30:00Z"),
  };
  const render = () => Buffer.from("DOCX");
  const ME = "svc@sharma-crawford.com";
  const VENTURA = { site: "scalconsults", path: "2026 Consults/V/VENTURA, Milton" };

  /** A minimal .docx whose body reads `text`. */
  const docx = (text: string) => {
    const zip = new PizZip();
    zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
    return Buffer.from(zip.generate({ type: "uint8array" }));
  };

  /** Tracks PUTs so a test can assert nothing was written. */
  const seen: string[] = [];
  function stubFiles(existing: unknown, puts: string[] = [], body = docx(MISSING_NOTE)) {
    seen.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = decodeURIComponent(String(input));
      seen.push(url);
      if (init?.method === "PUT") { puts.push(url); return json({ id: "f1", name: "x" }); }
      if (url.endsWith("/content")) return new Response(new Uint8Array(body), { status: 200 });
      if (url.includes("/sites/") && url.endsWith("/drive")) return json({ id: "drive1" });
      if (/\/sites\/[^:]+:\/sites\//.test(url) && !url.includes("/drive")) return json({ id: "s1", webUrl: "w" });
      if (url.includes(".docx")) {
        return existing ? json(existing) : json({ error: { code: "itemNotFound" } }, 404);
      }
      // Any folder in the path exists.
      return json({ id: "folder1", name: "f", webUrl: "w", folder: {} });
    }));
    return puts;
  }

  it("creates the CONSULT subfolder but writes no document before the consult", async () => {
    const puts = stubFiles(null);
    const r = await ensureConsultDoc(auth, VENTURA, sources, render,
      { writeDocument: false, account: ME });
    expect(r).toBeNull();
    expect(puts).toEqual([]);
    expect(seen.some((u) => u.includes(CONSULT_SUBFOLDER))).toBe(true);
  });

  it("writes the document once the consult has happened", async () => {
    const puts = stubFiles(null);
    const r = await ensureConsultDoc(auth, VENTURA, sources, render,
      { writeDocument: true, account: ME });
    expect(r).toMatchObject({ kind: "written", awaitingNote: false });
    expect(puts).toHaveLength(1);
    // The upload addresses its parent by id, so the subfolder shows up in the
    // lookups that preceded it rather than in the PUT url.
    expect(seen.some((u) => u.includes(`/VENTURA, Milton/${CONSULT_SUBFOLDER}`))).toBe(true);
    expect(puts[0]).toContain("conflictBehavior=fail");
  });

  it("does not rewrite while the note is still missing", async () => {
    const puts = stubFiles({ id: "f1", name: "d.docx", webUrl: "w", file: {},
      lastModifiedBy: { user: { email: ME } } });
    const r = await ensureConsultDoc(auth, VENTURA, { ...sources, profile: {} }, render,
      { writeDocument: true, account: ME });
    expect(r).toMatchObject({ kind: "unchanged" });
    expect(puts).toEqual([]);
  });

  it("replaces its own placeholder document once a note appears", async () => {
    const puts = stubFiles({ id: "f1", name: "d.docx", webUrl: "w", file: {},
      lastModifiedBy: { user: { email: ME } } });
    const r = await ensureConsultDoc(auth, VENTURA, sources, render, { writeDocument: true, account: ME });
    expect(r).toMatchObject({ kind: "replaced" });
    expect(puts[0]).toContain("conflictBehavior=replace");
  });

  it("does not rewrite its own document once it already holds the note", async () => {
    const puts = stubFiles({ id: "f1", name: "d.docx", webUrl: "w", file: {},
      lastModifiedBy: { user: { email: ME } } }, [], docx("seen 30 min, wants I-589"));
    const r = await ensureConsultDoc(auth, VENTURA, sources, render, { writeDocument: true, account: ME });
    expect(r).toMatchObject({ kind: "unchanged" });
    expect(puts).toEqual([]);
  });

  it("writes into an E-File folder too", async () => {
    const puts = stubFiles(null);
    const r = await ensureConsultDoc(auth, { site: "scalefiles", path: "V/VENTURA, Milton" }, sources, render,
      { writeDocument: true, account: ME });
    expect(r).toMatchObject({ kind: "written" });
    expect(puts).toHaveLength(1);
    expect(seen.some((u) => u.includes("/sites/scalefiles"))).toBe(true);
  });

  it("refuses SCAL Closed", async () => {
    stubFiles(null);
    await expect(ensureConsultDoc(auth, { site: "SCALClosed", path: "VENTURA, Milton" }, sources, render,
      { writeDocument: true, account: ME })).rejects.toThrow(/SCALClosed/);
  });

  it("NEVER overwrites a document someone else edited", async () => {
    const puts = stubFiles({ id: "f1", name: "d.docx", webUrl: "w", file: {},
      lastModifiedBy: { user: { email: "attorney@sharma-crawford.com" } } });
    const r = await ensureConsultDoc(auth, VENTURA, sources, render, { writeDocument: true, account: ME });
    expect(r).toMatchObject({ kind: "left-alone", reason: "edited by someone else" });
    expect(puts).toEqual([]);
  });
});

describe("resolveLinkedFolder — the folder already on the profile", () => {
  /** Each site resolves to its own drive, so the item's driveId names the library. */
  function stubShare(item: unknown, status = 200) {
    resetSweepCaches();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("/shares/")) return status === 200 ? json(item) : json({ error: {} }, status);
      const site = /\/sites\/[^:]+:\/sites\/([^/?]+)/.exec(url)?.[1];
      if (site) return json({ id: `site-${site}`, webUrl: "w" });
      const drive = /\/sites\/site-([^/]+)\/drive$/.exec(url)?.[1];
      if (drive) return json({ id: `drive-${drive}` });
      return json({ error: {} }, 500);
    }));
  }
  const folder = (driveId: string, parent: string, name: string) =>
    ({ id: "i", name, webUrl: "w", folder: {}, parentReference: { driveId, path: `/drives/${driveId}/root:${parent}` } });

  it("finds a consult folder", async () => {
    stubShare(folder("drive-scalconsults", "/2026 Consults/B", "BERMUDEZ-PAZ, Gerbert"));
    expect(await resolveLinkedFolder(auth, "https://sp/x")).toEqual(
      { site: "scalconsults", path: "2026 Consults/B/BERMUDEZ-PAZ, Gerbert" });
  });

  it("finds an E-File", async () => {
    stubShare(folder("drive-scalefiles", "/V", "VENTURA, Milton - 20231"));
    expect(await resolveLinkedFolder(auth, "https://sp/x")).toEqual(
      { site: "scalefiles", path: "V/VENTURA, Milton - 20231" });
  });

  it("uses the client folder when the link points at its CONSULT subfolder", async () => {
    stubShare(folder("drive-scalconsults", "/2026 Consults/V/VENTURA, Milton", "CONSULT"));
    expect(await resolveLinkedFolder(auth, "https://sp/x")).toEqual(
      { site: "scalconsults", path: "2026 Consults/V/VENTURA, Milton" });
  });

  it("skips SCAL Closed", async () => {
    stubShare(folder("drive-SCALClosed", "", "VENTURA, Milton"));
    expect(await resolveLinkedFolder(auth, "https://sp/x")).toMatchObject({ skip: expect.stringMatching(/Closed/) });
  });

  it("skips a link that no longer opens rather than failing the run", async () => {
    stubShare(null, 404);
    expect(await resolveLinkedFolder(auth, "https://sp/x")).toMatchObject({ skip: expect.stringMatching(/404/) });
  });
});
