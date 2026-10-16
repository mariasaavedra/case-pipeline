// =============================================================================
// Case timeline tests
// =============================================================================
// Fixtures follow the two clients the V1 mockup was built from (a removal case
// with a run of continued trials and a BIA appeal; an administratively closed
// case with family EADs and a denial), with made-up names and numbers.
// They run against the real config/timeline.yaml.

import { test, expect, describe, beforeAll } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { resolve } from "node:path";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { loadTimelineConfig, type TimelineConfig } from "@case-pipeline/config";
import { getCaseTimeline, renderTemplate, usDate, type CaseTimeline, type TimelineEvent } from "./case-timeline";

const TODAY = "2026-10-15";
const PROFILE = "Ana Sofia RIVERA LOPEZ [A111-222-333]";
let config: TimelineConfig;

beforeAll(async () => {
  config = await loadTimelineConfig(resolve(import.meta.dirname, "../../../config/timeline.yaml"));
});

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', ?)").run(PROFILE);
  return db;
}

let n = 0;
function item(db: DatabaseInstance, board: string, name: string, cv: Record<string, unknown>, o: { status?: string; group?: string; deleted?: boolean } = {}) {
  const id = `i${++n}`;
  db.prepare(
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, group_title, profile_local_id, column_values, deleted_at)
     VALUES (1, ?, ?, ?, ?, ?, 'p1', ?, ?)`,
  ).run(id, board, name, o.status ?? null, o.group ?? null, JSON.stringify(cv), o.deleted ? "2026-09-01" : null);
  return id;
}

function contract(db: DatabaseInstance, name: string, cv: Record<string, unknown>, o: { status?: string; group?: string } = {}) {
  db.prepare(
    `INSERT INTO contracts (batch_id, local_id, profile_local_id, name, status, group_title, raw_column_values)
     VALUES (1, ?, 'p1', ?, ?, ?, ?)`,
  ).run(`k${++n}`, name, o.status ?? "Create Project", o.group ?? "Closed Fee Ks", JSON.stringify(cv));
}

function activity(db: DatabaseInstance, at: string, type: string | null, body: string, source = "activity") {
  const id = `u${++n}`;
  db.prepare(
    `INSERT INTO client_updates (batch_id, local_id, profile_local_id, author_name, text_body, source_type, activity_type_name, created_at_source)
     VALUES (1, ?, 'p1', 'Staff', ?, ?, ?, ?)`,
  ).run(id, body, source, type, at);
  return id;
}

const build = (db: DatabaseInstance, today = TODAY): CaseTimeline =>
  getCaseTimeline(db, "p1", config, { today, timeZone: "America/Chicago" })!;
const find = (t: CaseTimeline, label: string, date?: string): TimelineEvent | undefined =>
  t.events.find((e) => e.label === label && (!date || e.date === date));
const d = (date: string) => ({ date });

describe("helpers", () => {
  test("usDate", () => {
    expect(usDate("9/11/26")).toBe("2026-09-11");
    expect(usDate("12/1/2025")).toBe("2025-12-01");
    expect(usDate("9/11")).toBeNull();
  });

  test("renderTemplate: columns, fallbacks, vars", () => {
    const cv = { forms: { labels: ["EAD"] }, relief: { labels: [] } };
    expect(renderTemplate("{forms|Forms} sent{who}", cv, { who: " — Luis" })).toBe("EAD sent — Luis");
    expect(renderTemplate("{relief|Application} filed", cv, {})).toBe("Application filed");
    expect(renderTemplate("Status: {status}", cv, { status: "Picked Up" })).toBe("Status: Picked Up");
  });
});

describe("unknown profile", () => {
  test("returns null", () => {
    expect(getCaseTimeline(freshDb(), "nope", config, { today: TODAY })).toBeNull();
  });
});

describe("removal case with continued trials and a BIA appeal", () => {
  function removalCase(withAppeal: boolean) {
    const db = freshDb();
    item(db, "court_cases", "[ORDERED REMOVED 9/11/26] - LB - Ana S. RIVERA LOPEZ [A111-222-333]", {
      nta_date: d("2021-06-22"),
      app_filed: d("2022-08-01"),
      relief: { labels: ["UACI589"] },
      wl_filed: d("2026-08-07"),
    }, { group: "Ordered Removed/VD" });
    item(db, "calendaring", "[6/26/25] - M - IN PERSON MASTER: Ana S. RIVERA LOPEZ", {
      type: { label: "Master" }, hearing_date_calendaring: d("2025-06-26"), due_date: d("2025-04-28"),
    }, { status: "ATTENDED", group: "ATTENDED" });
    item(db, "calendaring", "[8/7/26] - CONT. TO 8/14/26** LB - WEBEX TRIAL: Ana S. RIVERA LOPEZ", {
      type: { label: "Trial" }, hearing_date_calendaring: d("2026-08-07"), due_date: d("2026-07-24"),
    }, { status: "RECHED/ CONT/ AC/ WD/ - NOT HAPPENING", group: "COURT RESCHEDULED / CONTINUED" });
    item(db, "calendaring", "[8/14/26] - LB - WEBEX TRIAL: Ana S. RIVERA LOPEZ", {
      type: { label: "Trial" }, hearing_date_calendaring: d("2026-08-14"), due_date: d("2026-07-31"),
    }, { status: "Added on Cal", group: "ADDED ON CAL" });
    item(db, "calendaring", "[9/9/26] - LB - WEBEX TRIAL: Ana S. RIVERA LOPEZ (CONT. FROM 8/14/26 TO 9/9/26)", {
      type: { label: "Trial" }, hearing_date_calendaring: d("2026-09-09"),
    }, { status: "Added on Cal" });
    item(db, "calendaring", "[9/11/26] - LB - WEBEX TRIAL: Ana S. RIVERA LOPEZ (cont. from 9/9/26 TRIAL)", {
      type: { label: "Trial" }, hearing_date_calendaring: d("2026-09-11"),
    }, { status: "Added on Cal" });
    item(db, "motions", "MR - MTC TRIAL - [MTACorMTCinAlt] - LB - Ana S. RIVERA LOPEZ", {
      motion: { labels: ["MTACorMTCinAlt."] }, mtn_filed_on: d("2026-07-14"), dec_date: d("2026-07-28"),
    }, { status: "Granted" });
    item(db, "motions", "MR - MTAC - [MTACorMTCinAlt] - LB - Ana S. RIVERA LOPEZ (copy)", {
      motion: { labels: ["MTACorMTCinAlt."] }, mtn_filed_on: d("2026-07-14"), dec_date: d("2026-07-28"),
    }, { status: "Denied" });
    item(db, "motions", "LT - [MTAC] - LB - Ana S. RIVERA LOPEZ", { mtn_filed_on: d("2026-09-03") }, { status: "Filed" });
    if (withAppeal) {
      item(db, "appeals", "LB - [ORDERED REMOVED 9/11/26] - LB - Ana S. RIVERA LOPEZ", {
        appeal_due: d("2026-10-09"), appeal_filed_on: d("2026-10-09"), relief_denied: { labels: ["Asylum"] },
      }, { status: "Submitted" });
    }
    item(db, "appointments_lb", "8/26/26 - [TP 3] - LB - Ana S. RIVERA LOPEZ - RS TO SCHEDULE", { consult_date: d("2026-08-26") }, { status: "Cancelled/No Show" });
    item(db, "appointments_lb", "Ana Sofia RIVERA LOPEZ", { consult_date: d("2026-07-08") }, { status: "COURT PREP APPT" });
    activity(db, "2026-07-14T19:00:00Z", "Filing Complete", "Filed MTAC or MTC in Alt via ECAS CC in NAs folder 7-14-26 [https://example.test/x]");
    activity(db, "2026-07-14T19:00:05Z", "Filing Complete", "Filed MTAC or MTC in Alt via ECAS CC in NAs folder 7-14-26 [https://example.test/x]");
    activity(db, "2025-06-24T16:00:00Z", "Filing Complete", "I was wondering why there were 2 entries for the E28s");
    activity(db, "2026-03-26T15:00:00Z", "Filing Complete", "I-765 RFE Resp sent via Fedex 3-26-26 Tn: 8700");
    activity(db, "2025-07-02T15:00:00Z", "HEARING NOTICE", "INDIVIDUAL HEARING **OWES TP + T FEES** Date : Friday");
    activity(db, "2026-09-01T15:00:00Z", null, "plain note", "update");
    return db;
  }

  test("court milestones from config + the outcome in the item name", () => {
    const t = build(removalCase(true));
    expect(find(t, "NTA issued")?.date).toBe("2021-06-22");
    expect(find(t, "UACI589 filed with court")?.date).toBe("2022-08-01");
    expect(find(t, "Witness list filed")?.date).toBe("2026-08-07");
    expect(find(t, "Ordered Removed")).toMatchObject({ date: "2026-09-11", kind: "decision", status: "bad", track: "court" });
  });

  test("hearing outcomes: attended, rescheduled group, CONT. FROM, decided that day", () => {
    const t = build(removalCase(true));
    expect(find(t, "Master hearing")?.status).toBe("done");
    expect(find(t, "Trial hearing", "2026-08-07")?.status).toBe("cancelled");
    expect(find(t, "Trial hearing", "2026-08-14")).toMatchObject({ status: "cancelled", detail: expect.stringContaining("continued") });
    expect(find(t, "Trial hearing", "2026-09-09")?.status).toBe("cancelled");
    expect(find(t, "Trial hearing", "2026-09-11")?.status).toBe("decided");
    // A cancelled hearing's filing deadline is not a deadline any more.
    expect(t.events.some((e) => e.kind === "deadline" && e.date === "2026-07-24")).toBe(false);
    expect(find(t, "Filing deadline before trial hearing", "2026-07-31")).toBeUndefined();
  });

  test("stored appeal due date wins and is met by the filing", () => {
    const t = build(removalCase(true));
    expect(find(t, "BIA appeal due")).toMatchObject({ date: "2026-10-09", status: "met" });
    expect(find(t, "BIA appeal filed")).toMatchObject({ date: "2026-10-09", status: "good", kind: "filing" });
    expect(t.events.some((e) => e.label.startsWith("BIA appeal deadline"))).toBe(false);
    expect(t.summary.standing.map((s) => s.text)).toContain("Appeal filed with the BIA — waiting on the Board");
    expect(t.summary.attention.some((a) => a.text.includes("BIA"))).toBe(false);
  });

  test("no Appeals item: derived removal + 30 days, flagged once it passes", () => {
    const t = build(removalCase(false));
    const due = find(t, "BIA appeal deadline (30 days)");
    expect(due).toMatchObject({ date: "2026-10-11", status: "deadline" });
    expect(t.summary.attention[0]).toMatchObject({ tone: "bad", date: "2026-10-11", text: expect.stringContaining("passed 4 days ago") });
  });

  test("motions: (copy) skipped, decision labelled, pending one in attention", () => {
    const t = build(removalCase(true));
    expect(find(t, "Motion granted: MTACorMTCinAlt")?.status).toBe("good");
    expect(find(t, "Motion denied: MTACorMTCinAlt")).toBeUndefined();
    expect(t.summary.attention.map((a) => a.text)).toContain("Motion waiting on the judge: MTAC");
  });

  test("E&A: duplicates collapse, chat skipped, filing folded into the board's filing, USCIS routing", () => {
    const t = build(removalCase(true));
    const motionFiled = find(t, "Motion filed: MTACorMTCinAlt");
    expect(motionFiled?.detail).toContain("Note: Filed MTAC or MTC in Alt");
    expect(t.events.filter((e) => e.source === "E&A · Filing Complete" && e.date === "2026-07-14")).toHaveLength(0);
    expect(t.events.some((e) => e.label.startsWith("I was wondering"))).toBe(false);
    expect(find(t, "I-765 RFE Resp sent")).toMatchObject({ track: "uscis", kind: "filing" });
    expect(find(t, "Hearing notice: Individual Hearing")?.track).toBe("court");
    expect(t.events.some((e) => e.detail?.includes("https://"))).toBe(false);
  });

  test("appointments: trial prep number, court prep, cancelled", () => {
    const t = build(removalCase(true));
    expect(find(t, "Trial prep 3 with LB")?.status).toBe("cancelled");
    expect(find(t, "Court prep with LB")?.track).toBe("meetings");
  });

  test("summary: outcome, years in proceedings, resets, note counts per month", () => {
    const t = build(removalCase(true));
    const texts = t.summary.standing.map((s) => s.text);
    expect(t.summary.standing[0]).toMatchObject({ tone: "bad", text: "Court: Ordered Removed" });
    expect(texts).toContain("In proceedings 5.3 years (NTA)");
    expect(texts).toContain("Hearings reset or cancelled: 3");
    expect(t.notesByMonth.find((m) => m.month === "2026-07")?.count).toBe(2);
    expect(t.notesByMonth.reduce((a, m) => a + m.count, 0)).toBe(6);
  });

  test("events are sorted and unique per day + track + label", () => {
    const t = build(removalCase(true));
    const dates = t.events.map((e) => e.date);
    expect(dates).toEqual([...dates].sort());
    const keys = t.events.map((e) => `${e.date}|${e.track}|${e.label}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("closed case with family EADs and a denial", () => {
  function closedCase() {
    const db = freshDb();
    item(db, "court_cases", "[ADMIN CLOSED 2/19/26] - LB - Ana S. RIVERA LOPEZ [A111-222-333] + Rider", {
      nta_date: d("2022-09-01"), app_filed: d("2026-02-18"), relief: { labels: ["I589"] }, fp_date: d("2025-05-28"), wps_filed_on: d("2025-08-11"),
    });
    item(db, "calendaring", "[4/8/26] IN PERSON TRIAL: Ana S. RIVERA LOPEZ + Rider", {
      type: { label: "Trial" }, hearing_date_calendaring: d("2026-04-08"), due_date: d("2026-02-06"),
    }, { status: "MR Deadline + Hearing Confirmed", group: "CONFIRMED ON CAL" });
    item(db, "calendaring", "[11/13/25] IN PERSON MASTER: Ana S. RIVERA LOPEZ", {
      type: { label: "Master" }, hearing_date_calendaring: d("2025-11-13"),
    }, { status: "Check dates", group: "COURT RESCHEDULED / CONTINUED" });
    item(db, "calendaring", "[10/27/26] - LB - I589 INTERVIEW: Ana S. RIVERA LOPEZ (KCMO)", { type: { label: "USCIS" }, interview_date: d("2026-10-27") });
    item(db, "_cd_open_forms", "Ana Sofia RIVERA LOPEZ [A111-222-333]", {
      forms: { labels: ["I589"] }, hire_date: d("2025-03-14"), forms_sent_date: d("2025-04-10"), received_priority_date: d("2025-04-11"), receipt_status: { label: "Received" },
    }, { status: "Sent Out" });
    item(db, "_cd_open_forms", "Ana Sofia RIVERA LOPEZ & Luis D. MORA-RIVERA", {
      forms: { labels: ["EAD"] }, hire_date: d("2025-10-27"), forms_appt_date: d("2025-11-03"), forms_sent_date: d("2025-11-18"),
    });
    item(db, "_cd_open_forms", "[10/27/26] - LB - I589 INTERVIEW: Ana S. RIVERA LOPEZ (KCMO)", { hire_date: d("2026-09-21") }, { status: "Interview scheduled" });
    item(db, "rfes_all", "[4/22/26] - LB - I290B: I765 DENIED - Luis D. MORA-RIVERA", {
      type: { labels: ["DENIAL"] }, issue_date_calendaring: d("2026-03-26"), due_date_calendaring: d("2026-04-22"),
    }, { status: "Appointment to be Scheduled" });
    item(db, "rfes_all", "[5/15/26] - M - I765 RFE: Ana S. RIVERA LOPEZ", {
      type: { labels: ["RFE"] }, issue_date_calendaring: d("2026-03-18"), due_date_calendaring: d("2026-05-15"),
    }, { status: "Sent out" });
    item(db, "_na_originals_cards_notices", "Ana Sofia RIVERA LOPEZ", { date_received: d("2025-12-10"), what_we_have: { labels: ["EAD", "I-765 Approval"] } }, { status: "Picked Up" });
    item(db, "court_cases", "deleted twin", { nta_date: d("2020-01-01") }, { deleted: true });
    contract(db, "Ana Sofia RIVERA LOPEZ", { contract_sent_on: d("2025-01-13") });
    contract(db, "Ana Sofia RIVERA LOPEZ", { contract_sent_on: d("2025-09-12"), signed_contract_received_on: d("2025-09-12"), payment_link_sent_on: d("2025-09-13") });
    contract(db, "Ana Sofia RIVERA LOPEZ", { contract_added_on: d("2026-02-04"), contract_sent_on: d("2026-02-05") }, { status: "Not going forward", group: "Not Going Forward" });
    contract(db, "Ana Sofia RIVERA LOPEZ", { contract_sent_on: d("2026-10-10") }, { status: "Pending", group: "Pending Fee Ks" });
    activity(db, "2026-02-20T15:00:00Z", "IJ - Order/Decision", "Received JO GRANTING MTAC on 2/19/26 via ECAS");
    activity(db, "2025-11-11T15:00:00Z", "USCIS FF Payment", "paid $550 filing fee");
    activity(db, "2026-02-17T03:30:00Z", "CASE STRAT", "Talked about the case"); // 2026-02-16 in Central
    return db;
  }

  test("administratively closed; later hearings cancelled; RESCHEDULED group", () => {
    const t = build(closedCase());
    expect(find(t, "Administratively Closed")).toMatchObject({ date: "2026-02-19", status: "neutral" });
    expect(find(t, "Trial hearing", "2026-04-08")).toMatchObject({ status: "cancelled", detail: expect.stringContaining("after the case was closed") });
    expect(find(t, "Master hearing", "2025-11-13")?.status).toBe("cancelled");
    expect(t.events.some((e) => e.label.startsWith("BIA"))).toBe(false);
  });

  test("open forms: who suffix for family members, interview item skipped", () => {
    const t = build(closedCase());
    expect(find(t, "Hired for I589")?.date).toBe("2025-03-14");
    expect(find(t, "I589 receipt notice")?.detail).toBe("Receipt status: Received");
    expect(find(t, "Hired for EAD — Ana & Luis")?.date).toBe("2025-10-27");
    expect(find(t, "EAD sent to USCIS — Ana & Luis")?.kind).toBe("filing");
    expect(t.events.some((e) => e.date === "2026-09-21")).toBe(false);
    expect(find(t, "USCIS interview")).toMatchObject({ date: "2026-10-27", status: "upcoming", track: "uscis" });
  });

  test("RFE vs denial labels", () => {
    const t = build(closedCase());
    expect(find(t, "I-765 denied")).toMatchObject({ date: "2026-03-26", status: "bad" });
    expect(find(t, "I-290B appeal due")?.date).toBe("2026-04-22");
    expect(find(t, "I-765 RFE issued")?.date).toBe("2026-03-18");
    expect(find(t, "I-765 RFE response due")?.date).toBe("2026-05-15");
  });

  test("Fee Ks: signed, never signed, not going forward, awaiting signature", () => {
    const t = build(closedCase());
    expect(find(t, "Fee K signed")).toMatchObject({ date: "2025-09-12", status: "good", track: "fees" });
    expect(find(t, "Payment link sent")?.date).toBe("2025-09-13");
    expect(find(t, "Fee K sent (never signed)")).toMatchObject({ date: "2025-01-13", status: "cancelled" });
    expect(find(t, "Fee K not going forward")?.date).toBe("2026-02-04");
    expect(find(t, "Fee K sent — awaiting signature")?.status).toBeNull();
  });

  test("E&A types, firm-time dating, deleted rows ignored", () => {
    const t = build(closedCase());
    expect(find(t, "IJ order received")?.kind).toBe("decision");
    expect(find(t, "USCIS filing fee paid")?.track).toBe("uscis");
    expect(find(t, "Case strategy discussed")).toMatchObject({ date: "2026-02-16", track: "notes" });
    expect(find(t, "NTA issued")?.date).toBe("2022-09-01");
    expect(t.events.some((e) => e.date === "2020-01-01")).toBe(false);
  });

  test("coming up skips cancelled; nothing past is upcoming", () => {
    const t = build(closedCase());
    expect(t.summary.next.map((e) => e.label)).toEqual(["USCIS interview"]);
    expect(t.summary.standing[0]).toMatchObject({ tone: null, text: "Court: Administratively Closed" });
  });
});

describe("NVC, FOIAs, litigation, I-918B and the extra E&A types", () => {
  function otherBoards() {
    const db = freshDb();
    item(db, "nvc_notices", "Ana Sofia RIVERA LOPEZ", { notice_type: { label: "Documentarily Qualified" }, notice_date: d("2026-03-02") });
    item(db, "foias", "Ana Sofia RIVERA LOPEZ", {
      foias_filed: { labels: ["EOIR Filed", "FBI Filed"] }, filed_on: d("2026-01-12"), results_received: d("2026-04-20"),
    }, { status: "COMPLETED - RESULTS RECEIVED" });
    item(db, "litigation", "Ana Sofia RIVERA LOPEZ - Habeas", {
      type_of_case: { labels: ["Habeas"] }, work_due: { label: "Status Report" }, due_date: d("2026-10-05"), hearing_date: d("2026-11-02"),
      immigration_hearing_date_court_cases: d("2026-12-01"),
    });
    item(db, "_lt_i918b_s", "Ana Sofia RIVERA LOPEZ", {
      hire_date_for_i918b_request: d("2025-06-01"), signed_date: d("2025-09-15"), due_date_for_u_visa_hire: d("2026-01-15"), expiration_date: d("2026-03-15"),
    }, { status: "Client has deadlines" });
    activity(db, "2026-02-10T15:00:00Z", "EOIR FF Payment", "I-589 FF Payment: $100");
    activity(db, "2026-07-01T15:00:00Z", "INTERVIEW NOTICE", "N400 INTERVIEW: Date: January 22, 2026 Time: 8:00AM Location: KCMO");
    activity(db, "2026-06-03T20:00:00Z", "HEARING NOTES", "6-3-2026 Indiv. Hearing IJ Smith, TA Jones, client present");
    return build(db);
  }

  test("each board's dates become milestones on its track", () => {
    const t = otherBoards();
    expect(find(t, "NVC: Documentarily Qualified", "2026-03-02")).toMatchObject({ track: "uscis", kind: "milestone" });
    expect(find(t, "FOIA filed: EOIR Filed, FBI Filed", "2026-01-12")).toMatchObject({ track: "uscis", kind: "milestone", detail: "Status: COMPLETED - RESULTS RECEIVED" });
    expect(find(t, "FOIA results received", "2026-04-20")).toMatchObject({ track: "uscis" });
    expect(find(t, "Habeas: Status Report due", "2026-10-05")).toMatchObject({ track: "court", kind: "deadline" });
    expect(find(t, "Habeas hearing (federal court)", "2026-11-02")).toMatchObject({ track: "court" });
    expect(find(t, "I-918B certification requested", "2025-06-01")).toMatchObject({ track: "uscis" });
    expect(find(t, "I-918B signed by the agency", "2025-09-15")).toMatchObject({ kind: "decision" });
    expect(find(t, "Hire for the U visa by", "2026-01-15")).toMatchObject({ kind: "milestone" });
    expect(find(t, "I-918B expires", "2026-03-15")).toMatchObject({ kind: "milestone" });
  });

  test("the litigation board's mirrored immigration hearing is not repeated", () => {
    expect(otherBoards().events.some((e) => e.date === "2026-12-01")).toBe(false);
  });

  test("EOIR fee, interview notice and hearing notes from Emails & Activities", () => {
    const t = otherBoards();
    expect(find(t, "EOIR filing fee paid", "2026-02-10")).toMatchObject({ track: "court", kind: "milestone" });
    expect(find(t, "Interview notice", "2026-07-01")).toMatchObject({ track: "uscis", detail: expect.stringContaining("N400 INTERVIEW") });
    expect(find(t, "Hearing notes", "2026-06-03")).toMatchObject({ track: "court", kind: "note", detail: expect.stringContaining("Indiv. Hearing") });
  });

  test("a passed I-918B expiration is not a missed deadline; a passed litigation due date is", () => {
    const attention = otherBoards().summary.attention.map((a) => a.text);
    expect(attention.some((a) => a.includes("I-918B"))).toBe(false);
    expect(attention).toContain("Habeas: Status Report due passed 10 days ago — nothing filed since");
  });
});

describe("what the event panel (M29) needs", () => {
  test("each Needs attention item names the Monday item to fix", () => {
    const db = freshDb();
    const hearing = item(db, "calendaring", "[9/30/26] IN PERSON MASTER: Ana S. RIVERA LOPEZ", {
      type: { label: "Master" }, hearing_date_calendaring: d("2026-09-30"),
    }, { status: "Added on Cal" });
    const rfe = item(db, "rfes_all", "[10/1/26] - M - I765 RFE: Ana S. RIVERA LOPEZ", {
      type: { labels: ["RFE"] }, issue_date_calendaring: d("2026-08-01"), due_date_calendaring: d("2026-10-01"),
    });
    const motion = item(db, "motions", "[MTAC] - LB - Ana S. RIVERA LOPEZ", { motion: { label: "MTAC" } }, { status: "Filed" });
    const t = build(db);
    expect(t.summary.attention).toEqual([
      expect.objectContaining({ text: "I-765 RFE response due passed 14 days ago — nothing filed since", fix: { kind: "deadline", itemLocalId: rfe } }),
      expect.objectContaining({ text: "Master hearing — no outcome recorded", fix: { kind: "hearing_outcome", itemLocalId: hearing } }),
      expect.objectContaining({ text: "Motion waiting on the judge: MTAC", fix: { kind: "motion", itemLocalId: motion } }),
    ]);
  });

  test("WITHDREW and VISITING IJ NO SHOW are outcomes: the hearing didn't go ahead", () => {
    for (const status of ["WITHDREW", "VISITING IJ NO SHOW"]) {
      const db = freshDb();
      item(db, "calendaring", "[9/30/26] IN PERSON MASTER: Ana S. RIVERA LOPEZ", {
        type: { label: "Master" }, hearing_date_calendaring: d("2026-09-30"),
      }, { status });
      const t = build(db);
      expect(find(t, "Master hearing", "2026-09-30")?.status).toBe("cancelled");
      expect(t.summary.attention).toEqual([]);
    }
  });

  test("the fix sticks: a status that records the response closes the deadline", () => {
    const rfe = (status: string) => {
      const db = freshDb();
      item(db, "rfes_all", "[10/1/26] - M - I765 RFE: Ana S. RIVERA LOPEZ", {
        type: { labels: ["RFE"] }, issue_date_calendaring: d("2026-08-01"), due_date_calendaring: d("2026-10-01"),
      }, { status });
      return build(db);
    };
    expect(rfe("Sent out").summary.attention).toEqual([]);
    expect(find(rfe("Sent out"), "I-765 RFE response due")?.status).toBe("met");
    expect(rfe("Not Responding").summary.attention).toEqual([]);
    expect(find(rfe("Client self Responding to RFE"), "I-765 RFE response due")?.status).toBe("cancelled");
    expect(rfe("Appointment to be Scheduled").summary.attention).toHaveLength(1);

    const db = freshDb();
    item(db, "calendaring", "[11/20/26] IN PERSON TRIAL: Ana S. RIVERA LOPEZ", {
      type: { label: "Trial" }, hearing_date_calendaring: d("2026-11-20"), due_date: d("2026-10-06"),
    }, { status: "Deadline Complete" });
    expect(find(build(db), "Filing deadline before trial hearing")?.status).toBe("met");
  });

  test("an E&A event carries its entry's id (for a reply); a board event its item's", () => {
    const db = freshDb();
    const entry = activity(db, "2026-06-03T20:00:00Z", "HEARING NOTES", "6-3-2026 Indiv. Hearing, client present");
    const nvc = item(db, "nvc_notices", "Ana Sofia RIVERA LOPEZ", { notice_type: { label: "Case Created" }, notice_date: d("2026-03-02") });
    const t = build(db);
    expect(find(t, "Hearing notes")).toMatchObject({ updateLocalId: entry, itemLocalId: null });
    expect(find(t, "NVC: Case Created")).toMatchObject({ updateLocalId: null, itemLocalId: nvc, boardKey: "nvc_notices" });
  });
});
