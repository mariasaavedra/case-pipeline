import { useState, useEffect, useMemo, useCallback } from "react";
import { fetchCourtCases, changeCourtCasePrepStage } from "../api";
import type { CourtCasesResult, CourtCase, CourtCaseFlag, Readiness } from "../api";
import { navigate } from "../router";
import { ClientLink } from "./ClientPeek";
import { SectionCode } from "./ScreenCode";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { formatDue, PersonChip, Tag, CountTable, ListSection } from "./caseBoardParts";

// =============================================================================
// P15 Court Cases
// =============================================================================
// Active immigration court cases, two views over one fetch:
//   - Docket (/court-cases): upcoming hearings by week — judge, method, type.
//   - Prep Pipeline (/court-cases/prep): cases by Case Prep Status, coloured by
//     whether prep is keeping up with the hearing date; the stage can be moved
//     from here (written to Monday).
// A strip of data problems (past hearing, awaiting a new date, no date, profile
// not connected) sits above both. See docs/features/court-cases.md.

type View = "docket" | "prep";
const NO_STAGE = "No stage";
const NO_ATTORNEY = "No attorney";
const ALL = "";

const stageOf = (c: CourtCase) => c.prepStage ?? NO_STAGE;
const attorneyOf = (c: CourtCase) => c.attorney ?? NO_ATTORNEY;

// Readiness → --urgency-* token. on_track stays neutral on the docket and green on the pipeline.
const READY_TONE: Record<Readiness, string | null> = { behind: "overdue", at_risk: "missing", on_track: "later", n_a: null };
const READY_RANK: Record<Readiness, number> = { behind: 0, at_risk: 1, on_track: 2, n_a: 3 };
const READY_LABEL: Record<Readiness, string> = { behind: "Behind", at_risk: "At risk", on_track: "On track", n_a: "" };
const readyFg = (r: Readiness) => (READY_TONE[r] ? `var(--urgency-${READY_TONE[r]})` : "var(--color-ink-muted)");
const worstReadiness = (rs: Readiness[]) => rs.reduce<Readiness>((w, r) => (READY_RANK[r] < READY_RANK[w] ? r : w), "n_a");

const FLAG_LABEL: Record<CourtCaseFlag, string> = {
  past_hearing: "Hearing date passed",
  awaiting_new_date: "Awaiting new date",
  no_hearing_date: "No hearing date",
  connect_profile: "Profile not connected",
};
const FLAGS: CourtCaseFlag[] = ["past_hearing", "awaiting_new_date", "no_hearing_date", "connect_profile"];

const WINDOWS = [30, 60, 90] as const;
type Window = (typeof WINDOWS)[number] | "all";

interface Filter {
  judge: string;
  attorney: string;
  paralegal: string;
  kind: string;
}
const EMPTY_FILTER: Filter = { judge: ALL, attorney: ALL, paralegal: ALL, kind: ALL };

// =============================================================================
// Helpers
// =============================================================================

function countdown(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return `${-days}d ago`;
  return `in ${days}d`;
}

function formatTime(hhmm: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h! >= 12 ? "pm" : "am";
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")}${suffix}`;
}

/** Monday of the hearing's week, as YYYY-MM-DD. */
function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekday(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function kindTag(c: CourtCase) {
  const label = c.hearingKind === "trial" ? "Trial" : c.hearingKind === "mch" ? "MCH" : c.hearingType;
  return label ? <Tag color="court" title={c.hearingType ?? undefined}>{label}</Tag> : null;
}

// =============================================================================
// Shared row pieces
// =============================================================================

function ClientCell({ c }: { c: CourtCase }) {
  return (
    <div className="min-w-0">
      {c.clientLocalId ? (
        <ClientLink clientId={c.clientLocalId} className="font-medium hover:underline truncate block" style={{ color: "var(--color-ink)" }}>
          {c.clientName}
        </ClientLink>
      ) : (
        <span className="font-medium truncate block" style={{ color: "var(--color-ink)" }}>{c.clientName}</span>
      )}
      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-xs" style={{ color: "var(--color-ink-faint)" }}>
        {kindTag(c)}
        {c.detained && <Tag color="critical">Detained</Tag>}
        {c.needsWebex && <Tag color="missing" title={c.method ?? undefined}>Needs Webex</Tag>}
        {c.aNumber && <span className="tabular-nums">A# {c.aNumber}</span>}
        {c.service && <span>· {c.service}</span>}
        {c.flags.map((f) => (
          <Tag key={f} color="overdue">{FLAG_LABEL[f]}</Tag>
        ))}
      </div>
    </div>
  );
}

function People({ c, filter, onPerson }: { c: CourtCase; filter: Filter; onPerson: (key: "attorney" | "paralegal", name: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
      {c.attorney && <PersonChip name={c.attorney} active={filter.attorney === c.attorney} onClick={() => onPerson("attorney", c.attorney!)} />}
      {c.paralegals.map((p) => (
        <span key={p} className="text-xs" style={{ color: "var(--color-ink-faint)" }} title="Paralegal">
          <button type="button" className="hover:underline" style={{ color: filter.paralegal === p ? "var(--color-amber-dark)" : "var(--color-ink-muted)" }} onClick={() => onPerson("paralegal", p)}>
            {p}
          </button>
        </span>
      ))}
    </div>
  );
}

// =============================================================================
// Docket view
// =============================================================================

function DocketRow({ c, filter, onPerson }: { c: CourtCase; filter: Filter; onPerson: (key: "attorney" | "paralegal", name: string) => void }) {
  return (
    <li
      className="grid gap-x-4 gap-y-1.5 px-4 py-3 items-center grid-cols-1 md:grid-cols-[8.5rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)]"
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${readyFg(c.readiness)}` }}
    >
      <div className="text-sm whitespace-nowrap">
        {c.hearingDate ? (
          <>
            <div style={{ color: "var(--color-ink)" }}>
              {weekday(c.hearingDate)}, {formatDue(c.hearingDate)}
            </div>
            <div className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {formatTime(c.hearingTime)}
              {c.daysToHearing !== null && (
                <span className="ml-1.5 font-semibold" style={{ color: c.daysToHearing <= 7 ? "var(--urgency-critical)" : "var(--color-ink-muted)" }}>
                  {countdown(c.daysToHearing)}
                </span>
              )}
            </div>
          </>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>No date</span>
        )}
      </div>
      <ClientCell c={c} />
      <div className="text-sm min-w-0">
        <div className="truncate" style={{ color: c.judge ? "var(--color-ink)" : "var(--color-ink-faint)" }} title="Judge">
          {c.judge ?? "No judge"}
        </div>
        <div className="text-xs truncate" style={{ color: "var(--color-ink-faint)" }} title="Method">{c.method ?? ""}</div>
      </div>
      <div className="text-xs min-w-0" title="Case Prep Status">
        <span style={{ color: "var(--color-ink-muted)" }}>{c.prepStage ?? NO_STAGE}</span>
        {c.readiness === "behind" || c.readiness === "at_risk" ? (
          <div className="font-semibold" style={{ color: readyFg(c.readiness) }}>{READY_LABEL[c.readiness]}</div>
        ) : null}
      </div>
      <People c={c} filter={filter} onPerson={onPerson} />
    </li>
  );
}

function DocketView({
  cases,
  filter,
  onPerson,
  showingProblem,
}: {
  cases: CourtCase[];
  filter: Filter;
  onPerson: (key: "attorney" | "paralegal", name: string) => void;
  showingProblem: boolean;
}) {
  const [window, setWindow] = useState<Window>(30);

  // A problem filter shows those cases as they are (dated or not); otherwise
  // the docket is upcoming hearings inside the window.
  const visible = showingProblem
    ? cases
    : cases.filter((c) => c.daysToHearing !== null && c.daysToHearing >= 0 && (window === "all" || c.daysToHearing <= window));

  const weeks = new Map<string, CourtCase[]>();
  const undated: CourtCase[] = [];
  for (const c of visible) {
    if (!c.hearingDate) undated.push(c);
    else {
      const w = weekStart(c.hearingDate);
      weeks.set(w, [...(weeks.get(w) ?? []), c]);
    }
  }
  const thisWeek = weekStart(new Date().toISOString().slice(0, 10));

  return (
    <>
      {!showingProblem && (
        <div className="flex items-center gap-2 flex-wrap mb-3" role="group" aria-label="Hearing window">
          <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Next</span>
          {WINDOWS.map((w) => (
            <button key={w} type="button" className={`filter-chip ${window === w ? "filter-chip-active" : ""}`} onClick={() => setWindow(w)}>
              {w} days
            </button>
          ))}
          <button type="button" className={`filter-chip ${window === "all" ? "filter-chip-active" : ""}`} onClick={() => setWindow("all")}>
            All upcoming
          </button>
          <span className="text-sm ml-2" style={{ color: "var(--color-ink)" }}>
            {visible.length} hearing{visible.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
      <SectionCode code="P15.4" />
      <div className="space-y-4">
        {visible.length === 0 && (
          <div className="card p-8 text-center text-sm" style={{ color: "var(--color-ink-faint)" }}>
            No hearings match these filters.
          </div>
        )}
        {[...weeks.entries()].map(([w, cs]) => (
          <ListSection
            key={w}
            title={w === thisWeek ? "This week" : `Week of ${formatDue(w)}`}
            count={cs.length}
            tone={w === thisWeek ? "critical" : null}
            note={summarizeWeek(cs)}
          >
            {cs.map((c) => <DocketRow key={c.localId} c={c} filter={filter} onPerson={onPerson} />)}
          </ListSection>
        ))}
        {undated.length > 0 && (
          <ListSection title="No hearing date" count={undated.length} tone={null}>
            {undated.map((c) => <DocketRow key={c.localId} c={c} filter={filter} onPerson={onPerson} />)}
          </ListSection>
        )}
      </div>
    </>
  );
}

function summarizeWeek(cs: CourtCase[]): string {
  const trials = cs.filter((c) => c.hearingKind === "trial").length;
  const mch = cs.filter((c) => c.hearingKind === "mch").length;
  const webex = cs.filter((c) => c.needsWebex).length;
  return [trials && `${trials} trial${trials > 1 ? "s" : ""}`, mch && `${mch} MCH`, webex && `${webex} need Webex`]
    .filter(Boolean)
    .join(" · ");
}

// =============================================================================
// Prep Pipeline view
// =============================================================================

interface StageMove {
  to: string;
  saving: boolean;
  error: string | null;
}

function StagePicker({
  c,
  options,
  onMoved,
}: {
  c: CourtCase;
  options: string[];
  onMoved: (localId: string, stage: string, pending: boolean) => void;
}) {
  const [move, setMove] = useState<StageMove | null>(null);
  const items = options.map((o) => ({ value: o, label: o }));

  const confirm = async () => {
    if (!move) return;
    setMove({ ...move, saving: true, error: null });
    try {
      const r = await changeCourtCasePrepStage(c.localId, move.to, c.prepStage);
      onMoved(c.localId, r.stage, r.pending);
      setMove(null);
    } catch (e) {
      setMove({ ...move, saving: false, error: e instanceof Error ? e.message : "Could not change the stage" });
    }
  };

  if (move) {
    return (
      <div className="text-xs space-y-1.5">
        <div style={{ color: "var(--color-ink)" }}>
          Move to <strong>{move.to}</strong>?
        </div>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" disabled={move.saving} onClick={confirm}>
            {move.saving ? "Saving…" : "Move"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={move.saving} onClick={() => setMove(null)}>
            Cancel
          </Button>
        </div>
        {move.error && <div style={{ color: "var(--urgency-overdue)" }}>{move.error}</div>}
      </div>
    );
  }

  return (
    <Select items={items} value={c.prepStage ?? ""} onValueChange={(v) => v && v !== c.prepStage && setMove({ to: v, saving: false, error: null })}>
      <SelectTrigger size="sm" className="bg-secondary text-[13px] max-w-full" aria-label={`Case Prep Status for ${c.clientName}`}>
        <SelectValue placeholder={NO_STAGE} />
      </SelectTrigger>
      <SelectContent code="D27">
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PipelineRow({
  c,
  filter,
  onPerson,
  stageOptions,
  pending,
  onMoved,
}: {
  c: CourtCase;
  filter: Filter;
  onPerson: (key: "attorney" | "paralegal", name: string) => void;
  stageOptions: string[];
  pending: boolean;
  onMoved: (localId: string, stage: string, pending: boolean) => void;
}) {
  return (
    <li
      className="grid gap-x-4 gap-y-1.5 px-4 py-3 items-center grid-cols-1 md:grid-cols-[minmax(0,2fr)_9rem_minmax(0,1fr)_minmax(0,1.2fr)_14rem]"
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${readyFg(c.readiness)}` }}
    >
      <ClientCell c={c} />
      <div className="text-sm whitespace-nowrap">
        {c.hearingDate ? (
          <>
            <span style={{ color: "var(--color-ink-muted)" }}>{formatDue(c.hearingDate)}</span>
            {c.daysToHearing !== null && (
              <span className="ml-1.5 font-semibold" style={{ color: readyFg(c.readiness) }}>{countdown(c.daysToHearing)}</span>
            )}
            {READY_LABEL[c.readiness] && c.readiness !== "on_track" && (
              <div className="text-xs font-semibold" style={{ color: readyFg(c.readiness) }}>{READY_LABEL[c.readiness]}</div>
            )}
          </>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>No date</span>
        )}
      </div>
      <div className="text-xs truncate min-w-0" style={{ color: c.judge ? "var(--color-ink-muted)" : "var(--color-ink-faint)" }} title="Judge">
        {c.judge ?? "No judge"}
      </div>
      <People c={c} filter={filter} onPerson={onPerson} />
      <div className="min-w-0">
        {stageOptions.length > 0 ? (
          <StagePicker c={c} options={stageOptions} onMoved={onMoved} />
        ) : (
          <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>{stageOf(c)}</span>
        )}
        {pending && (
          <div className="text-xs mt-1" style={{ color: "var(--urgency-missing)" }} title="Monday was unreachable; the change is queued and will be retried">
            Queued for Monday
          </div>
        )}
      </div>
    </li>
  );
}

function PipelineView({
  cases,
  stages,
  stageOptions,
  filter,
  onPerson,
  onMoved,
  pendingIds,
}: {
  cases: CourtCase[];
  stages: string[];
  stageOptions: string[];
  filter: Filter;
  onPerson: (key: "attorney" | "paralegal", name: string) => void;
  onMoved: (localId: string, stage: string, pending: boolean) => void;
  pendingIds: Set<string>;
}) {
  const [cell, setCell] = useState<{ row: string | null; col: string | null }>({ row: null, col: null });
  const visible = cases.filter(
    (c) => (cell.row === null || attorneyOf(c) === cell.row) && (cell.col === null || stageOf(c) === cell.col),
  );
  // Within a stage: most urgent first, then soonest hearing.
  const ordered = [...visible].sort(
    (a, b) =>
      READY_RANK[a.readiness] - READY_RANK[b.readiness] ||
      (a.daysToHearing ?? Number.MAX_SAFE_INTEGER) - (b.daysToHearing ?? Number.MAX_SAFE_INTEGER),
  );

  return (
    <>
      <SectionCode code="P15.3" />
      <CountTable
        items={cases}
        rowHeader="Attorney"
        rowsOf={(c) => [attorneyOf(c)]}
        lastRow={NO_ATTORNEY}
        columns={stages}
        colOf={stageOf}
        cellTone={(cs) => READY_TONE[worstReadiness(cs.map((c) => c.readiness))]}
        cellTitle={(cs) => {
          const behind = cs.filter((c) => c.readiness === "behind").length;
          return behind ? `${behind} behind schedule` : undefined;
        }}
        selected={cell}
        onPick={setCell}
      />
      <div className="flex items-center gap-2 flex-wrap mt-5 mb-3">
        <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          {visible.length} case{visible.length !== 1 ? "s" : ""}
        </span>
        {cell.row && (
          <button type="button" className="filter-chip filter-chip-active" onClick={() => setCell({ ...cell, row: null })}>
            {cell.row} ×
          </button>
        )}
        {cell.col && (
          <button type="button" className="filter-chip filter-chip-active" onClick={() => setCell({ ...cell, col: null })}>
            {cell.col} ×
          </button>
        )}
      </div>
      <SectionCode code="P15.4" />
      <div className="space-y-4">
        {visible.length === 0 && (
          <div className="card p-8 text-center text-sm" style={{ color: "var(--color-ink-faint)" }}>
            No cases match these filters.
          </div>
        )}
        {stages.map((s) => {
          const inStage = ordered.filter((c) => stageOf(c) === s);
          if (inStage.length === 0) return null;
          const behind = inStage.filter((c) => c.readiness === "behind").length;
          return (
            <ListSection key={s} title={s} count={inStage.length} tone={null} note={behind ? `${behind} behind schedule` : undefined}>
              {inStage.map((c) => (
                <PipelineRow
                  key={c.localId}
                  c={c}
                  filter={filter}
                  onPerson={onPerson}
                  stageOptions={stageOptions}
                  pending={pendingIds.has(c.localId)}
                  onMoved={onMoved}
                />
              ))}
            </ListSection>
          );
        })}
      </div>
    </>
  );
}

// =============================================================================
// Page
// =============================================================================

function FilterSelect({
  label,
  value,
  options,
  onChange,
  code,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  code: string;
}) {
  const items = [{ value: ALL, label: `All ${label.toLowerCase()}s` }, ...options.map((o) => ({ value: o, label: o }))];
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(v ?? ALL)}>
      <SelectTrigger size="sm" className={`min-w-25 bg-secondary text-[13px] ${value ? "border-primary bg-primary/6" : ""}`} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent code={code}>
        {items.map((i) => (
          <SelectItem key={i.value || "all"} value={i.value}>{i.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const uniqueSorted = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));

export function CourtCasesPage({ view }: { view: View }) {
  const [data, setData] = useState<CourtCasesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [problem, setProblem] = useState<CourtCaseFlag | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    fetchCourtCases()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);
  useEffect(load, [load]);

  const all = useMemo(() => data?.cases ?? [], [data]);
  const options = useMemo(
    () => ({
      judges: uniqueSorted(all.map((c) => c.judge)),
      attorneys: uniqueSorted(all.map((c) => c.attorney)),
      paralegals: uniqueSorted(all.flatMap((c) => c.paralegals)),
    }),
    [all],
  );

  const matches = (c: CourtCase) =>
    (!filter.judge || c.judge === filter.judge) &&
    (!filter.attorney || c.attorney === filter.attorney) &&
    (!filter.paralegal || c.paralegals.includes(filter.paralegal)) &&
    (!filter.kind || c.hearingKind === filter.kind);
  const filtered = all.filter(matches);
  const visible = problem ? filtered.filter((c) => c.flags.includes(problem)) : filtered;

  const onPerson = (key: "attorney" | "paralegal", name: string) =>
    setFilter((f) => ({ ...f, [key]: f[key] === name ? ALL : name }));

  // A stage move: update the case in place (the server already updated live.db),
  // and remember queued ones so the row says so until the next load.
  const onMoved = (localId: string, stage: string, pending: boolean) => {
    setData((d) => (d ? { ...d, cases: d.cases.map((c) => (c.localId === localId ? { ...c, prepStage: stage } : c)) } : d));
    setPendingIds((s) => {
      const next = new Set(s);
      if (pending) next.add(localId);
      else next.delete(localId);
      return next;
    });
    // Readiness and the stage list are computed server-side; refresh them quietly.
    load();
  };

  const t = data?.thresholds;
  const upcoming30 = all.filter((c) => c.daysToHearing !== null && c.daysToHearing >= 0 && c.daysToHearing <= 30).length;
  const behind = all.filter((c) => c.readiness === "behind").length;
  const filtering = Object.values(filter).some(Boolean) || problem !== null;

  return (
    <div>
      {/* P15.1 — header + view toggle */}
      <SectionCode code="P15.1" />
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          Court Cases
        </h1>
        {data && (
          <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {all.length} active · {upcoming30} hearings in the next 30 days ·{" "}
            <span style={{ color: readyFg("behind") }}>{behind} behind schedule</span>
          </span>
        )}
      </div>
      <div className="flex gap-1 mb-4" role="tablist" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <button type="button" role="tab" className="tab-button" aria-selected={view === "docket"} onClick={() => navigate("/court-cases")}>
          Docket
        </button>
        <button type="button" role="tab" className="tab-button" aria-selected={view === "prep"} onClick={() => navigate("/court-cases/prep")}>
          Prep Pipeline
        </button>
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-faint)" }}>
        {view === "docket"
          ? "Upcoming hearings by week. Left edge = prep readiness."
          : "Cases by Case Prep Status. Change a stage here and it is written to Monday."}
        {t && (
          <>
            {" "}Behind = Trial within {t.trialBehindDays} days before Trial Prep (
            <span style={{ color: readyFg("at_risk") }}>at risk within {t.trialAtRiskDays}</span>), or MCH within {t.mchBehindDays} days still in Initial Set Up.
          </>
        )}
      </p>

      {!data && !error && <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading court cases…</div>}
      {error && (
        <div className="text-sm rounded p-3" style={{ color: "var(--urgency-overdue)", background: "var(--urgency-overdue-bg)" }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* P15.2 — filters + data problems */}
          <SectionCode code="P15.2" />
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <FilterSelect label="Judge" value={filter.judge} options={options.judges} onChange={(v) => setFilter({ ...filter, judge: v })} code="D23" />
            <FilterSelect label="Attorney" value={filter.attorney} options={options.attorneys} onChange={(v) => setFilter({ ...filter, attorney: v })} code="D24" />
            <FilterSelect label="Paralegal" value={filter.paralegal} options={options.paralegals} onChange={(v) => setFilter({ ...filter, paralegal: v })} code="D25" />
            <div className="flex gap-1" role="group" aria-label="Hearing type">
              {[["", "All types"], ["mch", "MCH"], ["trial", "Trial"], ["other", "Other"]].map(([k, l]) => (
                <button key={k} type="button" className={`filter-chip ${filter.kind === k ? "filter-chip-active" : ""}`} onClick={() => setFilter({ ...filter, kind: k! })}>
                  {l}
                </button>
              ))}
            </div>
            {filtering && (
              <button
                type="button"
                className="text-sm hover:underline ml-1"
                style={{ color: "var(--color-ink-muted)" }}
                onClick={() => {
                  setFilter(EMPTY_FILTER);
                  setProblem(null);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-5" role="group" aria-label="Data problems">
            <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Needs cleanup on Monday:</span>
            {FLAGS.map((f) => {
              const n = filtered.filter((c) => c.flags.includes(f)).length;
              return (
                <button
                  key={f}
                  type="button"
                  disabled={n === 0}
                  className={`filter-chip ${problem === f ? "filter-chip-active" : ""}`}
                  style={n > 0 && problem !== f ? { color: "var(--urgency-overdue)" } : undefined}
                  onClick={() => setProblem(problem === f ? null : f)}
                >
                  {FLAG_LABEL[f]} · {n}
                </button>
              );
            })}
          </div>

          {view === "docket" ? (
            <DocketView cases={visible} filter={filter} onPerson={onPerson} showingProblem={problem !== null} />
          ) : (
            <PipelineView
              cases={visible}
              stages={data.stages.filter((s) => visible.some((c) => stageOf(c) === s))}
              stageOptions={data.stageOptions}
              filter={filter}
              onPerson={onPerson}
              onMoved={onMoved}
              pendingIds={pendingIds}
            />
          )}
        </>
      )}
    </div>
  );
}
