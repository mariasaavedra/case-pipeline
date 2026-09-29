import { describe, it, expect } from "vitest";
import { describeAudit, AUDIT_FAMILIES } from "./audit-labels";

describe("describeAudit", () => {
  it("reads a status change as before → after", () => {
    expect(describeAudit("monday.status_changed", { from: "Pending", to: "Received" })).toEqual({
      title: "Changed status to “Received”",
      detail: "Was “Pending”",
      queued: false,
    });
  });

  it("flags writes that waited in the queue", () => {
    expect(describeAudit("monday.update_posted", { queued: true }).queued).toBe(true);
  });

  it("names the user and role on a role change", () => {
    expect(describeAudit("user.role_changed", { role: "admin", email: "a@firm.com" }).title).toBe(
      "Made a@firm.com an admin",
    );
  });

  it("falls back to a tidied action name for unknown actions and bad metadata", () => {
    expect(describeAudit("thing.new_kind", null)).toEqual({ title: "Thing new kind", detail: null, queued: false });
  });

  it("every filter option is unique", () => {
    const values = AUDIT_FAMILIES.flatMap((g) => g.options.map((o) => o.value));
    expect(new Set(values).size).toBe(values.length);
  });
});
