import { afterEach, describe, expect, it } from "vitest";
import { drainMondayCallCounts, recordMondayCall, setDefaultMondayJob, withMondayJob } from "./usage";

afterEach(() => {
  drainMondayCallCounts();
  setDefaultMondayJob("app");
});

describe("Monday call counter", () => {
  it("counts under the default job, per UTC day", () => {
    recordMondayCall(new Date("2026-10-14T23:59:00Z"));
    recordMondayCall(new Date("2026-10-15T00:01:00Z")); // 7:01 pm Central = next Monday day
    recordMondayCall(new Date("2026-10-15T05:00:00Z"));
    expect(drainMondayCallCounts()).toEqual([
      { day: "2026-10-14", job: "app", calls: 1 },
      { day: "2026-10-15", job: "app", calls: 2 },
    ]);
  });

  it("follows withMondayJob across awaits, and leaves the default outside it", async () => {
    const at = new Date("2026-10-14T12:00:00Z");
    await withMondayJob("fee-k-autofill", async () => {
      recordMondayCall(at);
      await new Promise((r) => setTimeout(r, 1));
      recordMondayCall(at);
    });
    recordMondayCall(at);
    expect(drainMondayCallCounts()).toEqual([
      { day: "2026-10-14", job: "fee-k-autofill", calls: 2 },
      { day: "2026-10-14", job: "app", calls: 1 },
    ]);
  });

  it("uses the process default (the sync child sets sync:<mode>)", () => {
    setDefaultMondayJob("sync:full");
    recordMondayCall(new Date("2026-10-14T01:00:00Z"));
    expect(drainMondayCallCounts()).toEqual([{ day: "2026-10-14", job: "sync:full", calls: 1 }]);
  });

  it("drain resets the counts", () => {
    recordMondayCall();
    expect(drainMondayCallCounts()).toHaveLength(1);
    expect(drainMondayCallCounts()).toEqual([]);
  });
});
