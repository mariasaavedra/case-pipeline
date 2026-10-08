import { describe, expect, it } from "vitest";
import { columnDecision, driveFolderIdOf, driveFolderUrl, newestPerAppointment } from "./folder-links";

const ID = "1AbCdEfGhIjKlMnOpQrStUv";
const OLD = "1OldOldOldOldOldOldOldOl";

describe("driveFolderIdOf", () => {
  it("reads the id from the usual link shapes", () => {
    expect(driveFolderIdOf(driveFolderUrl(ID))).toBe(ID);
    expect(driveFolderIdOf(`https://drive.google.com/drive/u/0/folders/${ID}?usp=sharing`)).toBe(ID);
    expect(driveFolderIdOf(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
  });
  it("is null for anything else", () => {
    expect(driveFolderIdOf(null)).toBeNull();
    expect(driveFolderIdOf("ask Maria")).toBeNull();
    expect(driveFolderIdOf("https://sharmacrawford.sharepoint.com/:f:/s/x/abc")).toBeNull();
  });
});

describe("newestPerAppointment", () => {
  it("keeps the newest folder per appointment (a reschedule makes a new one)", () => {
    const picked = newestPerAppointment([
      { id: "a1", createdTime: "2026-10-01T10:00:00Z", appointmentLocalId: "A" },
      { id: "a2", createdTime: "2026-10-03T09:00:00Z", appointmentLocalId: "A" },
      { id: "b1", createdTime: "2026-10-02T09:00:00Z", appointmentLocalId: "B" },
    ]);
    expect(picked.get("A")!.id).toBe("a2");
    expect(picked.get("B")!.id).toBe("b1");
  });
});

describe("columnDecision", () => {
  it("writes an empty column", () => {
    expect(columnDecision(null, ID, new Set())).toBe("write");
    expect(columnDecision("  ", ID, new Set())).toBe("write");
  });
  it("leaves the same folder alone, whatever the link's shape", () => {
    expect(columnDecision(`https://drive.google.com/drive/folders/${ID}?usp=drive_link`, ID, new Set())).toBe("already-set");
  });
  it("replaces an earlier booking's folder", () => {
    expect(columnDecision(driveFolderUrl(OLD), ID, new Set([OLD]))).toBe("write");
  });
  it("never replaces a link someone else put there", () => {
    expect(columnDecision(driveFolderUrl(OLD), ID, new Set())).toBe("other-link-kept");
    expect(columnDecision("see email", ID, new Set([OLD]))).toBe("other-link-kept");
  });
});
