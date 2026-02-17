import type { ClientCaseSummary } from "../api";
import { BOARD_CONFIG, SECTIONS, SECTION_LABELS } from "../config";
import { ProfileCard } from "./ProfileCard";
import { ContractsSection } from "./ContractsSection";
import { BoardSection } from "./BoardSection";
import { AppointmentSection } from "./AppointmentSection";

interface Props {
  data: ClientCaseSummary;
}

export function ClientView({ data }: Props) {
  return (
    <div>
      <ProfileCard profile={data.profile} />
      <ContractsSection contracts={data.contracts} />

      {SECTIONS.map((section) => {
        const boards = BOARD_CONFIG.filter((b) => b.section === section);
        const hasItems = boards.some((b) => (data.boardItems[b.key]?.length ?? 0) > 0);
        if (!hasItems) return null;

        return (
          <div key={section} className="mb-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
              {SECTION_LABELS[section]}
            </h3>
            {boards.map((board) => {
              const items = data.boardItems[board.key];
              if (!items || items.length === 0) return null;
              return <BoardSection key={board.key} label={board.label} items={items} />;
            })}
          </div>
        );
      })}

      <AppointmentSection appointments={data.appointments} />
    </div>
  );
}
