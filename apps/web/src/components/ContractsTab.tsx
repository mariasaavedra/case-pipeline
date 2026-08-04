import { useState } from "react";
import { ContractsSection } from "./ContractsSection";
import { NewContractModal } from "./NewContractModal";
import type { ClientContracts } from "../api";

interface Props {
  contracts: ClientContracts;
  profileLocalId: string;
  clientName: string;
}

export function ContractsTab({ contracts, profileLocalId, clientName }: Props) {
  const { active, closed } = contracts;
  const [creating, setCreating] = useState(false);
  const empty = active.length === 0 && closed.length === 0;

  return (
    <div className="animate-in">
      <div className="flex items-center justify-end mb-3">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-md px-3 py-1.5 text-sm font-medium"
          style={{ background: "var(--color-amber)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "var(--font-body)" }}
        >
          + New contract
        </button>
      </div>

      {empty ? (
        <div className="py-12 text-center">
          <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            No contracts found for this client.
          </p>
        </div>
      ) : (
        <ContractsSection contracts={contracts} />
      )}

      {creating && (
        <NewContractModal profileLocalId={profileLocalId} clientName={clientName} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
