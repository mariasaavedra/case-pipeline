// =============================================================================
// Monday.com OAuth — per-user token exchange
// =============================================================================
// Flow:
//   1. POST /api/auth/monday/start   → (signed in) sets a nonce cookie, returns the consent URL
//   2. GET  /api/auth/monday/callback → exchange code, store token, redirect to frontend
//   3. GET  /api/auth/monday/status   → { connected, mondayName } for current user
//
// Until 2026-10-25 step 1 was a GET carrying the Azure token as ?az_token=
// (a navigation can't send headers), which put a live bearer token in access
// logs and browser history. And the signed state named an account without
// being tied to the browser, so a consent link started by one person could be
// forwarded and approved by another — saving the second person's Monday token
// on the first person's account. Now the browser that starts the flow holds a
// nonce cookie whose hash the state carries, and the callback requires both.
// =============================================================================

import type { Request, Response } from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { usersDb } from "../db/users-db.js";
import { protect, reveal } from "../crypto/secrets.js";
import { requireAuth } from "../auth/middleware.js";
import type { Router } from "express";

const CLIENT_ID     = process.env.MONDAY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.MONDAY_CLIENT_SECRET ?? "";
const FRONTEND_URL  = process.env.FRONTEND_URL ?? "http://localhost:5173";
// The redirect_uri registered in the Monday.com app must match exactly.
// Default: the API origin in dev. In production set API_URL in .env.
const API_URL       = process.env.API_URL ?? "http://localhost:3000";
const REDIRECT_URI  = `${API_URL}/api/auth/monday/callback`;

// ---------------------------------------------------------------------------
// State parameter — stateless HMAC so we avoid a session table
// State = `${azure_oid}:${ts}:${returnTo}:${sha256(nonce)}` signed with
// CLIENT_SECRET. returnTo is URI-encoded so it never contains the ":"
// separator. The nonce itself only ever lives in the starting browser's cookie.
// ---------------------------------------------------------------------------

/** The cookie that ties a consent flow to the browser that started it. */
export const NONCE_COOKIE = "mo_nonce";
const STATE_TTL_MS = 10 * 60 * 1000;

const hashNonce = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** One cookie's value from a raw Cookie header, or null. */
export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function nonceCookie(value: string, maxAgeSec: number): string {
  const secure = API_URL.startsWith("https:") ? "; Secure" : "";
  return `${NONCE_COOKIE}=${value}; Path=/api/auth/monday; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure}`;
}

const DEFAULT_RETURN = "/settings";

/** Only same-origin paths — never "//evil.com" or "/\\evil.com", which browsers read as another host. */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return DEFAULT_RETURN;
  }
  return raw;
}

export function signState(azureOid: string, returnTo: string, nonce: string, secret = CLIENT_SECRET): string {
  const payload = `${azureOid}:${Date.now()}:${encodeURIComponent(returnTo)}:${hashNonce(nonce)}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

/**
 * The state's account and return path, when its signature is good, it is under
 * 10 minutes old and `nonce` (the starting browser's cookie) matches it.
 */
export function verifyState(
  state: string,
  nonce: string | null,
  secret = CLIENT_SECRET,
): { azureOid: string; returnTo: string } | null {
  try {
    if (!secret || !nonce) return null;
    const decoded = Buffer.from(state, "base64url").toString();
    const lastColon = decoded.lastIndexOf(":");
    const payload = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    if (!safeEqual(sig, expected)) return null;
    const [azureOid = "", tsRaw = "0", returnRaw, nonceHash] = payload.split(":");
    if (!azureOid || !nonceHash || !safeEqual(nonceHash, hashNonce(nonce))) return null;
    if (Date.now() - parseInt(tsRaw, 10) > STATE_TTL_MS) return null;
    return { azureOid, returnTo: safeReturnPath(returnRaw ? decodeURIComponent(returnRaw) : undefined) };
  } catch {
    return null;
  }
}

/** FRONTEND_URL + path, with ?monday=connected added to whatever query it already has. */
function frontendUrl(path: string, status: string): string {
  const url = new URL(path, FRONTEND_URL);
  url.searchParams.set("monday", status);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function buildOAuthUrl(azureOid: string, returnTo: string, nonce: string): string {
  const state = signState(azureOid, returnTo, nonce);
  // Build manually to avoid encoding colons in scope (me:read not me%3Aread).
  // boards:write is required for change_simple_column_value (status write-back);
  // updates:write covers posting notes. Users must re-connect Monday to grant a
  // newly-added scope — an existing token keeps only the scopes it was issued with.
  const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state });
  return `https://auth.monday.com/oauth2/authorize?${params.toString()}&scope=me:read%20updates:write%20boards:write`;
}

/** POST /api/auth/monday/start — signed in; the browser then navigates to `url`. */
function handleStart(req: Request, res: Response): void {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(503).json({ error: "Monday.com OAuth not configured (MONDAY_CLIENT_ID / MONDAY_CLIENT_SECRET missing)" });
    return;
  }
  const azureOid = req.user?.oid ?? "";
  const nonce = randomBytes(32).toString("base64url");
  const returnTo = safeReturnPath((req.body as { returnTo?: unknown } | undefined)?.returnTo);
  res.setHeader("Set-Cookie", nonceCookie(nonce, STATE_TTL_MS / 1000));
  res.json({ data: { url: buildOAuthUrl(azureOid, returnTo, nonce) } });
}

/** The old GET entry point (?az_token=), for a stale tab or bookmark: start over from Settings. */
function handleOutdatedRedirect(_req: Request, res: Response): void {
  res.redirect(`${FRONTEND_URL}/settings?monday=error&reason=outdated`);
}

async function handleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query as Record<string, string>;
  // Single use, whatever happens next.
  const nonce = readCookie(req.headers.cookie, NONCE_COOKIE);
  res.setHeader("Set-Cookie", nonceCookie("", 0));

  if (error) {
    res.redirect(`${FRONTEND_URL}/settings?monday=error&reason=${encodeURIComponent(error)}`);
    return;
  }

  const verified = verifyState(state ?? "", nonce);
  if (!verified) {
    res.redirect(`${FRONTEND_URL}/settings?monday=error&reason=invalid_state`);
    return;
  }

  // Exchange code for token
  try {
    const tokenRes = await fetch("https://auth.monday.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code ?? "",
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error("[monday-oauth] token exchange failed:", text);
      res.redirect(`${FRONTEND_URL}/settings?monday=error&reason=token_exchange`);
      return;
    }

    const { access_token } = (await tokenRes.json()) as { access_token: string };

    // Fetch the user's Monday.com display name
    let mondayName: string | null = null;
    try {
      const meRes = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: access_token,
        },
        body: JSON.stringify({ query: "{ me { name } }" }),
      });
      const meJson = (await meRes.json()) as { data?: { me?: { name?: string } } };
      mondayName = meJson.data?.me?.name ?? null;
    } catch {
      // Non-fatal — we still save the token
    }

    // Persist to users.db — the token is encrypted at rest (AES-256-GCM) so a
    // leaked DB or backup can't be used to impersonate the user on Monday.com.
    // The fresh token carries today's scopes, so clear any rejection flag set
    // against the token it replaces.
    usersDb
      .prepare(
        `UPDATE users
            SET monday_access_token = ?, monday_name = ?,
                monday_token_rejected_at = NULL, monday_token_error = NULL
          WHERE azure_oid = ?`,
      )
      .run(protect(access_token), mondayName, verified.azureOid);

    res.redirect(frontendUrl(verified.returnTo, "connected"));
  } catch (err) {
    console.error("[monday-oauth] callback error:", err);
    res.redirect(`${FRONTEND_URL}/settings?monday=error&reason=server`);
  }
}

function handleStatus(req: Request, res: Response): void {
  const azureOid = req.user?.oid ?? req.user?.preferred_username ?? "";
  const row = usersDb
    .prepare(
      `SELECT monday_access_token, monday_name, monday_token_rejected_at, monday_token_error
         FROM users WHERE azure_oid = ?`,
    )
    .get(azureOid) as {
      monday_access_token: string | null;
      monday_name: string | null;
      monday_token_rejected_at: string | null;
      monday_token_error: string | null;
    } | null;

  const connected = !!row?.monday_access_token;
  res.json({
    data: {
      // Without the OAuth app credentials the Connect button can only 503, so
      // the sign-in prompt stays quiet (dev, seed-only setups).
      oauthConfigured: !!CLIENT_ID && !!CLIENT_SECRET,
      connected,
      mondayName: row?.monday_name ?? undefined,
      // A connected-but-rejected token still writes (the shared token covers
      // it), but the change is attributed to the service account instead of the
      // user — so the UI nudges them to reconnect rather than blocking them.
      needsReconnect: connected && !!row?.monday_token_rejected_at,
      rejectedAt: row?.monday_token_rejected_at ?? undefined,
      rejectionReason: row?.monday_token_error ?? undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Register on an Express router
// ---------------------------------------------------------------------------

export function registerMondayOAuth(router: Router): void {
  router.post("/api/auth/monday/start", requireAuth, handleStart);
  router.get("/api/auth/monday", handleOutdatedRedirect);   // the old ?az_token= entry point
  router.get("/api/auth/monday/callback", handleCallback);  // no requireAuth — browser redirect from Monday.com; the nonce cookie + signed state stand in
  router.get("/api/auth/monday/status", requireAuth, handleStatus);
}

// ---------------------------------------------------------------------------
// Helper: get a user's Monday.com token by Azure OID (used by write-back)
// ---------------------------------------------------------------------------

export function getUserMondayToken(azureOid: string): string | null {
  const row = usersDb
    .prepare(`SELECT monday_access_token FROM users WHERE azure_oid = ?`)
    .get(azureOid) as { monday_access_token: string | null } | null;
  // Stored encrypted (or legacy plaintext); reveal() handles both.
  return row?.monday_access_token ? reveal(row.monday_access_token) : null;
}

/**
 * Flag a user's personal Monday token as rejected by Monday (revoked, expired,
 * or — the common case — issued before a scope the write now needs was added to
 * the consent screen). The token is kept: the write still succeeds via the
 * shared token, and the user is asked to reconnect at their convenience.
 *
 * First rejection wins, so `monday_token_rejected_at` reads as "since when".
 */
export function markMondayTokenRejected(azureOid: string, reason: string): void {
  if (!azureOid) return;
  usersDb
    .prepare(
      `UPDATE users
          SET monday_token_rejected_at = COALESCE(monday_token_rejected_at, ?),
              monday_token_error = ?
        WHERE azure_oid = ? AND monday_access_token IS NOT NULL`,
    )
    .run(new Date().toISOString(), reason.slice(0, 500), azureOid);
}
