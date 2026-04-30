import { useState, useEffect, useRef } from "react";
import { fetchClientRelationships } from "../api";
import type { RelationshipWithDetails } from "../api";
import { BOARD_DISPLAY_NAMES } from "@case-pipeline/query/types";
import { StatusBadge } from "./StatusBadge";

interface Props {
  profileLocalId: string;
}

export function RelationsView({ profileLocalId }: Props) {
  const [relationships, setRelationships] = useState<RelationshipWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    fetchClientRelationships(profileLocalId)
      .then(setRelationships)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [profileLocalId]);

  if (loading) {
    return (
      <div className="space-y-3 animate-in">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-lg loading-shimmer" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="px-4 py-3 rounded-lg text-sm animate-in"
        style={{
          backgroundColor: "var(--color-status-red-bg)",
          color: "var(--color-status-red)",
          border: "1px solid rgba(153,27,27,0.15)",
          fontFamily: "var(--font-body)",
        }}
      >
        Failed to load relationships: {error}
      </div>
    );
  }

  if (relationships.length === 0) {
    return (
      <div className="py-16 text-center animate-in">
        <p
          className="text-sm"
          style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
        >
          No item relationships found for this client.
        </p>
      </div>
    );
  }

  // Group by relationship type
  const grouped = new Map<string, RelationshipWithDetails[]>();
  for (const r of relationships) {
    const list = grouped.get(r.relationshipType) ?? [];
    list.push(r);
    grouped.set(r.relationshipType, list);
  }

  return (
    <div className="space-y-5 animate-in">
      {[...grouped.entries()].map(([type, rels]) => (
        <div key={type}>
          <div className="section-divider mb-3">
            <span
              className="text-[11px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
            >
              {type}
            </span>
          </div>
          <div className="space-y-2">
            {rels.map((r, i) => (
              <div
                key={`${r.sourceLocalId}-${r.targetLocalId}-${i}`}
                className="card px-4 py-3 flex items-center gap-3"
              >
                {/* Source */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm font-medium truncate"
                      style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
                    >
                      {r.sourceName ?? r.sourceLocalId}
                    </span>
                    {r.sourceBoardKey && (
                      <span className="board-tag" style={{ fontSize: 10 }}>
                        {BOARD_DISPLAY_NAMES[r.sourceBoardKey] ?? r.sourceBoardKey}
                      </span>
                    )}
                  </div>
                  {r.sourceStatus && <StatusBadge status={r.sourceStatus} />}
                </div>

                {/* Arrow */}
                <svg
                  width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5"
                  className="flex-shrink-0"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>

                {/* Target */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm font-medium truncate"
                      style={{ color: "var(--color-ink)", fontFamily: "var(--font-body)" }}
                    >
                      {r.targetName ?? r.targetLocalId}
                    </span>
                    {r.targetBoardKey && (
                      <span className="board-tag" style={{ fontSize: 10 }}>
                        {BOARD_DISPLAY_NAMES[r.targetBoardKey] ?? r.targetBoardKey}
                      </span>
                    )}
                  </div>
                  {r.targetStatus && <StatusBadge status={r.targetStatus} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
