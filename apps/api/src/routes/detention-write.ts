// =============================================================================
// Detention write-back — mark a detained client as released
// =============================================================================
// P3.0 shows "Detained at <facility>" from the Det. Facility on the client's
// open court cases (libs/query getOpenDetentions). Releasing does two things in
// Monday, so Monday and the dashboard agree:
//
//   1. clears Det. Facility on every open court case that has one, and
//   2. logs a "Casenote" in the profile's Emails & Activities saying where they
//      were released from, when (optional), and the note staff typed.
//
// The facility is gone from the column after this, so the E&A entry is where
// the history lives. Same rails as every other write: personal Monday token
// first, durable queue on outage, optimistic local update, audit entry.
//
// The E&A entry is not written to client_updates here: the sync's E&A walk
// dedupes on a content signature built from Monday's own fields, so a local
// copy would come back as a second row. It shows after the next full sync.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { requireAuth } from "../auth/middleware.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { auditFromReq } from "../audit/log.js";
import { getBoardColumnsFor, getOpenDetentions } from "@case-pipeline/query";
import type { CreateTimelineItemInput } from "@case-pipeline/monday";

/**
 * "Casenote" — the firm's existing E&A activity type (the most used one), the
 * same id jail-intake-write.ts posts under. Reused, not created: see
 * docs/decisions.md 2026-08-25.
 */
export const CASENOTE_ACTIVITY_ID = "70e734ee-0261-4489-9047-35966b929ca3";

/** Longest release note accepted. */
export const RELEASE_NOTE_MAX = 5000;

export type ReleaseBody =
  | { ok: true; note: string; releasedOn: string | null }
  | { ok: false; error: string };

/**
 * Validate the release popup's body. The note is required — the column is
 * cleared, so the note is the only record of why. The date is optional but,
 * when given, must be a real YYYY-MM-DD no later than `today`.
 */
export function parseReleaseBody(raw: unknown, today: string): ReleaseBody {
  const body = (raw ?? {}) as Record<string, unknown>;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) return { ok: false, error: "note is required" };
  if (note.length > RELEASE_NOTE_MAX) return { ok: false, error: `note is too long (max ${RELEASE_NOTE_MAX} characters)` };

  const rawDate = typeof body.releasedOn === "string" ? body.releasedOn.trim() : "";
  if (!rawDate) return { ok: true, note, releasedOn: null };
  const parsed = new Date(`${rawDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== rawDate) {
    return { ok: false, error: "releasedOn must be a date (YYYY-MM-DD)" };
  }
  if (rawDate > today) return { ok: false, error: "releasedOn cannot be in the future" };
  return { ok: true, note, releasedOn: rawDate };
}

/** "Sep 28, 2026" — read as a calendar date, never shifted by a timezone. */
function formatDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/**
 * The E&A entry a release logs on the profile:
 *
 *   title:   Released from detention — Chase Co. (KS)
 *   content: Released: Sep 28, 2026      (only when a date was given)
 *
 *            <note>
 */
export function releaseActivity(
  facilities: string[],
  releasedOn: string | null,
  note: string,
): Omit<CreateTimelineItemInput, "itemId"> {
  const where = [...new Set(facilities)].join(", ");
  return {
    title: `Released from detention — ${where}`,
    customActivityId: CASENOTE_ACTIVITY_ID,
    content: releasedOn ? `Released: ${formatDay(releasedOn)}\n\n${note}` : note,
  };
}

export interface DetentionWriteDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerDetentionWriteRoutes(app: Express, deps: DetentionWriteDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  app.post("/api/profiles/:localId/release", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }

    const localId = String(req.params.localId);
    const parsed = parseReleaseBody(req.body, new Date().toISOString().slice(0, 10));
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { note, releasedOn } = parsed;

    const profile = db
      .prepare("SELECT monday_item_id FROM profiles WHERE local_id = ?")
      .get(localId) as { monday_item_id: string | null } | undefined;
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    if (!profile.monday_item_id) {
      res.status(400).json({ error: "Profile has no Monday.com item ID — cannot log the release" });
      return;
    }
    const profileMondayId = profile.monday_item_id;

    const detentions = getOpenDetentions(db, localId);
    if (detentions.length === 0) {
      res.status(409).json({ error: "This client has no open court case with a detention facility" });
      return;
    }
    if (detentions.some((d) => !d.mondayItemId)) {
      res.status(409).json({ error: "A court case with the facility has no Monday.com item ID" });
      return;
    }

    const schema = getBoardColumnsFor(db, "court_cases");
    const facilityCol = schema?.columns.find((c) => /^det\.?\s*facility$/i.test(c.title.trim()));
    if (!schema || !facilityCol) {
      res.status(409).json({ error: "Could not resolve the Det. Facility column on Court Cases — run a sync first" });
      return;
    }

    let queued = false;
    const authorOid = req.user?.oid ?? null;

    // 1. Clear Det. Facility on each open court case. An empty value clears a
    //    status column (the generic column route relies on the same).
    const clearLocal = db.prepare(
      "UPDATE board_items SET column_values = json_remove(column_values, '$.det_facility') WHERE local_id = ?",
    );
    for (const d of detentions) {
      const mondayItemId = d.mondayItemId as string;
      try {
        await withTokenFallback(
          (token) => dataSource.setColumnValue(schema.mondayBoardId, mondayItemId, facilityCol.columnId, "", token),
          writeTokenOptions(req),
        );
      } catch (err) {
        console.error("[write-back] clear Det. Facility failed; queueing for retry:", err);
        queued = true;
        enqueueWrite(db, {
          opType: "change_column", targetTable: "board_items", targetLocalId: d.courtCaseLocalId,
          mondayItemId, authorOid,
          payload: { boardId: schema.mondayBoardId, columnId: facilityCol.columnId, value: "" },
        });
      }
      clearLocal.run(d.courtCaseLocalId);
    }

    // 2. Log the release in the profile's Emails & Activities.
    const input: CreateTimelineItemInput = {
      ...releaseActivity(detentions.map((d) => d.facility), releasedOn, note),
      itemId: profileMondayId,
    };
    try {
      await withTokenFallback((token) => dataSource.createTimelineItem(input, token), writeTokenOptions(req));
    } catch (err) {
      console.error("[write-back] release activity failed; queueing for retry:", err);
      queued = true;
      enqueueWrite(db, {
        opType: "create_timeline_item", targetTable: "profiles", targetLocalId: localId,
        mondayItemId: profileMondayId, authorOid, payload: { ...input },
      });
    }

    auditFromReq(req, "monday.client_released", {
      targetType: "profile", targetId: localId, targetMondayId: profileMondayId,
      metadata: {
        facilities: detentions.map((d) => d.facility),
        courtCases: detentions.map((d) => d.mondayItemId),
        releasedOn,
        queued,
      },
    });
    res.status(queued ? 202 : 200).json({ data: { released: true, pending: queued } });
  });
}
