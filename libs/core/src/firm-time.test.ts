import { describe, expect, test } from "vitest";
import { firmToUtc, utcToFirm } from "./firm-time";

describe("firm time", () => {
  test("UTC → Central, summer and winter", () => {
    expect(utcToFirm("2026-10-05", "15:00:00")).toEqual({ date: "2026-10-05", time: "10:00" });
    expect(utcToFirm("2026-12-01", "16:30")).toEqual({ date: "2026-12-01", time: "10:30" });
    expect(utcToFirm("2026-10-06", "02:00:00")).toEqual({ date: "2026-10-05", time: "21:00" });
  });

  test("Central → UTC, summer and winter", () => {
    expect(firmToUtc("2026-10-05", "10:00")).toEqual({ date: "2026-10-05", time: "15:00:00" });
    expect(firmToUtc("2026-12-01", "10:30")).toEqual({ date: "2026-12-01", time: "16:30:00" });
    expect(firmToUtc("2026-10-05", "21:00")).toEqual({ date: "2026-10-06", time: "02:00:00" });
  });

  test("round-trips every half hour across the November DST change", () => {
    for (const date of ["2026-10-31", "2026-11-01", "2026-11-02", "2026-03-08"]) {
      for (let h = 3; h < 24; h++) {
        for (const m of ["00", "30"]) {
          const t = `${String(h).padStart(2, "0")}:${m}`;
          const utc = firmToUtc(date, t)!;
          expect(utcToFirm(utc.date, utc.time)).toEqual({ date, time: t });
        }
      }
    }
  });

  test("refuses junk", () => {
    expect(utcToFirm("2026-1-5", "10:00")).toBeNull();
    expect(firmToUtc("2026-10-05", "ten")).toBeNull();
  });
});
