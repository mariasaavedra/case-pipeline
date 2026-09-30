import { useState, useEffect, useMemo } from "react";
import { fetchPrescheduling } from "../api";
import type { PreschedulingResult, PreschedulingCase, WaitLevel } from "../api";
import { Link } from "./Link";
import { StatusBadge } from "./StatusBadge";
import { clientPath } from "../router";
import { SectionCode } from "./ScreenCode";
import {
  UNASSIGNED,
  formatDue,
  Tag,
  PersonChip,
  FormChip,
  CountTable,
  ListSection,
  WAIT_TONE,
  worstWait,
  waitFg,
} from "./caseBoardParts";

// =============================================================================
// P13 Prescheduling
// =============================================================================
// Paid Fee Ks waiting for the client's documents, before they become active
// cases. Same layout as P5: summary table (paralegal × PS Stage) on top, one
// filtered list below. A cell's colour is the longest wait in it, counted from
// the hire date. North Pole cases stay out of the counts, as on P5.
// See docs/features/prescheduling-and-contracts.md.

const NO_STAGE = "No stage";
const stageOf = (c: PreschedulingCase) => c.psStage ?? NO_STAGE;
const peopleOf = (c: PreschedulingCase) => (c.paralegals.length > 0 ? c.paralegals : [UNASSIGNED]);

function daysAgo(n: number): string {
  if (n <= 0) return "today";
  return n === 1 ? "yesterday" : `${n}d ago`;
}

interface Filter {
  person: string | null;
  stage: string | null;
}

// =============================================================================
// Case list (P13.3)
// =============================================================================

function NorthPoleTag({ c }: { c: PreschedulingCase }) {
  if (c.snoozed && c.northPoleUntil) {
    return <Tag color="snooze" title="Parked in North Pole — comes back on its own on this date">❄ back {formatDue(c.northPoleUntil)}</Tag>;
  }
  return (
    <Tag color="missing" title="Still in North Pole — bring it back or set a new return date on Monday">
      ⚠ {c.northPoleUntil ? `return date passed ${formatDue(c.northPoleUntil)}` : "no return date"}
    </Tag>
  );
}

function CaseRow({ c, filter, onPerson }: { c: PreschedulingCase; filter: Filter; onPerson: (name: string) => void }) {
  const goesToCourt = c.itWillGoTo?.toLowerCase().includes("court") ?? false;
  return (
    <li
      className="grid gap-x-4 gap-y-1.5 px-4 py-3 items-center grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_10rem_minmax(0,1.2fr)_minmax(0,1.4fr)]"
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${waitFg(c.waitLevel)}` }}
    >
      {/* Client + contract type + tags */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {c.clientLocalId ? (
            <Link href={clientPath(c.clientLocalId)} className="font-medium hover:underline truncate" style={{ color: "var(--color-ink)" }}>
              {c.clientName}
            </Link>
          ) : (
            <span className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{c.clientName}</span>
          )}
          {c.notCooperating && (
            <Tag color="overdue" title="Reminder sent and no evidence received since">Not cooperating</Tag>
          )}
          {goesToCourt && <Tag color="court" title={`It will go to: ${c.itWillGoTo}`}>Court</Tag>}
          {c.parked && <NorthPoleTag c={c} />}
        </div>
        {c.contractFor.length > 0 && (
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {c.contractFor.map((f) => <FormChip key={f} label={f} />)}
          </div>
        )}
      </div>

      {/* PS Stage */}
      <div className="min-w-0">
        {c.psStage ? <StatusBadge status={c.psStage} raw /> : <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>No stage</span>}
      </div>

      {/* Waiting since hire */}
      <div className="text-sm whitespace-nowrap">
        {c.hireDate && c.daysWaiting !== null ? (
          <>
            <span style={{ color: "var(--color-ink-muted)" }}>Hired {formatDue(c.hireDate)}</span>
            <span className="ml-1.5 font-semibold" style={{ color: waitFg(c.waitLevel) }}>{c.daysWaiting}d</span>
          </>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>No hire date</span>
        )}
      </div>

      {/* Reminder / evidence */}
      <div className="text-xs leading-5 min-w-0">
        <div style={{ color: c.notCooperating ? "var(--urgency-overdue)" : "var(--color-ink-muted)" }}>
          {c.reminderSentOn && c.daysSinceReminder !== null
            ? `Reminder ${formatDue(c.reminderSentOn)} · ${daysAgo(c.daysSinceReminder)}`
            : "No reminder yet"}
        </div>
        {c.evidenceReceivedOn && (
          <div style={{ color: "var(--color-ink-faint)" }}>Evidence {formatDue(c.evidenceReceivedOn)}</div>
        )}
      </div>

      {/* People */}
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {peopleOf(c).map((p) => (
          <PersonChip key={p} name={p} active={filter.person === p} onClick={() => onPerson(p)} />
        ))}
        {c.attorney && (
          <span className="text-xs truncate" style={{ color: "var(--color-ink-faint)" }} title="Attorney">
            Atty: <span style={{ color: "var(--color-ink-muted)" }}>{c.attorney}</span>
          </span>
        )}
      </div>
    </li>
  );
}

// =============================================================================
// PreschedulingPage
// =============================================================================

export function PreschedulingPage() {
  const [data, setData] = useState<PreschedulingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>({ person: null, stage: null });
  const [notCoopOnly, setNotCoopOnly] = useState(false);
  const [parkedView, setParkedView] = useState<"hidden" | "all" | "needsDate">("hidden");

  useEffect(() => {
    fetchPrescheduling()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const active = useMemo(() => (data?.cases ?? []).filter((c) => !c.parked), [data]);
  const parked = (data?.cases ?? []).filter((c) => c.parked);
  const parkedNeedingDate = parked.filter((c) => !c.snoozed).length;
  const notCoopCount = active.filter((c) => c.notCooperating).length;

  const matchesPerson = (c: PreschedulingCase) => filter.person === null || peopleOf(c).includes(filter.person);
  const visible = active.filter(
    (c) => matchesPerson(c) && (filter.stage === null || stageOf(c) === filter.stage) && (!notCoopOnly || c.notCooperating),
  );
  const visibleParked = parked.filter(
    (c) => matchesPerson(c) && (!notCoopOnly || c.notCooperating) && (parkedView !== "needsDate" || !c.snoozed),
  );

  const t = data?.thresholds;
  const groups: { level: WaitLevel; label: string }[] = t
    ? [
        { level: "late", label: `${t.lateDays}+ days since hire` },
        { level: "waiting", label: `${t.waitingDays}–${t.lateDays - 1} days` },
        { level: "fresh", label: `Under ${t.waitingDays} days` },
        { level: "unknown", label: "No hire date" },
      ]
    : [];

  const pickPerson = (name: string) => setFilter((f) => ({ ...f, person: f.person === name ? null : name }));
  const filtered = filter.person !== null || filter.stage !== null || notCoopOnly;
  const row = (c: PreschedulingCase) => <CaseRow key={c.localId} c={c} filter={filter} onPerson={pickPerson} />;

  return (
    <div>
      {/* P13.1 — header */}
      <SectionCode code="P13.1" />
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          Prescheduling
        </h1>
        {data && t && (
          <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {active.length} paid ·{" "}
            <span style={{ color: waitFg("late") }}>
              {active.filter((c) => c.waitLevel === "late").length} waiting {t.lateDays}+ days
            </span>{" "}
            · <span style={{ color: waitFg("late") }}>{notCoopCount} not cooperating</span>
          </span>
        )}
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-faint)" }}>
        Paid Fee Ks waiting for the client's documents. Colour = longest wait since the hire date
        {t && (
          <>
            {" "}(<span style={{ color: waitFg("fresh") }}>under {t.waitingDays}</span> ·{" "}
            <span style={{ color: waitFg("waiting") }}>{t.waitingDays}+</span> ·{" "}
            <span style={{ color: waitFg("late") }}>{t.lateDays}+ days</span>)
          </>
        )}
        .
      </p>

      {!data && !error && <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading prescheduling…</div>}
      {error && (
        <div className="text-sm rounded p-3" style={{ color: "var(--urgency-overdue)", background: "var(--urgency-overdue-bg)" }}>
          {error}
        </div>
      )}
      {data && data.cases.length === 0 && (
        <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>No paid Fee Ks waiting for documents.</div>
      )}

      {data && data.cases.length > 0 && (
        <>
          <SectionCode code="P13.2" />
          <CountTable
            items={active}
            rowHeader="Paralegal"
            rowsOf={peopleOf}
            lastRow={UNASSIGNED}
            columns={data.stages}
            colOf={stageOf}
            cellTone={(cs) => WAIT_TONE[worstWait(cs.map((c) => c.waitLevel))]}
            cellTitle={(cs) => `Longest wait: ${Math.max(...cs.map((c) => c.daysWaiting ?? 0))} days since hire`}
            selected={{ row: filter.person, col: filter.stage }}
            onPick={(s) => setFilter({ person: s.row, stage: s.col })}
          />

          {/* Filter bar */}
          <div className="flex items-center gap-2 flex-wrap mt-5 mb-3">
            <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
              {visible.length} case{visible.length !== 1 ? "s" : ""}
            </span>
            {filter.person && (
              <button type="button" className="filter-chip filter-chip-active" onClick={() => setFilter({ ...filter, person: null })}>
                {filter.person} ×
              </button>
            )}
            {filter.stage && (
              <button type="button" className="filter-chip filter-chip-active" onClick={() => setFilter({ ...filter, stage: null })}>
                {filter.stage} ×
              </button>
            )}
            {notCoopCount > 0 && (
              <button
                type="button"
                className="filter-chip"
                onClick={() => setNotCoopOnly((v) => !v)}
                aria-pressed={notCoopOnly}
                style={{
                  color: "var(--urgency-overdue)",
                  borderColor: "var(--urgency-overdue)",
                  background: notCoopOnly ? "var(--urgency-overdue-bg)" : undefined,
                }}
                title={`Reminder sent ${t?.reminderDays}+ days ago and no evidence received since`}
              >
                {notCoopCount} not cooperating
              </button>
            )}
            {parked.length > 0 && (
              <button
                type="button"
                className={`filter-chip ${parkedView === "all" ? "filter-chip-active" : ""}`}
                onClick={() => setParkedView((v) => (v === "all" ? "hidden" : "all"))}
                aria-pressed={parkedView === "all"}
                title="Cases sent to North Pole are out of sight for now and not counted."
              >
                ❄ {parkedView === "all" ? "Hide" : "Show"} {parked.length} in North Pole
              </button>
            )}
            {parkedNeedingDate > 0 && (
              <button
                type="button"
                className="filter-chip"
                onClick={() => setParkedView((v) => (v === "needsDate" ? "hidden" : "needsDate"))}
                aria-pressed={parkedView === "needsDate"}
                style={{
                  color: "var(--urgency-missing)",
                  borderColor: "var(--urgency-missing)",
                  background: parkedView === "needsDate" ? "var(--urgency-missing-bg)" : undefined,
                }}
                title="North Pole cases whose return date passed or was never set — bring them back or set a new date on Monday."
              >
                ⚠ {parkedNeedingDate} in North Pole need a date
              </button>
            )}
            {filtered && (
              <button
                type="button"
                className="text-xs hover:underline ml-1"
                style={{ color: "var(--color-ink-muted)" }}
                onClick={() => {
                  setFilter({ person: null, stage: null });
                  setNotCoopOnly(false);
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          <SectionCode code="P13.3" />
          <div className="space-y-4">
            {visible.length === 0 && (
              <div className="card p-8 text-center text-sm" style={{ color: "var(--color-ink-faint)" }}>
                No cases match these filters.
              </div>
            )}
            {groups.map((g) => {
              const inGroup = visible.filter((c) => c.waitLevel === g.level);
              return inGroup.length > 0 ? (
                <ListSection key={g.level} title={g.label} count={inGroup.length} tone={WAIT_TONE[g.level]}>
                  {inGroup.map(row)}
                </ListSection>
              ) : null;
            })}
            {parkedView !== "hidden" && (
              <ListSection
                title={<>❄ North Pole{parkedView === "needsDate" && " — need a date"}</>}
                count={visibleParked.length}
                note="Out of sight for now — not in the counts above"
                tone="snooze"
              >
                {visibleParked.map(row)}
              </ListSection>
            )}
          </div>
        </>
      )}
    </div>
  );
}
