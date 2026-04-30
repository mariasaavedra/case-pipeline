// =============================================================================
// Tests for Seeded Random Number Generator
// =============================================================================

import { test, expect, describe } from "vitest";
import { SeededRandom } from "./seeded-random";

// =============================================================================
// Basic functionality tests
// =============================================================================

describe("SeededRandom", () => {
  describe("constructor", () => {
    test("accepts a seed value", () => {
      const rng = new SeededRandom(12345);
      expect(rng.getSeed()).toBe(12345);
    });

    test("generates a seed if not provided", () => {
      const rng = new SeededRandom();
      expect(rng.getSeed()).toBeGreaterThan(0);
    });
  });

  describe("reproducibility", () => {
    test("same seed produces same sequence", () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(42);

      const sequence1 = [rng1.next(), rng1.next(), rng1.next()];
      const sequence2 = [rng2.next(), rng2.next(), rng2.next()];

      expect(sequence1).toEqual(sequence2);
    });

    test("different seeds produce different sequences", () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(43);

      expect(rng1.next()).not.toBe(rng2.next());
    });
  });

  describe("next()", () => {
    test("returns values between 0 and 1", () => {
      const rng = new SeededRandom(12345);

      for (let i = 0; i < 100; i++) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    test("produces different values on successive calls", () => {
      const rng = new SeededRandom(12345);
      const values = new Set<number>();

      for (let i = 0; i < 100; i++) {
        values.add(rng.next());
      }

      // Should have mostly unique values
      expect(values.size).toBeGreaterThan(90);
    });
  });

  describe("int()", () => {
    test("returns integers within range", () => {
      const rng = new SeededRandom(12345);

      for (let i = 0; i < 100; i++) {
        const value = rng.int(1, 10);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(10);
        expect(Number.isInteger(value)).toBe(true);
      }
    });

    test("includes both min and max values", () => {
      const rng = new SeededRandom(12345);
      const values = new Set<number>();

      for (let i = 0; i < 1000; i++) {
        values.add(rng.int(1, 3));
      }

      expect(values.has(1)).toBe(true);
      expect(values.has(2)).toBe(true);
      expect(values.has(3)).toBe(true);
    });

    test("works with same min and max", () => {
      const rng = new SeededRandom(12345);
      expect(rng.int(5, 5)).toBe(5);
    });
  });

  describe("float()", () => {
    test("returns floats within range", () => {
      const rng = new SeededRandom(12345);

      for (let i = 0; i < 100; i++) {
        const value = rng.float(0.5, 2.5);
        expect(value).toBeGreaterThanOrEqual(0.5);
        expect(value).toBeLessThan(2.5);
      }
    });
  });

  describe("choice()", () => {
    test("selects element from array", () => {
      const rng = new SeededRandom(12345);
      const arr = ["a", "b", "c", "d"];

      const result = rng.choice(arr);

      expect(arr).toContain(result);
    });

    test("is reproducible with same seed", () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(42);
      const arr = ["a", "b", "c", "d", "e"];

      expect(rng1.choice(arr)).toBe(rng2.choice(arr));
    });

    test("throws on empty array", () => {
      const rng = new SeededRandom(12345);

      expect(() => rng.choice([])).toThrow("Cannot choose from empty array");
    });

    test("works with single element array", () => {
      const rng = new SeededRandom(12345);

      expect(rng.choice(["only"])).toBe("only");
    });
  });

  describe("sample()", () => {
    test("returns requested number of elements", () => {
      const rng = new SeededRandom(12345);
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      const result = rng.sample(arr, 3);

      expect(result).toHaveLength(3);
    });

    test("returns unique elements", () => {
      const rng = new SeededRandom(12345);
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      const result = rng.sample(arr, 5);
      const uniqueResults = new Set(result);

      expect(uniqueResults.size).toBe(5);
    });

    test("does not modify original array", () => {
      const rng = new SeededRandom(12345);
      const arr = [1, 2, 3, 4, 5];
      const originalLength = arr.length;

      rng.sample(arr, 3);

      expect(arr).toHaveLength(originalLength);
    });

    test("throws when count exceeds array length", () => {
      const rng = new SeededRandom(12345);
      const arr = [1, 2, 3];

      expect(() => rng.sample(arr, 5)).toThrow("Sample size cannot exceed array length");
    });

    test("works when count equals array length", () => {
      const rng = new SeededRandom(12345);
      const arr = [1, 2, 3];

      const result = rng.sample(arr, 3);

      expect(result).toHaveLength(3);
      expect(result.sort()).toEqual([1, 2, 3]);
    });
  });

  describe("chance()", () => {
    test("returns boolean", () => {
      const rng = new SeededRandom(12345);

      const result = rng.chance(0.5);

      expect(typeof result).toBe("boolean");
    });

    test("probability 0 always returns false", () => {
      const rng = new SeededRandom(12345);

      for (let i = 0; i < 100; i++) {
        expect(rng.chance(0)).toBe(false);
      }
    });

    test("probability 1 always returns true", () => {
      const rng = new SeededRandom(12345);

      for (let i = 0; i < 100; i++) {
        expect(rng.chance(1)).toBe(true);
      }
    });

    test("probability 0.5 gives roughly equal distribution", () => {
      const rng = new SeededRandom(12345);
      let trueCount = 0;

      for (let i = 0; i < 1000; i++) {
        if (rng.chance(0.5)) trueCount++;
      }

      // Should be roughly 50% (allow 40-60% range)
      expect(trueCount).toBeGreaterThan(400);
      expect(trueCount).toBeLessThan(600);
    });
  });

  describe("shuffle()", () => {
    test("returns same array reference", () => {
      const rng = new SeededRandom(12345);
      const arr = [1, 2, 3, 4, 5];

      const result = rng.shuffle(arr);

      expect(result).toBe(arr);
    });

    test("contains all original elements", () => {
      const rng = new SeededRandom(12345);
      const arr = [1, 2, 3, 4, 5];

      rng.shuffle(arr);

      expect(arr.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    test("is reproducible with same seed", () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(42);
      const arr1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const arr2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      rng1.shuffle(arr1);
      rng2.shuffle(arr2);

      expect(arr1).toEqual(arr2);
    });

    test("actually shuffles the array", () => {
      const rng = new SeededRandom(12345);
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const arr = [...original];

      rng.shuffle(arr);

      // Very unlikely to remain in original order
      expect(arr).not.toEqual(original);
    });
  });

  describe("uuid()", () => {
    test("returns string in UUID format", () => {
      const rng = new SeededRandom(12345);

      const uuid = rng.uuid();

      // UUID format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    test("generates unique UUIDs", () => {
      const rng = new SeededRandom(12345);
      const uuids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        uuids.add(rng.uuid());
      }

      expect(uuids.size).toBe(100);
    });

    test("is reproducible with same seed", () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(42);

      expect(rng1.uuid()).toBe(rng2.uuid());
    });

    test("version nibble is always 4", () => {
      const rng = new SeededRandom(12345);

      for (let i = 0; i < 10; i++) {
        const uuid = rng.uuid();
        expect(uuid[14]).toBe("4");
      }
    });
  });
});
