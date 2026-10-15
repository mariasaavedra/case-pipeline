import { describe, it, expect } from "vitest";
import { toUsE164, formatUsPhone, smsSegments, renderSmsTemplate, unfilledPlaceholders, firstNameOf } from "./sms-text";

describe("toUsE164", () => {
  it.each([
    ["(816) 555-1234", "+18165551234"],
    ["816.555.1234", "+18165551234"],
    ["1-816-555-1234", "+18165551234"],
    ["+1 816 555 1234", "+18165551234"],
  ])("%s → %s", (raw, want) => expect(toUsE164(raw)).toBe(want));

  it.each(["", "555-1234", "+52 55 1234 5678", "(016) 555-1234", "816-155-1234"])("refuses %j", (raw) => {
    expect(toUsE164(raw)).toBeNull();
  });

  it("formats for display", () => {
    expect(formatUsPhone("8165551234")).toBe("(816) 555-1234");
    expect(formatUsPhone("abc")).toBe("abc");
  });
});

describe("smsSegments", () => {
  it("plain English up to 160 is one segment", () => {
    expect(smsSegments("a".repeat(160))).toMatchObject({ encoding: "gsm", segments: 1 });
    expect(smsSegments("a".repeat(161))).toMatchObject({ encoding: "gsm", segments: 2, perSegment: 153 });
  });

  it("é and ñ stay GSM; á turns the body unicode", () => {
    expect(smsSegments("Señor José").encoding).toBe("gsm");
    expect(smsSegments("Está bien").encoding).toBe("unicode");
    expect(smsSegments("á" + "a".repeat(70))).toMatchObject({ segments: 2, perSegment: 67 });
  });

  it("extension characters cost two", () => {
    expect(smsSegments("€").units).toBe(2);
  });
});

describe("renderSmsTemplate", () => {
  it("fills and reports what is missing", () => {
    const r = renderSmsTemplate("Hola {{firstName}}, {{ link }} — {{firmName}}", { firstName: "Maria", firmName: " " });
    expect(r.body).toBe("Hola Maria, {{ link }} — {{firmName}}");
    expect(r.missing.sort()).toEqual(["firmName", "link"]);
    expect(unfilledPlaceholders(r.body).sort()).toEqual(["firmName", "link"]);
  });
});

describe("firstNameOf", () => {
  it.each([
    ["Maria Garcia", "Maria"],
    ["GARCIA LOPEZ, Maria Elena", "Maria"],
    ["JOSE PEREZ", "Jose"],
    ["", ""],
  ])("%j → %j", (n, want) => expect(firstNameOf(n)).toBe(want));
});
