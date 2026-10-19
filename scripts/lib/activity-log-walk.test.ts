import { describe, it, expect } from "vitest";
import { walkActivityLog } from "./activity-log-walk";
import type { ActivityLogEntry } from "../../apps/api/src/webhooks/item-events";

// A fake board log: `count` entries, one every `stepMs` ms back from `start`
// (or `sameMs` of them sharing one millisecond), served like Monday serves it —
// newest first, strictly before `to`, at most `limit`.
function fakeLog(times: number[]) {
  const log: ActivityLogEntry[] = times
    .map((ms, i) => ({ id: `e${i}`, event: "update_column_value", created_at: String(BigInt(ms) * 10_000n + 1234n), user_id: "1", data: "{}" }))
    .sort((a, b) => (BigInt(b.created_at) > BigInt(a.created_at) ? 1 : -1));
  let calls = 0;
  const fetchBefore = (limit: number) => async (to: string) => {
    calls++;
    const cut = Date.parse(to);
    return log.filter((e) => Number(BigInt(e.created_at) / 10_000n) < cut).slice(0, limit);
  };
  return { log, fetchBefore, calls: () => calls };
}

const START = Date.parse("2026-08-10T00:00:00Z");

describe("walkActivityLog", () => {
  it("reads the whole log, however long, each entry once", async () => {
    const f = fakeLog(Array.from({ length: 2_550 }, (_, i) => START - (i + 1) * 60_000));
    const got: string[] = [];
    await walkActivityLog(f.fetchBefore(1000), new Date(START).toISOString(), 1000, (b) => got.push(...b.map((e) => e.id)));
    expect(got).toHaveLength(2_550);
    expect(new Set(got).size).toBe(2_550);
    expect(f.calls()).toBe(3);
  });

  it("entries sharing the boundary millisecond are neither lost nor doubled", async () => {
    // 10 per minute, 4 of them in the same millisecond — page boundaries land inside those.
    const times: number[] = [];
    for (let m = 1; m <= 30; m++) for (let k = 0; k < 10; k++) times.push(START - m * 60_000 - (k < 4 ? 0 : k));
    const f = fakeLog(times);
    const got: string[] = [];
    await walkActivityLog(f.fetchBefore(7), new Date(START).toISOString(), 7, (b) => got.push(...b.map((e) => e.id)));
    expect(new Set(got).size).toBe(300);
    expect(got).toHaveLength(300);
  });

  it("more entries in one millisecond than a page: steps past it, warns, keeps going", async () => {
    const times = [...Array.from({ length: 12 }, () => START - 60_000), ...Array.from({ length: 5 }, (_, i) => START - 120_000 - i)];
    const f = fakeLog(times);
    const got: string[] = [];
    const warnings: string[] = [];
    await walkActivityLog(f.fetchBefore(10), new Date(START).toISOString(), 10, (b) => got.push(...b.map((e) => e.id)), (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);
    expect(got).toHaveLength(15); // 10 of the 12 crowded ones (2 missed, warned) + the 5 older
  });

  it("an empty log is one call", async () => {
    const f = fakeLog([]);
    let batches = 0;
    await walkActivityLog(f.fetchBefore(1000), new Date(START).toISOString(), 1000, () => batches++);
    expect(batches).toBe(0);
    expect(f.calls()).toBe(1);
  });
});
