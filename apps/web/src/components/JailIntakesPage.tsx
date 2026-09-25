// =============================================================================
// JailIntakesPage — the detainee intake funnel
// =============================================================================
// Jail intakes are PRE-PROFILE leads: someone contacts the firm about a detained
// person, and they become a client only if they book a consult. So there is no
// 360 view to link to until that happens — `convertedTo` is what turns a row
// into a client once it does.
//
// The default is deliberately a triage list, not an archive: open leads from the
// last 10 days, which is about 8 rows against a live funnel of ~292. The rest is
// one click away behind the "N older" chip rather than silently filtered out —
// a backlog you cannot see is a backlog nobody works.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { fetchJailIntakes, type JailIntake, type JailIntakeListResult } from "../api";
import { Link } from "./Link";
import { clientPath } from "../router";
import { StatusBadge } from "./StatusBadge";

const DEFAULT_WITHIN_DAYS = 10;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5 min-w-[130px]">
      <span
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
      >
        {label}
      </span>
      <span className="text-sm" style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
        {value}
      </span>
    </div>
  );
}

function IntakeRow({ intake }: { intake: JailIntake }) {
  return (
    <div
      className="px-5 py-3"
      style={{ borderBottom: "1px solid var(--color-border-light)" }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
            >
              {intake.name}
            </span>
            {intake.status && <StatusBadge status={intake.status} />}
          </div>
          <span
            className="text-[11px]"
            style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
          >
            Intake {formatDate(intake.intakeCreatedOn)}
            {intake.lastInteractionDate ? ` · last contact ${formatDate(intake.lastInteractionDate)}` : ""}
          </span>
        </div>

        {/* A converted lead is the end of the funnel — and the only point at
            which there is a client to link to. */}
        {intake.convertedTo && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className="text-[11px] px-2 py-1 rounded-md"
              style={{
                backgroundColor: "var(--color-status-green-bg)",
                color: "var(--color-status-green)",
                fontFamily: "var(--font-body)",
              }}
            >
              Consult {formatDate(intake.convertedTo.consultDate)}
            </span>
            {intake.convertedTo.profileLocalId && (
              <Link
                href={clientPath(intake.convertedTo.profileLocalId)}
                className="text-[11px] font-medium px-2 py-1 rounded-md"
                style={{
                  color: "var(--color-amber)",
                  backgroundColor: "var(--color-amber-light)",
                  textDecoration: "none",
                }}
              >
                {intake.convertedTo.profileName ?? "View 360"}
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-5 mt-2">
        <Field label="Facility" value={intake.jail} />
        <Field label="A-Number" value={intake.alienNumber} />
        <Field label="Language" value={intake.language} />
        <Field label="Point of contact" value={intake.pocName} />
        <Field label="Phone" value={intake.pocPhone} />
      </div>
    </div>
  );
}

export function JailIntakesPage() {
  const [data, setData] = useState<JailIntakeListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchJailIntakes({
      // 0 is the explicit "no date limit" the API understands.
      withinDays: showAll ? 0 : DEFAULT_WITHIN_DAYS,
      search: search.trim() || undefined,
    })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load jail intakes"))
      .finally(() => setLoading(false));
  }, [showAll, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-3 py-1.5 rounded-full"
      style={{
        border: "1px solid var(--color-border-light)",
        background: active ? "var(--color-amber-light)" : "var(--color-surface)",
        color: active ? "var(--color-amber)" : "var(--color-ink-muted)",
        fontFamily: "var(--font-body)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="animate-in">
      <div className="mb-4">
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          Jail Intakes
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
          Detainee enquiries waiting to become consults.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {chip(!showAll, `Recent${data && !showAll ? ` (${data.total})` : ""}`, () => setShowAll(false))}
        {data && data.olderCount > 0 && !showAll && chip(false, `${data.olderCount} older`, () => setShowAll(true))}
        {showAll && chip(true, `All open${data ? ` (${data.total})` : ""}`, () => setShowAll(false))}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name or facility…"
          className="rounded-md px-2 py-1.5 text-sm ml-auto"
          style={{
            border: "1px solid var(--color-border-light)",
            background: "var(--color-surface)",
            color: "var(--color-ink)",
            fontFamily: "var(--font-body)",
            minWidth: 200,
          }}
        />
      </div>

      <div className="card card-elevated overflow-hidden">
        {error ? (
          <p role="alert" className="px-5 py-8 text-center text-sm" style={{ color: "var(--color-status-red)" }}>
            {error}
          </p>
        ) : loading && !data ? (
          <p
            className="px-5 py-8 text-center text-sm"
            style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
          >
            Loading…
          </p>
        ) : data && data.intakes.length > 0 ? (
          data.intakes.map((i) => <IntakeRow key={i.localId} intake={i} />)
        ) : (
          <p
            className="px-5 py-8 text-center text-sm"
            style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
          >
            {search
              ? "No intakes match that search."
              : showAll
                ? "No open intakes."
                : `No intakes in the last ${DEFAULT_WITHIN_DAYS} days.`}
          </p>
        )}
      </div>
    </div>
  );
}
