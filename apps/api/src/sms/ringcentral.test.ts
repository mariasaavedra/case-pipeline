import { describe, it, expect } from "vitest";
import { RingCentralClient, RingCentralError, smsMode, ringCentralConfig } from "./ringcentral.js";

const config = {
  serverUrl: "https://platform.ringcentral.com",
  clientId: "cid",
  clientSecret: "secret",
  jwt: "a.b.c",
  fromNumber: "+18169942300",
};

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  };
  return { impl, calls };
}

describe("smsMode / ringCentralConfig", () => {
  it("defaults to off and accepts only known modes", () => {
    expect(smsMode({})).toBe("off");
    expect(smsMode({ SMS_MODE: " ON " })).toBe("on");
    expect(smsMode({ SMS_MODE: "dry-run" })).toBe("dry-run");
    expect(smsMode({ SMS_MODE: "yes" })).toBe("off");
  });

  it("needs every credential", () => {
    expect(ringCentralConfig({ RINGCENTRAL_CLIENT_ID: "x" })).toBeNull();
    expect(
      ringCentralConfig({
        RINGCENTRAL_CLIENT_ID: "x", RINGCENTRAL_CLIENT_SECRET: "y", RINGCENTRAL_JWT: "a.b.c", RINGCENTRAL_FROM_NUMBER: "+18169942300",
      })?.serverUrl,
    ).toBe("https://platform.ringcentral.com");
  });
});

describe("RingCentralClient", () => {
  it("signs in with the JWT once, then sends from the firm's number", async () => {
    const f = fakeFetch([
      { status: 200, body: { access_token: "tok", expires_in: 3600 } },
      { status: 200, body: { id: 42, messageStatus: "Queued" } },
      { status: 200, body: { id: 43, messageStatus: "Queued" } },
    ]);
    const rc = new RingCentralClient(config, f.impl);
    expect(await rc.sendSms("+18165551234", "Hi")).toEqual({ id: "42", status: "Queued" });
    await rc.sendSms("+18165551234", "Again");

    expect(f.calls.map((c) => c.url)).toEqual([
      "https://platform.ringcentral.com/restapi/oauth/token",
      "https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/sms",
      "https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/sms",
    ]);
    expect(String(f.calls[0]!.init.body)).toContain("assertion=a.b.c");
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("cid:secret").toString("base64")}`,
    );
    expect(JSON.parse(String(f.calls[1]!.init.body))).toEqual({
      from: { phoneNumber: "+18169942300" },
      to: [{ phoneNumber: "+18165551234" }],
      text: "Hi",
    });
  });

  it("signs in again once the token is about to expire", async () => {
    let now = 0;
    const f = fakeFetch([
      { status: 200, body: { access_token: "t1", expires_in: 120 } },
      { status: 200, body: { id: 1 } },
      { status: 200, body: { access_token: "t2", expires_in: 3600 } },
      { status: 200, body: { id: 2 } },
    ]);
    const rc = new RingCentralClient(config, f.impl, () => now);
    await rc.sendSms("+18165551234", "a");
    now = 61_000; // inside the last minute of t1
    await rc.sendSms("+18165551234", "b");
    expect((f.calls[3]!.init.headers as Record<string, string>).Authorization).toBe("Bearer t2");
  });

  it("turns RingCentral's error body into a readable error", async () => {
    const f = fakeFetch([
      { status: 200, body: { access_token: "tok", expires_in: 3600 } },
      { status: 400, body: { errorCode: "MSG-246", errors: [{ message: "Sending SMS from/to extension numbers is not available" }] } },
    ]);
    const rc = new RingCentralClient(config, f.impl);
    const err = await rc.sendSms("+18165551234", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RingCentralError);
    expect((err as RingCentralError).message).toBe("Sending SMS from/to extension numbers is not available");
    expect((err as RingCentralError).status).toBe(400);
    expect((err as RingCentralError).errorCode).toBe("MSG-246");
  });

  it("reports a network failure as status 0", async () => {
    const rc = new RingCentralClient(config, async () => { throw new Error("ECONNRESET"); });
    const err = (await rc.sendSms("+18165551234", "x").catch((e: unknown) => e)) as RingCentralError;
    expect(err.status).toBe(0);
    expect(err.message).toContain("ECONNRESET");
  });
});
