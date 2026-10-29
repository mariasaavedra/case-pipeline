import { describe, it, expect } from "vitest";
import { parseSmsSendBody, smsActivity, SMS_BODY_MAX } from "./send-plan.js";
import { sanitizeSmsTemplates, withRequiredTemplates, DEFAULT_SMS_TEMPLATES } from "./templates.js";

describe("withRequiredTemplates", () => {
  it("a saved list without the Upload link template gets it back; a reworded one is kept", () => {
    const saved = [{ key: "consult_link", label: "Consult", en: "Book: {{link}}", es: "" }];
    expect(withRequiredTemplates(saved).map((t) => t.key)).toEqual(["consult_link", "upload_link", "buzon_link", "buzon_reminder", "buzon_received", "ivr_scheduling_link"]);
    const reworded = DEFAULT_SMS_TEMPLATES.filter((t) => t.key !== "consult_link" && t.key !== "payment_links")
      .map((t) => (t.key === "upload_link" ? { ...t, label: "Docs", en: "Send: {{uploadLink}}", es: "" } : t));
    expect(withRequiredTemplates(reworded)).toEqual(reworded);
  });
  it("the upload link and Buzón texts carry the link (where they need it) and opt-out words", () => {
    for (const key of ["upload_link", "buzon_link", "buzon_reminder", "buzon_received"]) {
      const t = DEFAULT_SMS_TEMPLATES.find((x) => x.key === key)!;
      for (const text of [t.en, t.es]) {
        if (key !== "buzon_received") expect(text, key).toContain("{{uploadLink}}");
        expect(text, key).toMatch(/STOP/);
      }
    }
  });
  it("the phone menu text has the link written in and needs no first name", () => {
    const t = DEFAULT_SMS_TEMPLATES.find((x) => x.key === "ivr_scheduling_link")!;
    for (const text of [t.en, t.es]) {
      expect(text).not.toContain("{{firstName}}");
      expect(text).not.toContain("{{link}}");
      expect(text).toContain("https://sharma-crawford.com/schedule-a-consultation/");
      expect(text).toMatch(/STOP/);
    }
  });
  it("upload_link is a send context", () => {
    expect(parseSmsSendBody({ ...ok, context: "upload_link" }).ok).toBe(true);
  });
});

const ok = { to: "(816) 555-1234", body: "Hi Maria", context: "call_log" };

describe("parseSmsSendBody", () => {
  it("normalizes the number and keeps the optional fields", () => {
    const r = parseSmsSendBody({ ...ok, templateKey: "consult_link", language: "es", profileLocalId: "p1" });
    expect(r).toEqual({
      ok: true,
      value: { to: "+18165551234", body: "Hi Maria", context: "call_log", templateKey: "consult_link", language: "es", profileLocalId: "p1" },
    });
  });

  it.each([
    [{ ...ok, to: "555-1234" }, /US phone number/],
    [{ ...ok, to: "+52 55 1234 5678" }, /US phone number/],
    [{ ...ok, body: "  " }, /body is required/],
    [{ ...ok, body: "x".repeat(SMS_BODY_MAX + 1) }, /too long/],
    [{ ...ok, body: "Book here: {{link}}" }, /fill in \{\{link\}\}/],
    [{ ...ok, context: "marketing" }, /context must be/],
  ])("refuses %j", (body, msg) => {
    const r = parseSmsSendBody(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });

  it("drops an unknown language rather than refusing", () => {
    const r = parseSmsSendBody({ ...ok, language: "pt" });
    expect(r.ok && r.value.language).toBeNull();
  });
});

describe("smsActivity", () => {
  it("logs the text and the number, and notes a multi-segment text", () => {
    expect(smsActivity({ to: "+18165551234", body: "Hi" }, "111", "act")).toEqual({
      itemId: "111", title: "Text sent to (816) 555-1234", customActivityId: "act", content: "Hi", phone: "+18165551234",
    });
    expect(smsActivity({ to: "+18165551234", body: "x".repeat(200) }, "111", "act").content).toMatch(/\(2 SMS segments\)$/);
  });
});

describe("sanitizeSmsTemplates", () => {
  it("keeps the defaults as they are", () => {
    expect(sanitizeSmsTemplates(DEFAULT_SMS_TEMPLATES)).toEqual(DEFAULT_SMS_TEMPLATES);
  });

  it("drops templates with no label or no text, derives and de-duplicates keys", () => {
    expect(
      sanitizeSmsTemplates([
        { label: "Docs reminder", en: "Send us your documents" },
        { label: "Docs reminder", es: "Envíe sus documentos" },
        { label: "", en: "x" },
        { label: "Empty" },
        "junk",
      ]),
    ).toEqual([
      { key: "docs_reminder", label: "Docs reminder", en: "Send us your documents", es: "" },
      { key: "docs_reminder_2", label: "Docs reminder", en: "", es: "Envíe sus documentos" },
    ]);
  });
});
