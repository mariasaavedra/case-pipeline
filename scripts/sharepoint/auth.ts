// =============================================================================
// Graph auth — device code (delegated), with app-only as an option
// =============================================================================
// The firm's app registration holds a DELEGATED Files.ReadWrite.All grant that
// is already admin-consented and in daily use by the dashboard. Rather than add
// an application permission, this signs in as a real person once via the device
// code flow and keeps the refresh token, so scheduled runs need no browser.
//
// What that buys, beyond avoiding an Azure change: the script can only ever
// touch what the signed-in person can already touch in SharePoint. An app-only
// identity has no such ceiling.
//
// What it costs: the refresh token is not eternal. Entra expires it after ~90
// days of disuse, and a Conditional Access policy can cut it short. When it
// lapses the next run fails with a clear instruction to re-run `--login`; it
// does not silently stop working.
//
// The refresh token is a credential. It is written to data/ (gitignored) with
// owner-only permissions and encrypted at rest when APP_ENCRYPTION_KEY is set,
// reusing the same helper that protects Monday OAuth tokens.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { protect, reveal } from "../../apps/api/src/crypto/secrets.js";
import { GraphError, type GraphAuth } from "./graph-client.js";

/** Same tenant the SPA and the API already validate against. */
const DEFAULT_TENANT_ID = "9fde682a-6a44-4a86-a796-519ca573b1f5";

/**
 * The dashboard's own app registration (apps/web/src/auth/msal-config.ts).
 * Reused deliberately: its delegated Files.ReadWrite.All is already consented,
 * so no new permission is needed. Device code additionally requires "Allow
 * public client flows" to be enabled on it. A client id is not a secret.
 */
const DEFAULT_CLIENT_ID = "2b0a7d88-6a8b-4913-90a7-9926fd8f6335";

/** offline_access is what makes the refresh token — without it every run prompts. */
const SCOPES = "https://graph.microsoft.com/Files.ReadWrite.All offline_access";

const TOKEN_CACHE = path.join("data", ".graph-token.json");

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function tenantId(): string {
  return process.env.GRAPH_TENANT_ID?.trim() || DEFAULT_TENANT_ID;
}
function clientId(): string {
  return process.env.GRAPH_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
}
const tokenUrl = () => `https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/token`;

// ---- Cache ------------------------------------------------------------------

interface Cache {
  refreshToken: string;
  account: string | null;
  savedAt: string;
}

function readCache(): Cache | null {
  try {
    const raw = JSON.parse(fs.readFileSync(TOKEN_CACHE, "utf8")) as Cache;
    return raw.refreshToken ? raw : null;
  } catch {
    return null;
  }
}

function writeCache(refreshToken: string, account: string | null): void {
  fs.mkdirSync(path.dirname(TOKEN_CACHE), { recursive: true });
  const body: Cache = { refreshToken: protect(refreshToken), account, savedAt: new Date().toISOString() };
  // mode on writeFileSync only applies at creation, so chmod unconditionally —
  // a cache written before this line existed would otherwise stay world-readable.
  fs.writeFileSync(TOKEN_CACHE, JSON.stringify(body, null, 2), { mode: 0o600 });
  fs.chmodSync(TOKEN_CACHE, 0o600);
}

export function clearCachedLogin(): boolean {
  if (!fs.existsSync(TOKEN_CACHE)) return false;
  fs.rmSync(TOKEN_CACHE);
  return true;
}

export function cachedAccount(): string | null {
  return readCache()?.account ?? null;
}

// ---- Device code ------------------------------------------------------------

/**
 * Run the device code flow, printing the code for the operator. Blocks until
 * they finish signing in, then stores the refresh token.
 */
export async function deviceLogin(): Promise<void> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), scope: SCOPES }),
  });
  const flow = (await res.json()) as {
    device_code?: string; user_code?: string; verification_uri?: string;
    interval?: number; expires_in?: number; error?: string; error_description?: string;
  };

  if (!res.ok || !flow.device_code) {
    // AADSTS7000218 is the giveaway that "Allow public client flows" is still off.
    throw new GraphError(res.status, flow.error_description ?? flow.error ?? "Could not start device login", flow.error);
  }

  console.log(`\n  Open   ${flow.verification_uri}`);
  console.log(`  Code   ${flow.user_code}\n`);
  console.log("  Waiting for sign-in…");

  const deadline = Date.now() + (flow.expires_in ?? 900) * 1000;
  let intervalMs = (flow.interval ?? 5) * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const poll = await fetch(tokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId(),
        device_code: flow.device_code,
      }),
    });
    const body = (await poll.json()) as TokenResponse;

    if (poll.ok && body.access_token) {
      if (!body.refresh_token) {
        throw new GraphError(500, "Signed in but no refresh token was issued — is offline_access in the scopes?");
      }
      writeCache(body.refresh_token, accountFrom(body.access_token));
      console.log(`  Signed in as ${accountFrom(body.access_token) ?? "(unknown account)"}.`);
      console.log(`  Refresh token saved to ${TOKEN_CACHE} (owner-only).`);
      return;
    }

    if (body.error === "authorization_pending") continue;
    // Entra asks us to back off; obey rather than hammering the endpoint.
    if (body.error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    throw new GraphError(poll.status, body.error_description ?? body.error ?? "Device login failed", body.error);
  }

  throw new GraphError(408, "Device login timed out — run the command again.");
}

/**
 * Best-effort account name for logging. The id token is not validated here: it
 * is used only to print who is signed in, never to authorise anything.
 */
function accountFrom(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      upn?: string; preferred_username?: string; unique_name?: string;
    };
    return claims.upn ?? claims.preferred_username ?? claims.unique_name ?? null;
  } catch {
    return null;
  }
}

// ---- Auth providers ---------------------------------------------------------

class DeviceCodeAuth implements GraphAuth {
  private token: { value: string; expiresAt: number } | null = null;

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;

    const cache = readCache();
    if (!cache) {
      throw new GraphError(401, "Not signed in — run the command again with --login.");
    }

    let refreshToken: string;
    try {
      refreshToken = reveal(cache.refreshToken);
    } catch {
      // The cache is encrypted but APP_ENCRYPTION_KEY is absent — almost always
      // means the script was run without .env loaded, not that anything is
      // broken. Say so, because "cannot decrypt secret" sends people hunting.
      throw new GraphError(
        401,
        "The saved sign-in is encrypted and APP_ENCRYPTION_KEY is not in the environment.\n" +
          "Run it through the npm script (which loads .env):\n" +
          "  npm run sharepoint:folders -- …",
      );
    }

    const res = await fetch(tokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId(),
        refresh_token: refreshToken,
        scope: SCOPES,
      }),
    });
    const body = (await res.json()) as TokenResponse;

    if (!res.ok || !body.access_token) {
      throw new GraphError(
        res.status,
        `${body.error_description ?? body.error ?? "Refresh failed"}\n` +
          "The saved sign-in has lapsed (Entra expires these after ~90 days, sooner under\n" +
          "Conditional Access). Run the command again with --login.",
        body.error,
      );
    }

    // Entra rotates refresh tokens; persist the new one or the next run re-prompts.
    if (body.refresh_token) writeCache(body.refresh_token, cache.account);

    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max((body.expires_in ?? 3600) - 60, 60) * 1000,
    };
    return this.token.value;
  }

  describe(): string {
    return `delegated as ${cachedAccount() ?? "(signed-in user)"}`;
  }
}

/**
 * App-only, for if the firm later grants an application permission. Kept
 * because it is the only way to run with nobody signed in at all.
 */
class AppOnlyAuth implements GraphAuth {
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private readonly secret: string) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;

    const res = await fetch(tokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: this.secret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });
    const body = (await res.json()) as TokenResponse;
    if (!res.ok || !body.access_token) {
      throw new GraphError(res.status, body.error_description ?? body.error ?? "Token request failed", body.error);
    }
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max((body.expires_in ?? 3600) - 60, 60) * 1000,
    };
    return this.token.value;
  }

  describe(): string {
    return "app-only (client credentials)";
  }
}

/** Device code unless a client secret is configured. */
export function graphAuthFromEnv(): GraphAuth {
  const secret = process.env.GRAPH_CLIENT_SECRET?.trim();
  return secret ? new AppOnlyAuth(secret) : new DeviceCodeAuth();
}
