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
import { resolveSiteDrive, getItemByPath, ensureFolderPath, listChildren, searchFolders } from "./folders.js";
import { buildFolderIndex, looseCandidates } from "./match.js";
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

  const outcome = consultOutcome(c.apptStatus);
  if (outcome !== "proceeded") return skip(`consult ${outcome} (${c.apptStatus ?? "no status"})`);

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
  const near = await nearbyFolders(auth, year, named.name.initial, named.name.surname);
  const loose = looseCandidates(buildFolderIndex(near), folder);
  if (loose.length) {
    return skip(`possible existing folder — ${loose.map((l) => `${l.site}: ${l.name}`).join(" | ")}`);
  }

  return { candidate: c, action: { kind: "create", path: consultPath, target: CONSULT_FILE } };
}

/**
 * Folders that could plausibly belong to this person, cheaply.
 *
 * The two initial folders are small enough to list outright. SCAL Closed is
 * flat with 5,200+ entries, so it is searched by surname instead.
 */
async function nearbyFolders(
  auth: GraphAuth,
  year: number,
  initial: string,
  surname: string,
): Promise<FolderRef[]> {
  const out: FolderRef[] = [];

  const add = (items: Array<{ name: string; folder?: unknown }>, site: string) => {
    for (const item of items) if (item.folder) out.push({ name: item.name, site, path: item.name });
  };

  for (const [site, path] of [
    [CONSULTS, `${year} Consults/${initial}`],
    [EFILES, initial],
  ] as const) {
    const drive = await resolveSiteDrive(auth, HOST, site);
    const parent = await getItemByPath(auth, drive.driveId, path);
    if (parent?.folder) add(await listChildren(auth, drive.driveId, parent.id), site);
  }

  const closed = await resolveSiteDrive(auth, HOST, CLOSED);
  add(await searchFolders(auth, closed.driveId, surname), CLOSED);

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
