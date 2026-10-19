// =============================================================================
// The signed contract → the client's E-File (FEE Ks folder), else consult folder
// =============================================================================
// Runs scripts/esign-efile.ts, which has the SharePoint (Graph) sign-in the
// consult sweep and Drive intake use. Started after Zap 3's signed copy is
// saved, in the background: Zapier is not kept waiting on SharePoint. The
// script's last stdout line is its JSON result; routes/esign.ts turns it into
// a note on the Fee K.
// =============================================================================

import { spawn } from "node:child_process";
import { REPO_ROOT } from "../paths.js";

export type EfileResult =
  | { ok: true; where?: "E-File" | "Consult File"; folder: string; name: string; webUrl: string; already?: boolean }
  | { ok: false; reason: string };

const inFlight = new Set<number>();

/** Null = already running for this agreement (a Zapier retry). */
export function fileSignedContract(agreementId: number, documentName: string): Promise<EfileResult> | null {
  if (inFlight.has(agreementId)) return null;
  inFlight.add(agreementId);
  const args = ["run", "--silent", "esign:efile", "--", `--agreement=${agreementId}`];
  if ((process.env.DB_SOURCE ?? "seed").toLowerCase() === "seed") args.push("--db=seed");

  return new Promise<EfileResult>((resolve) => {
    let out = "";
    const child = spawn("npm", args, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, ESIGN_DOCUMENT_NAME: documentName },
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), 3 * 60_000);
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    const finish = (r: EfileResult) => {
      clearTimeout(timer);
      inFlight.delete(agreementId);
      resolve(r);
    };
    child.on("error", (err) => finish({ ok: false, reason: err.message }));
    child.on("close", (code) => {
      const last = out.trim().split("\n").pop() ?? "";
      try {
        finish(JSON.parse(last) as EfileResult);
      } catch {
        finish({ ok: false, reason: `the filing job ended without a result (exit ${code})` });
      }
    });
  });
}
