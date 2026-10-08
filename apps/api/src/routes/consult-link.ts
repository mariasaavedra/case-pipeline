// =============================================================================
// Consult link — connect an unlinked consult to its client's profile (P17.2)
// =============================================================================
// A consult with no profile in its Profiles column can't be prepped (M18 posts
// the note on the profile). Until now reception had to leave the page, find the
// item in Monday and connect it there. "Link client" on the row's "No profile"
// tag does it here: search a profile, pick it, and the appointment's Profiles
// (board-relation) column is set to that one item in Monday.
//
// Only an UNLINKED consult is linked: if someone connected it in Monday since
// the page loaded, the request is refused (409) rather than overwriting their
// choice. Re-linking the same profile is a no-op. Changing a link to another
// client stays a Monday job — a wrong link there is rare and deliberate.
//
// The local row is updated straight away (profile_local_id + the shaped
// `profiles` column value), so the row shows the client on the next load; the
// Monday write goes out under the user's token and is queued on an outage.
//
// `planConsultLink` is pure (consult-link.test.ts).
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
import { getBoardColumnsFor } from "@case-pipeline/query";

export interface LinkCurrent {
  boardKey: string;
  mondayItemId: string | null;
  /** The profile the row is linked to now, or null. */
  profileLocalId: string | null;
}

export interface LinkProfile {
  localId: string;
  mondayItemId: string | null;
  name: string;
}

export type LinkPlan =
  | { ok: true; noop: true }
  | { ok: true; noop: false; columnId: string; value: { item_ids: number[] } }
  | { ok: false; status: number; error: string };

/** What linking `profile` to the consult writes, or why it can't. */
export function planConsultLink(
  current: LinkCurrent | undefined,
  profile: LinkProfile | undefined,
  profilesColumnId: string | null,
): LinkPlan {
  if (!current || !current.boardKey.startsWith("appointments")) {
    return { ok: false, status: 404, error: "Appointment not found" };
  }
  if (!current.mondayItemId) {
    return { ok: false, status: 400, error: "This appointment has no Monday.com item ID" };
  }
  if (!profile) return { ok: false, status: 404, error: "Client profile not found" };
  if (!profile.mondayItemId) {
    return { ok: false, status: 400, error: "This profile has no Monday.com item ID yet — try again after the next sync" };
  }
  if (current.profileLocalId === profile.localId) return { ok: true, noop: true };
  if (current.profileLocalId) {
    return {
      ok: false,
      status: 409,
      error: "This consult was linked to a client since the page loaded — refresh to see who. Change a link in Monday.",
    };
  }
  if (!profilesColumnId) {
    return { ok: false, status: 409, error: "Could not find the appointment's Profiles column — run a sync first" };
  }
  return { ok: true, noop: false, columnId: profilesColumnId, value: { item_ids: [Number(profile.mondayItemId)] } };
}

export interface ConsultLinkDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerConsultLinkRoutes(app: Express, deps: ConsultLinkDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  // Body: { profileLocalId }.
  app.post("/api/reception/consults/:localId/profile", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
      return;
    }
    const body = (req.body ?? {}) as { profileLocalId?: unknown };
    const profileLocalId = typeof body.profileLocalId === "string" ? body.profileLocalId.trim() : "";
    if (!profileLocalId) {
      res.status(400).json({ error: "profileLocalId is required" });
      return;
    }
    const localId = String(req.params.localId);

    const appt = db
      .prepare(
        `SELECT bi.board_key AS boardKey, bi.monday_item_id AS mondayItemId, bi.column_values AS columnValues,
                p.local_id AS profileLocalId
           FROM board_items bi
           LEFT JOIN profiles p ON p.local_id = bi.profile_local_id AND p.deleted_at IS NULL
          WHERE bi.local_id = ? AND bi.deleted_at IS NULL`,
      )
      .get(localId) as (LinkCurrent & { columnValues: string | null }) | undefined;
    const profile = db
      .prepare(
        `SELECT local_id AS localId, monday_item_id AS mondayItemId, name
           FROM profiles WHERE local_id = ? AND deleted_at IS NULL`,
      )
      .get(profileLocalId) as LinkProfile | undefined;
    const profilesCol = appt
      ? getBoardColumnsFor(db, appt.boardKey)?.columns.find(
          (c) => c.type === "board_relation" && c.title.trim().toLowerCase() === "profiles",
        )
      : undefined;

    const plan = planConsultLink(appt, profile, profilesCol?.columnId ?? null);
    if (!plan.ok) {
      res.status(plan.status).json({ error: plan.error });
      return;
    }
    if (plan.noop) {
      res.json({ data: { profileLocalId, profileName: profile!.name, pending: false } });
      return;
    }

    const boardId = getBoardColumnsFor(db, appt!.boardKey)!.mondayBoardId;
    const mondayItemId = appt!.mondayItemId!;
    let pending = false;
    try {
      await withTokenFallback(
        (token) => dataSource.setColumnValueJson(boardId, mondayItemId, plan.columnId, plan.value, token),
        writeTokenOptions(req),
      );
    } catch (err) {
      console.error("[write-back] consult profile link failed; queueing for retry:", err);
      pending = true;
      enqueueWrite(db, {
        opType: "change_column_json", targetTable: "board_items", targetLocalId: localId,
        mondayItemId, authorOid: req.user?.oid ?? null,
        payload: { boardId, columnId: plan.columnId, value: plan.value },
      });
    }

    // Local copy now, in the shape the sync writes, so the next load shows it.
    let cv: Record<string, unknown> = {};
    try {
      cv = JSON.parse(appt!.columnValues ?? "{}") as Record<string, unknown>;
    } catch {
      // leave cv empty
    }
    cv.profiles = { linked_item_ids: [profile!.mondayItemId], display_value: profile!.name };
    db.prepare(`UPDATE board_items SET profile_local_id = ?, column_values = ? WHERE local_id = ?`)
      .run(profile!.localId, JSON.stringify(cv), localId);

    auditFromReq(req, "monday.consult_profile_linked", {
      targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
      metadata: { boardKey: appt!.boardKey, profileLocalId: profile!.localId, profileMondayId: profile!.mondayItemId, queued: pending },
    });
    res.status(pending ? 202 : 200).json({ data: { profileLocalId: profile!.localId, profileName: profile!.name, pending } });
  });
}
