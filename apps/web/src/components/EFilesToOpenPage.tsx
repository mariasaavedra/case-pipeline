import { useState, useEffect } from "react";
import { fetchEFilesToOpen } from "../api";
import type { EFilesToOpenResult, EFileToOpen, HirePath, HirePlan } from "../api";
import { ClientLink } from "./ClientPeek";
import { SectionCode } from "./ScreenCode";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { formatDue, Tag, FormChip, ListSection, waitFg } from "./caseBoardParts";
import { GraphConsentRequiredError, getGraphToken, loadLedgerTab, resolveFileLink } from "../sharepoint/graph";
import { LEDGER_URL, checkLedgerTab, followingCaseNo, maxCaseNo, type LedgerCheck } from "../lib/ledger";

// =============================================================================
// P21 E-Files to open
// =============================================================================
// The hire protocol's queue: paid Fee Ks (Contract Stage "Paid needs action" or
// "Open E FILE") waiting for the person who opens E-Files. Each row opens M30,
// the plan — path, case number, folder, Monday changes, ledger row — checked
// live against the ledger and the consult folder in SharePoint.
// Phase 1: shows the plan only, writes nothing. See docs/features/consult-to-efile.md.

const PATHS: { id: HirePath; title: string; note: string }[] = [
  { id: "efile", title: "New E-File", note: "Case number, E-File, ledger row" },
  { id: "court", title: "New court E-File", note: "Plus NTA, FILINGS & RESPONSES - COURT, TRIAL FILE" },
  { id: "existing", title: "Already has an E-File", note: "Consult files move into it" },
  { id: "foia", title: "FOIA", note: "Consult folder moves to FOIA, no case number" },
];

/** Days since hire: 0–2 fresh, 3–6 waiting, 7+ late. An E-File is a same-week job. */
function ageLevel(days: number | null): "fresh" | "waiting" | "late" | "unknown" {
  if (days === null) return "unknown";
  return days >= 7 ? "late" : days >= 3 ? "waiting" : "fresh";
}

function Row({ item, onOpen }: { item: EFileToOpen; onOpen: () => void }) {
  const { plan } = item;
  const level = ageLevel(item.daysWaiting);
  return (
    <li
      className="grid gap-x-4 gap-y-1.5 px-4 py-3 items-center grid-cols-1 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.6fr)_8rem_minmax(0,1fr)_7rem]"
      style={{ borderTop: "1px solid var(--color-border-light)", boxShadow: `inset 3px 0 0 ${waitFg(level)}` }}
    >
      <div className="min-w-0">
        {item.clientLocalId ? (
          <ClientLink clientId={item.clientLocalId} className="font-medium hover:underline truncate block" style={{ color: "var(--color-ink)" }}>
            {item.clientName}
          </ClientLink>
        ) : (
          <span className="font-medium truncate block" style={{ color: "var(--color-ink)" }}>{item.clientName}</span>
        )}
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-xs" style={{ color: "var(--color-ink-faint)" }}>
          <span>{item.contractStage}</span>
          {plan.blockers.length > 0 && <Tag color="critical">Blocked</Tag>}
          {plan.blockers.length === 0 && plan.warnings.length > 0 && (
            <Tag color="missing" title={plan.warnings.join("\n")}>{plan.warnings.length} to check</Tag>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {item.feeKTypes.length > 0 ? item.feeKTypes.map((t) => <FormChip key={t} label={t} />) : (
          <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>No Fee K Type</span>
        )}
        {item.itWillGoTo && <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>→ {item.itWillGoTo}</span>}
      </div>

      <div className="text-sm whitespace-nowrap">
        {item.hireDate ? (
          <>
            <span style={{ color: "var(--color-ink-muted)" }}>Hired {formatDue(item.hireDate)}</span>
            <span className="ml-1.5 font-semibold" style={{ color: waitFg(level) }}>{item.daysWaiting}d</span>
          </>
        ) : (
          <span style={{ color: "var(--color-ink-faint)" }}>No hire date</span>
        )}
      </div>

      <div className="text-xs min-w-0 truncate" style={{ color: "var(--color-ink-muted)" }} title={plan.newFolderPath ?? undefined}>
        {plan.caseNo ? <span className="font-semibold">{plan.caseNo}{plan.caseNoIsNew ? " (next free)" : ""}</span> : "No case number"}
      </div>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={onOpen}>
          See plan
        </Button>
      </div>
    </li>
  );
}

// =============================================================================
// M30 — the plan, checked live in SharePoint
// =============================================================================

type Live<T> = { state: "loading" } | { state: "ok"; value: T } | { state: "consent" } | { state: "error"; message: string };

function useLive<T>(load: (() => Promise<T>) | null, retry: number): Live<T> | null {
  const [live, setLive] = useState<Live<T> | null>(null);
  useEffect(() => {
    if (!load) {
      setLive(null);
      return;
    }
    let cancelled = false;
    setLive({ state: "loading" });
    load()
      .then((value) => !cancelled && setLive({ state: "ok", value }))
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof GraphConsentRequiredError) setLive({ state: "consent" });
        else setLive({ state: "error", message: e instanceof Error ? e.message : "Couldn't read SharePoint" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on retry
  }, [retry]);
  return live;
}

/** The plan with the case number the ledger allows (it may be ahead of Monday). */
function withCaseNo(plan: HirePlan, caseNo: string | null): HirePlan {
  if (!plan.caseNoIsNew || !plan.caseNo || !caseNo || caseNo === plan.caseNo) return plan;
  const from = plan.caseNo;
  return {
    ...plan,
    caseNo,
    newFolderPath: plan.newFolderPath?.replace(from, caseNo) ?? null,
    ledgerRow: plan.ledgerRow ? { ...plan.ledgerRow, caseNo } : null,
    mondayChanges: plan.mondayChanges.map((c) => (c.column === "Case No." ? { ...c, to: caseNo.replace("-", "") } : c)),
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-3" style={{ borderTop: "1px solid var(--color-border-light)" }}>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--color-ink-faint)" }}>{title}</h3>
      <div className="text-sm" style={{ color: "var(--color-ink)" }}>{children}</div>
    </div>
  );
}

function ConsentButton({ onDone }: { onDone: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        getGraphToken(true).then(onDone).catch(() => {});
      }}
    >
      Connect SharePoint
    </Button>
  );
}

function PlanModal({ item, highestOnMonday, onClose }: { item: EFileToOpen; highestOnMonday: string | null; onClose: () => void }) {
  const [retry, setRetry] = useState(0);
  const base = item.plan;
  const ledger = useLive<LedgerCheck & { webUrl: string }>(
    base.ledgerTab && base.caseNo
      ? async () => {
          const tab = await loadLedgerTab(LEDGER_URL, base.ledgerTab!);
          return { ...checkLedgerTab(tab.values, base.caseNo!.slice(0, 2)), webUrl: tab.webUrl };
        }
      : null,
    retry,
  );
  const consult = useLive<{ name: string; webUrl: string; count: number | null }>(
    item.consultFileUrl
      ? async () => {
          const { item: folder } = await resolveFileLink(item.consultFileUrl!);
          return { name: folder.name, webUrl: folder.webUrl, count: folder.folder?.childCount ?? null };
        }
      : null,
    retry,
  );

  // The number: one past the highest on Monday, the E-File folders AND the ledger.
  const ledgerHighest = ledger?.state === "ok" ? ledger.value.highest : null;
  const highest = maxCaseNo(highestOnMonday, ledgerHighest);
  const caseNo = base.caseNoIsNew && highest ? followingCaseNo(highest) : base.caseNo;
  const plan = withCaseNo(base, caseNo);
  const ledgerAhead = !!(ledgerHighest && base.caseNo && ledgerHighest >= base.caseNo);
  const needsConsent = ledger?.state === "consent" || consult?.state === "consent";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent code="M30" className="gap-0 p-0 sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="gap-0.5 px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Open E-File — {item.clientName}</DialogTitle>
          <DialogDescription>{plan.pathReason}. What it would do, nothing is changed yet.</DialogDescription>
        </DialogHeader>

        {needsConsent && (
          <div className="px-5 py-3 flex items-center gap-3 text-sm" style={{ borderTop: "1px solid var(--color-border-light)", background: "var(--urgency-missing-bg)" }}>
            <span>SharePoint access is needed to check the ledger and the consult folder.</span>
            <ConsentButton onDone={() => setRetry((r) => r + 1)} />
          </div>
        )}

        {(plan.blockers.length > 0 || plan.warnings.length > 0) && (
          <Section title="Before it can run">
            <ul className="space-y-1">
              {plan.blockers.map((b) => (
                <li key={b} style={{ color: "var(--urgency-critical)" }}>⛔ {b}</li>
              ))}
              {plan.warnings.map((w) => (
                <li key={w} style={{ color: "var(--urgency-overdue)" }}>⚠ {w}</li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Case number">
          {!plan.caseNo && "None (FOIA hire)"}
          {plan.caseNo && !plan.caseNoIsNew && <>Keeps <b>{plan.caseNo}</b></>}
          {plan.caseNo && plan.caseNoIsNew && (
            <>
              <b>{plan.caseNo}</b>, the next free number
              <div className="text-xs mt-1" style={{ color: "var(--color-ink-faint)" }}>
                Highest on Monday + E-File folders: {highestOnMonday ?? "none this year"} · in the ledger:{" "}
                {ledger?.state === "ok" ? (ledger.value.highest ?? "none this year") : ledger?.state === "loading" ? "checking…" : ledger?.state === "error" ? `couldn't read (${ledger.message})` : "not checked"}
              </div>
              {ledgerAhead && (
                <div className="text-xs mt-1" style={{ color: "var(--urgency-overdue)" }}>
                  The ledger is ahead of Monday ({ledgerHighest}: {ledger?.state === "ok" ? ledger.value.highestRow.slice(1, 2).join("") : ""}), so the number moved up.
                </div>
              )}
              {ledger?.state === "ok" && ledger.value.duplicates.length > 0 && (
                <div className="text-xs mt-1" style={{ color: "var(--urgency-overdue)" }}>
                  Used twice in the ledger: {ledger.value.duplicates.join(", ")}
                </div>
              )}
            </>
          )}
        </Section>

        <Section title="SharePoint">
          <ul className="space-y-1.5">
            {plan.newFolderPath && (
              <li>
                Create <b>SCAL E-Files / {plan.newFolderPath}</b>
                <div className="flex flex-wrap gap-1 mt-1">
                  {plan.subfolders.map((s) => <FormChip key={s} label={s} />)}
                </div>
              </li>
            )}
            {plan.consultFilesTo && (
              <li>
                Consult folder{" "}
                {consult?.state === "ok" ? (
                  <a href={consult.value.webUrl} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--color-amber-dark)" }}>
                    {consult.value.name} ↗
                  </a>
                ) : (
                  <span style={{ color: "var(--color-ink-muted)" }}>{item.consultFolderPath ?? "(from the profile link)"}</span>
                )}
                {consult?.state === "ok" && consult.value.count !== null && (
                  <span style={{ color: "var(--color-ink-muted)" }}> · {consult.value.count} item{consult.value.count === 1 ? "" : "s"}</span>
                )}
                {consult?.state === "error" && (
                  <span style={{ color: "var(--urgency-overdue)" }}> · couldn't open it ({consult.message})</span>
                )}
                <div style={{ color: "var(--color-ink-muted)" }}>→ {plan.consultFilesTo}</div>
                {plan.deletesConsultFolder && (
                  <div style={{ color: "var(--color-ink-muted)" }}>then the consult folder is deleted (SharePoint recycle bin, 93 days)</div>
                )}
              </li>
            )}
            {!plan.newFolderPath && !plan.consultFilesTo && <li style={{ color: "var(--color-ink-faint)" }}>Nothing</li>}
          </ul>
        </Section>

        <Section title="Monday">
          <table className="w-full text-xs">
            <tbody>
              {plan.mondayChanges.map((c) => (
                <tr key={`${c.item}·${c.column}`} style={{ borderTop: "1px solid var(--color-border-light)" }}>
                  <td className="py-1 pr-2 align-top whitespace-nowrap" style={{ color: "var(--color-ink-muted)" }}>{c.item}</td>
                  <td className="py-1 pr-2 align-top whitespace-nowrap font-medium">{c.column}</td>
                  <td className="py-1 pr-2 align-top max-w-[12rem] truncate" style={{ color: "var(--color-ink-faint)", textDecoration: c.from ? "line-through" : undefined }} title={c.from ?? undefined}>
                    {c.from ?? "empty"}
                  </td>
                  <td className="py-1 align-top">{c.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Ledger">
          {plan.ledgerRow ? (
            <>
              New row in the <b>{plan.ledgerTab}</b> tab
              {ledger?.state === "ok" && (
                <a href={ledger.value.webUrl} target="_blank" rel="noreferrer" className="ml-1.5 text-xs hover:underline" style={{ color: "var(--color-amber-dark)" }}>
                  open ledger ↗
                </a>
              )}
              <div className="mt-1 text-xs grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-0.5">
                <span style={{ color: "var(--color-ink-faint)" }}>Case No.</span><span>{plan.ledgerRow.caseNo}</span>
                <span style={{ color: "var(--color-ink-faint)" }}>Name</span><span>{plan.ledgerRow.name}</span>
                <span style={{ color: "var(--color-ink-faint)" }}>Date Opened</span><span>{formatDue(plan.ledgerRow.dateOpened)}</span>
                <span style={{ color: "var(--color-ink-faint)" }}>Case Type</span><span>{plan.ledgerRow.caseType || "—"}</span>
                <span style={{ color: "var(--color-ink-faint)" }}>Information</span><span>{plan.ledgerRow.information || "—"}</span>
              </div>
            </>
          ) : (
            <span style={{ color: "var(--color-ink-faint)" }}>No row ({plan.path === "foia" ? "FOIA hire" : "keeps their number"})</span>
          )}
        </Section>

        <div className="px-5 py-3 flex items-center justify-end gap-3" style={{ borderTop: "1px solid var(--color-border-light)" }}>
          <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Running it comes next. For now, open the E-File by hand as usual.</span>
          <Button type="button" disabled title="Not built yet">
            Open E-File
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Page
// =============================================================================

export function EFilesToOpenPage() {
  const [data, setData] = useState<EFilesToOpenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<EFileToOpen | null>(null);

  useEffect(() => {
    fetchEFilesToOpen()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const items = data?.items ?? [];
  const late = items.filter((i) => ageLevel(i.daysWaiting) === "late").length;
  const blocked = items.filter((i) => i.plan.blockers.length > 0).length;

  return (
    <div>
      {/* P21.1 — header */}
      <SectionCode code="P21.1" />
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          E-Files to open
        </h1>
        {data && (
          <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {items.length} waiting
            {late > 0 && <> · <span style={{ color: waitFg("late") }}>{late} a week or more</span></>}
            {blocked > 0 && <> · <span style={{ color: "var(--urgency-critical)" }}>{blocked} blocked</span></>}
            {" "}· next free number {data.nextCaseNo} (before the ledger check)
          </span>
        )}
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-faint)" }}>
        Paid Fee Ks at Contract Stage "Paid needs action" or "Open E FILE", oldest hire first. "See plan" shows what opening the E-File
        would do: case number, folders, Monday changes, ledger row. Nothing is changed from this page yet.
      </p>

      {!data && !error && <div className="text-sm" style={{ color: "var(--color-ink-muted)" }}>Loading…</div>}
      {error && (
        <div className="text-sm rounded p-3" style={{ color: "var(--urgency-overdue)", background: "var(--urgency-overdue-bg)" }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* P21.2 — queue by path */}
          <SectionCode code="P21.2" />
          <div className="space-y-4">
            {items.length === 0 && (
              <div className="card p-8 text-center text-sm" style={{ color: "var(--color-ink-faint)" }}>
                No paid Fee Ks are waiting for an E-File.
              </div>
            )}
            {PATHS.map((p) => {
              const inPath = items.filter((i) => i.plan.path === p.id);
              if (inPath.length === 0) return null;
              return (
                <ListSection key={p.id} title={p.title} count={inPath.length} tone={null} note={p.note}>
                  {inPath.map((i) => (
                    <Row key={i.feeKLocalId} item={i} onOpen={() => setOpen(i)} />
                  ))}
                </ListSection>
              );
            })}
          </div>
        </>
      )}

      {open && data && <PlanModal item={open} highestOnMonday={data.highestCaseNo?.caseNo ?? null} onClose={() => setOpen(null)} />}
    </div>
  );
}
