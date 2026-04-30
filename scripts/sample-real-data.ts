// =============================================================================
// Phase 0: Sample real Monday.com data to understand update/activity shapes
// =============================================================================
// One-off script — run with: bun scripts/sample-real-data.ts
// Outputs to data/samples/ (gitignored)

import { setApiToken, mondayRequest } from "../lib/monday/api";

const PROFILES_BOARD_ID = "8025265377";
const SAMPLE_SIZE = 10;

// All 18 board IDs from boards.yaml
const ALL_BOARD_IDS: Record<string, string> = {
  nvc_notices: "18392490403",
  appointments_wh: "9283837796",
  _fa_jail_intakes: "8094412694",
  _na_originals_cards_notices: "8025618300",
  foias: "8025590516",
  _cd_open_forms: "8025566986",
  motions: "8025556892",
  court_cases: "8025546360",
  _lt_i918b_s: "8025538497",
  address_changes: "8025531784",
  rfes_all: "8025524218",
  fee_ks: "8025467270",
  appointments_lb: "8025389724",
  appointments_m: "8025383981",
  profiles: PROFILES_BOARD_ID,
  appeals: "3473957885",
  appointments_r: "7788520205",
  litigation: "4299007012",
  calendaring: "9287895872",
};

interface SampleProfile {
  id: string;
  name: string;
  column_values: Array<{ id: string; text: string | null; linked_item_ids?: string[] }>;
  updates: unknown[];
  profileTimeline: unknown[];
  linkedItems: Array<{
    boardKey: string;
    item: {
      id: string;
      name: string;
      board?: { id: string; name: string };
      updates: unknown[];
    };
    timeline: unknown[];
  }>;
  activityLogs: unknown[];
}

// -----------------------------------------------------------------------------
// GraphQL queries
// -----------------------------------------------------------------------------

async function fetchProfileItems(limit: number): Promise<unknown[]> {
  const query = `
    query ($boardId: ID!, $limit: Int!) {
      boards(ids: [$boardId]) {
        items_page(limit: $limit) {
          items {
            id
            name
            column_values {
              id
              text
              ... on BoardRelationValue {
                linked_item_ids
              }
            }
            updates(limit: 25) {
              id
              text_body
              body
              created_at
              creator {
                name
                email
              }
              replies {
                id
                text_body
                body
                created_at
                creator {
                  name
                  email
                }
              }
            }
          }
        }
      }
    }
  `;

  const result = await mondayRequest<{
    data: { boards: [{ items_page: { items: unknown[] } }] };
  }>(query, { boardId: PROFILES_BOARD_ID, limit });

  return result.data.boards[0]?.items_page.items ?? [];
}

async function fetchItemWithUpdates(itemId: string): Promise<unknown> {
  const query = `
    query ($itemId: [ID!]) {
      items(ids: $itemId) {
        id
        name
        board {
          id
          name
        }
        group {
          id
          title
        }
        column_values {
          id
          text
        }
        updates(limit: 25) {
          id
          text_body
          body
          created_at
          creator {
            name
            email
          }
          replies {
            id
            text_body
            body
            created_at
            creator {
              name
              email
            }
          }
        }
      }
    }
  `;

  const result = await mondayRequest<{ data: { items: unknown[] } }>(query, {
    itemId: [itemId],
  });

  return result.data.items[0] ?? null;
}

async function fetchTimeline(itemId: string): Promise<unknown[]> {
  const query = `
    query ($itemId: ID!) {
      timeline(id: $itemId) {
        timeline_items_page {
          cursor
          timeline_items {
            id
            title
            content
            created_at
            type
            custom_activity_id
            user {
              name
              email
            }
            board {
              id
              name
            }
            item {
              id
              name
            }
          }
        }
      }
    }
  `;

  try {
    const result = await mondayRequest<{
      data: { timeline: { timeline_items_page: { timeline_items: unknown[] } } };
    }>(query, { itemId });
    return result.data.timeline?.timeline_items_page?.timeline_items ?? [];
  } catch (err) {
    console.warn(`  ⚠ timeline failed for item ${itemId}: ${(err as Error).message}`);
    return [];
  }
}

async function fetchBoardActivityLogs(
  boardId: string,
  limit = 25
): Promise<unknown[]> {
  const query = `
    query ($boardId: [ID!], $limit: Int!) {
      boards(ids: $boardId) {
        activity_logs(limit: $limit) {
          id
          event
          data
          created_at
          user_id
          account_id
          entity
        }
      }
    }
  `;

  try {
    const result = await mondayRequest<{
      data: { boards: [{ activity_logs: unknown[] }] };
    }>(query, { boardId: [boardId], limit });
    return result.data.boards[0]?.activity_logs ?? [];
  } catch (err) {
    console.warn(`  ⚠ activity_logs failed for board ${boardId}: ${(err as Error).message}`);
    return [];
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    console.error("Missing MONDAY_API_TOKEN in .env");
    process.exit(1);
  }
  setApiToken(token);

  console.log(`Fetching ${SAMPLE_SIZE} profiles from board ${PROFILES_BOARD_ID}...`);
  const rawProfiles = (await fetchProfileItems(SAMPLE_SIZE)) as Array<{
    id: string;
    name: string;
    column_values: Array<{ id: string; text: string | null; linked_item_ids?: string[] }>;
    updates: unknown[];
  }>;

  console.log(`Got ${rawProfiles.length} profiles.\n`);

  // Build a reverse map: board ID → board key
  const boardIdToKey: Record<string, string> = {};
  for (const [key, id] of Object.entries(ALL_BOARD_IDS)) {
    boardIdToKey[id] = key;
  }

  // Also try activity_logs on the profiles board
  console.log("Fetching activity_logs for profiles board...");
  const profileBoardActivity = await fetchBoardActivityLogs(PROFILES_BOARD_ID);
  console.log(`  Got ${profileBoardActivity.length} activity log entries.\n`);

  const results: SampleProfile[] = [];

  for (const profile of rawProfiles) {
    console.log(`\n--- ${profile.name} (${profile.id}) ---`);
    console.log(`  Updates on profile: ${(profile.updates as unknown[]).length}`);

    // Fetch E&A timeline for the profile item itself
    const profileTimeline = await fetchTimeline(profile.id);
    console.log(`  Timeline on profile: ${profileTimeline.length}`);

    // Collect all linked item IDs from board_relation columns
    const linkedItemIds: string[] = [];
    for (const cv of profile.column_values) {
      if (cv.linked_item_ids && cv.linked_item_ids.length > 0) {
        linkedItemIds.push(...cv.linked_item_ids);
      }
    }

    console.log(`  Linked item IDs: ${linkedItemIds.length}`);

    // Fetch each linked item with its updates
    const linkedItems: SampleProfile["linkedItems"] = [];
    for (const itemId of linkedItemIds) {
      const item = (await fetchItemWithUpdates(itemId)) as {
        id: string;
        name: string;
        board?: { id: string; name: string };
        updates: unknown[];
      } | null;

      if (!item) {
        console.log(`  ⚠ Item ${itemId} not found (deleted?)`);
        continue;
      }

      const boardKey = item.board?.id ? boardIdToKey[item.board.id] ?? `unknown_${item.board.id}` : "unknown";
      const updateCount = (item.updates as unknown[]).length;

      // Fetch E&A timeline for this item
      const timeline = await fetchTimeline(itemId);
      const timelineCount = timeline.length;
      console.log(`  → ${boardKey}: "${item.name}" (${updateCount} updates, ${timelineCount} timeline entries)`);

      linkedItems.push({ boardKey, item, timeline });

      // Be gentle with rate limits
      await sleep(200);
    }

    results.push({
      id: profile.id,
      name: profile.name,
      column_values: profile.column_values,
      updates: profile.updates,
      profileTimeline: profileTimeline,
      linkedItems,
      activityLogs: profileBoardActivity,
    });
  }

  // Write individual files
  const outDir = `${import.meta.dir}/../data/samples`;
  for (const profile of results) {
    const safeName = profile.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const path = `${outDir}/profile-${safeName}.json`;
    await Bun.write(path, JSON.stringify(profile, null, 2));
    console.log(`\nWrote ${path}`);
  }

  // Write a summary
  const summary = {
    fetchedAt: new Date().toISOString(),
    profileCount: results.length,
    profiles: results.map((p) => ({
      id: p.id,
      name: p.name,
      directUpdates: (p.updates as unknown[]).length,
      profileTimelineEntries: p.profileTimeline.length,
      linkedItemCount: p.linkedItems.length,
      linkedItemUpdates: p.linkedItems.reduce(
        (sum, li) => sum + (li.item.updates as unknown[]).length,
        0
      ),
      linkedItemTimeline: p.linkedItems.reduce(
        (sum, li) => sum + li.timeline.length,
        0
      ),
    })),
    activityLogEntries: profileBoardActivity.length,
  };
  await Bun.write(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(`\nWrote summary.json`);

  // Print quick stats
  console.log("\n=== QUICK STATS ===");
  const totalDirectUpdates = results.reduce((s, p) => s + (p.updates as unknown[]).length, 0);
  const totalLinkedUpdates = results.reduce(
    (s, p) => s + p.linkedItems.reduce((s2, li) => s2 + (li.item.updates as unknown[]).length, 0),
    0
  );
  const totalProfileTimeline = results.reduce((s, p) => s + p.profileTimeline.length, 0);
  const totalLinkedTimeline = results.reduce(
    (s, p) => s + p.linkedItems.reduce((s2, li) => s2 + li.timeline.length, 0),
    0
  );
  console.log(`Profiles sampled: ${results.length}`);
  console.log(`Direct updates on profiles: ${totalDirectUpdates}`);
  console.log(`Updates on linked items: ${totalLinkedUpdates}`);
  console.log(`Timeline entries on profiles: ${totalProfileTimeline}`);
  console.log(`Timeline entries on linked items: ${totalLinkedTimeline}`);
  console.log(`Activity log entries: ${profileBoardActivity.length}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
