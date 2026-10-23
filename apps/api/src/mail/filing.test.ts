import { describe, expect, it } from "vitest";
import { emptyFields } from "@case-pipeline/query";
import { linkUrl, mailFiledNote, mailSummary, parseFileMailInput } from "./filing.js";

const savedTo = { url: "https://sharmacrawford.sharepoint.com/sites/scalefiles/x/CC/a.pdf", fileName: "a.pdf", folder: "E-File → CC" };

describe("parseFileMailInput", () => {
  it("needs a client and a SharePoint location; e-mail and note optional", () => {
    expect(parseFileMailInput({ savedTo })).toEqual({ error: "Pick the client" });
    expect(parseFileMailInput({ profileLocalId: "p1", savedTo: { ...savedTo, url: "http://sharmacrawford.sharepoint.com/a" } }))
      .toHaveProperty("error");
    expect(parseFileMailInput({ profileLocalId: "p1", savedTo, emailedTo: "x" })).toHaveProperty("error");
    expect(parseFileMailInput({ profileLocalId: " p1 ", savedTo, emailedTo: "", note: "  " })).toEqual({
      profileLocalId: "p1", openFormLocalId: null, savedTo, emailedTo: null, note: null,
    });
  });
});

describe("mailFiledNote", () => {
  const fields = { ...emptyFields(), noticeType: "Receipt Notice", caseType: "I130 - PETITION", receiptNumbers: ["IOE0911111111"], noticeDate: "2026-10-20" };

  it("says what came, where it is, whether the client was e-mailed", () => {
    expect(mailSummary(fields)).toBe("Receipt Notice · I130 - PETITION · Receipt IOE0911111111 · dated 2026-10-20");
    const html = mailFiledNote({ fields, input: { profileLocalId: "p1", openFormLocalId: "f1", savedTo, emailedTo: "a@b.co", note: "Call <her>\nsoon" }, openFormName: "Juan I-130" });
    expect(html).toContain("Open Form “Juan I-130”");
    expect(html).toContain(`<a href="${savedTo.url}">a.pdf</a>`);
    expect(html).toContain("E-mailed to the client at a@b.co");
    expect(html).toContain("Call &lt;her&gt;<br>soon");
  });

  it("an unread letter is still a letter", () => {
    const html = mailFiledNote({ fields: emptyFields(), input: { profileLocalId: "p1", openFormLocalId: null, savedTo, emailedTo: null, note: null }, openFormName: null });
    expect(html).toContain("<strong>Letter</strong>");
    expect(html).toContain("not e-mailed");
  });
});

describe("linkUrl", () => {
  it("reads a link column either way it's stored", () => {
    expect(linkUrl("https://a.sharepoint.com/x")).toBe("https://a.sharepoint.com/x");
    expect(linkUrl({ url: "https://a/x", text: "x" })).toBe("https://a/x");
    expect(linkUrl("not a link")).toBeNull();
    expect(linkUrl(null)).toBeNull();
  });
});
