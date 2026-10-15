// =============================================================================
// RingCentral setup check — can this server text clients?
// =============================================================================
//   npm run sms:check                         read-only: sign-in, permissions, number
//   npm run sms:check -- --send-to=8165551234 also sends ONE test text to that number
//
// Checks, in order, and stops at the first that fails:
//   1. the four RINGCENTRAL_* variables are set and well-formed
//   2. the JWT signs in (the app must use "JWT auth flow")
//   3. the app was granted the SMS permission
//   4. whose extension the JWT belongs to
//   5. RINGCENTRAL_FROM_NUMBER is one of that extension's numbers and can send
//      SMS ("SmsSender" / "A2PSmsSender" feature)
// 10DLC registration isn't readable through the API — the last line says
// where to check it.
//
// Never prints a credential. Phone numbers it lists are the firm's own.
// =============================================================================

import { RingCentralClient, RingCentralError, ringCentralConfig, smsMode } from "../apps/api/src/sms/ringcentral.js";
import { checkEnvironment } from "../apps/api/src/config/env-check.js";
import { toUsE164, formatUsPhone } from "../libs/core/src/sms-text.js";

const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string, fix?: string): never => {
  console.error(`  ✗ ${msg}${fix ? `\n    → ${fix}` : ""}`);
  process.exit(1);
};

interface PhoneNumberRecord {
  phoneNumber: string;
  usageType?: string;
  type?: string;
  features?: string[];
}

async function main() {
  const sendToArg = process.argv.find((a) => a.startsWith("--send-to="))?.slice("--send-to=".length);
  console.log("RingCentral setup check\n");

  // 1. Variables — the same rules the API applies at boot.
  const rcIssues = checkEnvironment({ envFilePath: null, examplePath: null }).filter(
    (i) => i.variable.startsWith("RINGCENTRAL_") || i.variable === "SMS_MODE",
  );
  for (const i of rcIssues) console.error(`  ${i.level === "error" ? "✗" : "!"} ${i.variable}: ${i.message}`);
  if (rcIssues.some((i) => i.level === "error")) process.exit(1);
  const config = ringCentralConfig();
  if (!config) {
    const missing = ["RINGCENTRAL_CLIENT_ID", "RINGCENTRAL_CLIENT_SECRET", "RINGCENTRAL_JWT", "RINGCENTRAL_FROM_NUMBER"].filter(
      (k) => !process.env[k]?.trim(),
    );
    fail(`missing in .env: ${missing.join(", ")}`, "Copy them from the RingCentral developer console (app → Credentials).");
  }
  ok(`variables set — server ${config!.serverUrl}, SMS_MODE=${smsMode()}`);

  const rc = new RingCentralClient(config!);

  // 2–4. Sign in, permissions, who the JWT is.
  let ext: { name?: string; extensionNumber?: string; id?: number };
  try {
    ext = await rc.getJson("/restapi/v1.0/account/~/extension/~");
  } catch (err) {
    const e = err as RingCentralError;
    const hint = /grant type|unauthorized_client/i.test(e.message)
      ? 'The app must use "JWT auth flow" (developer console → app → Settings → Auth).'
      : /invalid_grant|jwt/i.test(e.message)
        ? "The JWT is wrong, expired, or was made for a different app / environment (sandbox vs production)."
        : /invalid_client/i.test(e.message)
          ? "Client ID / secret don't match (or belong to the sandbox app while the server URL is production)."
          : undefined;
    return fail(`sign-in failed: ${e.message}`, hint);
  }
  ok("JWT signs in");

  if (rc.grantedScopes.length && !rc.grantedScopes.includes("SMS")) {
    fail(
      `the app has no SMS permission (granted: ${rc.grantedScopes.join(", ")})`,
      "Developer console → app → Settings → Application scopes → add SMS. Changes to a production app may need RingCentral's review.",
    );
  }
  ok(rc.grantedScopes.length ? `permissions: ${rc.grantedScopes.join(", ")}` : "permissions not reported — SMS is checked when sending");
  ok(`texts go out as: ${ext.name ?? "?"} (ext. ${ext.extensionNumber ?? "?"})`);

  // 5. The sending number.
  const numbers = await rc.getJson<{ records: PhoneNumberRecord[] }>("/restapi/v1.0/account/~/extension/~/phone-number?perPage=100");
  const smsCapable = numbers.records.filter((n) => n.features?.some((f) => f === "SmsSender" || f === "A2PSmsSender"));
  const from = numbers.records.find((n) => n.phoneNumber === config!.fromNumber);
  if (!from) {
    fail(
      `${formatUsPhone(config!.fromNumber)} is not one of this extension's numbers`,
      smsCapable.length
        ? `SMS-capable numbers on this extension: ${smsCapable.map((n) => n.phoneNumber).join(", ")}`
        : "This extension has no SMS-capable number — the JWT should belong to the user who owns the firm's texting number.",
    );
  }
  const features = from!.features ?? [];
  if (!features.some((f) => f === "SmsSender" || f === "A2PSmsSender")) {
    fail(
      `${formatUsPhone(config!.fromNumber)} can't send SMS (features: ${features.join(", ") || "none"})`,
      "Admin portal → Phone System → Phone Numbers → enable SMS on it, or pick a number listed as SMS-capable.",
    );
  }
  ok(`${formatUsPhone(config!.fromNumber)} can send SMS (${features.filter((f) => /Sms/.test(f)).join(", ")})`);

  // Optional test text.
  if (sendToArg !== undefined) {
    const to = toUsE164(sendToArg);
    if (!to) fail(`--send-to: "${sendToArg}" is not a US number`);
    const text = "Test from case-pipeline: RingCentral texting is set up. Reply STOP to opt out.";
    try {
      const sent = await rc.sendSms(to!, text);
      ok(`test text sent to ${formatUsPhone(to!)} — RingCentral status: ${sent.status} (id ${sent.id})`);
      // Delivery is reported a few seconds later.
      await new Promise((r) => setTimeout(r, 8000));
      ok(`status after 8 s: ${await rc.messageStatus(sent.id)}`);
    } catch (err) {
      fail(`test text failed: ${(err as Error).message}`);
    }
  }

  console.log(
    "\n  ! 10DLC registration can't be read through the API. Check it in the admin portal:\n" +
      "    Phone System → Messaging (or \"SMS Registration\" / TCR). Unregistered numbers' texts get filtered\n" +
      "    by carriers — the API still says Sent, the client never gets it.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
