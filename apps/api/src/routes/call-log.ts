// =============================================================================
// Call Log routes
// =============================================================================
// Extracted verbatim from server.ts. The front desk's highest-traffic write
// path: create a call, edit it, and read/post the notes thread that hangs off
// it. Its decision logic (validation, payload shaping) lives in
// routes/call-log-write.ts and is unit-tested there; this module is the I/O
// and the Express wiring.
//
// Registered rather than exported as a router so the route paths stay written
// out in full at their definition, matching registerMondayOAuth/Webhook.
// =============================================================================

import type { Express } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import { randomUUID } from "node:crypto";
import { requireAuth } from "../auth/middleware.js";
import { dataSource } from "../data-source/index.js";
import { withTokenFallback } from "../write-auth.js";
import type { WriteTokenOptions } from "../write-token.js";
import { enqueueWrite } from "../write-queue/processor.js";
import { auditFromReq } from "../audit/log.js";
import { getBoardColumnsFor, getBoardStatusOptionsFor } from "@case-pipeline/query";
import { fetchWorkspaceUsers, fetchItemUpdatesBatch } from "@case-pipeline/monday";
import type { MondayWorkspaceUser, CreateTimelineItemInput } from "@case-pipeline/monday";
import {
  parseCallLogBody,
  validateCallLogBody,
  validateCallLogLanguage,
  resolveCallLogStatus,
  columnByTitle,
  buildCallLogColumnValues,
  buildMirroredColumnValues,
  resolveCallerName,
  resolveEditedCallerName,
  readMirroredPhone,
} from "./call-log-write.js";
import { parseNoteBody } from "./note-write.js";

export interface CallLogDeps {
  db: DatabaseInstance;
  mondayApiToken: string | undefined;
  writeTokenOptions: WriteTokenOptions;
}

export function registerCallLogRoutes(app: Express, deps: CallLogDeps): void {
  const { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions } = deps;

  // =============================================================================
  // Call Log — quick create + link to a profile
  // =============================================================================
  // Creates a new item on the real Call Log board, following the front desk's
  // existing convention of using the item's name as the note. Columns resolved
  // by title from the synced schema (no hardcoded ids), same rails as contract
  // creation above: personal token, queue fallback, audit. Unlike contract
  // creation, this also inserts the row into board_items immediately (matching
  // the shape scripts/sync/mapper.ts produces) so the new call appears in the
  // Call Log list right away instead of waiting for the next sync.

  let staffDirectoryCache: { users: MondayWorkspaceUser[]; fetchedAt: number } | null = null;
  const STAFF_DIRECTORY_TTL_MS = 5 * 60 * 1000;

  // The firm operates in Central Time; the API container's own system clock
  // does not (Docker defaults to UTC, and nothing here sets TZ). A call logged
  // at 2:11pm Central was landing on the Date/Hour columns as 7:11pm — computed
  // via unzoned `new Date()` calls that silently used the container's UTC
  // clock instead. Every "now" stamped onto a call must go through this zone
  // explicitly rather than relying on the process's local time.
  const FIRM_TIMEZONE = "America/Chicago";

  /**
   * Resolve a Monday numeric user id to their name via the same cache
   * `/api/call-log/staff-directory` populates (refreshed here if stale/empty).
   * Best-effort: a lookup failure just leaves the local mirror blank until the
   * next full sync backfills it — never blocks the write itself.
   */
  async function resolveStaffName(userId: number | null): Promise<string | null> {
    if (userId == null) return null;
    const now = Date.now();
    if (!staffDirectoryCache || now - staffDirectoryCache.fetchedAt >= STAFF_DIRECTORY_TTL_MS) {
      try {
        staffDirectoryCache = { users: await fetchWorkspaceUsers(MONDAY_API_TOKEN!), fetchedAt: now };
      } catch (err) {
        console.error("[call-log] resolveStaffName: fetchWorkspaceUsers failed:", err);
        return null;
      }
    }
    return staffDirectoryCache.users.find((u) => Number(u.id) === userId)?.name ?? null;
  }

  app.get("/api/call-log/staff-directory", async (_req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com not configured" });
      return;
    }
    const now = Date.now();
    if (staffDirectoryCache && now - staffDirectoryCache.fetchedAt < STAFF_DIRECTORY_TTL_MS) {
      res.json({ data: staffDirectoryCache.users });
      return;
    }
    try {
      const users = await fetchWorkspaceUsers(MONDAY_API_TOKEN);
      staffDirectoryCache = { users, fetchedAt: now };
      res.json({ data: users });
    } catch (err) {
      console.error("[call-log] fetchWorkspaceUsers failed:", err);
      res.status(502).json({ error: "Could not load Monday.com users" });
    }
  });

  app.post("/api/call-log", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured" });
      return;
    }

    // Parsing, validation, and payload construction live in routes/call-log-write.ts
    // as pure functions — this route keeps the I/O (schema read, Monday mutations,
    // local mirror, audit) and delegates every decision, so the decisions are
    // unit-testable without standing up Express or a database.
    const parsed = parseCallLogBody(req.body);
    const { note, phone, language, profileLocalId, takenByUserId, highlightedForUserId, noteMentions } = parsed;
    // Blank name → the number that called. See resolveCallerName.
    const name = resolveCallerName(parsed.name, parsed.phone);

    const bodyRejection = validateCallLogBody(parsed);
    if (bodyRejection) {
      res.status(bodyRejection.status).json({ error: bodyRejection.error });
      return;
    }

    const schema = getBoardColumnsFor(db, "call_log");
    if (!schema) {
      res.status(409).json({ error: "Call Log column schema not synced yet — run a sync first" });
      return;
    }

    const statusDef = getBoardStatusOptionsFor(db, "call_log");
    const statusResult = resolveCallLogStatus(parsed.requestedStatus, statusDef);
    if ("rejection" in statusResult) {
      const { status: code, ...rest } = statusResult.rejection;
      res.status(code).json(rest);
      return;
    }
    const status = statusResult.status;

    const languageRejection = validateCallLogLanguage(language, columnByTitle(schema, "Language"));
    if (languageRejection) {
      const { status: code, ...rest } = languageRejection;
      res.status(code).json(rest);
      return;
    }

    let profile: { monday_item_id: string | null; name: string; batch_id: number } | null = null;
    if (profileLocalId) {
      profile = db.prepare("SELECT monday_item_id, name, batch_id FROM profiles WHERE local_id = ?").get(profileLocalId) as
        | { monday_item_id: string | null; name: string; batch_id: number }
        | null;
      if (!profile) {
        res.status(404).json({ error: "Linked profile not found" });
        return;
      }
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE }); // en-CA => YYYY-MM-DD
    const nowTime = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: FIRM_TIMEZONE });

    // Column values for Monday's create_item mutation — keyed by real column id.
    const columnValues = buildCallLogColumnValues({
      schema, parsed, status, today, profileMondayItemId: profile?.monday_item_id ?? null,
    });

    // Resolved up front so a Monday outage below still lets the call get logged
    // locally with a readable "Taken by"/"Highlighted for" — best-effort, a
    // lookup failure just leaves those blank until the next full sync.
    const [takenByName, highlightedForName] = await Promise.all([
      resolveStaffName(takenByUserId),
      resolveStaffName(highlightedForUserId),
    ]);

    // Mirrors scripts/sync/mapper.ts's shapeColumnValue() output — keyed by the
    // logical config keys in config/boards.yaml, not Monday's real column ids —
    // so this row reads back exactly like one the next sync would have written.
    const mirroredColumnValues = buildMirroredColumnValues({
      parsed, status, today, nowTime,
      lastUpdated: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC"),
      takenByName, highlightedForName,
    });

    // "topics" is the Monday group id (title "Call Log") the front desk actively
    // logs into — the board's other groups ("Pending Calls", "Voicemail
    // Archive"/"Voicemails") are a different, unrelated flow. Without an explicit
    // group_id, create_item falls back to the board's default group, which is
    // not guaranteed to be this one.
    const CALL_LOG_GROUP_ID = "topics";
    const CALL_LOG_GROUP_TITLE = "Call Log";

    // Custom activity type created one-time via create_custom_activity — see
    // docs/decisions.md. Monday's built-in "Call summary" Essentials preset has
    // no API-visible id, so this is a separate (but identically-labeled) type.
    const CALL_SUMMARY_ACTIVITY_ID = "eac83484-1fd4-432c-b9eb-755abb48efe7";

    const localId = randomUUID();
    const insertLocal = (mondayItemId: string | null, syncStatus: "synced" | "pending") =>
      db
        .prepare(`
          INSERT INTO board_items
            (batch_id, local_id, monday_item_id, board_key, group_title, name, status,
             next_date, next_time, attorney, paralegals, profile_local_id, column_values,
             updated_at_source, sync_status, created_at, synced_at, last_seen_at)
          VALUES (NULL, ?, ?, 'call_log', ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
        `)
        .run(
          localId, mondayItemId, CALL_LOG_GROUP_TITLE, name, status, profileLocalId ?? "", JSON.stringify(mirroredColumnValues),
          new Date().toISOString(), syncStatus, syncStatus === "synced" ? new Date().toISOString() : null,
        );

    // The note becomes THREE separate Monday artifacts when there's a linked
    // profile, each posted independently and each best-effort (the call itself
    // is already logged by this point, so none of these failing should fail the
    // whole request — they queue and retry instead):
    //   1. A comment on the call log entry itself (postCallLogNote).
    //   2. A comment directly on the CLIENT'S OWN profile item (postProfileNote)
    //      — this is the one mirrored into client_updates, since that table
    //      represents the profile's real Monday-side update thread; mirroring
    //      the call-log-item comment there would have been misleading (it
    //      never actually existed on the profile in Monday, only locally).
    //   3. A "Call Summary" Activities entry on the profile (postActivityLog).
    //
    // @-mentions are attached to (1) ONLY. Monday notifies once per mention, so
    // repeating them on (2) would notify the same person twice for one note.
    const authorName = req.user?.name ?? req.user?.preferred_username ?? "Staff";
    const authorEmail = req.user?.email ?? req.user?.preferred_username ?? null;

    const postCallLogNote = async (mondayItemId: string) => {
      if (!note) return;
      try {
        await withTokenFallback((token) => dataSource.postUpdate(mondayItemId, note, token, undefined, noteMentions), writeTokenOptions(req));
      } catch (err) {
        console.error("[write-back] call log postUpdate (on call entry) failed; queueing for retry:", err);
        enqueueWrite(db, {
          opType: "create_update", targetTable: "board_items", targetLocalId: localId,
          mondayItemId, authorOid: req.user?.oid ?? null,
          payload: { body: note, mentions: noteMentions },
        });
      }
    };

    const postProfileNote = async () => {
      if (!note || !profile?.monday_item_id) return;
      const profileMondayItemId = profile.monday_item_id;
      const noteLocalId = randomUUID();
      const now = new Date().toISOString();
      try {
        const outcome = await withTokenFallback(
          (token) => dataSource.postUpdate(profileMondayItemId, note, token),
          writeTokenOptions(req),
        );
        db.prepare(`
          INSERT INTO client_updates
            (batch_id, local_id, monday_update_id, profile_local_id, board_item_local_id,
             board_key, author_name, author_email, text_body, body_html, source_type,
             reply_to_update_id, created_at_source, sync_status)
          VALUES (?, ?, ?, ?, ?, 'call_log', ?, ?, ?, NULL, 'update', NULL, ?, 'synced')
        `).run(profile.batch_id, noteLocalId, outcome.result, profileLocalId, localId, authorName, authorEmail, note, now);
      } catch (err) {
        console.error("[write-back] call log postUpdate (on profile) failed; queueing for retry:", err);
        db.prepare(`
          INSERT INTO client_updates
            (batch_id, local_id, monday_update_id, profile_local_id, board_item_local_id,
             board_key, author_name, author_email, text_body, body_html, source_type,
             reply_to_update_id, created_at_source, sync_status)
          VALUES (?, ?, NULL, ?, ?, 'call_log', ?, ?, ?, NULL, 'update', NULL, ?, 'pending')
        `).run(profile.batch_id, noteLocalId, profileLocalId, localId, authorName, authorEmail, note, now);
        enqueueWrite(db, {
          opType: "create_update", targetTable: "profiles", targetLocalId: profileLocalId,
          mondayItemId: profileMondayItemId, authorOid: req.user?.oid ?? null,
          payload: { body: note },
        });
      }
    };

    // A "Call Summary" activity on the linked profile, on top of the comment
    // above — see docs/decisions.md, 2026-08-25. Only meaningful when there's
    // both a note and a linked profile with a real Monday item id.
    const activityLogInput: CreateTimelineItemInput | null =
      profile?.monday_item_id && note
        ? {
            itemId: profile.monday_item_id,
            title: `Call: ${name}`,
            customActivityId: CALL_SUMMARY_ACTIVITY_ID,
            content: note,
            phone: phone || undefined,
            userId: takenByUserId ?? undefined,
          }
        : null;
    const postActivityLog = async () => {
      if (!activityLogInput) return;
      try {
        await withTokenFallback(
          (token) => dataSource.createTimelineItem(activityLogInput, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        console.error("[write-back] call log createTimelineItem failed; queueing for retry:", err);
        enqueueWrite(db, {
          opType: "create_timeline_item", targetTable: "board_items", targetLocalId: localId,
          mondayItemId: activityLogInput.itemId, authorOid: req.user?.oid ?? null,
          payload: { ...activityLogInput },
        });
      }
    };

    try {
      const outcome = await withTokenFallback(
        (token) => dataSource.createItem(schema.mondayBoardId, name, columnValues, token, CALL_LOG_GROUP_ID),
        writeTokenOptions(req),
      );
      insertLocal(outcome.result, "synced");
      // Independent Monday writes — none depends on another's result, so they
      // run concurrently to keep this quick-log popup fast.
      await Promise.all([postCallLogNote(outcome.result), postProfileNote(), postActivityLog()]);
      auditFromReq(req, "monday.call_logged", {
        targetType: "board_item", targetId: localId, targetMondayId: outcome.result,
        metadata: {
          mondayItemId: outcome.result, profileLocalId, status, name, hasNote: !!note,
          usedPersonalToken: outcome.usedPersonalToken, fellBackToSharedToken: outcome.fellBackToSharedToken,
        },
      });
      res.json({ data: { localId, mondayItemId: outcome.result, name, status, profileLocalId, pending: false } });
    } catch (err) {
      console.error("[write-back] call log createItem failed; queueing for retry:", err);
      insertLocal(null, "pending");
      // The note can't be posted until the item exists — carried in the queued
      // payload so the write-queue processor posts it right after the retried
      // create_item succeeds (see write-queue/processor.ts's "create_item" case).
      enqueueWrite(db, {
        opType: "create_item", targetTable: "board_items", targetLocalId: localId,
        mondayItemId: null, authorOid: req.user?.oid ?? null,
        payload: {
          boardId: schema.mondayBoardId, itemName: name, columnValues, groupId: CALL_LOG_GROUP_ID,
          note: note || undefined,
          // Mirrors postCallLogNote's mentions — without this the fallback path
          // would post the same comment with the @-mentions silently dropped.
          noteMentions: note && noteMentions.length ? noteMentions : undefined,
        },
      });
      // Unlike the call-log-entry comment, the profile note and activity log
      // only need the linked profile's (already-known) item id — neither
      // depends on the new call item existing, so neither is tied to the
      // create_item retry above. They're independent of each other too.
      await Promise.all([postProfileNote(), postActivityLog()]);
      auditFromReq(req, "monday.call_logged", {
        targetType: "board_item", targetId: localId, targetMondayId: null,
        metadata: { profileLocalId, status, name, hasNote: !!note, queued: true },
      });
      res.status(202).json({ data: { localId, mondayItemId: null, name, status, profileLocalId, pending: true } });
    }
  });

  // =============================================================================
  // Call Log — edit an existing entry
  // =============================================================================
  // Partial update: only fields present in the body are touched. Bespoke (not the
  // generic /api/board-items/:localId/columns PATCH) because the item's name isn't
  // a synced column and the profile-link/people/status writes need Monday's
  // JSON-valued change_column_value, not the generic endpoint's string-only path.
  // Same rails as every other write-back here: personal token → shared token
  // fallback → durable queue, applied optimistically to the local mirror either way.
  //
  // Covers every field the create popup collects except the note (which is its
  // own thread, via the /notes routes below) so the edit view can offer the same
  // form as the log view rather than a reduced "fix the name" subset.

  app.patch("/api/call-log/:localId", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured" });
      return;
    }

    const localId = String(req.params.localId);
    const item = db
      .prepare("SELECT monday_item_id, name, status, profile_local_id, column_values FROM board_items WHERE local_id = ? AND board_key = 'call_log'")
      .get(localId) as
      | { monday_item_id: string | null; name: string; status: string | null; profile_local_id: string | null; column_values: string }
      | null;
    if (!item) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    if (!item.monday_item_id) {
      res.status(400).json({ error: "Call has no Monday.com item ID yet — cannot edit until the create finishes syncing" });
      return;
    }
    const mondayItemId = item.monday_item_id; // narrowed; the write closures below can't re-narrow a field

    const body = req.body as {
      name?: unknown; phone?: unknown; profileLocalId?: unknown;
      highlightedForUserId?: unknown; takenByUserId?: unknown; status?: unknown; language?: unknown;
    };
    const hasName = "name" in body;
    const hasPhone = "phone" in body;
    const hasProfile = "profileLocalId" in body;
    const hasHighlightedFor = "highlightedForUserId" in body;
    const hasTakenBy = "takenByUserId" in body;
    const hasStatus = "status" in body;
    const hasLanguage = "language" in body;
    if (!hasName && !hasPhone && !hasProfile && !hasHighlightedFor && !hasTakenBy && !hasStatus && !hasLanguage) {
      res.status(400).json({ error: "No editable fields provided" });
      return;
    }

    const phone = hasPhone ? (body.phone ?? "").toString().trim() : undefined;
    // Same fallback as logging a call: a cleared name becomes the number on the
    // entry (the one being saved now, or the one already stored).
    let name: string | undefined;
    if (hasName) {
      const resolved = resolveEditedCallerName({
        name: (body.name ?? "").toString().trim(),
        newPhone: phone,
        storedPhone: readMirroredPhone(item.column_values),
      });
      if ("rejection" in resolved) {
        const { status: code, ...rest } = resolved.rejection;
        res.status(code).json(rest);
        return;
      }
      name = resolved.name;
    }
    const profileLocalId = hasProfile ? (body.profileLocalId ? String(body.profileLocalId) : null) : undefined;
    const toUserId = (v: unknown): number | null => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const highlightedForUserId = hasHighlightedFor ? toUserId(body.highlightedForUserId) : undefined;
    const takenByUserId = hasTakenBy ? toUserId(body.takenByUserId) : undefined;
    const status = hasStatus ? (body.status ?? "").toString().trim() : undefined;
    const language = hasLanguage ? (body.language ?? "").toString().trim() : undefined;

    const schema = getBoardColumnsFor(db, "call_log");
    if (!schema) {
      res.status(409).json({ error: "Call Log column schema not synced yet — run a sync first" });
      return;
    }
    const byTitle = (t: string) => schema.columns.find((c) => c.title.trim().toLowerCase() === t.toLowerCase());
    const phoneCol = byTitle("Phone");
    const profileCol = byTitle("link to Profiles");
    const highlightedForCol = byTitle("Highlighted For");
    const takenByCol = byTitle("Taken by");
    const statusCol = byTitle("Status");
    const languageCol = byTitle("Language");

    // Both label columns are validated against the board's own synced options —
    // Monday is called with create_labels_if_missing:false, so an unknown label
    // fails permanently rather than degrading. Same rule the create route uses.
    if (hasStatus && status) {
      const statusDef = getBoardStatusOptionsFor(db, "call_log");
      const statusRejection = resolveCallLogStatus(status, statusDef);
      if ("rejection" in statusRejection) {
        const { status: code, ...rest } = statusRejection.rejection;
        res.status(code).json(rest);
        return;
      }
    }
    if (hasLanguage) {
      const languageRejection = validateCallLogLanguage(language!, languageCol);
      if (languageRejection) {
        const { status: code, ...rest } = languageRejection;
        res.status(code).json(rest);
        return;
      }
    }

    let newProfile: { monday_item_id: string | null; name: string } | null = null;
    if (hasProfile && profileLocalId) {
      newProfile = db.prepare("SELECT monday_item_id, name FROM profiles WHERE local_id = ?").get(profileLocalId) as
        | { monday_item_id: string | null; name: string }
        | null;
      if (!newProfile) {
        res.status(404).json({ error: "Linked profile not found" });
        return;
      }
    }

    const authorOid = req.user?.oid ?? null;
    let anyQueued = false;

    const writeName = async () => {
      if (!hasName || name === item.name) return;
      try {
        await withTokenFallback(
          (token) => dataSource.setColumnValue(schema.mondayBoardId, mondayItemId, "name", name!, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        console.error("[write-back] call log rename failed; queueing for retry:", err);
        anyQueued = true;
        enqueueWrite(db, {
          opType: "change_column", targetTable: "board_items", targetLocalId: localId,
          mondayItemId, authorOid, payload: { boardId: schema.mondayBoardId, columnId: "name", value: name },
        });
      }
    };

    const writePhone = async () => {
      if (!hasPhone || !phoneCol) return;
      try {
        await withTokenFallback(
          (token) => dataSource.setColumnValue(schema.mondayBoardId, mondayItemId, phoneCol.columnId, phone!, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        console.error("[write-back] call log phone update failed; queueing for retry:", err);
        anyQueued = true;
        enqueueWrite(db, {
          opType: "change_column", targetTable: "board_items", targetLocalId: localId,
          mondayItemId, authorOid, payload: { boardId: schema.mondayBoardId, columnId: phoneCol.columnId, value: phone },
        });
      }
    };

    const writeProfile = async () => {
      if (!hasProfile || !profileCol) return;
      const value = { item_ids: newProfile?.monday_item_id ? [Number(newProfile.monday_item_id)] : [] };
      try {
        await withTokenFallback(
          (token) => dataSource.setColumnValueJson(schema.mondayBoardId, mondayItemId, profileCol.columnId, value, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        console.error("[write-back] call log profile link failed; queueing for retry:", err);
        anyQueued = true;
        enqueueWrite(db, {
          opType: "change_column_json", targetTable: "board_items", targetLocalId: localId,
          mondayItemId, authorOid, payload: { boardId: schema.mondayBoardId, columnId: profileCol.columnId, value },
        });
      }
    };

    const writeHighlightedFor = async () => {
      if (!hasHighlightedFor || !highlightedForCol) return;
      const value = { personsAndTeams: highlightedForUserId ? [{ id: highlightedForUserId, kind: "person" }] : [] };
      try {
        await withTokenFallback(
          (token) => dataSource.setColumnValueJson(schema.mondayBoardId, mondayItemId, highlightedForCol.columnId, value, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        console.error("[write-back] call log highlighted-for update failed; queueing for retry:", err);
        anyQueued = true;
        enqueueWrite(db, {
          opType: "change_column_json", targetTable: "board_items", targetLocalId: localId,
          mondayItemId, authorOid, payload: { boardId: schema.mondayBoardId, columnId: highlightedForCol.columnId, value },
        });
      }
    };

    const writeTakenBy = async () => {
      if (!hasTakenBy || !takenByCol) return;
      const value = { personsAndTeams: takenByUserId ? [{ id: takenByUserId, kind: "person" }] : [] };
      try {
        await withTokenFallback(
          (token) => dataSource.setColumnValueJson(schema.mondayBoardId, mondayItemId, takenByCol.columnId, value, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        console.error("[write-back] call log taken-by update failed; queueing for retry:", err);
        anyQueued = true;
        enqueueWrite(db, {
          opType: "change_column_json", targetTable: "board_items", targetLocalId: localId,
          mondayItemId, authorOid, payload: { boardId: schema.mondayBoardId, columnId: takenByCol.columnId, value },
        });
      }
    };

    // Status and Language are both label columns; an empty string clears them
    // (Monday reads `{}` as "no label"), which is what the modal's "—" sends.
    const writeLabelColumn = async (
      enabled: boolean,
      column: typeof statusCol,
      label: string | undefined,
      what: string,
    ) => {
      if (!enabled || !column) return;
      const value = label ? { label } : {};
      try {
        await withTokenFallback(
          (token) => dataSource.setColumnValueJson(schema.mondayBoardId, mondayItemId, column.columnId, value, token),
          writeTokenOptions(req),
        );
      } catch (err) {
        console.error(`[write-back] call log ${what} update failed; queueing for retry:`, err);
        anyQueued = true;
        enqueueWrite(db, {
          opType: "change_column_json", targetTable: "board_items", targetLocalId: localId,
          mondayItemId, authorOid, payload: { boardId: schema.mondayBoardId, columnId: column.columnId, value },
        });
      }
    };

    await Promise.all([
      writeName(), writePhone(), writeProfile(), writeHighlightedFor(), writeTakenBy(),
      writeLabelColumn(hasStatus, statusCol, status, "status"),
      writeLabelColumn(hasLanguage, languageCol, language, "language"),
    ]);

    // Apply locally regardless of whether each Monday write above succeeded or
    // was queued — same optimistic-update pattern as every other write-back
    // handler in this file; a queued write still shows the new value while it
    // retries in the background.
    let cv: Record<string, unknown> = {};
    try {
      cv = JSON.parse(item.column_values) as Record<string, unknown>;
    } catch {
      // leave cv empty
    }
    if (hasPhone) cv.phone = phone || undefined;
    if (hasStatus) {
      if (status) cv.status = { label: status };
      else delete cv.status;
    }
    if (hasLanguage) {
      if (language) cv.language = { label: language };
      else delete cv.language;
    }
    let highlightedForName: string | null = null;
    if (hasHighlightedFor) {
      highlightedForName = await resolveStaffName(highlightedForUserId ?? null);
      if (highlightedForName) cv.highlighted_for = { label: highlightedForName };
      else delete cv.highlighted_for;
    }
    let takenByName: string | null = null;
    if (hasTakenBy) {
      takenByName = await resolveStaffName(takenByUserId ?? null);
      if (takenByName) cv.taken_by = { label: takenByName };
      else delete cv.taken_by;
    }

    // `status` is a first-class board_items column as well as a mirrored column
    // value, so it has to be written in both places or the list view (which
    // reads the column) and the edit modal (which reads the mirror) disagree.
    db.prepare(`UPDATE board_items SET name = ?, profile_local_id = ?, status = ?, column_values = ? WHERE local_id = ?`).run(
      hasName ? name : item.name,
      hasProfile ? (profileLocalId ?? "") : item.profile_local_id,
      hasStatus ? (status || null) : item.status,
      JSON.stringify(cv),
      localId,
    );

    auditFromReq(req, "monday.call_edited", {
      targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
      metadata: {
        mondayItemId,
        fieldsChanged: {
          name: hasName, phone: hasPhone, profileLocalId: hasProfile,
          highlightedForUserId: hasHighlightedFor, takenByUserId: hasTakenBy,
          status: hasStatus, language: hasLanguage,
        },
        queued: anyQueued,
      },
    });

    res.status(anyQueued ? 202 : 200).json({
      data: {
        localId,
        name: hasName ? name : item.name,
        phone: hasPhone ? (phone || null) : undefined,
        profileLocalId: hasProfile ? (profileLocalId ?? null) : undefined,
        profileName: hasProfile ? (newProfile?.name ?? null) : undefined,
        highlightedFor: hasHighlightedFor ? highlightedForName : undefined,
        takenBy: hasTakenBy ? takenByName : undefined,
        status: hasStatus ? (status || null) : undefined,
        language: hasLanguage ? (language || null) : undefined,
        pending: anyQueued,
      },
    });
  });

  // =============================================================================
  // Call Log — view/add notes (the item's real Monday.com comment thread)
  // =============================================================================
  // A call's note has always just been a Monday comment (create_update) posted
  // at logging time — never mirrored locally. Rather than add a local field or
  // a new Monday column (both real trade-offs, see docs/decisions.md), this
  // reads/writes that same thread live and on demand: GET fetches it fresh from
  // Monday every time, and adding a note posts a threaded reply
  // (create_update's parent_id) onto the oldest existing top-level update, or a
  // fresh top-level update if there isn't one yet — exactly mirroring what
  // happens today when a call is first logged with a note.

  /** Monday's update `body` is HTML; strip it to plain text for display. Mirrors
   * scripts/sync/index.ts's stripHtml (not exported/importable from a script). */
  function stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/﻿/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shapeNoteEntry(u: { id: string; body: string; created_at: string; creator: { name: string } | null; replies?: { id: string; body: string; created_at: string; creator: { name: string } | null }[] }) {
    return {
      id: u.id,
      body: stripHtml(u.body),
      createdAt: u.created_at,
      authorName: u.creator?.name ?? null,
      replies: (u.replies ?? []).map((r) => ({
        id: r.id, body: stripHtml(r.body), createdAt: r.created_at, authorName: r.creator?.name ?? null,
      })),
    };
  }

  function loadCallLogItemOr404(res: import("express").Response, localId: string): { monday_item_id: string } | null {
    const item = db
      .prepare("SELECT monday_item_id FROM board_items WHERE local_id = ? AND board_key = 'call_log'")
      .get(localId) as { monday_item_id: string | null } | null;
    if (!item) {
      res.status(404).json({ error: "Call not found" });
      return null;
    }
    if (!item.monday_item_id) {
      res.status(400).json({ error: "Call has no Monday.com item ID yet — cannot load notes until the create finishes syncing" });
      return null;
    }
    return { monday_item_id: item.monday_item_id };
  }

  app.get("/api/call-log/:localId/notes", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com not configured" });
      return;
    }
    const localId = String(req.params.localId);
    const item = loadCallLogItemOr404(res, localId);
    if (!item) return;

    try {
      const byItem = await fetchItemUpdatesBatch([item.monday_item_id], 50);
      const updates = (byItem.get(item.monday_item_id) ?? [])
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(shapeNoteEntry);
      res.json({ data: { updates } });
    } catch (err) {
      console.error("[call-log] fetchItemUpdatesBatch failed:", err);
      res.status(502).json({ error: "Could not load notes from Monday.com" });
    }
  });

  app.post("/api/call-log/:localId/notes", requireAuth, async (req, res) => {
    if (!MONDAY_API_TOKEN) {
      res.status(503).json({ error: "Monday.com write-back not configured" });
      return;
    }
    const localId = String(req.params.localId);
    const item = loadCallLogItemOr404(res, localId);
    if (!item) return;
    const mondayItemId = item.monday_item_id;

    const { text: note, mentions } = parseNoteBody(req.body, "note");
    if (!note) {
      res.status(400).json({ error: "note is required" });
      return;
    }

    // Reply under the oldest existing top-level update (the original note, if
    // any) so this stays one conversation instead of a new top-level comment
    // every time; re-fetched fresh rather than trusting a stale client-held id.
    let parentId: string | undefined;
    try {
      const byItem = await fetchItemUpdatesBatch([mondayItemId], 50);
      const existing = byItem.get(mondayItemId) ?? [];
      if (existing.length > 0) {
        parentId = existing.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))[0]!.id;
      }
    } catch (err) {
      console.error("[call-log] fetchItemUpdatesBatch (for reply parent) failed; posting as a fresh top-level update:", err);
    }

    let queued = false;
    try {
      await withTokenFallback(
        (token) => dataSource.postUpdate(mondayItemId, note, token, parentId, mentions),
        writeTokenOptions(req),
      );
    } catch (err) {
      console.error("[write-back] call log note failed; queueing for retry:", err);
      queued = true;
      enqueueWrite(db, {
        opType: "create_update", targetTable: "board_items", targetLocalId: localId,
        mondayItemId, authorOid: req.user?.oid ?? null,
        payload: { body: note, parentId, mentions },
      });
    }

    auditFromReq(req, "monday.call_note_added", {
      targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
      metadata: { mondayItemId, replyTo: parentId ?? null, queued },
    });

    res.status(queued ? 202 : 200).json({ data: { pending: queued } });
  });

}
