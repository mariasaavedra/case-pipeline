import { describe, it, expect } from "vitest";
import { collectClientFolders } from "./collectFolders";

const EFILE = "https://sharmacrawford.sharepoint.com/:f:/s/scalefiles/EtAAA1?e=a";
const CONSULT = "https://sharmacrawford.sharepoint.com/:f:/s/scalconsults/EtBBB2?e=b";
const CLOSED = "https://sharmacrawford.sharepoint.com/:f:/s/SCALClosed/EtCCC3?e=c";
const SEARCH =
  "https://sharmacrawford.sharepoint.com/sites/scalconsults/Shared%20Documents/Forms/AllItems.aspx?q=mora";

describe("collectClientFolders", () => {
  it("returns [] for a client with no folders", () => {
    expect(collectClientFolders({ profile: { eFile: null }, boardItems: {} })).toEqual([]);
    expect(collectClientFolders({})).toEqual([]);
  });

  it("takes the profile's own e_file and labels it by site", () => {
    const out = collectClientFolders({ profile: { eFile: EFILE }, boardItems: {} });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: "e-file", site: "scalefiles", url: EFILE });
    expect(out[0]!.parsed).toMatchObject({ kind: "sharing" });
  });

  it("also collects e_file/consult mirrored on board items", () => {
    const out = collectClientFolders({
      profile: { eFile: EFILE },
      boardItems: {
        _cd_open_forms: [{ columnValues: { consult: CONSULT } }],
        court_cases: [{ columnValues: { e_file: CLOSED } }],
      },
    });
    expect(out.map((f) => f.label)).toEqual(["e-file", "Consult", "Archived"]);
  });

  it("de-duplicates the same folder repeated across many board items", () => {
    const out = collectClientFolders({
      profile: { eFile: EFILE },
      boardItems: {
        a: [{ columnValues: { e_file: EFILE } }, { columnValues: { e_file: EFILE } }],
        b: [{ columnValues: { e_file: EFILE } }],
      },
    });
    expect(out).toHaveLength(1);
  });

  it("keeps a non-browsable SharePoint link but marks parsed=null (UI shows an external link)", () => {
    const out = collectClientFolders({ profile: { eFile: SEARCH }, boardItems: {} });
    expect(out).toHaveLength(1);
    expect(out[0]!.parsed).toBeNull();
    expect(out[0]!.url).toBe(SEARCH);
  });

  it("ignores values that are not SharePoint links at all", () => {
    const out = collectClientFolders({
      profile: { eFile: "N/A" },
      boardItems: { a: [{ columnValues: { e_file: "https://example.com/x" } }] },
    });
    expect(out).toEqual([]);
  });

  // Real case from live.db: a client with two different e-file links on the same
  // site would otherwise render as two identical "e-file" rows.
  it("numbers repeated labels so identical-looking folders stay distinguishable", () => {
    const other = "https://sharmacrawford.sharepoint.com/:f:/s/scalefiles/EtZZZ9?e=z";
    const out = collectClientFolders({
      profile: { eFile: EFILE },
      boardItems: { a: [{ columnValues: { e_file: other } }] },
    });
    expect(out.map((f) => f.label)).toEqual(["e-file (1)", "e-file (2)"]);
  });

  it("leaves a unique label untouched", () => {
    const out = collectClientFolders({ profile: { eFile: EFILE, consultFile: CONSULT } });
    expect(out.map((f) => f.label)).toEqual(["e-file", "Consult"]);
  });

  it("tolerates missing columnValues / empty strings", () => {
    const out = collectClientFolders({
      profile: { eFile: "   " },
      boardItems: { a: [{}, { columnValues: {} }] },
    });
    expect(out).toEqual([]);
  });
});
