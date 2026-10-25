import { describe, it, expect } from "vitest";
import { seriesOf, refuseReason, newestPerSeries, remoteToPrune, chunkRanges, UPLOAD_CHUNK } from "./offsite-backups.js";

const LIVE_1 = "live-2026-10-23T10-30-00-000Z.db.enc";
const LIVE_2 = "live-2026-10-24T10-30-00-000Z.db.enc";
const USERS_1 = "users-2026-10-23T10-30-00-000Z.db.enc";
const USERS_2 = "users-2026-10-24T10-30-00-000Z.db.enc";

describe("offsite backups", () => {
  it("recognises the two daily series and nothing else", () => {
    expect(seriesOf(LIVE_1)).toBe("live");
    expect(seriesOf(USERS_1)).toBe("users");
    expect(seriesOf("live-premigrate-v30-2026-10-09T14-09-07-337Z.db.enc")).toBeNull();
    expect(seriesOf("live-presync-2026-10-24.db.enc")).toBeNull();
    expect(seriesOf("notes.txt")).toBeNull();
  });

  it("refuses to upload an unencrypted backup", () => {
    expect(refuseReason("live-2026-10-24T10-30-00-000Z.db")).toMatch(/not an encrypted backup/);
    expect(refuseReason(LIVE_2)).toBeNull();
  });

  it("picks the newest file of each series", () => {
    const names = [LIVE_2, USERS_1, "live-2026-10-24T10-30-00-000Z.db", LIVE_1, USERS_2, "live-premigrate-v31-2026-10-25.db.enc"];
    expect(newestPerSeries(names)).toEqual({ live: LIVE_2, users: USERS_2 });
  });

  it("prunes each series to its newest copies and leaves other files alone", () => {
    const names = [LIVE_1, LIVE_2, "live-2026-10-25T10-30-00-000Z.db.enc", USERS_1, USERS_2, "README.txt"];
    expect(remoteToPrune(names, 2)).toEqual([LIVE_1]);
    expect(remoteToPrune(names, 1)).toEqual([LIVE_1, LIVE_2, USERS_1]);
    // A keep of 0 would delete the copy just uploaded.
    expect(remoteToPrune([LIVE_1], 0)).toEqual([]);
  });

  it("splits a file into 320 KiB-aligned chunks that cover every byte once", () => {
    expect(UPLOAD_CHUNK % (320 * 1024)).toBe(0);
    const size = UPLOAD_CHUNK * 2 + 5;
    expect(chunkRanges(size)).toEqual([[0, UPLOAD_CHUNK], [UPLOAD_CHUNK, UPLOAD_CHUNK * 2], [UPLOAD_CHUNK * 2, size]]);
    expect(chunkRanges(0)).toEqual([]);
  });
});
