import { describe, it, expect } from "vitest";
import { DEFAULT_CONSULT_LISTS, sanitizeConsultLists } from "./consult-lists.js";

describe("consult lists", () => {
  it("the starting lists survive the sanitizer, in both languages", () => {
    expect(sanitizeConsultLists(DEFAULT_CONSULT_LISTS)).toEqual(DEFAULT_CONSULT_LISTS);
    for (const l of DEFAULT_CONSULT_LISTS) expect(l.documents.every((d) => d.es && d.es !== d.en), l.key).toBe(true);
  });

  it("needs a name and a document; keys are made from the name and kept unique", () => {
    expect(sanitizeConsultLists([
      { name: "Consult – Asylum", documents: [{ en: "ID" }] },
      { name: "Consult – asylum!", documents: [{ en: "Passport" }] },
      { name: "", documents: [{ en: "ID" }] },
      { name: "Empty", documents: [] },
      { key: "keep-me", name: "Renamed", documents: [{ en: "ID" }] },
    ]).map((l) => [l.key, l.name])).toEqual([
      ["consult-asylum", "Consult – Asylum"],
      ["consult-asylum-2", "Consult – asylum!"],
      ["keep-me", "Renamed"],
    ]);
  });
});
