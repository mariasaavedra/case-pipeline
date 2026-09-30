import { test, expect, describe, vi, afterEach } from "vitest";
import { matchRoute, clientPath, clientsPath, openClientPeek, closeClientPeek, readClientPeek } from "./router";

describe("matchRoute", () => {
  test("/jail-intakes → the jail intakes board", () => {
    expect(matchRoute("/jail-intakes")).toEqual({ page: "jail-intakes", params: {} });
  });

  test("/settings → the account tab; /settings/:tab → that tab; unknown → account", () => {
    expect(matchRoute("/settings")).toEqual({ page: "settings", params: { tab: "account" } });
    expect(matchRoute("/settings/admin")).toEqual({ page: "settings", params: { tab: "admin" } });
    expect(matchRoute("/settings/firm/")).toEqual({ page: "settings", params: { tab: "firm" } });
    expect(matchRoute("/settings/bogus")).toEqual({ page: "settings", params: { tab: "account" } });
  });

  test("root path → landing", () => {
    expect(matchRoute("/")).toEqual({ page: "landing", params: {} });
  });

  test("/clients → clients list", () => {
    expect(matchRoute("/clients")).toEqual({ page: "clients", params: {} });
  });

  test("/clients/:id → client-detail with overview tab", () => {
    expect(matchRoute("/clients/abc-123")).toEqual({
      page: "client-detail",
      params: { id: "abc-123", tab: "overview" },
    });
  });

  test("/clients/:id/:tab → client-detail with specific tab", () => {
    expect(matchRoute("/clients/abc-123/documents")).toEqual({
      page: "client-detail",
      params: { id: "abc-123", tab: "documents" },
    });
  });

  test("invalid tab → defaults to overview", () => {
    expect(matchRoute("/clients/abc-123/bogus")).toEqual({
      page: "client-detail",
      params: { id: "abc-123", tab: "overview" },
    });
  });

  test("trailing slash is stripped", () => {
    expect(matchRoute("/clients/")).toEqual({ page: "clients", params: {} });
  });

  test("encoded id is decoded", () => {
    expect(matchRoute("/clients/hello%20world")).toEqual({
      page: "client-detail",
      params: { id: "hello world", tab: "overview" },
    });
  });

  test("unknown path → landing", () => {
    expect(matchRoute("/unknown/path")).toEqual({ page: "landing", params: {} });
  });
});

describe("URL builders", () => {
  test("clientPath without tab", () => {
    expect(clientPath("abc-123")).toBe("/clients/abc-123");
  });

  test("clientPath with overview tab omits tab", () => {
    expect(clientPath("abc-123", "overview")).toBe("/clients/abc-123");
  });

  test("clientPath with specific tab", () => {
    expect(clientPath("abc-123", "documents")).toBe("/clients/abc-123/documents");
  });

  test("clientPath encodes special chars", () => {
    expect(clientPath("hello world")).toBe("/clients/hello%20world");
  });

  test("clientsPath", () => {
    expect(clientsPath()).toBe("/clients");
  });
});

// A just-enough window + history: a stack of { url, state } and a popstate count.
function fakeWindow(start: string) {
  const entries: { url: string; state: unknown }[] = [{ url: start, state: null }];
  let index = 0;
  let pops = 0;
  const location = {
    get href() { return `http://app.test${entries[index]!.url}`; },
    get search() { return new URL(this.href).search; },
    get pathname() { return new URL(this.href).pathname; },
  };
  const history = {
    get state() { return entries[index]!.state; },
    pushState(state: unknown, _t: string, url: string) {
      entries.splice(index + 1);
      entries.push({ url, state });
      index++;
    },
    replaceState(state: unknown, _t: string, url: string) { entries[index] = { url, state }; },
    back() { index--; pops++; },
  };
  vi.stubGlobal("window", { location, history, dispatchEvent: () => { pops++; } });
  vi.stubGlobal("PopStateEvent", class { constructor(public type: string) {} });
  return { url: () => entries[index]!.url, depth: () => entries.length, pops: () => pops };
}

describe("client peek", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("open adds ?client= to the current page, keeping its filters", () => {
    const w = fakeWindow("/alerts?severity=critical");
    openClientPeek("p-1", "Ana Ruiz");
    expect(w.url()).toBe("/alerts?severity=critical&client=p-1");
    expect(readClientPeek()).toEqual({ localId: "p-1", name: "Ana Ruiz" });
    expect(w.pops()).toBe(1);
  });

  test("close goes back over the entry it pushed", () => {
    const w = fakeWindow("/alerts");
    openClientPeek("p-1");
    closeClientPeek();
    expect(w.url()).toBe("/alerts");
    expect(readClientPeek()).toBeNull();
  });

  test("peeking at a second client replaces the first instead of stacking", () => {
    const w = fakeWindow("/calendar");
    openClientPeek("p-1");
    openClientPeek("p-2");
    expect(w.depth()).toBe(2);
    closeClientPeek();
    expect(w.url()).toBe("/calendar");
  });

  test("a shared ?client= link closes by dropping the param, not leaving the page", () => {
    const w = fakeWindow("/mail?client=p-9");
    expect(readClientPeek()).toEqual({ localId: "p-9", name: undefined });
    closeClientPeek();
    expect(w.url()).toBe("/mail");
    expect(w.depth()).toBe(1);
  });
});
