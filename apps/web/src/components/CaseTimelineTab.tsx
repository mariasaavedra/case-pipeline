import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { fetchCaseTimeline } from "../api";
import type { CaseTimeline, TimelineEvent, TimelineNote, TimelineTrack } from "../api";
import { TimelineEventPanel, type TimelineEventTarget } from "./TimelineEventPanel";

// P3.9 Case timeline — the client's case as dated milestones on five tracks.
// Data + rules: GET /api/clients/:id/timeline (libs/query/src/case-timeline.ts,
// config/timeline.yaml). This file draws it; clicking an event (or "Fix" on a
// "Needs attention" item) opens M29, TimelineEventPanel, to edit its Monday item.

const TRACKS: { key: TimelineTrack; name: string; color: string }[] = [
  { key: "court", name: "Immigration court", color: "var(--tl-court)" },
  { key: "uscis", name: "USCIS", color: "var(--tl-uscis)" },
  { key: "fees", name: "Fees & contracts", color: "var(--tl-fees)" },
  { key: "meetings", name: "Meetings & calls", color: "var(--tl-meetings)" },
  { key: "notes", name: "Notes activity", color: "var(--tl-notes)" },
];
const TRACK = Object.fromEntries(TRACKS.map((t) => [t.key, t])) as Record<TimelineTrack, (typeof TRACKS)[number]>;

type Range = "12" | "18" | "36" | "all";
const RANGES: [Range, string][] = [["12", "12 months"], ["18", "18 months"], ["36", "3 years"], ["all", "Everything"]];

const DAY = 86_400_000;
/** Vertical offsets for events closer than 15px on the same lane. */
const STACK_OFFSETS = [0, -15, 15, -30, 30];
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(ms(iso)).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const fmtLong = (iso: string) => fmt(iso, { month: "short", day: "numeric", year: "numeric" });
const fmtShort = (iso: string) => fmt(iso, { month: "short", day: "numeric" });

const STATUS_TEXT: Record<string, string> = {
  done: "happened",
  cancelled: "rescheduled / not happening",
  unknown: "no outcome recorded",
  decided: "decision issued that day",
  upcoming: "upcoming",
  good: "good news",
  bad: "adverse",
  met: "deadline met",
};

const TONE_COLOR: Record<string, string> = { bad: "var(--tl-bad)", warn: "var(--tl-warn)", good: "var(--tl-good)" };

export function CaseTimelineTab({ profileLocalId }: { profileLocalId: string }) {
  const [data, setData] = useState<CaseTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("18");
  const [tracks, setTracks] = useState<Set<TimelineTrack>>(() => new Set(TRACKS.map((t) => t.key)));
  const [newestFirst, setNewestFirst] = useState(true);
  /** Status / group changes from the item activity log (kind "change"). */
  const [showChanges, setShowChanges] = useState(true);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [panel, setPanel] = useState<TimelineEventTarget | null>(null);
  /** Bumped after an edit in M29: reload without blanking what's on screen. */
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setData(null);
    setHighlight(null);
  }, [profileLocalId]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchCaseTimeline(profileLocalId)
      .then((t) => !cancelled && setData(t))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [profileLocalId, version]);

  if (error) {
    return (
      <div className="px-4 py-3 rounded-lg text-sm animate-in" style={{ backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>
        Failed to load the timeline: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3 animate-in">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-lg loading-shimmer" />
        ))}
      </div>
    );
  }

  const toggleTrack = (key: TimelineTrack) =>
    setTracks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const pick = (i: number) => {
    setHighlight(i);
    document.querySelector(`[data-tl-row="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const event = data.events[i];
    if (event) setPanel({ event });
  };
  const openRow = (i: number) => {
    setHighlight(i);
    const event = data.events[i];
    if (event) setPanel({ event });
  };
  const openFix = (n: TimelineNote) => {
    if (!n.fix) return;
    const fix = n.fix;
    // The dated event behind the item, when there is one (a motion waiting on the judge may have none).
    const event = data.events.find((e) => e.itemLocalId === fix.itemLocalId && (!n.date || e.date === n.date));
    setPanel({ fix, event, title: n.text });
  };

  return (
    <div className="space-y-4 animate-in" style={{ fontFamily: "var(--font-body)" }}>
      <Summary data={data} onFix={openFix} onOpen={(e) => setPanel({ event: e })} />

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <SectionTitle>Timeline</SectionTitle>
          <div className="case-tl-seg" role="group" aria-label="Date range">
            {RANGES.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {data.events.length === 0 && data.notesByMonth.length === 0 ? (
          <p className="text-sm py-8 text-center" style={{ color: "var(--color-ink-faint)" }}>
            No dated milestones for this client yet.
          </p>
        ) : (
          <Chart data={data} range={range} tracks={tracks} showChanges={showChanges} onPick={pick} />
        )}
        <Legend />
      </section>

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <SectionTitle>Story</SectionTitle>
          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {TRACKS.map((t) => (
              <label key={t.key} className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={tracks.has(t.key)} onChange={() => toggleTrack(t.key)} />
                <span style={{ color: t.color }}>●</span>
                {t.name}
              </label>
            ))}
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={showChanges} onChange={() => setShowChanges((v) => !v)} />
              Status changes
            </label>
            <div className="case-tl-seg" role="group" aria-label="Order">
              <button type="button" aria-pressed={newestFirst} onClick={() => setNewestFirst(true)}>Newest first</button>
              <button type="button" aria-pressed={!newestFirst} onClick={() => setNewestFirst(false)}>Oldest first</button>
            </div>
          </div>
        </div>
        <Story events={data.events} tracks={tracks} showChanges={showChanges} newestFirst={newestFirst} highlight={highlight} today={data.today} onOpen={openRow} />
      </section>

      {panel && (
        <TimelineEventPanel
          profileLocalId={profileLocalId}
          target={panel}
          onClose={(changed) => {
            setPanel(null);
            if (changed) setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-widest m-0" style={{ color: "var(--color-ink-muted)" }}>
      {children}
    </h3>
  );
}

// =============================================================================
// Summary
// =============================================================================

function Summary({ data, onFix, onOpen }: { data: CaseTimeline; onFix: (n: TimelineNote) => void; onOpen: (e: TimelineEvent) => void }) {
  const { standing, attention, next } = data.summary;
  const col = (title: string, items: TimelineNote[], empty: string, emptyTone?: "good", open?: (i: number) => void) => (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <ul className="mt-2 m-0 p-0 list-none">
        {items.length === 0 ? (
          <li className="py-1 text-sm" style={{ color: emptyTone ? "var(--tl-good)" : "var(--color-ink-faint)" }}>{empty}</li>
        ) : (
          items.map((n, i) => (
            <li key={i} className="py-1 text-sm" style={{ borderTop: i ? "1px solid var(--color-border-light)" : undefined }}>
              {n.date && (
                <span className="mr-1.5 text-xs" style={{ color: "var(--color-ink-faint)", fontVariantNumeric: "tabular-nums" }}>
                  {fmtShort(n.date)}
                </span>
              )}
              {open ? (
                <button type="button" className="case-tl-link" onClick={() => open(i)}>{n.text}</button>
              ) : (
                <span style={{ color: n.tone ? TONE_COLOR[n.tone] : "var(--color-ink)", fontWeight: n.tone ? 600 : 400 }}>{n.text}</span>
              )}
              {n.fix && (() => {
                const action = n.fix.kind === "hearing_outcome" ? "Record outcome" : n.fix.kind === "motion" ? "Record decision" : "Fix";
                return (
                  <button type="button" className="case-tl-fix" onClick={() => onFix(n)} aria-label={`${action}: ${n.text}`}>
                    {action}
                  </button>
                );
              })()}
            </li>
          ))
        )}
      </ul>
    </div>
  );
  return (
    <section className="card p-4 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
      {col("Where it stands", standing, "Nothing recorded yet")}
      {col("Needs attention", attention, "Nothing flagged", "good")}
      {col("Coming up", next.map((e) => ({ tone: null, date: e.date, text: e.label })), "Nothing scheduled", undefined, (i) => {
        const e = next[i];
        if (e) onOpen(e);
      })}
    </section>
  );
}

// =============================================================================
// Markers
// =============================================================================

function Marker({ e, x, y, color }: { e: Pick<TimelineEvent, "kind" | "status" | "date">; x: number; y: number; color: string }) {
  const cancelled = e.status === "cancelled";
  const tone = e.status === "bad" ? "var(--tl-bad)" : e.status === "good" ? "var(--tl-good)" : color;
  const hollow = cancelled || e.kind === "meeting" || e.kind === "call" || (e.kind === "milestone" && e.status !== "good");
  const p = {
    stroke: cancelled ? "var(--color-ink-faint)" : tone,
    strokeWidth: 2,
    fill: hollow ? "var(--color-card)" : tone,
    strokeDasharray: cancelled ? "2 2" : undefined,
  };
  switch (e.kind) {
    case "change":
      // A status change: a thin tick, so it never crowds the milestones.
      return <rect x={x - 1.25} y={y - 5} width={2.5} height={10} rx={1} fill={color} opacity={0.75} />;
    case "hearing":
      return <path d={`M${x} ${y - 7}L${x + 7} ${y}L${x} ${y + 7}L${x - 7} ${y}Z`} {...p} />;
    case "decision":
      return <rect x={x - 5.5} y={y - 5.5} width={11} height={11} rx={1.5} {...p} />;
    case "deadline": {
      if (cancelled) return <path d={`M${x} ${y - 7}L${x + 6.5} ${y + 5}L${x - 6.5} ${y + 5}Z`} {...p} />;
      const c = e.status === "met" ? "var(--tl-good)" : "var(--tl-bad)";
      const solid = e.status === "met" || e.status === "upcoming";
      return <path d={`M${x} ${y - 7}L${x + 6.5} ${y + 5}L${x - 6.5} ${y + 5}Z`} stroke={c} strokeWidth={2} fill={solid ? c : "var(--color-card)"} />;
    }
    case "filing":
      return <circle cx={x} cy={y} r={5.5} {...p} />;
    default:
      return <circle cx={x} cy={y} r={4.5} {...p} />;
  }
}

function Legend() {
  const items: [Pick<TimelineEvent, "kind" | "status" | "date">, string][] = [
    [{ kind: "filing", status: null, date: "" }, "Filed / sent"],
    [{ kind: "decision", status: null, date: "" }, "Decision or notice"],
    [{ kind: "hearing", status: null, date: "" }, "Hearing / interview"],
    [{ kind: "deadline", status: "upcoming", date: "" }, "Deadline"],
    [{ kind: "meeting", status: null, date: "" }, "Meeting / milestone"],
    [{ kind: "hearing", status: "cancelled", date: "" }, "Rescheduled / cancelled / moved"],
    [{ kind: "change", status: null, date: "" }, "Status change"],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
      {items.map(([e, label]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
            <Marker e={e} x={9} y={9} color="var(--color-ink)" />
          </svg>
          {label}
        </span>
      ))}
    </div>
  );
}

// =============================================================================
// Chart
// =============================================================================

interface Tip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function Chart({ data, range, tracks, showChanges, onPick }: { data: CaseTimeline; range: Range; tracks: Set<TimelineTrack>; showChanges: boolean; onPick: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(720, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = TRACKS.filter((t) => tracks.has(t.key));
  const LEFT = 150, GUTTER = 58, RIGHT = 20, LANE = 58, TOP = 44;
  const H = TOP + shown.length * LANE + 14;

  const layout = useMemo(() => {
    const dates = [...data.events.map((e) => ms(e.date)), ms(data.today)];
    const maxD = Math.max(...dates) + 30 * DAY;
    const minD = range === "all" ? Math.min(...dates) - 30 * DAY : ms(data.today) - Number(range) * 30.44 * DAY;
    const hasGutter = data.events.some((e) => ms(e.date) < minD);
    const x0 = LEFT + (hasGutter ? GUTTER : 0);
    const x1 = width - RIGHT;
    const X = (t: number) => x0 + ((t - minD) / (maxD - minD)) * (x1 - x0);

    // Month ticks; years labelled on January and the first tick.
    const ticks: { x: number; month: string; year: string | null; jan: boolean }[] = [];
    const spanMonths = (maxD - minD) / (30.44 * DAY);
    const step = spanMonths > 40 ? 6 : spanMonths > 20 ? 3 : 1;
    const start = new Date(minD);
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    let first = true;
    for (; d.getTime() <= maxD; d.setUTCMonth(d.getUTCMonth() + 1)) {
      if (d.getUTCMonth() % step) continue;
      const jan = d.getUTCMonth() === 0;
      ticks.push({
        x: X(d.getTime()),
        month: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
        year: jan || first ? String(d.getUTCFullYear()) : null,
        jan,
      });
      first = false;
    }

    // Points, stacked so same-week events don't overlap.
    const points: { i: number; x: number; y: number }[] = [];
    shown.forEach((t, lane) => {
      if (t.key === "notes") return;
      const y = TOP + lane * LANE + LANE / 2;
      const rows: number[] = [];
      let early = 0;
      data.events.forEach((e, i) => {
        if (e.track !== t.key) return;
        if (e.kind === "change") {
          // Along the lane's bottom edge, unstacked; none in the "Earlier" gutter.
          if (showChanges && ms(e.date) >= minD) points.push({ i, x: X(ms(e.date)), y: y + LANE / 2 - 8 });
          return;
        }
        if (ms(e.date) < minD) {
          points.push({ i, x: LEFT + (GUTTER - 8) / 2 + ((early % 3) - 1) * 14, y: y - 10 + Math.floor(early / 3) * 14 });
          early++;
          return;
        }
        const x = X(ms(e.date));
        let r = 0;
        while (rows[r] !== undefined && x - (rows[r] ?? 0) < 15) r++;
        rows[r] = x;
        points.push({ i, x, y: y + (STACK_OFFSETS[r % STACK_OFFSETS.length] ?? 0) });
      });
    });

    return { minD, X, x1, hasGutter, ticks, points };
  }, [data, range, width, showChanges, shown.map((t) => t.key).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const { minD, X, x1, hasGutter, ticks, points } = layout;
  const todayX = X(ms(data.today));
  const notesMax = Math.max(1, ...data.notesByMonth.map((n) => n.count));

  const showTip = (ev: MouseEvent, title: string, lines: string[]) => setTip({ x: ev.clientX, y: ev.clientY, title, lines });

  return (
    <div className="case-tl-chart" ref={box}>
      <svg viewBox={`0 0 ${width} ${H}`} role="img" aria-label="Case timeline chart" onMouseLeave={() => setTip(null)}>
        {ticks.map((t) => (
          <g key={t.x}>
            <line x1={t.x} x2={t.x} y1={TOP - 6} y2={H - 8} stroke="var(--color-border)" strokeWidth={t.jan ? 1.5 : 1} />
            <text x={t.x + 3} y={TOP - 12} fontSize={11} fill="var(--color-ink-faint)">{t.month}</text>
            {t.year && <text x={t.x + 3} y={TOP - 27} fontSize={11.5} fontWeight={700} fill="var(--color-ink)">{t.year}</text>}
          </g>
        ))}
        {hasGutter && (
          <g>
            <rect x={LEFT} y={TOP - 6} width={GUTTER - 8} height={H - TOP - 2} rx={6} fill="var(--color-surface-warm)" />
            <text x={LEFT + (GUTTER - 8) / 2} y={TOP - 12} fontSize={11} textAnchor="middle" fill="var(--color-ink-faint)">Earlier</text>
          </g>
        )}
        <line x1={todayX} x2={todayX} y1={TOP - 6} y2={H - 12} stroke="var(--tl-bad)" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={todayX} y={H - 1} fontSize={10} textAnchor="middle" fontWeight={600} fill="var(--tl-bad)">TODAY</text>

        {shown.map((t, lane) => {
          const y = TOP + lane * LANE + LANE / 2;
          return (
            <g key={t.key}>
              <line x1={LEFT} x2={x1} y1={y} y2={y} stroke="var(--color-border)" />
              <rect x={8} y={y - 12} width={4} height={24} rx={2} fill={t.color} />
              <text x={18} y={y + 4} fontSize={12.5} fontWeight={600} fill="var(--color-ink)">{t.name}</text>
              {t.key === "notes" &&
                data.notesByMonth.map((n) => {
                  const a = ms(`${n.month}-01`);
                  if (a < minD) return null;
                  const [yy = 0, mm = 1] = n.month.split("-").map(Number);
                  const b = Date.UTC(yy, mm, 1); // month mm is 1-based, so this is the 1st of the next month
                  const h = 4 + (n.count / notesMax) * (LANE - 18);
                  return (
                    <rect
                      key={n.month}
                      x={X(a) + 1}
                      y={y + LANE / 2 - 6 - h}
                      width={Math.max(2, X(b) - X(a) - 2)}
                      height={h}
                      rx={2}
                      fill={t.color}
                      opacity={0.55}
                      onMouseMove={(ev) => showTip(ev, `${n.count} notes & emails`, [fmt(`${n.month}-01`, { month: "long", year: "numeric" })])}
                    />
                  );
                })}
            </g>
          );
        })}

        {points.map(({ i, x, y }) => {
          const e = data.events[i];
          if (!e) return null;
          return (
            <g
              key={i}
              style={{ cursor: "pointer" }}
              onClick={() => onPick(i)}
              onMouseMove={(ev) =>
                showTip(ev, e.label, [
                  [fmtLong(e.date), e.status && e.status !== "deadline" ? STATUS_TEXT[e.status] : null].filter(Boolean).join(" · "),
                  ...(e.detail ? [e.detail] : []),
                  e.source,
                ])
              }
            >
              <Marker e={e} x={x} y={y} color={TRACK[e.track].color} />
              <circle cx={x} cy={y} r={10} fill="transparent" />
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="case-tl-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 330), top: tip.y + 14 }}>
          <div className="font-semibold mb-0.5">{tip.title}</div>
          {tip.lines.map((l, i) => (
            <div key={i} style={{ opacity: i === 0 ? 1 : 0.75, marginTop: i ? 4 : 0 }}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Story
// =============================================================================

function Story({ events, tracks, showChanges, newestFirst, highlight, today, onOpen }: { events: TimelineEvent[]; tracks: Set<TimelineTrack>; showChanges: boolean; newestFirst: boolean; highlight: number | null; today: string; onOpen: (i: number) => void }) {
  const rows = events.map((e, i) => ({ e, i })).filter(({ e }) => tracks.has(e.track) && (showChanges || e.kind !== "change"));
  if (newestFirst) rows.reverse();
  if (rows.length === 0) {
    return <p className="text-sm py-6 text-center" style={{ color: "var(--color-ink-faint)" }}>No events on the selected tracks.</p>;
  }
  let month = "";
  return (
    <div>
      {rows.map(({ e, i }) => {
        const m = fmt(e.date, { month: "long", year: "numeric" });
        const header = m !== month ? m : null;
        month = m;
        return (
          <div key={i}>
            {header && (
              <div className="text-xs font-semibold mt-4 mb-1 py-1" style={{ color: "var(--color-ink-muted)" }}>{header}</div>
            )}
            <div
              className="case-tl-row"
              data-tl-row={i}
              data-hl={highlight === i}
              data-cancelled={e.status === "cancelled"}
              role="button"
              tabIndex={0}
              aria-label={`${e.label}, ${fmtLong(e.date)}: open`}
              onClick={() => onOpen(i)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  onOpen(i);
                }
              }}
            >
              <div className="text-xs pt-0.5" style={{ color: "var(--color-ink-faint)", fontVariantNumeric: "tabular-nums" }}>{fmtShort(e.date)}</div>
              <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
                <Marker e={e} x={8} y={8} color={TRACK[e.track].color} />
              </svg>
              <div className="min-w-0">
                <span className="case-tl-label text-sm font-medium" style={{ color: "var(--color-ink)" }}>{e.label}</span>
                <Tag e={e} today={today} />
                <div className="text-xs break-words" style={{ color: "var(--color-ink-faint)" }}>
                  {TRACK[e.track].name} · {e.source}
                  {e.detail ? ` — ${e.detail}` : ""}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Tag({ e, today }: { e: TimelineEvent; today: string }) {
  const tag = (text: string, color: string) => (
    <span
      className="ml-1.5 text-[11px] font-semibold px-1.5 py-px rounded"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
    >
      {text}
    </span>
  );
  if (e.status === "met") return tag("deadline met", "var(--tl-good)");
  if (e.kind === "deadline" && e.status === "cancelled") return tag("not ours any more", "var(--color-ink-muted)");
  if (e.kind === "deadline") return tag("deadline", e.date <= today ? "var(--tl-bad)" : "var(--tl-warn)");
  if (e.status === "bad") return tag(e.kind === "decision" ? "adverse" : "!", "var(--tl-bad)");
  if (e.status === "good") return tag("✓", "var(--tl-good)");
  if (e.status === "unknown") return tag("no outcome recorded", "var(--tl-warn)");
  if (e.status === "decided") return tag("decided that day", "var(--color-ink-muted)");
  if (e.date > today && e.status !== "cancelled") return tag("upcoming", "var(--tl-warn)");
  return null;
}
