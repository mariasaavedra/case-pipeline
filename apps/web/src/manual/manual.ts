/// <reference types="vite/client" />
// =============================================================================
// Staff manual (P22) — the chapters in ./chapters/*.md, parsed once
// =============================================================================
// One Markdown file per chapter, with a small header block (see README.md).
// Everything here is plain data: the page (components/ManualPage.tsx) renders
// it, the top bar's Help button finds the chapter for the page you're on, and
// search runs over the sections below. "What's new" is built from
// changelog.ts so the two never drift apart.
// =============================================================================

import { CHANGELOG, type ChangelogEntry } from "../changelog";

/** Who a chapter is mostly for — the manual's "Show for" filter. */
export const AUDIENCES = ["reception", "paralegal", "attorney", "billing", "admin"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Sidebar groups, in this order. A chapter naming another section is a test failure. */
export const SECTIONS = ["Getting started", "Every day", "Clients & cases", "Contracts & money", "Court & USCIS", "Admin", "Reference"] as const;
export type Section = (typeof SECTIONS)[number];

export interface Chapter {
  slug: string; // file name without .md
  file: string; // apps/web/src/manual/chapters/<file>
  title: string;
  section: Section;
  order: number;
  summary: string;
  /** Route.page values (router.ts) whose Help button opens this chapter. */
  routes: string[];
  /** Screen code(s) from docs/ui-map.md, shown next to the title. */
  code: string;
  audience: Audience[]; // empty = everyone
  adminOnly: boolean;
  updated: string; // YYYY-MM-DD
  body: string; // Markdown without the header block
}

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

export interface SearchHit {
  chapter: Chapter;
  heading: Heading | null; // null = the chapter's intro, before any heading
  snippet: string;
  score: number;
}

/** "Payment links (M21)" → "payment-links-m21". Same ids the page puts on headings. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[*_`[\]()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The `---` header: `key: value` lines; lists are comma-separated. */
export function parseChapter(file: string, raw: string): Chapter {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing the --- header block`);
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (kv) meta[kv[1]!] = kv[2]!.trim();
  }
  const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  if (!meta.title) throw new Error(`${file}: no title`);
  return {
    slug: file.replace(/\.md$/, "").replace(/^\d+-/, ""),
    file,
    title: meta.title,
    section: (meta.section ?? "Reference") as Section,
    order: Number(meta.order ?? 999),
    summary: meta.summary ?? "",
    routes: list(meta.routes),
    code: meta.code ?? "",
    audience: list(meta.for) as Audience[],
    adminOnly: meta.admin === "true",
    updated: meta.updated ?? "",
    body: m[2]!.trim(),
  };
}

/** `##` and `###` headings, in order — "On this page" and search sections. Skips fenced code. */
export function headingsOf(body: string): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("```")) fenced = !fenced;
    const h = !fenced && line.match(/^(#{2,3})\s+(.+?)\s*#*$/);
    if (h) out.push({ depth: h[1]!.length, text: h[2]!.replace(/[*_`]/g, ""), id: slugify(h[2]!) });
  }
  return out;
}

/** What's new, as a chapter: one `##` per changelog entry. */
export function whatsNewChapter(entries: ChangelogEntry[]): Chapter {
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const body = [
    "Everything new in the app, newest first. The same list opens from the version badge on Home.",
    ...entries.map((e) => `## ${e.title}\n\n*${fmt(e.date)}*\n\n${e.items.map((i) => `- ${i}`).join("\n")}`),
  ].join("\n\n");
  return {
    slug: "whats-new",
    file: "",
    title: "What's new",
    section: "Getting started",
    order: 2,
    summary: "Every change to the app, newest first.",
    routes: [],
    code: "M14",
    audience: [],
    adminOnly: false,
    updated: entries[0]?.date ?? "",
    body,
  };
}

const files = import.meta.glob("./chapters/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const CHAPTERS: Chapter[] = [
  ...Object.entries(files).map(([path, raw]) => parseChapter(path.replace("./chapters/", ""), raw)),
  whatsNewChapter(CHANGELOG),
].sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.order - b.order || a.title.localeCompare(b.title));

export function visibleChapters(chapters: Chapter[], isAdmin: boolean, audience: Audience | null): Chapter[] {
  return chapters.filter((c) => (isAdmin || !c.adminOnly) && (!audience || c.audience.length === 0 || c.audience.includes(audience)));
}

/** The chapter the top bar's Help button opens on this page (Route.page), if any. */
export function chapterForRoute(page: string, chapters: Chapter[] = CHAPTERS): Chapter | undefined {
  return chapters.find((c) => c.routes.includes(page));
}

/** Markdown → the words a reader sees (for snippets). */
function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Part {
  chapter: Chapter;
  heading: Heading | null;
  text: string;
  folded: string;
}

function partsOf(chapter: Chapter): Part[] {
  const parts: Part[] = [];
  const heads = headingsOf(chapter.body);
  let current: Heading | null = null;
  let buf: string[] = [];
  let fenced = false;
  let i = 0;
  const flush = () => {
    const text = plain(buf.join("\n"));
    const label = current ? current.text : chapter.title;
    parts.push({ chapter, heading: current, text, folded: fold(`${label} ${chapter.summary} ${text}`) });
    buf = [];
  };
  for (const line of chapter.body.split(/\r?\n/)) {
    if (line.startsWith("```")) fenced = !fenced;
    if (!fenced && /^#{2,3}\s/.test(line)) {
      flush();
      current = heads[i++] ?? null;
      continue;
    }
    buf.push(line);
  }
  flush();
  return parts;
}

function snippetAround(text: string, word: string, width = 160): string {
  const at = fold(text).indexOf(word);
  if (at < 0) return text.slice(0, width) + (text.length > width ? "…" : "");
  const start = Math.max(0, at - 50);
  const s = text.slice(start, start + width);
  return (start > 0 ? "…" : "") + s + (start + width < text.length ? "…" : "");
}

/**
 * Every word must appear in the section (accents and case ignored). Title and
 * heading matches rank first, then how often the words come up.
 */
export function searchManual(query: string, chapters: Chapter[]): SearchHit[] {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const chapter of chapters) {
    for (const part of partsOf(chapter)) {
      if (!words.every((w) => part.folded.includes(w))) continue;
      const label = fold(part.heading?.text ?? chapter.title);
      const title = fold(chapter.title);
      let score = 0;
      for (const w of words) {
        if (label.includes(w)) score += 10;
        if (title.includes(w)) score += 5;
        score += Math.min(5, part.folded.split(w).length - 1);
      }
      hits.push({ chapter, heading: part.heading, snippet: snippetAround(part.text, words[0]!), score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 25);
}
