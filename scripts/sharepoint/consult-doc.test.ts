import { describe, it, expect } from "vitest";
import { buildConsultDocVars, isAwaitingNote, consultDocName, MISSING_NOTE } from "./consult-doc.js";

const now = new Date("2026-09-03T16:30:00Z");

const sources = (over: Partial<Parameters<typeof buildConsultDocVars>[0]> = {}) => ({
  profileName: "Guadalupe RESENDIZ MUÑOZ",
  profile: {
    date_of_birth: "1972-04-11",
    a_number: "A221-455-213",
    country_of_birth: "Mexico",
    preferred_language: { label: "Espanol" },
    attorney: { label: "Michael Sharma-Crawford" },
    email: "g@example.com",
    phone: "+1 816 555 0134",
    physical_address: "123 Main St, Kansas City, MO",
    consultation_notes: "1st to US 1994 visa\nno crime",
  } as Record<string, unknown>,
  appointment: {} as Record<string, unknown>,
  apptStatus: "Past Consult",
  consultDate: "2025-06-30",
  now,
  ...over,
});

describe("buildConsultDocVars", () => {
  it("fills every placeholder the template declares", () => {
    const vars = buildConsultDocVars(sources());
    for (const key of [
      "client_name", "date_of_birth", "a_number", "country_of_birth", "language",
      "email", "phone", "address", "consult_date", "attorney", "consult_outcome",
      "reason_for_consult", "note_source", "consult_note", "generated_at",
    ]) {
      expect(vars[key], key).toBeTruthy();
    }
  });

  it("unwraps Monday's { label } values", () => {
    const vars = buildConsultDocVars(sources());
    expect(vars.language).toBe("Espanol");
    expect(vars.attorney).toBe("Michael Sharma-Crawford");
  });

  it("keeps the note's line breaks — the template renders them as <w:br/>", () => {
    expect(buildConsultDocVars(sources()).consult_note).toContain("\n");
  });

  it("states the absence when no note was recorded", () => {
    const vars = buildConsultDocVars(sources({ profile: {} }));
    expect(vars.consult_note).toBe(MISSING_NOTE);
    expect(isAwaitingNote(vars)).toBe(true);
  });

  it("falls back to the Appointments M note", () => {
    const vars = buildConsultDocVars(sources({
      profile: {},
      appointment: { m_consult_note: "seen in jail, wants bond" },
    }));
    expect(vars.consult_note).toBe("seen in jail, wants bond");
    expect(vars.note_source).toBe("M Consult Note column");
    expect(isAwaitingNote(vars)).toBe(false);
  });

  it("records WHERE the note came from", () => {
    // The profile column is undated, and the label says so — for a client who
    // has consulted twice it may describe the other visit.
    expect(buildConsultDocVars(sources()).note_source).toBe(
      "Consultation Notes column on the profile (not dated to a specific consultation)",
    );
  });

  it("uses a timeline Consult note when no column holds one, and says so", () => {
    const vars = buildConsultDocVars(sources({
      profile: {},
      timeline: [{ activityType: "Consult note", text: "wants I-589", date: "2025-06-30", author: "Michael Sharma-Crawford" }],
    }));
    expect(vars.consult_note).toBe("wants I-589");
    expect(vars.note_source).toContain("Consult note activity");
  });

  it("flags a Casenote as not being a real consult note", () => {
    const vars = buildConsultDocVars(sources({
      profile: {},
      timeline: [{ activityType: "Casenote", text: "met client", date: "2025-06-30", author: "Lucy Betteridge" }],
    }));
    expect(vars.consult_note).toBe("met client");
    expect(vars.note_source).toContain("not filed as a Consult note");
  });

  it("carries the client's own reason for consulting", () => {
    const vars = buildConsultDocVars(sources({
      appointment: { description: "My partner was detained by ICE." },
    }));
    expect(vars.reason_for_consult).toBe("My partner was detained by ICE.");
  });

  it("says none found when there is no note at all", () => {
    const vars = buildConsultDocVars(sources({ profile: {} }));
    expect(vars.note_source).toBe("none found");
  });

  it("marks unknown values rather than leaving them blank", () => {
    // A blank in a rendered document reads as a failed render, not as missing data.
    const vars = buildConsultDocVars(sources({ profile: {}, consultDate: null, apptStatus: null }));
    expect(vars.a_number).toBe("—");
    expect(vars.consult_date).toBe("—");
    expect(vars.consult_outcome).toBe("—");
  });

  it("prefers the physical address, falling back to mailing", () => {
    expect(buildConsultDocVars(sources({
      profile: { mailing_address: "PO Box 7" },
    })).address).toBe("PO Box 7");
  });
});

describe("consultDocName", () => {
  it("is deterministic so a regeneration replaces the same file", () => {
    expect(consultDocName("2025-06-30")).toBe("Consultation Summary 2025-06-30.docx");
    expect(consultDocName("2025-06-30")).toBe(consultDocName("2025-06-30"));
  });

  it("still names a file when the date is missing", () => {
    expect(consultDocName(null)).toBe("Consultation Summary.docx");
  });
});
