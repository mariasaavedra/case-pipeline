// =============================================================================
// My Cases (P6) Query
// =============================================================================
// One paralegal's work in the two places it waits: Prescheduling (Paid Fee Ks,
// waiting for the client's documents) and Open Forms (Open Forms / Court Forms).
// Reuses getPrescheduling + getActiveCases, filters both to one paralegal (or
// everyone), and adds what the P6 case card needs: the E-File link (profile
// first, else the item's own mirror), the editable dates, and each board's
// status labels for the pickers.

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import { getActiveCases, type ActiveCase, type ActiveCasesOptions } from "./active-cases";
import { getPrescheduling, STAGE_ORDER, type PreschedulingCase, type PreschedulingOptions } from "./prescheduling";
import { getBoardColumnsFor } from "./board-columns";
import { getBoardStatusOptionsFor } from "./status-options";
import type { StatusColumnOption } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface MyOpenForm extends ActiveCase {
  mondayItemId: string | null;
  eFile: string | null;
  /** True when eFile came from the client's profile (not the item's mirror). */
  eFileOnProfile: boolean;
  formsApptDate: string | null;
  formsSentDate: string | null;
  hireDate: string | null;
  /** When the item landed on Open Forms (creation log), date part only. */
  onOpenFormsSince: string | null;
}

export interface MyPreschedulingCase extends PreschedulingCase {
  eFile: string | null;
  eFileOnProfile: boolean;
}

export interface MyCasesData {
  /** Every paralegal on either board, for the switcher. */
  paralegals: string[];
  prescheduling: MyPreschedulingCase[];
  openForms: MyOpenForm[];
  /** PS Stage labels (Fee Ks) in Monday's order, with colors. */
  psStages: StatusColumnOption[];
  /** Open Forms Status labels, with colors. */
  openFormStatuses: StatusColumnOption[];
  /** Cases hidden because they're parked in North Pole with a future return date. */
  snoozedCount: number;
  /** PS Stages in workflow order (Prescheduling's), for grouping the list. */
  stageOrder: string[];
  thresholds: { waitingDays: number; lateDays: number; reminderDays: number };
}

export interface MyCasesOptions {
  /** A paralegal's board name, or null for everyone. Case-insensitive. */
  paralegal: string | null;
  includeSnoozed?: boolean;
  activeCases?: ActiveCasesOptions;
  prescheduling?: PreschedulingOptions;
}

export const FEE_KS_BOARD_KEY = "fee_ks";
export const OPEN_FORMS_BOARD_KEY = "_cd_open_forms";
/** Monday column id of the Fee Ks "PS Stage" status. */
export const PS_STAGE_COLUMN_ID = "status6__1";

// =============================================================================
// Helpers
// =============================================================================

function textOf(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "label" in v && typeof (v as { label: unknown }).label === "string") {
    return (v as { label: string }).label.trim() || null;
  }
  return null;
}

/** The first link of a mirror's text ("url1, url2" when several profiles are linked). */
function firstLink(v: string | null): string | null {
  if (!v) return null;
  const first = v.split(/,\s*(?=https?:\/\/)/i)[0]?.trim();
  return first || null;
}

function parseJson(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stageRank(label: string): number {
  if (label === "Send to North Pole") return STAGE_ORDER.length + 1;
  const i = STAGE_ORDER.indexOf(label);
  return i === -1 ? STAGE_ORDER.length : i;
}

const has = (names: string[], wanted: string | null) =>
  wanted === null || names.some((n) => n.toLowerCase() === wanted.toLowerCase());

/** Profile local id → its E-File link, for the given profiles. */
function profileEFiles(db: Database, ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT local_id AS id, json_extract(raw_column_values, '$.e_file') AS eFile
         FROM profiles WHERE local_id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as { id: string; eFile: unknown }[];
  for (const r of rows) {
    const link = textOf(r.eFile);
    if (link) out.set(r.id, link);
  }
  return out;
}

// =============================================================================
// Query
// =============================================================================

export function getMyCases(db: Database, options: MyCasesOptions): MyCasesData {
  const wanted = options.paralegal?.trim() || null;
  const active = getActiveCases(db, { ...options.activeCases, includeSnoozed: true });
  const presched = getPrescheduling(db, options.prescheduling);

  // One entry per person, whatever the casing on each board (Fee Ks spelling first).
  const byLower = new Map<string, string>();
  for (const n of [...presched.cases.flatMap((c) => c.paralegals), ...active.cases.flatMap((c) => c.assignees)]) {
    if (!byLower.has(n.toLowerCase())) byLower.set(n.toLowerCase(), n);
  }
  const paralegals = [...byLower.values()].sort((a, b) => a.localeCompare(b));

  let snoozedCount = 0;
  const keep = (snoozed: boolean) => {
    if (!snoozed) return true;
    snoozedCount++;
    return !!options.includeSnoozed;
  };
  const forms = active.cases.filter((c) => has(c.assignees, wanted)).filter((c) => keep(c.snoozed));
  const fees = presched.cases.filter((c) => has(c.paralegals, wanted)).filter((c) => keep(c.snoozed));

  // What getActiveCases doesn't carry: dates for the card, the item's own E-File mirror.
  const formExtras = new Map<string, Record<string, unknown> & { mondayItemId: string | null }>();
  if (forms.length > 0) {
    const rows = db
      .prepare(
        `SELECT local_id AS id, monday_item_id AS mondayItemId, column_values AS cv
           FROM board_items WHERE local_id IN (${forms.map(() => "?").join(",")})`,
      )
      .all(...forms.map((f) => f.localId)) as { id: string; mondayItemId: string | null; cv: string | null }[];
    for (const r of rows) formExtras.set(r.id, { ...parseJson(r.cv), mondayItemId: r.mondayItemId });
  }
  const feeMirrors = new Map<string, string | null>();
  if (fees.length > 0) {
    const rows = db
      .prepare(
        `SELECT local_id AS id, json_extract(raw_column_values, '$.e_file') AS eFile
           FROM contracts WHERE local_id IN (${fees.map(() => "?").join(",")})`,
      )
      .all(...fees.map((f) => f.localId)) as { id: string; eFile: unknown }[];
    for (const r of rows) feeMirrors.set(r.id, firstLink(textOf(r.eFile)));
  }

  const profileIds = [...new Set([...forms, ...fees].map((c) => c.clientLocalId).filter((id): id is string => !!id))];
  const onProfile = profileEFiles(db, profileIds);
  const eFileOf = (clientLocalId: string | null, mirror: string | null) => {
    const own = clientLocalId ? onProfile.get(clientLocalId) ?? null : null;
    return { eFile: own ?? mirror, eFileOnProfile: own !== null };
  };
  const dateOf = (cv: Record<string, unknown> | undefined, key: string): string | null => {
    const v = cv?.[key];
    if (v && typeof v === "object" && "date" in v) return textOf((v as { date: unknown }).date);
    return null;
  };

  const openForms: MyOpenForm[] = forms.map((c) => {
    const cv = formExtras.get(c.localId);
    const since = typeof cv?.on_open_forms_since === "string" ? cv.on_open_forms_since.slice(0, 10) : null;
    return {
      ...c,
      mondayItemId: cv?.mondayItemId ?? null,
      ...eFileOf(c.clientLocalId, firstLink(textOf(cv?.e_file))),
      formsApptDate: dateOf(cv, "forms_appt_date"),
      formsSentDate: dateOf(cv, "forms_sent_date"),
      hireDate: dateOf(cv, "hire_date"),
      onOpenFormsSince: since,
    };
  });
  const prescheduling: MyPreschedulingCase[] = fees.map((c) => ({
    ...c,
    ...eFileOf(c.clientLocalId, feeMirrors.get(c.localId) ?? null),
  }));

  const psStages = getBoardColumnsFor(db, FEE_KS_BOARD_KEY)?.columns.find((col) => col.columnId === PS_STAGE_COLUMN_ID)?.options ?? [];
  const openFormStatuses = getBoardStatusOptionsFor(db, OPEN_FORMS_BOARD_KEY)?.options ?? [];

  return {
    paralegals,
    prescheduling,
    openForms,
    // Workflow order (as on P13), not Monday's label order; new labels after, North Pole last.
    psStages: psStages.filter((o) => o.label?.trim()).sort((a, b) => stageRank(a.label) - stageRank(b.label)),
    openFormStatuses: openFormStatuses.filter((o) => o.label?.trim()),
    snoozedCount,
    stageOrder: presched.stages,
    thresholds: presched.thresholds,
  };
}
