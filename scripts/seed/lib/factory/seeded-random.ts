// =============================================================================
// Seeded Random Number Generator
// =============================================================================
// Provides deterministic random number generation for reproducible data.
// Using the same seed will always produce the same sequence of values.

export class SeededRandom {
  private seed: number;

  constructor(seed?: number) {
    this.seed = seed ?? Date.now();
  }

  /**
   * Returns the current seed value
   */
  getSeed(): number {
    return this.seed;
  }

  /**
   * Generates a random float between 0 and 1
   * Uses a Linear Congruential Generator (LCG) algorithm
   */
  next(): number {
    // LCG parameters (same as glibc)
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /**
   * Selects a random element from an array
   */
  choice<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error("Cannot choose from empty array");
    }
    const index = Math.floor(this.next() * arr.length);
    return arr[index] as T;
  }

  /**
   * Selects multiple unique random elements from an array
   */
  sample<T>(arr: readonly T[], count: number): T[] {
    if (count > arr.length) {
      throw new Error("Sample size cannot exceed array length");
    }
    const copy = [...arr];
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      const index = Math.floor(this.next() * copy.length);
      result.push(copy[index] as T);
      copy.splice(index, 1);
    }
    return result;
  }

  /**
   * Generates a random integer between min and max (inclusive)
   */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Generates a random float between min and max
   */
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /**
   * Returns true with the given probability (0-1)
   */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /**
   * Shuffles an array in place using Fisher-Yates algorithm
   */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
    }
    return arr;
  }

  /**
   * Generates a UUID-like string (not cryptographically secure)
   */
  uuid(): string {
    const hex = () =>
      Math.floor(this.next() * 16)
        .toString(16)
        .toLowerCase();
    return (
      hex() + hex() + hex() + hex() + hex() + hex() + hex() + hex() + "-" +
      hex() + hex() + hex() + hex() + "-" +
      "4" + hex() + hex() + hex() + "-" +
      ["8", "9", "a", "b"][Math.floor(this.next() * 4)] + hex() + hex() + hex() + "-" +
      hex() + hex() + hex() + hex() + hex() + hex() + hex() + hex() + hex() + hex() + hex() + hex()
    );
  }
}
