import { describe, it, expect } from "vitest";
import { parsePaymentBotPost } from "./slack";

// Layout of the real #payments posts (2026-10-16), names invented.
const post = (reference: string, amount = "$50.00", type = "Received Payment") => [
  "New Transaction:",
  `Transaction Type: ${type}`,
  "Payer: Maria Test",
  "Date: Oct. 16, 2026 16:07",
  `Amount: ${amount}`,
  "Account: SCAL Operating",
  `Reference: ${reference}`,
].join("\n");

describe("parsePaymentBotPost", () => {
  it("reads a Payment Bot post", () => {
    expect(parsePaymentBotPost(post("ANA LOPEZ I-212 K8F2XQ1 - AF 4120", "$4,120.00"))).toEqual({
      transactionId: "slack|Oct. 16, 2026 16:07|4120.00|ANA LOPEZ I-212 K8F2XQ1 - AF 4120",
      reference: "ANA LOPEZ I-212 K8F2XQ1 - AF 4120",
      amount: 4120,
      outcome: "completed",
      method: null,
      payer: "Maria Test",
      account: "SCAL Operating",
      paidOn: "Oct. 16, 2026 16:07",
    });
  });

  it("staff-written references in our format count; others are skipped", () => {
    expect(parsePaymentBotPost(post("NORA TEST FOR ISAAC TEST ADMIN FEE - AF 50"))?.amount).toBe(50);
    // Real examples the app can't tie to a fee type: not ours.
    expect(parsePaymentBotPost(post("EOIR Fees for I-485 - $3030 FF - Ana TEST", "$3,030.00"))).toBeNull();
    expect(parsePaymentBotPost(post("Missouri Highway Patrol clearance for Ana TEST ($20 + .60 surcharge fee)", "$20.60"))).toBeNull();
  });

  it("Slack escaping and bold labels are read through", () => {
    const t = post("ANA &amp; JOSE LOPEZ - FF 675").replace("Reference:", "*Reference:*");
    expect(parsePaymentBotPost(t)?.reference).toBe("ANA & JOSE LOPEZ - FF 675");
  });

  it("PayPal consult posts and anything else → null; refunds recognized", () => {
    expect(parsePaymentBotPost("Hi. Paypal Link Payment received\nTotal: $195.00 USD\nDescription: Attorney Appointment")).toBeNull();
    expect(parsePaymentBotPost("<@U1> joined the channel")).toBeNull();
    expect(parsePaymentBotPost(post("ANA LOPEZ - AF 50", "$50.00", "Refund"))?.outcome).toBe("refunded");
  });
});
