// =============================================================================
// Settings → Staff (P11.6) — the staff roster
// =============================================================================
// Everyone who works at the firm, with their roles, whether or not they sign
// in. Filled by "Refresh from Monday" (workspace users + names on the boards);
// an admin confirms the suggested roles, ties stray board spellings to the
// right person, and links attorney boards. API = apps/api/src/routes/staff.ts.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  fetchStaff,
  fetchUnmatchedStaffNames,
  createStaff,
  updateStaff,
  setStaffRoles,
  addStaffAlias,
  removeStaffAlias,
  refreshStaff,
  fetchAttorneyBoards,
  STAFF_ROLE_LABEL,
  type StaffMember,
  type StaffRole,
  type StaffRefreshResult,
  type StaffPatch,
  type AttorneyBoard,
} from "../api";
import { SectionCode } from "./ScreenCode";
import { settingsSectionTitle } from "./settingsStyles";
import { OffboardingPanel } from "./OffboardingPanel";
import { DateInput } from "./ui/date-input";

const ALL_ROLES = Object.keys(STAFF_ROLE_LABEL) as StaffRole[];

type RoleFilter = "all" | "none" | StaffRole;

export function StaffSection() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [unmatched, setUnmatched] = useState<Array<{ name: string; items: number }>>([]);
  const [boards, setBoards] = useState<AttorneyBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState<StaffRefreshResult | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    try {
      const [s, u] = await Promise.all([fetchStaff(), fetchUnmatchedStaffNames()]);
      setStaff(s.staff);
      setUnmatched(u);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    fetchAttorneyBoards().then((b) => setBoards(b.filter((x) => x.active))).catch(() => {});
  }, []);

  /** Run a write, swap the returned person into the list, surface errors. */
  async function act(key: string, fn: () => Promise<StaffMember | void>) {
    setBusy(key);
    setError(null);
    try {
      const updated = await fn();
      if (updated) setStaff((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onRefresh() {
    setBusy("refresh");
    setError(null);
    try {
      setRefreshed(await refreshStaff());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** "This name is that person": move the alias, then reload (a board-name row may be gone). */
  async function linkName(name: string, toId: number) {
    setBusy(`link:${name}`);
    setError(null);
    try {
      await addStaffAlias(toId, name, true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const active = staff.filter((s) => s.active);
  const boardOnly = staff.filter((s) => s.source === "board_name" && !s.active);
  const visible = useMemo(
    () =>
      staff
        // The person being edited stays put — offboarding makes them inactive mid-checklist.
        .filter((s) => showInactive || s.active || s.id === openId)
        .filter((s) =>
          roleFilter === "all" ? true : roleFilter === "none" ? s.roles.length === 0 : s.roles.includes(roleFilter),
        ),
    [staff, showInactive, roleFilter, openId],
  );
  const suggested = active.filter((s) => !s.rolesReviewed && s.roles.length > 0).length;
  const noRole = active.filter((s) => s.roles.length === 0).length;

  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={settingsSectionTitle}>Staff<SectionCode code="P11.6.1" inline /></h2>
      <p style={styles.desc}>
        Everyone who works here, with their roles — whether or not they sign in. “Refresh from Monday” adds new Monday
        users and any name on the boards that matches no one. Roles found on the boards are suggestions until you set them.
      </p>

      {error && <div style={styles.errorBox} role="alert">{error}</div>}
      {refreshed && <RefreshSummary r={refreshed} onClose={() => setRefreshed(null)} />}

      <div style={styles.toolbar}>
        <button style={styles.primaryBtn} onClick={onRefresh} disabled={busy === "refresh"}>
          {busy === "refresh" ? "Refreshing…" : "Refresh from Monday"}
        </button>
        <button style={styles.btn} onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add person"}
        </button>
        <span style={{ flex: 1 }} />
        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          style={styles.select}
        >
          <option value="all">All roles</option>
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>{STAFF_ROLE_LABEL[r]}</option>
          ))}
          <option value="none">No role yet</option>
        </select>
        <label style={styles.check}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      {adding && (
        <AddPersonForm
          onCancel={() => setAdding(false)}
          onSave={(input) =>
            act("add", async () => {
              const created = await createStaff(input);
              setStaff((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
              setAdding(false);
            })
          }
        />
      )}

      {!loading && (
        <p style={styles.counts}>
          {active.length} active · {staff.length - active.length} inactive
          {suggested > 0 && <> · <strong style={{ color: "var(--color-amber)" }}>{suggested} with suggested roles to confirm</strong></>}
          {noRole > 0 && <> · {noRole} without a role</>}
        </p>
      )}

      {loading ? (
        <div style={styles.faint}>Loading…</div>
      ) : staff.length === 0 ? (
        <div style={styles.empty}>No staff yet. Press “Refresh from Monday” to fill the roster.</div>
      ) : (
        <div style={styles.card}>
          {visible.map((s, i) => (
            <StaffRow
              key={s.id}
              s={s}
              first={i === 0}
              open={openId === s.id}
              busy={busy?.endsWith(`:${s.id}`) ?? false}
              boards={boards}
              onToggleOpen={() => setOpenId(openId === s.id ? null : s.id)}
              onRoles={(roles) => act(`roles:${s.id}`, () => setStaffRoles(s.id, roles))}
              onPatch={(patch) => act(`patch:${s.id}`, () => updateStaff(s.id, patch))}
              onAddAlias={(alias) => act(`alias:${s.id}`, () => addStaffAlias(s.id, alias))}
              onRemoveAlias={(alias) => act(`alias:${s.id}`, () => removeStaffAlias(s.id, alias))}
              onReload={load}
            />
          ))}
          {visible.length === 0 && <div style={{ ...styles.faint, padding: "14px 20px" }}>No one matches this filter.</div>}
        </div>
      )}

      {(boardOnly.length > 0 || unmatched.length > 0) && (
        <BoardNamesPanel
          names={[
            ...unmatched.map((u) => ({ name: u.name, items: u.items, rowId: null as number | null })),
            ...boardOnly.map((b) => ({ name: b.name, items: null, rowId: b.id })),
          ]}
          people={active}
          busy={busy}
          onLink={linkName}
        />
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------

function RefreshSummary({ r, onClose }: { r: StaffRefreshResult; onClose: () => void }) {
  const parts = [
    `${r.mondayAdded} added from Monday`,
    `${r.mondayUpdated} updated`,
    `${r.boardNamesAdded} names found only on the boards`,
    `${r.rolesSuggested} roles suggested`,
    `${r.loginsLinked} logins linked`,
  ];
  return (
    <div style={styles.infoBox} role="status">
      <div>Refreshed: {parts.join(" · ")}.</div>
      {r.mondaySkipped && <div>Monday users not read: {r.mondaySkipped}.</div>}
      {r.missingFromMonday.length > 0 && (
        <div>No longer in Monday (still active here): {r.missingFromMonday.join(", ")}.</div>
      )}
      <button style={styles.linkBtn} onClick={onClose}>Dismiss</button>
    </div>
  );
}

function StaffRow(props: {
  s: StaffMember;
  first: boolean;
  open: boolean;
  busy: boolean;
  boards: AttorneyBoard[];
  onToggleOpen: () => void;
  onRoles: (roles: StaffRole[]) => void;
  onPatch: (patch: StaffPatch) => void;
  onAddAlias: (alias: string) => void;
  onRemoveAlias: (alias: string) => void;
  onReload: () => void;
}) {
  const { s } = props;
  const suggested = !s.rolesReviewed && s.roles.length > 0;
  const toggleRole = (r: StaffRole) =>
    props.onRoles(s.roles.includes(r) ? s.roles.filter((x) => x !== r) : [...s.roles, r]);

  return (
    <div style={{ borderTop: props.first ? "none" : "1px solid var(--color-border)", opacity: s.active ? 1 : 0.6 }}>
      <div style={styles.row}>
        <div style={styles.avatar}>{initials(s.name)}</div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={styles.name}>
            {s.name}
            {!s.active && <span style={styles.tag}>inactive</span>}
            {s.source === "board_name" && <span style={styles.tag} title="Seen only in a people column on the boards">board name only</span>}
            {s.source === "monday" && <span style={styles.tag} title={`Monday user #${s.mondayUserId}`}>Monday</span>}
          </div>
          <div style={styles.sub}>
            {[s.email, s.phoneExt && `ext. ${s.phoneExt}`, s.login ? `app login${s.login.active ? "" : " (disabled)"}` : null]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </div>

        <div style={styles.chips} role="group" aria-label={`Roles for ${s.name}`}>
          {ALL_ROLES.map((r) => {
            const on = s.roles.includes(r);
            return (
              <button
                key={r}
                onClick={() => toggleRole(r)}
                disabled={props.busy}
                aria-pressed={on}
                style={{
                  ...styles.chip,
                  ...(on ? (suggested ? styles.chipSuggested : styles.chipOn) : null),
                }}
                title={on && suggested ? "Suggested from the boards — click any role to confirm" : undefined}
              >
                {STAFF_ROLE_LABEL[r]}
              </button>
            );
          })}
          {suggested && (
            <button style={styles.linkBtn} onClick={() => props.onRoles(s.roles)} disabled={props.busy}>
              Confirm
            </button>
          )}
        </div>

        <button style={styles.btn} onClick={props.onToggleOpen} aria-expanded={props.open}>
          {props.open ? "Close" : "Edit"}
        </button>
      </div>
      {props.open && <StaffEditor {...props} />}
    </div>
  );
}

function StaffEditor({
  s,
  boards,
  busy,
  onPatch,
  onAddAlias,
  onRemoveAlias,
  onReload,
}: {
  s: StaffMember;
  boards: AttorneyBoard[];
  busy: boolean;
  onPatch: (patch: StaffPatch) => void;
  onAddAlias: (alias: string) => void;
  onRemoveAlias: (alias: string) => void;
  onReload: () => void;
}) {
  const [offboarding, setOffboarding] = useState(false);
  const [form, setForm] = useState({
    name: s.name,
    email: s.email ?? "",
    phoneExt: s.phoneExt ?? "",
    startDate: s.startDate ?? "",
  });
  const [alias, setAlias] = useState("");
  const dirty =
    form.name !== s.name || form.email !== (s.email ?? "") || form.phoneExt !== (s.phoneExt ?? "") || form.startDate !== (s.startDate ?? "");

  return (
    <div style={styles.editor}>
      <div style={styles.grid}>
        <Field label="Name">
          <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="E-mail">
          <input style={styles.input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Phone ext.">
          <input style={styles.input} value={form.phoneExt} onChange={(e) => setForm({ ...form, phoneExt: e.target.value })} />
        </Field>
        <Field label="Start date">
          <DateInput style={styles.input} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <Field label="Attorney board (My Day opens on it)">
          <select
            style={styles.input}
            value={s.attorneyBoard ?? ""}
            onChange={(e) => onPatch({ attorneyBoard: e.target.value || null })}
            disabled={busy}
          >
            <option value="">— none —</option>
            {boards.map((b) => (
              <option key={b.boardKey} value={b.boardKey}>{b.attorneyName ?? b.displayName} ({b.displayName})</option>
            ))}
            {s.attorneyBoard && !boards.some((b) => b.boardKey === s.attorneyBoard) && (
              <option value={s.attorneyBoard}>{s.attorneyBoard}</option>
            )}
          </select>
        </Field>
        <Field label="Status">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {s.active ? (
              <button style={styles.btn} onClick={() => setOffboarding((v) => !v)} aria-expanded={offboarding}>
                {offboarding ? "Close offboarding" : "Offboard…"}
              </button>
            ) : (
              <button style={styles.btn} onClick={() => onPatch({ active: true, endDate: null })} disabled={busy}>
                Mark active again
              </button>
            )}
            {!s.active && (
              <button style={styles.btn} onClick={() => setOffboarding((v) => !v)} aria-expanded={offboarding}>
                {offboarding ? "Close" : "Offboarding / open work"}
              </button>
            )}
          </div>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          style={styles.primaryBtn}
          disabled={!dirty || busy || !form.name.trim()}
          onClick={() =>
            onPatch({ name: form.name, email: form.email || null, phoneExt: form.phoneExt || null, startDate: form.startDate || null })
          }
        >
          Save
        </button>
      </div>

      {offboarding && <OffboardingPanel staffId={s.id} onChanged={onReload} />}

      <div style={{ marginTop: 16 }}>
        <div style={styles.label}>Names on the boards</div>
        <p style={styles.hint}>Every spelling that means this person. My Cases, Workload and the pickers match on all of them.</p>
        <div style={styles.chips}>
          {s.aliases.map((a) => (
            <span key={a} style={styles.aliasChip}>
              {a}
              <button style={styles.x} onClick={() => onRemoveAlias(a)} disabled={busy} aria-label={`Remove ${a}`}>×</button>
            </span>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!alias.trim()) return;
              onAddAlias(alias.trim());
              setAlias("");
            }}
            style={{ display: "flex", gap: 6 }}
          >
            <input style={{ ...styles.input, width: 180 }} placeholder="Add a spelling" value={alias} onChange={(e) => setAlias(e.target.value)} />
            <button style={styles.btn} type="submit" disabled={busy || !alias.trim()}>Add</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function BoardNamesPanel({
  names,
  people,
  busy,
  onLink,
}: {
  names: Array<{ name: string; items: number | null; rowId: number | null }>;
  people: StaffMember[];
  busy: string | null;
  onLink: (name: string, toId: number) => void;
}) {
  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={settingsSectionTitle}>Names on the boards with no Monday account<SectionCode code="P11.6.2" inline /></h3>
      <p style={styles.desc}>
        Usually former staff, or a second spelling of someone current. Link a spelling to the person it means; leave
        former staff as they are — Offboarding reassigns their open work.
      </p>
      <div style={styles.card}>
        {names.map((n, i) => (
          <div key={n.name} style={{ ...styles.row, borderTop: i === 0 ? "none" : "1px solid var(--color-border)" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={styles.name}>{n.name}</div>
              {n.items !== null && <div style={styles.sub}>on {n.items} item{n.items === 1 ? "" : "s"} · not in the roster yet</div>}
            </div>
            <select
              aria-label={`Link ${n.name} to a person`}
              style={styles.select}
              value=""
              disabled={busy === `link:${n.name}`}
              onChange={(e) => e.target.value && onLink(n.name, Number(e.target.value))}
            >
              <option value="">This is…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddPersonForm({
  onSave,
  onCancel,
}: {
  onSave: (input: { name: string; email: string | null; roles: StaffRole[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<StaffRole[]>([]);
  return (
    <form
      style={{ ...styles.card, ...styles.editor, marginBottom: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave({ name: name.trim(), email: email.trim() || null, roles });
      }}
    >
      <div style={styles.grid}>
        <Field label="Name">
          <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="E-mail">
          <input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      <div style={{ ...styles.chips, marginTop: 10 }}>
        {ALL_ROLES.map((r) => (
          <button
            type="button"
            key={r}
            aria-pressed={roles.includes(r)}
            onClick={() => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])}
            style={{ ...styles.chip, ...(roles.includes(r) ? styles.chipOn : null) }}
          >
            {STAFF_ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button style={styles.primaryBtn} type="submit" disabled={!name.trim()}>Add</button>
        <button style={styles.btn} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={styles.label}>{label}</span>
      {children}
    </label>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
}

// -----------------------------------------------------------------------------

const font = "var(--font-body)";

const styles: Record<string, React.CSSProperties> = {
  desc: { fontFamily: font, fontSize: 13, color: "var(--color-ink-faint)", marginBottom: 12, lineHeight: 1.5 },
  toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 },
  counts: { fontFamily: font, fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 8 },
  card: { backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 20px" },
  avatar: {
    width: 32, height: 32, borderRadius: "50%", backgroundColor: "var(--color-amber)", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font, fontWeight: 600, fontSize: 12, flexShrink: 0,
  },
  name: { fontFamily: font, fontWeight: 500, fontSize: 14, color: "var(--color-ink)", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" },
  sub: { fontFamily: font, fontSize: 12, color: "var(--color-ink-faint)" },
  tag: {
    fontSize: 11, fontWeight: 400, color: "var(--color-ink-faint)", border: "1px solid var(--color-border)",
    borderRadius: 10, padding: "0 6px",
  },
  chips: { display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" },
  chip: {
    padding: "3px 10px", borderRadius: 14, border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)",
    color: "var(--color-ink-faint)", fontFamily: font, fontSize: 12, cursor: "pointer",
  },
  chipOn: { backgroundColor: "var(--color-ink)", borderColor: "var(--color-ink)", color: "var(--color-surface)" },
  chipSuggested: { backgroundColor: "rgba(180,83,9,0.1)", borderColor: "rgba(180,83,9,0.45)", color: "var(--color-amber)", borderStyle: "dashed" },
  aliasChip: {
    display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 4px 3px 10px", borderRadius: 14,
    border: "1px solid var(--color-border)", fontFamily: font, fontSize: 12, color: "var(--color-ink)",
  },
  x: { border: "none", background: "none", cursor: "pointer", color: "var(--color-ink-faint)", fontSize: 14, lineHeight: 1, padding: "0 4px" },
  editor: { padding: "12px 20px 18px 64px", backgroundColor: "var(--color-surface-warm)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 },
  label: { fontFamily: font, fontSize: 12, fontWeight: 500, color: "var(--color-ink-muted)" },
  hint: { fontFamily: font, fontSize: 12, color: "var(--color-ink-faint)", margin: "2px 0 8px" },
  input: {
    padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-border)", backgroundColor: "var(--color-card)",
    color: "var(--color-ink)", fontFamily: font, fontSize: 13, minWidth: 0,
  },
  select: {
    padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-border)", backgroundColor: "var(--color-card)",
    color: "var(--color-ink)", fontFamily: font, fontSize: 13, cursor: "pointer",
  },
  check: { display: "flex", alignItems: "center", gap: 6, fontFamily: font, fontSize: 13, color: "var(--color-ink-muted)" },
  btn: {
    padding: "6px 12px", borderRadius: 8, border: "1px solid var(--color-border)", backgroundColor: "var(--color-card)",
    color: "var(--color-ink)", fontFamily: font, fontSize: 13, cursor: "pointer",
  },
  primaryBtn: {
    padding: "6px 14px", borderRadius: 8, border: "1px solid var(--color-amber)", backgroundColor: "var(--color-amber)",
    color: "#fff", fontFamily: font, fontSize: 13, fontWeight: 500, cursor: "pointer",
  },
  linkBtn: { border: "none", background: "none", color: "var(--color-amber)", fontFamily: font, fontSize: 12, cursor: "pointer", padding: "2px 4px" },
  errorBox: {
    backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)", border: "1px solid rgba(153,27,27,0.15)",
    borderRadius: 8, padding: "10px 14px", fontSize: 13, fontFamily: font, marginBottom: 12,
  },
  infoBox: {
    backgroundColor: "var(--color-surface-warm)", border: "1px solid var(--color-border)", borderRadius: 8,
    padding: "10px 14px", fontSize: 13, fontFamily: font, color: "var(--color-ink)", marginBottom: 12, lineHeight: 1.5,
  },
  empty: {
    border: "1px dashed var(--color-border)", borderRadius: 10, padding: "24px 20px", fontFamily: font, fontSize: 14,
    color: "var(--color-ink-faint)", textAlign: "center",
  },
  faint: { color: "var(--color-ink-faint)", fontFamily: font, fontSize: 14 },
};
