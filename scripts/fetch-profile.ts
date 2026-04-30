// =============================================================================
// Fetch a single profile by Monday.com item ID
// =============================================================================
// Usage: bun scripts/fetch-profile.ts <itemId>
// Output: data/samples/profile-<name>.json

import { setApiToken, mondayRequest } from "../lib/monday/api";

// All 18 board IDs from boards.yaml → board key
const BOARD_ID_TO_KEY: Record<string, string> = {
  "18392490403": "nvc_notices",
  "9283837796": "appointments_wh",
  "8094412694": "_fa_jail_intakes",
  "8025618300": "_na_originals_cards_notices",
  "8025590516": "foias",
  "8025566986": "_cd_open_forms",
  "8025556892": "motions",
  "8025546360": "court_cases",
  "8025538497": "_lt_i918b_s",
  "8025531784": "address_changes",
  "8025524218": "rfes_all",
  "8025467270": "fee_ks",
  "8025389724": "appointments_lb",
  "8025383981": "appointments_m",
  "8025265377": "profiles",
  "3473957885": "appeals",
  "7788520205": "appointments_r",
  "4299007012": "litigation",
  "9287895872": "calendaring",
};

async function fetchItemFull(itemId: string) {
  const query = `
    query ($itemId: [ID!]) {
      items(ids: $itemId) {
        id
        name
        board { id name }
        group { id title }
        column_values {
          id
          text
          ... on BoardRelationValue {
            linked_item_ids
          }
        }
        updates(limit: 50) {
          id
          text_body
          body
          created_at
          creator { name email }
          replies {
            id
            text_body
            body
            created_at
            creator { name email }
          }
        }
      }
    }
  `;
  const result = await mondayRequest<{ data: { items: any[] } }>(query, {
    itemId: [itemId],
  });
  return result.data.items[0] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const itemId = process.argv[2];
  if (!itemId) {
    console.error("Usage: bun scripts/fetch-profile.ts <itemId>");
    process.exit(1);
  }

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    console.error("Missing MONDAY_API_TOKEN in .env");
    process.exit(1);
  }
  setApiToken(token);

  console.log(`Fetching profile item ${itemId}...`);
  const profile = await fetchItemFull(itemId);
  if (!profile) {
    console.error(`Item ${itemId} not found`);
    process.exit(1);
  }

  console.log(`Profile: ${profile.name}`);
  console.log(`Updates on profile: ${profile.updates.length}`);

  // Collect linked item IDs
  const linkedItemIds: string[] = [];
  for (const cv of profile.column_values) {
    if (cv.linked_item_ids?.length > 0) {
      linkedItemIds.push(...cv.linked_item_ids);
    }
  }
  console.log(`Linked items: ${linkedItemIds.length}`);

  // Fetch each linked item
  const linkedItems: any[] = [];
  for (const id of linkedItemIds) {
    const item = await fetchItemFull(id);
    if (!item) {
      console.log(`  ⚠ Item ${id} not found`);
      continue;
    }
    const boardKey = item.board?.id
      ? BOARD_ID_TO_KEY[item.board.id] ?? `unknown_${item.board.id}`
      : "unknown";
    console.log(`  → ${boardKey}: "${item.name}" (${item.updates.length} updates)`);
    linkedItems.push({ boardKey, item });
    await sleep(200);
  }

  const result = {
    id: profile.id,
    name: profile.name,
    column_values: profile.column_values,
    updates: profile.updates,
    linkedItems,
  };

  const safeName = profile.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const outPath = `data/samples/profile-${safeName}.json`;
  await Bun.write(outPath, JSON.stringify(result, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
