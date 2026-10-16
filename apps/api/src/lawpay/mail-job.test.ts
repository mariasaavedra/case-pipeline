import { describe, it, expect, vi } from "vitest";

vi.mock("../routes/lawpay.js", () => ({ ingestLawPayReceipts: async () => [] }));
const { parseScriptOutput } = await import("./mail-job");

describe("parseScriptOutput", () => {
  it("reads the script's last line", () => {
    expect(parseScriptOutput("npm noise\n" + JSON.stringify({ ok: true, looked: 3, receipts: [{ messageId: "m1" }] })))
      .toEqual({ ok: true, looked: 3, receipts: [{ messageId: "m1" }] });
  });
  it("a failure or no result is an error, never an empty success", () => {
    expect(parseScriptOutput(JSON.stringify({ ok: false, error: "Not signed in" }))).toEqual({ ok: false, error: "Not signed in" });
    expect(parseScriptOutput("")).toMatchObject({ ok: false });
    expect(parseScriptOutput("Error: boom")).toMatchObject({ ok: false });
  });
});
