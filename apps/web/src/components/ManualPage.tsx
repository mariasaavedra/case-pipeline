// =============================================================================
// P22 Manual — the staff instruction booklet
// =============================================================================
// Chapters are Markdown files in src/manual/chapters (see src/manual/README.md
// for how to add or change one). /manual lists them by section, /manual/<slug>
// opens one, #<heading> jumps to a part of it. Search covers every section of
// every chapter; "Show for" narrows the list to one job. Links to app pages
// (/contracts…) and other chapters (/manual/…) stay inside the app.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { navigate } from "../router";
import { useAuth } from "../auth/useAuth";
import { SectionCode } from "./ScreenCode";
import {
  AUDIENCES,
  CHAPTERS,
  SECTIONS,
  headingsOf,
  searchManual,
  slugify,
  visibleChapters,
  type Audience,
  type Chapter,
} from "../manual/manual";

const AUDIENCE_KEY = "manual-audience";
const EDIT_BASE = "https://github.com/mariasaavedra/case-pipeline/edit/main/apps/web/src/manual/chapters/";

const AUDIENCE_LABEL: Record<Audience, string> = {
  reception: "Reception",
  paralegal: "Paralegals",
  attorney: "Attorneys",
  billing: "Billing",
  admin: "Admins",
};

const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slugify(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

function renderBody(body: string): string {
  return DOMPurify.sanitize(md.parse(body, { async: false }) as string);
}

function readAudience(): Audience | null {
  try {
    const v = localStorage.getItem(AUDIENCE_KEY);
    return AUDIENCES.includes(v as Audience) ? (v as Audience) : null;
  } catch {
    return null;
  }
}

/** Like navigate(), but a hash change on the same page still counts. */
function go(href: string) {
  const url = new URL(href, window.location.origin);
  if (url.pathname === window.location.pathname) {
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  navigate(url.pathname + url.search + url.hash);
}

const body = { fontFamily: "var(--font-body)" } as const;
const muted = { color: "var(--color-ink-muted)" } as const;

export function ManualPage({ slug }: { slug: string }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [audience, setAudience] = useState<Audience | null>(readAudience);
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  const chapters = useMemo(() => visibleChapters(CHAPTERS, isAdmin, audience), [isAdmin, audience]);
  // A chapter opened by link stays readable even when the filter would hide it.
  const chapter = slug ? CHAPTERS.find((c) => c.slug === slug && (isAdmin || !c.adminOnly)) : undefined;
  const hits = useMemo(() => searchManual(query, visibleChapters(CHAPTERS, isAdmin, null)), [query, isAdmin]);

  const pickAudience = (a: Audience | null) => {
    setAudience(a);
    try {
      if (a) localStorage.setItem(AUDIENCE_KEY, a);
      else localStorage.removeItem(AUDIENCE_KEY);
    } catch {}
  };

  const open = (href: string) => {
    setQuery("");
    setNavOpen(false);
    go(href);
  };

  return (
    <div className="manual-layout animate-in" style={body}>
      <aside className={`manual-nav ${navOpen ? "manual-nav-open" : ""}`}>
        <div className="flex items-center justify-between mb-3">
          <button type="button" onClick={() => open("/manual")} className="text-left" style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--color-ink)" }}>Manual</div>
            <div className="text-xs" style={muted}>How to use the app</div>
          </button>
          <button type="button" className="manual-nav-toggle text-sm" onClick={() => setNavOpen((o) => !o)} aria-expanded={navOpen}>
            {navOpen ? "Hide chapters" : "Chapters"}
          </button>
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the manual…"
          aria-label="Search the manual"
          className="manual-search"
        />

        <div className="manual-nav-body">
          <div className="text-xs mt-4 mb-1" style={muted}>Show for</div>
          <div className="flex flex-wrap gap-1 mb-3">
            <Chip active={audience === null} onClick={() => pickAudience(null)}>Everyone</Chip>
            {AUDIENCES.filter((a) => a !== "admin" || isAdmin).map((a) => (
              <Chip key={a} active={audience === a} onClick={() => pickAudience(a)}>{AUDIENCE_LABEL[a]}</Chip>
            ))}
          </div>

          {SECTIONS.map((section) => {
            const list = chapters.filter((c) => c.section === section);
            if (list.length === 0) return null;
            return (
              <div key={section} className="mb-3">
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--color-ink-faint)" }}>{section}</div>
                {list.map((c) => (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => open(`/manual/${c.slug}`)}
                    className={`manual-nav-item ${chapter?.slug === c.slug && !query ? "manual-nav-item-active" : ""}`}
                  >
                    {c.title}
                    {c.adminOnly && <span className="manual-admin-tag">admin</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </aside>

      <main className="manual-main">
        <SectionCode code="P22.1" />
        {query.trim() ? (
          <SearchResults query={query} hits={hits} onOpen={open} />
        ) : chapter ? (
          <ChapterView chapter={chapter} chapters={chapters} isAdmin={isAdmin} onOpen={open} />
        ) : slug ? (
          <div className="py-10">
            <p className="text-sm" style={muted}>There's no chapter called “{slug}”. It may have been renamed.</p>
            <button type="button" className="manual-link mt-2" onClick={() => open("/manual")}>See every chapter</button>
          </div>
        ) : (
          <ManualHome chapters={chapters} onOpen={open} />
        )}
      </main>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`manual-chip ${active ? "manual-chip-active" : ""}`} aria-pressed={active}>
      {children}
    </button>
  );
}

function ManualHome({ chapters, onOpen }: { chapters: Chapter[]; onOpen: (href: string) => void }) {
  return (
    <div>
      <h1 className="manual-title">Staff manual</h1>
      <p className="text-sm mb-6" style={{ ...muted, maxWidth: 620, lineHeight: 1.6 }}>
        Step-by-step help for every page of the app. New here? Start with <button type="button" className="manual-link" onClick={() => onOpen("/manual/start-here")}>Start here</button>.
        On any page, the <strong>? Help</strong> button at the top opens the chapter for that page.
      </p>
      {SECTIONS.map((section) => {
        const list = chapters.filter((c) => c.section === section);
        if (list.length === 0) return null;
        return (
          <section key={section} className="mb-6">
            <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink)" }}>{section}</h2>
            <div className="manual-cards">
              {list.map((c) => (
                <button key={c.slug} type="button" className="manual-card" onClick={() => onOpen(`/manual/${c.slug}`)}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm" style={{ color: "var(--color-ink)" }}>{c.title}</span>
                    {c.code && <span className="manual-code">{c.code}</span>}
                  </div>
                  {c.summary && <div className="text-xs mt-1" style={{ ...muted, lineHeight: 1.5 }}>{c.summary}</div>}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SearchResults({ query, hits, onOpen }: { query: string; hits: ReturnType<typeof searchManual>; onOpen: (href: string) => void }) {
  return (
    <div>
      <h1 className="manual-title">Search: “{query.trim()}”</h1>
      {hits.length === 0 ? (
        <p className="text-sm" style={muted}>Nothing found. Try fewer or different words — “payment link”, “consult”, “e-file”.</p>
      ) : (
        <ul className="manual-hits">
          {hits.map((h, i) => (
            <li key={i}>
              <button type="button" className="manual-hit" onClick={() => onOpen(`/manual/${h.chapter.slug}${h.heading ? `#${h.heading.id}` : ""}`)}>
                <div className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                  {h.chapter.title}
                  {h.heading && <span style={muted}> › {h.heading.text}</span>}
                </div>
                <div className="text-xs mt-1" style={{ ...muted, lineHeight: 1.5 }}>{h.snippet}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChapterView({ chapter, chapters, isAdmin, onOpen }: { chapter: Chapter; chapters: Chapter[]; isAdmin: boolean; onOpen: (href: string) => void }) {
  const html = useMemo(() => renderBody(chapter.body), [chapter]);
  const headings = useMemo(() => headingsOf(chapter.body).filter((h) => h.depth === 2), [chapter]);
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);

  // Jump to #heading (from search, a shared link or "On this page") and flash it.
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    const el = id ? document.getElementById(id) : null;
    if (!el) {
      window.scrollTo({ top: 0 });
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("manual-flash");
    const t = setTimeout(() => el.classList.remove("manual-flash"), 1600);
    return () => clearTimeout(t);
  }, [hash, chapter.slug]);

  // Links inside the text: app pages and chapters open in place, the rest in a new tab.
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href) return;
    if (href.startsWith("#")) {
      e.preventDefault();
      onOpen(`/manual/${chapter.slug}${href}`);
    } else if (href.startsWith("/") && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      onOpen(href);
    } else if (/^https?:/.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  };

  const i = chapters.findIndex((c) => c.slug === chapter.slug);
  const prev = i > 0 ? chapters[i - 1] : undefined;
  const next = i >= 0 && i < chapters.length - 1 ? chapters[i + 1] : undefined;
  const pagePath = chapter.routes[0] ? ROUTE_PATHS[chapter.routes[0]] : undefined;

  return (
    <article>
      <div className="text-xs mb-1" style={{ color: "var(--color-ink-faint)" }}>{chapter.section}</div>
      <h1 className="manual-title">
        {chapter.title}
        {chapter.code && <span className="manual-code" style={{ marginLeft: 10, verticalAlign: "middle" }}>{chapter.code}</span>}
      </h1>
      <div className="flex flex-wrap items-center gap-3 text-xs mb-5" style={muted}>
        {chapter.audience.length > 0 && <span>For {chapter.audience.map((a) => AUDIENCE_LABEL[a]).join(", ").toLowerCase()}</span>}
        {chapter.updated && <span>Updated {chapter.updated}</span>}
        {pagePath && (
          <button type="button" className="manual-link" onClick={() => onOpen(pagePath)}>Open this page →</button>
        )}
        {isAdmin && chapter.file && (
          <a className="manual-link" href={EDIT_BASE + chapter.file} target="_blank" rel="noopener noreferrer">Edit this chapter ↗</a>
        )}
      </div>

      {headings.length > 2 && (
        <nav className="manual-toc" aria-label="On this page">
          <div className="text-xs font-semibold mb-1" style={{ color: "var(--color-ink)" }}>On this page</div>
          {headings.map((h) => (
            <button key={h.id} type="button" className="manual-toc-item" onClick={() => onOpen(`/manual/${chapter.slug}#${h.id}`)}>
              {h.text}
            </button>
          ))}
        </nav>
      )}

      <div className="manual-prose" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />

      <div className="manual-pager">
        {prev ? <button type="button" className="manual-card" onClick={() => onOpen(`/manual/${prev.slug}`)}><span className="text-xs" style={muted}>← Previous</span><div className="text-sm font-semibold">{prev.title}</div></button> : <span />}
        {next ? <button type="button" className="manual-card" style={{ textAlign: "right" }} onClick={() => onOpen(`/manual/${next.slug}`)}><span className="text-xs" style={muted}>Next →</span><div className="text-sm font-semibold">{next.title}</div></button> : <span />}
      </div>
    </article>
  );
}

/** Where "Open this page →" goes, per Route.page. */
const ROUTE_PATHS: Record<string, string> = {
  landing: "/",
  clients: "/clients",
  appointments: "/appointments",
  reception: "/reception",
  contracts: "/contracts",
  prescheduling: "/prescheduling",
  "active-cases": "/active-cases",
  "my-cases": "/my-cases",
  calendar: "/calendar",
  alerts: "/alerts",
  "jail-intakes": "/jail-intakes",
  "call-log": "/call-log",
  mail: "/mail",
  "court-cases": "/court-cases",
  "address-changes": "/address-changes",
  foias: "/foias",
  "efiles-to-open": "/efiles-to-open",
  "client-uploads": "/client-uploads",
  workload: "/workload",
  settings: "/settings",
};
