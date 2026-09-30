import { useState, useEffect, useMemo } from "react";
import { fetchPrescheduling } from "../api";
import type { PreschedulingResult, PreschedulingCase, WaitLevel } from "../api";
import { Link } from "./Link";
import { StatusBadge } from "./StatusBadge";
import { clientPath } from "../router";
import { SectionCode } from "./ScreenCode";
import { UNASSIGNED, formatDue, Tag, PersonChip, FormChip } from "./caseBoardParts";

// =============================================================================
// P13 Prescheduling
// =============================================================================
// Paid Fee Ks waiting for the client's documents, before they become active
// cases. Same layout as P5: summary table (paralegal × PS Stage) on top, one
// filtered list below. A cell's colour is the longest wait in it, counted from
// the hire date. North Pole cases stay out of the counts, as on P5.
// See docs/features/prescheduling-and-contracts.md.

const WAIT_TOKEN: Record<WaitLevel, string | null> = {
  late: "overdue",
  waiting: "missing",
  fresh: "later",
  unknown: null,
};

const WAIT_ORDER: Record<WaitLevel, number> = { late: 0, waiting: 1, fresh: 2, unknown: 3 };

const fg = (w: WaitLevel) => (WAIT_TOKEN[w] ? `var(--urgency-${WAIT_TOKEN[w]})` : "var(--color-ink-muted)");
const bg = (w: WaitLevel) => (WAIT_TOKEN[w] ? `var(--urgency-${WAIT_TOKEN[w]}-bg)` : "var(--color-surface-warm)");

const NO_STAGE = "No stage";
const stageOf = (c: PreschedulingCase) => c.psStage ?? NO_STAGE;
const peopleOf = (c: PreschedulingCase) => (c.paralegals.length > 0 ? c.paralegals : [UNASSIGNED]);

/** The most overdue wait level among some cases. */
function worstWait(cases: PreschedulingCase[]): WaitLevel {
  return cases.reduce<WaitLevel>((w, c) => (WAIT_ORDER[c.waitLevel] < WAIT_ORDER[w] ? c.waitLevel : w), "unknown");
}

function daysAgo(n: number): string {
  if (n <= 0) return "today";
  return n === 1 ? "yesterday" : `${n}d ago`;
}

interface Filter {
  person: string | null;
  stage: string | null;
}

// =============================================================================
// Summary table (P13.2)
// =============================================================================

function SummaryTable({
  cases,
  stages,
  filter,
  onPick,
}: {
  cases: PreschedulingCase[];
  stages: string[];
  filter: Filter;
  onPick: (f: Filter) => void;
}) {
  const people = [...new Set(cases.flatMap(peopleOf))].sort((a, b) =>
    a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b),
  );

  // `strong` = the "All cases" row: heavier rule, bold numbers.
  const cell = (person: string | null, stage: string | null, strong = false) => {
    const inCell = cases.filter(
      (c) => (person === null || peopleOf(c).includes(person)) && (stage === null || stageOf(c) === stage),
    );
    const n = inCell.length;
    const wait = worstWait(inCell);
    const tinted = stage !== null && n > 0;
    const selected = filter.person === person && filter.stage === stage && (person !== null || stage !== null);
    return (
      <td
        key={stage ?? "total"}
        className="p-0.5"
        style={{ borderTop: `1px solid var(${strong ? "--color-border" : "--color-border-light"})` }}
      >
        <button
          type="button"
          disabled={n === 0}
          onClick={() => onPick(selected ? { person: null, stage: null } : { person, stage })}
          className="w-full h-9 rounded-md text-sm tabular-nums transition-shadow disabled:cursor-default"
          style={{
            background: tinted ? bg(wait) : "transparent",
            color: n === 0 ? "var(--color-ink-faint)" : tinted ? fg(wait) : "var(--color-ink)",
            fontWeight: strong || tinted ? 600 : 400,
            boxShadow: selected ? "inset 0 0 0 2px var(--color-amber)" : undefined,
          }}
          aria-pressed={selected}
          aria-label={`${person ?? "Everyone"}, ${stage ?? "all stages"}: ${n}`}
          title={n > 0 && tinted ? `Longest wait: ${Math.max(...inCell.map((c) => c.daysWaiting ?? 0))} days since hire` : undefined}
        >
          {n === 0 ? "–" : n}
        </button>
      </td>
    );
  };

  const nameCell = (label: React.ReactNode, strong: boolean, extra?: React.CSSProperties) => ({
    className: `px-2 whitespace-nowrap sticky left-0 z-10 ${strong ? "text-xs font-semibold uppercase tracking-wide" : "text-sm"}`,
    style: {
      borderTop: `1px solid var(${strong ? "--color-border" : "--color-border-light"})`,
      background: "var(--color-card)",
      ...extra,
    },
    children: label,
  });

  return (
    <div className="card overflow-x-auto p-2">
      <table className="w-full border-separate" style={{ borderSpacing: 0, minWidth: 120 + stages.length * 96 }}>
        <thead>
          <tr>
            <th
              className="text-left text-xs font-medium px-2 pb-2 sticky left-0 align-bottom"
              style={{ color: "var(--color-ink-faint)", background: "var(--color-card)" }}
            >
              Paralegal
            </th>
            {stages.map((s) => (
              <th
                key={s}
                className="text-xs font-semibold px-1 pb-2 align-bottom leading-tight"
                style={{ color: "var(--color-ink-muted)", minWidth: 88 }}
              >
                {s}
              </th>
            ))}
            <th className="text-xs font-medium px-1 pb-2 align-bottom" style={{ color: "var(--color-ink-faint)" }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const personActive = filter.person === p && filter.stage === null;
            return (
              <tr key={p}>
                <td
                  {...nameCell(
                    <button
                      type="button"
                      onClick={() => onPick(personActive ? { person: null, stage: null } : { person: p, stage: null })}
                      className="hover:underline text-left"
                      style={{
                        color: p === UNASSIGNED ? "var(--color-ink-faint)" : "var(--color-ink)",
                        fontWeight: personActive ? 600 : 500,
                      }}
                    >
                      {p}
                    </button>,
                    false,
                  )}
                />
                {stages.map((s) => cell(p, s))}
                {cell(p, null)}
              </tr>
            );
          })}
          <tr>
            <td {...nameCell("All cases", true, { color: "var(--color-ink-muted)" })} title="Each case counted once, even when it is shared" />
            {stages.map((s) => cell(null, s, true))}
            {cell(null, null, true)}
          </tr>
        </tbody>
      </table>
    </div>
  );
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
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${fg(c.waitLevel)}` }}
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
            <span className="ml-1.5 font-semibold" style={{ color: fg(c.waitLevel) }}>{c.daysWaiting}d</span>
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

function Section({
  title,
  note,
  token,
  cases,
  filter,
  onPerson,
}: {
  title: React.ReactNode;
  note?: string;
  token: string | null;
  cases: PreschedulingCase[];
  filter: Filter;
  onPerson: (name: string) => void;
}) {
  return (
    <section className="card overflow-hidden">
      <h2
        className="flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide"
        style={{
          color: token ? `var(--urgency-${token})` : "var(--color-ink-muted)",
          background: token ? `var(--urgency-${token}-bg)` : "var(--color-surface-warm)",
        }}
      >
        {title}
        <span className="font-medium" style={{ color: "var(--color-ink-muted)" }}>· {cases.length}</span>
        {note && (
          <span className="ml-auto normal-case tracking-normal font-normal" style={{ color: "var(--color-ink-muted)" }}>
            {note}
          </span>
        )}
      </h2>
      {cases.length === 0 ? (
        <p className="px-4 py-3 text-sm" style={{ color: "var(--color-ink-faint)" }}>No cases match these filters.</p>
      ) : (
        <ul>
          {cases.map((c) => <CaseRow key={c.localId} c={c} filter={filter} onPerson={onPerson} />)}
        </ul>
      )}
    </section>
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
            <span style={{ color: fg("late") }}>
              {active.filter((c) => c.waitLevel === "late").length} waiting {t.lateDays}+ days
            </span>{" "}
            · <span style={{ color: fg("late") }}>{notCoopCount} not cooperating</span>
          </span>
        )}
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-faint)" }}>
        Paid Fee Ks waiting for the client's documents. Colour = longest wait since the hire date
        {t && (
          <>
            {" "}(<span style={{ color: fg("fresh") }}>under {t.waitingDays}</span> ·{" "}
            <span style={{ color: fg("waiting") }}>{t.waitingDays}+</span> ·{" "}
            <span style={{ color: fg("late") }}>{t.lateDays}+ days</span>)
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
          <SummaryTable cases={active} stages={data.stages} filter={filter} onPick={setFilter} />

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
                <Section key={g.level} title={g.label} token={WAIT_TOKEN[g.level]} cases={inGroup} filter={filter} onPerson={pickPerson} />
              ) : null;
            })}
            {parkedView !== "hidden" && (
              <Section
                title={<>❄ North Pole{parkedView === "needsDate" && " — need a date"}</>}
                note="Out of sight for now — not in the counts above"
                token="snooze"
                cases={visibleParked}
                filter={filter}
                onPerson={pickPerson}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
