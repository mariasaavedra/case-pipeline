import { test, expect, describe } from "bun:test";
import { normalizeANumber, formatANumber } from "./a-number";

describe("normalizeANumber", () => {
  test("plain 9 digits", () => {
    expect(normalizeANumber("123456789")).toBe("123456789");
  });

  test("with hyphens", () => {
    expect(normalizeANumber("123-456-789")).toBe("123456789");
  });

  test("with A prefix and hyphens", () => {
    expect(normalizeANumber("A123-456-789")).toBe("123456789");
  });

  test("with spaces", () => {
    expect(normalizeANumber("123 456 789")).toBe("123456789");
  });

  test("with A prefix and spaces", () => {
    expect(normalizeANumber("A 123 456 789")).toBe("123456789");
  });

  test("returns null for too few digits", () => {
    expect(normalizeANumber("12345")).toBeNull();
  });

  test("returns null for too many digits", () => {
    expect(normalizeANumber("1234567890")).toBeNull();
  });

  test("returns null for null/undefined", () => {
    expect(normalizeANumber(null)).toBeNull();
    expect(normalizeANumber(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(normalizeANumber("")).toBeNull();
  });
});

describe("formatANumber", () => {
  test("formats 9 digits", () => {
    expect(formatANumber("123456789")).toBe("A123-456-789");
  });

  test("returns null for null/undefined", () => {
    expect(formatANumber(null)).toBeNull();
    expect(formatANumber(undefined)).toBeNull();
  });

  test("returns input if not 9 digits", () => {
    expect(formatANumber("12345")).toBe("12345");
  });
});
