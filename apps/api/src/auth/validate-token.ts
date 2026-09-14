import { jwtVerify, createRemoteJWKSet } from "jose";

const TENANT_ID = "9fde682a-6a44-4a86-a796-519ca573b1f5";
const CLIENT_ID = "2b0a7d88-6a8b-4913-90a7-9926fd8f6335";
const ALLOWED_DOMAIN = "sharma-crawford.com";

const JWKS = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`)
);

export interface AzureClaims {
  oid: string;
  /**
   * Optional on purpose. A shared or resource mailbox often carries no `name`
   * claim, and typing it `string` made every caller believe otherwise — which
   * is how one such account got a NOT NULL constraint failure out of
   * /api/auth/me and an unexplained sign-in loop in the browser.
   */
  name?: string;
  preferred_username: string;
  email?: string;
}

export async function validateToken(token: string): Promise<AzureClaims> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    audience: CLIENT_ID,
  });

  const username = (payload["preferred_username"] as string) ?? "";
  if (!username.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
    throw new Error(`Access restricted to @${ALLOWED_DOMAIN} accounts`);
  }

  // The object id is the account's only stable key — every users.db row, audit
  // entry and preference hangs off it. A token without one cannot be turned
  // into a user, so refuse it here rather than fail later on a NOT NULL.
  const oid = payload["oid"] as string | undefined;
  if (!oid) throw new Error("Token has no oid claim — this account cannot be identified");

  return {
    oid,
    name: payload["name"] as string | undefined,
    preferred_username: username,
    email: payload["email"] as string | undefined,
  };
}
