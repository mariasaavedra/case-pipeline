// =============================================================================
// Case timeline (P3.9) — one client's case as dated milestones
// =============================================================================
// Turns everything synced for one profile into a single list of dated events
// on five tracks (court, USCIS, fees, meetings, notes), plus a short summary
// ("Where it stands", "Needs attention", "Coming up").
//
// Sources, in order:
//   1. board_items + contracts — the dates `config/timeline.yaml` names per
//      board, then the RULES below for what a date + label can't express;
//   2. Emails & Activities entries of the types the config lists (Filing
//      Complete, HEARING NOTICE, IJ - Order/Decision…), folded into a
//      same-day board filing where one exists;
//   3. corrections that need the whole list: a hearing a later Calendaring
//      item says was continued ("CONT. FROM 8/14/26"), a hearing on the day
//      the court decided ("decided"), hearings after the case closed.
//
// What it cannot know: Monday keeps only the CURRENT status, so "rescheduled"
// is read from today's Calendaring status/group, not from when it changed.
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type {
  TimelineConfig,
  TimelineBoardConfig,
  TimelineKind,
  TimelineTrack,
} from "@case-pipeline/config";
import { BIA_APPEAL_DAYS } from "./appeal-deadlines";

export type { TimelineTrack, TimelineKind } from "@case-pipeline/config";

export type TimelineEventStatus =
  | "done" // the hearing happened (Calendaring: ATTENDED)
  | "cancelled" // rescheduled, continued, not happening, no-show, never signed
  | "unknown" // a past hearing whose outcome nobody recorded
  | "decided" // no hearing outcome, but the court decided that day
  | "upcoming"
  | "good"
  | "bad"
  | "neutral"
  | "deadline"
  | "met"; // a deadline with its filing on or before the day

export interface TimelineEvent {
  date: string;
  track: TimelineTrack;
  kind: TimelineKind;
  label: string;
  status: TimelineEventStatus | null;
  detail: string | null;
  /** The Monday item's name, or "E&A · <type>". */
  source: string;
  boardKey: string | null;
  itemLocalId: string | null;
}

export interface TimelineNote {
  tone: "bad" | "warn" | "good" | null;
  date: string | null;
  text: string;
}

export interface CaseTimeline {
  profileLocalId: string;
  today: string;
  events: TimelineEvent[];
  /** Notes + emails per month ("2026-03"), for the activity strip. */
  notesByMonth: { month: string; count: number }[];
  summary: {
    standing: TimelineNote[];
    attention: TimelineNote[];
    next: TimelineEvent[];
  };
}

export interface CaseTimelineOptions {
  /** The firm's today, YYYY-MM-DD. */
  today: string;
  /** Zone E&A timestamps are dated in. Omitted = their UTC date. */
  timeZone?: string;
}

/** How far back "Needs attention" looks for a missed deadline. */
export const ATTENTION_LOOKBACK_DAYS = 45;

// =============================================================================
// Column helpers
// =============================================================================

type Columns = Record<string, unknown>;

function parse(cv: string | null): Columns {
  if (!cv) return {};
  try {
    const v = JSON.parse(cv);
    return v && typeof v === "object" ? (v as Columns) : {};
  } catch {
    return {};
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export function dateOf(cv: Columns, key: string): string | null {
  let v = cv[key];
  if (v && typeof v === "object") v = (v as { date?: unknown }).date;
  return typeof v === "string" && ISO_DATE.test(v) ? v.slice(0, 10) : null;
}

export function textOf(cv: Columns, key: string): string | null {
  const v = cv[key];
  if (v && typeof v === "object") {
    const o = v as { label?: unknown; labels?: unknown; text?: unknown };
    if (typeof o.label === "string") return o.label || null;
    if (Array.isArray(o.labels)) return o.labels.filter((x) => typeof x === "string").join(", ") || null;
    if (typeof o.text === "string") return o.text || null;
    return null;
  }
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** "9/11/26" → "2026-09-11". */
export function usDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** "MASTER CALENDAR HEARING" → "Master Calendar Hearing"; mixed case is left alone. */
function tameCaps(s: string): string {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** {col}, {col|fallback}, {status}, {who} — see config/timeline.yaml. */
export function renderTemplate(tpl: string, cv: Columns, vars: Record<string, string | null>): string {
  return tpl.replace(/\{(\w+)(?:\|([^}]*))?\}/g, (_, key: string, fallback?: string) => {
    const v = key in vars ? vars[key] : textOf(cv, key);
    return v ?? fallback ?? "";
  });
}

function boardConfigFor(config: TimelineConfig, boardKey: string): TimelineBoardConfig | undefined {
  const exact = config.boards[boardKey];
  if (exact) return exact;
  for (const [key, cfg] of Object.entries(config.boards)) {
    if (key.endsWith("*") && boardKey.startsWith(key.slice(0, -1))) return cfg;
  }
  return undefined;
}

// =============================================================================
// Rules — milestones that need more than a date + label
// =============================================================================

interface Item {
  boardKey: string;
  localId: string;
  name: string;
  status: string | null;
  group: string | null;
  cv: Columns;
}

interface RuleContext {
  today: string;
  /** The profile has an Appeals board item (its stored due date wins over +30 days). */
  hasAppeal: boolean;
  pendingMotions: string[];
}

type Add = (date: string | null, kind: TimelineKind, label: string, extra?: { status?: TimelineEventStatus | null; detail?: string | null; track?: TimelineTrack }) => void;

const COURT_OUTCOME = /^\[(ORDERED REMOVED|ADMIN CLOSED|TERMINATED|RELIEF GRANTED|GRANTED)[^\d\]]*(\d{1,2}\/\d{1,2}\/\d{2,4})\]/i;

const OUTCOME_LABEL: Record<string, string> = {
  "ORDERED REMOVED": "Ordered Removed",
  "ADMIN CLOSED": "Administratively Closed",
  TERMINATED: "Terminated",
  "RELIEF GRANTED": "Relief Granted",
  GRANTED: "Granted",
};

const OUTCOME_LABELS = new Set(Object.values(OUTCOME_LABEL));

/** "[MTAC] - LB - …" → "MTAC"; Monday's "MTACorMTCinAlt." loses the dot. */
function motionName(item: Item): string {
  const raw = textOf(item.cv, "motion") ?? item.name.match(/\[([^\]]+)\]/)?.[1] ?? "Motion";
  return raw.replace(/\.+$/, "");
}

const RULES: Record<string, (item: Item, add: Add, ctx: RuleContext) => void> = {
  court_outcome(item, add, ctx) {
    const m = item.name.match(COURT_OUTCOME);
    if (!m?.[1] || !m[2]) return;
    const date = usDate(m[2]);
    const key = m[1].toUpperCase();
    const removed = key === "ORDERED REMOVED";
    add(date, "decision", OUTCOME_LABEL[key] ?? key, { status: removed ? "bad" : /GRANTED/.test(key) ? "good" : "neutral" });
    if (removed && date && !ctx.hasAppeal) {
      add(addDays(date, BIA_APPEAL_DAYS), "deadline", `BIA appeal deadline (${BIA_APPEAL_DAYS} days)`, {
        status: "deadline",
        detail: `Counted from the removal date — no Appeals board item yet.`,
      });
    }
  },

  calendaring(item, add, ctx) {
    const type = textOf(item.cv, "type") ?? "";
    const st = item.status ?? "";
    const cancelled = /NOT HAPPENING|RESCHED/i.test(st) || /RESCHEDULED|CONTINUED/i.test(item.group ?? "");
    const hearing = dateOf(item.cv, "hearing_date_calendaring");
    if (hearing) {
      const status: TimelineEventStatus = cancelled
        ? "cancelled"
        : /ATTENDED/i.test(st)
          ? "done"
          : hearing > ctx.today
            ? "upcoming"
            : "unknown";
      add(hearing, "hearing", type ? `${type} hearing` : "Hearing", { status, detail: st ? `Calendaring status: ${st}` : null });
      add(dateOf(item.cv, "due_date"), "deadline", `Filing deadline before ${type ? type.toLowerCase() + " " : ""}hearing`, { status: "deadline" });
    }
    const interview = dateOf(item.cv, "interview_date");
    add(interview, "hearing", "USCIS interview", {
      track: "uscis",
      status: cancelled ? "cancelled" : interview && interview > ctx.today ? "upcoming" : "unknown",
    });
  },

  appeal(item, add) {
    const due = dateOf(item.cv, "appeal_due");
    const filed = dateOf(item.cv, "appeal_filed_on");
    const st = item.status ? `status: ${item.status}` : null;
    add(due, "deadline", "BIA appeal due", {
      status: filed && due && filed <= due ? "met" : "deadline",
      detail: ["Appeals board", st, filed ? `filed ${filed}` : null].filter(Boolean).join(" · "),
    });
    const denied = textOf(item.cv, "relief_denied");
    add(filed, "filing", "BIA appeal filed", {
      status: "good",
      detail: [denied ? `Relief denied: ${denied}` : null, st].filter(Boolean).join(" · ") || null,
    });
  },

  motion(item, add, ctx) {
    const name = motionName(item);
    add(dateOf(item.cv, "mtn_filed_on"), "filing", `Motion filed: ${name}`);
    const decided = dateOf(item.cv, "dec_date");
    if (decided && item.status) {
      add(decided, "decision", `Motion ${item.status.toLowerCase()}: ${name}`, { status: /granted/i.test(item.status) ? "good" : "bad" });
    } else if (/^filed$/i.test(item.status ?? "")) {
      ctx.pendingMotions.push(name);
    }
  },

  rfe(item, add) {
    const type = textOf(item.cv, "type") ?? "RFE";
    const form = item.name.match(/I-?(\d{3}[A-Z]?)\s+(?:RFE|DENIED)/i) ?? item.name.match(/I-?(\d{3}[A-Z]?)/i);
    const formName = form?.[1] ? `I-${form[1].toUpperCase()}` : "Application";
    const detail = item.status ? `Status: ${item.status}` : null;
    if (/DENIAL/i.test(type)) {
      add(dateOf(item.cv, "issue_date_calendaring"), "decision", `${formName} denied`, { status: "bad" });
      add(dateOf(item.cv, "due_date_calendaring"), "deadline", /290/.test(item.name) ? "I-290B appeal due" : "Response to denial due", { status: "deadline", detail });
    } else {
      add(dateOf(item.cv, "issue_date_calendaring"), "decision", `${formName} RFE issued`, { status: "bad" });
      add(dateOf(item.cv, "due_date_calendaring"), "deadline", `${formName} RFE response due`, { status: "deadline", detail });
    }
  },

  appointment(item, add) {
    const attorney = (item.boardKey.split("_")[1] ?? "").toUpperCase();
    const st = item.status ?? "";
    const tp = item.name.match(/\[\s*TP\s*(\d)/i);
    const what = tp ? `Trial prep ${tp[1]}` : /COURT PREP/i.test(st) ? "Court prep" : "Consult";
    add(dateOf(item.cv, "consult_date"), "meeting", attorney ? `${what} with ${attorney}` : what, {
      status: /cancel|no show/i.test(st) ? "cancelled" : null,
      detail: st ? `Status: ${st}` : null,
    });
  },

  contract(item, add) {
    const signed = dateOf(item.cv, "signed_contract_received_on");
    const notGoing = /not going forward/i.test(item.status ?? "");
    if (notGoing) {
      add(dateOf(item.cv, "contract_added_on"), "milestone", "Fee K not going forward", { status: "cancelled" });
    } else if (!signed) {
      const closed = /closed/i.test(item.group ?? "");
      add(dateOf(item.cv, "contract_sent_on"), "milestone", closed ? "Fee K sent (never signed)" : "Fee K sent — awaiting signature", {
        status: closed ? "cancelled" : null,
      });
    }
    add(signed, "milestone", "Fee K signed", { status: "good" });
  },
};

// =============================================================================
// Build
// =============================================================================

interface BoardRow {
  board_key: string;
  local_id: string;
  name: string;
  status: string | null;
  group_title: string | null;
  column_values: string | null;
}

interface ActivityRow {
  created_at_source: string;
  type: string;
  body: string | null;
}

/** "Yeimy Melissa LOPEZ GALVEZ & Edier D. GALVAN-LOPEZ" on a profile named Yeimy… → " — Yeimy & Edier". */
function whoSuffix(itemName: string, profileName: string): string {
  const base = (itemName.split(" [")[0] ?? "").trim();
  if (base === (profileName.split(" [")[0] ?? "").trim()) return "";
  return " — " + base.split("&").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean).join(" & ");
}

function firmDate(ts: string, timeZone?: string): string {
  if (!timeZone || ts.length <= 10) return ts.slice(0, 10);
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts.slice(0, 10) : d.toLocaleDateString("en-CA", { timeZone });
}

export function getCaseTimeline(
  db: Database,
  profileLocalId: string,
  config: TimelineConfig,
  opts: CaseTimelineOptions,
): CaseTimeline | null {
  const profile = db.prepare("SELECT name FROM profiles WHERE local_id = ? AND deleted_at IS NULL").get(profileLocalId) as
    | { name: string }
    | undefined;
  if (!profile) return null;
  const today = opts.today;

  const boardRows = db
    .prepare(
      `SELECT board_key, local_id, name, status, group_title, column_values
         FROM board_items WHERE profile_local_id = ? AND deleted_at IS NULL`,
    )
    .all(profileLocalId) as BoardRow[];
  const contractRows = db
    .prepare(
      `SELECT 'contracts' AS board_key, local_id, name, status, group_title, raw_column_values AS column_values
         FROM contracts WHERE profile_local_id = ? AND deleted_at IS NULL`,
    )
    .all(profileLocalId) as BoardRow[];

  const events: TimelineEvent[] = [];
  const ctx: RuleContext = {
    today,
    hasAppeal: boardRows.some((r) => r.board_key === "appeals" && !r.name.includes("(copy)")),
    pendingMotions: [],
  };

  const calendaringNames: string[] = [];
  for (const row of [...boardRows, ...contractRows]) {
    if (row.name.includes("(copy)")) continue;
    const cfg = row.board_key === "contracts" ? config.contracts : boardConfigFor(config, row.board_key);
    if (!cfg) continue;
    if (cfg.skip_name && row.name.toUpperCase().includes(cfg.skip_name.toUpperCase())) continue;
    if (row.board_key === "calendaring") calendaringNames.push(row.name);

    const item: Item = {
      boardKey: row.board_key,
      localId: row.local_id,
      name: row.name,
      status: row.status,
      group: row.group_title,
      cv: parse(row.column_values),
    };
    const add: Add = (date, kind, label, extra = {}) => {
      if (!date) return;
      events.push({
        date,
        track: extra.track ?? cfg.track,
        kind,
        label,
        status: extra.status ?? null,
        detail: extra.detail ?? null,
        source: row.name,
        boardKey: row.board_key === "contracts" ? null : row.board_key,
        itemLocalId: row.local_id,
      });
    };

    const vars = { status: row.status, who: whoSuffix(row.name, profile.name) };
    for (const m of cfg.milestones ?? []) {
      add(dateOf(item.cv, m.column), m.kind, renderTemplate(m.label, item.cv, vars), {
        detail: m.detail ? renderTemplate(m.detail, item.cv, vars) : null,
      });
    }
    if (cfg.rule) RULES[cfg.rule]?.(item, add, ctx);
  }

  addActivities(db, profileLocalId, config, events, opts.timeZone);
  correctHearings(events, calendaringNames);
  // A hearing that turned out not to happen takes its filing deadline with it.
  const called = new Set(events.filter((e) => e.kind === "hearing" && e.status === "cancelled").map((e) => e.itemLocalId));
  const kept = events.filter((e) => !(e.kind === "deadline" && e.boardKey === "calendaring" && called.has(e.itemLocalId)));

  // One event per day + track + label (two Monday items often say the same thing).
  const seen = new Set<string>();
  const unique = kept.filter((e) => {
    const key = `${e.date}|${e.track}|${e.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const notesByMonth = notesPerMonth(db, profileLocalId, opts.timeZone);
  return {
    profileLocalId,
    today,
    events: unique,
    notesByMonth,
    summary: summarize(unique, ctx.pendingMotions, notesByMonth, today),
  };
}

function addActivities(db: Database, profileLocalId: string, config: TimelineConfig, events: TimelineEvent[], timeZone?: string): void {
  const types = Object.keys(config.activities ?? {});
  if (types.length === 0) return;
  const rows = db
    .prepare(
      `SELECT created_at_source, TRIM(activity_type_name) AS type, COALESCE(title, text_body) AS body
         FROM client_updates
        WHERE profile_local_id = ? AND TRIM(activity_type_name) IN (${types.map(() => "?").join(",")})
          AND created_at_source IS NOT NULL
        ORDER BY created_at_source`,
    )
    .all(profileLocalId, ...types) as ActivityRow[];

  // The same E&A entry is often stored once per connected item — one per day + type + opening.
  const seen = new Set<string>();
  for (const row of rows) {
    const cfg = config.activities[row.type];
    if (!cfg) continue;
    const date = firmDate(row.created_at_source, timeZone);
    const body = (row.body ?? "")
      .replace(/\s+/g, " ")
      .replace(/\[?https?:\/\/\S+/g, "")
      .trim();
    const key = `${date}|${row.type}|${body.slice(0, 30)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (cfg.skip_if && new RegExp(cfg.skip_if).test(body)) continue;

    const track = cfg.uscis_if && new RegExp(cfg.uscis_if).test(body) ? "uscis" : cfg.track;
    let first = body.split(/\s(?:-|Date ?:|\*\*|Tracking|Placed|via|This|CC)\s?|\. /)[0] ?? "";
    first = tameCaps(first.length <= 48 ? first : first.slice(0, 46).trimEnd() + "…");
    const label = cfg.label ? cfg.label.replace("{first}", first) : first || row.type;
    const detail = body.slice(0, 200) || null;

    // A filing the boards already show that day → the note becomes its detail.
    if (cfg.kind === "filing") {
      const twin = events.find((e) => e.kind === "filing" && e.date === date && e.itemLocalId !== null);
      if (twin) {
        twin.detail = (twin.detail ? `${twin.detail} · ` : "") + `Note: ${body.slice(0, 160)}`;
        continue;
      }
    }
    events.push({ date, track, kind: cfg.kind, label, status: null, detail, source: `E&A · ${row.type}`, boardKey: null, itemLocalId: null });
  }
}

/** Hearing outcomes that need the whole list. */
function correctHearings(events: TimelineEvent[], calendaringNames: string[]): void {
  // "(CONT. FROM 8/14/26 TO 9/9/26)" on a later item = the 8/14 hearing was continued.
  const continued = new Set<string>();
  for (const name of calendaringNames) {
    for (const m of name.matchAll(/cont\.?\s+from\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/gi)) {
      const d = m[1] ? usDate(m[1]) : null;
      if (d) continued.add(d);
    }
  }
  const courtDecisions = events.filter((e) => e.track === "court" && e.kind === "decision");
  const decidedDays = new Set(courtDecisions.map((e) => e.date));
  const closed = courtDecisions.filter((e) => OUTCOME_LABELS.has(e.label)).map((e) => e.date).sort()[0] ?? null;

  for (const e of events) {
    if (e.kind !== "hearing" || e.track !== "court") continue;
    if (continued.has(e.date) && (e.status === "unknown" || e.status === "done")) {
      e.status = "cancelled";
      e.detail = (e.detail ? `${e.detail} · ` : "") + "continued (per a later Calendaring item)";
    } else if (e.status === "unknown" && decidedDays.has(e.date)) {
      e.status = "decided";
    } else if (e.status === "unknown" && closed && e.date > closed) {
      e.status = "cancelled";
      e.detail = (e.detail ? `${e.detail} · ` : "") + "after the case was closed";
    }
  }
}

function notesPerMonth(db: Database, profileLocalId: string, timeZone?: string): { month: string; count: number }[] {
  const rows = db
    .prepare("SELECT created_at_source FROM client_updates WHERE profile_local_id = ? AND created_at_source IS NOT NULL")
    .all(profileLocalId) as { created_at_source: string }[];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const month = firmDate(r.created_at_source, timeZone).slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, count]) => ({ month, count }));
}

// =============================================================================
// Summary
// =============================================================================

export function summarize(
  events: TimelineEvent[],
  pendingMotions: string[],
  notesByMonth: { month: string; count: number }[],
  today: string,
): CaseTimeline["summary"] {
  const past = events.filter((e) => e.date <= today);
  const standing: TimelineNote[] = [];

  const outcome = past.filter((e) => e.track === "court" && e.kind === "decision" && OUTCOME_LABELS.has(e.label)).pop();
  if (outcome) {
    standing.push({ tone: outcome.status === "bad" ? "bad" : outcome.status === "good" ? "good" : null, date: outcome.date, text: `Court: ${outcome.label}` });
    const appeal = past.filter((e) => e.label === "BIA appeal filed" && e.date >= outcome.date).pop();
    if (appeal) standing.push({ tone: null, date: appeal.date, text: "Appeal filed with the BIA — waiting on the Board" });
  }
  const nta = events.find((e) => e.label === "NTA issued");
  if (nta && nta.date <= today) {
    standing.push({ tone: null, date: nta.date, text: `In proceedings ${(daysBetween(nta.date, today) / 365).toFixed(1)} years (NTA)` });
  }
  const resets = events.filter((e) => e.kind === "hearing" && e.track === "court" && e.status === "cancelled").length;
  if (resets) standing.push({ tone: "warn", date: null, text: `Hearings reset or cancelled: ${resets}` });
  const hires = events.filter((e) => e.label === "Fee K signed" || e.label.startsWith("Hired for")).length;
  const notes = notesByMonth.reduce((n, m) => n + m.count, 0);
  standing.push({ tone: null, date: null, text: `${hires} hires / signed Fee Ks · ${notes} notes & emails` });

  const attention: TimelineNote[] = [];
  for (const e of events) {
    if (e.kind !== "deadline" || e.status === "met" || e.date > today) continue;
    const ago = daysBetween(e.date, today);
    if (ago > ATTENTION_LOOKBACK_DAYS) continue;
    const filedSince = events.some((x) => x.kind === "filing" && x.track === e.track && x.date >= e.date && x.date <= today);
    if (!filedSince) {
      attention.push({ tone: "bad", date: e.date, text: `${e.label} passed ${ago === 0 ? "today" : `${ago} day${ago === 1 ? "" : "s"} ago`} — nothing filed since` });
    }
  }
  for (const e of events) {
    if (e.kind === "hearing" && e.status === "unknown") attention.push({ tone: "warn", date: e.date, text: `${e.label} — no outcome recorded` });
  }
  for (const m of pendingMotions) attention.push({ tone: "warn", date: null, text: `Motion waiting on the judge: ${m}` });

  const next = events.filter((e) => e.date > today && e.status !== "cancelled").slice(0, 4);
  return { standing, attention, next };
}
