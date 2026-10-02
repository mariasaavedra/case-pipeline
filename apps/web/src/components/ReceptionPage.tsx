import { useCallback, useEffect, useState } from "react";
import { fetchAppointments, fetchReceptionConsults } from "../api";
import type { AppointmentEntry, ReceptionConsult, ReceptionConsultsResult } from "../api";
import { AppointmentModal } from "./AppointmentModal";
import { ClientLink } from "./ClientPeek";
import { SectionCode } from "./ScreenCode";
import { Tag, PersonChip, ListSection } from "./caseBoardParts";
import { ConsultPrepModal } from "./ConsultPrepModal";
import { NewAppointmentModal } from "./NewAppointmentModal";
import { Button } from "./ui/button";

// =============================================================================
// P17 Receptionists
// =============================================================================
// Reception's main job is preparing consults for the attorneys. This page lists
// the consults on every active attorney board (Calendly-booked or added by
// staff), day by day, each marked Prepped / Not prepped. "Prep" opens M18;
// "+ Book Appt" opens M10 with a client search, for a consult that is not on a
// board yet. "Focus" opens the same focus view as P4 (M5: notes, documents,
// note composer) over the page — also from inside M18, so the notes can be read
// while prepping. Visible to everyone. See routes/reception.ts.
// =============================================================================

type Range = "today" | "tomorrow" | "week";

const RANGES: Array<{ id: Range; label: string }> = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "Next 7 days" },
];

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today in the firm's timezone — the same answer the server gives. */
const todayCentral = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

function windowFor(range: Range): { from: string; to: string } {
  const today = todayCentral();
  if (range === "today") return { from: today, to: today };
  if (range === "tomorrow") return { from: addDays(today, 1), to: addDays(today, 1) };
  return { from: today, to: addDays(today, 7) };
}

function dayHeading(ymd: string, today: string): string {
  const label = new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  if (ymd === today) return `Today · ${label}`;
  if (ymd === addDays(today, 1)) return `Tomorrow · ${label}`;
  return label;
}

function timeLabel(hhmm: string | null): string {
  if (!hhmm) return "No time";
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h ?? 0;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(m ?? 0).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

function preppedOn(at: string): string {
  // consult_preps.created_at is SQLite's UTC "YYYY-MM-DD HH:MM:SS".
  const d = new Date(`${at.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// =============================================================================
// Consult list (P17.2)
// =============================================================================

function ConsultRow({ c, attorneyActive, onAttorney, onPrep, onFocus }: {
  c: ReceptionConsult;
  attorneyActive: boolean;
  onAttorney: (name: string) => void;
  onPrep: (c: ReceptionConsult) => void;
  onFocus: (c: ReceptionConsult) => void;
}) {
  const prepped = c.lastPrep !== null;
  return (
    <li
      className="grid gap-x-4 gap-y-1.5 px-4 py-3 items-center grid-cols-1 md:grid-cols-[5.5rem_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,2fr)_9rem]"
      style={{
        borderTop: "1px solid var(--color-border-light)",
        boxShadow: `inset 3px 0 0 ${prepped ? "var(--urgency-later)" : "var(--urgency-soon)"}`,
      }}
    >
      {/* Time */}
      <div className="text-sm font-semibold whitespace-nowrap" style={{ color: "var(--color-ink)", fontFamily: "var(--font-mono)" }}>
        {timeLabel(c.time)}
      </div>

      {/* Client + tags */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {c.profile ? (
            <ClientLink clientId={c.profile.localId} className="font-medium hover:underline truncate" style={{ color: "var(--color-ink)" }}>
              {c.profile.name}
            </ClientLink>
          ) : (
            <span className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{c.name}</span>
          )}
          {!c.profile && <Tag color="missing" title="Not linked to a profile in Monday — link it before prepping">No profile</Tag>}
          {c.fromCalendly && <Tag color="later" title="Booked through Calendly">Calendly</Tag>}
          {c.language && <Tag color="court" title="Language">{c.language}</Tag>}
        </div>
        {(c.profile?.phone ?? c.phone) && (
          <div className="text-xs mt-0.5" style={{ color: "var(--color-ink-faint)" }}>{c.profile?.phone ?? c.phone}</div>
        )}
      </div>

      {/* Attorney */}
      <div className="flex items-center gap-1.5 min-w-0">
        {/* The chip both names the attorney and filters by them; the board
            badge only stands in when the row has no attorney set. */}
        {c.attorney ? (
          <PersonChip name={c.attorney} active={attorneyActive} onClick={() => onAttorney(c.attorney!)} />
        ) : (
          <span className="board-tag" title="Attorney's board">{c.board}</span>
        )}
      </div>

      {/* Description */}
      <div className="text-xs leading-5 min-w-0" style={{ color: "var(--color-ink-muted)" }}>
        <div className="line-clamp-2" title={c.description ?? undefined}>
          {c.description ?? <span style={{ color: "var(--color-ink-faint)" }}>No description</span>}
        </div>
      </div>

      {/* Prep state + action */}
      <div className="flex flex-col items-start md:items-end gap-1">
        {prepped ? (
          <span className="text-xs" style={{ color: "var(--urgency-later)" }} title={`${c.lastPrep!.apptType} · ${c.lastPrep!.method}`}>
            ✓ Prepped{c.lastPrep!.author ? ` by ${c.lastPrep!.author.split(" ")[0]}` : ""} · {preppedOn(c.lastPrep!.at)}
            {c.lastPrep!.pending ? " (syncing)" : ""}
          </span>
        ) : (
          <span className="text-xs font-semibold" style={{ color: "var(--urgency-soon)" }}>Not prepped</span>
        )}
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={() => onFocus(c)} title="Notes, documents and details without leaving the page">
            Focus
          </Button>
          <Button type="button" size="sm" variant={prepped ? "outline" : "default"} onClick={() => onPrep(c)}>
            {prepped ? "Prep again" : "Prep"}
          </Button>
        </div>
      </div>
    </li>
  );
}

// =============================================================================
// ReceptionPage
// =============================================================================

export function ReceptionPage() {
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<ReceptionConsultsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attorney, setAttorney] = useState<string | null>(null);
  const [notPreppedOnly, setNotPreppedOnly] = useState(false);
  const [prepping, setPrepping] = useState<ReceptionConsult | null>(null);
  const [booking, setBooking] = useState(false);
  const [focused, setFocused] = useState<AppointmentEntry | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);

  // M5 wants the enriched P4 entry (notes, case summary), so fetch that day's
  // appointments and pick this one — the same data P4's Focus button shows.
  const openFocus = useCallback((c: ReceptionConsult) => {
    if (!c.date) return;
    setFocusError(null);
    fetchAppointments(undefined, "day", c.date)
      .then((r) => {
        const entry = r.entries.find((e) => e.appointment.localId === c.localId);
        if (entry) setFocused(entry);
        else setFocusError("Couldn't load this appointment's focus view.");
      })
      .catch((e: unknown) => setFocusError(e instanceof Error ? e.message : "Couldn't load the focus view"));
  }, []);

  const load = useCallback(() => {
    const w = windowFor(range);
    fetchReceptionConsults(w.from, w.to)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [range]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const consults = data?.consults ?? [];
  const attorneys = [...new Set(consults.map((c) => c.attorney).filter((a): a is string => !!a))].sort();
  const notPreppedCount = consults.filter((c) => !c.lastPrep).length;
  const visible = consults.filter(
    (c) => (attorney === null || c.attorney === attorney) && (!notPreppedOnly || !c.lastPrep),
  );
  // Already sorted by date then time on the server, so grouping keeps the order.
  const byDay = new Map<string, ReceptionConsult[]>();
  for (const c of visible) byDay.set(c.date ?? "", [...(byDay.get(c.date ?? "") ?? []), c]);

  const pickAttorney = (name: string) => setAttorney((a) => (a === name ? null : name));

  return (
    <div>
      {/* P17.1 — header */}
      <SectionCode code="P17.1" />
      <div className="flex items-start gap-3 flex-wrap mb-1">
        <div className="flex items-baseline gap-3 flex-wrap flex-1 min-w-0">
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
            Receptionists
          </h1>
          {data && (
            <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
              {consults.length} consult{consults.length !== 1 ? "s" : ""} ·{" "}
              <span style={{ color: notPreppedCount > 0 ? "var(--urgency-soon)" : "var(--urgency-later)" }}>
                {notPreppedCount} not prepped
              </span>
            </span>
          )}
        </div>
        <Button type="button" onClick={() => setBooking(true)}>+ Book Appt</Button>
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-faint)" }}>
        Consults on the attorneys' boards. Prep each one before the attorney sees the client — the note goes on the client's profile and the appointment.
      </p>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`filter-chip ${range === r.id ? "filter-chip-active" : ""}`}
            aria-pressed={range === r.id}
            onClick={() => setRange(r.id)}
          >
            {r.label}
          </button>
        ))}
        <span style={{ width: 1, height: 18, background: "var(--color-border)" }} />
        {attorneys.map((a) => (
          <PersonChip key={a} name={a} active={attorney === a} onClick={() => pickAttorney(a)} />
        ))}
        {notPreppedCount > 0 && (
          <button
            type="button"
            className="filter-chip"
            onClick={() => setNotPreppedOnly((v) => !v)}
            aria-pressed={notPreppedOnly}
            style={{
              color: "var(--urgency-soon)",
              borderColor: "var(--urgency-soon)",
              background: notPreppedOnly ? "var(--urgency-soon-bg)" : undefined,
            }}
          >
            {notPreppedCount} not prepped
          </button>
        )}
      </div>

      {!data && !error && <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading consults…</div>}
      {error && (
        <div className="text-sm rounded p-3" style={{ color: "var(--urgency-overdue)", background: "var(--urgency-overdue-bg)" }}>
          {error}
        </div>
      )}
      {data && visible.length === 0 && (
        <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          {consults.length === 0 ? "No consults scheduled." : "No consults match the filters."}
        </div>
      )}

      {/* P17.2 — consults by day */}
      {data && visible.length > 0 && (
        <>
          <SectionCode code="P17.2" />
          <div className="flex flex-col gap-4">
            {[...byDay.entries()].map(([day, list]) => (
              <ListSection
                key={day}
                title={day ? dayHeading(day, data.today) : "No date"}
                count={list.length}
                tone={null}
              >
                {list.map((c) => (
                  <ConsultRow
                    key={c.localId}
                    c={c}
                    attorneyActive={attorney === c.attorney}
                    onAttorney={pickAttorney}
                    onPrep={setPrepping}
                    onFocus={openFocus}
                  />
                ))}
              </ListSection>
            ))}
          </div>
        </>
      )}

      {focusError && (
        <div role="alert" className="text-sm rounded p-3 mt-3" style={{ color: "var(--urgency-overdue)", background: "var(--urgency-overdue-bg)" }}>
          {focusError}
        </div>
      )}

      {prepping && (
        <ConsultPrepModal
          consult={prepping}
          onFocus={prepping.date ? () => openFocus(prepping) : undefined}
          onClose={() => setPrepping(null)}
          onSaved={load}
        />
      )}
      {/* After M18 so it stacks on top when opened from inside the prep popup. */}
      {focused && <AppointmentModal entry={focused} onClose={() => setFocused(null)} />}
      {booking && <NewAppointmentModal onClose={() => setBooking(false)} onBooked={load} />}
    </div>
  );
}
