// =============================================================================
// Reception (consult prep) tests
// =============================================================================
// The prep note is posted three times (profile update, pinned appointment
// update, E&A entry), so what matters: the form refuses anything a receptionist
// would have to fix later, the note reads the same everywhere, typed text can't
// inject HTML into Monday, and only genuinely edited fields are written back.
// =============================================================================

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import {
  parsePrepBody,
  prepNote,
  planPrepWriteBack,
  getReceptionConsults,
  PREP_DESCRIPTION_MAX,
  type PrepBody,
} from "./reception";

const base = { apptType: "1st time", method: "Phone", phone: "(913) 555-0101", description: "" };

function body(over: Record<string, unknown> = {}): PrepBody {
  const r = parsePrepBody({ ...base, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.body;
}

describe("parsePrepBody", () => {
  it("accepts the minimal phone prep", () => {
    expect(body()).toEqual({
      apptType: "1st time", apptTypeOther: null, detainedAt: null, method: "Phone", phone: "(913) 555-0101",
      zoomLink: null, methodOther: null, description: "", documents: [], folderLinks: [],
    });
  });

  it("takes a SharePoint folder link for a client that had none, and lists it first", () => {
    const b = body({
      documents: [{ name: "Passport.pdf", url: "https://x.sharepoint.com/p" }],
      folderLinks: [{ kind: "consult_file", url: "https://sharmacrawford.sharepoint.com/sites/scalconsults/x" }],
    });
    expect(b.folderLinks).toEqual([{ kind: "consult_file", url: "https://sharmacrawford.sharepoint.com/sites/scalconsults/x" }]);
    expect(b.documents.map((d) => d.name)).toEqual(["Consult folder", "Passport.pdf"]);
    expect(parsePrepBody({ ...base, folderLinks: [{ kind: "e_file", url: "https://evil.example.com/x" }] }))
      .toEqual({ ok: false, error: "The E-File folder must be a SharePoint link" });
    expect(parsePrepBody({ ...base, folderLinks: [{ kind: "nope", url: "https://x.sharepoint.com/a" }] }).ok).toBe(false);
  });

  it("accepts an Emergency consultation and names it as such in the note", () => {
    const b = body({ apptType: "Emergency consultation" });
    expect(b.apptType).toBe("Emergency consultation");
    const n = prepNote(b, { date: null, time: null, attorney: null, author: "Ana" });
    expect(n.text).toContain("Type of appt: Emergency consultation");
  });

  it("requires a known appointment type, and the specify text for Other", () => {
    expect(parsePrepBody({ ...base, apptType: "Coffee" })).toEqual({ ok: false, error: "Pick the type of appointment" });
    expect(parsePrepBody({ ...base, apptType: "Other" })).toEqual({ ok: false, error: "Specify the type of appointment" });
    expect(body({ apptType: "Other", apptTypeOther: " Bond hearing prep " }).apptTypeOther).toBe("Bond hearing prep");
  });

  it("asks where the client is detained for a Detained appt, and names it in the note", () => {
    expect(parsePrepBody({ ...base, apptType: "Detained appt" })).toEqual({ ok: false, error: "Add where the client is detained" });
    const b = body({ apptType: "Detained appt", detainedAt: " Chase Co. (KS) ", apptTypeOther: "ignored" });
    expect(b.detainedAt).toBe("Chase Co. (KS)");
    expect(b.apptTypeOther).toBeNull();
    const n = prepNote(b, { date: null, time: null, attorney: null, author: "Ana" });
    expect(n.text).toContain("Type of appt: Detained appt — Chase Co. (KS)");
    // Not asked for, so not kept, on any other type.
    expect(body({ detainedAt: "Chase Co." }).detainedAt).toBeNull();
  });

  it("requires the detail that goes with each method", () => {
    expect(parsePrepBody({ ...base, phone: "" })).toEqual({ ok: false, error: "Add the phone number to call" });
    expect(parsePrepBody({ ...base, method: "Zoom" }).ok).toBe(false);
    expect(parsePrepBody({ ...base, method: "Zoom", zoomLink: "zoom.us/j/1" }).ok).toBe(false);
    expect(body({ method: "Zoom", zoomLink: "https://zoom.us/j/123" }).zoomLink).toBe("https://zoom.us/j/123");
    expect(parsePrepBody({ ...base, method: "Other" })).toEqual({ ok: false, error: "Specify how the consult will happen" });
  });

  it("drops the details of the methods not chosen", () => {
    const b = body({ method: "Zoom", zoomLink: "https://zoom.us/j/1", phone: "913 555 0101", methodOther: "x" });
    expect(b.phone).toBeNull();
    expect(b.methodOther).toBeNull();
  });

  it("caps the description", () => {
    expect(parsePrepBody({ ...base, description: "a".repeat(PREP_DESCRIPTION_MAX + 1) }).ok).toBe(false);
  });

  it("keeps only real links as documents, once each", () => {
    expect(parsePrepBody({ ...base, documents: [{ name: "x", url: "javascript:alert(1)" }] }).ok).toBe(false);
    const b = body({
      documents: [
        { name: "Passport.pdf", url: "https://x.sharepoint.com/a" },
        { name: "Again", url: "https://x.sharepoint.com/a" },
        { url: "https://x.sharepoint.com/b" },
      ],
    });
    expect(b.documents).toEqual([
      { name: "Passport.pdf", url: "https://x.sharepoint.com/a" },
      { name: "https://x.sharepoint.com/b", url: "https://x.sharepoint.com/b" },
    ]);
  });
});

describe("prepNote", () => {
  const ctx = { date: "2026-10-03", time: "14:30", attorney: "Michael Sharma-Crawford", author: "Ana Reyes" };

  it("reads the same in text and html", () => {
    const n = prepNote(
      body({ method: "Zoom", zoomLink: "https://zoom.us/j/9", description: "Asks about\nhis I-130", documents: [{ name: "e-file", url: "https://x.sharepoint.com/e" }] }),
      ctx,
    );
    expect(n.title).toBe("Consult prep — Oct 3, 2026 at 2:30 PM");
    expect(n.text).toBe(
      [
        "Consult prep — Oct 3, 2026 at 2:30 PM with Michael Sharma-Crawford",
        "Type of appt: 1st time",
        "How to proceed: Zoom — https://zoom.us/j/9",
        "Documents:",
        "• e-file — https://x.sharepoint.com/e",
        "",
        "Asks about\nhis I-130",
        "",
        "Prepared by Ana Reyes",
      ].join("\n"),
    );
    expect(n.html).toContain('<a href="https://zoom.us/j/9" target="_blank">https://zoom.us/j/9</a>');
    expect(n.html).toContain('<li>📎 <a href="https://x.sharepoint.com/e" target="_blank">e-file</a></li>');
    expect(n.html).toContain("Asks about<br>his I-130");
  });

  it("escapes typed text in the html", () => {
    const n = prepNote(body({ description: "<script>x</script>", apptType: "Other", apptTypeOther: "A & B" }), ctx);
    expect(n.html).not.toContain("<script>");
    expect(n.html).toContain("&lt;script&gt;");
    expect(n.html).toContain("Other — A &amp; B");
  });

  it("copes with a consult that has no date or attorney", () => {
    const n = prepNote(body(), { date: null, time: null, attorney: null, author: "Ana" });
    expect(n.title).toBe("Consult prep");
    expect(n.text.split("\n")[0]).toBe("Consult prep");
  });
});

describe("planPrepWriteBack", () => {
  const cols = { profilePhone: "phone7__1", appointmentDescription: "long_text" };

  it("writes nothing when nothing was edited", () => {
    expect(planPrepWriteBack(body({ description: "Same" }), { profilePhone: "(913) 555-0101", appointmentDescription: " Same " }, cols)).toEqual([]);
  });

  it("sends each edit back where it came from", () => {
    expect(planPrepWriteBack(body({ phone: "816 555 0000", description: "New" }), { profilePhone: "(913) 555-0101", appointmentDescription: "Old" }, cols)).toEqual([
      { target: "profile", field: "phone", columnId: "phone7__1", value: "816 555 0000" },
      { target: "appointment", field: "description", columnId: "long_text", value: "New" },
    ]);
  });

  it("never clears a field, and ignores the phone when the consult is not by phone", () => {
    expect(planPrepWriteBack(body({ description: "" }), { profilePhone: null, appointmentDescription: "Old" }, cols)).toEqual([
      { target: "profile", field: "phone", columnId: "phone7__1", value: "(913) 555-0101" },
    ]);
    expect(planPrepWriteBack(body({ method: "Zoom", zoomLink: "https://zoom.us/j/1" }), { profilePhone: "1", appointmentDescription: null }, cols)).toEqual([]);
  });

  it("skips a column that could not be resolved", () => {
    expect(planPrepWriteBack(body({ description: "New" }), { profilePhone: "x", appointmentDescription: "Old" }, { profilePhone: null, appointmentDescription: null })).toEqual([]);
  });

  it("fills an empty folder column, and never replaces a link already there", () => {
    const url = "https://sharmacrawford.sharepoint.com/sites/scalconsults/x";
    const b = body({ folderLinks: [{ kind: "consult_file", url }] });
    const folderCols = { ...cols, profileFolders: { e_file: "e_file__1", consult_file: "text_mkxphk77" } };
    const same = { profilePhone: "(913) 555-0101", appointmentDescription: null };
    expect(planPrepWriteBack(b, { ...same, profileFolders: { consult_file: null } }, folderCols)).toEqual([
      { target: "profile", field: "consult_file", columnId: "text_mkxphk77", value: url },
    ]);
    expect(planPrepWriteBack(b, { ...same, profileFolders: { consult_file: "https://set.in.monday/meanwhile" } }, folderCols)).toEqual([]);
  });
});

describe("getReceptionConsults", () => {
  function seed() {
    const db = new Database(":memory:");
    initializeSchema(db);
    db.prepare("INSERT INTO seed_batches (id, batch_name) VALUES (1, 'test')").run();
    db.prepare(
      `INSERT INTO profiles (batch_id, local_id, monday_item_id, name, phone, raw_column_values)
       VALUES (1, 'p1', '111', 'Silvia Estrada', '+1 913', ?)`,
    ).run(JSON.stringify({ consult_file: "https://x.sharepoint.com/c" }));
    const appt = db.prepare(
      `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, next_date, next_time, attorney, profile_local_id, column_values)
       VALUES (1, ?, ?, ?, 'Silvia Estrada', ?, ?, 'Michael', 'p1', ?)`,
    );
    appt.run("a1", "901", "appointments_m", "2026-10-03", "14:30", JSON.stringify({ description: "Asks", language: { label: "Espanol" }, calendly: { label: "yes" } }));
    appt.run("a2", "902", "appointments_m", "2026-10-03", "09:00", "{}");
    appt.run("a3", "903", "appointments_m", "2026-10-20", null, "{}");
    appt.run("a4", "904", "court_cases", "2026-10-03", null, "{}");
    return db;
  }
  const opts = { from: "2026-10-01", to: "2026-10-08", boardKeys: ["appointments_m"], boardBadges: new Map([["appointments_m", "M"]]) };

  it("lists consults in the window by date and time, from the active boards only", () => {
    const list = getReceptionConsults(seed(), opts);
    expect(list.map((c) => c.localId)).toEqual(["a2", "a1"]);
    const a1 = list[1]!;
    expect(a1).toMatchObject({
      board: "M", language: "Espanol", fromCalendly: true, description: "Asks",
      profile: { localId: "p1", name: "Silvia Estrada", consultFile: "https://x.sharepoint.com/c", eFile: null },
      lastPrep: null,
      detainedAt: null,
    });
  });

  it("carries the facility from the client's open court case", () => {
    const db = seed();
    const cc = db.prepare(
      `INSERT INTO board_items (batch_id, local_id, board_key, name, group_title, profile_local_id, column_values, updated_at_source)
       VALUES (1, ?, 'court_cases', 'case', ?, 'p1', ?, ?)`,
    );
    cc.run("c-closed", "Closed", JSON.stringify({ det_facility: { label: "Old Jail (MO)" } }), "2026-09-30");
    cc.run("c-old", "Court Case", JSON.stringify({ det_facility: { label: "Butler Co. (KS)" } }), "2026-08-01");
    cc.run("c-new", "Court Case", JSON.stringify({ det_facility: { label: "Chase Co. (KS)" } }), "2026-09-01");
    const list = getReceptionConsults(db, opts);
    expect(list.find((c) => c.localId === "a1")!.detainedAt).toBe("Chase Co. (KS)");
  });

  it("shows the latest prep", () => {
    const db = seed();
    const prep = db.prepare(
      `INSERT INTO consult_preps (appointment_local_id, appt_type, method, fields, note_text, author_name, pending, created_at)
       VALUES ('a1', ?, ?, '{}', '', 'Ana', ?, ?)`,
    );
    prep.run("1st time", "Phone", 0, "2026-10-01 10:00:00");
    prep.run("Trial Prep", "Zoom", 1, "2026-10-02 10:00:00");
    const a1 = getReceptionConsults(db, opts).find((c) => c.localId === "a1")!;
    expect(a1.lastPrep).toEqual({ at: "2026-10-02 10:00:00", author: "Ana", apptType: "Trial Prep", method: "Zoom", pending: true });
  });
});
