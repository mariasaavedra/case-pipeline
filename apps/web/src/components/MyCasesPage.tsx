// =============================================================================
// P6 My Cases
// =============================================================================
// A paralegal's own work in the two places it waits, in workflow order:
//   P6.2 Prescheduling — Paid Fee Ks waiting for the client's documents,
//        grouped by PS Stage, coloured by days since hire (30 / 60).
//   P6.3 Open Forms    — Open Forms / Court Forms, grouped by Status, most
//        urgent group first.
// Defaults to the user's linked board name; the switcher (D38) shows another
// paralegal's cases or everyone's. A row opens the case card (M27): status,
// dates, E-File, note. Data = GET /api/my-cases (libs/query/src/my-cases.ts).
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from "react";
import { getMyCases } from "../api";
import type { MyCasesResult, MyOpenForm, MyPreschedulingCase, StatusColumnOption, Urgency } from "../api";
import { navigate } from "../router";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { SectionCode } from "./ScreenCode";
import { FormChip, ListSection, Tag, formatDue, waitFg } from "./caseBoardParts";
import { CaseCardModal, type CaseCard } from "./CaseCardModal";
import { ChecklistCount } from "./UploadChecklistSection";

const NORTH_POLE = "Send to North Pole";
const NO_STAGE = "No stage";
const ALL = "all";
const STORAGE_KEY = "p6.paralegal";

const URGENCY_META: Record<Urgency, { label: string; tone: string | null }> = {
  overdue: { label: "Overdue", tone: "overdue" },
  critical: { label: "Due ≤ 3 days", tone: "critical" },
  soon: { label: "Due ≤ 7 days", tone: "soon" },
  later: { label: "Later", tone: "later" },
  none: { label: "No target date", tone: null },
};
const URGENCY_RANK: Record<Urgency, number> = { overdue: 0, critical: 1, soon: 2, later: 3, none: 4 };

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function store(value: string | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private window: the choice just isn't remembered */
  }
}

/** Cases grouped by a key, groups in the given order. */
function groupBy<T>(items: T[], keyOf: (t: T) => string, order: (a: string, b: string, groups: Map<string, T[]>) => number) {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  return [...groups.entries()].sort(([a], [b]) => order(a, b, groups));
}

function EFileLink({ url }: { url: string | null }) {
  if (!url) {
    return <span className="text-xs" style={{ color: "var(--color-ink-faint)" }} title="No E-File link — open the case to add one">No E-File</span>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      className="text-xs font-medium hover:underline whitespace-nowrap" style={{ color: "var(--color-ink-muted)" }}
      title="Open the client's E-File folder in SharePoint">
      📁 E-File ↗
    </a>
  );
}

function rowProps(open: () => void, label: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `Open ${label}`,
    onClick: open,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    },
  };
}

// =============================================================================
// Rows
// =============================================================================

function PreschedulingRow({ c, showPeople, onOpen }: { c: MyPreschedulingCase; showPeople: boolean; onOpen: () => void }) {
  return (
    <li
      {...rowProps(onOpen, c.clientName)}
      className="result-row grid gap-x-4 gap-y-1 px-4 py-2.5 items-center cursor-pointer grid-cols-1 md:grid-cols-[minmax(0,2fr)_9rem_minmax(0,1.3fr)_6rem]"
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${waitFg(c.waitLevel)}` }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{c.clientName}</span>
          {c.notCooperating && <Tag color="overdue" title="Reminder sent and no evidence received since">Not cooperating</Tag>}
          {c.itWillGoTo?.toLowerCase().includes("court") && <Tag color="court" title={`It will go to: ${c.itWillGoTo}`}>Court</Tag>}
          {c.parked && <Tag color="snooze">{c.northPoleUntil ? `❄ back ${formatDue(c.northPoleUntil)}` : "❄ no return date"}</Tag>}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {c.contractFor.map((f) => <FormChip key={f} label={f} />)}
          {showPeople && (
            <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>{c.paralegals.join(", ") || "Unassigned"}</span>
          )}
        </div>
      </div>
      <div className="text-sm whitespace-nowrap">
        {c.hireDate && c.daysWaiting !== null ? (
          <>
            <span style={{ color: "var(--color-ink-muted)" }}>Hired {formatDue(c.hireDate)}</span>
            <span className="ml-1.5 font-semibold" style={{ color: waitFg(c.waitLevel) }}>{c.daysWaiting}d</span>
          </>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>No hire date</span>
        )}
      </div>
      <div className="text-xs leading-5 min-w-0" style={{ color: c.notCooperating ? "var(--urgency-overdue)" : "var(--color-ink-muted)" }}>
        {c.reminderSentOn ? `Reminder ${formatDue(c.reminderSentOn)}` : "No reminder yet"}
        {c.evidenceReceivedOn && <span style={{ color: "var(--color-ink-faint)" }}> · Evidence {formatDue(c.evidenceReceivedOn)}</span>}
        {c.documents && <ChecklistCount documents={c.documents} />}
      </div>
      <div className="md:text-right"><EFileLink url={c.eFile} /></div>
    </li>
  );
}

function OpenFormRow({ c, showPeople, onOpen }: { c: MyOpenForm; showPeople: boolean; onOpen: () => void }) {
  const meta = URGENCY_META[c.urgency];
  const fg = meta.tone ? `var(--urgency-${meta.tone})` : "var(--color-ink-faint)";
  return (
    <li
      {...rowProps(onOpen, c.clientName)}
      className="result-row grid gap-x-4 gap-y-1 px-4 py-2.5 items-center cursor-pointer grid-cols-1 md:grid-cols-[minmax(0,2fr)_9rem_minmax(0,1.3fr)_6rem]"
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${fg}` }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{c.clientName}</span>
          {c.isCourtCase && <Tag color="court">Court</Tag>}
          {c.urgent && <Tag color="overdue">Urgent</Tag>}
          {c.parked && <Tag color="snooze">{c.northPoleUntil ? `❄ back ${formatDue(c.northPoleUntil)}` : "❄ no return date"}</Tag>}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {c.forms.length > 0 ? c.forms.map((f) => <FormChip key={f} label={f} />) : (
            <span className="text-xs truncate" style={{ color: "var(--color-ink-faint)" }}>{c.formName}</span>
          )}
          {showPeople && (
            <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>{c.assignees.join(", ") || "Unassigned"}</span>
          )}
        </div>
      </div>
      <div className="text-sm whitespace-nowrap">
        {c.targetDate ? (
          <>
            <span style={{ color: "var(--color-ink-muted)" }}>Target {formatDue(c.targetDate)}</span>
            {c.daysUntilTarget !== null && (
              <span className="ml-1.5 font-semibold" style={{ color: fg }}>
                {c.daysUntilTarget < 0 ? `${-c.daysUntilTarget}d late` : `${c.daysUntilTarget}d`}
              </span>
            )}
          </>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>No target date</span>
        )}
      </div>
      <div className="text-xs leading-5 min-w-0" style={{ color: "var(--color-ink-muted)" }}>
        {c.formsApptDate ? `Forms appt ${formatDue(c.formsApptDate)}` : "No forms appt"}
        {c.formsSentDate && <span style={{ color: "var(--color-ink-faint)" }}> · Sent {formatDue(c.formsSentDate)}</span>}
      </div>
      <div className="md:text-right"><EFileLink url={c.eFile} /></div>
    </li>
  );
}

// =============================================================================
// Page
// =============================================================================

export function MyCasesPage() {
  const [data, setData] = useState<MyCasesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // undefined = the caller's own (server default); "all" = everyone; else a name.
  const [who, setWho] = useState<string | undefined>(() => readStored() ?? undefined);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [card, setCard] = useState<CaseCard | null>(null);

  const load = useCallback(
    (quiet = false) => {
      if (!quiet) setLoading(true);
      return getMyCases(who, showSnoozed)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    },
    [who, showSnoozed],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const pick = (v: string) => {
    // Picking your own name = the default, so it follows a later Settings change.
    const value = data?.paralegalLink && v.toLowerCase() === data.paralegalLink.toLowerCase() ? undefined : v;
    setWho(value);
    store(value ?? null);
  };

  const showPeople = !!data && data.selected === null;
  const selectValue = data ? (data.selected ?? ALL) : (who ?? "");
  const switcherItems = useMemo(
    () => [
      ...(data?.paralegals ?? []).map((p) => ({ value: p, label: data?.paralegalLink?.toLowerCase() === p.toLowerCase() ? `${p} (me)` : p })),
      { value: ALL, label: "Everyone" },
    ],
    [data],
  );

  const stageGroups = useMemo(() => {
    if (!data) return [];
    const rank = (s: string) => (s === NORTH_POLE ? 1e6 : s === NO_STAGE ? 1e5 : (data.stageOrder.indexOf(s) + 1 || 1e4));
    return groupBy(data.prescheduling, (c) => c.psStage ?? NO_STAGE, (a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [data]);
  const statusGroups = useMemo(() => {
    if (!data) return [];
    const worst = (cs: MyOpenForm[]) => Math.min(...cs.map((c) => URGENCY_RANK[c.urgency]));
    return groupBy(data.openForms, (c) => c.status ?? "No status", (a, b, g) =>
      (a === NORTH_POLE ? 1 : 0) - (b === NORTH_POLE ? 1 : 0) || worst(g.get(a)!) - worst(g.get(b)!) || g.get(b)!.length - g.get(a)!.length);
  }, [data]);

  const colorOf = (options: StatusColumnOption[], label: string) => options.find((o) => o.label === label)?.color ?? undefined;
  const notCooperating = data?.prescheduling.filter((c) => c.notCooperating).length ?? 0;
  const overdue = data?.openForms.filter((c) => c.urgency === "overdue").length ?? 0;
  const whose = data?.selected ?? "everyone";

  return (
    <div style={{ maxWidth: "1040px", margin: "0 auto" }}>
      <div className="flex items-end gap-3 flex-wrap mb-5">
        <div className="min-w-0">
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "22px", fontWeight: 600, color: "var(--color-ink)", marginBottom: "4px" }}>
            My Cases
          </h1>
          <p className="text-[13px]" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            {data
              ? `${data.prescheduling.length} in Prescheduling · ${data.openForms.length} in Open Forms — ${whose === "everyone" ? "everyone's" : `${whose}'s`} cases. Click one to change status, dates or E-File.`
              : "Your Prescheduling and Open Forms cases."}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {data && (
            <Select items={switcherItems} value={selectValue} onValueChange={(v) => v && pick(v)}>
              <SelectTrigger size="sm" className={`min-w-44 bg-secondary text-[13px] ${data.selected !== data.paralegalLink ? "border-primary bg-primary/6" : ""}`} aria-label="Whose cases">
                <SelectValue />
              </SelectTrigger>
              <SelectContent code="D38">
                {switcherItems.map((i) => (
                  <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {error && (
        <div className="text-[13px] rounded-lg px-3.5 py-2.5 mb-4" style={{ background: "var(--color-status-red-bg)", color: "var(--color-status-red)", border: "1px solid rgba(153,27,27,0.15)" }}>
          {error}
        </div>
      )}
      {loading && !data && <div className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading…</div>}

      {data && (
        <>
          <SectionCode code="P6.1" />
          {data.needsLink && (
            <div className="card flex items-center gap-3 flex-wrap px-4 py-3 mb-4">
              <span className="text-sm" style={{ color: "var(--color-ink)" }}>
                Link your board name in Settings and this page opens on your own cases.
              </span>
              <Button size="sm" className="ml-auto" onClick={() => navigate("/settings")}>Go to Settings</Button>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap mb-4 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {notCooperating > 0 && <Tag color="overdue">{notCooperating} not cooperating</Tag>}
            {overdue > 0 && <Tag color="overdue">{overdue} past target date</Tag>}
            {data.snoozedCount > 0 && (
              <button type="button" className="hover:underline" style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}
                onClick={() => setShowSnoozed((s) => !s)}>
                {showSnoozed ? `Hide ${data.snoozedCount} parked in North Pole` : `Show ${data.snoozedCount} parked in North Pole`}
              </button>
            )}
          </div>

          {/* P6.2 Prescheduling */}
          <SectionCode code="P6.2" />
          <h2 className="text-sm font-semibold mb-2 mt-1" style={{ color: "var(--color-ink)", fontFamily: "var(--font-display)" }}>
            Prescheduling <span style={{ color: "var(--color-ink-faint)", fontWeight: 400 }}>· Paid Fee Ks waiting for documents · {data.prescheduling.length}</span>
          </h2>
          <div className="space-y-3 mb-7">
            {stageGroups.length === 0 && (
              <p className="card px-4 py-3 text-sm" style={{ color: "var(--color-ink-faint)" }}>Nothing in Prescheduling.</p>
            )}
            {stageGroups.map(([stage, cases]) => (
              <ListSection key={stage} title={stage} count={cases.length} tone={null} color={colorOf(data.psStages, stage)}>
                {cases.map((c) => (
                  <PreschedulingRow key={c.localId} c={c} showPeople={showPeople} onOpen={() => setCard({ kind: "fee_k", c })} />
                ))}
              </ListSection>
            ))}
          </div>

          {/* P6.3 Open Forms */}
          <SectionCode code="P6.3" />
          <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--color-ink)", fontFamily: "var(--font-display)" }}>
            Open Forms <span style={{ color: "var(--color-ink-faint)", fontWeight: 400 }}>· Open Forms + Court Forms · {data.openForms.length}</span>
          </h2>
          <div className="space-y-3">
            {statusGroups.length === 0 && (
              <p className="card px-4 py-3 text-sm" style={{ color: "var(--color-ink-faint)" }}>Nothing in Open Forms.</p>
            )}
            {statusGroups.map(([status, cases]) => (
              <ListSection key={status} title={status} count={cases.length} tone={null} color={colorOf(data.openFormStatuses, status)}>
                {cases.map((c) => (
                  <OpenFormRow key={c.localId} c={c} showPeople={showPeople} onOpen={() => setCard({ kind: "open_form", c })} />
                ))}
              </ListSection>
            ))}
          </div>
        </>
      )}

      {card && data && (
        <CaseCardModal
          card={card}
          statuses={card.kind === "fee_k" ? data.psStages : data.openFormStatuses}
          onChanged={() => void load(true)}
          onClose={() => setCard(null)}
        />
      )}
    </div>
  );
}
