// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

let role = "user";
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user: { role } }) }));

const { ManualPage } = await import("./ManualPage");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = vi.fn();
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

async function render(slug: string) {
  const el = document.createElement("div");
  document.body.replaceChildren(el);
  const root = createRoot(el);
  await act(async () => root.render(<ManualPage slug={slug} />));
  return el;
}

describe("P22 Manual", () => {
  beforeEach(() => {
    role = "user";
    try { localStorage.clear(); } catch {}
  });

  it("home lists chapters by section, without admin-only ones for staff", async () => {
    const el = await render("");
    expect(el.textContent).toContain("Staff manual");
    expect(el.textContent).toContain("Reception");
    expect(el.textContent).not.toContain("Workload");
  });

  it("admins see admin chapters and an edit link", async () => {
    role = "admin";
    const el = await render("contracts");
    expect(el.textContent).toContain("Workload");
    expect(el.querySelector('a[href$="20-contracts.md"]')).not.toBeNull();
  });

  it("renders a chapter with heading ids and an On this page list", async () => {
    const el = await render("contracts");
    expect(el.querySelector("h1")?.textContent).toContain("Contracts (Fee Ks)");
    expect(el.querySelector("h2#payment-links")).not.toBeNull();
    expect(el.querySelector("nav[aria-label='On this page']")?.textContent).toContain("Payment links");
    expect(el.querySelector(".manual-prose table")).not.toBeNull();
  });

  it("search shows matching sections", async () => {
    const el = await render("");
    const input = el.querySelector<HTMLInputElement>("input[type=search]")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "payment link");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(el.textContent).toContain("Search: “payment link”");
    expect(el.querySelector(".manual-hit")?.textContent).toContain("Contracts (Fee Ks)");
  });

  it("an unknown chapter says so", async () => {
    const el = await render("nope");
    expect(el.textContent).toContain("There's no chapter called “nope”");
  });

  it("an admin-only chapter isn't shown to staff by link", async () => {
    const el = await render("workload");
    expect(el.textContent).toContain("There's no chapter called");
  });
});
