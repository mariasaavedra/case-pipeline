import { describe, expect, test } from "vitest";
import { planConsultSchedule, targetGroup } from "./consult-schedule.js";

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
