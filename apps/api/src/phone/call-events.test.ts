import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleCallEvent, parseCallEvent, reachedExtension, schedulingExtension, SeenCalls } from "./call-events";

const SECRET = "test-rc-webhook-secret-0123456789";

/** A telephony/sessions notification, trimmed to the fields RingCentral sends that we read. */
function notification(parties: unknown[], telephonySessionId = "s-1") {
  return {
    uuid: "u-1",
    event: "/restapi/v1.0/account/1/telephony/sessions",
    subscriptionId: "sub-1",
    body: { sequence: 3, sessionId: "123", telephonySessionId, accountId: "1", parties },
  };
}

const callerParty = (extensionId: string, code = "Answered", extensionNumber?: string) => ({
  id: "p-1",
  extensionId,
  direction: "Inbound",
  from: { phoneNumber: "+18165551234", name: "WIRELESS CALLER" },
  to: { phoneNumber: "+18169942300", extensionId, ...(extensionNumber ? { extensionNumber } : {}) },
  status: { code },
  missedCall: false,
});

describe("handleCallEvent", () => {
  beforeEach(() => {
    process.env.RC_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.RC_WEBHOOK_SECRET;
  });

  it("is 503 when not configured", () => {
    delete process.env.RC_WEBHOOK_SECRET;
    expect(handleCallEvent(SECRET, undefined, {}).status).toBe(503);
  });

  it("refuses a wrong token", () => {
    expect(handleCallEvent("nope", undefined, notification([callerParty("9")])).status).toBe(401);
  });

  it("echoes the subscription handshake's Validation-Token", () => {
    const r = handleCallEvent(SECRET, "abc123", undefined);
    expect(r.status).toBe(200);
    expect(r.headers).toEqual({ "Validation-Token": "abc123" });
    expect(r.event).toBeUndefined();
  });

  it("acknowledges an unknown payload without acting", () => {
    const r = handleCallEvent(SECRET, undefined, { body: { something: 1 } });
    expect(r).toMatchObject({ status: 200, body: { ignored: true } });
    expect(r.event).toBeUndefined();
  });

  it("hands back the parsed call event", () => {
    const r = handleCallEvent(SECRET, undefined, notification([callerParty("9")]));
    expect(r.status).toBe(200);
    expect(r.event?.telephonySessionId).toBe("s-1");
  });
});

describe("parseCallEvent", () => {
  it("reads the caller's number and each party", () => {
    const e = parseCallEvent(notification([callerParty("9", "Proceeding", "150")]))!;
    expect(e.callerNumber).toBe("+18165551234");
    expect(e.parties).toEqual([{ extensionId: "9", extensionNumber: "150", direction: "Inbound", status: "Proceeding" }]);
  });

  it("has no caller number for a hidden caller", () => {
    const p = { ...callerParty("9"), from: { name: "Anonymous" } };
    expect(parseCallEvent(notification([p]))!.callerNumber).toBeNull();
  });

  it("is null for anything that isn't a telephony session event", () => {
    expect(parseCallEvent(null)).toBeNull();
    expect(parseCallEvent({ body: { parties: [] } })).toBeNull();
    expect(parseCallEvent({ body: { telephonySessionId: "s", parties: "x" } })).toBeNull();
  });
});

describe("reachedExtension", () => {
  it("matches the extension by id", () => {
    const e = parseCallEvent(notification([callerParty("777")]))!;
    expect(reachedExtension(e, { id: "777", number: "150" })).toBe(true);
    expect(reachedExtension(e, { id: "778", number: "150" })).toBe(false);
  });

  it("falls back to the extension number when the id isn't known", () => {
    const e = parseCallEvent(notification([callerParty("777", "Answered", "150")]))!;
    expect(reachedExtension(e, { id: null, number: "150" })).toBe(true);
    expect(reachedExtension(e, { id: null, number: "151" })).toBe(false);
  });

  it("ignores outbound parties (staff calling the extension)", () => {
    const e = parseCallEvent(notification([{ ...callerParty("777"), direction: "Outbound" }]))!;
    expect(reachedExtension(e, { id: "777", number: "150" })).toBe(false);
  });
});

describe("SeenCalls", () => {
  it("lets a call through once, then again after it ages out", () => {
    let t = 0;
    const seen = new SeenCalls(() => t, 1000);
    expect(seen.first("s-1")).toBe(true);
    expect(seen.first("s-1")).toBe(false);
    expect(seen.first("s-2")).toBe(true);
    t = 2000;
    expect(seen.first("s-1")).toBe(true);
  });
});

describe("schedulingExtension", () => {
  it("takes an extension number, nothing else", () => {
    expect(schedulingExtension({ RC_SCHEDULING_EXTENSION: " 150 " })).toBe("150");
    expect(schedulingExtension({ RC_SCHEDULING_EXTENSION: "ext 150" })).toBeNull();
    expect(schedulingExtension({})).toBeNull();
  });
});
