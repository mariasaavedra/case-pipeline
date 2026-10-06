import { describe, it, expect } from "vitest";
import { splitUsAddress } from "./us-address.js";

describe("splitUsAddress", () => {
  it("splits the comma form", () => {
    expect(splitUsAddress("1234 Main St Apt 5, Kansas City, MO 64105")).toEqual({
      street: "1234 Main St", unitType: "apt", unit: "5", city: "Kansas City", state: "MO", zip: "64105",
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
    expect(splitUsAddress("1234 Main St")).toEqual({ street: "1234 Main St", unitType: "", unit: "", city: "", state: "", zip: "" });
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
