import { describe, test, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import { readDisk, diskLevel, DISK_CRITICAL_GB, DISK_LOW_GB } from "./disk";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Fake a statfs result with `freeGb` available out of `totalGb`. */
function stubDisk(freeGb: number, totalGb = 48) {
  const bsize = 4096;
  vi.spyOn(fs, "statfsSync").mockReturnValue({
    bsize,
    bavail: (freeGb * 1e9) / bsize,
    blocks: (totalGb * 1e9) / bsize,
    bfree: (freeGb * 1e9) / bsize,
    files: 0,
    ffree: 0,
    type: 0,
  } as unknown as ReturnType<typeof fs.statfsSync>);
}

describe("readDisk", () => {
  test("plenty of room reads ok", () => {
    stubDisk(20);
    expect(readDisk("/any").level).toBe("ok");
  });

  test("below the low threshold warns — a sync needs headroom", () => {
    stubDisk(DISK_LOW_GB - 0.5);
    expect(readDisk("/any").level).toBe("low");
  });

  test("below the critical threshold is critical", () => {
    stubDisk(DISK_CRITICAL_GB - 0.5);
    expect(readDisk("/any").level).toBe("critical");
  });

  test("the 2026-08-17 state would have read critical", () => {
    // 48 GB disk, 0 bytes free. The endpoint answered "ok" for a week.
    stubDisk(0);
    const r = readDisk("/any");
    expect(r.level).toBe("critical");
    expect(r.usedPct).toBe(100);
  });

  test("the state right after the incident reads low, not ok", () => {
    stubDisk(2.1);
    expect(readDisk("/any").level).toBe("low");
  });

  test("reports free space and used percentage", () => {
    stubDisk(12, 48);
    const r = readDisk("/any");
    expect(r.freeGb).toBeCloseTo(12, 1);
    expect(r.usedPct).toBe(75);
  });

  test("an unreadable filesystem is 'unknown', never 'ok'", () => {
    vi.spyOn(fs, "statfsSync").mockImplementation(() => {
      throw new Error("ENOSYS");
    });
    expect(readDisk("/any")).toEqual({ level: "unknown", freeGb: null, usedPct: null });
  });
});

describe("diskLevel", () => {
  test("publishes only the level, never the byte counts", () => {
    stubDisk(0.5);
    expect(diskLevel("/any")).toBe("critical");
  });

  test("works against a real path without throwing", () => {
    expect(["ok", "low", "critical", "unknown"]).toContain(diskLevel(os.tmpdir()));
  });
});
