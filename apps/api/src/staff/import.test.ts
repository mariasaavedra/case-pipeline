import { describe, expect, test } from "vitest";
import { makeRosterDb } from "./test-db.js";
import { addAlias, createStaff, getStaff, listStaff, setRoles } from "./roster.js";
import { applyStaffImport, parseStaffCsv, planStaffImport, rolesForClass } from "./import.js";

const HEADER = "name,email,monday_user_id,monday_status,slack_user_id,initials,class,rc_number,rc_ext";

describe("parseStaffCsv", () => {
  test("reads rows, lowercases email, uppercases Slack id", () => {
    const { rows, problems } = parseStaffCsv(
      `${HEADER}\nMiguel Gonzalez,MiguelG@firm.com,112429734,active,u0bmaep8eus,MG,Receptionist,(816) 895-9077,121\n`,
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        name: "Miguel Gonzalez",
        email: "miguelg@firm.com",
        mondayUserId: "112429734",
        active: true,
        slackUserId: "U0BMAEP8EUS",
        phoneExt: "121",
        className: "Receptionist",
      },
    ]);
  });

  test("refuses a DM channel id and a bad status", () => {
    const { rows, problems } = parseStaffCsv(
      `${HEADER}\nGina,gina@firm.com,1,active,D0C6U5KBWUS,GM,,,\nBob,bob@firm.com,2,retired,,,,,\n`,
    );
    expect(rows).toEqual([]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("not a Slack member id");
  });

  test("throws on a missing column", () => {
    expect(() => parseStaffCsv("name,email\nA,a@b.c")).toThrow(/monday_status/);
  });
});

describe("rolesForClass", () => {
  test("maps the firm's classes", () => {
    expect(rolesForClass("Court Paralegal")).toEqual(["paralegal", "court_paralegal"]);
    expect(rolesForClass("Receptionist")).toEqual(["reception"]);
    expect(rolesForClass("Assistant")).toBeNull();
    expect(rolesForClass(null)).toBeNull();
  });
});

describe("planStaffImport / applyStaffImport", () => {
  const csv = (...lines: string[]) => parseStaffCsv([HEADER, ...lines].join("\n")).rows;

  test("matches by Monday id, fills ext + Slack, keeps the roster name, adds the table's spelling", () => {
    const db = makeRosterDb();
    const id = createStaff(db, { name: "Cynthia de La Cruz", email: "cynthia@firm.com", mondayUserId: "32109228", source: "monday" });
    const plan = planStaffImport(db, csv("Cynthia de la Cruz,cynthia@firm.com,32109228,active,U0577UUUA2G,CD,Paralegal,,110"));
    expect(plan[0]).toMatchObject({ staffId: id, action: "update" });
    expect(plan[0]!.changes.map((c) => c.field)).toEqual(["phoneExt", "slackUserId", "roles"]);

    applyStaffImport(db, plan);
    const s = getStaff(db, id)!;
    expect(s).toMatchObject({ name: "Cynthia de La Cruz", phoneExt: "110", slackUserId: "U0577UUUA2G", roles: ["paralegal"] });
    expect(planStaffImport(db, csv("Cynthia de la Cruz,cynthia@firm.com,32109228,active,U0577UUUA2G,CD,Paralegal,,110"))[0]!.action).toBe(
      "same",
    );
  });

  test("a disabled Monday user is marked inactive", () => {
    const db = makeRosterDb();
    const id = createStaff(db, { name: "Quynh Vo", email: "quynh@firm.com", source: "monday" });
    applyStaffImport(db, planStaffImport(db, csv("Quynh Vo,quynh@firm.com,72064715,disabled,U08CG8MMWPK,QV,Assistant,,113")));
    expect(getStaff(db, id)).toMatchObject({ active: false, mondayUserId: "72064715", slackUserId: "U08CG8MMWPK", roles: [] });
  });

  test("matches by email, then by an alias", () => {
    const db = makeRosterDb();
    const a = createStaff(db, { name: "Nic Jestus", email: "nic@firm.com" });
    const b = createStaff(db, { name: "Rekha@Sharma- com" });
    addAlias(db, b, "Rekha Sharma-Crawford");
    const plan = planStaffImport(
      db,
      csv("Nicole Jestus,nic@firm.com,77161051,active,U08NZSW2V7X,Nic,Volunteer,,", "Rekha Sharma-Crawford,,,active,U056XPXQ7LM,R,Attorney,,102"),
    );
    expect(plan.map((p) => p.staffId)).toEqual([a, b]);
  });

  test("roles reviewed in Settings are kept, with a note", () => {
    const db = makeRosterDb();
    const id = createStaff(db, { name: "Rafael Contreras", email: "rafael@firm.com" });
    setRoles(db, id, ["manager"]);
    const plan = planStaffImport(db, csv("Rafael Contreras,rafael@firm.com,32138050,active,U0192NZ1P6E,RC,Paralegal,,108"));
    expect(plan[0]!.changes.some((c) => c.field === "roles")).toBe(false);
    expect(plan[0]!.note).toContain("kept");
    applyStaffImport(db, plan);
    expect(getStaff(db, id)!.roles).toEqual(["manager"]);
  });

  test("never replaces a different Monday id", () => {
    const db = makeRosterDb();
    createStaff(db, { name: "Laura Torres", email: "laura@firm.com", mondayUserId: "999" });
    const plan = planStaffImport(db, csv("Laura Torres,laura@firm.com,32138066,active,U057J3HVB0R,LT,Paralegal,,107"));
    expect(plan[0]!.action).toBe("skip");
  });

  test("a Slack id on two people is skipped", () => {
    const db = makeRosterDb();
    createStaff(db, { name: "Someone Else", slackUserId: "U0BENDJEL75" });
    const plan = planStaffImport(db, csv("Caitlin Riffer,caitlin@firm.com,107882254,active,U0BENDJEL75,CR,,,"));
    expect(plan[0]).toMatchObject({ action: "skip" });
    expect(plan[0]!.note).toContain("Someone Else");
  });

  test("someone not on the roster is created", () => {
    const db = makeRosterDb();
    const plan = planStaffImport(db, csv("Gina Mathew,gina@firm.com,118587903,active,U0C6CREHV2B,GM,,,"));
    expect(plan[0]!.action).toBe("create");
    expect(applyStaffImport(db, plan)).toMatchObject({ created: 1 });
    expect(listStaff(db)[0]).toMatchObject({ name: "Gina Mathew", mondayUserId: "118587903", source: "monday", slackUserId: "U0C6CREHV2B" });
  });
});
