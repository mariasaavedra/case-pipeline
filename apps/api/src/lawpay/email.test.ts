import { describe, it, expect } from "vitest";
import { parseLawPayEmail } from "./email";

// The layout of a real receipt (2026-10-16), names invented, card and auth code removed.
const RECEIPT = [
  " ",
  "[LawPay]<https://shared.outlook.inky.com/link?domain=www.lawpay.com&t=h.abc>",
  "Sharma-Crawford Attorneys At Law LLC",
  "515 Avenida Cesar Chavez",
  "Kansas City, Missouri 64108",
  "(816) 994-2300<tel:8169942300>",
  "billing@sharma-crawford.com<mailto:billing@sharma-crawford.com>",
  "Payment receipt",
  "$4,120.00",
  "Account holder",
  "Maria Test",
  "64030",
  "Payment summary",
  "Account:",
  "SCAL Operating",
  "Reference:",
  "ANA LOPEZ I-212 - AF 4120",
  "Amount paid:",
  "$4,120.00",
  "Payment method:",
  "VISA",
  "Card number:",
  "************4321",
  "Entry mode:",
  "Manual",
  "Payment date:",
  "Oct. 16, 2026 16:07",
  "Transaction ID:",
  "175900001",
  "Payment ID:",
  "AbCdEf123",
  "[LawPay]<https://shared.outlook.inky.com/link?x>",
  "www.lawpay.com<https://shared.outlook.inky.com/link?y>",
  "support@lawpay.com<mailto:support@lawpay.com>",
].join("\n");

describe("parseLawPayEmail", () => {
  it("reads a LawPay receipt", () => {
    expect(parseLawPayEmail("Received Web Payment from Maria Test for $4,120.00", RECEIPT)).toEqual({
      transactionId: "175900001",
      reference: "ANA LOPEZ I-212 - AF 4120",
      amount: 4120,
      outcome: "completed",
      method: "visa",
      payer: "Maria Test",
      account: "SCAL Operating",
      paidOn: "Oct. 16, 2026 16:07",
    });
  });

  it("a forwarded copy reads the same", () => {
    const fw = ["From: LawPay <no-reply@lawpay.com>", "Sent: Thursday, October 16, 2026 4:07 PM", "Subject: Received Web Payment", "", RECEIPT].join("\n");
    expect(parseLawPayEmail("FW: Received Web Payment from Maria Test for $4,120.00", fw)?.reference).toBe("ANA LOPEZ I-212 - AF 4120");
  });

  it("staff-written references in the same format count too", () => {
    const text = RECEIPT.replace("ANA LOPEZ I-212 - AF 4120", "NORA TEST FOR ISAAC TEST ADMIN FEE - AF 50").replace(/\$4,120\.00/g, "$50.00");
    expect(parseLawPayEmail("Received Web Payment from Nora Test for $50.00", text)).toMatchObject({ reference: "NORA TEST FOR ISAAC TEST ADMIN FEE - AF 50", amount: 50 });
  });

  it("never keeps the card number", () => {
    expect(JSON.stringify(parseLawPayEmail("Received Web Payment from Maria Test for $4,120.00", RECEIPT))).not.toContain("4321");
  });

  it("not a LawPay receipt, or a reference that isn't ours → null", () => {
    expect(parseLawPayEmail("Lunch on Friday?", "See you at noon")).toBeNull();
    expect(parseLawPayEmail("Received Web Payment from X for $10.00", RECEIPT.replace("ANA LOPEZ I-212 - AF 4120", "Retainer March"))).toBeNull();
  });

  it("a refund is recognized as one", () => {
    const text = RECEIPT.replace("Amount paid:", "Amount refunded:");
    expect(parseLawPayEmail("Refunded Payment for $4,120.00", text)?.outcome).toBe("refunded");
  });
});
