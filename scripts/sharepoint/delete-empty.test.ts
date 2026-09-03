import { describe, it, expect, vi, afterEach } from "vitest";
import { deleteEmptyFolder } from "./delete-empty.js";
import { staticAuth } from "./graph-client.js";

const auth = staticAuth("t");
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
const recent = new Date(Date.now() - 60_000).toISOString();
const old = new Date(Date.now() - 400 * 86_400_000).toISOString();

/** Stub: the folder itself, then its children listing. */
function stub(folder: unknown, children: unknown[] = [], onDelete?: () => void) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "DELETE") { onDelete?.(); return new Response(null, { status: 204 }); }
    if (String(input).includes("/children")) return json({ value: children });
    return folder ? json(folder) : json({ error: { code: "itemNotFound" } }, 404);
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("deleteEmptyFolder", () => {
  const emptyRecent = { id: "1", name: "X", webUrl: "w", folder: { childCount: 0 }, createdDateTime: recent };

  it("deletes an empty folder it just made", async () => {
    let deleted = false;
    stub(emptyRecent, [], () => (deleted = true));
    expect(await deleteEmptyFolder(auth, "d", "p/X", { apply: true })).toMatchObject({ kind: "deleted" });
    expect(deleted).toBe(true);
  });

  it("REFUSES a folder with anything inside", async () => {
    let deleted = false;
    stub(emptyRecent, [{ id: "c", name: "scan.pdf" }], () => (deleted = true));
    const r = await deleteEmptyFolder(auth, "d", "p/X", { apply: true });
    expect(r).toMatchObject({ kind: "skipped" });
    expect(r.kind === "skipped" && r.reason).toMatch(/NOT EMPTY/);
    expect(deleted).toBe(false);
  });

  it("trusts the listing over a stale childCount of 0", async () => {
    // Graph reported 0 on the parent listing; the folder actually has a file.
    let deleted = false;
    stub({ ...emptyRecent, folder: { childCount: 0 } }, [{ id: "c", name: "I-589.pdf" }], () => (deleted = true));
    expect(await deleteEmptyFolder(auth, "d", "p/X", { apply: true })).toMatchObject({ kind: "skipped" });
    expect(deleted).toBe(false);
  });

  it("REFUSES a folder that predates this automation", async () => {
    let deleted = false;
    stub({ ...emptyRecent, createdDateTime: old }, [], () => (deleted = true));
    const r = await deleteEmptyFolder(auth, "d", "p/X", { apply: true });
    expect(r).toMatchObject({ kind: "skipped" });
    expect(r.kind === "skipped" && r.reason).toMatch(/older than/);
    expect(deleted).toBe(false);
  });

  it("refuses when there is no creation date to check", async () => {
    stub({ id: "1", name: "X", webUrl: "w", folder: {} }, []);
    expect(await deleteEmptyFolder(auth, "d", "p/X", { apply: true })).toMatchObject({ kind: "skipped" });
  });

  it("deletes nothing in a dry run", async () => {
    let deleted = false;
    stub(emptyRecent, [], () => (deleted = true));
    expect(await deleteEmptyFolder(auth, "d", "p/X", { apply: false })).toMatchObject({ kind: "would-delete" });
    expect(deleted).toBe(false);
  });

  it("is a no-op for a folder that is already gone", async () => {
    stub(null);
    expect(await deleteEmptyFolder(auth, "d", "p/X", { apply: true })).toMatchObject({ kind: "skipped", reason: "not found" });
  });
});
