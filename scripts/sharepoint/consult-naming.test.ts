import { describe, it, expect } from "vitest";
import { consultFolderName, consultFolderPath } from "./consult-naming.js";

const name = (firstName: string | null, lastName: string | null) =>
  consultFolderName({ firstName, lastName });

describe("consultFolderName", () => {
  it("matches the folders the old automation produced", () => {
    // Verbatim from live SharePoint paths in the Consult File column.
    expect(name("Milton", "Ventura")).toMatchObject({ ok: true, name: { folder: "VENTURA, Milton" } });
    expect(name("Montserrat", "JIMENEZ MONTES DE OCA")).toMatchObject({
      ok: true,
      name: { folder: "JIMENEZ MONTES DE OCA, Montserrat", initial: "J" },
    });
    // Given name casing is preserved as typed — "SERRANO, annifesof" is real.
    expect(name("annifesof", "Serrano")).toMatchObject({ ok: true, name: { folder: "SERRANO, annifesof" } });
  });

  it("strips the notes people park in the Last Name column", () => {
    const result = name("Milton", "Ventura Corado [A221-455-213] (Det In Core Civic)");
    expect(result).toMatchObject({ ok: true, name: { folder: "VENTURA CORADO, Milton", initial: "V" } });
  });

  it("keeps hyphens, apostrophes and accents", () => {
    expect(name("Ana", "Garcia-Lopez")).toMatchObject({ ok: true, name: { folder: "GARCIA-LOPEZ, Ana" } });
    expect(name("Sean", "O'Brien")).toMatchObject({ ok: true, name: { folder: "O'BRIEN, Sean" } });
    expect(name("José", "Muñoz")).toMatchObject({ ok: true, name: { folder: "MUÑOZ, José", initial: "M" } });
  });

  it("refuses rather than guessing when a name is missing", () => {
    expect(name("", "Serrano")).toMatchObject({ ok: false, reason: "missing-first-name" });
    expect(name("Ana", null)).toMatchObject({ ok: false, reason: "missing-last-name" });
    expect(name("Ana", "   ")).toMatchObject({ ok: false, reason: "missing-last-name" });
  });

  it("refuses a surname that is not a name", () => {
    // Everything meaningful was inside the brackets — what's left is an A-number.
    expect(name("Ana", "A221-455-213")).toMatchObject({ ok: false, reason: "surname-not-alphabetic" });
    expect(name("Ana", "Lopez + Rene Figueroa")).toMatchObject({ ok: false, reason: "surname-not-alphabetic" });
  });

  it("refuses a reversed entry rather than building a backwards folder", () => {
    // Real profile: the Name column reads "RAKHIMOV, SHUKHRAT", so the split
    // columns end up holding the surname in First Name, comma and all.
    expect(name("RAKHIMOV,", "SHUKHRAT")).toMatchObject({ reason: "given-name-looks-reversed" });
  });

  it("still accepts a given name with an initial or a hyphen", () => {
    expect(name("Jose R", "RANGEL OLIVA")).toMatchObject({ ok: true });
    expect(name("Mary-Jane", "SMITH")).toMatchObject({ ok: true });
  });

  it("refuses a name SharePoint would reject", () => {
    expect(name("Ana", "Lopez/Cruz")).toMatchObject({ ok: false, reason: "surname-not-alphabetic" });
  });
});

describe("consultFolderPath", () => {
  it("builds the three-level path", () => {
    const result = consultFolderName({ firstName: "Milton", lastName: "Ventura" });
    if (!result.ok) throw new Error("expected a name");
    expect(consultFolderPath(2026, result.name)).toBe("2026 Consults/V/VENTURA, Milton");
  });
});
