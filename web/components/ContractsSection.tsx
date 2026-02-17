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
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${muted ? "bg-gray-50 border-gray-200" : "bg-white border-gray-200"}`}>
      <StatusBadge status={contract.status} />
      <span className={`font-medium flex-1 ${muted ? "text-gray-500" : "text-gray-900"}`}>
        {contract.caseType}
      </span>
      <span className="text-sm text-gray-500">{contract.contractId}</span>
      <span className={`font-semibold ${muted ? "text-gray-400" : "text-gray-700"}`}>
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
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Contracts
        {active.length > 0 && <span className="ml-2 text-blue-600">{active.length} active</span>}
      </h3>

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
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <span className="text-xs">{showClosed ? "\u25BC" : "\u25B6"}</span>
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
