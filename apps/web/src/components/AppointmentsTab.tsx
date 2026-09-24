// =============================================================================
// AppointmentsTab — the client's consults, plus a way to book another
// =============================================================================
// A thin wrapper around AppointmentSection, mirroring ContractsTab. It exists
// because AppointmentSection renders nothing when the list is empty, and that is
// precisely the client for whom you most want a "Book a consult" button.
// =============================================================================

import { useState } from "react";
import { AppointmentSection } from "./AppointmentSection";
import { NewAppointmentModal } from "./NewAppointmentModal";
import type { BoardItemSummary } from "../api";
import { Button } from "./ui/button";

interface Props {
  appointments: BoardItemSummary[];
  profileLocalId: string;
  clientName: string;
}

export function AppointmentsTab({ appointments, profileLocalId, clientName }: Props) {
  const [booking, setBooking] = useState(false);

  return (
    <div className="animate-in">
      <div className="flex items-center justify-end mb-3">
        <Button type="button" onClick={() => setBooking(true)}>
          + Book a consult
        </Button>
      </div>

      {appointments.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            No appointments found for this client.
          </p>
        </div>
      ) : (
        <AppointmentSection appointments={appointments} />
      )}

      {booking && (
        <NewAppointmentModal profileLocalId={profileLocalId} clientName={clientName} onClose={() => setBooking(false)} />
      )}
    </div>
  );
}
