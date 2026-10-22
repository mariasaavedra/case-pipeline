import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSlackQueueTableSql, queueConsultReady, listQueue, editQueued, deleteQueued, runSlackQueue, recoverInterrupted,
  getQueued, LATE_LIMIT_MIN,
} from "./slack-queue.js";
import { consultReadyText, firmTimeToUtc, utcToFirmTime, parseQueueInput } from "./consult-ready.js";

describe("consultReadyText", () => {
  it("matches the message reception posts by hand", () => {
    expect(consultReadyText({
      badge: "LB", time: "13:00", interpreter: { need: "No" }, method: "Zoom",
      zoomLink: "https://us06web.zoom.us/j/898?pwd=x", attorneyName: "Lucy Betteridge", attorneySlackId: "U057V5Y497A",
    })).toBe("*LB's 1:00 PM Ready*\nNo Intr Needed\n<https://us06web.zoom.us/j/898?pwd=x|Zoom>\n<@U057V5Y497A>");
  });

  it("never puts a phone number in, and names the attorney without a Slack id", () => {
    const t = consultReadyText({
      badge: "R", time: "09:30", interpreter: { need: "Spanish" }, method: "Phone",
      attorneyName: "Rekha Sharma-Crawford", attorneySlackId: null,
    });
    expect(t).toBe("*R's 9:30 AM Ready*\nSpanish Intr Needed\nPhone call\nRekha Sharma-Crawford");
  });

  it("other language: the client brings their own; no prep = just the headline + attorney", () => {
    expect(consultReadyText({
      badge: "M", time: null, interpreter: { need: "Other language", language: "Vietnamese" }, method: "Other",
      methodOther: "In person", attorneyName: null, attorneySlackId: "U1234567",
    })).toBe("*M's Ready*\nVietnamese Intr — client brings their own\nIn person\n<@U1234567>");
    expect(consultReadyText({ badge: "LB", time: "13:00", interpreter: null, method: null, attorneyName: null, attorneySlackId: null }))
      .toBe("*LB's 1:00 PM Ready*");
  });
});

describe("firm time", () => {
  it("converts Central wall-clock to UTC on both sides of DST", () => {
    expect(firmTimeToUtc("2026-10-21", "13:00")).toBe("2026-10-21T18:00:00.000Z"); // CDT, UTC-5
    expect(firmTimeToUtc("2026-12-01", "13:00")).toBe("2026-12-01T19:00:00.000Z"); // CST, UTC-6
    expect(utcToFirmTime("2026-10-21T18:00:00.000Z")).toEqual({ date: "2026-10-21", time: "13:00" });
  });

  it("parseQueueInput refuses an empty message or a missing time", () => {
    expect(parseQueueInput({ text: " ", sendDate: "2026-10-21", sendTime: "13:00" }).ok).toBe(false);
    expect(parseQueueInput({ text: "hi", sendDate: "2026-10-21" }).ok).toBe(false);
    expect(parseQueueInput({ text: "hi" }, { partial: true })).toEqual({ ok: true, text: "hi" });
  });
});

describe("slack queue", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(createSlackQueueTableSql);
  });

  const queue = (sendAt: string, appt = "111") =>
    queueConsultReady(db, { appointmentMondayId: appt, boardKey: "appointments_lb", text: "*LB's 1:00 PM Ready*", sendAt, by: "Ana" });

  it("one waiting message per appointment: queueing again replaces it", () => {
    const a = queue("2026-10-21T18:00:00.000Z");
    const b = queue("2026-10-21T19:00:00.000Z");
    expect(b.replaced).toBe(true);
    expect(b.row.id).toBe(a.row.id);
    expect(listQueue(db, "2026-10-21T05:00:00.000Z")).toHaveLength(1);
  });

  it("posts what is due, once, and records dry runs", async () => {
    const due = queue("2026-10-21T18:00:00.000Z").row;
    queue("2026-10-21T20:00:00.000Z", "222");
    const posts: string[] = [];
    const post = async (t: string) => { posts.push(t); return { ok: true as const, dryRun: true }; };
    const now = () => new Date("2026-10-21T18:00:30.000Z");
    expect((await runSlackQueue(db, { post, now })).sent).toEqual([due.id]);
    expect((await runSlackQueue(db, { post, now })).sent).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(getQueued(db, due.id)).toMatchObject({ status: "sent", dryRun: true });
    // A sent message can't be edited or deleted.
    expect(editQueued(db, due.id, { text: "x" }, "Ana")).toBeNull();
    expect(deleteQueued(db, due.id, "Ana")).toBe(false);
  });

  it("a refused post is failed; editing it puts it back in the queue (Retry)", async () => {
    const row = queue("2026-10-21T18:00:00.000Z").row;
    await runSlackQueue(db, {
      post: async () => ({ ok: false as const, error: "channel_not_found" }),
      now: () => new Date("2026-10-21T18:01:00.000Z"),
    });
    expect(getQueued(db, row.id)).toMatchObject({ status: "failed", error: "channel_not_found" });
    expect(editQueued(db, row.id, { sendAt: "2026-10-21T18:05:00.000Z" }, "Ana")).toMatchObject({ status: "queued", error: null });
  });

  it("does not post a message that is over the late limit", async () => {
    const row = queue("2026-10-21T18:00:00.000Z").row;
    let posted = false;
    await runSlackQueue(db, {
      post: async () => { posted = true; return { ok: true as const, dryRun: false }; },
      now: () => new Date(Date.parse("2026-10-21T18:00:00.000Z") + (LATE_LIMIT_MIN + 1) * 60_000),
    });
    expect(posted).toBe(false);
    expect(getQueued(db, row.id)?.status).toBe("failed");
  });

  it("deleted messages leave the list; interrupted sends become failed", () => {
    const a = queue("2026-10-21T18:00:00.000Z").row;
    const b = queue("2026-10-21T18:00:00.000Z", "222").row;
    expect(deleteQueued(db, a.id, "Ana")).toBe(true);
    db.prepare("UPDATE slack_queue SET status = 'sending' WHERE id = ?").run(b.id);
    expect(recoverInterrupted(db)).toBe(1);
    expect(listQueue(db, "2026-10-21T05:00:00.000Z").map((r) => [r.id, r.status])).toEqual([[b.id, "failed"]]);
  });
});
