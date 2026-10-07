import { describe, it, expect, vi, afterEach } from "vitest";

const spawned: Array<{ cmd: string; args: string[]; env: Record<string, string | undefined> }> = [];
vi.mock("node:child_process", () => ({
  spawn: (cmd: string, args: string[], opts: { env: Record<string, string | undefined> }) => {
    spawned.push({ cmd, args, env: opts.env });
    return { on: () => {} };
  },
}));

const { startConsultSummary } = await import("./consult-summary.js");
const req = { appointmentLocalId: "a1", note: "Hired; I-130 next.", author: "Rekha", date: "2026-10-07" };

describe("startConsultSummary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    spawned.length = 0;
  });

  it("does nothing unless consult folders are switched on", () => {
    vi.stubEnv("CONSULT_FOLDERS", "");
    expect(startConsultSummary(req)).toBe("disabled");
    expect(spawned).toEqual([]);
  });

  it("runs the sweep for that one appointment, with the note in the environment", () => {
    vi.stubEnv("CONSULT_FOLDERS", "on");
    vi.stubEnv("DB_SOURCE", "live");
    expect(startConsultSummary(req)).toBe("started");
    expect(spawned[0]!.args).toEqual(["run", "consult:sweep", "--", "--appointment=a1", "--apply"]);
    expect(spawned[0]!.env).toMatchObject({ CONSULT_NOTE_TEXT: "Hired; I-130 next.", CONSULT_NOTE_AUTHOR: "Rekha", CONSULT_NOTE_DATE: "2026-10-07" });
    // A second save while the first is still running does not start another.
    expect(startConsultSummary(req)).toBe("already-running");
  });

  it("refuses an id that is not a plain local id", () => {
    vi.stubEnv("CONSULT_FOLDERS", "on");
    expect(() => startConsultSummary({ ...req, appointmentLocalId: "a1; rm -rf /" })).toThrow();
    expect(spawned).toEqual([]);
  });
});
