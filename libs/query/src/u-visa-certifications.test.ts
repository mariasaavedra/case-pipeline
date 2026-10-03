// =============================================================================
// U Visa Certifications (I-918B) Alert Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getI918bExpiringItems, getI918bPendingItems, getI918bAlertGroups } from "./u-visa-certifications";

const TODAY = "2026-10-03";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', 'Ana LOPEZ')").run();
  return db;
}

let n = 0;
function cert(
  db: DatabaseInstance,
  o: { name?: string; status?: string; group?: string; profile?: string | null; attorney?: string; signed?: string; expires?: string; hired?: string; hireDue?: string },
): string {
  const localId = `c${++n}`;
  const cv = {
    ...(o.signed ? { signed_date: { date: o.signed } } : {}),
    ...(o.expires ? { expiration_date: { date: o.expires } } : {}),
    ...(o.hired ? { hire_date_for_i918b_request: { date: o.hired } } : {}),
    ...(o.hireDue ? { due_date_for_u_visa_hire: { date: o.hireDue } } : {}),
  };
  db.prepare(`
    INSERT INTO board_items (batch_id, local_id, board_key, group_title, name, status, profile_local_id, attorney, column_values)
    VALUES (1, ?, '_lt_i918b_s', ?, ?, ?, ?, ?, ?)
  `).run(localId, o.group ?? "Signed I918 B's", o.name ?? `Client ${localId}`, o.status ?? "Client has deadlines",
    o.profile === undefined ? "p1" : o.profile, o.attorney ?? "Lucy Betteridge", JSON.stringify(cv));
  return localId;
}

function openForm(db: DatabaseInstance, o: { forms: string[]; status: string; sent?: string }) {
  db.prepare(`
    INSERT INTO board_items (batch_id, local_id, board_key, group_title, name, status, profile_local_id, column_values)
    VALUES (1, ?, '_cd_open_forms', 'Filed', 'Ana LOPEZ', ?, 'p1', ?)
  `).run(`f${++n}`, o.status, JSON.stringify({ forms: { labels: o.forms }, ...(o.sent ? { forms_sent_date: { date: o.sent } } : {}) }));
}

const expiring = (db: DatabaseInstance) => getI918bExpiringItems(db, { today: TODAY });
const pending = (db: DatabaseInstance) => getI918bPendingItems(db, { today: TODAY });

describe("I-918B Expiring", () => {
  test("expiring soon and recently expired; far off and long gone are left out", () => {
    const db = freshDb();
    const soon = cert(db, { signed: "2026-05-12", expires: "2026-10-12", hireDue: "2026-09-11" });
    const gone = cert(db, { signed: "2026-04-24", expires: "2026-09-24" });
    cert(db, { signed: "2026-08-01", expires: "2027-01-01" });
    cert(db, { signed: "2025-01-01", expires: "2025-06-01" });
    const items = expiring(db);
    expect(items.map((i) => i.localId)).toEqual([gone, soon]);
    expect(items[0]!.daysOverdue).toBe(9);
    expect(items[0]!.detail).toBe("I-918B expired Sep 24 (signed Apr 24); a new one is needed");
    expect(items[1]!.daysLeft).toBe(9);
    expect(items[1]!.detail).toBe("I-918B expires Oct 12 (signed May 12); no I-918 sent yet · hire due Sep 11 passed");
  });

  test("no Expiration Date: signed + 6 months", () => {
    const db = freshDb();
    cert(db, { signed: "2026-04-20" });
    expect(expiring(db)[0]!.date).toBe("2026-10-20");
  });

  test("closed statuses and groups never alert", () => {
    const db = freshDb();
    cert(db, { signed: "2026-05-01", expires: "2026-10-10", status: "Not Hiring", group: "Did not hire" });
    cert(db, { signed: "2026-05-01", expires: "2026-10-10", status: "Expired", group: "Expired" });
    expect(expiring(db)).toEqual([]);
  });

  test("a U visa Open Form sent since signing means it was filed", () => {
    const db = freshDb();
    cert(db, { signed: "2026-04-21", expires: "2026-09-21", status: "On Prescheduling" });
    openForm(db, { forms: ["Uvisa"], status: "Sent Out", sent: "2026-09-18" });
    expect(expiring(db)).toEqual([]);
  });

  test("an older, unsent, or non-U-visa form doesn't count", () => {
    const db = freshDb();
    const id = cert(db, { signed: "2026-05-01", expires: "2026-10-10", status: "On Prescheduling" });
    openForm(db, { forms: ["I918"], status: "Sent Out", sent: "2025-01-10" });
    openForm(db, { forms: ["I-918", "I765"], status: "Prepping for Atty Review" });
    openForm(db, { forms: ["I-130"], status: "Sent Out", sent: "2026-09-01" });
    const items = expiring(db);
    expect(items.map((i) => i.localId)).toEqual([id]);
    expect(items[0]!.detail).toContain("client hired (on Prescheduling)");
  });
});

describe("I-918B Requests Pending", () => {
  test("pending 90+ days since the hire date, oldest first", () => {
    const db = freshDb();
    const old = cert(db, { group: "Pending I918 B's", status: "918b Request pending", hired: "2022-12-13" });
    const mid = cert(db, { group: "Pending I918 B's", status: "Request Pending", hired: "2026-05-29" });
    cert(db, { group: "Pending I918 B's", status: "Request Pending", hired: "2026-09-01" });
    cert(db, { group: "Pending I918 B's", status: "Request Pending" });
    expect(pending(db).map((i) => i.localId)).toEqual([old, mid]);
    expect(pending(db)[1]!.detail).toBe("Requested May 29, 127 days without a signature: follow up with the agency, or close it on Monday");
  });

  test("a client also under 'Agency did not sign' is flagged to close", () => {
    const db = freshDb();
    cert(db, { name: "Yunerit HERNANDEZ", group: "Agency did not sign", status: "Agency did not sign", profile: null, hired: "2023-01-16" });
    cert(db, { name: "Yunerit HERNANDEZ (copy)", group: "Pending I918 B's", status: "918b Request pending", hired: "2023-01-16" });
    const items = pending(db);
    expect(items).toHaveLength(1);
    expect(items[0]!.detail).toBe('Requested Jan 16, 2023; also listed under "Agency did not sign": close this one on Monday');
  });
});

test("groups and the attorney filter", () => {
  const db = freshDb();
  cert(db, { signed: "2026-05-12", expires: "2026-10-12", attorney: "Bradley Burke" });
  cert(db, { signed: "2026-05-12", expires: "2026-10-15" });
  cert(db, { group: "Pending I918 B's", status: "Request Pending", hired: "2026-01-01", attorney: "Bradley Burke" });
  const [exp, pen] = getI918bAlertGroups(db, { today: TODAY, attorney: "Bradley Burke" });
  expect(exp!.label).toBe("I-918B Expiring");
  expect(exp!.severity).toBe("critical");
  expect(exp!.count).toBe(1);
  expect(pen!.severity).toBe("warning");
  expect(pen!.count).toBe(1);
});
