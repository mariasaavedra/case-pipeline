import { describe, it, expect } from "vitest";
import { agreementNameFor, classifyEsignEvent, esignRefOf, planEsignEvent, type EsignRow } from "./events";

const row = (status: EsignRow["status"]): EsignRow => ({
  status, attorney_email: "atty@firm.com", client_email: "client@mail.com", client_name: "Ana Pérez",
});

describe("classifyEsignEvent", () => {
  it.each([
    ["AGREEMENT_WORKFLOW_COMPLETED", "completed"],
    ["Agreement Signed by All Participants", "completed"],
    ["AGREEMENT_ACTION_COMPLETED", "participant_signed"],
    ["Agreement Signed by a Participant", "participant_signed"],
    ["AGREEMENT_REJECTED", "rejected"],
    ["AGREEMENT_EXPIRED", "expired"],
    ["AGREEMENT_RECALLED", "recalled"],
    ["sent", "sent"],
    ["signed_pdf", "signed_pdf"],
    ["AGREEMENT_CREATED", "ignored"],
    ["AGREEMENT_EMAIL_VIEWED", "ignored"],
    [undefined, "ignored"],
  ])("%s → %s", (raw, kind) => {
    expect(classifyEsignEvent(raw)).toBe(kind);
  });
});

describe("esignRefOf", () => {
  it("reads the reference from ref or the agreement name", () => {
    expect(esignRefOf("CP-12")).toBe(12);
    expect(esignRefOf(undefined, agreementNameFor("Ana  Pérez", 7))).toBe(7);
    expect(esignRefOf(null, "Some other agreement")).toBeNull();
  });
});

describe("planEsignEvent", () => {
  it("marks the agreement out for signature when Zap 1 reports back", () => {
    expect(planEsignEvent(row("sending"), "sent")).toEqual({ status: "out_for_signature", steps: [] });
    expect(planEsignEvent(row("attorney_signed"), "sent")).toEqual({ steps: [] });
  });

  it("records the attorney's signature, not the client's", () => {
    expect(planEsignEvent(row("out_for_signature"), "participant_signed", "ATTY@firm.com").steps).toEqual(["attorney_signed"]);
    expect(planEsignEvent(row("out_for_signature"), "participant_signed", null).steps).toEqual(["attorney_signed"]);
    expect(planEsignEvent(row("attorney_signed"), "participant_signed", "client@mail.com")).toEqual({ steps: [] });
  });

  it("on completion moves to Needs Payment Link and notifies", () => {
    const p = planEsignEvent(row("attorney_signed"), "completed");
    expect(p.status).toBe("signed");
    expect(p.steps).toEqual(["client_signed"]);
    expect(p.notify).toContain("Ana Pérez");
    expect(p.title).toBe("Contract signed");
  });

  it("passes through the attorney step when that event was missed", () => {
    expect(planEsignEvent(row("out_for_signature"), "completed").steps).toEqual(["attorney_signed", "client_signed"]);
  });

  it("a repeated completion is a no-op", () => {
    expect(planEsignEvent(row("signed"), "completed")).toEqual({ steps: [] });
  });

  it("rejected / expired / recalled leave the stage alone but notify", () => {
    for (const kind of ["rejected", "expired", "recalled"] as const) {
      const p = planEsignEvent(row("attorney_signed"), kind);
      expect(p.status).toBe(kind);
      expect(p.steps).toEqual([]);
      expect(p.notify).toBeTruthy();
      expect(p.note).toBeTruthy();
    }
    expect(planEsignEvent(row("signed"), "recalled")).toEqual({ steps: [] });
  });
});
