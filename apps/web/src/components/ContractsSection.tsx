import type { ContractSummary, ClientContracts, StatusTone } from "../api";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";
import { getStatusColor } from "../config";

const TONE_STYLES: Record<StatusTone, { bg: string; text: string }> = {
  green: { bg: "var(--color-status-green-bg)", text: "var(--color-status-green)" },
  blue: { bg: "var(--color-status-blue-bg)", text: "var(--color-status-blue)" },
  yellow: { bg: "var(--color-status-yellow-bg)", text: "var(--color-status-yellow)" },
  red: { bg: "var(--color-status-red-bg)", text: "var(--color-status-red)" },
  gray: { bg: "var(--color-status-gray-bg)", text: "var(--color-status-gray)" },
  purple: { bg: "var(--color-status-purple-bg)", text: "var(--color-status-purple)" },
};

function ToneBadge({ label, tone }: { label: string; tone: StatusTone }) {
  const s = TONE_STYLES[tone];
  return (
    <span className="status-pill" style={{ backgroundColor: s.bg, color: s.text }}>
      {label}
    </span>
  );
}

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString("en-US")}`;
}

interface Props {
  contracts: ClientContracts;
}

/**
 * Per-client contract payment history: every contract with its AF/PF, the actual
 * Open Form / Court Case it represents (and that case's live status), the
 * case-oriented contract status, and a paid-to-date total. Pending and unpaid
 * contracts are listed too, visually de-emphasised.
 */
export function ContractsSection({ contracts }: Props) {
  const { active, closed, totals } = contracts;
  if (active.length === 0 && closed.length === 0) return null;

  // Active first (in flight), then settled — one continuous table.
  const rows = [...active, ...closed];

  return (
    <div className="card card-elevated p-5 animate-in animate-in-delay-1">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
        >
          Contracts &amp; Payments
        </h3>
        {/* Paid-to-date summary */}
        <div className="flex items-center gap-4 flex-wrap">
          <Summary label="AF paid" value={money(totals.afPaid)} />
          <Summary label="PF paid" value={money(totals.pfPaid)} />
          <Summary label="Total paid" value={money(totals.totalPaid)} strong />
          <span className="text-[11px]" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            {totals.paidCount} paid of {rows.length}
          </span>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse", fontFamily: "var(--font-body)" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border-light)" }}>
              <Th>Contract</Th>
              <Th>Case</Th>
              <Th right>AF</Th>
              <Th right>PF</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <ContractRow key={c.localId} contract={c} />
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "1px solid var(--color-border)" }}>
              <td className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-faint)" }}>
                Paid to date
              </td>
              <td />
              <Td right strong>{money(totals.afPaid)}</Td>
              <Td right strong>{money(totals.pfPaid)}</Td>
              <td className="px-3 py-2.5 text-sm font-semibold tabular-nums" style={{ color: "var(--color-amber-dark)", fontFamily: "var(--font-mono)" }}>
                {money(totals.totalPaid)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ContractRow({ contract: c }: { contract: ContractSummary }) {
  // Unpaid/pending contracts read lighter so the paid history stands out.
  const paid = c.statusKey === "completed" || c.statusKey === "paid";
  const ink = paid ? "var(--color-ink)" : "var(--color-ink-muted)";

  return (
    <tr style={{ borderBottom: "1px solid var(--color-border-light)" }}>
      <td className="px-3 py-2.5 align-top">
        <div style={{ color: ink, fontWeight: 500 }}>{c.caseType ?? "—"}</div>
        {c.contractId && (
          <div className="text-[11px]" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-mono)" }}>
            {c.contractId}
          </div>
        )}
      </td>

      <td className="px-3 py-2.5 align-top">
        {c.linkedCase ? (
          <div className="flex flex-col gap-1">
            <span style={{ color: ink }}>
              <span className="board-tag mr-1.5">
                {BOARD_DISPLAY_NAMES[c.linkedCase.boardKey] ?? c.linkedCase.boardKey}
              </span>
              {c.linkedCase.status && <CaseStatus status={c.linkedCase.status} />}
            </span>
          </div>
        ) : (
          <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
            {c.goesTo ? `${c.goesTo} · not linked` : "—"}
          </span>
        )}
      </td>

      <td className="px-3 py-2.5 align-top text-right tabular-nums" style={{ color: ink, fontFamily: "var(--font-mono)" }}>
        {money(c.af)}
      </td>
      <td className="px-3 py-2.5 align-top text-right tabular-nums" style={{ color: ink, fontFamily: "var(--font-mono)" }}>
        {money(c.pf)}
      </td>
      <td className="px-3 py-2.5 align-top">
        <ToneBadge label={c.statusLabel} tone={c.tone} />
      </td>
    </tr>
  );
}

/** The linked case's own Monday status, colored by the existing status palette. */
function CaseStatus({ status }: { status: string }) {
  const color = getStatusColor(status) as StatusTone;
  const s = TONE_STYLES[color] ?? TONE_STYLES.gray;
  return (
    <span
      className="text-[11px] px-1.5 py-0.5 rounded"
      style={{ backgroundColor: s.bg, color: s.text, fontFamily: "var(--font-body)" }}
    >
      {status}
    </span>
  );
}

function Summary({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-faint)" }}>
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{
          color: strong ? "var(--color-amber-dark)" : "var(--color-ink)",
          fontFamily: "var(--font-mono)",
          fontSize: strong ? 15 : 13,
          fontWeight: strong ? 700 : 500,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--color-ink-faint)", textAlign: right ? "right" : "left" }}
    >
      {children}
    </th>
  );
}

function Td({ children, right, strong }: { children: React.ReactNode; right?: boolean; strong?: boolean }) {
  return (
    <td
      className="px-3 py-2.5 tabular-nums"
      style={{
        textAlign: right ? "right" : "left",
        color: strong ? "var(--color-ink)" : "var(--color-ink-muted)",
        fontFamily: "var(--font-mono)",
        fontWeight: strong ? 600 : 400,
      }}
    >
      {children}
    </td>
  );
}
