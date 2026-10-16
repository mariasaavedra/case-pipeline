// Contract-info Monday user matchers: roster first, then the shared workspace list.
import { describe, it, expect, vi, beforeEach } from "vitest";

let workspace: Array<{ id: string; name: string; email: string | null }> = [];
let fetches = 0;
vi.mock("@case-pipeline/monday", async (orig) => ({
  ...(await orig<typeof import("@case-pipeline/monday")>()),
  fetchWorkspaceUsers: async () => { fetches++; return workspace; },
}));
vi.mock("./documents/document-settings.js", () => ({
  loadDocumentSettings: () => ({ attorneys: [{ givenName: "Jane", familyName: "Attorney", email: "jane@firm.com" }] }),
}));

const { makeMondayUserResolver, makeMondayUserByLogin } = await import("./contract-info.js");
const { resetWorkspaceUsersCache } = await import("./staff/workspace-users.js");
const { createStaff, addAlias } = await import("./staff/roster.js");
const { makeRosterDb } = await import("./staff/test-db.js");

beforeEach(() => {
  resetWorkspaceUsersCache();
  fetches = 0;
  workspace = [
    { id: "77", name: "Jane A.", email: "jane@firm.com" },
    { id: "88", name: "Bob Lawyer", email: "bob@firm.com" },
    { id: "99", name: "Lucy Betteridge", email: null },
  ];
});

describe("makeMondayUserResolver", () => {
  it("takes the roster's Monday id for a name or alias, without calling Monday", async () => {
    const db = makeRosterDb();
    const id = createStaff(db, { name: "Rekha Patel", mondayUserId: "555" });
    addAlias(db, id, "R. Patel");
    const resolve = makeMondayUserResolver("t", db);
    expect(await resolve("rekha  patel")).toBe(555);
    expect(await resolve("R. Patel")).toBe(555);
    expect(fetches).toBe(0);
  });

  it("keeps Settings e-mail first when the roster has no Monday id", async () => {
    const resolve = makeMondayUserResolver("t", makeRosterDb());
    expect(await resolve("Jane Attorney")).toBe(77);
    expect(await resolve("Bob Lawyer")).toBe(88);
    expect(await resolve("Nobody")).toBeNull();
  });

  it("matches Monday under the roster name when the board spelling differs", async () => {
    const db = makeRosterDb();
    const id = createStaff(db, { name: "Lucy Betteridge" });
    addAlias(db, id, "Lucy B.");
    expect(await makeMondayUserResolver("t", db)("Lucy B.")).toBe(99);
  });
});

describe("makeMondayUserByLogin", () => {
  it("roster by login e-mail, then Monday by e-mail, then by name", async () => {
    const db = makeRosterDb();
    createStaff(db, { name: "Ana Reyes", email: "ana@firm.com", mondayUserId: "42" });
    const byLogin = makeMondayUserByLogin("t", db);
    expect(await byLogin("ANA@firm.com", "Someone")).toEqual({ id: 42, name: "Ana Reyes" });
    expect(await byLogin("bob@firm.com", "")).toEqual({ id: 88, name: "Bob Lawyer" });
    expect(await byLogin("", "lucy betteridge")).toEqual({ id: 99, name: "Lucy Betteridge" });
    expect(await byLogin("x@firm.com", "Nobody")).toBeNull();
  });

  it("works without a roster", async () => {
    expect(await makeMondayUserByLogin("t", null)("jane@firm.com", "")).toEqual({ id: 77, name: "Jane A." });
  });
});
