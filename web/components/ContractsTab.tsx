import { ContractsSection } from "./ContractsSection";
import type { ContractSummary } from "../api";

interface Props {
  contracts: { active: ContractSummary[]; closed: ContractSummary[] };
}

export function ContractsTab({ contracts }: Props) {
  const { active, closed } = contracts;

  if (active.length === 0 && closed.length === 0) {
    return (
      <div className="py-16 text-center animate-in">
        <p
          className="text-sm"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
        >
          No contracts found for this client.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <ContractsSection contracts={contracts} />
    </div>
  );
}
