import { useState, useEffect } from "react";
import { fetchFoias } from "../api";
import type { FoiasResult, Foia, FoiaPhase, FoiaFlag } from "../api";
import { ClientLink } from "./ClientPeek";
import { SectionCode } from "./ScreenCode";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { formatDue, Tag, FormChip, ListSection, WAIT_TONE, waitFg } from "./caseBoardParts";

// =============================================================================
// P19 FOIAs
// =============================================================================
// Open FOIA requests as a queue: "Do we need it?" → our turn (prepare and
// file) → waiting on the agency, plus parked at the North Pole. Done FOIAs
// (results received, or not proceeding) are counted, not listed. Colour = days
// on the board while it's our turn, days since Filed On while the agency has
// it. Each row shows the agencies quoted, and which of them are still to file.
// Read-only for now: statuses change on Monday. See docs/features/foias.md.

const PHASES: { id: FoiaPhase; title: string; note: string }[] = [
  { id: "decide", title: "Do we need it?", note: "Attorney to decide" },
  { id: "ours", title: "Our turn", note: "Prepare and file" },
  { id: "agency", title: "Waiting on the agency", note: "Filed, no results yet" },
  { id: "parked", title: "North Pole", note: "Parked" },
];

const FLAG_LABEL: Record<FoiaFlag, string> = {
  inquiry_due: "Inquiry due",
  stale: "No results 6+ months",
  no_filed_date: "No Filed On date",
  no_paralegal: "No paralegal",
  no_profile: "Profile not connected",
};
const CLEANUP_FLAGS: FoiaFlag[] = ["stale", "no_filed_date", "no_paralegal", "no_profile"];

const ALL = "";
const NO_PARALEGAL = "No paralegal";
const paralegalsOf = (f: Foia) => (f.paralegals.length > 0 ? f.paralegals : [NO_PARALEGAL]);

function FoiaRow({ f, paralegalFilter, onParalegal }: { f: Foia; paralegalFilter: string; onParalegal: (name: string) => void }) {
  const inquiryDue = f.flags.includes("inquiry_due");
  const edge = inquiryDue ? "var(--urgency-critical)" : waitFg(f.ageLevel);
  return (
    <li
      className="grid gap-x-4 gap-y-1.5 px-4 py-3 items-center grid-cols-1 md:grid-cols-[minmax(0,1.8fr)_minmax(0,1.4fr)_9rem_minmax(0,1fr)_minmax(0,0.9fr)]"
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${edge}` }}
    >
      {/* Client + flags */}
      <div className="min-w-0">
        {f.clientLocalId ? (
          <ClientLink clientId={f.clientLocalId} className="font-medium hover:underline truncate block" style={{ color: "var(--color-ink)" }}>
            {f.clientName}
          </ClientLink>
        ) : (
          <span className="font-medium truncate block" style={{ color: "var(--color-ink)" }}>{f.clientName}</span>
        )}
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-xs" style={{ color: "var(--color-ink-faint)" }}>
          {f.requestNumbers.map((n) => (
            <span key={n} title="Request number">#{n}</span>
          ))}
          {f.flags.map((fl) => (
            <Tag key={fl} color={fl === "inquiry_due" ? "critical" : "overdue"}>{FLAG_LABEL[fl]}</Tag>
          ))}
        </div>
      </div>

      {/* Agencies: filed (plain) vs still to file (highlighted) */}
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {f.filed.map((a) => (
          <span key={a} title={`${a} filed`}>
            <FormChip label={`${a} ✓`} />
          </span>
        ))}
        {f.toFile.map((a) => (
          <Tag key={a} color="missing" title={`${a} quoted, not filed yet`}>{a} to file</Tag>
        ))}
        {f.quoted.length === 0 && f.filed.length === 0 && (
          <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>No agencies set</span>
        )}
      </div>

      {/* Date + age */}
      <div className="text-sm whitespace-nowrap">
        {f.ageDays !== null ? (
          <>
            <span style={{ color: "var(--color-ink-muted)" }}>
              {f.phase === "agency" && f.filedOn ? `Filed ${formatDue(f.filedOn)}` : `Since ${formatDue(f.onFoiasSince!)}`}
            </span>
            <span className="ml-1.5 font-semibold" style={{ color: waitFg(f.ageLevel) }}>{f.ageDays}d</span>
          </>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>No date</span>
        )}
        {f.inquiryEligible && f.phase === "agency" && (
          <div className="text-xs" style={{ color: inquiryDue ? "var(--urgency-critical)" : "var(--color-ink-faint)", fontWeight: inquiryDue ? 600 : 400 }}>
            Inquiry {formatDue(f.inquiryEligible)}
          </div>
        )}
      </div>

      {/* People */}
      <div className="text-xs min-w-0">
        {paralegalsOf(f).map((p) =>
          p === NO_PARALEGAL ? (
            <span key={p} className="block" style={{ color: "var(--color-ink-faint)" }}>{p}</span>
          ) : (
            <button
              key={p}
              type="button"
              className="hover:underline truncate block max-w-full text-left"
              title="Show only this paralegal's"
              style={{ color: paralegalFilter === p ? "var(--color-amber-dark)" : "var(--color-ink-muted)" }}
              onClick={() => onParalegal(p)}
            >
              {p}
            </button>
          ),
        )}
        {f.attorney && <span className="block truncate" style={{ color: "var(--color-ink-faint)" }} title="Attorney">{f.attorney}</span>}
      </div>

      {/* Status + where to file */}
      <div className="text-xs min-w-0">
        <div style={{ color: "var(--color-ink-muted)" }}>{f.status ?? "No status"}</div>
        {f.whereToFile && (
          <a href={f.whereToFile} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--color-amber-dark)" }}>
            Where to file ↗
          </a>
        )}
      </div>
    </li>
  );
}

// =============================================================================
// Page
// =============================================================================

export function FoiasPage() {
  const [data, setData] = useState<FoiasResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paralegal, setParalegal] = useState(ALL);
  const [problem, setProblem] = useState<FoiaFlag | null>(null);
  const [showStale, setShowStale] = useState(false);

  useEffect(() => {
    fetchFoias()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const all = data?.items ?? [];
  const byParalegal = all.filter((f) => !paralegal || paralegalsOf(f).includes(paralegal));
  // No results after 6+ months is almost always an item nobody closed on
  // Monday: hidden unless asked for (or picked from the cleanup strip).
  const visible = problem
    ? byParalegal.filter((f) => f.flags.includes(problem))
    : byParalegal.filter((f) => showStale || !f.flags.includes("stale"));
  const paralegals = [...new Set(all.flatMap(paralegalsOf))].sort((x, y) =>
    x === NO_PARALEGAL ? 1 : y === NO_PARALEGAL ? -1 : x.localeCompare(y),
  );
  const ours = all.filter((f) => f.phase === "ours" || f.phase === "decide");
  const inquiryDue = all.filter((f) => f.flags.includes("inquiry_due")).length;
  const stale = byParalegal.filter((f) => f.flags.includes("stale")).length;
  const t = data?.thresholds;

  const paralegalItems = [{ value: ALL, label: "All paralegals" }, ...paralegals.map((p) => ({ value: p, label: p }))];

  return (
    <div>
      {/* P19.1 — header */}
      <SectionCode code="P19.1" />
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          FOIAs
        </h1>
        {data && (
          <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {all.length} open · <span style={{ color: ours.length ? waitFg("late") : undefined }}>{ours.length} our turn</span>
            {inquiryDue > 0 && (
              <>
                {" "}· <span style={{ color: "var(--urgency-critical)" }}>{inquiryDue} inquiry due</span>
              </>
            )}{" "}
            · {data.doneCount} done ({data.doneLast30} results in the last 30 days)
          </span>
        )}
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-faint)" }}>
        Open FOIA requests by phase. Colour = days on the board while it's our turn
        {t && (
          <>
            {" "}(<span style={{ color: waitFg("waiting") }}>{t.ours.waitingDays}+</span> ·{" "}
            <span style={{ color: waitFg("late") }}>{t.ours.lateDays}+ days</span>), days since Filed On while the agency has it (
            {t.agency.waitingDays}+ · {t.agency.lateDays}+)
          </>
        )}
        . Agencies marked "to file" are quoted but not filed yet.
      </p>

      {!data && !error && <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading FOIAs…</div>}
      {error && (
        <div className="text-sm rounded p-3" style={{ color: "var(--urgency-overdue)", background: "var(--urgency-overdue-bg)" }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* P19.2 — filters + cleanup */}
          <SectionCode code="P19.2" />
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Select items={paralegalItems} value={paralegal} onValueChange={(v) => setParalegal(v ?? ALL)}>
              <SelectTrigger size="sm" className={`min-w-25 bg-secondary text-[13px] ${paralegal ? "border-primary bg-primary/6" : ""}`} aria-label="Paralegal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent code="D34">
                {paralegalItems.map((i) => (
                  <SelectItem key={i.value || "all"} value={i.value}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {stale > 0 && !problem && (
              <button type="button" className={`filter-chip ${showStale ? "filter-chip-active" : ""}`} onClick={() => setShowStale(!showStale)}>
                {showStale ? "Hide" : "Show"} {stale} with no results 6+ months
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-5" role="group" aria-label="Data problems">
            <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Needs cleanup on Monday:</span>
            {CLEANUP_FLAGS.map((fl) => {
              const n = byParalegal.filter((f) => f.flags.includes(fl)).length;
              return (
                <button
                  key={fl}
                  type="button"
                  disabled={n === 0}
                  className={`filter-chip ${problem === fl ? "filter-chip-active" : ""}`}
                  style={n > 0 && problem !== fl ? { color: "var(--urgency-overdue)" } : undefined}
                  onClick={() => setProblem(problem === fl ? null : fl)}
                >
                  {FLAG_LABEL[fl]} · {n}
                </button>
              );
            })}
          </div>

          {/* P19.3 — list by phase */}
          <SectionCode code="P19.3" />
          <div className="space-y-4">
            {visible.length === 0 && (
              <div className="card p-8 text-center text-sm" style={{ color: "var(--color-ink-faint)" }}>
                No FOIAs match these filters.
              </div>
            )}
            {PHASES.map((p) => {
              const inPhase = visible.filter((f) => f.phase === p.id);
              if (inPhase.length === 0) return null;
              const late = inPhase.filter((f) => f.ageLevel === "late").length;
              return (
                <ListSection
                  key={p.id}
                  title={p.title}
                  count={inPhase.length}
                  tone={p.id === "ours" && late ? WAIT_TONE.late : null}
                  note={[p.note, late ? `${late} overdue` : ""].filter(Boolean).join(" · ")}
                >
                  {inPhase.map((f) => (
                    <FoiaRow key={f.localId} f={f} paralegalFilter={paralegal} onParalegal={(name) => setParalegal(paralegal === name ? ALL : name)} />
                  ))}
                </ListSection>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
