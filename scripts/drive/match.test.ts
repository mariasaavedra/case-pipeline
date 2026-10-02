import { describe, expect, test } from "vitest";
import { matchUpload, nameTokens, type AppointmentRow } from "./match.js";
import type { UploadContext } from "./folder-names.js";

const ctx = (over: Partial<UploadContext> = {}): UploadContext => ({
  boardKey: "appointments_m",
  date: "2026-10-02",
  surname: "LOPEZ LEAL",
  given: "Yemil",
  path: [],
  ...over,
});

let n = 0;
const appt = (over: Partial<AppointmentRow> = {}): AppointmentRow => ({
  localId: `a${++n}`,
  mondayItemId: `${n}`,
  boardKey: "appointments_m",
  name: "Yemil LOPEZ LEAL",
  firstName: "Yemil",
  lastName: "Lopez leal",
  consultDate: "2026-10-02",
  profileLocalId: "p1",
  ...over,
});

describe("nameTokens", () => {
  test("drops accents, A-numbers and notes", () => {
    expect(nameTokens("Jesus Alan VILLAVICENCIO MUÑOZ")).toEqual(["JESUS", "ALAN", "VILLAVICENCIO", "MUNOZ"]);
    expect(nameTokens("Juan M. MACIAS ZAPATA [A206-485-453]")).toEqual(["JUAN", "M", "MACIAS", "ZAPATA"]);
    expect(nameTokens("Erika BARRON SERNA (Det in Chase Co)")).toEqual(["ERIKA", "BARRON", "SERNA"]);
    expect(nameTokens("BARRON-TURRUBIARTES")).toEqual(["BARRON", "TURRUBIARTES"]);
  });
});

describe("matchUpload", () => {
  test("same attorney, name and day", () => {
    const a = appt();
    expect(matchUpload(ctx(), [a])).toMatchObject({ kind: "matched", appointment: a, detail: "same day" });
  });

  test("a rescheduled consult still matches, to the nearest appointment", () => {
    // Real case: Drive folder for Oct 02, Monday moved to Oct 06.
    const moved = appt({ consultDate: "2026-10-06" });
    const older = appt({ consultDate: "2026-08-01" });
    expect(matchUpload(ctx(), [older, moved])).toMatchObject({ kind: "matched", appointment: moved });
  });

  test("name from the item name when first/last are blank", () => {
    const a = appt({ firstName: null, lastName: null, name: "Yemil LOPEZ LEAL" });
    expect(matchUpload(ctx(), [a]).kind).toBe("matched");
  });

  test("another attorney's board is not this booking", () => {
    expect(matchUpload(ctx(), [appt({ boardKey: "appointments_lb" })]).kind).toBe("unmatched");
  });

  test("a shared surname alone is not a match", () => {
    expect(matchUpload(ctx(), [appt({ name: "Maria LOPEZ LEAL", firstName: "Maria" })]).kind).toBe("unmatched");
  });

  test("two different people equally close is for a person to decide", () => {
    const a = appt({ profileLocalId: "p1" });
    const b = appt({ profileLocalId: "p2" });
    expect(matchUpload(ctx(), [a, b]).kind).toBe("ambiguous");
  });

  test("two appointments for the SAME profile pick the nearer, no review", () => {
    const near = appt({ consultDate: "2026-10-03" });
    const far = appt({ consultDate: "2026-10-20" });
    expect(matchUpload(ctx(), [far, near])).toMatchObject({ kind: "matched", appointment: near });
  });

  test("outside the window goes to review", () => {
    expect(matchUpload(ctx(), [appt({ consultDate: "2027-01-15" })]).kind).toBe("unmatched");
  });

  test("an appointment with no profile cannot be filed", () => {
    expect(matchUpload(ctx(), [appt({ profileLocalId: null })])).toMatchObject({ kind: "unmatched" });
  });
});
