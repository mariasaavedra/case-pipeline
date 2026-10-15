// =============================================================================
// RingCentral SMS — the smallest client that sends a text
// =============================================================================
// Server-to-server: one JWT credential (a RingCentral user the firm picked), no
// per-staff sign-in. Texts go out from RINGCENTRAL_FROM_NUMBER, which must be
// an SMS-enabled number on that user's extension and registered for A2P 10DLC
// — carriers drop unregistered business texts silently. See
// docs/features/sms-and-slack.md.
//
// Plain fetch, no SDK: two endpoints (token, send) and one read (status).
// `fetchImpl` is injectable so the tests never reach RingCentral.
// =============================================================================

export type SmsMode = "off" | "dry-run" | "on";

export function smsMode(env: NodeJS.ProcessEnv = process.env): SmsMode {
  const v = env.SMS_MODE?.trim().toLowerCase();
  return v === "on" || v === "dry-run" ? v : "off";
}

export interface RingCentralConfig {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  jwt: string;
  fromNumber: string;
}

/** The config when every variable is set, else null. Never logs values. */
export function ringCentralConfig(env: NodeJS.ProcessEnv = process.env): RingCentralConfig | null {
  const serverUrl = (env.RINGCENTRAL_SERVER_URL?.trim() || "https://platform.ringcentral.com").replace(/\/+$/, "");
  const clientId = env.RINGCENTRAL_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.RINGCENTRAL_CLIENT_SECRET?.trim() ?? "";
  const jwt = env.RINGCENTRAL_JWT?.trim() ?? "";
  const fromNumber = env.RINGCENTRAL_FROM_NUMBER?.trim() ?? "";
  if (!clientId || !clientSecret || !jwt || !fromNumber) return null;
  return { serverUrl, clientId, clientSecret, jwt, fromNumber };
}

/** A send RingCentral refused or couldn't take. `status` is the HTTP status (0 = network). */
export class RingCentralError extends Error {
  constructor(message: string, readonly status: number, readonly errorCode?: string) {
    super(message);
    this.name = "RingCentralError";
  }
}

export interface SentSms {
  /** RingCentral message-store id — what a later status check reads. */
  id: string;
  /** "Queued" / "Sent" / "Delivered" / "DeliveryFailed" / "SendingFailed". */
  status: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class RingCentralClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: RingCentralConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async accessToken(): Promise<string> {
    // Renewed a minute early so a token never expires mid-request.
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const { serverUrl, clientId, clientSecret, jwt } = this.config;
    const res = await this.call(`${serverUrl}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString(),
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new RingCentralError("RingCentral sign-in returned no token", res.status);
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  /** Send one text. `to` must already be E.164. */
  async sendSms(to: string, text: string): Promise<SentSms> {
    const token = await this.accessToken();
    const res = await this.call(`${this.config.serverUrl}/restapi/v1.0/account/~/extension/~/sms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: { phoneNumber: this.config.fromNumber }, to: [{ phoneNumber: to }], text }),
    });
    const body = (await res.json()) as { id?: number | string; messageStatus?: string };
    return { id: String(body.id ?? ""), status: body.messageStatus ?? "Queued" };
  }

  /** Current delivery status of a sent text. */
  async messageStatus(id: string): Promise<string> {
    const token = await this.accessToken();
    const res = await this.call(
      `${this.config.serverUrl}/restapi/v1.0/account/~/extension/~/message-store/${encodeURIComponent(id)}`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    );
    const body = (await res.json()) as { messageStatus?: string };
    return body.messageStatus ?? "Unknown";
  }

  /** fetch, with RingCentral's error body turned into a readable RingCentralError. */
  private async call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (err) {
      throw new RingCentralError(`RingCentral unreachable: ${(err as Error).message}`, 0);
    }
    if (res.ok) return res;
    // A 401 on a cached token: drop it so the next call signs in again.
    if (res.status === 401) this.token = null;
    let message = `RingCentral HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const b = (await res.json()) as { message?: string; error_description?: string; errorCode?: string; errors?: { message?: string }[] };
      message = b.errors?.[0]?.message ?? b.message ?? b.error_description ?? message;
      code = b.errorCode;
    } catch {
      /* not JSON */
    }
    throw new RingCentralError(message, res.status, code);
  }
}

let shared: RingCentralClient | null = null;

/** The process-wide client (keeps its token), or null when not configured. */
export function ringCentral(): RingCentralClient | null {
  if (shared) return shared;
  const config = ringCentralConfig();
  if (!config) return null;
  shared = new RingCentralClient(config);
  return shared;
}
