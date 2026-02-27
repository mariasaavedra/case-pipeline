import { test, expect, describe } from "bun:test";
import { matchRoute, clientPath, clientsPath } from "./router";

describe("matchRoute", () => {
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
