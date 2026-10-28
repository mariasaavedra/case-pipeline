// =============================================================================
// Target dates digest tests
// =============================================================================
// What matters: counts first, overdue then due-this-week grouped by paralegal
// (a shared case under each), a long list capped, a quiet day says so, and
// the DM goes only to Slack member ids.

import { describe, it, expect } from "vitest";
import type { TargetDateCase, TargetBucket } from "@case-pipeline/query";
import { buildTargetDatesDigest, DIGEST_MAX_LINES } from "./target-dates-digest.js";
import { createSlackNotifier } from "./slack.js";
import { defaultNotifySettings } from "./settings.js";

function c(over: Partial<TargetDateCase>): TargetDateCase {
  return {
    localId: "x", clientName: "Ana LOPEZ", clientLocalId: null, formName: "I-130 Ana", status: null, targetDate: "2026-10-30",
    urgency: "soon", daysUntilTarget: 4, dateUrgency: "soon", statusUrgency: "none", isCourtCase: false, assignees: ["Mayra Ruiz"],
    priority: null, forms: ["I130"], attorney: null, urgent: false, northPoleUntil: null, snoozed: false, parked: false,
    mondayItemId: "1", eFile: null, eFileOnProfile: false, formsApptDate: null, formsSentDate: null, hireDate: null, onOpenFormsSince: null,
    bucket: "week", daysLeft: 4, moves: 0, lastChange: null, ...over,
  };
}
const counts = (o: Partial<Record<TargetBucket, number>> = {}) => ({ overdue: 0, week: 0, twoWeeks: 0, later: 0, none: 0, ...o });

describe("buildTargetDatesDigest", () => {
  it("counts, then overdue and due this week by paralegal, then the link", () => {
    const text = buildTargetDatesDigest({
      today: "2026-10-26",
      counts: counts({ overdue: 1, week: 1, none: 3 }),
      cases: [
        c({ clientName: "Ben <B>", bucket: "overdue", daysLeft: -9, targetDate: "2026-10-17", moves: 2, assignees: ["Mayra Ruiz", "Lucy B"] }),
        c({ bucket: "week", daysLeft: 1, targetDate: "2026-10-27" }),
        c({ clientName: "Later", bucket: "later", daysLeft: 40 }),
      ],
    }, "https://app.example/target-dates");
    expect(text).toBe([
      ":dart: *Target dates — Mon, Oct 26*",
      "1 overdue · 1 due this week · 0 next week · 3 with no date",
      "",
      "*Overdue (1)*",
      "_Lucy B_",
      "• Ben &lt;B&gt; — I130 · 9 days late (Oct 17) · moved 2×",
      "_Mayra Ruiz_",
      "• Ben &lt;B&gt; — I130 · 9 days late (Oct 17) · moved 2×",
      "*Due in the next 7 days (1)*",
      "_Mayra Ruiz_",
      "• Ana LOPEZ — I130 · due tomorrow (Oct 27)",
      "",
      "<https://app.example/target-dates|Open Target Dates>",
    ].join("\n"));
  });

  it("says so on a quiet day", () => {
    const text = buildTargetDatesDigest({ today: "2026-10-26", counts: counts({ none: 2 }), cases: [] }, null);
    expect(text).toContain("Nothing overdue or due this week.");
    expect(text).not.toContain("Open Target Dates");
  });

  it("caps a long list", () => {
    const many = Array.from({ length: DIGEST_MAX_LINES + 5 }, (_, i) => c({ localId: String(i), bucket: "overdue", daysLeft: -1 }));
    const text = buildTargetDatesDigest({ today: "2026-10-26", counts: counts({ overdue: many.length }), cases: many }, null);
    expect(text.split("\n").filter((l) => l.startsWith("• "))).toHaveLength(DIGEST_MAX_LINES);
    expect(text).toContain("…and 5 more");
  });
});

describe("dmEvent", () => {
  it("messages each member id once, skips anything that isn't one, obeys the switch", async () => {
    const sent: string[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body).channel);
      return { status: 200, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    const settings = defaultNotifySettings();
    const slack = createSlackNotifier({ env: { SLACK_MODE: "on", SLACK_BOT_TOKEN: "xoxb-1" }, settings: () => settings, fetchImpl, log: () => {} });

    expect(await slack.dmEvent("target_dates_digest", ["U0123456789", "U0123456789", "C0123456789", "bob"], "hi"))
      .toEqual({ sent: 1, errors: [] });
    expect(sent).toEqual(["U0123456789"]);

    settings.events.target_dates_digest.enabled = false;
    expect((await slack.dmEvent("target_dates_digest", ["U0123456789"], "hi")).sent).toBe(0);
    expect(sent).toHaveLength(1);
  });
});
