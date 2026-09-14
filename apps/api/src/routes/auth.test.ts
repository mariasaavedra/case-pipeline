// =============================================================================
// /api/auth/me — the name a row gets when Azure sends none
// =============================================================================
// A shared mailbox (importantdocuments@sharma-crawford.com) signed in fine at
// Microsoft and then got HTTP 500 out of this route: its token carries no
// `name` claim, and users.name is NOT NULL. In the browser that 500 was
// indistinguishable from "not signed in", so the sign-in screen came back on
// every attempt.
// =============================================================================

import { describe, test, expect } from "vitest";
import { displayName } from "./auth.js";

describe("displayName", () => {
  test("uses the name claim when Azure sends one", () => {
    expect(displayName("Maria Saavedra", "maria@sharma-crawford.com")).toBe("Maria Saavedra");
  });

  test("falls back to the mailbox name when the claim is missing", () => {
    // The shape that produced the 500.
    expect(displayName(undefined, "importantdocuments@sharma-crawford.com")).toBe(
      "importantdocuments",
    );
  });

  test("treats a blank or whitespace-only claim as missing", () => {
    expect(displayName("", "info@sharma-crawford.com")).toBe("info");
    expect(displayName("   ", "info@sharma-crawford.com")).toBe("info");
  });

  test("trims a name that arrives padded", () => {
    expect(displayName("  Ana Pérez  ", "ana@sharma-crawford.com")).toBe("Ana Pérez");
  });

  test("never returns empty — the column is NOT NULL", () => {
    expect(displayName(undefined, "")).toBe("Unnamed account");
    expect(displayName(undefined, "@sharma-crawford.com")).toBe("@sharma-crawford.com");
  });
});
