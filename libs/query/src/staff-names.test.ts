import { describe, test, expect } from "vitest";
import { makeStaffNames, spellingsOf } from "./staff-names";
import { testResolver } from "./staff-names.fixture";

describe("makeStaffNames", () => {
  test("maps spellings to the roster name, keeps unknown names, lists the inactive", () => {
    const names = makeStaffNames(testResolver);
    expect(names.list(["mayra ruiz ", "Mayra R.", "Ana Reyes", " Someone New"])).toEqual(["Mayra Ruiz", "Ana Reyes", "Someone New"]);
    expect(names.cell("Mayra R., ana reyes")).toBe("Mayra Ruiz, Ana Reyes");
    expect(names.cell("  ")).toBeNull();
    expect(names.cell(null)).toBeNull();
    expect(names.inactive()).toEqual(["Mayra Ruiz"]);
  });

  test("without a resolver it only trims", () => {
    const names = makeStaffNames();
    expect(names.list([" Mayra R.", "Mayra R."])).toEqual(["Mayra R."]);
    expect(names.inactive()).toEqual([]);
  });
});

describe("spellingsOf", () => {
  test("every board spelling of the same person, plus the name itself", () => {
    expect(spellingsOf("Mayra Ruiz", ["Mayra R.", "mayra ruiz", "Ana Reyes"], testResolver).sort()).toEqual(
      ["Mayra R.", "Mayra Ruiz", "mayra ruiz"],
    );
    expect(spellingsOf("Unknown", ["Ana Reyes"], testResolver)).toEqual(["Unknown"]);
  });
});
