import { describe, expect, test } from "vitest";
import { folderCaseNo, profileCaseNo, proposeLinks, type ProfileInput } from "./profile-links.js";
import type { FolderRef } from "./match.js";

const profile = (over: Partial<ProfileInput>): ProfileInput => ({
  localId: "p1",
  mondayId: "m1",
  name: "Mohamed ABADE",
  firstName: "Mohamed",
  lastName: "ABADE",
  caseNo: null,
  eFile: null,
  consultFile: null,
  consultDate: null,
  ...over,
});

let n = 0;
const folder = (site: string, path: string): FolderRef => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  site,
  path,
  webUrl: `https://x/${encodeURIComponent(path)}`,
  id: `id-${++n}`,
});
const efile = (path: string) => folder("scalefiles", path);
const closed = (name: string) => folder("SCALClosed", name);
const consult = (path: string) => folder("scalconsults", path);

describe("folderCaseNo", () => {
  test.each([
    ["ABADE, Mohamed 20-089", "20-089"],
    ["ABDULLAYAR Bek 22016", "22-016"],
    ["ABBURI, Nalini #21-225", "21-225"],
    ["ABURTO HERNANDEZ, Sandra 1243", "1243"],
    ["GARCIA, Ana 2019", null],
    ["GARCIA, Ana", null],
    ["Rafael SORTO (8-3-26)", null],
  ])("%s → %s", (name, expected) => expect(folderCaseNo(name)).toBe(expected));
});

describe("profileCaseNo", () => {
  test.each([
    ["26194", "26-194"],
    ["26-194", "26-194"],
    ["2024-037", "24-037"],
    ["2024020", "24-020"],
    ["1243", "1243"],
    ["2019", null],
    ["15191?", null],
    ["DMS", null],
    ["079547130", null],
    ["", null],
    [null, null],
  ])("%s → %s", (raw, expected) => expect(profileCaseNo(raw)).toBe(expected));
});

describe("proposeLinks — E-File", () => {
  test("case number + surname → high", () => {
    const f = efile("A/ABADE, Mohamed 20-089");
    const [p] = proposeLinks([profile({ caseNo: "20089" })], [f]);
    expect(p).toMatchObject({ column: "e_file", method: "case_no", confidence: "high", folder: f });
  });

  test("case number with a different surname → review, nothing to write", () => {
    const [p] = proposeLinks([profile({ caseNo: "20089" })], [efile("G/GARCIA, Ana 20-089")]);
    expect(p).toMatchObject({ confidence: "review", folder: null });
  });

  test("multi-word folder surname still agrees", () => {
    const f = efile("A/ABDI ESSA, Suad 22-183");
    const [p] = proposeLinks([profile({ firstName: "Suad", lastName: "ABDI", name: "Suad ABDI", caseNo: "22183" })], [f]);
    expect(p).toMatchObject({ confidence: "high", folder: f });
  });

  test("Closed outranks E-Files for the same case", () => {
    const c = closed("ABADE, Mohamed 20-089");
    const [p] = proposeLinks([profile({ caseNo: "20089" })], [efile("A/ABADE, Mohamed 20-089"), c]);
    expect(p).toMatchObject({ confidence: "high", folder: c });
  });

  test("name only → medium", () => {
    const f = efile("A/ABADE, Mohamed");
    const [p] = proposeLinks([profile({})], [f]);
    expect(p).toMatchObject({ method: "name", confidence: "medium", folder: f });
  });

  test("name match but the folder's case number contradicts the profile's → review", () => {
    const [p] = proposeLinks([profile({ caseNo: "25001" })], [efile("A/ABADE, Mohamed 20-089")]);
    expect(p).toMatchObject({ confidence: "review", folder: null });
  });

  test("a filled E-File is never proposed", () => {
    expect(proposeLinks([profile({ caseNo: "20089", eFile: "https://already" })], [efile("A/ABADE, Mohamed 20-089")]))
      .toEqual([]);
  });

  test("one folder claimed by two profiles → both review", () => {
    const f = efile("A/ABADE, Mohamed 20-089");
    const out = proposeLinks(
      [profile({ caseNo: "20089" }), profile({ localId: "p2", mondayId: "m2", firstName: "Amina", name: "Amina ABADE", caseNo: "20089" })],
      [f],
    );
    expect(out.map((o) => o.confidence)).toEqual(["review", "review"]);
  });
});

describe("proposeLinks — copies", () => {
  test("a '(copy)' profile is never proposed, and doesn't block the original", () => {
    const f = consult("2024 Consults/S/SANCHEZ, Orfa");
    const orfa = { firstName: "Orfa", lastName: "SANCHEZ", consultDate: "2024-03-01" };
    const out = proposeLinks(
      [profile({ ...orfa, name: "Orfa SANCHEZ (copy)" }), profile({ ...orfa, localId: "p2", mondayId: "m2", name: "Orfa SANCHEZ" })],
      [f],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ confidence: "high", folder: f, profile: { mondayId: "m2" } });
  });
});

describe("proposeLinks — Consult File", () => {
  test("name + matching year → high, picks that year's folder", () => {
    const old = consult("2021 Consults/A/ABADE, Mohamed");
    const recent = consult("2024 Consults/A/ABADE, Mohamed");
    const [p] = proposeLinks([profile({ consultDate: "2021-05-02" })], [old, recent]);
    expect(p).toMatchObject({ column: "consult_file", method: "name_year", confidence: "high", folder: old });
  });

  test("year off by more than one → review", () => {
    const [p] = proposeLinks([profile({ consultDate: "2019-05-02" })], [consult("2024 Consults/A/ABADE, Mohamed")]);
    expect(p).toMatchObject({ confidence: "review", folder: null });
  });

  test("no consult date → medium", () => {
    const [p] = proposeLinks([profile({})], [consult("2024 Consults/A/ABADE, Mohamed")]);
    expect(p).toMatchObject({ confidence: "medium" });
  });

  test("not proposed for a hired client", () => {
    const out = proposeLinks(
      [profile({ caseNo: "20089", consultDate: "2020-01-10" })],
      [efile("A/ABADE, Mohamed 20-089"), consult("2020 Consults/A/ABADE, Mohamed")],
    );
    expect(out.map((o) => o.column)).toEqual(["e_file"]);
  });

  test("shorter given name is a possible match, never written", () => {
    const [p] = proposeLinks([profile({ firstName: "Mohamed" })], [consult("2024 Consults/A/ABADE, Mohamed Ali")]);
    expect(p).toMatchObject({ confidence: "review", folder: null });
  });
});
