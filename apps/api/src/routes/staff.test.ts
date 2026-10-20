import { describe, expect, test } from "vitest";
import { parseStaffPatch } from "./staff.js";

describe("parseStaffPatch — Slack ID", () => {
  test("takes a member id, uppercased", () => {
    expect(parseStaffPatch({ slackUserId: " u0bendjel75 " })).toEqual({ slackUserId: "U0BENDJEL75" });
  });
  test("refuses a DM channel id", () => {
    expect(parseStaffPatch({ slackUserId: "D0BEZEPS59U" })).toMatch(/starting with U/);
  });
  test("null or empty clears it", () => {
    expect(parseStaffPatch({ slackUserId: null })).toEqual({ slackUserId: null });
    expect(parseStaffPatch({ slackUserId: "" })).toEqual({ slackUserId: null });
  });
});
