import type { SearchResult, TypedSearchResult } from "../api";
import { BOARD_DISPLAY_NAMES } from "../../lib/query/types";

interface ProfileResultsProps {
  results: SearchResult[];
  onSelect: (localId: string) => void;
}

export function SearchResults({ results, onSelect }: ProfileResultsProps) {
  if (results.length === 0) return null;

  return (
    <div className="card card-elevated overflow-hidden animate-in">
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
            <th
              className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Name
            </th>
            <th
              className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Email
            </th>
            <th
              className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Phone
            </th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr
              key={r.localId}
              onClick={() => onSelect(r.localId)}
              className="result-row"
              style={{
                borderBottom: i < results.length - 1 ? "1px solid var(--color-border-light)" : "none",
                animation: `fadeIn 0.3s ease-out ${i * 0.03}s both`,
              }}
            >
              <td
                className="px-5 py-3 font-medium text-sm"
                style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
              >
                {r.name}
              </td>
              <td
                className="px-5 py-3 text-sm"
                style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}
              >
                {r.email ?? <span style={{ color: "var(--color-ink-faint)" }}>&mdash;</span>}
              </td>
              <td
                className="px-5 py-3 text-sm"
                style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}
              >
                {r.phone ?? <span style={{ color: "var(--color-ink-faint)" }}>&mdash;</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Typed Search Results (contracts, board items)
// =============================================================================

interface TypedResultsProps {
  results: TypedSearchResult[];
  onSelect: (clientLocalId: string) => void;
}

export function TypedSearchResults({ results, onSelect }: TypedResultsProps) {
  if (results.length === 0) return null;

  return (
    <div className="card card-elevated overflow-hidden animate-in">
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
            <th
              className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Name
            </th>
            <th
              className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Status
            </th>
            <th
              className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Client
            </th>
            <th
              className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              Type
            </th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr
              key={r.localId}
              onClick={() => r.clientLocalId && onSelect(r.clientLocalId)}
              className="result-row"
              style={{
                borderBottom: i < results.length - 1 ? "1px solid var(--color-border-light)" : "none",
                animation: `fadeIn 0.3s ease-out ${i * 0.03}s both`,
                cursor: r.clientLocalId ? "pointer" : "default",
              }}
            >
              <td
                className="px-5 py-3 font-medium text-sm"
                style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
              >
                {r.name}
              </td>
              <td className="px-5 py-3 text-sm">
                {r.status ? (
                  <span
                    className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                    style={{
                      backgroundColor: "var(--color-surface-warm)",
                      color: "var(--color-ink-muted)",
                      fontFamily: "var(--font-body)",
                    }}
                  >
                    {r.status}
                  </span>
                ) : (
                  <span style={{ color: "var(--color-ink-faint)" }}>&mdash;</span>
                )}
              </td>
              <td
                className="px-5 py-3 text-sm"
                style={{ color: "var(--color-ink-muted)", fontFamily: "var(--font-body)" }}
              >
                {r.clientName ?? <span style={{ color: "var(--color-ink-faint)" }}>&mdash;</span>}
              </td>
              <td
                className="px-5 py-3 text-xs"
                style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
              >
                {r.boardKey
                  ? (BOARD_DISPLAY_NAMES[r.boardKey] ?? r.boardKey)
                  : r.caseType ?? r.type}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
