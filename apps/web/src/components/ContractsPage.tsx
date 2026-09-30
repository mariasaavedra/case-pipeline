import { useState, useEffect } from "react";
import { fetchPendingContracts } from "../api";
import type { PendingContractsResult, PendingContract } from "../api";
import { ClientLink } from "./ClientPeek";
import { SectionCode } from "./ScreenCode";
import { NewContractModal } from "./NewContractModal";
import { Button } from "./ui/button";
import { formatDue, PersonChip, FormChip, CountTable, ListSection, WAIT_TONE, worstWait, waitFg } from "./caseBoardParts";

// =============================================================================
// P14 Contracts
// =============================================================================
// Pending Fee Ks: drafted, sent or waiting on payment. The step before P13
// Prescheduling. Summary table (attorney × Contract Stage) on top, list grouped
// by Contract Stage below. A contract's age counts from the day it was sent, or
// from the day it was added when it hasn't been sent yet — Monday doesn't record
// when a stage changed. See docs/features/prescheduling-and-contracts.md.

const NO_STAGE = "No stage";
const NO_ATTORNEY = "No attorney";
const stageOf = (c: PendingContract) => c.contractStage ?? NO_STAGE;
const attorneysOf = (c: PendingContract) => (c.attorneys.length > 0 ? c.attorneys : [NO_ATTORNEY]);

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

interface Filter {
  attorney: string | null;
  stage: string | null;
}

function ContractRow({ c, filter, onAttorney }: { c: PendingContract; filter: Filter; onAttorney: (name: string) => void }) {
  return (
    <li
      className="grid gap-x-4 gap-y-1.5 px-4 py-3 items-center grid-cols-1 md:grid-cols-[minmax(0,2fr)_11rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]"
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${waitFg(c.ageLevel)}` }}
    >
      {/* Client + contract type */}
      <div className="min-w-0">
        {c.clientLocalId ? (
          <ClientLink clientId={c.clientLocalId} className="font-medium hover:underline truncate block" style={{ color: "var(--color-ink)" }}>
            {c.clientName}
          </ClientLink>
        ) : (
          <span className="font-medium truncate block" style={{ color: "var(--color-ink)" }}>{c.clientName}</span>
        )}
        {(c.contractFor.length > 0 || c.itemName !== c.clientName) && (
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            {c.contractFor.map((f) => <FormChip key={f} label={f} />)}
            {/* The item name tells apart two contracts for one client (and shows Monday "(copy)" duplicates). */}
            {c.itemName !== c.clientName && (
              <span className="text-sm truncate" style={{ color: "var(--color-ink-faint)" }} title={c.itemName}>
                {c.itemName}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Age */}
      <div className="text-sm whitespace-nowrap">
        {c.ageDays !== null ? (
          <>
            <span style={{ color: "var(--color-ink-muted)" }}>
              {c.agedFrom === "sent" ? `Sent ${formatDue(c.sentOn!)}` : `Added ${formatDue(c.addedOn!)}`}
            </span>
            <span className="ml-1.5 font-semibold" style={{ color: waitFg(c.ageLevel) }}>{c.ageDays}d</span>
            {c.agedFrom === "added" && (
              <div className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Not sent yet</div>
            )}
          </>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>No dates</span>
        )}
      </div>

      {/* Payment link */}
      <div className="text-xs min-w-0" style={{ color: c.paymentLinkSentOn ? "var(--color-ink-muted)" : "var(--color-ink-faint)" }}>
        {c.paymentLinkSentOn ? `Payment link ${formatDue(c.paymentLinkSentOn)}` : "No payment link"}
      </div>

      {/* Fees */}
      <div className="text-xs tabular-nums min-w-0" style={{ color: "var(--color-ink-muted)" }}>
        {c.attorneyFee !== null && <div>AF {money(c.attorneyFee)}</div>}
        {c.filingFee !== null && <div>FF {money(c.filingFee)}</div>}
      </div>

      {/* People */}
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {attorneysOf(c).map((a) => (
          <PersonChip key={a} name={a} active={filter.attorney === a} onClick={() => onAttorney(a)} />
        ))}
        {c.assistant && (
          <span className="text-xs truncate" style={{ color: "var(--color-ink-faint)" }} title="Assistant">
            Asst: <span style={{ color: "var(--color-ink-muted)" }}>{c.assistant}</span>
          </span>
        )}
      </div>
    </li>
  );
}

export function ContractsPage() {
  const [data, setData] = useState<PendingContractsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>({ attorney: null, stage: null });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchPendingContracts()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const all = data?.contracts ?? [];
  const visible = all.filter(
    (c) =>
      (filter.attorney === null || attorneysOf(c).includes(filter.attorney)) &&
      (filter.stage === null || stageOf(c) === filter.stage),
  );
  const t = data?.thresholds;
  const pickAttorney = (name: string) => setFilter((f) => ({ ...f, attorney: f.attorney === name ? null : name }));

  return (
    <div>
      {/* P14.1 — header */}
      <SectionCode code="P14.1" />
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          Contracts
        </h1>
        {data && t && (
          <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {all.length} pending ·{" "}
            <span style={{ color: waitFg("late") }}>{all.filter((c) => c.ageLevel === "late").length} older than {t.lateDays} days</span>{" "}
            · {all.filter((c) => c.agedFrom === "added").length} not sent yet
          </span>
        )}
        <Button type="button" className="ml-auto" onClick={() => setCreating(true)}>
          + New contract
        </Button>
      </div>
      {creating && <NewContractModal onClose={() => setCreating(false)} />}
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-faint)" }}>
        Pending Fee Ks by Contract Stage. Colour = days since the contract was sent, or added if not sent yet
        {t && (
          <>
            {" "}(<span style={{ color: waitFg("fresh") }}>under {t.waitingDays}</span> ·{" "}
            <span style={{ color: waitFg("waiting") }}>{t.waitingDays}+</span> ·{" "}
            <span style={{ color: waitFg("late") }}>{t.lateDays}+ days</span>)
          </>
        )}
        .
      </p>

      {!data && !error && <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading contracts…</div>}
      {error && (
        <div className="text-sm rounded p-3" style={{ color: "var(--urgency-overdue)", background: "var(--urgency-overdue-bg)" }}>
          {error}
        </div>
      )}
      {data && all.length === 0 && (
        <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>No pending contracts.</div>
      )}

      {data && all.length > 0 && (
        <>
          <SectionCode code="P14.2" />
          <CountTable
            items={all}
            rowHeader="Attorney"
            rowsOf={attorneysOf}
            lastRow={NO_ATTORNEY}
            columns={data.stages}
            colOf={stageOf}
            cellTone={(cs) => WAIT_TONE[worstWait(cs.map((c) => c.ageLevel))]}
            cellTitle={(cs) => `Oldest: ${Math.max(...cs.map((c) => c.ageDays ?? 0))} days`}
            selected={{ row: filter.attorney, col: filter.stage }}
            onPick={(s) => setFilter({ attorney: s.row, stage: s.col })}
          />

          {/* Filter bar */}
          <div className="flex items-center gap-2 flex-wrap mt-5 mb-3">
            <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
              {visible.length} contract{visible.length !== 1 ? "s" : ""}
            </span>
            {filter.attorney && (
              <button type="button" className="filter-chip filter-chip-active" onClick={() => setFilter({ ...filter, attorney: null })}>
                {filter.attorney} ×
              </button>
            )}
            {filter.stage && (
              <button type="button" className="filter-chip filter-chip-active" onClick={() => setFilter({ ...filter, stage: null })}>
                {filter.stage} ×
              </button>
            )}
          </div>

          <SectionCode code="P14.3" />
          <div className="space-y-4">
            {visible.length === 0 && (
              <div className="card p-8 text-center text-sm" style={{ color: "var(--color-ink-faint)" }}>
                No contracts match these filters.
              </div>
            )}
            {data.stages.map((s) => {
              const inStage = visible.filter((c) => stageOf(c) === s);
              return inStage.length > 0 ? (
                <ListSection key={s} title={s} count={inStage.length} tone={null}>
                  {inStage.map((c) => (
                    <ContractRow key={c.localId} c={c} filter={filter} onAttorney={pickAttorney} />
                  ))}
                </ListSection>
              ) : null;
            })}
          </div>
        </>
      )}
    </div>
  );
}
