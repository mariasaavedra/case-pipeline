import { describe, it, expect } from "vitest";
import { normalizeForMatch, buildFolderIndex, findMatch, looseCandidates, type FolderRef } from "./match.js";

const ref = (name: string, site = "SCALClosed"): FolderRef => ({ name, site, path: name });

describe("normalizeForMatch", () => {
  it("makes the comma optional", () => {
    expect(normalizeForMatch("ABDULLAYAR Bek")).toBe(normalizeForMatch("ABDULLAYAR, Bek"));
  });

  it("drops a trailing case number in either style", () => {
    // Real names from SCAL Closed.
    expect(normalizeForMatch("ABBURI, Nalini 21-225")).toBe("ABBURI NALINI");
    expect(normalizeForMatch("ABDULLAYAR Bek 22016")).toBe("ABDULLAYAR BEK");
    expect(normalizeForMatch("ABDI ESSA, Suad 22-183")).toBe("ABDI ESSA SUAD");
  });

  it("strips accents so MUÑOZ meets MUNOZ", () => {
    expect(normalizeForMatch("MUÑOZ, José")).toBe("MUNOZ JOSE");
  });

  it("keeps a number that is part of the name itself", () => {
    expect(normalizeForMatch("EL POTRO 12")).toBe("EL POTRO 12");
  });

  it("does NOT collapse two different people", () => {
    expect(normalizeForMatch("GARCIA, Jose")).not.toBe(normalizeForMatch("GARCIA, Josefa"));
    expect(normalizeForMatch("RODRIGUEZ, Ana")).not.toBe(normalizeForMatch("RODRIGUEZ VAZQUEZ, Ana"));
  });
});

describe("findMatch", () => {
  const index = buildFolderIndex([
    ref("ABBURI, Nalini 21-225"),
    ref("VENTURA CORADO, Milton", "scalefiles"),
  ]);

  it("finds an exact match", () => {
    const { match } = findMatch(index, "VENTURA CORADO, Milton");
    expect(match).toMatchObject({ confidence: "exact", folder: { site: "scalefiles" } });
  });

  it("finds a match through a case number", () => {
    const { match } = findMatch(index, "ABBURI, Nalini");
    expect(match).toMatchObject({ confidence: "normalized", folder: { name: "ABBURI, Nalini 21-225" } });
  });

  it("returns nothing for a client with no folder", () => {
    expect(findMatch(index, "NAGABHUSHAN, Dinesh").match).toBeNull();
  });

  it("follows the lifecycle rather than calling it ambiguous", () => {
    // Same person in Consults and E-Files: they consulted, then hired.
    const progressed = buildFolderIndex([
      { name: "HAMSHARI, Raghad", site: "scalconsults", path: "2025 Consults/H/HAMSHARI, Raghad" },
      { name: "HAMSHARI, Raghad - 20221", site: "scalefiles", path: "H/HAMSHARI, Raghad - 20221" },
    ]);
    const { match, ambiguous } = findMatch(progressed, "HAMSHARI, Raghad");
    expect(ambiguous).toEqual([]);
    expect(match!.folder.site).toBe("scalefiles");
    expect(match!.alsoIn).toHaveLength(1);
  });

  it("prefers Closed over E-Files over Consults", () => {
    const all = buildFolderIndex([
      { name: "LEON ALVARADO, Lucia", site: "scalconsults", path: "2024 Consults/L/LEON ALVARADO, Lucia" },
      { name: "LEON ALVARADO, Lucia 22-238", site: "scalefiles", path: "L/LEON ALVARADO, Lucia 22-238" },
      { name: "LEON ALVARADO, Lucia", site: "SCALClosed", path: "LEON ALVARADO, Lucia" },
    ]);
    expect(findMatch(all, "LEON ALVARADO, Lucia").match!.folder.site).toBe("SCALClosed");
  });

  it("takes the most recent year for a repeat consult", () => {
    const repeat = buildFolderIndex([
      { name: "MUHETAER, Nuerbiye", site: "scalconsults", path: "2025 Consults/M/MUHETAER, Nuerbiye" },
      { name: "MUHETAER, Nuerbiye", site: "scalconsults", path: "2026 Consults/M/MUHETAER, Nuerbiye" },
    ]);
    const { match } = findMatch(repeat, "MUHETAER, Nuerbiye");
    expect(match!.folder.path).toBe("2026 Consults/M/MUHETAER, Nuerbiye");
  });

  it("still refuses two different people in the same folder", () => {
    const collision = buildFolderIndex([
      { name: "GARCIA, Jose", site: "SCALClosed", path: "GARCIA, Jose" },
      { name: "GARCIA Jose", site: "SCALClosed", path: "GARCIA Jose" },
    ]);
    const { match, ambiguous } = findMatch(collision, "GARCIA, Jose");
    expect(match).toBeNull();
    expect(ambiguous).toHaveLength(2);
  });
});

describe("looseCandidates — truncated given names", () => {
  // Monday's First Name column is often the short form of what is on the folder.
  // Missing these created 22 duplicate folders on 2026-09-03, several sitting
  // directly beside the real one in the same initial folder.
  const index = buildFolderIndex([
    { name: "AGUILERA AGUILERA, Sindy Sarahi", site: "scalconsults", path: "2025 Consults/A/AGUILERA AGUILERA, Sindy Sarahi" },
    { name: "SARABIA, Jose Juan", site: "SCALClosed", path: "SARABIA, Jose Juan" },
    { name: "GARCIA, Josefa", site: "SCALClosed", path: "GARCIA, Josefa" },
    { name: "SOLIS, Gloria for Alva CASTRO", site: "scalconsults", path: "2020 Consults/S/SOLIS, Gloria for Alva CASTRO" },
  ]);

  it("catches the short form of a given name", () => {
    expect(looseCandidates(index, "AGUILERA AGUILERA, Sindy").map((f) => f.name)).toEqual([
      "AGUILERA AGUILERA, Sindy Sarahi",
    ]);
  });

  it("catches it across sites", () => {
    expect(looseCandidates(index, "SARABIA, Jose").map((f) => f.site)).toEqual(["SCALClosed"]);
  });

  it("does NOT treat a different name as a truncation", () => {
    // "Jose" must not match "Josefa" — different people, and the surname is shared.
    expect(looseCandidates(index, "GARCIA, Jose")).toEqual([]);
  });

  it("requires the surname to match exactly", () => {
    expect(looseCandidates(index, "AGUILERA, Sindy")).toEqual([]);
  });

  it("finds a folder whose name carries a trailing annotation", () => {
    expect(looseCandidates(index, "SOLIS, Gloria")).toHaveLength(1);
  });

  it("returns nothing when the exact folder is already there", () => {
    // An exact hit is findMatch's job; loose must not double-report it.
    expect(looseCandidates(index, "SARABIA, Jose Juan")).toEqual([]);
  });
});
