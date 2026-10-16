import { useEffect, useMemo, useState } from "react";
import { fetchWorkload, fetchStaff, STAFF_ROLE_LABEL } from "../api";
import type { WorkloadResult, WorkloadPerson, WorkloadItem, WorkloadSource, WorkloadLevel, StaffMember, StaffRole } from "../api";
import { ClientLink } from "./ClientPeek";
import { SectionCode } from "./ScreenCode";
import { Tag, ListSection } from "./caseBoardParts";
import { navigate } from "../router";
import { itemLabel } from "./OffboardingPanel";

// =============================================================================
// P20 Workload — open work per person
// =============================================================================
// One row per person: open items across Open Forms (P5), Prescheduling (P13),
// Pending Fee Ks (P14), Court cases (P15) and FOIAs (P19), each counted the way
// its own page counts it (North Pole left out). Busiest-with-critical first.
// Two cards on top catch what falls through: work with nobody on it, and work
// held only by someone who left (fix: Settings → Staff → Offboard).
// Names resolve through the staff roster, so two spellings are one person.
// API = GET /api/workload (libs/query/src/workload.ts).

const SOURCES: { id: WorkloadSource; label: string; path: string; color: string }[] = [
  { id: "open_forms", label: "Open Forms", path: "/active-cases", color: "var(--urgency-later)" },
  { id: "prescheduling", label: "Prescheduling", path: "/prescheduling", color: "var(--urgency-soon)" },
  { id: "contracts", label: "Fee Ks", path: "/contracts", color: "var(--color-amber)" },
  { id: "court_cases", label: "Court", path: "/court-cases", color: "var(--urgency-court)" },
  { id: "foias", label: "FOIAs", path: "/foias", color: "var(--urgency-snooze)" },
];
const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s])) as Record<WorkloadSource, (typeof SOURCES)[number]>;

const LEVEL_TONE: Record<WorkloadLevel, string | null> = { critical: "overdue", warning: "missing", ok: null };

type RoleFilter = "all" | StaffRole | "unknown";

export function WorkloadPage() {
  const [data, setData] = useState<WorkloadResult | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<RoleFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(true);

  useEffect(() => {
    fetchWorkload().then(setData).catch((e: Error) => setError(e.message));
    fetchStaff().then((r) => setStaff(r.staff)).catch(() => {});
  }, []);

  const rolesById = useMemo(() => new Map(staff.map((s) => [s.id, s.roles])), [staff]);
  const people = useMemo(() => {
    if (!data) return [];
    return data.people.filter((p) => {
      if (!showInactive && !p.active) return false;
      if (role === "all") return true;
      if (role === "unknown") return p.staffId === null;
      return p.staffId !== null && (rolesById.get(p.staffId) ?? []).includes(role);
    });
  }, [data, role, rolesById, showInactive]);
  const maxTotal = Math.max(1, ...people.map((p) => p.total));

  if (error) return <div className="max-w-6xl mx-auto px-6 py-8 text-sm" style={{ color: "var(--color-status-red)" }}>{error}</div>;
  if (!data) return <div className="max-w-6xl mx-auto px-6 py-8 text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading workload…</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold flex items-center" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          Workload<SectionCode code="P20" inline />
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-ink-faint)" }}>
          Open work per person across Open Forms, Prescheduling, Fee Ks, Court and FOIAs — counted the way each page counts it.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2 mb-5">
        <GapCard
          id="unassigned"
          title="No one assigned"
          note="Nobody in the paralegal column (attorney for Fee Ks)"
          items={data.unassigned}
          open={open === "unassigned"}
          onToggle={() => setOpen(open === "unassigned" ? null : "unassigned")}
        />
        <GapCard
          id="inactive"
          title="Held only by inactive staff"
          note="Reassign from Settings → Staff → Offboard"
          items={data.inactiveAssignee}
          open={open === "inactive"}
          onToggle={() => setOpen(open === "inactive" ? null : "inactive")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <select
          aria-label="Filter by role"
          value={role}
          onChange={(e) => setRole(e.target.value as RoleFilter)}
          className="px-2 py-1 rounded-md border"
          style={{ borderColor: "var(--color-border)", background: "var(--color-card)", color: "var(--color-ink)" }}
        >
          <option value="all">Everyone</option>
          {(Object.keys(STAFF_ROLE_LABEL) as StaffRole[]).map((r) => (
            <option key={r} value={r}>{STAFF_ROLE_LABEL[r]}</option>
          ))}
          <option value="unknown">Not in the roster</option>
        </select>
        <label className="flex items-center gap-1.5" style={{ color: "var(--color-ink-muted)" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive staff
        </label>
        <span className="flex flex-wrap gap-3 ml-auto text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {SOURCES.map((s) => (
            <span key={s.id} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </span>
      </div>

      <section className="card overflow-hidden">
        {people.length === 0 && (
          <p className="px-4 py-3 text-sm" style={{ color: "var(--color-ink-faint)" }}>No one matches this filter.</p>
        )}
        <ul>
          {people.map((p, i) => {
            const key = p.staffId !== null ? `s${p.staffId}` : `n${p.name}`;
            return (
              <PersonRow
                key={key}
                p={p}
                first={i === 0}
                maxTotal={maxTotal}
                roles={p.staffId !== null ? rolesById.get(p.staffId) ?? [] : null}
                open={open === key}
                onToggle={() => setOpen(open === key ? null : key)}
              />
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function PersonRow({
  p, first, maxTotal, roles, open, onToggle,
}: {
  p: WorkloadPerson;
  first: boolean;
  maxTotal: number;
  roles: StaffRole[] | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li style={{ borderTop: first ? "none" : "1px solid var(--color-border-light)", opacity: p.active ? 1 : 0.75 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left grid gap-x-4 gap-y-1.5 px-4 py-3 items-center grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_10rem]"
        style={{ boxShadow: p.critical > 0 ? "inset 3px 0 0 var(--urgency-overdue)" : undefined }}
      >
        <div className="min-w-0">
          <div className="font-medium truncate flex items-center gap-1.5" style={{ color: "var(--color-ink)" }}>
            {p.name}
            {!p.active && <Tag color="overdue">inactive</Tag>}
            {p.staffId === null && <Tag color="missing" title="No staff record matches this name — see Settings → Staff">not in roster</Tag>}
          </div>
          <div className="text-xs truncate" style={{ color: "var(--color-ink-faint)" }}>
            {roles && roles.length > 0 ? roles.map((r) => STAFF_ROLE_LABEL[r]).join(", ") : roles ? "No role set" : p.boardNames.join(", ")}
          </div>
        </div>

        {/* Stacked bar by source; width relative to the busiest person shown. */}
        <div className="flex h-3 rounded overflow-hidden" style={{ width: `${(p.total / maxTotal) * 100}%`, minWidth: 6, background: "var(--color-surface-warm)" }}
          aria-label={SOURCES.filter((s) => p.bySource[s.id]).map((s) => `${p.bySource[s.id]} ${s.label}`).join(", ")}
          role="img"
        >
          {SOURCES.map((s) =>
            p.bySource[s.id] ? (
              <span key={s.id} title={`${p.bySource[s.id]} ${s.label}`} style={{ flex: p.bySource[s.id], background: s.color }} />
            ) : null,
          )}
        </div>

        <div className="flex items-center gap-2 md:justify-end text-sm tabular-nums">
          {p.critical > 0 && <Tag color="overdue" title="Overdue / late / behind">{p.critical} critical</Tag>}
          {p.warning > 0 && <Tag color="missing" title="Coming up / waiting / at risk">{p.warning}</Tag>}
          <span className="font-semibold" style={{ color: "var(--color-ink)" }}>{p.total}</span>
        </div>
      </button>
      {open && (
        <ul className="pb-2" style={{ background: "var(--color-surface-warm)" }}>
          {p.items.map(({ item, columns }) => (
            <ItemRow key={`${item.source}:${item.localId}`} item={item} note={columns.join(" + ")} />
          ))}
        </ul>
      )}
    </li>
  );
}

function GapCard({
  id, title, note, items, open, onToggle,
}: {
  id: string;
  title: string;
  note: string;
  items: WorkloadItem[];
  open: boolean;
  onToggle: () => void;
}) {
  const critical = items.filter((i) => i.level === "critical").length;
  return (
    <div>
      <button
        type="button"
        id={`gap-${id}`}
        onClick={onToggle}
        aria-expanded={open}
        disabled={items.length === 0}
        className="card w-full text-left px-4 py-3 flex items-center gap-3"
        style={{ cursor: items.length ? "pointer" : "default" }}
      >
        <span className="text-2xl font-semibold tabular-nums" style={{ color: items.length ? "var(--urgency-overdue)" : "var(--color-ink-faint)" }}>
          {items.length}
        </span>
        <span className="min-w-0">
          <span className="block font-medium" style={{ color: "var(--color-ink)" }}>{title}</span>
          <span className="block text-xs" style={{ color: "var(--color-ink-faint)" }}>
            {note}{critical > 0 ? ` · ${critical} critical` : ""}
          </span>
        </span>
      </button>
      {open && items.length > 0 && (
        <div className="mt-2">
          <ListSection title={title} count={items.length} tone={null}>
            {items.map((item) => (
              <ItemRow key={`${item.source}:${item.localId}`} item={item} note={peopleNote(item)} />
            ))}
          </ListSection>
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, note }: { item: WorkloadItem; note: string }) {
  const src = SOURCE_BY_ID[item.source];
  const tone = LEVEL_TONE[item.level];
  return (
    <li
      className="grid gap-x-4 gap-y-1 px-4 py-2 items-center grid-cols-1 md:grid-cols-[7rem_minmax(0,1.4fr)_minmax(0,1.4fr)_8rem] text-sm"
      style={{ borderTop: "1px solid var(--color-border-light)" }}
    >
      <a
        href={src.path}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          navigate(src.path);
        }}
        className="text-xs hover:underline"
        style={{ color: "var(--color-ink-muted)" }}
      >
        {src.label}
      </a>
      <span className="truncate">
        {item.clientLocalId ? (
          <ClientLink clientId={item.clientLocalId} clientName={item.clientName ?? undefined} className="hover:underline" style={{ color: "var(--color-ink)" }}>
            {itemLabel(item)}
          </ClientLink>
        ) : (
          <span style={{ color: "var(--color-ink)" }}>{itemLabel(item)}</span>
        )}
      </span>
      <span className="text-xs truncate" style={{ color: "var(--color-ink-faint)" }}>{note}</span>
      <span>{tone ? <Tag color={tone}>{item.levelLabel}</Tag> : <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>{item.levelLabel}</span>}</span>
    </li>
  );
}

function peopleNote(item: WorkloadItem): string {
  return Object.entries(item.people)
    .filter(([, names]) => names && names.length > 0)
    .map(([col, names]) => `${col}: ${names!.join(", ")}`)
    .join(" · ") || "No one";
}
