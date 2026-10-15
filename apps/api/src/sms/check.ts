// =============================================================================
// RingCentral setup check — shared by `npm run sms:check` and
// Settings → Integrations → "Check connection". Read-only; stops at the first
// failing step. Never returns a credential.
// =============================================================================

import { RingCentralClient, RingCentralError, ringCentralConfig, smsMode, type RingCentralConfig } from "./ringcentral.js";
import { checkEnvironment } from "../config/env-check.js";
import { formatUsPhone } from "@case-pipeline/core";

export interface CheckStep {
  ok: boolean;
  label: string;
  /** What to do about a failed step. */
  fix?: string;
}

export interface SmsCheckResult {
  ok: boolean;
  steps: CheckStep[];
  /** Set once sign-in worked — the --send-to path of the script reuses it. */
  client?: RingCentralClient;
  config?: RingCentralConfig;
}

interface PhoneNumberRecord {
  phoneNumber: string;
  features?: string[];
}

const canText = (n: PhoneNumberRecord) => !!n.features?.some((f) => f === "SmsSender" || f === "A2PSmsSender");

export async function checkRingCentral(env: NodeJS.ProcessEnv = process.env): Promise<SmsCheckResult> {
  const steps: CheckStep[] = [];
  const done = (ok: boolean, label: string, fix?: string): SmsCheckResult => {
    steps.push({ ok, label, ...(fix ? { fix } : {}) });
    return { ok: false, steps };
  };

  // 1. Variables — the same rules the API applies at boot.
  const issues = checkEnvironment({ env, envFilePath: null, examplePath: null }).filter(
    (i) => i.level === "error" && (i.variable.startsWith("RINGCENTRAL_") || i.variable === "SMS_MODE"),
  );
  if (issues.length) return done(false, issues.map((i) => `${i.variable}: ${i.message}`).join("; "), issues[0]!.fix);
  const config = ringCentralConfig(env);
  if (!config) {
    const missing = ["RINGCENTRAL_CLIENT_ID", "RINGCENTRAL_CLIENT_SECRET", "RINGCENTRAL_JWT", "RINGCENTRAL_FROM_NUMBER"].filter(
      (k) => !env[k]?.trim(),
    );
    return done(false, `missing in .env: ${missing.join(", ")}`, "Copy them from the RingCentral developer console (app → Credentials).");
  }
  steps.push({ ok: true, label: `variables set — ${config.serverUrl}, SMS_MODE=${smsMode(env)}` });

  // 2–4. Sign in, permission, whose extension.
  const rc = new RingCentralClient(config);
  let ext: { name?: string; extensionNumber?: string };
  try {
    ext = await rc.getJson("/restapi/v1.0/account/~/extension/~");
  } catch (err) {
    const msg = (err as RingCentralError).message;
    const fix = /grant type|unauthorized_client/i.test(msg)
      ? 'The app must use "JWT auth flow" (developer console → app → Settings → Auth).'
      : /invalid_grant|jwt/i.test(msg)
        ? "The JWT is wrong, expired, or was made for a different app / environment (sandbox vs production)."
        : /invalid_client/i.test(msg)
          ? "Client ID / secret don't match (or belong to the sandbox app while the server URL is production)."
          : undefined;
    return done(false, `sign-in failed: ${msg}`, fix);
  }
  steps.push({ ok: true, label: "JWT signs in" });

  if (rc.grantedScopes.length && !rc.grantedScopes.includes("SMS")) {
    return done(
      false,
      `the app has no SMS permission (granted: ${rc.grantedScopes.join(", ")})`,
      "Developer console → app → Settings → Application scopes → add SMS.",
    );
  }
  steps.push({ ok: true, label: rc.grantedScopes.length ? `permissions: ${rc.grantedScopes.join(", ")}` : "permissions not reported" });
  steps.push({ ok: true, label: `texts go out as: ${ext.name ?? "?"} (ext. ${ext.extensionNumber ?? "?"})` });

  // 5. The sending number.
  const numbers = await rc.getJson<{ records: PhoneNumberRecord[] }>("/restapi/v1.0/account/~/extension/~/phone-number?perPage=100");
  const from = numbers.records.find((n) => n.phoneNumber === config.fromNumber);
  if (!from) {
    const capable = numbers.records.filter(canText).map((n) => n.phoneNumber);
    return done(
      false,
      `${formatUsPhone(config.fromNumber)} is not one of this extension's numbers`,
      capable.length
        ? `Numbers this extension can text from: ${capable.join(", ")}`
        : "This extension has no number it can text from. For the main number, make this extension the Operator (Auto-Receptionist → Call/Fax/SMS Recipients).",
    );
  }
  if (!canText(from)) {
    return done(
      false,
      `${formatUsPhone(config.fromNumber)} can't send texts from this extension (features: ${from.features?.join(", ") || "none"})`,
      "Enable SMS on the number; for the main number, also make this extension the Operator (Auto-Receptionist → Call/Fax/SMS Recipients).",
    );
  }
  steps.push({ ok: true, label: `${formatUsPhone(config.fromNumber)} can send texts` });
  return { ok: true, steps, client: rc, config };
}

/** Shown under every check: 10DLC can't be read through the API. */
export const TEN_DLC_NOTE =
  "10DLC registration can't be read through the API — check it in the RingCentral admin portal (Phone System → Messaging). " +
  "Unregistered numbers' texts get filtered by carriers: RingCentral says Delivered, the client never gets it.";
