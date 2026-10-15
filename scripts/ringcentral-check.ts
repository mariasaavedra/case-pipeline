// =============================================================================
// RingCentral setup check — can this server text clients?
// =============================================================================
//   npm run sms:check                         read-only: sign-in, permissions, number
//   npm run sms:check -- --send-to=8165551234 also sends ONE test text to that number
//
// The checks themselves are apps/api/src/sms/check.ts, shared with
// Settings → Integrations → "Check connection". Never prints a credential.
// =============================================================================

import { checkRingCentral, TEN_DLC_NOTE } from "../apps/api/src/sms/check.js";
import { toUsE164, formatUsPhone } from "../libs/core/src/sms-text.js";

async function main() {
  const sendToArg = process.argv.find((a) => a.startsWith("--send-to="))?.slice("--send-to=".length);
  console.log("RingCentral setup check\n");

  const result = await checkRingCentral();
  for (const s of result.steps) {
    console.log(`  ${s.ok ? "✓" : "✗"} ${s.label}${s.fix ? `\n    → ${s.fix}` : ""}`);
  }
  if (!result.ok || !result.client) process.exit(1);

  if (sendToArg !== undefined) {
    const to = toUsE164(sendToArg);
    if (!to) {
      console.error(`  ✗ --send-to: "${sendToArg}" is not a US number`);
      process.exit(1);
    }
    const text = "Test from case-pipeline: RingCentral texting is set up. Reply STOP to opt out.";
    try {
      const sent = await result.client.sendSms(to, text);
      console.log(`  ✓ test text sent to ${formatUsPhone(to)} — RingCentral status: ${sent.status} (id ${sent.id})`);
      // Delivery is reported a few seconds later.
      await new Promise((r) => setTimeout(r, 8000));
      console.log(`  ✓ status after 8 s: ${await result.client.messageStatus(sent.id)}`);
    } catch (err) {
      console.error(`  ✗ test text failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  console.log(`\n  ! ${TEN_DLC_NOTE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
