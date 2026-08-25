import { useState } from "react";
import { ContractsSection } from "./ContractsSection";
import { NewContractModal } from "./NewContractModal";
import type { ClientContracts } from "../api";
import { Button } from "./ui/button";

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
        <Button type="button" onClick={() => setCreating(true)}>
          + New contract
        </Button>
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
