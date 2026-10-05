import { describe, expect, test } from "vitest";
import { mapColumnsByTitle, planConsultSchedule, targetGroup } from "./consult-schedule.js";

const col = (columnId: string, title: string, type: string) => ({ columnId, title, type, options: [], position: 0 });

describe("mapColumnsByTitle", () => {
  // Shapes taken from the live M and R appointment boards.
  const m = [
    col("name", "Name", "name"),
    col("date3__1", "Consult Date", "date"),
    col("people__1", "Attorney", "people"),
    col("connect_boards4__1", "Profiles", "board_relation"),
    col("text_mkn3gp82", "Consult SharePoint", "text"),
    col("text_mm3twt5f", "First Name", "text"),
    col("mirror_mkm0rr7g", "Case No.", "mirror"),
    col("long_text_mm0af4tz", "M Consult Note", "long_text"),
    col("pulse_log_mm7gqpnx", "Creation log", "creation_log"),
  ];
  const r = [
    col("name", "Name", "name"),
    col("date3__1", "Consult Date", "date"),
    col("people__1", "Attorney", "people"),
    col("connect_boards4__1", "Profiles", "board_relation"),
    col("text_mkn3jmhc", "Consult SharePoint", "text"),
    col("text_mm3t8mqn", "First Name", "text"),
    col("mirror_mkkzsk0v", "Case No.", "mirror"),
    col("pulse_log_mm7g7mjp", "Creation log", "creation_log"),
  ];

  test("names every source column but Name, by id then title + type", () => {
    expect(mapColumnsByTitle(m, r)).toEqual([
      { source: "date3__1", target: "date3__1" },
      { source: "people__1", target: "people__1" },
      { source: "connect_boards4__1", target: "connect_boards4__1" },
      { source: "text_mkn3gp82", target: "text_mkn3jmhc" },
      { source: "text_mm3twt5f", target: "text_mm3t8mqn" },
      { source: "mirror_mkm0rr7g", target: null },       // computed: re-fills from the relation
      { source: "long_text_mm0af4tz", target: null },    // M's own column: nowhere to go
      { source: "pulse_log_mm7gqpnx", target: null },
    ]);
  });

  test("uses a target column once", () => {
    const src = [col("a", "Notes", "text"), col("b", "notes", "text")];
    expect(mapColumnsByTitle(src, [col("x", "Notes", "text")])).toEqual([
      { source: "a", target: "x" },
      { source: "b", target: null },
    ]);
  });

  test("never maps across types", () => {
    expect(mapColumnsByTitle([col("a", "Phone", "text")], [col("b", "Phone", "phone")])).toEqual([{ source: "a", target: null }]);
  });
});

describe("planConsultSchedule", () => {
  const cur = { boardKey: "appointments_m", date: "2026-10-05", time: "10:00" };
  const boards = ["appointments_m", "appointments_r", "appointments_lb"];

  test("a new time on the same board", () => {
    expect(planConsultSchedule({ date: "2026-10-05", time: "11:30", boardKey: "appointments_m" }, cur, boards)).toEqual({
      plan: { date: "2026-10-05", time: "11:30", boardKey: "appointments_m", moved: false, dateChanged: true },
    });
  });

  test("another attorney, same slot", () => {
    expect(planConsultSchedule({ date: "2026-10-05", time: "10:00", boardKey: "appointments_r" }, cur, boards)).toEqual({
      plan: { date: "2026-10-05", time: "10:00", boardKey: "appointments_r", moved: true, dateChanged: false },
    });
  });

  test("refusals", () => {
    expect(planConsultSchedule({ date: "2026-10-05", time: "10:00", boardKey: "appointments_m" }, cur, boards)).toEqual({ error: "Nothing changed" });
    expect(planConsultSchedule({ date: "Oct 5", time: "10:00" }, cur, boards)).toEqual({ error: "Pick a date" });
    expect(planConsultSchedule({ date: "2026-10-05", time: "10am" }, cur, boards)).toEqual({ error: "Time must be HH:MM" });
    expect(planConsultSchedule({ date: "2026-10-05", time: "10:00", boardKey: "appointments_x" }, cur, boards))
      .toEqual({ error: "Pick an attorney who is taking consults" });
  });

  test("clearing the time is a change", () => {
    expect(planConsultSchedule({ date: "2026-10-05", time: "" }, cur, boards)).toMatchObject({ plan: { time: null, dateChanged: true } });
  });
});

describe("targetGroup", () => {
  const groups = [
    { id: "past", title: "Past Consults" },
    { id: "topics", title: "Upcoming" },
    { id: "today", title: "Today's consults" },
  ];
  test("same group title as on the old board", () => {
    expect(targetGroup(groups, "past consults", false)?.id).toBe("past");
  });
  test("else by date", () => {
    expect(targetGroup(groups, "Something else", true)?.id).toBe("today");
    expect(targetGroup(groups, null, false)?.id).toBe("topics");
  });
});
