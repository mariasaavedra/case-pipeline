// =============================================================================
// RingCentral call-events subscription — register / list / remove
// =============================================================================
// One webhook subscription to every call in the account (telephony/sessions),
// pointed at:  <base-url>/api/webhooks/ringcentral/<RC_WEBHOOK_SECRET>
// (apps/api/src/phone/call-events.ts). See docs/features/phone-ivr.md.
//
// RingCentral checks the URL when the subscription is made (it POSTs a
// Validation-Token header and wants it echoed), so the API must be deployed
// with the SAME RC_WEBHOOK_SECRET before this runs. The RingCentral app needs
// the CallControl permission (developer console → the app → Settings).
//
//   npm run rc:subscribe -- --list                          show ours (never prints the secret)
//   npm run rc:subscribe -- --url=https://<host> --dry-run  what it would make
//   npm run rc:subscribe -- --url=https://<host>            make it (skips when one already points there)
//   npm run rc:subscribe -- --remove                        delete every subscription to our receiver
// =============================================================================

import { ringCentralConfig, RingCentralClient } from "../apps/api/src/sms/ringcentral.js";

const EVENT_FILTER = "/restapi/v1.0/account/~/telephony/sessions";
const RECEIVER_PATH = "/api/webhooks/ringcentral/";
/** RingCentral's longest webhook lifetime (20 years) — "never expires" in practice. */
const EXPIRES_IN = 630_720_000;

interface Subscription {
  id: string;
  status?: string;
  expirationTime?: string;
  eventFilters?: string[];
  deliveryMode?: { transportType?: string; address?: string };
}

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const redact = (address = "") => address.replace(/(\/api\/webhooks\/ringcentral\/).+$/, "$1…");

async function main() {
  const config = ringCentralConfig();
  if (!config) {
    console.error("RingCentral is not configured: RINGCENTRAL_CLIENT_ID / _CLIENT_SECRET / _JWT / _FROM_NUMBER are needed.");
    process.exit(1);
  }
  const rc = new RingCentralClient(config);
  const all = (await rc.getJson<{ records?: Subscription[] }>("/restapi/v1.0/subscription")).records ?? [];
  const ours = all.filter((s) => s.deliveryMode?.address?.includes(RECEIVER_PATH));

  if (flag("list") || (!arg("url") && !flag("remove"))) {
    if (!ours.length) console.log("No subscription to our receiver.");
    for (const s of ours) {
      console.log(`${s.id}  ${s.status ?? "?"}  expires ${s.expirationTime ?? "?"}  ${redact(s.deliveryMode?.address)}  ${(s.eventFilters ?? []).join(", ")}`);
    }
    if (!arg("url") && !flag("remove") && !flag("list")) console.log("\nUse --url=https://<host> to make one, --remove to delete.");
    return;
  }

  if (flag("remove")) {
    for (const s of ours) {
      await rc.sendJson("DELETE", `/restapi/v1.0/subscription/${encodeURIComponent(s.id)}`);
      console.log(`Removed ${s.id} (${redact(s.deliveryMode?.address)})`);
    }
    if (!ours.length) console.log("Nothing to remove.");
    return;
  }

  const secret = process.env.RC_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("RC_WEBHOOK_SECRET is not set — it must match the deployed API's.");
    process.exit(1);
  }
  const base = arg("url")!.replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) {
    console.error("--url must be the public https:// address of the API (RingCentral refuses plain http).");
    process.exit(1);
  }
  const address = `${base}${RECEIVER_PATH}${secret}`;
  const existing = ours.find((s) => s.deliveryMode?.address === address && s.status === "Active");
  if (existing) {
    console.log(`Already subscribed: ${existing.id}, expires ${existing.expirationTime}. Nothing to do.`);
    return;
  }
  const request = {
    eventFilters: [EVENT_FILTER],
    deliveryMode: { transportType: "WebHook", address },
    expiresIn: EXPIRES_IN,
  };
  if (flag("dry-run")) {
    console.log("DRY RUN — would create:");
    console.log(JSON.stringify({ ...request, deliveryMode: { ...request.deliveryMode, address: redact(address) } }, null, 2));
    return;
  }
  const made = await rc.sendJson<Subscription>("POST", "/restapi/v1.0/subscription", request);
  console.log(`Subscribed: ${made?.id}, status ${made?.status}, expires ${made?.expirationTime}.`);
}

main().catch((err) => {
  console.error((err as Error).message);
  if (/permission|scope/i.test((err as Error).message)) {
    console.error("→ Add the CallControl permission to the RingCentral app (developer console), then run this again.");
  }
  process.exit(1);
});
