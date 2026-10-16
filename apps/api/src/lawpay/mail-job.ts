// =============================================================================
// Every 10 minutes: LawPay receipts → Fee Ks (LAWPAY_MAIL=on)
// =============================================================================
// Runs scripts/lawpay-mail.ts (it has the Microsoft sign-in, like the consult
// sweep and Drive intake), reads its last stdout line — the receipts it found —
// and hands them to routes/lawpay.ts ingestLawPayReceipts, which applies each
// e-mail once. See docs/features/lawpay-payments.md.
// =============================================================================

import { spawn } from "node:child_process";
import { REPO_ROOT } from "../paths.js";
import { ingestLawPayReceipts, type LawPayDeps, type MailReceipt } from "../routes/lawpay.js";

export type MailJobOutcome = { ok: true; looked: number; receipts: number; applied: string[] } | { ok: false; error: string };

let inFlight = false;

/** Read the script's result. Exported for tests. */
export function parseScriptOutput(stdout: string): { ok: true; looked: number; receipts: MailReceipt[] } | { ok: false; error: string } {
  const last = stdout.trim().split("\n").pop() ?? "";
  try {
    const r = JSON.parse(last) as { ok?: boolean; looked?: number; receipts?: MailReceipt[]; error?: string };
    return r.ok ? { ok: true, looked: r.looked ?? 0, receipts: Array.isArray(r.receipts) ? r.receipts : [] } : { ok: false, error: r.error ?? "failed" };
  } catch {
    return { ok: false, error: "the mailbox reader ended without a result" };
  }
}

export function runLawPayMailJob(deps: LawPayDeps): Promise<MailJobOutcome | null> {
  if (inFlight) return Promise.resolve(null);
  inFlight = true;
  return new Promise((resolve) => {
    let out = "";
    const child = spawn("npm", ["run", "--silent", "lawpay:mail"], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "inherit"], env: process.env });
    const timer = setTimeout(() => child.kill("SIGTERM"), 5 * 60_000);
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    const finish = (r: MailJobOutcome) => { clearTimeout(timer); inFlight = false; resolve(r); };
    child.on("error", (err) => finish({ ok: false, error: err.message }));
    child.on("close", () => {
      const parsed = parseScriptOutput(out);
      if (!parsed.ok) return finish(parsed);
      ingestLawPayReceipts(deps, parsed.receipts)
        .then((applied) => finish({ ok: true, looked: parsed.looked, receipts: parsed.receipts.length, applied }))
        .catch((err: unknown) => finish({ ok: false, error: err instanceof Error ? err.message : "error" }));
    });
  });
}
