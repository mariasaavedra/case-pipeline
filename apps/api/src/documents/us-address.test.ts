import { describe, it, expect } from "vitest";
import { letterAddress, splitUsAddress } from "./us-address.js";

describe("splitUsAddress", () => {
  it("splits the comma form", () => {
    expect(splitUsAddress("1234 Main St Apt 5, Kansas City, MO 64105")).toEqual({
      line1: "1234 Main St Apt 5", street: "1234 Main St", unitType: "apt", unit: "5", city: "Kansas City", state: "MO", zip: "64105",
    });
  });

  it("splits without a comma before the state", () => {
    expect(splitUsAddress("1234 Main St, Kansas City MO 64105")).toMatchObject({
      street: "1234 Main St", city: "Kansas City", state: "MO", zip: "64105",
    });
  });

  it("finds the city after the street suffix when there are no commas", () => {
    expect(splitUsAddress("5109 NW 18th Terrace Oklahoma City Oklahoma 73127")).toMatchObject({
      street: "5109 NW 18th Terrace", city: "Oklahoma City", state: "OK", zip: "73127",
    });
  });

  it("reads a full state name, ZIP+4 and a trailing country", () => {
    expect(splitUsAddress("12 Oak Dr, Olathe, Kansas 66061-1234, USA")).toMatchObject({
      street: "12 Oak Dr", city: "Olathe", state: "KS", zip: "66061",
    });
  });

  it("reads #, suite and floor units", () => {
    expect(splitUsAddress("400 Elm Ave #12, Topeka, KS 66603")).toMatchObject({ street: "400 Elm Ave", unitType: "apt", unit: "12" });
    expect(splitUsAddress("400 Elm Ave Suite 200, Topeka, KS 66603")).toMatchObject({ unitType: "ste", unit: "200" });
    expect(splitUsAddress("400 Elm Ave Fl 3, Topeka, KS 66603")).toMatchObject({ unitType: "flr", unit: "3" });
  });

  it("finds the city after a unit when there are no commas", () => {
    expect(splitUsAddress("400 Elm Ave Apt 3 Topeka KS 66603")).toMatchObject({
      street: "400 Elm Ave", unit: "3", city: "Topeka", state: "KS",
    });
  });

  it("keeps a street-only line whole", () => {
    expect(splitUsAddress("1234 Main St")).toEqual({ line1: "1234 Main St", street: "1234 Main St", unitType: "", unit: "", city: "", state: "", zip: "" });
  });

  it("does not take a word ending in a state code for a state", () => {
    // "Rd" isn't a state; nothing else to place.
    expect(splitUsAddress("831 Sabalu Rd")).toMatchObject({ street: "831 Sabalu Rd", state: "" });
  });

  it("is empty for nothing", () => {
    expect(splitUsAddress(null).street).toBe("");
    expect(splitUsAddress("   ").street).toBe("");
  });
});

describe("letterAddress (M22 contract: street line + City, ST zip)", () => {
  it.each([
    ["1234 Main St Apt 5, Kansas City, MO 64105", "1234 Main St Apt 5", "Kansas City, MO 64105"],
    ["1234 Main St, Kansas City MO 64105", "1234 Main St", "Kansas City, MO 64105"],
    ["1234 Main St Kansas City Missouri 64105", "1234 Main St", "Kansas City, MO 64105"],
    ["515 Avenida Cesar E. Chavez, Kansas City, MO", "515 Avenida Cesar E. Chavez", "Kansas City, MO"],
    // Real shapes from live.db (2026-10-22).
    ["1018 S.W. JEWELL TOPEKA, KS 66604", "1018 S.W. JEWELL", "TOPEKA, KS 66604"],
    ["4004 W 150th Overland Park KS, 66224", "4004 W 150th", "Overland Park, KS 66224"],
    ["554 Oakland AveKansas City, KS 66101", "554 Oakland Ave", "Kansas City, KS 66101"],
    ["2912 W. 42nd Ave., #3 Kansas City, KS 66103", "2912 W. 42nd Ave #3", "Kansas City, KS 66103"],
    ["1040 Rd V5  lakin Ks 67860", "1040 Rd V5", "Lakin, KS 67860"],
    ["18504 E 5th Terrace N Independence, MO 64056", "18504 E 5th Terrace N", "Independence, MO 64056"],
    ["711 S 15th St St. Joseph, MO 64501", "711 S 15th St", "St. Joseph, MO 64501"],
    ["1719 Gillespie Place KCMO 64106", "1719 Gillespie Place", "Kansas City, MO 64106"],
    ["9100 W 124th Street, Overland Park 66203", "9100 W 124th Street", "Overland Park, KS 66203"],
    ["32825 Switzer Rd., Paola, null 66071", "32825 Switzer Rd", "Paola, KS 66071"],
    ["2201 harper st lawrence 66046 KS", "2201 Harper St", "Lawrence, KS 66046"],
    ["3515 N 39TH ST Kansas City, KS66104", "3515 N 39TH ST", "Kansas City, KS 66104"],
    ["13327 W 88th circle appt C, Lenexa, Kansas - 66215", "13327 W 88th circle appt C", "Lenexa, KS 66215"],
    ["1918 POPLAR AVE., KANSAS CITY, MO 64127 KANSAS CITY, MO 64127", "1918 POPLAR AVE", "KANSAS CITY, MO 64127"],
    ["2418 n 12 st kansas city ks", "2418 N 12 St", "Kansas City, KS"],
  ])("%s", (line, street, cityStateZip) => {
    expect(letterAddress(line)).toEqual({ street, cityStateZip });
  });

  it("keeps a line it can't split whole, for staff to fix", () => {
    expect(letterAddress("1234 Main St")).toEqual({ street: "1234 Main St", cityStateZip: "" });
    expect(letterAddress(null)).toEqual({ street: "", cityStateZip: "" });
    // A bad zip isn't guessed at.
    expect(letterAddress("5201 hadley st mission, KS 662020").cityStateZip).toBe("");
  });
});
