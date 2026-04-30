import { useState } from "react";
import type { ContractSummary } from "../api";
import { StatusBadge } from "./StatusBadge";

interface Props {
  contracts: { active: ContractSummary[]; closed: ContractSummary[] };
}

function formatCurrency(cents: number): string {
  return `$${cents.toLocaleString()}`;
}

function ContractCard({ contract, muted }: { contract: ContractSummary; muted?: boolean }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors"
      style={{
        backgroundColor: muted ? "var(--color-surface-warm)" : "var(--color-surface)",
        border: muted ? "1px solid var(--color-border-light)" : "1px solid var(--color-border)",
      }}
    >
      <StatusBadge status={contract.status} />
      <span
        className="font-medium flex-1 text-sm"
        style={{
          color: muted ? "var(--color-ink-faint)" : "var(--color-ink)",
          fontFamily: "var(--font-body)",
        }}
      >
        {contract.caseType}
      </span>
      <span
        className="text-xs"
        style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}
      >
        {contract.contractId}
      </span>
      <span
        className="font-semibold text-sm tabular-nums"
        style={{
          color: muted ? "var(--color-ink-faint)" : "var(--color-amber-dark)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {formatCurrency(contract.value)}
      </span>
    </div>
  );
}

export function ContractsSection({ contracts }: Props) {
  const [showClosed, setShowClosed] = useState(false);
  const { active, closed } = contracts;

  if (active.length === 0 && closed.length === 0) return null;

  return (
    <div className="card card-elevated p-5 animate-in animate-in-delay-1">
      <div className="flex items-center gap-3 mb-4">
        <h3
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
        >
          Contracts
        </h3>
        {active.length > 0 && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: "var(--color-amber-light)",
              color: "var(--color-amber)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {active.length} active
          </span>
        )}
      </div>

      {active.length > 0 && (
        <div className="space-y-2 mb-3">
          {active.map((c) => (
            <ContractCard key={c.localId} contract={c} />
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <>
          <button
            onClick={() => setShowClosed(!showClosed)}
            className="flex items-center gap-2 text-sm py-1 transition-colors"
            style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="currentColor"
              className={`toggle-chevron ${showClosed ? "toggle-chevron-open" : ""}`}
            >
              <path d="M4.5 2l4 4-4 4" />
            </svg>
            {closed.length} closed contract{closed.length !== 1 ? "s" : ""}
          </button>
          {showClosed && (
            <div className="space-y-2 mt-2">
              {closed.map((c) => (
                <ContractCard key={c.localId} contract={c} muted />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
