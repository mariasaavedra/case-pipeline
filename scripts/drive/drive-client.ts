// =============================================================================
// Google Drive client — read-only, as a service account
// =============================================================================
// The consult upload tree lives in a personal Google account
// (scaalaw515@gmail.com), so there is no Workspace domain-wide delegation. The
// root folder ("Virtual Appointments - NEW") is instead SHARED with a service
// account as Viewer; everything under it — including files clients upload,
// which they own — inherits that access, and nothing outside it is visible.
//
// Read-only scope. The intake job copies files out and never moves, renames or
// deletes anything in Drive: the firm empties the tree by hand.
//
// No googleapis dependency: the service-account flow is one signed JWT
// exchanged for an hour-long token, and node:crypto signs RS256.
// =============================================================================

import crypto from "node:crypto";
import fs from "node:fs";

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  createdTime: string;
  modifiedTime: string;
  trashed?: boolean;
  webViewLink?: string;
}

const FILE_FIELDS = "id,name,mimeType,parents,size,createdTime,modifiedTime,trashed,webViewLink";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface DriveClient {
  describe(): string;
  get(id: string): Promise<DriveFile>;
  /** Every file matching a Drive query, across pages. */
  list(q: string): Promise<DriveFile[]>;
  download(id: string): Promise<Buffer>;
}

/**
 * GOOGLE_SERVICE_ACCOUNT_KEY holds the JSON key itself, or a path to it. A
 * path is preferred on the server (data/ is a mounted volume); inline JSON is
 * for an environment where only variables can be set.
 */
export function driveClientFromEnv(): DriveClient {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set (JSON key, or a path to it)");
  const json = raw.startsWith("{") ? raw : fs.readFileSync(raw, "utf-8");
  const key = JSON.parse(json) as ServiceAccountKey;
  if (!key.client_email || !key.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not a service-account key (client_email/private_key missing)");
  }
  return createDriveClient(key);
}

export function createDriveClient(key: ServiceAccountKey, fetchImpl: typeof fetch = fetch): DriveClient {
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
      iss: key.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key.private_key).toString("base64url");
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
    });
    if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cached.token;
  }

  async function call(url: string): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${await token()}` } });
      // Drive asks for backoff with 429 and 403 rateLimitExceeded alike.
      const limited = res.status === 429 || (res.status === 403 && /rateLimit/i.test(await res.clone().text()));
      if (limited && attempt < 5) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
        continue;
      }
      if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return res;
    }
  }

  return {
    describe: () => `Google service account ${key.client_email}`,

    async get(id) {
      const res = await call(`${API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}&supportsAllDrives=true`);
      return (await res.json()) as DriveFile;
    },

    async list(q) {
      const out: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          q,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: "1000",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const res = await call(`${API}/files?${params}`);
        const page = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
        out.push(...page.files);
        pageToken = page.nextPageToken;
      } while (pageToken);
      return out;
    },

    async download(id) {
      const res = await call(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
