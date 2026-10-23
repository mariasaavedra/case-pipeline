import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKFLOWS, WORKFLOW_GROUPS, describeCron } from "./catalog.js";
import { NOTIFY_EVENTS } from "../notify/settings.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const byKey = (k: string) => WORKFLOWS.find((w) => w.key === k)!;

describe("describeCron", () => {
  it.each([
    ["* * * * *", "Every minute"],
    ["0 * * * *", "Every hour"],
    ["*/2 * * * *", "Every 2 minutes"],
    ["*/15 7-20 * * *", "Every 15 minutes, 7 am–8 pm"],
    ["0 1 * * *", "Daily at 1 am"],
    ["30 5 * * *", "Daily at 5:30 am"],
    ["0 7-19/2 * * *", "Every 2 hours, 7 am–7 pm"],
    ["30 7-19/2 * * *", "Every 2 hours, 7:30 am–7:30 pm"],
    ["0 8-18/3 * * *", "Every 3 hours, 8 am–5 pm"],
  ])("%s → %s", (cron, words) => expect(describeCron(cron)).toBe(words));

  it("shows anything it doesn't know as the cron itself", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("0 9 * * 1-5");
    expect(describeCron("nonsense")).toBe("nonsense");
  });
});

describe("WORKFLOWS", () => {
  it("has unique keys, known groups and ops events, and docs that exist", () => {
    expect(new Set(WORKFLOWS.map((w) => w.key)).size).toBe(WORKFLOWS.length);
    const groups = new Set(WORKFLOW_GROUPS.map((g) => g.id));
    const ops = new Set(NOTIFY_EVENTS.map((e) => e.key));
    for (const w of WORKFLOWS) {
      expect(groups.has(w.group), w.key).toBe(true);
      if (w.opsEvent) expect(ops.has(w.opsEvent), w.key).toBe(true);
      if (w.doc) expect(fs.existsSync(path.join(REPO_ROOT, w.doc)), w.doc).toBe(true);
      expect(!!w.schedule, w.key).toBe(w.kind === "scheduled");
    }
  });

  it("scheduled jobs are off on seed data, except client uploads (plans only)", () => {
    const env = { NIGHTLY_SYNC: "on", MONDAY_API_TOKEN: "t", CLIENT_UPLOADS: "on", API_URL: "https://x" };
    expect(byKey("sync_full").enabled({ env, live: false })).toEqual({ on: false, reason: "Only runs on live data" });
    expect(byKey("client_uploads").enabled({ env, live: false })).toMatchObject({ on: true, reason: expect.stringContaining("plans only") });
  });

  it("names the missing setting, never a value", () => {
    expect(byKey("fee_k_autofill").enabled({ env: {}, live: true })).toEqual({ on: false, reason: "Off — FEE_K_AUTOFILL isn't on" });
    expect(byKey("fee_k_autofill").enabled({ env: { FEE_K_AUTOFILL: "on", MONDAY_API_TOKEN: "secret-token" }, live: true }))
      .toEqual({ on: false, reason: "Not set up — needs FEE_K_AUTOFILL_SINCE" });
    expect(byKey("esign").enabled({ env: { ZAPIER_ESIGN_SECRET: "s3cret" }, live: true }))
      .toEqual({ on: false, reason: "Not set up — needs ZAPIER_ESIGN_HOOK_URL, API_URL" });
  });

  it("uses the *_CRON override when set", () => {
    expect(byKey("drive_intake").schedule!({})).toEqual({ cron: "*/15 7-20 * * *", firmTime: true });
    expect(byKey("drive_intake").schedule!({ DRIVE_INTAKE_CRON: "*/5 * * * *" }).cron).toBe("*/5 * * * *");
  });
});
