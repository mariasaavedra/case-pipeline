// =============================================================================
// P4 Appointments — "My Day", one attorney's appointments for one day
// =============================================================================
//
// Built for the attorney, not the front desk (P17 is reception's view across
// attorneys). Three columns:
//
//   P4.4 the day        — one row per appointment: time, client, type, Prepped,
//                         and a tag (Next / Needs outcome / the outcome).
//   P4.5 the client     — tabs: Consult prep (M18's card + what the client
//                         wrote + their file), Notes (the timeline), Documents
//                         (the SharePoint e-file / consult folder browser).
//   P4.6 after consult  — outcome buttons (the board's own status labels),
//                         consult note (E&A "Consult note" on the profile),
//                         and + New contract (M11, client already picked).
//
// It opens on the signed-in attorney's board (Settings → Users → Attorney
// board, else matched by name); the board tabs switch to another attorney.
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { fetchMyDay, changeBoardItemStatus, postConsultNote } from "../api";
import type { MyDayResult, MyDayEntry } from "../api";
import { Link } from "./Link";
import { UpdatesTimeline } from "./UpdatesTimeline";
import { DocumentsTab } from "./DocumentsTab";
import { NewContractModal } from "./NewContractModal";
import { clientPath } from "../router";
import { SectionCode } from "./ScreenCode";
import { StatusEditor } from "./StatusEditor";
import { useBoardStatusOptions } from "../StatusOptionsProvider";
import { useAuth } from "../auth/useAuth";
import {
  formatTime, formatLongDate, addDays, rowStates, nowLineIndex, defaultSelection, outcomeLabels,
  fileKind, prepStamp, isHttpUrl, detaineeReason, summaryLine, layoutFor, firstName, type RowState, type Layout,
} from "../lib/my-day";

// =============================================================================
// URL + remembered board
// =============================================================================

const BOARD_PREF = "my-day-board";
/** How often P4 re-reads the day, so reception's prep shows without a reload. */
const REFRESH_MS = 60_000;

function urlParam(key: string): string | null {
  return new URL(window.location.href).searchParams.get(key);
}

function syncUrl(board: string | null, date: string | null) {
  const url = new URL(window.location.href);
  if (board) url.searchParams.set("board", board); else url.searchParams.delete("board");
  if (date) url.searchParams.set("date", date); else url.searchParams.delete("date");
  const next = url.pathname + url.search;
  if (window.location.pathname + window.location.search !== next) window.history.replaceState(null, "", next);
}

function remembered(): string | null {
  try { return localStorage.getItem(BOARD_PREF); } catch { return null; }
}
function remember(board: string | null) {
  try {
    if (board) localStorage.setItem(BOARD_PREF, board); else localStorage.removeItem(BOARD_PREF);
  } catch { /* private window */ }
}

/** "HH:MM" now, re-read every minute so rows move from Next to Needs outcome. */
function useClock(): string {
  const read = () => new Date().toTimeString().slice(0, 5);
  const [now, setNow] = useState(read);
  useEffect(() => {
    const t = setInterval(() => setNow(read()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * The page's own width, not the window's: the sidebar (open, collapsed or
 * hidden on a phone) changes how much room the columns really have.
 */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number | null] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// =============================================================================
// Small pieces
// =============================================================================

const card = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 16,
} as const;

const eyebrow = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  color: "var(--color-ink-muted)",
  fontFamily: "var(--font-body)",
};

const TAG: Record<RowState | "status", { bg: string; fg: string }> = {
  done: { bg: "var(--color-status-green-bg)", fg: "var(--color-status-green)" },
  "needs-outcome": { bg: "var(--color-amber-light)", fg: "var(--color-amber-dark)" },
  next: { bg: "var(--color-amber)", fg: "#ffffff" },
  later: { bg: "transparent", fg: "var(--color-ink-muted)" },
  status: { bg: "var(--color-surface-warm)", fg: "var(--color-ink-muted)" },
};

function Mini({ children, bg, fg, border }: { children: React.ReactNode; bg: string; fg: string; border?: boolean }) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap"
      style={{
        height: 22, padding: "0 8px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: bg, color: fg,
        border: border ? "1px solid var(--color-border)" : "none", fontFamily: "var(--font-body)",
      }}
    >
      {children}
    </span>
  );
}

function Pill({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "purple" | "red" | "amber" }) {
  const colors = {
    plain: { bg: "var(--color-surface-warm)", fg: "var(--color-ink)" },
    purple: { bg: "var(--color-status-purple-bg)", fg: "var(--color-status-purple)" },
    red: { bg: "var(--color-status-red-bg)", fg: "var(--color-status-red)" },
    amber: { bg: "var(--color-amber-light)", fg: "var(--color-amber-dark)" },
  }[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ minHeight: 34, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 500, background: colors.bg, color: colors.fg, fontFamily: "var(--font-body)" }}
    >
      {children}
    </span>
  );
}

function rowTag(entry: MyDayEntry, state: RowState): { label: string; bg: string; fg: string; border?: boolean } {
  if (state === "done") return { label: entry.status ?? "Done", ...TAG.done };
  if (state === "needs-outcome") return { label: "Needs outcome", ...TAG["needs-outcome"] };
  if (state === "next") return { label: "Next", ...TAG.next };
  return { label: entry.status ?? "Later", ...TAG.later, border: true };
}

// =============================================================================
// P4.4 — the day
// =============================================================================

function DayList({
  entries, states, nowAt, now, selected, onSelect,
}: {
  entries: MyDayEntry[]; states: RowState[]; nowAt: number; now: string; selected: string | null; onSelect: (id: string) => void;
}) {
  const nowLabel = formatTime(now).full;
  const nowLine = (
    <div className="flex items-center gap-2.5" style={{ padding: "6px 16px", background: "var(--color-status-yellow-bg)" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--color-amber)" }}>{nowLabel}</span>
      <div style={{ flex: 1, height: 2, background: "var(--color-amber)", borderRadius: 2 }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-amber)", fontFamily: "var(--font-body)" }}>now</span>
    </div>
  );
  return (
    <div style={{ ...card, overflow: "hidden" }}>
      {entries.map((e, i) => {
        const t = formatTime(e.time);
        const state = states[i]!;
        const tag = rowTag(e, state);
        const isSel = e.localId === selected;
        // Where they're detained is on the Detained tag and the client panel, not here too.
        const type = e.prep?.apptType.split(" — ")[0] ?? e.language ?? null;
        return (
          <div key={e.localId}>
            {i === nowAt && nowLine}
            <button
              type="button"
              onClick={() => onSelect(e.localId)}
              aria-current={isSel ? "true" : undefined}
              className="w-full flex items-start gap-3 text-left transition-colors"
              style={{
                padding: "14px 16px",
                border: "none",
                borderBottom: "1px solid var(--color-border-light)",
                background: isSel ? "var(--color-amber-light)" : "var(--color-card)",
                boxShadow: isSel ? "inset 4px 0 0 var(--color-amber)" : "none",
                opacity: state === "done" && !isSel ? 0.6 : 1,
                cursor: "pointer",
                color: "var(--color-ink)",
              }}
            >
              <div className="flex flex-col flex-none" style={{ width: 56 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>{t.clock}</span>
                <span style={{ fontSize: 12, color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>{t.ampm}</span>
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-0.5" style={{ fontFamily: "var(--font-body)" }}>
                <span className="truncate" style={{ fontSize: 15, fontWeight: 600 }}>{e.profile?.name ?? e.name}</span>
                {type && <span className="truncate" style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>{type}{e.prep ? ` · ${e.prep.method}` : ""}</span>}
                <span className="flex flex-wrap gap-1.5 mt-1">
                  {e.prep
                    ? <Mini bg="var(--color-status-green-bg)" fg="var(--color-status-green)">Prepped</Mini>
                    : <Mini bg="var(--color-status-gray-bg)" fg="var(--color-ink-muted)">Not prepped</Mini>}
                  <Mini bg={tag.bg} fg={tag.fg} border={tag.border}>{tag.label}</Mini>
                  {detaineeReason(e) && <Mini bg="var(--color-status-red-bg)" fg="var(--color-status-red)">Detained</Mini>}
                </span>
              </div>
            </button>
          </div>
        );
      })}
      {nowAt === entries.length && nowLine}
    </div>
  );
}

/**
 * P4.4 on a tablet: the day as a narrow column of times (with a first name and
 * a dot for done / needs outcome), so the client and the actions get the room.
 */
function DayRail({
  entries, states, nowAt, selected, onSelect,
}: {
  entries: MyDayEntry[]; states: RowState[]; nowAt: number; selected: string | null; onSelect: (id: string) => void;
}) {
  const dot: Record<RowState, string> = {
    done: "var(--color-status-green)", "needs-outcome": "var(--color-amber)", next: "var(--color-amber)", later: "var(--color-border)",
  };
  const nowMark = <div aria-hidden="true" style={{ height: 2, margin: "2px 8px", background: "var(--color-amber)", borderRadius: 2 }} />;
  return (
    <nav aria-label="Appointments" className="flex flex-col gap-1" style={{ ...card, padding: 6 }}>
      {entries.map((e, i) => {
        const t = formatTime(e.time);
        const on = e.localId === selected;
        const state = states[i]!;
        const first = firstName(e.profile?.name ?? e.name);
        return (
          <div key={e.localId}>
            {i === nowAt && nowMark}
            <button type="button" onClick={() => onSelect(e.localId)} aria-current={on ? "true" : undefined}
              aria-label={`${t.full} ${e.profile?.name ?? e.name}${state === "needs-outcome" ? ", needs outcome" : ""}${detaineeReason(e) ? ", detained" : ""}`}
              className="w-full flex flex-col items-center gap-0.5"
              style={{
                padding: "10px 4px", borderRadius: 10, cursor: "pointer", border: "none",
                background: on ? "var(--color-amber)" : "transparent", color: on ? "#ffffff" : "var(--color-ink)",
                opacity: state === "done" && !on ? 0.6 : 1,
              }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600 }}>{t.clock}</span>
              <span style={{ fontSize: 11, opacity: 0.85 }}>{t.ampm}</span>
              <span className="truncate" style={{ maxWidth: "100%", fontSize: 12, fontWeight: 500 }}>{first}</span>
              <span className="flex gap-1" aria-hidden="true">
                <span style={{ width: 8, height: 8, borderRadius: 4, background: on ? "#ffffff" : dot[state] }} />
                {detaineeReason(e) && <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--color-status-red)" }} />}
              </span>
            </button>
          </div>
        );
      })}
      {nowAt === entries.length && nowMark}
    </nav>
  );
}

// =============================================================================
// P4.5 — the client
// =============================================================================

type Tab = "prep" | "notes" | "docs";

function ClientPanel({ entry, tab, setTab }: { entry: MyDayEntry; tab: Tab; setTab: (t: Tab) => void }) {
  const t = formatTime(entry.time);
  const prep = entry.prep;
  const docs = prep?.documents ?? [];
  const detained = detaineeReason(entry);
  // Each fact once: type in the subtitle, how / interpreter / detention as pills.
  const type = prep ? prep.apptType.split(" — ")[0] : null;
  const zoom = prep?.method === "Zoom" && isHttpUrl(prep.methodDetail) ? prep.methodDetail : null;
  const phone = prep?.method === "Phone" ? prep.methodDetail : entry.phone;
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "prep", label: "Consult prep" },
    { id: "notes", label: `Notes (${entry.updates.length})` },
    { id: "docs", label: "E-file / Consult file" },
  ];

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="flex flex-col gap-3" style={{ padding: "20px 20px 0" }}>
        <div className="flex flex-wrap justify-between items-start gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <span style={{ fontSize: 13, color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>
              {t.full}{type ? ` · ${type}` : ""}
            </span>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 26, lineHeight: 1.2, overflowWrap: "anywhere" }}>
              {entry.profile?.name ?? entry.name}
            </span>
          </div>
          {entry.profile && (
            <Link href={clientPath(entry.profile.localId)}
              className="inline-flex items-center gap-1.5 flex-none"
              style={{ height: 40, padding: "0 14px", borderRadius: 10, background: "var(--color-surface-warm)", border: "1px solid var(--color-border)", color: "var(--color-ink)", textDecoration: "none", fontSize: 14, fontWeight: 500, fontFamily: "var(--font-body)" }}>
              Open full file
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
            </Link>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {zoom ? (
            <a href={zoom} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5"
              style={{ minHeight: 34, padding: "0 12px", borderRadius: 999, background: "var(--color-status-blue)", color: "var(--color-card)", textDecoration: "none", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-body)" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="1.5" y="4" width="9" height="8" rx="1.5" /><path d="M10.5 7l4-2.5v7l-4-2.5" /></svg>
              Join Zoom
            </a>
          ) : prep?.method === "Zoom" && <Pill>Zoom (no link yet)</Pill>}
          {phone && <Pill><span style={{ fontFamily: "var(--font-mono)" }}>{phone}</span></Pill>}
          {prep?.method === "Other" && prep.methodDetail && <Pill>{prep.methodDetail}</Pill>}
          {prep
            ? <Pill tone={prep.interpreterNeeded ? "purple" : "plain"}>{prep.interpreterNeeded ? `Interpreter: ${prep.interpreter}` : "No interpreter"}</Pill>
            : entry.language && <Pill>{entry.language}</Pill>}
          {detained && <Pill tone="red">{detained}</Pill>}
          {entry.sameDayCount > 0 && <Pill tone="amber">Booked {entry.sameDayCount + 1}× today</Pill>}
        </div>

        <div role="tablist" className="flex gap-1 overflow-x-auto" style={{ borderBottom: "1px solid var(--color-border)", margin: "4px -20px 0", padding: "0 20px", scrollbarWidth: "none" }}>
          {tabs.map((x) => {
            const on = tab === x.id;
            return (
              <button key={x.id} type="button" role="tab" aria-selected={on} onClick={() => setTab(x.id)}
                style={{
                  height: 44, padding: "0 12px", border: "none", background: "transparent", cursor: "pointer", flex: "none",
                  whiteSpace: "nowrap", fontSize: 14, fontWeight: 600, marginBottom: -1, fontFamily: "var(--font-body)",
                  color: on ? "var(--color-ink)" : "var(--color-ink-muted)",
                  borderBottom: `2px solid ${on ? "var(--color-amber)" : "transparent"}`,
                }}>
                {x.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "prep" && (
        <div className="flex flex-col gap-5" style={{ padding: "20px 24px 24px", fontFamily: "var(--font-body)" }}>
          {prep ? (
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "8px 16px", background: "var(--color-surface-warm)", fontSize: 12, color: "var(--color-ink-muted)" }}>
                {prepStamp(prep.at, prep.author)}{prep.pending ? " · still syncing to Monday" : ""}
              </div>
              {prep.description && <PrepBlock label="Description (reception)" text={prep.description} />}
              {entry.clientWrote && <PrepBlock label="Client wrote (Calendly)" text={`“${entry.clientWrote}”`} italic warm />}
              {!prep.description && !entry.clientWrote && (
                <p style={{ margin: 0, padding: "14px 16px", fontSize: 14, color: "var(--color-ink-muted)" }}>Reception left no description.</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1" style={{ border: "1px dashed var(--color-border)", borderRadius: 14, padding: "18px 16px" }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>Reception hasn't prepped this one yet</span>
              <span style={{ fontSize: 14, color: "var(--color-ink-muted)" }}>Their description, type of appointment, method and interpreter show here once they do (Receptionists → Prep).</span>
              {entry.clientWrote && <p style={{ margin: "8px 0 0", fontSize: 14, fontStyle: "italic" }}>Client wrote: “{entry.clientWrote}”</p>}
              {!entry.clientWrote && entry.description && <p style={{ margin: "8px 0 0", fontSize: 14 }}>{entry.description}</p>}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span style={eyebrow}>Documents</span>
            {docs.length === 0 ? (
              <span style={{ fontSize: 14, color: "var(--color-ink-muted)" }}>
                {prep ? "Reception didn't pick any documents for this consult." : "Documents reception picks during prep show here."}
                {entry.profile ? " The client's folders are under E-file / Consult file." : ""}
              </span>
            ) : (
              <div style={{ border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
                {docs.map((d, i) => (
                  <a key={d.url} href={d.url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-3 transition-colors hover:bg-[var(--color-surface-warm)]"
                    style={{ padding: "12px 14px", borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)", color: "var(--color-ink)", textDecoration: "none" }}>
                    <span className="inline-flex items-center justify-center flex-none"
                      style={{ width: 40, height: 28, borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", background: "var(--color-surface-warm)", color: "var(--color-ink-muted)" }}>
                      {fileKind(d.name)}
                    </span>
                    <span className="flex-1 min-w-0 truncate" style={{ fontSize: 14, fontWeight: 500 }}>{d.name}</span>
                    <span style={{ fontSize: 12, color: "var(--color-ink-muted)", whiteSpace: "nowrap" }}>Open ↗</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "notes" && (
        <div style={{ padding: "12px 24px 24px" }}>
          {entry.updates.length === 0
            ? <p style={{ fontSize: 14, color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>No notes yet for this client.</p>
            : <UpdatesTimeline updates={entry.updates} />}
        </div>
      )}

      {tab === "docs" && (
        <div style={{ padding: "12px 24px 24px" }}>
          {entry.profile
            ? <DocumentsTab data={entry.caseSummary ?? { profile: entry.profile }} />
            : <p style={{ fontSize: 14, color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}>No client profile, so no folders to show.</p>}
        </div>
      )}
    </div>
  );
}

function PrepBlock({ label, text, italic, warm }: { label: string; text: string; italic?: boolean; warm?: boolean }) {
  return (
    <div className="flex flex-col gap-1" style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border-light)", background: warm ? "var(--color-surface)" : undefined }}>
      <span style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>{label}</span>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-line", fontStyle: italic ? "italic" : "normal" }}>{text}</p>
    </div>
  );
}

// =============================================================================
// P4.6 — after the consult
// =============================================================================

function AfterConsult({
  entry, note, setNote, onStatusChanged, contract, onContract,
}: {
  entry: MyDayEntry;
  note: string;
  setNote: (v: string) => void;
  onStatusChanged: (status: string) => void;
  contract: { name: string; pending: boolean } | null;
  onContract: () => void;
}) {
  const options = useBoardStatusOptions(entry.boardKey);
  const detained = detaineeReason(entry);
  const buttons = useMemo(() => outcomeLabels(options?.options.map((o) => o.label) ?? [], !!detained), [options, detained]);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // A different appointment starts clean.
  useEffect(() => { setMsg(null); }, [entry.localId]);

  const hired = /^(det )?hire$/i.test(entry.status ?? "");

  // An outcome button is a shortcut for the status picker: it writes at once.
  const setOutcome = async (label: string) => {
    if (label === entry.status) return;
    setStatusBusy(label);
    setMsg(null);
    try {
      const r = await changeBoardItemStatus(entry.localId, label);
      onStatusChanged(label);
      setMsg({ ok: true, text: `Status set to ${label}.${r.pending ? " Monday was slow, so it's queued and will go through shortly." : ""}` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't change the status" });
    } finally {
      setStatusBusy(null);
    }
  };

  const saveNote = async () => {
    if (!note.trim()) {
      setMsg({ ok: false, text: "Write the consult note first." });
      return;
    }
    if (!entry.profile) {
      setMsg({ ok: false, text: "This appointment isn't linked to a client profile, so the note has nowhere to go." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const r = await postConsultNote(entry.localId, note.trim());
      setNote("");
      setMsg({
        ok: true,
        text: [
          "Consult note logged on the profile (shows in Notes after the next sync).",
          r.pending ? "Monday was slow, so it's queued and will go through shortly." : null,
          summaryLine(r.summary),
        ].filter(Boolean).join(" "),
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save the note" });
    } finally {
      setSaving(false);
    }
  };

  const btn = (on: boolean) => ({
    minHeight: 44, padding: "8px 10px", borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: "pointer",
    fontFamily: "var(--font-body)",
    background: on ? "var(--color-ink)" : "var(--color-card)",
    color: on ? "var(--color-card)" : "var(--color-ink)",
    border: `1px solid ${on ? "var(--color-ink)" : "var(--color-border)"}`,
  });

  return (
    <div className="flex flex-col gap-4" style={{ ...card, padding: "22px 22px 24px", fontFamily: "var(--font-body)" }}>
      <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600 }}>After the consult</span>

      {detained && (
        <div role="note" className="flex flex-col gap-0.5"
          style={{ borderRadius: 10, padding: "10px 12px", background: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Detainee consult</span>
          <span style={{ fontSize: 13 }}>Hire and No Hire are recorded as Det Hire / Det No Hire.</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span style={{ fontSize: 14, fontWeight: 600 }}>Status</span>
          {/* D6 — every label on this board, in Monday's colors; writes at once. */}
          <StatusEditor
            key={entry.localId}
            boardKey={entry.boardKey}
            boardItemLocalId={entry.localId}
            status={entry.status}
            onChanged={onStatusChanged}
          />
        </div>
        {!options ? (
          <span style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>This board's statuses haven't synced yet, so the status can't be changed here.</span>
        ) : buttons.length > 0 && (
          <>
            <span style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>Quick outcome</span>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              {buttons.map((l) => (
                <button key={l} type="button" aria-pressed={entry.status === l} disabled={statusBusy !== null}
                  onClick={() => setOutcome(l)} style={{ ...btn(entry.status === l), opacity: statusBusy && statusBusy !== l ? 0.6 : 1 }}>
                  {statusBusy === l ? "Saving…" : l}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="p4-consult-note" style={{ fontSize: 14, fontWeight: 600 }}>Consult note</label>
        <textarea
          id="p4-consult-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={5000}
          placeholder="What did you discuss? What happens next?"
          style={{ minHeight: 140, resize: "vertical", border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, fontSize: 15, lineHeight: 1.5, color: "var(--color-ink)", background: "var(--color-card)", fontFamily: "var(--font-body)" }}
        />
        <span style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>Logged on the client's profile as a Consult note.</span>
      </div>

      <button type="button" onClick={saveNote} disabled={saving}
        style={{ height: 46, border: "none", borderRadius: 10, background: "var(--color-amber)", color: "#ffffff", fontSize: 15, fontWeight: 600, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.7 : 1 }}>
        {saving ? "Saving…" : "Save consult note"}
      </button>
      {msg && (
        <div role={msg.ok ? "status" : "alert"}
          style={{ borderRadius: 10, padding: "10px 12px", fontSize: 14, lineHeight: 1.45, background: msg.ok ? "var(--color-status-green-bg)" : "var(--color-status-red-bg)", color: msg.ok ? "var(--color-status-green)" : "var(--color-status-red)" }}>
          {msg.text}
        </div>
      )}

      <div style={{ height: 1, background: "var(--color-border-light)" }} />

      <div className="flex flex-col gap-2">
        <span style={{ fontSize: 14, fontWeight: 600 }}>Contract</span>
        {contract ? (
          <div className="flex flex-col gap-1" style={{ border: "1px solid var(--color-status-green)", background: "var(--color-status-green-bg)", borderRadius: 10, padding: 12, color: "var(--color-status-green)" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{contract.pending ? "Contract queued" : "Contract created"}: {contract.name}</span>
            <Link href="/contracts" style={{ fontSize: 13, fontWeight: 500, color: "var(--color-status-green)" }}>Open Contracts</Link>
          </div>
        ) : (
          <>
            <button type="button" onClick={onContract} disabled={!entry.profile}
              style={{ ...btn(hired), height: 46, fontSize: 15, fontWeight: 600, cursor: entry.profile ? "pointer" : "not-allowed", opacity: entry.profile ? 1 : 0.5 }}>
              + New contract
            </button>
            <span style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>
              {!entry.profile
                ? "Link this appointment to a client profile first."
                : hired ? "Hired — start their Fee K now." : "Opens the New contract form with this client already picked."}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Page
// =============================================================================

export function AppointmentsPage() {
  const { user } = useAuth();
  const now = useClock();
  const [board, setBoard] = useState<string | null>(() => urlParam("board") ?? remembered());
  const [date, setDate] = useState<string | null>(() => urlParam("date"));
  const [data, setData] = useState<MyDayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("prep");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [contracts, setContracts] = useState<Record<string, { name: string; pending: boolean }>>({});
  const [contractFor, setContractFor] = useState<MyDayEntry | null>(null);
  const [pageRef, pageWidth] = useWidth<HTMLDivElement>();
  const layout: Layout = layoutFor(pageWidth);
  /** On a phone the day and the client are two screens; this is "showing the client". */
  const [phoneDetail, setPhoneDetail] = useState(false);

  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  /** `quiet` = a background refresh: no dimming, and a failure keeps what's shown. */
  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      // An unknown remembered board falls back server-side; the page shows
      // whichever board came back (data.boardKey), not the one asked for.
      setData(await fetchMyDay(board ?? undefined, date ?? undefined));
      setUpdatedAt(new Date());
      if (quiet) setError(null);
    } catch (e) {
      if (!quiet) setError((e as Error).message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [board, date]);

  useEffect(() => { load(); }, [load]);

  // In step with Receptionists (P17/M18): both read the same prep records and
  // appointment rows, so what reception preps, edits or reschedules shows here
  // within a minute — and at once when the attorney comes back to the tab. The
  // selected client, open tab and any half-written note are kept.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    const t = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  useEffect(() => {
    if (!data) return;
    // Only a board other than the caller's own, and a day other than today, go in the URL.
    const shown = data.boardKey;
    syncUrl(shown && shown !== data.myBoard ? shown : null, date && date !== data.today ? date : null);
    // Remembered only for staff with no board of their own: an attorney who
    // peeks at a colleague's day still opens on their own next time.
    remember(data.myBoard ? null : shown);
  }, [data, date]);

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const day = date ?? today;
  const entries = useMemo(() => data?.entries ?? [], [data]);
  const states = useMemo(() => rowStates(entries, today, now), [entries, today, now]);
  const nowAt = nowLineIndex(entries, today, now);

  // Keep a valid selection: the next one up after a load, or when the old one is gone.
  useEffect(() => {
    if (!entries.some((e) => e.localId === selected)) setSelected(defaultSelection(entries, states));
  }, [entries, states, selected]);

  const entry = entries.find((e) => e.localId === selected) ?? null;
  const clientScreen = layout === "narrow" && phoneDetail && !!entry;
  const boardMeta = data?.boards.find((b) => b.boardKey === data.boardKey) ?? null;
  const mine = !!data?.boardKey && data.boardKey === data.myBoard;
  const firstName = (user?.name ?? "").split(/\s+/)[0] ?? "";
  const hour = parseInt(now.slice(0, 2), 10);
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const title = mine
    ? `${greeting}${firstName ? `, ${firstName}` : ""}`
    : boardMeta ? `${boardMeta.attorneyName ?? `Attorney ${boardMeta.displayName}`}’s day` : "Appointments";

  const needs = states.filter((s) => s === "needs-outcome").length;
  const doneCount = states.filter((s) => s === "done").length;
  const nextIdx = states.indexOf("next");
  const next = nextIdx === -1 ? null : entries[nextIdx]!;
  const summary = entries.length === 0
    ? "Nothing on the calendar."
    : [
        `${entries.length} appointment${entries.length === 1 ? "" : "s"}`,
        next ? `next: ${next.profile?.name ?? next.name} at ${formatTime(next.time).full}` : null,
        needs ? `${needs} still need${needs === 1 ? "s" : ""} an outcome` : null,
      ].filter(Boolean).join(" · ");

  const updateStatus = (localId: string, status: string | null) => {
    setData((d) => d && { ...d, entries: d.entries.map((e) => (e.localId === localId ? { ...e, status } : e)) });
  };

  const navBtn = {
    width: 40, height: 40, border: "none", background: "transparent", borderRadius: 8, color: "var(--color-ink-muted)", cursor: "pointer",
  } as const;

  return (
    <div ref={pageRef} className="animate-in" style={{ fontFamily: "var(--font-body)", color: "var(--color-ink)" }}>
      {/* On a phone with a client open, the client gets the whole screen. */}
      {!clientScreen && (
        <>
        {/* P4.1 — header */}
        <SectionCode code="P4.1" />
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div className="flex flex-col gap-1">
            <span style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>{formatLongDate(day)}{day === today ? "" : day < today ? " (past)" : ""}</span>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 32, letterSpacing: "-0.01em" }}>{title}</h1>
            <span style={{ fontSize: 15, color: "var(--color-ink-muted)" }}>{loading && !data ? "Loading…" : summary}</span>
            {updatedAt && (
              <span style={{ fontSize: 12, color: "var(--color-ink-faint)" }} title="Refreshes every minute, so reception's prep shows here without reloading">
                Updated {updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · stays in step with Receptionists
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1" style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 4 }}>
              <button type="button" aria-label="Previous day" style={navBtn} onClick={() => setDate(addDays(day, -1))}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
              </button>
              <button type="button" onClick={() => setDate(null)}
                style={{ height: 40, padding: "0 14px", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: "pointer", background: day === today ? "var(--color-amber-light)" : "transparent", color: day === today ? "var(--color-amber-dark)" : "var(--color-ink)" }}>
                Today
              </button>
              <button type="button" aria-label="Next day" style={navBtn} onClick={() => setDate(addDays(day, 1))}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
              </button>
              <input type="date" aria-label="Pick a date" value={day} onChange={(e) => e.target.value && setDate(e.target.value)}
                style={{ height: 40, border: "none", background: "transparent", color: "var(--color-ink-muted)", fontSize: 13, padding: "0 6px", fontFamily: "var(--font-body)" }} />
            </div>
            {data && data.boards.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Attorney calendar">
                {data.boards.map((b) => {
                  const on = b.boardKey === data.boardKey;
                  return (
                    <button key={b.boardKey} type="button" aria-pressed={on} title={b.attorneyName ?? undefined}
                      onClick={() => setBoard(b.boardKey)}
                      style={{
                        height: 40, padding: "0 14px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer",
                        background: on ? "var(--color-ink)" : "var(--color-card)", color: on ? "var(--color-card)" : "var(--color-ink)",
                        border: `1px solid ${on ? "var(--color-ink)" : "var(--color-border)"}`,
                      }}>
                      {b.displayName}{b.boardKey === data.myBoard ? " (you)" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {entries.length > 0 && (
          <div className="flex items-center gap-1.5 mb-5" aria-label={`${doneCount} of ${entries.length} done`}>
            {states.map((s, i) => (
              <div key={entries[i]!.localId} style={{ height: 8, flex: "1 1 0", maxWidth: 72, borderRadius: 4, background: s === "done" ? "var(--color-status-green)" : s === "needs-outcome" ? "var(--color-amber)" : "var(--color-border)" }} />
            ))}
            <span style={{ marginLeft: 8, fontSize: 13, color: "var(--color-ink-muted)", whiteSpace: "nowrap" }}>{doneCount} of {entries.length} done</span>
          </div>
        )}

        {data && !data.myBoard && data.boards.length > 0 && (
          <p style={{ fontSize: 13, color: "var(--color-ink-muted)", marginBottom: 12 }}>
            Showing {boardMeta?.displayName ?? "an attorney"}’s calendar. An admin can make one open by default for you in Settings → Users → Attorney board.
          </p>
        )}
        </>
      )}

      {error && (
        <div role="alert" style={{ ...card, padding: 16, color: "var(--color-status-red)", background: "var(--color-status-red-bg)", marginBottom: 16 }}>
          Couldn't load appointments: {error}
        </div>
      )}

      {data && data.boards.length === 0 && (
        <div style={{ ...card, padding: "48px 24px", textAlign: "center" }}>
          <p style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: 0 }}>No attorney boards set up</p>
          <p style={{ fontSize: 14, color: "var(--color-ink-muted)" }}>An admin adds them in Settings → Attorney boards.</p>
        </div>
      )}

      {data && data.boards.length > 0 && entries.length === 0 && !loading && (
        <div style={{ ...card, padding: "56px 24px", textAlign: "center" }}>
          <p style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: 0 }}>No appointments {day === today ? "today" : "this day"}</p>
          <p style={{ fontSize: 14, color: "var(--color-ink-muted)", marginTop: 6 }}>Use the arrows to look at another day.</p>
        </div>
      )}

      {entries.length > 0 && (() => {
        const select = (id: string) => {
          setSelected(id);
          if (layout === "narrow") {
            setPhoneDetail(true);
            pageRef.current?.scrollIntoView?.({ block: "start" });
          }
        };
        const client = entry && (
          <div style={{ minWidth: 0 }}>
            <SectionCode code="P4.5" />
            <ClientPanel entry={entry} tab={tab} setTab={setTab} />
          </div>
        );
        const after = entry && (
          <div style={{ minWidth: 0 }}>
            <SectionCode code="P4.6" />
            <AfterConsult
              entry={entry}
              note={notes[entry.localId] ?? ""}
              setNote={(v) => setNotes((n) => ({ ...n, [entry.localId]: v }))}
              onStatusChanged={(status) => updateStatus(entry.localId, status)}
              contract={contracts[entry.localId] ?? null}
              onContract={() => setContractFor(entry)}
            />
          </div>
        );
        const dim = { opacity: loading ? 0.6 : 1, transition: "opacity 0.15s" };

        if (layout === "narrow") {
          return phoneDetail && entry ? (
            <div className="flex flex-col gap-4" style={dim}>
              <button type="button" onClick={() => setPhoneDetail(false)}
                className="inline-flex items-center gap-1.5 self-start"
                style={{ height: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-ink)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
                All appointments
              </button>
              {client}
              {after}
            </div>
          ) : (
            <div style={dim}>
              <SectionCode code="P4.4" />
              <DayList entries={entries} states={states} nowAt={nowAt} now={now} selected={selected} onSelect={select} />
            </div>
          );
        }

        return (
          <div className="grid items-start gap-4" style={{
            ...dim,
            gridTemplateColumns: layout === "wide"
              ? "minmax(250px, 320px) minmax(0, 1fr) minmax(290px, 360px)"
              : "92px minmax(0, 1fr) minmax(270px, 320px)",
          }}>
            <div style={{ minWidth: 0 }}>
              <SectionCode code="P4.4" />
              {layout === "wide"
                ? <DayList entries={entries} states={states} nowAt={nowAt} now={now} selected={selected} onSelect={select} />
                : <DayRail entries={entries} states={states} nowAt={nowAt} selected={selected} onSelect={select} />}
            </div>
            {client}
            {after}
          </div>
        );
      })()}

      {contractFor?.profile && (
        <NewContractModal
          profileLocalId={contractFor.profile.localId}
          clientName={contractFor.profile.name}
          onClose={() => setContractFor(null)}
          onCreated={(c) => setContracts((m) => ({ ...m, [contractFor.localId]: c }))}
        />
      )}
    </div>
  );
}
