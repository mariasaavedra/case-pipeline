// =============================================================================
// Phase 0 — does Monday bump an item's updated_at when only its E&A moves?
// =============================================================================
// The incremental-sync design hinges on this. If a new email logged against an
// item does NOT advance that item's updated_at, then a watermark walk keyed on
// updated_at silently skips it, and we lose emails.
//
// The test: compare the item's updated_at against the created_at of its newest
// Emails & Activities timeline entry.
//   newest E&A  >  updated_at   → Monday does NOT bump it. Watermark is unsafe.
//   newest E&A  <= updated_at   → inconclusive on its own (something else may
//                                 have touched the item since), but consistent
//                                 with it being bumped.
//
// Usage: npx tsx --env-file=.env scripts/phase0-updated-at.ts <itemId> [...]
// =============================================================================

import { setApiToken, mondayRequest, fetchTimelineBatch } from "@case-pipeline/monday";

const token = process.env.MONDAY_API_TOKEN;
if (!token) {
  console.error("MONDAY_API_TOKEN missing — run with: npx tsx --env-file=.env scripts/phase0-updated-at.ts <itemId>");
  process.exit(1);
}
setApiToken(token);

const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
if (ids.length === 0) {
  console.error("Pass at least one Monday item id.");
  process.exit(1);
}

interface ItemRow {
  id: string;
  name: string;
  updated_at: string;
  created_at: string;
  state: string;
  board: { id: string; name: string } | null;
}

const query = `
  query ($ids: [ID!]) {
    items(ids: $ids) {
      id
      name
      updated_at
      created_at
      state
      board { id name }
    }
  }
`;

const res = await mondayRequest<{ data: { items: ItemRow[] } }>(query, { ids });
const items = res.data.items ?? [];

if (items.length === 0) {
  console.log("No item returned for", ids.join(", "), "— wrong id, or the token can't see that board.");
  process.exit(0);
}

const timelines = await fetchTimelineBatch(ids, 50);

for (const item of items) {
  const entries = (timelines.get(item.id) ?? [])
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  console.log("=".repeat(72));
  console.log(`${item.name}   (item ${item.id})`);
  console.log(`board        : ${item.board?.name ?? "?"} (${item.board?.id ?? "?"})`);
  console.log(`state        : ${item.state}`);
  console.log(`created_at   : ${item.created_at}`);
  console.log(`updated_at   : ${item.updated_at}   <<< the watermark field`);
  console.log(`E&A entries  : ${entries.length}`);

  if (entries.length > 0) {
    console.log("\n  newest E&A entries:");
    for (const e of entries.slice(0, 5)) {
      const title = (e.title ?? "").slice(0, 44);
      console.log(`    ${e.created_at}  ${String(e.type).padEnd(8)}  ${title}`);
    }
    const newest = entries[0]!;
    const bumped = new Date(item.updated_at).getTime() >= new Date(newest.created_at).getTime();
    console.log(
      `\n  VERDICT: newest E&A ${newest.created_at} vs updated_at ${item.updated_at}\n` +
        (bumped
          ? "    updated_at is at/after the newest E&A — consistent with Monday bumping it."
          : "    updated_at is BEHIND the newest E&A — Monday does NOT bump it on E&A activity.\n" +
            "    => a watermark keyed on updated_at WOULD MISS THIS EMAIL."),
    );
  }
}
