import { describe, it, expect } from "vitest";
import { contractStepEvent, consultPrepEvent, mailScanEvent, smsSentEvent } from "./events.js";

const link = "https://scaltheclinic.monday.com/boards/1/pulses/2";

describe("contractStepEvent", () => {
  it("client signed and payment link sent are posted; the internal hand-offs aren't", () => {
    expect(contractStepEvent({ step: "client_signed", clientName: "Ana LOPEZ", contractFor: ["Court", "U-Visa"], by: "Maria", link }))
      .toBe(`:writing_hand: *Ana LOPEZ* signed their contract (Court, U-Visa) — Maria — <${link}|Fee K>`);
    expect(contractStepEvent({ step: "payment_link_sent", clientName: "Ana", contractFor: [], by: null, link: null }))
      .toBe(":money_with_wings: Payment link sent to *Ana*");
    expect(contractStepEvent({ step: "attorney_signed", clientName: "Ana", contractFor: [], link })).toBeNull();
    expect(contractStepEvent({ step: "sent_for_signature", clientName: "Ana", contractFor: [], link })).toBeNull();
  });

  it("escapes names", () => {
    expect(contractStepEvent({ step: "client_signed", clientName: "A & B <x>", contractFor: [], link: null }))
      .toBe(":writing_hand: *A &amp; B &lt;x&gt;* signed their contract");
  });
});

describe("consultPrepEvent", () => {
  it("names the client, attorney and time", () => {
    expect(consultPrepEvent({ clientName: "Ana", attorney: "Michael", date: "2026-10-16", time: "14:00", by: "Rosa", link }))
      .toBe(`:clipboard: Consult prepped: *Ana* with Michael, 2026-10-16 14:00 — Rosa — <${link}|Monday>`);
    expect(consultPrepEvent({ clientName: "Ana", attorney: null, date: null, time: null, link: null }))
      .toBe(":clipboard: Consult prepped: *Ana*");
  });
});

describe("mailScanEvent", () => {
  it("links to Alerts only when something needs review", () => {
    expect(mailScanEvent({ notices: 5, needsReview: 2, by: "Rosa", link: "https://app/alerts" }))
      .toBe(":envelope: Mail scanned: 5 notices, *2 to review* — Rosa — <https://app/alerts|Alerts>");
    expect(mailScanEvent({ notices: 1, needsReview: 0, link: "https://app/alerts" }))
      .toBe(":envelope: Mail scanned: 1 notice, all matched");
    expect(mailScanEvent({ notices: 0, needsReview: 0, link: null })).toBeNull();
  });
});

describe("smsSentEvent", () => {
  it("says who and which template — never the number or the words", () => {
    expect(smsSentEvent({ clientName: "Ana", templateLabel: "Consultation link", context: "call_log", by: "Rosa", link }))
      .toBe(`:speech_balloon: Text sent to *Ana* (Consultation link) — Rosa — <${link}|Monday>`);
    expect(smsSentEvent({ clientName: null, templateLabel: null, context: "call_log", link }))
      .toBe(":speech_balloon: Text sent to *an unlinked caller* (after a call)");
  });
});
