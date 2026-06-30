// =============================================================================
// Monday.com OAuth — per-user token exchange
// =============================================================================
// Flow:
//   1. GET /api/auth/monday         → redirect to Monday.com consent screen
//   2. GET /api/auth/monday/callback → exchange code, store token, redirect to frontend
//   3. GET /api/auth/monday/status   → { connected, mondayName } for current user
// =============================================================================

import type { Request, Response } from "express";
import { createHmac } from "node:crypto";
import { usersDb } from "../db/users-db.js";
import { requireAuth } from "../auth/middleware.js";
import { validateToken } from "../auth/validate-token.js";
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
// State = `${azure_oid}:${ts}` signed with CLIENT_SECRET
// ---------------------------------------------------------------------------

function signState(azureOid: string): string {
  const payload = `${azureOid}:${Date.now()}`;
  const sig = createHmac("sha256", CLIENT_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

function verifyState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString();
    const lastColon = decoded.lastIndexOf(":");
    const payload = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const expected = createHmac("sha256", CLIENT_SECRET).update(payload).digest("hex");
    if (sig !== expected) return null;
    // Expire after 10 minutes
    const ts = parseInt(payload.split(":")[1] ?? "0", 10);
    if (Date.now() - ts > 10 * 60 * 1000) return null;
    return payload.split(":")[0] ?? null; // azure_oid
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function buildOAuthUrl(azureOid: string): string {
  const state = signState(azureOid);
  // Build manually to avoid encoding colons in scope (me:read not me%3Aread)
  const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state });
  return `https://auth.monday.com/oauth2/authorize?${params.toString()}&scope=me:read%20updates:write`;
}

async function handleRedirect(req: Request, res: Response): Promise<void> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(503).send("Monday.com OAuth not configured (MONDAY_CLIENT_ID / MONDAY_CLIENT_SECRET missing)");
    return;
  }

  // Accept Azure AD token via query param (browser navigation can't set headers)
  let azureOid = req.user?.oid ?? req.user?.preferred_username ?? "";
  if (!azureOid) {
    const azToken = req.query.az_token as string | undefined;
    if (azToken) {
      try {
        const claims = await validateToken(azToken);
        azureOid = claims.oid ?? claims.preferred_username ?? "";
      } catch {
        // invalid token — proceed with empty OID (anonymous connect)
      }
    }
  }

  res.redirect(buildOAuthUrl(azureOid));
}

async function handleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.redirect(`${FRONTEND_URL}/settings?monday=error&reason=${encodeURIComponent(error)}`);
    return;
  }

  const azureOid = verifyState(state ?? "");
  if (!azureOid) {
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

    // Persist to users.db
    usersDb
      .prepare(`UPDATE users SET monday_access_token = ?, monday_name = ? WHERE azure_oid = ?`)
      .run(access_token, mondayName, azureOid);

    res.redirect(`${FRONTEND_URL}/settings?monday=connected`);
  } catch (err) {
    console.error("[monday-oauth] callback error:", err);
    res.redirect(`${FRONTEND_URL}/settings?monday=error&reason=server`);
  }
}

function handleStatus(req: Request, res: Response): void {
  const azureOid = req.user?.oid ?? req.user?.preferred_username ?? "";
  const row = usersDb
    .prepare(`SELECT monday_access_token, monday_name FROM users WHERE azure_oid = ?`)
    .get(azureOid) as { monday_access_token: string | null; monday_name: string | null } | null;

  res.json({
    data: {
      connected: !!row?.monday_access_token,
      mondayName: row?.monday_name ?? undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Register on an Express router
// ---------------------------------------------------------------------------

export function registerMondayOAuth(router: Router): void {
  router.get("/api/auth/monday", handleRedirect);           // no requireAuth — browser navigation can't send headers
  router.get("/api/auth/monday/callback", handleCallback);  // no requireAuth — browser redirect from Monday.com
  router.get("/api/auth/monday/status", requireAuth, handleStatus);
}

// ---------------------------------------------------------------------------
// Helper: get a user's Monday.com token by Azure OID (used by write-back)
// ---------------------------------------------------------------------------

export function getUserMondayToken(azureOid: string): string | null {
  const row = usersDb
    .prepare(`SELECT monday_access_token FROM users WHERE azure_oid = ?`)
    .get(azureOid) as { monday_access_token: string | null } | null;
  return row?.monday_access_token ?? null;
}
