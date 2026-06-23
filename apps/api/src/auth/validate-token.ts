import { jwtVerify, createRemoteJWKSet } from "jose";

const TENANT_ID = "9fde682a-6a44-4a86-a796-519ca573b1f5";
const CLIENT_ID = "2b0a7d88-6a8b-4913-90a7-9926fd8f6335";

const JWKS = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`)
);

export interface AzureClaims {
  oid: string;
  name: string;
  preferred_username: string;
  email?: string;
}

export async function validateToken(token: string): Promise<AzureClaims> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    audience: CLIENT_ID,
  });

  return {
    oid: payload["oid"] as string,
    name: payload["name"] as string,
    preferred_username: payload["preferred_username"] as string,
    email: payload["email"] as string | undefined,
  };
}
