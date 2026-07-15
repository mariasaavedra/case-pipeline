import { describe, it, expect } from "vitest";
import { parseSharePointLink } from "./parseLink";

// All URLs below are real shapes taken from live.db (names are real client
// folders, so keep them here only — they are already in the synced data).

describe("parseSharePointLink — sharing links", () => {
  it("parses a folder sharing link", () => {
    const url =
      "https://sharmacrawford.sharepoint.com/:f:/s/scalefiles/Et3pGaJSRjdBtLMFaKSfUzkBWcIOmq0RqOCjyZy8UDXoOA?e=INBnkV";
    expect(parseSharePointLink(url)).toEqual({ kind: "sharing", url, site: "scalefiles" });
  });

  it("parses a sharing link on another site", () => {
    const url =
      "https://sharmacrawford.sharepoint.com/:f:/s/clinicefiles/IgBkw37acTHGXo4z-6gUAWSLAeQaw-yacYPEUAviTy0LPWA?e=Gbxnef";
    expect(parseSharePointLink(url)).toMatchObject({ kind: "sharing", site: "clinicefiles" });
  });

  it("still parses a file (:b:) sharing link — the resolved item tells us it is a file", () => {
    const url = "https://sharmacrawford.sharepoint.com/:b:/s/scalefiles/EabcDEF123?e=xyz";
    expect(parseSharePointLink(url)).toMatchObject({ kind: "sharing", site: "scalefiles" });
  });
});

describe("parseSharePointLink — web-UI (AllItems.aspx) links", () => {
  it("pulls site + relative path out of ?id=", () => {
    const url =
      "https://sharmacrawford.sharepoint.com/sites/scalconsults/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fscalconsults%2FShared%20Documents%2F2024%20Consults%2FM%2FMENDOZA%2C%20Aaron&p=true&ga=1";
    expect(parseSharePointLink(url)).toEqual({
      kind: "path",
      host: "sharmacrawford.sharepoint.com",
      sitePath: "/sites/scalconsults",
      relPath: "2024 Consults/M/MENDOZA, Aaron",
      site: "scalconsults",
    });
  });

  it("works when FolderCTID comes before id", () => {
    const url =
      "https://sharmacrawford.sharepoint.com/sites/scalefiles/Shared%20Documents/Forms/AllItems.aspx?FolderCTID=0x012000D36DCF2B75DCFE458B3D9F4E2E8D6709&id=%2Fsites%2Fscalefiles%2FShared%20Documents%2FV%2FVIDES%2C%20Brandon&viewid=746f015b%2Dca8d%2D4c61%2D8b5b%2D8ac1e8ab88c7";
    expect(parseSharePointLink(url)).toMatchObject({
      kind: "path",
      sitePath: "/sites/scalefiles",
      relPath: "V/VIDES, Brandon",
    });
  });

  it("decodes folder names containing & and parentheses", () => {
    const url =
      "https://sharmacrawford.sharepoint.com/sites/scalconsults/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fscalconsults%2FShared%20Documents%2F2026%20Consults%2FA%2FARIAS%2C%20Sandra%20%26%20NARVAEZ%2C%20Cesar%20%28FIFA%20referral%29&viewid=746f015b";
    expect(parseSharePointLink(url)).toMatchObject({
      relPath: "2026 Consults/A/ARIAS, Sandra & NARVAEZ, Cesar (FIFA referral)",
    });
  });

  it("maps a -my.sharepoint.com link whose id points at /sites/ back to the tenant host", () => {
    const url =
      "https://sharmacrawford-my.sharepoint.com/shared?id=%2Fsites%2Fscalconsults%2FShared%20Documents%2F2025%20Consults%2FB%2FBRAVO%2C%20Ana";
    expect(parseSharePointLink(url)).toMatchObject({
      kind: "path",
      host: "sharmacrawford.sharepoint.com",
      sitePath: "/sites/scalconsults",
      relPath: "2025 Consults/B/BRAVO, Ana",
    });
  });

  it("handles a library root (no path below the library)", () => {
    const url =
      "https://sharmacrawford.sharepoint.com/sites/scalefiles/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fscalefiles%2FShared%20Documents";
    expect(parseSharePointLink(url)).toMatchObject({ kind: "path", relPath: "" });
  });
});

describe("parseSharePointLink — rejects what it cannot browse", () => {
  it.each([
    ["", "empty string"],
    ["not a url", "garbage"],
    ["https://example.com/whatever", "non-sharepoint host"],
    ["https://sharmacrawford.sharepoint.com/sites/scalefiles/SitePages/Home.aspx", "no id param"],
  ])("returns null for %s (%s)", (input) => {
    expect(parseSharePointLink(input)).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseSharePointLink(null)).toBeNull();
    expect(parseSharePointLink(undefined)).toBeNull();
    expect(parseSharePointLink(42)).toBeNull();
  });

  // The one link in live.db (of 1350) that doesn't resolve: it has no ?id= —
  // it's a saved *search* over the library (&q=). Returning null is right:
  // the UI falls back to "Open in SharePoint ↗", which preserves the search,
  // instead of dumping the user at the root of every consult folder.
  it("returns null for a library search URL (no id, has q)", () => {
    const url =
      "https://sharmacrawford.sharepoint.com/sites/scalconsults/Shared%20Documents/Forms/AllItems.aspx?FolderCTID=0x012000D36DCF2B75DCFE458B3D9F4E2E8D6709&view=7&q=mora%20calvo&viewid=746f015b";
    expect(parseSharePointLink(url)).toBeNull();
  });
});
