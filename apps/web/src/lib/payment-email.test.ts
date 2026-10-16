import { describe, it, expect } from "vitest";
import { chargeFor, payMethodOf, paymentEmail, paymentLines } from "./payment-email";

describe("payMethodOf", () => {
  it("reads Monday's Payment Method labels; split / empty = staff choose", () => {
    expect(payMethodOf("CREDIT Card - Surcharge Applies")).toBe("credit");
    expect(payMethodOf("DEBIT Card")).toBe("debit");
    expect(payMethodOf("Cash")).toBe("cash");
    expect(payMethodOf("SPLIT PAYMENTS")).toBeNull();
    expect(payMethodOf(null)).toBeNull();
  });
});

describe("paymentLines", () => {
  const fees = { AF: 4000, FF: 1175, PF: null };
  it("credit: each link carries its own 3%", () => {
    expect(chargeFor(1175, "credit")).toBe(1210.25);
    const lines = paymentLines("Ana LOPEZ I-212", fees, "credit");
    expect(lines.map((l) => [l.fee, l.amount])).toEqual([["AF", 4120], ["FF", 1210.25]]);
    expect(lines[1]!.link).toBe("https://secure.lawpay.com/pages/scal/trust?amount=1210.25&readOnlyFields=reference,amount&reference=ANA%20LOPEZ%20I-212%20-%20FF%201210.25");
  });
  it("debit: the fees as they are; cash: no links", () => {
    expect(paymentLines("Ana", fees, "debit").map((l) => l.amount)).toEqual([4000, 1175]);
    expect(paymentLines("Ana", fees, "cash")).toEqual([]);
  });
  it("skips empty and zero fees", () => {
    expect(paymentLines("Ana", { AF: 900, FF: 0, PF: 25 }, "debit").map((l) => l.fee)).toEqual(["AF", "PF"]);
  });
});

describe("paymentEmail", () => {
  const lines = paymentLines("Ana LOPEZ I-212", { AF: 4000, FF: 1175 }, "credit");
  const mail = paymentEmail({ clientName: "Ana LOPEZ", matter: "I-212", lines, method: "credit", senderName: "Mayra Ruiz" });
  it("is one bilingual message with every link and the surcharge called out", () => {
    expect(mail.subject).toBe("Payment links / Enlaces de pago — Ana LOPEZ — I-212");
    for (const l of lines) expect(mail.html.split(l.link.replace(/&/g, "&amp;")).length - 1).toBe(2); // EN + ES
    expect(mail.text).toContain("Attorney's fee: $4,120.00 (includes the 3% credit card surcharge)");
    expect(mail.text).toContain("Honorarios de abogado: $4,120.00 (incluye el recargo del 3% por tarjeta de crédito)");
    expect(mail.text).toContain("Mayra Ruiz");
  });
  it("debit has no surcharge wording; names are escaped in the HTML", () => {
    const m = paymentEmail({ clientName: "Ana <b>", matter: "", lines: paymentLines("Ana", { AF: 900 }, "debit"), method: "debit", senderName: "X" });
    expect(m.text).not.toContain("surcharge");
    expect(m.html).toContain("Ana &lt;b&gt;");
    expect(m.subject).toBe("Payment links / Enlaces de pago — Ana <b>");
  });
});
