import { describe, expect, test } from "vitest";
import { checkLedgerTab, followingCaseNo, maxCaseNo } from "./ledger";

describe("checkLedgerTab", () => {
  test("highest number in the year, any typing", () => {
    const values = [
      ["Case No. ", "Name ", "Date Opened ", "Date Closed", "Case Type", "Information"],
      ["26-001", "Karina SOLANO-HUERTA", 46027, "", "TORO LOCO", "…"],
      ["26229 ", "Ingrid ALVARENGA", "10/21/2026", "", "I-212", ""],
      [" 26 - 230", "Jaime RIOS RODRIGUEZ", "10/22/2026", "", "Habeas Corpus", ""],
      ["25-400", "Last year's returning client", "", "", "", ""],
      ["", "", "", "", "", ""],
    ];
    const r = checkLedgerTab(values, "26");
    expect(r.highest).toBe("26-230");
    expect(r.highestRow).toEqual(["26 - 230", "Jaime RIOS RODRIGUEZ", "10/22/2026", "", "Habeas Corpus"]);
    expect(r.duplicates).toEqual([]);
  });

  test("a number used twice is reported", () => {
    const r = checkLedgerTab([["26-194", "Manuel GOMEZ"], ["26-194", "Oliver CANDIDO"]], "26");
    expect(r.duplicates).toEqual(["26-194"]);
  });

  test("an empty tab has no highest", () => {
    expect(checkLedgerTab([["Case No."]], "27").highest).toBeNull();
  });
});

test("maxCaseNo + followingCaseNo", () => {
  expect(maxCaseNo("26-230", "26-229")).toBe("26-230");
  expect(maxCaseNo(null, "26-001")).toBe("26-001");
  expect(followingCaseNo("26-230")).toBe("26-231");
  expect(followingCaseNo("26-099")).toBe("26-100");
});
