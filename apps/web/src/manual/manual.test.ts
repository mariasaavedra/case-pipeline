import { describe, it, expect } from "vitest";
import type { Route } from "../router";
import { CHAPTERS, SECTIONS, AUDIENCES, headingsOf, parseChapter, searchManual, slugify, visibleChapters, chapterForRoute, whatsNewChapter } from "./manual";

// Every page must say whether its Help button needs a chapter. A new page in
// router.ts fails typecheck here until someone decides — and writes it.
const NEEDS_CHAPTER: Record<Route["page"], boolean> = {
  landing: true,
  clients: true,
  "client-detail": true,
  appointments: true,
  reception: true,
  contracts: true,
  prescheduling: true,
  "address-changes": true,
  foias: true,
  "efiles-to-open": true,
  "client-uploads": true,
  workload: true,
  "active-cases": true,
  "my-cases": true,
  calendar: true,
  alerts: true,
  "call-log": true,
  "jail-intakes": true,
  mail: true,
  "court-cases": true,
  settings: true,
  map: false, // not built yet
  manual: false,
  login: false,
  admin: false, // redirects to settings
};

describe("manual chapters", () => {
  it("parse, with a known section and audience, and unique slugs", () => {
    expect(CHAPTERS.length).toBeGreaterThan(10);
    const slugs = new Set<string>();
    for (const c of CHAPTERS) {
      expect(SECTIONS, c.file).toContain(c.section);
      for (const a of c.audience) expect(AUDIENCES, c.file).toContain(a);
      expect(c.body.length, c.file).toBeGreaterThan(50);
      expect(slugs.has(c.slug), `duplicate slug ${c.slug}`).toBe(false);
      slugs.add(c.slug);
      if (c.file) expect(c.updated, c.file).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("every page with a Help button has exactly one chapter", () => {
    const pages = Object.keys(NEEDS_CHAPTER);
    for (const c of CHAPTERS) for (const r of c.routes) expect(pages, `${c.file}: unknown route ${r}`).toContain(r);
    for (const [page, needs] of Object.entries(NEEDS_CHAPTER)) {
      const owners = CHAPTERS.filter((c) => c.routes.includes(page));
      if (needs) expect(owners.map((c) => c.slug), `no chapter for page "${page}"`).toHaveLength(1);
    }
  });

  it("links between chapters point at real chapters and headings", () => {
    const bySlug = new Map(CHAPTERS.map((c) => [c.slug, c]));
    for (const c of CHAPTERS) {
      for (const m of c.body.matchAll(/\]\(\/manual\/([^)#\s]+)(?:#([^)\s]+))?\)/g)) {
        const target = bySlug.get(m[1]!);
        expect(target, `${c.file} → /manual/${m[1]}`).toBeDefined();
        if (m[2]) expect(headingsOf(target!.body).map((h) => h.id), `${c.file} → #${m[2]}`).toContain(m[2]);
      }
      for (const m of c.body.matchAll(/\]\(#([^)\s]+)\)/g)) {
        expect(headingsOf(c.body).map((h) => h.id), `${c.file} → #${m[1]}`).toContain(m[1]);
      }
    }
  });
});

describe("parseChapter", () => {
  it("reads the header block and strips the number from the slug", () => {
    const c = parseChapter("20-contracts.md", "---\ntitle: Contracts\nsection: Contracts & money\norder: 3\nroutes: contracts, landing\nfor: billing\nadmin: true\n---\n\nBody text");
    expect(c).toMatchObject({ slug: "contracts", title: "Contracts", order: 3, routes: ["contracts", "landing"], audience: ["billing"], adminOnly: true, body: "Body text" });
  });

  it("refuses a file without a header", () => {
    expect(() => parseChapter("x.md", "# Hi")).toThrow(/header/);
  });
});

describe("headings and search", () => {
  it("slugs headings the way links are written", () => {
    expect(slugify("Payment links (M21)")).toBe("payment-links-m21");
    expect(slugify("Tell the attorney: ¿listo?")).toBe("tell-the-attorney-listo");
    expect(headingsOf("## One\ntext\n```\n## not a heading\n```\n### Two")).toEqual([
      { depth: 2, text: "One", id: "one" },
      { depth: 3, text: "Two", id: "two" },
    ]);
  });

  it("finds a section by its words, accents and case ignored, headings first", () => {
    const hits = searchManual("PAYMENT links", CHAPTERS);
    expect(hits[0]!.chapter.slug).toBe("contracts");
    expect(hits[0]!.heading?.id).toBe("payment-links");
    expect(searchManual("espanol", CHAPTERS).length).toBeGreaterThan(0); // "Español"
    expect(searchManual("zzzz nothing", CHAPTERS)).toEqual([]);
  });

  it("hides admin chapters from staff and filters by job", () => {
    const staff = visibleChapters(CHAPTERS, false, null);
    expect(staff.some((c) => c.adminOnly)).toBe(false);
    const reception = visibleChapters(CHAPTERS, true, "reception");
    expect(reception.every((c) => c.audience.length === 0 || c.audience.includes("reception"))).toBe(true);
    expect(reception.some((c) => c.slug === "reception")).toBe(true);
    expect(reception.some((c) => c.slug === "appointments")).toBe(false);
  });

  it("Help on a page opens its chapter", () => {
    expect(chapterForRoute("contracts")?.slug).toBe("contracts");
    expect(chapterForRoute("client-detail")?.slug).toBe("clients");
    expect(chapterForRoute("map")).toBeUndefined();
  });

  it("What's new comes from the changelog", () => {
    const c = whatsNewChapter([{ date: "2026-10-19", title: "Timeline: what changed", items: ["One", "Two"] }]);
    expect(c.slug).toBe("whats-new");
    expect(headingsOf(c.body)[0]!.text).toBe("Timeline: what changed");
    expect(c.body).toContain("- One");
  });
});
