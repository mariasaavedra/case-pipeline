import { describe, expect, test } from "vitest";
import { parseAttorneyFolder, parseDayFolder, parseSlotFolder, parseUploadFolder, readContext } from "./folder-names.js";

// Names as the Zapier automation writes them, taken from the live tree (Oct 2026).

describe("folder names", () => {
  test("day", () => {
    expect(parseDayFolder("October 02, 2026")).toBe("2026-10-02");
    expect(parseDayFolder("September 25, 2023")).toBe("2023-09-25");
    expect(parseDayFolder("OCTOBER")).toBeNull();
    expect(parseDayFolder("Smarch 02, 2026")).toBeNull();
  });

  test("attorney", () => {
    expect(parseAttorneyFolder("M")).toBe("m");
    expect(parseAttorneyFolder("CR")).toBe("cr");
    expect(parseAttorneyFolder("10:00 LOPEZ LEAL, Yemil")).toBeNull();
  });

  test("slot: surname with a space stays whole", () => {
    expect(parseSlotFolder("10:00 LOPEZ LEAL, Yemil")).toEqual({ time: "10:00", surname: "LOPEZ LEAL", given: "Yemil" });
    expect(parseSlotFolder("01:30 VILLAVICENCIO MUÑOZ, Jesus Alan")).toEqual({
      time: "01:30",
      surname: "VILLAVICENCIO MUÑOZ",
      given: "Jesus Alan",
    });
  });

  test("upload folder", () => {
    expect(parseUploadFolder("Consult Documents Yemil LOPEZ LEAL - October 02, 2026 at 10:00")).toEqual({
      fullName: "Yemil LOPEZ LEAL",
      date: "2026-10-02",
      time: "10:00",
    });
    expect(parseUploadFolder("Consult Documents Julian BARRON-TURRUBIARTES - October 12, 2026 at 03:30")?.date).toBe("2026-10-12");
  });
});

describe("readContext", () => {
  const branch = [
    "OCTOBER",
    "October 02, 2026",
    "M",
    "10:00 LOPEZ LEAL, Yemil",
    "Consult Documents Yemil LOPEZ LEAL - October 02, 2026 at 10:00",
  ];

  test("a client upload", () => {
    const r = readContext(branch);
    expect(r.ok && r.context).toMatchObject({ boardKey: "appointments_m", date: "2026-10-02", surname: "LOPEZ LEAL", given: "Yemil" });
  });

  test("blank given name in the slot: taken from the upload folder", () => {
    // Most October 2026 slot folders look like this.
    const r = readContext([
      "OCTOBER",
      "October 06, 2026",
      "LB",
      "03:00 ESPARZA REYES, ",
      "Consult Documents Luis Angel ESPARZA REYES - October 06, 2026 at 03:00",
    ]);
    expect(r.ok && r.context).toMatchObject({ boardKey: "appointments_lb", surname: "ESPARZA REYES", given: "Luis Angel" });
  });

  test("no slot name at all: SURNAME is the capitals in the upload folder", () => {
    const r = readContext([
      "OCTOBER",
      "October 20, 2026",
      "LB",
      "garbage",
      "Consult Documents Carlos o GONZÀLEZ - October 20, 2026 at 03:00",
    ]);
    expect(r.ok && r.context).toMatchObject({ surname: "GONZÀLEZ", given: "Carlos o" });
  });

  test("blank given name and nothing below it is left for a person", () => {
    expect(readContext(["OCTOBER", "October 06, 2026", "LB", "03:00 ESPARZA REYES, "])).toMatchObject({ ok: false });
  });

  test("a file dropped in the slot folder still has a client", () => {
    expect(readContext(branch.slice(0, 4)).ok).toBe(true);
  });

  test("a file loose in a day or the root is not guessed at", () => {
    expect(readContext(["OCTOBER", "October 02, 2026"])).toMatchObject({ ok: false, reason: "not inside a client folder" });
    expect(readContext([])).toMatchObject({ ok: false });
  });

  test("an unrecognised attorney folder is refused", () => {
    expect(readContext(["OCTOBER", "October 02, 2026", "Misc stuff", "10:00 LOPEZ LEAL, Yemil"]).ok).toBe(false);
  });
});
