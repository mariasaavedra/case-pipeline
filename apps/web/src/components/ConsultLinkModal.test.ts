import { describe, expect, it } from "vitest";
import { clientNameFromConsult } from "./ConsultLinkModal";

describe("clientNameFromConsult", () => {
  it("takes the client out of a staff-made appointment name", () => {
    expect(
      clientNameFromConsult("[10/7/26] - INITIAL TP MEETING : Jorge H. ROMERO TORO [A221-454-845] - TO BE SCHEDULED BY FA"),
    ).toBe("Jorge H. ROMERO TORO");
  });

  it("drops [Det …] / [A#] tags from a Calendly name", () => {
    expect(clientNameFromConsult("Josue Alexander CRUZ MARTINEZ  [Det Core Civic] [220-869-696]")).toBe(
      "Josue Alexander CRUZ MARTINEZ",
    );
  });

  it("keeps hyphenated surnames", () => {
    expect(clientNameFromConsult("8/21/26 - [TP3] - M - Lesbia M. PEREZ-LARIOS")).toBe("Lesbia M. PEREZ-LARIOS");
    expect(clientNameFromConsult("Lesbia M. PEREZ-LARIOS")).toBe("Lesbia M. PEREZ-LARIOS");
  });
});
