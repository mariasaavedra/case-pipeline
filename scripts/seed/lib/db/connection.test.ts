import { test, expect, describe, afterEach } from "bun:test";
import { initializeDatabase, closeDatabase } from "./connection";

afterEach(() => {
  closeDatabase();
});

describe("initializeDatabase", () => {
  test("returns the same instance for the same path", () => {
    const db1 = initializeDatabase({ path: ":memory:" });
    const db2 = initializeDatabase({ path: ":memory:" });
    expect(db1).toBe(db2);
  });

  test("throws when called with a different path", () => {
    initializeDatabase({ path: ":memory:" });
    expect(() =>
      initializeDatabase({ path: "/tmp/other-test.db" })
    ).toThrow("Database already initialized");
  });

  test("allows reinitialization after closeDatabase", () => {
    initializeDatabase({ path: ":memory:" });
    closeDatabase();
    const db = initializeDatabase({ path: ":memory:" });
    expect(db).toBeDefined();
  });
});
