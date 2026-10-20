// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DateInput, isoToUs, maskUsDate, usToIso } from "./date-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("US date helpers", () => {
  it("converts both ways", () => {
    expect(isoToUs("2026-10-20")).toBe("10/20/2026");
    expect(isoToUs("")).toBe("");
    expect(usToIso("10/20/2026")).toBe("2026-10-20");
    expect(usToIso("1/5/26")).toBe("2026-01-05");
    expect(usToIso("")).toBe("");
  });
  it("rejects what isn't a real date", () => {
    expect(usToIso("02/30/2026")).toBeNull();
    expect(usToIso("13/01/2026")).toBeNull();
    expect(usToIso("20/10/2026")).toBeNull(); // day-first is not accepted
    expect(usToIso("10/20")).toBeNull();
  });
  it("adds the slashes while typing", () => {
    expect(maskUsDate("10")).toBe("10");
    expect(maskUsDate("1020")).toBe("10/20");
    expect(maskUsDate("10202026")).toBe("10/20/2026");
    expect(maskUsDate("1/5/26")).toBe("1/5/26");
  });
});

describe("DateInput", () => {
  const typeInto = (el: HTMLInputElement, v: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("shows MM/DD/YYYY and hands back ISO, only for a real date in range", async () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { createRoot(host).render(<DateInput value="2026-10-20" max="2026-12-31" onChange={onChange} />); });
    const input = host.querySelector("input[type='text']") as HTMLInputElement;
    expect(input.value).toBe("10/20/2026");

    await act(async () => { typeInto(input, "11052026"); });
    expect(input.value).toBe("11/05/2026");
    expect(onChange).toHaveBeenLastCalledWith({ target: { value: "2026-11-05" } });

    onChange.mockClear();
    await act(async () => { typeInto(input, "01/05/2027"); }); // after max
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});
