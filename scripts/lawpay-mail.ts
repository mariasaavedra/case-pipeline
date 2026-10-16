// =============================================================================
// LawPay receipts from the importantdocuments@ inbox
// =============================================================================
//   npm run lawpay:mail                    # what it finds (last 3 days), JSON
//   npm run lawpay:mail -- --days=14
//   npm run lawpay:mail -- --login         # sign in once more, adding Mail.Read
//
// rafael@'s Outlook rule forwards LawPay's receipt e-mails to importantdocuments@
// (2026-10-16). This reads that inbox — read-only, delegated Mail.Read as that
// account, through the same saved sign-in the consult sweep uses (asked for as
// its own token, so SharePoint never depends on it) — and prints the receipts
// whose reference is one of ours (apps/api/src/lawpay/email.ts). It changes
// nothing: the API (lawpay/mail-job.ts) applies them, each e-mail once.
//
// The LAST stdout line is the JSON result the API reads.
// =============================================================================

import { deviceLogin, graphMailAuthFromEnv } from "./sharepoint/auth.js";
import { graphFetch } from "./sharepoint/graph-client.js";
import { parseLawPayEmail } from "../apps/api/src/lawpay/email.js";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

interface Message { id: string; subject?: string; receivedDateTime?: string; body?: { content?: string } }

async function main() {
  if (process.argv.includes("--login")) {
    await deviceLogin({ mail: true });
    return;
  }
  const days = Math.min(Math.max(Number(arg("days") ?? 3) || 3, 1), 60);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const auth = graphMailAuthFromEnv();

  // Subjects first (cheap), bodies only for LawPay-looking ones.
  const found: Message[] = [];
  let next: string | null =
    `/me/messages?$filter=receivedDateTime ge ${since}&$orderby=receivedDateTime desc&$select=id,subject,receivedDateTime&$top=50`;
  while (next && found.length < 500) {
    const page: { value: Message[]; "@odata.nextLink"?: string } = await graphFetch(auth, next);
    found.push(...page.value.filter((m) => /payment/i.test(m.subject ?? "")));
    next = page["@odata.nextLink"] ?? null;
  }

  const receipts = [];
  for (const m of found) {
    const full = await graphFetch<Message>(auth, `/me/messages/${encodeURIComponent(m.id)}?$select=id,subject,receivedDateTime,body`, {
      headers: { Prefer: 'outlook.body-content-type="text"' },
    });
    const r = parseLawPayEmail(full.subject ?? "", full.body?.content ?? "");
    if (r) receipts.push({ ...r, messageId: m.id, receivedAt: m.receivedDateTime ?? null });
  }
  console.log(JSON.stringify({ ok: true, looked: found.length, receipts }));
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "error" }));
  process.exit(1);
});
