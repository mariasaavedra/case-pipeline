import { describe, it, expect } from "vitest";
import { resolveConsultNote, mayBeCut, noteHtmlToText, type TimelineNote } from "./consult-note.js";

const activity = (activityType: string, text: string, date: string, author = "Michael Sharma-Crawford"): TimelineNote =>
  ({ activityType, text, date, author });

const CONSULT_DATE = "2026-03-04";

describe("resolveConsultNote — source priority", () => {
  it("prefers the M Consult Note column above everything", () => {
    const r = resolveConsultNote({
      mConsultNote: "from the M column",
      profileNotes: "from the profile",
      timeline: [activity("Consult note", "from the timeline", CONSULT_DATE)],
      consultDate: CONSULT_DATE,
    });
    expect(r).toMatchObject({ source: "m-consult-note-column", text: "from the M column" });
  });

  it("prefers a DATED Consult note over the undated profile column", () => {
    // The profile column is one field on the client, not tied to a visit. For
    // the 31 clients who have consulted more than once it may describe an
    // earlier one, and a note dated to this consult is the better evidence.
    const r = resolveConsultNote({
      profileNotes: "possibly from an earlier consultation",
      timeline: [activity("Consult note", "from the timeline", CONSULT_DATE)],
      consultDate: CONSULT_DATE,
    });
    expect(r).toMatchObject({ source: "consult-note-activity", text: "from the timeline" });
  });

  it("uses the profile column when no dated note is near this consult", () => {
    const r = resolveConsultNote({
      profileNotes: "from the profile",
      timeline: [activity("Consult note", "a 2021 visit", "2021-05-10")],
      consultDate: CONSULT_DATE,
    });
    expect(r).toMatchObject({ source: "profile-notes-column", text: "from the profile" });
    expect(r!.label).toContain("not dated to a specific consultation");
  });

  it("beats a Casenote with the profile column", () => {
    const r = resolveConsultNote({
      profileNotes: "from the profile",
      timeline: [activity("Casenote", "FedEx tracking", CONSULT_DATE)],
      consultDate: CONSULT_DATE,
    });
    expect(r).toMatchObject({ source: "profile-notes-column" });
  });

  it("uses a Consult note activity when no column holds one", () => {
    const r = resolveConsultNote({
      timeline: [activity("Consult note", "30 min, wants I-589", CONSULT_DATE)],
      consultDate: CONSULT_DATE,
    });
    expect(r).toMatchObject({ source: "consult-note-activity", text: "30 min, wants I-589" });
    expect(r!.label).toContain("4 Mar 2026");
    expect(r!.label).toContain("Michael Sharma-Crawford");
  });

  it("falls back to a Casenote, and says so on the document", () => {
    // Lucy and Rekha file consult notes this way; the reader should know.
    const r = resolveConsultNote({
      timeline: [activity("Casenote", "met with client, no hire", CONSULT_DATE, "Lucy Betteridge")],
      consultDate: CONSULT_DATE,
    });
    expect(r).toMatchObject({ source: "casenote-activity" });
    expect(r!.label).toContain("not filed as a Consult note");
    expect(r!.label).toContain("Lucy Betteridge");
  });

  it("prefers a Consult note over a Casenote on the same day", () => {
    const r = resolveConsultNote({
      timeline: [
        activity("Casenote", "FedEx tracking 7723", CONSULT_DATE),
        activity("Consult note", "the real note", CONSULT_DATE),
      ],
      consultDate: CONSULT_DATE,
    });
    expect(r).toMatchObject({ source: "consult-note-activity", text: "the real note" });
  });

  it("returns null when there is nothing anywhere", () => {
    expect(resolveConsultNote({ timeline: [], consultDate: CONSULT_DATE })).toBeNull();
    expect(resolveConsultNote({ profileNotes: "   ", consultDate: CONSULT_DATE })).toBeNull();
  });

  it("still uses the profile column when the consult has no date", () => {
    // No date means no window to check, so the dated sources are unusable.
    const r = resolveConsultNote({
      profileNotes: "from the profile",
      timeline: [activity("Consult note", "undatable", CONSULT_DATE)],
      consultDate: null,
    });
    expect(r).toMatchObject({ source: "profile-notes-column" });
  });
});

describe("resolveConsultNote — date bounds", () => {
  it("does NOT staple an earlier consultation's note onto this one", () => {
    // The client consulted in 2021 and again in 2026. Without a bound the old
    // note would be presented as this consultation's — quietly wrong.
    const r = resolveConsultNote({
      timeline: [activity("Consult note", "2021 consultation", "2021-05-10")],
      consultDate: CONSULT_DATE,
    });
    expect(r).toBeNull();
  });

  it("accepts a Consult note written a few days late", () => {
    expect(resolveConsultNote({
      timeline: [activity("Consult note", "written up later", "2026-03-09")],
      consultDate: CONSULT_DATE,
    })).toMatchObject({ source: "consult-note-activity" });
  });

  it("holds Casenotes to a tighter window than Consult notes", () => {
    const casenoteAt5Days = { timeline: [activity("Casenote", "x", "2026-03-09")], consultDate: CONSULT_DATE };
    const consultNoteAt5Days = { timeline: [activity("Consult note", "x", "2026-03-09")], consultDate: CONSULT_DATE };
    expect(resolveConsultNote(casenoteAt5Days)).toBeNull();
    expect(resolveConsultNote(consultNoteAt5Days)).not.toBeNull();
  });

  it("picks the entry closest to the consult when there are several", () => {
    const r = resolveConsultNote({
      timeline: [
        activity("Consult note", "six days out", "2026-03-10"),
        activity("Consult note", "same day", CONSULT_DATE),
      ],
      consultDate: CONSULT_DATE,
    });
    expect(r!.text).toBe("same day");
  });

  it("ignores a Casenote written before the consult (reception's intake, a payment)", () => {
    expect(resolveConsultNote({
      timeline: [activity("Casenote", "PAID, POC is a friend", "2026-03-03", "Miguel Vence")],
      consultDate: CONSULT_DATE,
    })).toBeNull();
  });

  it("takes the later of two same-day entries — the note written after the meeting", () => {
    const r = resolveConsultNote({
      timeline: [
        activity("Casenote", "Your upcoming Master hearing is on…", CONSULT_DATE, "Fernando Ayala"),
        activity("Casenote", "Met with mom of three", CONSULT_DATE, "Caitlin Riffer"),
      ],
      consultDate: CONSULT_DATE,
    });
    expect(r!.text).toBe("Met with mom of three");
  });

  it("ignores an undated entry rather than assuming it belongs", () => {
    expect(resolveConsultNote({
      timeline: [{ activityType: "Consult note", text: "x", author: null, date: null }],
      consultDate: CONSULT_DATE,
    })).toBeNull();
  });
});

describe("Monday's cut-short E&A previews", () => {
  it("flags long plain text as possibly cut, never HTML or short text", () => {
    expect(mayBeCut("x".repeat(250))).toBe(true);
    expect(mayBeCut("short note")).toBe(false);
    expect(mayBeCut(`<div>${"x".repeat(300)}</div>`)).toBe(false);
    expect(mayBeCut(null)).toBe(false);
  });

  it("turns a full entry's HTML into text with its lines kept", () => {
    const html = "<div>Charged with trespassing&nbsp;not an issue</div><div>OPT &amp; CPT</div>" +
      "<div><br></div><div>lots of questions for pub defender</div><div><br></div>";
    expect(noteHtmlToText(html)).toBe(
      "Charged with trespassing not an issue\nOPT & CPT\n\nlots of questions for pub defender",
    );
  });
});
