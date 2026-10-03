// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { CourtMotion } from "../api";
import { MotionsView } from "./CourtCasesPage";

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function motion(o: Partial<CourtMotion> & { localId: string }): CourtMotion {
  return {
    itemName: `CR - [MTC] - ${o.localId}`,
    types: ["MTC"],
    phase: "waiting",
    group: "Filed/Waiting for IJ",
    status: "Filed",
    clientName: `Client ${o.localId}`,
    clientLocalId: null,
    courtCaseLocalId: "c1",
    courtCaseActive: true,
    judge: "Justin Howard",
    attorney: "Lucy Betteridge",
    paralegals: ["Mayra Ruiz"],
    filedOn: daysAgo(100),
    decidedOn: null,
    daysWaiting: 100,
    age: "late",
    hearingDate: null,
    daysToHearing: null,
    hearingSoon: false,
    relief: null,
    flags: [],
    ...o,
  };
}

const filter = { judge: "", attorney: "", paralegal: "", kind: "", motion: "" };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(motions: CourtMotion[], showingProblem = false): string {
  const el = document.createElement("div");
  const root = createRoot(el);
  act(() => root.render(<MotionsView motions={motions} filter={filter} onPerson={() => {}} showingProblem={showingProblem} />));
  const text = el.textContent ?? "";
  act(() => root.unmount());
  return text;
}

describe("MotionsView", () => {
  it("splits motions into hearing-soon, to send, waiting and recently decided", () => {
    const html = render([
      motion({ localId: "soon", hearingSoon: true, hearingDate: today, daysToHearing: 0 }),
      motion({ localId: "send", phase: "to_send", filedOn: null, daysWaiting: null, age: "unknown" }),
      motion({ localId: "wait" }),
      motion({ localId: "won", phase: "granted", decidedOn: daysAgo(3), daysWaiting: null }),
      motion({ localId: "old", phase: "denied", decidedOn: daysAgo(200), daysWaiting: null }),
    ]);
    expect(html).toContain("Hearing within 14 days, motion still open");
    expect(html).toContain("1 waiting 90+ days");
    expect(html).toContain("1 granted · 0 denied");
    expect(html).toContain("Client won");
    expect(html).not.toContain("Client old");
  });

  it("leaves open motions on closed cases out of the lists (cleanup chip only)", () => {
    const leftover = motion({ localId: "leftover", courtCaseActive: false, flags: ["case_closed"] });
    expect(render([leftover])).not.toContain("Client leftover");
    expect(render([leftover], true)).toContain("Open, but case is closed");
  });

  it("shows a status picker on each motion once the board's labels have synced", () => {
    const el = document.createElement("div");
    const root = createRoot(el);
    act(() =>
      root.render(
        <MotionsView motions={[motion({ localId: "w" })]} filter={filter} onPerson={() => {}} showingProblem={false} statusOptions={["Filed", "Granted", "Denied"]} />,
      ),
    );
    expect(el.querySelector('[aria-label="Status for Client w\'s MTC"]')).not.toBeNull();
    act(() => root.render(<MotionsView motions={[motion({ localId: "w" })]} filter={filter} onPerson={() => {}} showingProblem={false} />));
    expect(el.querySelector('[aria-label^="Status for"]')).toBeNull();
    act(() => root.unmount());
  });
});
