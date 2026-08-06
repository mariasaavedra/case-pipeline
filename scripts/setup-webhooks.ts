// =============================================================================
// Monday.com webhook registration — one command for all tracked boards
// =============================================================================
// Registers the webhook subscriptions that feed the live mirror's near-real-
// time refresh (apps/api/src/webhooks/*). One webhook per (board, event) pair,
// pointed at:  <base-url>/api/webhooks/monday/<MONDAY_WEBHOOK_SECRET>
//
// IMPORTANT: Monday POSTs a JSON challenge to that URL at creation time and
// only creates the webhook if the endpoint echoes it back — so the API must be
// deployed, publicly reachable, and configured with the SAME secret BEFORE
// this script runs.
//
// Usage (token + secret come from .env):
//   npm run webhooks:setup -- --url=https://dashboard.example.com            # register
//   npm run webhooks:setup -- --url=https://dashboard.example.com --dry-run  # preview
//   npm run webhooks:setup -- --list                                         # show existing
//   npm run webhooks:setup -- --remove                                       # delete ours
//   npm run webhooks:setup -- --boards=profiles,fee_ks --url=…               # subset
//   npm run webhooks:setup -- --events=change_column_value,create_update …   # subset
//   npm run webhooks:setup -- --url=… --force                                # ignore skips
//
// Caveat: Monday's `webhooks` query does not return the callback URL, so
// "ours" can only be inferred by event type. Registration skips a (board,
// event) pair that already has ANY webhook for that event, and --remove
// deletes every webhook on tracked boards whose event is in the target set —
// including ones another integration created. If other Monday integrations
// use webhooks on these boards, prefer --boards/--events to scope operations.
//
// When the pre-existing webhook belongs to ANOTHER integration, that skip is a
// silent coverage hole: our receiver never hears that event for that board.
// Each skip is logged by name, and --force creates ours anyway (Monday allows
// several webhooks per board+event, delivering to every callback URL, so the
// other integration keeps working). Re-running WITH --force duplicates our own
// webhooks, so scope it: --force --boards=court_cases,fee_ks --events=…
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  setApiToken,
  fetchWebhooks,
  createWebhook,
  deleteWebhook,
} from "@case-pipeline/monday";
import type { WebhookEventType } from "@case-pipeline/monday";
import { loadBoardsConfig } from "@case-pipeline/config";

// The default subscription set. Deliberately excludes delete_update (the
// processor skips it — note deletions reconcile on the nightly full sync) and
// the subitem/column-structure events (not mirrored).
const DEFAULT_EVENTS: WebhookEventType[] = [
  "change_column_value", // any column edit (status, dates, people, …)
  "create_item",
  "change_name",
  "item_deleted",
  "item_archived",
  "item_restored",
  "create_update", // notes
  "edit_update",
];

const VALID_EVENTS = new Set<string>([
  ...DEFAULT_EVENTS,
  "change_status_column_value",
  "change_specific_column_value",
  "item_moved_to_any_group",
  "delete_update",
]);

interface Args {
  url: string | null;
  list: boolean;
  remove: boolean;
  dryRun: boolean;
  onlyBoards: string[] | null;
  events: WebhookEventType[];
  force: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = {
    url: process.env.WEBHOOK_BASE_URL ?? null,
    list: false,
    remove: false,
    dryRun: false,
    onlyBoards: null,
    events: DEFAULT_EVENTS,
    force: false,
  };
  for (const arg of args) {
    if (arg.startsWith("--url=")) out.url = arg.slice("--url=".length);
    else if (arg === "--list") out.list = true;
    else if (arg === "--remove") out.remove = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--force") out.force = true;
    else if (arg.startsWith("--boards=")) {
      out.onlyBoards = arg.slice("--boards=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--events=")) {
      const list = arg.slice("--events=".length).split(",").map((s) => s.trim()).filter(Boolean);
      const bad = list.filter((e) => !VALID_EVENTS.has(e));
      if (bad.length) {
        console.error(`Unknown event(s): ${bad.join(", ")}`);
        console.error(`Valid events: ${[...VALID_EVENTS].join(", ")}`);
        process.exit(1);
      }
      out.events = list as WebhookEventType[];
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return out;
}

/** boards.yaml boards + active attorney boards from data/attorney-boards.json. */
async function trackedBoards(): Promise<Array<{ key: string; id: string; name: string }>> {
  const boardsConfig = await loadBoardsConfig();
  const boards = Object.entries(boardsConfig).map(([key, c]) => ({ key, id: String(c.id), name: c.name }));
  const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
  try {
    const attorney = JSON.parse(fs.readFileSync(path.join(dataDir, "attorney-boards.json"), "utf-8")) as Array<{
      boardKey: string;
      mondayBoardId: string;
      displayName: string;
      active: boolean;
    }>;
    for (const ab of attorney) {
      if (ab.active && ab.mondayBoardId && !boards.some((b) => b.key === ab.boardKey)) {
        boards.push({ key: ab.boardKey, id: ab.mondayBoardId, name: ab.displayName });
      }
    }
  } catch {
    // No attorney boards file — fine.
  }
  return boards;
}

async function main() {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    console.error("Error: MONDAY_API_TOKEN is required. Set it in .env.");
    process.exit(1);
  }
  setApiToken(token);

  const args = parseArgs();
  let boards = await trackedBoards();
  if (args.onlyBoards) boards = boards.filter((b) => args.onlyBoards!.includes(b.key));
  if (boards.length === 0) {
    console.error("No boards matched.");
    process.exit(1);
  }

  // ---- --list -------------------------------------------------------------
  if (args.list) {
    for (const board of boards) {
      const hooks = await fetchWebhooks(board.id);
      console.log(`\n${board.key} (${board.id}) — ${hooks.length} webhook(s)`);
      for (const h of hooks) console.log(`  #${h.id}  ${h.event}`);
    }
    return;
  }

  // ---- --remove -----------------------------------------------------------
  if (args.remove) {
    const targetEvents = new Set<string>(args.events);
    let removed = 0;
    for (const board of boards) {
      const hooks = (await fetchWebhooks(board.id)).filter((h) => targetEvents.has(h.event));
      for (const h of hooks) {
        if (args.dryRun) {
          console.log(`[dry-run] would delete ${board.key} #${h.id} (${h.event})`);
        } else {
          await deleteWebhook(h.id);
          console.log(`deleted ${board.key} #${h.id} (${h.event})`);
        }
        removed++;
      }
    }
    console.log(`\n${args.dryRun ? "Would delete" : "Deleted"} ${removed} webhook(s).`);
    return;
  }

  // ---- register (default) -------------------------------------------------
  const secret = process.env.MONDAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("Error: MONDAY_WEBHOOK_SECRET is required to register webhooks.");
    console.error("Generate one (openssl rand -hex 32), set it in the server's .env AND here, redeploy the API first.");
    process.exit(1);
  }
  if (!args.url) {
    console.error("Error: pass --url=https://<public-host> (or set WEBHOOK_BASE_URL).");
    process.exit(1);
  }
  const base = args.url.replace(/\/+$/, "");
  if (!base.startsWith("https://")) {
    console.error("Error: the callback URL must be public https:// — Monday won't deliver to plain http or localhost.");
    process.exit(1);
  }
  const callbackUrl = `${base}/api/webhooks/monday/${secret}`;
  console.log(`Callback: ${base}/api/webhooks/monday/<secret>`);
  console.log(`Boards: ${boards.length} · events per board: ${args.events.join(", ")}\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const board of boards) {
    const existing = new Set((await fetchWebhooks(board.id)).map((h) => h.event));
    for (const event of args.events) {
      if (existing.has(event) && !args.force) {
        // See header caveat: Monday doesn't return callback URLs, so an
        // existing webhook for this event MIGHT be ours (a re-run) or might
        // belong to another integration — in which case this board silently
        // loses coverage for that event. Name it so the gap is visible.
        console.log(`skipped ${board.key} ← ${event} (a webhook for this event already exists)`);
        skipped++;
        continue;
      }
      if (args.dryRun) {
        console.log(`[dry-run] would create ${board.key} ← ${event}`);
        created++;
        continue;
      }
      try {
        const h = await createWebhook(board.id, callbackUrl, event);
        console.log(`created ${board.key} ← ${event} (#${h.id})`);
        created++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`✗ ${board.key} ← ${event}: ${msg}`);
        if (msg.toLowerCase().includes("challenge") || msg.toLowerCase().includes("url")) {
          console.error("  (Is the API deployed and reachable at that URL with the same MONDAY_WEBHOOK_SECRET?)");
        }
      }
    }
  }
  console.log(
    `\n${args.dryRun ? "Would create" : "Created"} ${created}, skipped ${skipped} already-present, ${failed} failed.`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
