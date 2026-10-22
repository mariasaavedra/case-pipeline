// =============================================================================
// Detained rule Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { batchGetDetentions, detentionNote, getDetention } from "./detention";

const TODAY = "2026-10-22";

function freshDb(profileName = "Ana LOPEZ"): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (1, 'p1', 'm1', ?)").run(profileName);
  return db;
}

function courtCase(db: DatabaseInstance, o: { localId: string; name?: string; group?: string; facility?: string }) {
  db.prepare(`
    INSERT INTO board_items (batch_id, local_id, board_key, name, group_title, profile_local_id, column_values)
    VALUES (1, ?, 'court_cases', ?, ?, 'p1', ?)
  `).run(o.localId, o.name ?? "M - Ana LOPEZ", o.group ?? "Court Case",
    JSON.stringify(o.facility ? { det_facility: { label: o.facility } } : {}));
}

function appt(db: DatabaseInstance, o: { localId: string; date: string; name?: string; status?: string; intake?: boolean }) {
  db.prepare(`
    INSERT INTO board_items (batch_id, local_id, board_key, name, status, profile_local_id, column_values)
    VALUES (1, ?, 'appointments_m', ?, ?, 'p1', ?)
  `).run(o.localId, o.name ?? "Ana LOPEZ", o.status ?? "Upcoming", JSON.stringify({
    consult_date: { date: o.date },
    ...(o.intake ? { jail_intakes: { linked_item_ids: ["999"], display_value: "Ana LOPEZ" } } : {}),
  }));
}

function release(db: DatabaseInstance, releasedOn: string | null, createdAt = `${TODAY} 15:00:00`) {
  db.prepare("INSERT INTO detention_releases (profile_monday_id, released_on, created_at) VALUES ('m1', ?, ?)").run(releasedOn, createdAt);
}

const detention = (db: DatabaseInstance) => getDetention(db, "p1", { today: TODAY });

describe("detentionNote — what a name says", () => {
  test("reads the place out of the brackets staff write", () => {
    // Real names on the 2026-10-22 server.
    expect(detentionNote("Felipe Pablo PEDRAZA [Det Greene Co][A221-455-464]")).toEqual({ at: "Greene Co" });
    expect(detentionNote("Javis DAVIES (Detained in Greene County) (Potential Habeas)")).toEqual({ at: "Greene County" });
    expect(detentionNote("M - Daniel SOLORZANO LOPEZ [A254-061-609] (Det. at CoreCivic)")).toEqual({ at: "CoreCivic" });
    expect(detentionNote("Lesbia M. PEREZ-LARIOS [A221-454-851] (Det. in Chase Co.) | (AKA Luisa)")).toEqual({ at: "Chase Co." });
    expect(detentionNote("Mei ZHAO (Sinnie LIN USC Daughter)[Detained at Greene County]")).toEqual({ at: "Greene County" });
  });

  test("tidies a shouted place and drops an A-number", () => {
    expect(detentionNote("Daniel SOLORZANO LOPEZ (DETAINED IN CORE CIVIC)")).toEqual({ at: "Core Civic" });
    expect(detentionNote("Isaac GONZALEZ MOLINA A214-099-391 [DETAINED IN CHASE]")).toEqual({ at: "Chase" });
    expect(detentionNote("Ana LOPEZ (Det. A221-455-213)")).toEqual({ at: null });
  });

  test("says detained without a place when none is named", () => {
    expect(detentionNote("DETAINED Fidencio MERCADO")).toEqual({ at: null });
    expect(detentionNote("Celso VERA CAMPOS (Det Chase County")).toEqual({ at: "Chase County" });
  });

  test("says nothing for a plain name, a released one, or a word that only starts with det", () => {
    expect(detentionNote("Ana LOPEZ [A221-455-213]")).toBeNull();
    expect(detentionNote(null)).toBeNull();
    expect(detentionNote("Ana LOPEZ (Released from Chase Co.) (det)")).toBeNull();
    expect(detentionNote("Ana LOPEZ [Determination pending]")).toBeNull();
    expect(detentionNote("Detroit DETWEILER")).toBeNull();
  });
});

describe("batchGetDetentions — the rule", () => {
  test("Det. Facility on an open court case wins, with its label", () => {
    const db = freshDb("Ana LOPEZ (Det. at CoreCivic)");
    courtCase(db, { localId: "c1", facility: "Greene Co. (MO)" });
    expect(detention(db)).toEqual({ at: "Greene Co. (MO)", source: "facility" });
  });

  test("a finished court case's facility is history, not where they are", () => {
    const db = freshDb();
    courtCase(db, { localId: "c1", group: "Ordered Removed/VD", facility: "Greene Co. (MO)" });
    expect(detention(db)).toBeNull();
  });

  test("an open court case's name says detained", () => {
    const db = freshDb();
    courtCase(db, { localId: "c1", name: "M - Ana LOPEZ (Det. at CoreCivic)" });
    expect(detention(db)).toEqual({ at: "CoreCivic", source: "name" });
  });

  test("the profile's name counts while the client is active, not for an old case", () => {
    const db = freshDb("Ana LOPEZ (DETAINED IN CORE CIVIC)");
    appt(db, { localId: "a1", date: "2025-01-10" });
    expect(detention(db)).toBeNull(); // last seen 2025: likely long gone

    appt(db, { localId: "a2", date: "2026-10-12" });
    expect(detention(db)).toEqual({ at: "Core Civic", source: "name" });
  });

  test("a recent appointment from a jail intake — no court case, no name note", () => {
    const db = freshDb("Gerbert Yoalmo BERMUDEZ-PAZ");
    appt(db, { localId: "a1", date: "2026-10-05", intake: true });
    expect(detention(db)).toEqual({ at: null, source: "intake" });
  });

  test("a detainee appointment status", () => {
    const db = freshDb();
    appt(db, { localId: "a1", date: "2026-09-02", status: "Det Hire" });
    expect(detention(db)).toEqual({ at: null, source: "appointment" });
    const db2 = freshDb();
    appt(db2, { localId: "a1", date: "2026-10-22", status: "Today's consult (detainee)" });
    expect(getDetention(db2, "p1", { today: TODAY })?.source).toBe("appointment");
  });

  test("an old jail-intake appointment no longer counts", () => {
    const db = freshDb();
    appt(db, { localId: "a1", date: "2026-01-05", intake: true });
    expect(detention(db)).toBeNull();
  });

  test("an ordinary client is not detained", () => {
    const db = freshDb();
    courtCase(db, { localId: "c1" });
    appt(db, { localId: "a1", date: "2026-10-01", status: "Hire" });
    expect(detention(db)).toBeNull();
  });
});

describe("a release switches it off", () => {
  test("a name that still says detained stops counting", () => {
    const db = freshDb("Ana LOPEZ (Det. at CoreCivic)");
    courtCase(db, { localId: "c1", name: "M - Ana LOPEZ (Det. at CoreCivic)" });
    expect(detention(db)?.source).toBe("name");
    release(db, "2026-10-20");
    expect(detention(db)).toBeNull();
  });

  test("an appointment before the release stops counting, one after brings it back", () => {
    const db = freshDb();
    appt(db, { localId: "a1", date: "2026-09-01", intake: true });
    release(db, null, "2026-09-20 12:00:00"); // no date given: when it was recorded
    expect(detention(db)).toBeNull();
    appt(db, { localId: "a2", date: "2026-10-15", status: "Det Hire" });
    expect(detention(db)).toEqual({ at: null, source: "appointment" });
  });

  test("the synced E&A entry counts as a release too", () => {
    const db = freshDb("Ana LOPEZ (Det. at CoreCivic)");
    appt(db, { localId: "a1", date: "2026-09-01" });
    db.prepare(`
      INSERT INTO client_updates (batch_id, local_id, profile_local_id, author_name, title, text_body, source_type, created_at_source)
      VALUES (1, 'u1', 'p1', 'Staff', 'Released from detention — CoreCivic', 'Bond paid', 'activity', '2026-09-10T15:00:00Z')
    `).run();
    expect(detention(db)).toBeNull();
  });

  test("a release is matched by the profile's Monday id, so it survives a re-sync", () => {
    const db = freshDb("Ana LOPEZ (Det. at CoreCivic)");
    appt(db, { localId: "a1", date: "2026-10-01" });
    release(db, "2026-10-10");
    db.prepare("UPDATE profiles SET local_id = 'p9' WHERE local_id = 'p1'").run();
    db.prepare("UPDATE board_items SET profile_local_id = 'p9'").run();
    expect(getDetention(db, "p9", { today: TODAY })).toBeNull();
  });
});

describe("batch", () => {
  test("answers for many profiles at once, leaving out the ones not detained", () => {
    const db = freshDb("Ana LOPEZ (Det. at CoreCivic)");
    db.prepare("INSERT INTO profiles (batch_id, local_id, monday_item_id, name) VALUES (1, 'p2', 'm2', 'Rosa PEREZ')").run();
    appt(db, { localId: "a1", date: "2026-10-01" });
    const m = batchGetDetentions(db, ["p1", "p2", "", "p1"], { today: TODAY });
    expect([...m.keys()]).toEqual(["p1"]);
    expect(batchGetDetentions(db, [], { today: TODAY }).size).toBe(0);
  });
});
