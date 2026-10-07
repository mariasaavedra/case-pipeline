import { useState, useEffect, useRef } from "react";
import { useAuth } from "../auth/useAuth";
import { usePreferences } from "../hooks/usePreferences";
import type { Theme, DefaultPage, DateFormat } from "../hooks/usePreferences";
import { apiFetch, fetchAttorneyBoards, addAttorneyBoard, deleteAttorneyBoard, fetchMondayStatus, updateMyProfile, getParalegals, fetchAdminUsers, updateAdminUser, fetchUserPresence } from "../api";
import type { AttorneyBoard, PublicUser, MondayConnectionStatus, UserPresence, PresenceStatus } from "../api";
import { StatusTagsSection } from "../components/StatusTagsSection";
import { UrgencySettingsSection } from "../components/UrgencySettingsSection";
import { DocumentSettingsSection } from "../components/DocumentSettingsSection";
import { SyncHealthSection } from "../components/SyncHealthSection";
import { AuditLogSection } from "../components/AuditLogSection";
import { SectionCode } from "../components/ScreenCode";
import { settingsSectionTitle } from "../components/settingsStyles";
import { useMondayConnect } from "../hooks/useMondayConnect";
import { useViewport } from "../hooks/useViewport";
import { navigate } from "../router";

// =============================================================================
// User management (admin section)
// =============================================================================

type UserRow = PublicUser;

/** How often the Users section re-reads presence while Settings is open. */
const PRESENCE_POLL_MS = 30_000;

const PRESENCE_COLOR: Record<PresenceStatus, string> = {
  online: "var(--color-status-green)",
  idle: "var(--color-amber)",
  offline: "var(--color-border)",
};

function presenceLabel(p: UserPresence | undefined): string {
  if (!p || p.secondsAgo === null) return "Never active";
  if (p.status === "online") return "Online";
  const s = p.secondsAgo;
  const ago = s < 3600 ? `${Math.floor(s / 60)}m` : s < 86_400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86_400)}d`;
  return p.status === "idle" ? `Idle · ${ago}` : `Seen ${ago} ago`;
}

function UsersSection() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [boardPeople, setBoardPeople] = useState<string[]>([]);
  const [attyBoards, setAttyBoards] = useState<AttorneyBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);
  const [presence, setPresence] = useState<Map<number, UserPresence>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchUserPresence()
        .then((rows) => { if (!cancelled) setPresence(new Map(rows.map((r) => [r.id, r]))); })
        .catch(() => {});
    load();
    const t = setInterval(load, PRESENCE_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  const onlineNow = [...presence.values()].filter((p) => p.status === "online");

  useEffect(() => {
    fetchAdminUsers()
      .then(setUsers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    getParalegals().then(setBoardPeople).catch(() => {});
    fetchAttorneyBoards().then((b) => setAttyBoards(b.filter((x) => x.active))).catch(() => {});
  }, []);

  async function toggleRole(target: UserRow) {
    if (target.id === user?.id) return;
    setUpdating(target.id);
    try {
      const next = target.role === "admin" ? "user" : "admin";
      const updated = await apiFetch<UserRow>(`/api/admin/users/${target.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUpdating(null);
    }
  }

  async function patchUser(target: UserRow, patch: { paralegal_link?: string | null; attorney_board?: string | null; active?: boolean }) {
    setUpdating(target.id);
    try {
      const updated = await updateAdminUser(target.id, patch);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUpdating(null);
    }
  }

  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={styles.sectionTitle}>Users<SectionCode code="P11.4.1" inline /></h2>
      <p style={styles.sectionDesc}>
        Users sign in with their firm Microsoft account (created as a regular user on first login).
        Promote to admin, link them to their board name for “My Cases”, link an attorney to the
        appointment board Appointments opens on for them, or disable access here.
      </p>

      {error && <div style={styles.errorBox}>{error}</div>}

      {presence.size > 0 && (
        <p style={{ ...styles.userEmail, marginBottom: "10px" }} aria-live="polite">
          <span style={{ color: PRESENCE_COLOR.online }}>●</span>{" "}
          <strong style={{ color: "var(--color-ink)" }}>{onlineNow.length} online now</strong>
          {onlineNow.length > 0 && <> — {onlineNow.map((p) => p.name).join(", ")}</>}
          <span title="Online = used the app in the last 5 minutes; idle = in the last hour. Refreshes every 30 seconds.">
            {" "}· updates every 30s
          </span>
        </p>
      )}

      {loading ? (
        <div style={styles.faint}>Loading…</div>
      ) : (
        <div style={styles.card}>
          {users.map((u, i) => (
            <div
              key={u.id}
              style={{
                ...styles.userRow,
                flexWrap: "wrap",
                borderTop: i === 0 ? "none" : `1px solid var(--color-border)`,
                opacity: u.active === 0 ? 0.55 : 1,
              }}
            >
              <div style={{ position: "relative", flexShrink: 0 }}>
                <div style={styles.avatar}>
                  {u.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                {u.active !== 0 && (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      right: -1,
                      bottom: -1,
                      width: 11,
                      height: 11,
                      borderRadius: "50%",
                      border: "2px solid var(--color-surface)",
                      backgroundColor: PRESENCE_COLOR[presence.get(u.id)?.status ?? "offline"],
                    }}
                  />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={styles.userName}>
                  {u.name}
                  {u.id === user?.id && <span style={styles.youTag}> (you)</span>}
                  {u.active === 0 && <span style={styles.youTag}> · disabled</span>}
                </div>
                <div style={styles.userEmail}>{u.email}</div>
              </div>

              {u.active !== 0 && (
                <div
                  style={{
                    ...styles.lastLogin,
                    color: presence.get(u.id)?.status === "online" ? "var(--color-status-green)" : "var(--color-ink-faint)",
                  }}
                  title={presence.get(u.id)?.lastActiveAt ? `Last active ${new Date(presence.get(u.id)!.lastActiveAt + "Z").toLocaleString()}` : undefined}
                >
                  {presenceLabel(presence.get(u.id))}
                </div>
              )}

              {/* Admin-assigned board identity (for My Cases) */}
              <select
                value={u.paralegal_link ?? ""}
                onChange={(e) => patchUser(u, { paralegal_link: e.target.value || null })}
                disabled={updating === u.id}
                style={{ ...styles.select, maxWidth: 150 }}
                title="Link this user to their paralegal name on the boards (for My Cases)"
              >
                <option value="">— paralegal —</option>
                {boardPeople.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
                {u.paralegal_link && !boardPeople.includes(u.paralegal_link) && (
                  <option value={u.paralegal_link}>{u.paralegal_link}</option>
                )}
              </select>

              {/* Admin-assigned attorney board (P4 Appointments opens on it) */}
              <select
                value={u.attorney_board ?? ""}
                onChange={(e) => patchUser(u, { attorney_board: e.target.value || null })}
                disabled={updating === u.id}
                style={{ ...styles.select, maxWidth: 150 }}
                title="The attorney appointment board Appointments opens on for this user"
              >
                <option value="">— attorney board —</option>
                {attyBoards.map((b) => (
                  <option key={b.boardKey} value={b.boardKey}>{b.attorneyName ?? b.displayName} ({b.displayName})</option>
                ))}
                {u.attorney_board && !attyBoards.some((b) => b.boardKey === u.attorney_board) && (
                  <option value={u.attorney_board}>{u.attorney_board}</option>
                )}
              </select>

              <button
                onClick={() => toggleRole(u)}
                disabled={updating === u.id || u.id === user?.id}
                style={{
                  ...styles.roleBadge,
                  opacity: updating === u.id ? 0.5 : 1,
                  cursor: u.id === user?.id ? "default" : "pointer",
                  backgroundColor: u.role === "admin" ? "rgba(180,83,9,0.1)" : "var(--color-surface)",
                  borderColor: u.role === "admin" ? "rgba(180,83,9,0.35)" : "var(--color-border)",
                  color: u.role === "admin" ? "var(--color-amber)" : "var(--color-ink-faint)",
                }}
                title={u.id === user?.id ? "Cannot change your own role" : `Click to make ${u.role === "admin" ? "regular user" : "admin"}`}
              >
                {u.role}
              </button>

              <button
                onClick={() => patchUser(u, { active: u.active === 0 })}
                disabled={updating === u.id || u.id === user?.id}
                style={{
                  ...styles.roleBadge,
                  cursor: u.id === user?.id ? "default" : "pointer",
                  backgroundColor: "var(--color-surface)",
                  borderColor: "var(--color-border)",
                  color: u.active === 0 ? "var(--color-status-green)" : "var(--color-ink-faint)",
                }}
                title={u.id === user?.id ? "Cannot change your own status" : u.active === 0 ? "Reactivate access" : "Disable access"}
              >
                {u.active === 0 ? "Activate" : "Disable"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// =============================================================================
// My board identity (self-service) + Audit log (admin)
// =============================================================================

function BoardIdentitySection() {
  const { user } = useAuth();
  const [people, setPeople] = useState<string[]>([]);
  const [link, setLink] = useState<string>(user?.paralegal_link ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getParalegals().then(setPeople).catch(() => {});
  }, []);

  async function save(patch: { paralegal_link?: string | null }) {
    setStatus("saving");
    setError(null);
    try {
      await updateMyProfile(patch);
      setStatus("saved");
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
    }
  }

  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={styles.sectionTitle}>Board identity<SectionCode code="P11.1.2" inline /></h2>
      <p style={styles.sectionDesc}>
        Link your account to your name on the Monday.com boards so “My Cases” shows your workload.
      </p>
      {error && <div style={styles.errorBox}>{error}</div>}
      <div style={styles.card}>
        <div style={styles.prefRow}>
          <div>
            <div style={styles.prefLabel}>I am (paralegal)</div>
            <div style={styles.prefHint}>Pick your paralegal name to filter “My Cases” to your assignments</div>
          </div>
          <select
            value={link}
            onChange={(e) => {
              const v = e.target.value;
              setLink(v);
              save({ paralegal_link: v || null });
            }}
            style={styles.select}
          >
            <option value="">— not set —</option>
            {people.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
            {link && !people.includes(link) && <option value={link}>{link}</option>}
          </select>
        </div>
        {status !== "idle" && (
          <div style={{ padding: "8px 20px", fontSize: 12, fontFamily: "var(--font-body)", color: "var(--color-ink-faint)" }}>
            {status === "saving" ? "Saving…" : "Saved ✓"}
          </div>
        )}
      </div>
    </section>
  );
}

/** Language lives with the other preferences, but is stored on the user profile. */
function LanguageRow() {
  const { user } = useAuth();
  const [locale, setLocale] = useState<string>(user?.locale ?? "es");
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ ...styles.prefRow, borderTop: `1px solid var(--color-border)` }}>
      <div>
        <div style={styles.prefLabel}>Language</div>
        <div style={styles.prefHint}>{error ?? "Preferred language for your account"}</div>
      </div>
      <select
        value={locale}
        onChange={(e) => {
          const v = e.target.value;
          setLocale(v);
          setError(null);
          updateMyProfile({ locale: v }).catch((err: Error) => setError(err.message));
        }}
        style={styles.select}
      >
        <option value="es">Español</option>
        <option value="en">English</option>
      </select>
    </div>
  );
}

// =============================================================================
// Attorney Boards section
// =============================================================================

const BOARD_COLORS = [
  { color: "var(--color-amber)",        bg: "var(--color-amber-light)" },
  { color: "var(--color-status-blue)",  bg: "var(--color-status-blue-bg)" },
  { color: "var(--color-status-green)", bg: "var(--color-status-green-bg)" },
  { color: "var(--color-status-red)",   bg: "var(--color-status-red-bg)" },
];

function boardColor(index: number) {
  return BOARD_COLORS[index % BOARD_COLORS.length]!;
}

function AttorneyBoardsSection() {
  const [boards, setBoards] = useState<AttorneyBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Add form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formBoardId, setFormBoardId] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchAttorneyBoards()
      .then(setBoards)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function derivedBoardKey(displayName: string): string {
    return `appointments_${displayName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim() || !formBoardId.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const updated = await addAttorneyBoard({
        boardKey: derivedBoardKey(formName),
        mondayBoardId: formBoardId.trim(),
        displayName: formName.trim().toUpperCase(),
      });
      setBoards(updated);
      setShowForm(false);
      setFormName("");
      setFormBoardId("");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(boardKey: string) {
    setDeleting(boardKey);
    try {
      const updated = await deleteAttorneyBoard(boardKey);
      setBoards(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={styles.sectionTitle}>Attorney appointment boards<SectionCode code="P11.3.1" inline /></h2>
      <p style={styles.sectionDesc}>
        Each attorney has a dedicated Monday.com appointments board. Add or remove boards here —
        the board will appear as a column in the Appointments view immediately, and the next sync
        will pull their data.
      </p>

      {error && <div style={styles.errorBox}>{error}</div>}

      {loading ? (
        <div style={styles.faint}>Loading…</div>
      ) : (
        <div style={styles.card}>
          {boards.length === 0 && (
            <div style={{ ...styles.fieldRow, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", fontSize: "13px" }}>
              No attorney boards configured.
            </div>
          )}

          {boards.map((b, i) => {
            const { color, bg } = boardColor(i);
            return (
              <div
                key={b.boardKey}
                style={{
                  ...styles.userRow,
                  borderTop: i === 0 ? "none" : `1px solid var(--color-border)`,
                }}
              >
                {/* Color pill with initials */}
                <div
                  style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "50%",
                    backgroundColor: color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-body)",
                    fontWeight: 700,
                    fontSize: "11px",
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  {b.displayName}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...styles.userName }}>{b.displayName}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-ink-faint)" }}>
                    Board ID: {b.mondayBoardId || <em>not set</em>} · key: {b.boardKey}
                  </div>
                </div>

                {/* Status badge */}
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: "20px",
                    border: `1px solid ${bg}`,
                    fontSize: "11px",
                    fontFamily: "var(--font-body)",
                    fontWeight: 500,
                    backgroundColor: bg,
                    color,
                    flexShrink: 0,
                  }}
                >
                  Active
                </span>

                {/* Remove */}
                <button
                  onClick={() => handleDelete(b.boardKey)}
                  disabled={deleting === b.boardKey}
                  style={{
                    background: "none",
                    border: "1px solid var(--color-border)",
                    borderRadius: "6px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)",
                    fontSize: "12px",
                    color: "var(--color-ink-faint)",
                    flexShrink: 0,
                    opacity: deleting === b.boardKey ? 0.5 : 1,
                  }}
                >
                  Remove
                </button>
              </div>
            );
          })}

          {/* Add form */}
          {showForm ? (
            <form
              onSubmit={handleAdd}
              style={{
                borderTop: `1px solid var(--color-border)`,
                padding: "16px 20px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", fontWeight: 500, color: "var(--color-ink)" }}>
                Add attorney board
              </div>

              {formError && <div style={{ ...styles.errorBox, marginBottom: 0 }}>{formError}</div>}

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "0 0 80px" }}>
                  <label style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--color-ink-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Initials
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="JS"
                    maxLength={4}
                    required
                    style={{
                      ...styles.select,
                      padding: "7px 10px",
                      width: "100%",
                      textTransform: "uppercase",
                    }}
                  />
                  {formName && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--color-ink-faint)" }}>
                      key: {derivedBoardKey(formName)}
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, minWidth: "160px" }}>
                  <label style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--color-ink-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Monday.com Board ID
                  </label>
                  <input
                    type="text"
                    value={formBoardId}
                    onChange={(e) => setFormBoardId(e.target.value)}
                    placeholder="1234567890"
                    required
                    style={{ ...styles.select, padding: "7px 10px", width: "100%", fontFamily: "var(--font-mono)" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: "7px 18px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "var(--color-amber)",
                    color: "#fff",
                    fontFamily: "var(--font-body)",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: saving ? "default" : "pointer",
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? "Adding…" : "Add board"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setFormName(""); setFormBoardId(""); setFormError(null); }}
                  style={{
                    padding: "7px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    backgroundColor: "transparent",
                    color: "var(--color-ink-muted)",
                    fontFamily: "var(--font-body)",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div style={{ borderTop: boards.length > 0 ? `1px solid var(--color-border)` : "none", padding: "12px 20px" }}>
              <button
                onClick={() => setShowForm(true)}
                style={{
                  background: "none",
                  border: "1px dashed var(--color-border)",
                  borderRadius: "8px",
                  padding: "7px 16px",
                  cursor: "pointer",
                  fontFamily: "var(--font-body)",
                  fontSize: "13px",
                  color: "var(--color-ink-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3v10M3 8h10" />
                </svg>
                Add attorney board
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// =============================================================================
// Monday.com Connection
// =============================================================================

function MondayConnectionSection() {
  const [status, setStatus] = useState<MondayConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const { connect, connecting, error: connectError } = useMondayConnect();

  useEffect(() => {
    fetchMondayStatus()
      .then(setStatus)
      .catch(() => setStatus({ connected: false }))
      .finally(() => setLoading(false));
  }, []);

  // Pick up ?monday=connected after OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("monday") === "connected") {
      window.history.replaceState(null, "", window.location.pathname);
      fetchMondayStatus().then(setStatus).catch(() => {});
    }
  }, []);

  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={styles.sectionTitle}>Monday.com connection<SectionCode code="P11.1.3" inline /></h2>
      <p style={styles.sectionDesc}>
        Connect your personal Monday.com account so notes you post are attributed to you.
      </p>
      <div style={styles.card}>
        <div style={styles.fieldRow}>
          <div>
            <div style={styles.prefLabel}>Connection</div>
            <div style={styles.prefHint}>
              {loading
                ? "Checking…"
                : status?.connected
                  ? `Connected${status.mondayName ? ` as ${status.mondayName}` : ""}`
                  : "Not connected — notes will post under the shared API account"}
            </div>
            {status?.needsReconnect && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "var(--color-amber)",
                  fontFamily: "var(--font-body)",
                  maxWidth: 420,
                }}
              >
                Monday is refusing this connection — your changes are still being saved, but
                under the shared account instead of your name. Reconnecting fixes the
                attribution. (Connections made before the status-editing permission was added
                need this once.)
              </div>
            )}
          </div>
          <button
            onClick={() => connect()}
            disabled={connecting}
            style={{
              padding: "7px 16px",
              borderRadius: "8px",
              border: "none",
              // A connection Monday has refused gets the same call-to-action
              // weight as no connection at all — a quiet grey "Reconnect" is
              // exactly what everyone scrolled past for the last three days.
              backgroundColor:
                status?.connected && !status.needsReconnect ? "var(--color-surface-warm)" : "var(--color-amber)",
              color: status?.connected && !status.needsReconnect ? "var(--color-ink-muted)" : "#fff",
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: connecting ? "wait" : "pointer",
              opacity: connecting ? 0.7 : 1,
              flexShrink: 0,
            }}
          >
            {connecting ? "Redirecting…" : status?.connected ? "Reconnect" : "Connect Monday.com"}
          </button>
        </div>
        {connectError && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
            {connectError}
          </p>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// Profile + preferences
// =============================================================================

function ProfileSection() {
  const { user } = useAuth();
  return (
    <section style={{ marginBottom: "40px" }}>
      <h2 style={styles.sectionTitle}>Profile<SectionCode code="P11.1.1" inline /></h2>
      <p style={styles.sectionDesc}>From your firm Microsoft account. An admin changes roles under Admin → Users.</p>
      <div style={styles.card}>
        <div style={styles.fieldRow}>
          <span style={styles.fieldLabel}>Name</span>
          <span style={styles.fieldValue}>{user?.name}</span>
        </div>
        <div style={{ ...styles.fieldRow, borderTop: `1px solid var(--color-border)` }}>
          <span style={styles.fieldLabel}>Email</span>
          <span style={styles.fieldValue}>{user?.email}</span>
        </div>
        <div style={{ ...styles.fieldRow, borderTop: `1px solid var(--color-border)` }}>
          <span style={styles.fieldLabel}>Role</span>
          <span
            style={{
              ...styles.roleBadge,
              backgroundColor: user?.role === "admin" ? "rgba(180,83,9,0.1)" : "var(--color-surface)",
              borderColor: user?.role === "admin" ? "rgba(180,83,9,0.35)" : "var(--color-border)",
              color: user?.role === "admin" ? "var(--color-amber)" : "var(--color-ink-faint)",
              cursor: "default",
            }}
          >
            {user?.role}
          </span>
        </div>
      </div>
    </section>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{ ...styles.toggle, backgroundColor: on ? "var(--color-amber)" : "var(--color-border)" }}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <span style={{ ...styles.toggleKnob, transform: on ? "translateX(18px)" : "translateX(2px)" }} />
    </button>
  );
}

function PreferencesSections() {
  const { prefs, update } = usePreferences();
  return (
    <>
      <section style={{ marginBottom: "40px" }}>
        <h2 style={styles.sectionTitle}>Appearance<SectionCode code="P11.2.1" inline /></h2>
        <p style={styles.sectionDesc}>Synced to your account, so they follow you across devices.</p>
        <div style={styles.card}>
          <div style={styles.prefRow}>
            <div>
              <div style={styles.prefLabel}>Theme</div>
              <div style={styles.prefHint}>Switch between light and dark appearance</div>
            </div>
            <div style={styles.segmented}>
              {(["light", "dark", "system"] as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => update("theme", t)}
                  style={{
                    ...styles.segBtn,
                    backgroundColor: prefs.theme === t ? "var(--color-amber)" : "transparent",
                    color: prefs.theme === t ? "#fff" : "var(--color-ink-muted)",
                    fontWeight: prefs.theme === t ? 600 : 400,
                  }}
                >
                  {t === "light" ? "Light" : t === "dark" ? "Dark" : "System"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ ...styles.prefRow, borderTop: `1px solid var(--color-border)` }}>
            <div>
              <div style={styles.prefLabel}>Date format</div>
              <div style={styles.prefHint}>How dates are displayed across the app</div>
            </div>
            <select
              value={prefs.dateFormat}
              onChange={(e) => update("dateFormat", e.target.value as DateFormat)}
              style={styles.select}
            >
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              <option value="relative">Relative (3d ago)</option>
            </select>
          </div>

          <div style={{ ...styles.prefRow, borderTop: `1px solid var(--color-border)` }}>
            <div>
              <div style={styles.prefLabel}>Sidebar collapsed by default</div>
              <div style={styles.prefHint}>Start with the sidebar in icon-only mode</div>
            </div>
            <Toggle
              on={prefs.sidebarCollapsedDefault}
              onChange={(v) => update("sidebarCollapsedDefault", v)}
              label="Sidebar collapsed by default"
            />
          </div>

          <div style={{ ...styles.prefRow, borderTop: `1px solid var(--color-border)` }}>
            <div>
              <div style={styles.prefLabel}>Show screen codes</div>
              <div style={styles.prefHint}>The small grey codes (P4, M5, D6…) that name each page, section, popup and menu in a change request</div>
            </div>
            <Toggle on={prefs.showScreenCodes} onChange={(v) => update("showScreenCodes", v)} label="Show screen codes" />
          </div>
        </div>
      </section>

      <section style={{ marginBottom: "40px" }}>
        <h2 style={styles.sectionTitle}>Language &amp; start page<SectionCode code="P11.2.2" inline /></h2>
        <div style={styles.card}>
          <div style={styles.prefRow}>
            <div>
              <div style={styles.prefLabel}>Default page</div>
              <div style={styles.prefHint}>Page shown after signing in</div>
            </div>
            <select
              value={prefs.defaultPage}
              onChange={(e) => update("defaultPage", e.target.value as DefaultPage)}
              style={styles.select}
            >
              <option value="/">Home (Dashboard)</option>
              <option value="/clients">Clients</option>
              <option value="/appointments">Appointments</option>
              <option value="/alerts">Alerts</option>
            </select>
          </div>
          <LanguageRow />
        </div>
      </section>
    </>
  );
}

// =============================================================================
// Main Settings page — four tabs, each with its own URL (/settings/:tab)
// =============================================================================

type SettingsTab = "account" | "preferences" | "firm" | "admin";

const TABS: { id: SettingsTab; label: string; code: string; hint: string; adminOnly?: boolean }[] = [
  { id: "account", label: "My account", code: "P11.1", hint: "Profile, board identity, Monday.com" },
  { id: "preferences", label: "Preferences", code: "P11.2", hint: "Theme, dates, language" },
  { id: "firm", label: "Firm setup", code: "P11.3", hint: "Attorney boards, status tags, urgency, documents", adminOnly: true },
  { id: "admin", label: "Admin", code: "P11.4", hint: "Users, sync health, audit log", adminOnly: true },
];

export function SettingsPage({ tab }: { tab: string }) {
  const { user } = useAuth();
  const { isMobile } = useViewport();
  const isAdmin = user?.role === "admin";
  const visible = TABS.filter((t) => isAdmin || !t.adminOnly);
  // A non-admin who follows a link to an admin tab lands on their account instead.
  const active = visible.find((t) => t.id === tab) ?? visible[0]!;

  // On phones the tab row scrolls sideways; keep the selected tab in view.
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (isMobile) activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [isMobile, active.id]);

  const nav = (
    <nav
      aria-label="Settings sections"
      style={
        isMobile
          ? { display: "flex", gap: 4, overflowX: "auto", scrollbarWidth: "none", marginBottom: 24, borderBottom: "1px solid var(--color-border)" }
          : { display: "flex", flexDirection: "column", gap: 2, width: 200, flexShrink: 0, position: "sticky", top: 24, alignSelf: "flex-start" }
      }
    >
      {visible.map((t, i) => {
        const on = t.id === active.id;
        const firstAdmin = !isMobile && t.adminOnly && !visible[i - 1]?.adminOnly;
        return (
          <div key={t.id}>
            {firstAdmin && <div style={styles.navGroup}>Admin only</div>}
            <a
              href={`/settings/${t.id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/settings/${t.id}`);
              }}
              aria-current={on ? "page" : undefined}
              ref={on ? activeRef : undefined}
              style={isMobile ? { ...styles.tabMobile, ...(on ? styles.tabMobileOn : null) } : { ...styles.tab, ...(on ? styles.tabOn : null) }}
            >
              <span style={{ display: "flex", alignItems: "center" }}>
                {t.label}
                <SectionCode code={t.code} inline />
              </span>
              {!isMobile && <span style={styles.tabHint}>{t.hint}</span>}
            </a>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div style={{ maxWidth: "1040px", margin: "0 auto", padding: isMobile ? "24px 16px 80px" : "40px 32px 80px" }}>
      <h1 style={styles.pageTitle}>Settings</h1>
      <div style={isMobile ? undefined : { display: "flex", gap: 40, alignItems: "flex-start" }}>
        {nav}
        <div style={{ flex: 1, minWidth: 0, maxWidth: active.id === "account" || active.id === "preferences" ? 640 : undefined }}>
          {active.id === "account" && (
            <>
              <ProfileSection />
              <BoardIdentitySection />
              <MondayConnectionSection />
            </>
          )}

          {active.id === "preferences" && <PreferencesSections />}

          {active.id === "firm" && (
            <>
              <AttorneyBoardsSection />
              <StatusTagsSection />
              <UrgencySettingsSection />
              <DocumentSettingsSection />
            </>
          )}

          {active.id === "admin" && (
            <>
              <UsersSection />
              <section style={{ marginBottom: "40px" }}>
                <h2 style={styles.sectionTitle}>Sync health<SectionCode code="P11.4.2" inline /></h2>
                <p style={styles.sectionDesc}>
                  Coverage of the last Monday.com sync (per board), the write-back queue, and archived rows
                  (reconciled-away but recoverable — nothing is hard-deleted).
                </p>
                <SyncHealthSection />
              </section>
              <AuditLogSection />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Styles (inline, consistent with the rest of the app)
// =============================================================================

const styles = {
  pageTitle: {
    fontFamily: "var(--font-display)",
    fontSize: "22px",
    fontWeight: 600,
    color: "var(--color-ink)",
    marginBottom: "32px",
  } as React.CSSProperties,

  sectionTitle: settingsSectionTitle,

  // Settings sub-nav: a column on desktop, a row of tabs on phones.
  tab: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "10px 12px",
    borderRadius: 8,
    textDecoration: "none",
    fontFamily: "var(--font-body)",
    fontSize: 14,
    fontWeight: 500,
    color: "var(--color-ink-muted)",
    borderLeft: "3px solid transparent",
  } as React.CSSProperties,

  tabOn: {
    backgroundColor: "var(--color-surface-warm)",
    color: "var(--color-ink)",
    fontWeight: 600,
    borderLeft: "3px solid var(--color-amber)",
  } as React.CSSProperties,

  tabHint: {
    fontSize: 12,
    fontWeight: 400,
    color: "var(--color-ink-faint)",
  } as React.CSSProperties,

  tabMobile: {
    display: "block",
    padding: "8px 12px",
    whiteSpace: "nowrap",
    textDecoration: "none",
    fontFamily: "var(--font-body)",
    fontSize: 14,
    color: "var(--color-ink-muted)",
    borderBottom: "2px solid transparent",
    marginBottom: -1,
  } as React.CSSProperties,

  tabMobileOn: {
    color: "var(--color-ink)",
    fontWeight: 600,
    borderBottom: "2px solid var(--color-amber)",
  } as React.CSSProperties,

  navGroup: {
    fontFamily: "var(--font-body)",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--color-ink-faint)",
    padding: "16px 12px 6px",
  } as React.CSSProperties,

  sectionDesc: {
    fontFamily: "var(--font-body)",
    fontSize: "13px",
    color: "var(--color-ink-faint)",
    marginBottom: "12px",
    lineHeight: 1.5,
  } as React.CSSProperties,

  card: {
    backgroundColor: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: "10px",
    overflow: "hidden",
    marginBottom: "0",
  } as React.CSSProperties,

  fieldRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 20px",
  } as React.CSSProperties,

  fieldLabel: {
    fontFamily: "var(--font-body)",
    fontSize: "14px",
    color: "var(--color-ink-muted)",
  } as React.CSSProperties,

  fieldValue: {
    fontFamily: "var(--font-body)",
    fontSize: "14px",
    color: "var(--color-ink)",
  } as React.CSSProperties,

  prefRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "24px",
    padding: "16px 20px",
  } as React.CSSProperties,

  prefLabel: {
    fontFamily: "var(--font-body)",
    fontSize: "14px",
    fontWeight: 500,
    color: "var(--color-ink)",
    marginBottom: "2px",
  } as React.CSSProperties,

  prefHint: {
    fontFamily: "var(--font-body)",
    fontSize: "12px",
    color: "var(--color-ink-faint)",
  } as React.CSSProperties,

  segmented: {
    display: "flex",
    backgroundColor: "var(--color-surface-warm)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    padding: "2px",
    gap: "2px",
    flexShrink: 0,
  } as React.CSSProperties,

  segBtn: {
    padding: "5px 14px",
    borderRadius: "6px",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font-body)",
    fontSize: "13px",
    transition: "background-color 0.15s ease, color 0.15s ease",
  } as React.CSSProperties,

  select: {
    padding: "6px 10px",
    borderRadius: "8px",
    border: "1px solid var(--color-border)",
    backgroundColor: "var(--color-card)",
    color: "var(--color-ink)",
    fontFamily: "var(--font-body)",
    fontSize: "13px",
    cursor: "pointer",
    flexShrink: 0,
  } as React.CSSProperties,

  toggle: {
    position: "relative" as const,
    width: "42px",
    height: "24px",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
    flexShrink: 0,
    transition: "background-color 0.2s ease",
    padding: 0,
  } as React.CSSProperties,

  toggleKnob: {
    position: "absolute" as const,
    top: "3px",
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    backgroundColor: "#fff",
    transition: "transform 0.2s ease",
    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
  } as React.CSSProperties,

  userRow: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "14px 20px",
  } as React.CSSProperties,

  avatar: {
    width: "34px",
    height: "34px",
    borderRadius: "50%",
    backgroundColor: "var(--color-amber)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "var(--font-body)",
    fontWeight: 600,
    fontSize: "12px",
    color: "#fff",
    flexShrink: 0,
  } as React.CSSProperties,

  userName: {
    fontFamily: "var(--font-body)",
    fontWeight: 500,
    fontSize: "14px",
    color: "var(--color-ink)",
  } as React.CSSProperties,

  userEmail: {
    fontFamily: "var(--font-body)",
    fontSize: "12px",
    color: "var(--color-ink-faint)",
  } as React.CSSProperties,

  youTag: {
    fontSize: "11px",
    color: "var(--color-ink-faint)",
    fontWeight: 400,
  } as React.CSSProperties,

  lastLogin: {
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    color: "var(--color-ink-faint)",
    flexShrink: 0,
    minWidth: "100px",
    textAlign: "right" as const,
  } as React.CSSProperties,

  roleBadge: {
    padding: "4px 12px",
    borderRadius: "20px",
    border: "1px solid",
    fontSize: "12px",
    fontFamily: "var(--font-body)",
    fontWeight: 500,
    flexShrink: 0,
  } as React.CSSProperties,

  errorBox: {
    backgroundColor: "var(--color-status-red-bg)",
    color: "var(--color-status-red)",
    border: "1px solid rgba(153,27,27,0.15)",
    borderRadius: "8px",
    padding: "10px 14px",
    fontSize: "13px",
    fontFamily: "var(--font-body)",
    marginBottom: "16px",
  } as React.CSSProperties,

  faint: {
    color: "var(--color-ink-faint)",
    fontFamily: "var(--font-body)",
    fontSize: "14px",
  } as React.CSSProperties,
};
