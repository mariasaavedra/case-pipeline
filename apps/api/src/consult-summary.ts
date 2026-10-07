// =============================================================================
// Post-consult: the Consultation Summary, written the moment the note is saved
// =============================================================================
// The consult sweep (scripts/consult-sweep.ts) writes "CONSULT/Consultation
// Summary <date>.docx" into the client's SharePoint folder once a consult has
// taken place — but only every two hours, and only with a note it can read from
// live.db, which a just-posted E&A note isn't in until the next sync.
//
// So when an attorney saves a consult note in P4, the sweep is run for THAT
// appointment straight away, with the note handed over in the environment. It
// is the same code path as the scheduled sweep (folder lookup / link / create,
// summary written once, a person's edits never overwritten), just aimed.
//
// Off unless CONSULT_FOLDERS=on, like the scheduled sweep: a server without
// SharePoint credentials must not try. Fire-and-forget: the note is already
// saved; the summary's outcome goes to the log and the sweep's receipt CSV.
// =============================================================================

import { spawn } from "node:child_process";
import { REPO_ROOT } from "./paths.js";

export type SummaryStart = "started" | "already-running" | "disabled";

export interface SummaryRequest {
  appointmentLocalId: string;
  note: string;
  author: string | null;
  /** YYYY-MM-DD the note was written. */
  date: string;
}

const inFlight = new Set<string>();

/** Local ids are UUIDs or the seed's slugs — never anything a shell could read. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function startConsultSummary(req: SummaryRequest): SummaryStart {
  if (process.env.CONSULT_FOLDERS !== "on") return "disabled";
  if (!SAFE_ID.test(req.appointmentLocalId)) throw new Error("bad appointment id");
  if (inFlight.has(req.appointmentLocalId)) return "already-running";
  inFlight.add(req.appointmentLocalId);

  const args = ["run", "consult:sweep", "--", `--appointment=${req.appointmentLocalId}`, "--apply"];
  if ((process.env.DB_SOURCE ?? "seed").toLowerCase() === "seed") args.push("--db=seed");

  const child = spawn("npm", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      CONSULT_NOTE_TEXT: req.note,
      CONSULT_NOTE_AUTHOR: req.author ?? "",
      CONSULT_NOTE_DATE: req.date,
    },
  });
  const done = (why: string) => {
    inFlight.delete(req.appointmentLocalId);
    if (why) console.error(`[consult] Summary for appointment ${req.appointmentLocalId}: ${why}`);
  };
  child.on("close", (code) => done(code === 0 ? "" : `sweep exited with code ${code}`));
  child.on("error", (err) => done(err.message));
  return "started";
}
