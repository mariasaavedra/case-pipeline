// =============================================================================
// Shared jail-intake field tests
// =============================================================================
// These fields feed two screens — the New intake popup and the "this call is a
// jail intake" section in Log a call. They were written separately once, and the
// inline copy silently fell four fields behind. The mapping is pinned here so
// that a field added to the set reaches the request from both hosts.
// =============================================================================

import { describe, test, expect } from "vitest";
import {
  emptyJailIntakeFields,
  hasIntakeName,
  toCreateJailIntakeInput,
  INTAKE_LANGUAGES,
  PRIOR_REMOVAL_OPTIONS,
  type JailIntakeFieldValues,
} from "./jail-intake-fields";

const filled: JailIntakeFieldValues = {
  status: "Payment link sent. Waiting on payment",
  firstName: "Juan",
  lastName: "PEREZ",
  jail: "Kay County",
  alienNumber: "088-467-122",
  language: "Espanol",
  pocName: "Maria, sister",
  pocPhone: "316-869-3861",
  pocEmail: "maria@example.com",
  countryOfBirth: "Mexico",
  dateOfBirth: "03/07/1980",
  priorRemoval: "Yes",
  pickedUpByIce: "2026-02-21",
  description: "Picked up at a traffic stop.",
};

describe("hasIntakeName", () => {
  test("a first name alone is enough", () => {
    expect(hasIntakeName({ ...emptyJailIntakeFields, firstName: "Juan" })).toBe(true);
  });

  test("a last name alone is enough", () => {
    expect(hasIntakeName({ ...emptyJailIntakeFields, lastName: "PEREZ" })).toBe(true);
  });

  test("whitespace is not a name", () => {
    expect(hasIntakeName({ ...emptyJailIntakeFields, firstName: "  ", lastName: " " })).toBe(false);
  });

  test("nothing typed is not a name", () => {
    expect(hasIntakeName(emptyJailIntakeFields)).toBe(false);
  });
});

describe("toCreateJailIntakeInput", () => {
  test("carries every captured field through", () => {
    // The regression this guards: four of these were reaching the request from
    // the popup and not from Log a call.
    expect(toCreateJailIntakeInput(filled)).toEqual({
      firstName: "Juan",
      lastName: "PEREZ",
      jail: "Kay County",
      alienNumber: "088-467-122",
      language: "Espanol",
      pocName: "Maria, sister",
      pocPhone: "316-869-3861",
      pocEmail: "maria@example.com",
      status: "Payment link sent. Waiting on payment",
      countryOfBirth: "Mexico",
      dateOfBirth: "03/07/1980",
      priorRemoval: "Yes",
      pickedUpByIce: "2026-02-21",
      description: "Picked up at a traffic stop.",
      callLogItemId: undefined,
    });
  });

  test("drops blanks rather than sending empty strings", () => {
    const out = toCreateJailIntakeInput({ ...emptyJailIntakeFields, firstName: "Juan" });
    expect(out.firstName).toBe("Juan");
    for (const k of ["lastName", "jail", "alienNumber", "countryOfBirth", "dateOfBirth", "description"] as const) {
      expect(out[k]).toBeUndefined();
    }
    expect(out.priorRemoval).toBeUndefined();
    expect(out.pickedUpByIce).toBeUndefined();
    expect(out.pocEmail).toBeUndefined();
  });

  test("a new intake starts as New Detainee unless changed", () => {
    expect(emptyJailIntakeFields.status).toBe("New Detainee");
    expect(toCreateJailIntakeInput({ ...emptyJailIntakeFields, firstName: "Juan" }).status).toBe("New Detainee");
  });

  test("trims what it keeps", () => {
    const out = toCreateJailIntakeInput({ ...emptyJailIntakeFields, firstName: "  Juan ", jail: " Kay County  " });
    expect(out.firstName).toBe("Juan");
    expect(out.jail).toBe("Kay County");
  });

  test("the host can supply the point of contact and language it already knows", () => {
    // Log a call hides those three inputs, because the caller IS the contact.
    const out = toCreateJailIntakeInput(
      { ...emptyJailIntakeFields, firstName: "Juan" },
      { pocName: "Maria", pocPhone: "316-555-0100", language: "Espanol", callLogItemId: "123" },
    );
    expect(out).toMatchObject({
      pocName: "Maria",
      pocPhone: "316-555-0100",
      language: "Espanol",
      callLogItemId: "123",
    });
  });

  test("a typed contact beats the host's fallback", () => {
    const out = toCreateJailIntakeInput(
      { ...filled, firstName: "Juan" },
      { pocName: "Whoever rang", pocPhone: "000", language: "English" },
    );
    expect(out.pocName).toBe("Maria, sister");
    expect(out.pocPhone).toBe("316-869-3861");
    expect(out.language).toBe("Espanol");
  });

  test("no call id when the intake did not come from a call", () => {
    expect(toCreateJailIntakeInput(filled).callLogItemId).toBeUndefined();
  });
});

describe("board option lists", () => {
  test("prior removal offers exactly what the board offers", () => {
    expect(PRIOR_REMOVAL_OPTIONS).toEqual(["No", "Yes", "Unknown"]);
  });

  test('languages keep the board\'s own spelling, "Espanol" included', () => {
    expect(INTAKE_LANGUAGES).toContain("Espanol");
    expect(INTAKE_LANGUAGES).toContain("Quiche");
  });
});
