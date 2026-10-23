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

describe("consultFolderName — from the profile title (jail-intake profiles)", () => {
  const titled = (itemName: string) => consultFolderName({ firstName: null, lastName: "", itemName });

  it("splits Given SURNAME when First / Last are both empty", () => {
    // Real titles the sweep skipped on 2026-10-22.
    expect(titled("Gerbert Yoalmo BERMUDEZ-PAZ")).toMatchObject({
      ok: true, fromTitle: true, name: { folder: "BERMUDEZ-PAZ, Gerbert Yoalmo", initial: "B" },
    });
    expect(titled("DETAINED Fidencio MERCADO")).toMatchObject({ ok: true, name: { folder: "MERCADO, Fidencio" } });
    expect(titled("Bobb Marlon MARTINEZ JIMENEZ")).toMatchObject({ ok: true, name: { folder: "MARTINEZ JIMENEZ, Bobb Marlon" } });
    expect(titled("Gilberto DE JESUS GARCIA [Det Core Civic][A220-099-183]")).toMatchObject({
      ok: true, name: { folder: "DE JESUS GARCIA, Gilberto" },
    });
  });

  it("drops brackets, an unclosed aside and a stray A-number", () => {
    expect(titled("Pedro RECINOS RECINOS  (Det in Greene Co)[A222-597-888]")).toMatchObject({
      ok: true, name: { folder: "RECINOS RECINOS, Pedro" },
    });
    expect(titled("Isaac GONZALEZ MOLINA A214-099-391 [DETAINED IN CHASE]")).toMatchObject({
      ok: true, name: { folder: "GONZALEZ MOLINA, Isaac" },
    });
    expect(titled("Celso VERA CAMPOS (Det Chase County")).toMatchObject({ ok: true, name: { folder: "VERA CAMPOS, Celso" } });
  });

  it("keeps a single capital as an initial of the given name", () => {
    expect(titled("Kong Bun B LY")).toMatchObject({ ok: true, name: { folder: "LY, Kong Bun B" } });
    expect(titled("Juan C. CECENAS GARCIA")).toMatchObject({ ok: true, name: { folder: "CECENAS GARCIA, Juan C." } });
  });

  it("refuses a title that doesn't read Given SURNAME", () => {
    for (const t of [
      "Mogtabi Azrag (Detained at Core Civic) A212-666-597", // no capitalised surname
      "MUHAMMAD YAKAWU", // all capitals: which is the surname?
      "DETAINED Yessica Marisol Peña Olivas",
      "Juan CARLOS Perez SMITH", // capitals inside the given name
      "Maria de la CRUZ", // a particle belongs to the surname
      "Esmeralda CANO - Jesus I. MERAZ MARTINEZ", // two people
      "Adriana PENALOZA + Edith PENALOZA",
      "[A221-455-213]",
    ]) {
      expect(titled(t), t).toMatchObject({ ok: false, reason: "missing-first-name" });
    }
  });

  it("never overrides a First / Last Name someone filled in", () => {
    expect(consultFolderName({ firstName: "Milton", lastName: "Ventura", itemName: "Somebody ELSE" })).toMatchObject({
      ok: true, name: { folder: "VENTURA, Milton" },
    });
    expect(consultFolderName({ firstName: "Milton", lastName: "Ventura" })).not.toHaveProperty("fromTitle");
    // Only one of the two filled = still a human's call, not the title's.
    expect(consultFolderName({ firstName: "", lastName: "Ventura", itemName: "Milton VENTURA" })).toMatchObject({
      ok: false, reason: "missing-first-name",
    });
  });
});

describe("consultFolderPath", () => {
  it("builds the three-level path", () => {
    const result = consultFolderName({ firstName: "Milton", lastName: "Ventura" });
    if (!result.ok) throw new Error("expected a name");
    expect(consultFolderPath(2026, result.name)).toBe("2026 Consults/V/VENTURA, Milton");
  });
});
