// =============================================================================
// Consult folder sweep — the automated trigger
// =============================================================================
// Replaces the Calendly→Zapier automation. Runs on a schedule and, for each
// consultation that has TAKEN PLACE and has no folder recorded, either records
// the folder that already exists or creates one and records it.
//
// Deliberately targeted rather than a full scan. Backfill mode (--match) lists
// every folder on three sites — ~10,000 items, a couple of minutes — because it
// has to find folders under names no rule predicts. A sweep is looking at a
// handful of days' consults, where the folder either sits at the exact expected
// path or does not exist, so three cheap lookups per candidate answer it:
//
//   scalconsults  {YYYY} Consults/{initial}/{LASTNAME, First}
//   scalefiles    {initial}/{LASTNAME, First}
//   SCALClosed    {LASTNAME, First}
//
// The last two matter because a consult can hire (or close) before anyone gets
// round to recording the folder, and creating a consult folder for someone who
// already has an e-file would be a duplicate in the wrong place.
// =============================================================================

import { consultFolderName, consultFolderPath } from "./consult-naming.js";
import { consultOutcome } from "./consult-status.js";
import {
  resolveSiteDrive, getItemByPath, ensureFolderPath, listChildren, searchFolders,
  uploadSmallFile, isUnmodifiedBy,
} from "./folders.js";
import { buildConsultDocVars, isAwaitingNote, consultDocName, type ConsultDocSources } from "./consult-doc.js";
import { buildFolderIndex, looseCandidates, findMatch } from "./match.js";
import { linkTargetForSite, CONSULT_FILE, type LinkTarget } from "./link-target.js";
import { type GraphAuth } from "./graph-client.js";
import { type FolderRef } from "./match.js";

const HOST = "sharmacrawford.sharepoint.com";
const CONSULTS = "scalconsults";
const EFILES = "scalefiles";
const CLOSED = "SCALClosed";

/** One consult the sweep might act on. */
export interface SweepCandidate {
  profileLocalId: string;
  /** Raw JSON from live.db, parsed lazily only when a document is written. */
  profileJson?: string | null;
  apptJson?: string | null;
  profileMondayId: string | null;
  profileName: string;
  firstName: string | null;
  lastName: string | null;
  consultDate: string | null;
  apptStatus: string | null;
  /** Anything already recorded, from any of the three columns. */
  existingLink: string | null;
}

export type SweepAction =
  | { kind: "skip"; reason: string }
  | { kind: "link"; site: string; path: string; url: string; target: LinkTarget }
  | { kind: "create"; path: string; target: LinkTarget };

/** The subfolder each consult folder gets, for material from the consultation. */
export const CONSULT_SUBFOLDER = "CONSULT";

export interface SweepDecision {
  candidate: SweepCandidate;
  action: SweepAction;
}

/**
 * Decide what should happen for one consult, WITHOUT changing anything.
 *
 * Split out from the doing so the whole decision can be inspected in a dry run
 * and asserted in tests — this is the part that, wrong, puts a folder in a
 * client area or a bad URL on a client record.
 */
export async function decide(auth: GraphAuth, c: SweepCandidate): Promise<SweepDecision> {
  const skip = (reason: string): SweepDecision => ({ candidate: c, action: { kind: "skip", reason } });

  if (c.existingLink) return skip("already recorded");
  if (!c.profileMondayId) return skip("profile has no Monday item id");
  if (!c.consultDate) return skip("no consult date");

  // A booked consult earns its folder now, so the attorney has somewhere to put
  // things during the meeting. A cancellation or no-show still earns nothing,
  // and an unrecognised status is still not guessed at.
  const outcome = consultOutcome(c.apptStatus);
  if (outcome !== "proceeded" && outcome !== "not-yet") {
    return skip(`consult ${outcome} (${c.apptStatus ?? "no status"})`);
  }

  const named = consultFolderName({ firstName: c.firstName, lastName: c.lastName });
  if (!named.ok) return skip(`name needs a human: ${named.detail}`);

  const year = Number(c.consultDate.slice(0, 4));
  const consultPath = consultFolderPath(year, named.name);
  const folder = named.name.folder;

  // Look where it could already be, most-advanced first: a client who has
  // hired or closed must not be given a fresh consult folder.
  for (const [site, path] of [
    [CLOSED, folder],
    [EFILES, `${named.name.initial}/${folder}`],
    [CONSULTS, consultPath],
  ] as const) {
    const drive = await resolveSiteDrive(auth, HOST, site);
    const item = await getItemByPath(auth, drive.driveId, path);
    if (item?.folder) {
      return {
        candidate: c,
        action: { kind: "link", site, path, url: item.webUrl, target: linkTargetForSite(site) },
      };
    }
  }

  // Nothing at the exact paths. Before creating, check for the SAME person under
  // a fuller given name — Monday's First Name is often the short form, and
  // missing that created 22 duplicate folders on 2026-09-03, several of them
  // sitting directly beside the real folder in the same initial folder.
  //
  // Deliberately does not decide: "GARCIA, Jose" and "GARCIA, Jose Luis" can be
  // a father and son. A possible match means a person looks, not that the sweep
  // guesses.
  const near = await nearbyFolders(auth, named.name.initial, named.name.surname);
  const index = buildFolderIndex(near);

  // An exact path miss is not the same as absent: "HAMSHARI, Raghad - 20221"
  // holds a case number, so it never matches the path but IS the same person
  // once normalised. Record it rather than creating a second folder.
  const { match } = findMatch(index, folder);
  if (match?.folder.webUrl) {
    return {
      candidate: c,
      action: {
        kind: "link",
        site: match.folder.site,
        path: match.folder.path,
        url: match.folder.webUrl,
        target: linkTargetForSite(match.folder.site),
      },
    };
  }

  const loose = looseCandidates(index, folder);
  if (loose.length) {
    return skip(`possible existing folder — ${loose.map((l) => `${l.site}: ${l.name}`).join(" | ")}`);
  }

  return { candidate: c, action: { kind: "create", path: consultPath, target: CONSULT_FILE } };
}

/**
 * SCAL Consults year folders, discovered once per process.
 *
 * A sweep runs as its own short-lived process, so caching for its lifetime is
 * right — a new year folder appears once a year, and the next run sees it.
 * resetSweepCaches exists so that assumption is not silently load-bearing.
 */
let consultYearDirs: string[] | null = null;

/** Forget discovered state. For tests, and for any long-running caller. */
export function resetSweepCaches(): void {
  consultYearDirs = null;
}

async function yearFolders(auth: GraphAuth): Promise<string[]> {
  if (consultYearDirs) return consultYearDirs;
  const drive = await resolveSiteDrive(auth, HOST, CONSULTS);
  const root = await getItemByPath(auth, drive.driveId, "");
  consultYearDirs = root
    ? (await listChildren(auth, drive.driveId, root.id))
        .filter((c) => c.folder && /consults$/i.test(c.name))
        .map((c) => c.name)
    : [];
  return consultYearDirs;
}

/**
 * Folders that could plausibly belong to this person, cheaply.
 *
 * Looks in the person's INITIAL folder for EVERY consult year, not just the
 * year of this appointment. A repeat consultee — 2025 and again in 2026 — has
 * their folder under the earlier year, and checking only the current one is
 * precisely what created duplicates on 2026-09-03. Those folders hold a few
 * dozen entries each, so this stays cheap and it only runs for a candidate that
 * is otherwise about to be created.
 *
 * SCAL Closed is flat with 5,200+ entries, so it is searched by surname.
 */
async function nearbyFolders(
  auth: GraphAuth,
  initial: string,
  surname: string,
): Promise<FolderRef[]> {
  const out: FolderRef[] = [];

  const add = (items: Array<{ name: string; folder?: unknown; webUrl?: string }>, site: string, prefix: string) => {
    for (const item of items) {
      if (item.folder) {
        out.push({ name: item.name, site, path: prefix ? `${prefix}/${item.name}` : item.name, webUrl: item.webUrl });
      }
    }
  };

  const consults = await resolveSiteDrive(auth, HOST, CONSULTS);
  for (const yearDir of await yearFolders(auth)) {
    const parent = await getItemByPath(auth, consults.driveId, `${yearDir}/${initial}`);
    if (parent?.folder) {
      add(await listChildren(auth, consults.driveId, parent.id), CONSULTS, `${yearDir}/${initial}`);
    }
  }

  const efiles = await resolveSiteDrive(auth, HOST, EFILES);
  const efileParent = await getItemByPath(auth, efiles.driveId, initial);
  if (efileParent?.folder) {
    add(await listChildren(auth, efiles.driveId, efileParent.id), EFILES, initial);
  }

  const closed = await resolveSiteDrive(auth, HOST, CLOSED);
  add(await searchFolders(auth, closed.driveId, surname), CLOSED, "");

  return out;
}

/**
 * Carry out a decision. Creating and recording are one step on purpose: a
 * folder created without its URL written back is invisible to everyone, and
 * the next sweep would not know to look for it.
 */
export async function perform(
  auth: GraphAuth,
  decision: SweepDecision,
  write: (columnId: string, url: string) => Promise<void>,
): Promise<{ outcome: "linked" | "created" | "skipped"; url?: string }> {
  const { action } = decision;
  if (action.kind === "skip") return { outcome: "skipped" };

  if (action.kind === "link") {
    await write(action.target.columnId, action.url);
    return { outcome: "linked", url: action.url };
  }

  const drive = await resolveSiteDrive(auth, HOST, CONSULTS);
  const results = await ensureFolderPath(auth, drive.driveId, action.path, true);
  const leaf = results[results.length - 1]!;
  const url = leaf.item?.webUrl;
  if (!url) throw new Error(`Created ${action.path} but Graph returned no webUrl`);
  await write(action.target.columnId, url);
  return { outcome: "created", url };
}

export type DocOutcome =
  | { kind: "written"; name: string; awaitingNote: boolean }
  | { kind: "replaced"; name: string }
  | { kind: "unchanged"; name: string }
  | { kind: "left-alone"; name: string; reason: string };

/**
 * Ensure the CONSULT subfolder exists and holds an up-to-date summary.
 *
 * Two phases, run by the same sweep:
 *   - the subfolder appears as soon as the consult is booked, so there is
 *     somewhere to put material during the meeting;
 *   - the document is written once the consult has taken place.
 *
 * A document already carrying the attorney's note is never rewritten. One
 * written while the note was still missing IS replaced when the note appears —
 * but only if nobody has edited it since, because there is no undo for
 * overwriting an attorney's own edits.
 */
export async function ensureConsultDoc(
  auth: GraphAuth,
  consultFolderPathInSite: string,
  sources: ConsultDocSources,
  render: (vars: Record<string, string>) => Buffer,
  options: { writeDocument: boolean; account: string | null },
): Promise<DocOutcome | null> {
  const drive = await resolveSiteDrive(auth, HOST, CONSULTS);
  const subPath = `${consultFolderPathInSite}/${CONSULT_SUBFOLDER}`;
  await ensureFolderPath(auth, drive.driveId, subPath, true);

  if (!options.writeDocument) return null;

  const vars = buildConsultDocVars(sources);
  const awaitingNote = isAwaitingNote(vars);
  const name = consultDocName(sources.consultDate);

  const existing = await getItemByPath(auth, drive.driveId, `${subPath}/${name}`);
  if (existing?.file) {
    // Still no note, so a rewrite would say exactly what is already there.
    if (awaitingNote) return { kind: "unchanged", name };
    // A note has appeared since. Replace only a document the automation wrote
    // itself — an attorney's edits have no undo.
    if (!isUnmodifiedBy(existing, options.account)) {
      return { kind: "left-alone", name, reason: "edited by someone else" };
    }
    const parent = await getItemByPath(auth, drive.driveId, subPath);
    await uploadSmallFile(auth, drive.driveId, parent!.id, name, render(vars), "replace");
    return { kind: "replaced", name };
  }

  const parent = await getItemByPath(auth, drive.driveId, subPath);
  if (!parent?.folder) throw new Error(`${subPath} is missing after being ensured`);
  await uploadSmallFile(auth, drive.driveId, parent.id, name, render(vars), "fail");
  return { kind: "written", name, awaitingNote };
}

