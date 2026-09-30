import { useState, useEffect, useMemo } from "react";
import { fetchActiveCases } from "../api";
import type { ActiveCasesResult, ActiveCase, Urgency } from "../api";
import { Link } from "./Link";
import { StatusBadge } from "./StatusBadge";
import { clientPath } from "../router";
import { SectionCode } from "./ScreenCode";
import { UNASSIGNED, formatDue, Tag, PersonChip, FormChip } from "./caseBoardParts";

// =============================================================================
// Buckets
// =============================================================================
// Summary table on top (paralegal × bucket counts), one filtered case list
// below. "none" is a case with no target date — treated as a problem to fix,
// so it sits right after Overdue. Colours are --urgency-* tokens (styles.css)
// so both themes stay readable. See docs/features/active-cases-redesign.md.

const BUCKETS: { key: Urgency; label: string; short: string }[] = [
  { key: "overdue",  label: "Overdue",      short: "Overdue" },
  { key: "none",     label: "Missing date", short: "No date" },
  { key: "critical", label: "1–3 days",     short: "1–3 d" },
  { key: "soon",     label: "This week",    short: "Week" },
  { key: "later",    label: "Later",        short: "Later" },
];

const BUCKET_TOKEN: Record<Urgency, string> = {
  overdue: "overdue",
  none: "missing",
  critical: "critical",
  soon: "soon",
  later: "later",
};

const fg = (u: Urgency) => `var(--urgency-${BUCKET_TOKEN[u]})`;
const bg = (u: Urgency) => `var(--urgency-${BUCKET_TOKEN[u]}-bg)`;

function countdown(days: number): string {
  if (days === 0) return "today";
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d late`;
}

// =============================================================================
// Summary table (P5.2)
// =============================================================================

interface Filter {
  person: string | null;
  bucket: Urgency | null;
}

function countByBucket(cases: ActiveCase[]): Record<Urgency, number> {
  const out: Record<Urgency, number> = { overdue: 0, none: 0, critical: 0, soon: 0, later: 0 };
  for (const c of cases) out[c.urgency]++;
  return out;
}

function SummaryTable({
  rows,
  totals,
  totalCount,
  filter,
  onPick,
}: {
  rows: { name: string; counts: Record<Urgency, number>; total: number }[];
  totals: Record<Urgency, number>;
  totalCount: number;
  filter: Filter;
  onPick: (f: Filter) => void;
}) {
  // `strong` = the "All cases" totals row: bold numbers under a heavier rule.
  const cell = (person: string | null, bucket: Urgency | null, n: number, strong = false) => {
    const selected = filter.person === person && filter.bucket === bucket && (person !== null || bucket !== null);
    const tinted = bucket !== null && n > 0;
    return (
      <td
        key={bucket ?? "total"}
        className="p-0.5"
        style={{ borderTop: `1px solid var(${strong ? "--color-border" : "--color-border-light"})` }}
      >
        <button
          type="button"
          disabled={n === 0}
          onClick={() => onPick(selected ? { person: null, bucket: null } : { person, bucket })}
          className="w-full h-9 rounded-md text-sm tabular-nums transition-shadow disabled:cursor-default"
          style={{
            background: tinted ? bg(bucket) : "transparent",
            color: n === 0 ? "var(--color-ink-faint)" : bucket ? fg(bucket) : "var(--color-ink)",
            fontWeight: strong || tinted ? 600 : 400,
            boxShadow: selected ? "inset 0 0 0 2px var(--color-amber)" : undefined,
          }}
          aria-pressed={selected}
          aria-label={`${person ?? "Everyone"}, ${bucket ? BUCKETS.find((b) => b.key === bucket)!.label : "all cases"}: ${n}`}
        >
          {n === 0 ? "–" : n}
        </button>
      </td>
    );
  };

  return (
    <div className="card overflow-x-auto p-2">
      <table className="w-full border-separate" style={{ borderSpacing: 0, minWidth: 560 }}>
        <thead>
          <tr>
            <th className="text-left text-xs font-medium px-2 pb-2 sticky left-0" style={{ color: "var(--color-ink-faint)", background: "var(--color-card)" }}>
              Paralegal
            </th>
            {BUCKETS.map((b) => (
              <th key={b.key} className="text-xs font-semibold px-1 pb-2 whitespace-nowrap" style={{ color: fg(b.key) }}>
                {b.key === "none" && <span aria-hidden>⚠ </span>}
                <span className="hidden sm:inline">{b.label}</span>
                <span className="sm:hidden">{b.short}</span>
              </th>
            ))}
            <th className="text-xs font-medium px-1 pb-2" style={{ color: "var(--color-ink-faint)" }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const personActive = filter.person === r.name && filter.bucket === null;
            return (
              <tr key={r.name}>
                <td
                  className="px-2 text-sm whitespace-nowrap sticky left-0 z-10"
                  style={{ borderTop: "1px solid var(--color-border-light)", background: "var(--color-card)" }}
                >
                  <button
                    type="button"
                    onClick={() => onPick(personActive ? { person: null, bucket: null } : { person: r.name, bucket: null })}
                    className="hover:underline text-left"
                    style={{
                      color: r.name === UNASSIGNED ? "var(--color-ink-faint)" : "var(--color-ink)",
                      fontWeight: personActive ? 600 : 500,
                    }}
                  >
                    {r.name}
                  </button>
                </td>
                {BUCKETS.map((b) => cell(r.name, b.key, r.counts[b.key]))}
                {cell(r.name, null, r.total)}
              </tr>
            );
          })}
          <tr>
            <td
              className="px-2 text-xs font-semibold uppercase tracking-wide sticky left-0 z-10"
              style={{ color: "var(--color-ink-muted)", borderTop: "1px solid var(--color-border)", background: "var(--color-card)" }}
              title="Each case counted once, even when it is shared"
            >
              All cases
            </td>
            {BUCKETS.map((b) => cell(null, b.key, totals[b.key], true))}
            {cell(null, null, totalCount, true)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Case list (P5.3)
// =============================================================================

function CaseRow({ c, filter, onPerson }: { c: ActiveCase; filter: Filter; onPerson: (name: string) => void }) {
  const people = c.assignees.length > 0 ? c.assignees : [UNASSIGNED];
  return (
    <li
      className="grid gap-x-4 gap-y-1.5 px-4 py-3 items-center grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_9rem_minmax(0,1.4fr)]"
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${fg(c.urgency)}` }}
    >
      {/* Client + form + tags */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {c.clientLocalId ? (
            <Link
              href={clientPath(c.clientLocalId)}
              className="font-medium hover:underline truncate"
              style={{ color: "var(--color-ink)" }}
            >
              {c.clientName}
            </Link>
          ) : (
            <span className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{c.clientName}</span>
          )}
          {c.urgent && <Tag color="overdue" title="Marked Urgent on Monday">Urgent</Tag>}
          {c.isCourtCase && <Tag color="court">Court</Tag>}
          {c.parked && <NorthPoleTag c={c} />}
        </div>
        {(c.forms.length > 0 || c.formName !== c.clientName) && (
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            {c.forms.map((f) => (
              <FormChip key={f} label={f} />
            ))}
            {/* The item name often is just the client's name; show it only when it adds something. */}
            {c.formName !== c.clientName && (
              <span className="text-sm truncate" style={{ color: "var(--color-ink-faint)" }} title={c.formName}>
                {c.formName}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Status */}
      <div className="min-w-0">
        <StatusBadge status={c.status} />
      </div>

      {/* Due date */}
      <div className="text-sm whitespace-nowrap">
        {c.targetDate && c.daysUntilTarget !== null ? (
          <>
            <span style={{ color: "var(--color-ink)" }}>{formatDue(c.targetDate)}</span>
            <span className="ml-1.5 font-semibold" style={{ color: fg(c.dateUrgency) }}>
              {countdown(c.daysUntilTarget)}
            </span>
          </>
        ) : (
          <span className="font-semibold" style={{ color: fg("none") }}>⚠ No date set</span>
        )}
      </div>

      {/* People */}
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {people.map((p) => (
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

// A parked case with a future return date is fine; one whose date passed or was
// never set needs someone to bring it back or set a date, so it is flagged.
function NorthPoleTag({ c }: { c: ActiveCase }) {
  if (c.snoozed && c.northPoleUntil) {
    return (
      <Tag color="snooze" title="Parked in North Pole — comes back on its own on this date">
        ❄ back {formatDue(c.northPoleUntil)}
      </Tag>
    );
  }
  return (
    <Tag color="missing" title="Still in North Pole — bring it back or set a new return date on Monday">
      ⚠ {c.northPoleUntil ? `return date passed ${formatDue(c.northPoleUntil)}` : "no return date"}
    </Tag>
  );
}

function NorthPoleList({
  cases,
  needsDateOnly,
  filter,
  onPerson,
}: {
  cases: ActiveCase[];
  needsDateOnly: boolean;
  filter: Filter;
  onPerson: (name: string) => void;
}) {
  return (
    <section className="card overflow-hidden mt-4">
      <h2
        className="flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--urgency-snooze)", background: "var(--urgency-snooze-bg)" }}
      >
        ❄ North Pole{needsDateOnly && " — need a date"}
        <span className="font-medium" style={{ color: "var(--color-ink-muted)" }}>· {cases.length}</span>
        <span className="ml-auto normal-case tracking-normal font-normal" style={{ color: "var(--color-ink-muted)" }}>
          Out of sight for now — not in the counts above
        </span>
      </h2>
      {cases.length === 0 ? (
        <p className="px-4 py-3 text-sm" style={{ color: "var(--color-ink-faint)" }}>No North Pole cases match these filters.</p>
      ) : (
        <ul>
          {cases.map((c) => (
            <CaseRow key={c.localId} c={c} filter={filter} onPerson={onPerson} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CaseList({ cases, filter, onPerson }: { cases: ActiveCase[]; filter: Filter; onPerson: (name: string) => void }) {
  const groups = BUCKETS.map((b) => ({ ...b, cases: cases.filter((c) => c.urgency === b.key) })).filter(
    (g) => g.cases.length > 0,
  );

  if (groups.length === 0) {
    return (
      <div className="card p-8 text-center text-sm" style={{ color: "var(--color-ink-faint)" }}>
        No cases match these filters.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.key} className="card overflow-hidden">
          <h2
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide"
            style={{ color: fg(g.key), background: bg(g.key) }}
          >
            {g.key === "none" && <span aria-hidden>⚠</span>}
            {g.label}
            <span className="font-medium" style={{ color: "var(--color-ink-muted)" }}>· {g.cases.length}</span>
            {g.key === "none" && (
              <span className="ml-auto normal-case tracking-normal font-normal" style={{ color: "var(--color-ink-muted)" }}>
                Set a Target Date on Monday
              </span>
            )}
          </h2>
          <ul>
            {g.cases.map((c) => (
              <CaseRow key={c.localId} c={c} filter={filter} onPerson={onPerson} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// =============================================================================
// ActiveCasesPage
// =============================================================================

export function ActiveCasesPage() {
  const [data, setData] = useState<ActiveCasesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // North Pole section: hidden, all parked cases, or only those needing a date.
  const [parkedView, setParkedView] = useState<"hidden" | "all" | "needsDate">("hidden");
  const [filter, setFilter] = useState<Filter>({ person: null, bucket: null });
  const [courtOnly, setCourtOnly] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // North Pole cases are always fetched but kept out of the counts: parked
    // means out of sight for now. The toggle only shows them in their own section.
    fetchActiveCases(true)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const inScope = (c: ActiveCase) => !courtOnly || c.isCourtCase;
  const scoped = useMemo(
    () => (data?.cases ?? []).filter((c) => !c.parked && (!courtOnly || c.isCourtCase)),
    [data, courtOnly],
  );
  const parked = (data?.cases ?? []).filter((c) => c.parked);
  const parkedNeedingDate = parked.filter((c) => !c.snoozed).length;

  const summary = useMemo(() => {
    const byPerson = new Map<string, ActiveCase[]>();
    for (const c of scoped) {
      for (const p of c.assignees.length > 0 ? c.assignees : [UNASSIGNED]) {
        byPerson.set(p, [...(byPerson.get(p) ?? []), c]);
      }
    }
    const rows = [...byPerson.entries()]
      .sort(([a], [b]) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b)))
      .map(([name, cases]) => ({ name, counts: countByBucket(cases), total: cases.length }));
    return { rows, totals: countByBucket(scoped) };
  }, [scoped]);

  const matchesPerson = (c: ActiveCase) =>
    filter.person === null ||
    (filter.person === UNASSIGNED ? c.assignees.length === 0 : c.assignees.includes(filter.person));
  const visible = scoped.filter((c) => (filter.bucket === null || c.urgency === filter.bucket) && matchesPerson(c));
  // The North Pole section follows the person + court filters, not the urgency bucket.
  const visibleParked = parked.filter(
    (c) => inScope(c) && matchesPerson(c) && (parkedView !== "needsDate" || !c.snoozed),
  );

  const pickPerson = (name: string) =>
    setFilter((f) => (f.person === name ? { ...f, person: null } : { ...f, person: name }));

  const filtered = filter.person !== null || filter.bucket !== null || courtOnly;

  return (
    <div>
      {/* P5.1 — header */}
      <SectionCode code="P5.1" />
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          Active Cases
        </h1>
        {data && (
          <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {scoped.length} open · <span style={{ color: fg("overdue") }}>{summary.totals.overdue} overdue</span> ·{" "}
            <span style={{ color: fg("none") }}>{summary.totals.none} missing a date</span>
          </span>
        )}
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-faint)" }}>
        Open and Court Forms by paralegal and due date. Click a number to see those cases.
      </p>

      {loading && !data && (
        <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading active cases…</div>
      )}

      {error && (
        <div className="text-sm rounded p-3" style={{ color: "var(--urgency-overdue)", background: "var(--urgency-overdue-bg)" }}>
          {error}
        </div>
      )}

      {data && data.cases.length === 0 && (
        <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>No active cases found.</div>
      )}

      {data && data.cases.length > 0 && (
        <>
          <SectionCode code="P5.2" />
          <SummaryTable
            rows={summary.rows}
            totals={summary.totals}
            totalCount={scoped.length}
            filter={filter}
            onPick={setFilter}
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
            {filter.bucket && (
              <button type="button" className="filter-chip filter-chip-active" onClick={() => setFilter({ ...filter, bucket: null })}>
                {BUCKETS.find((b) => b.key === filter.bucket)!.label} ×
              </button>
            )}
            <button
              type="button"
              className={`filter-chip ${courtOnly ? "filter-chip-active" : ""}`}
              onClick={() => setCourtOnly((v) => !v)}
              aria-pressed={courtOnly}
            >
              Only court
            </button>
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
                  setFilter({ person: null, bucket: null });
                  setCourtOnly(false);
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          <SectionCode code="P5.3" />
          <CaseList cases={visible} filter={filter} onPerson={pickPerson} />
          {parkedView !== "hidden" && (
            <NorthPoleList
              cases={visibleParked}
              needsDateOnly={parkedView === "needsDate"}
              filter={filter}
              onPerson={pickPerson}
            />
          )}
        </>
      )}
    </div>
  );
}
