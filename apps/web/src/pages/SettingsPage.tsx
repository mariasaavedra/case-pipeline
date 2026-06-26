import { useState, useEffect } from "react";
import { useAuth } from "../auth/useAuth";
import { usePreferences } from "../hooks/usePreferences";
import type { Theme, DefaultPage, DateFormat } from "../hooks/usePreferences";
import { apiFetch, fetchAttorneyBoards, addAttorneyBoard, deleteAttorneyBoard, fetchMondayStatus, getAzureToken } from "../api";
import type { AttorneyBoard } from "../api";

// =============================================================================
// User management (admin section)
// =============================================================================

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  created_at: string;
  last_login: string | null;
}

function UsersSection() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<UserRow[]>("/api/admin/users")
      .then(setUsers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
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

  return (
    <section>
      <h2 style={styles.sectionTitle}>Users</h2>
      <p style={styles.sectionDesc}>
        Users sign in automatically with their firm Microsoft account. Share the app URL with
        someone to give them access — their account is created on first login as a regular user.
        Promote them to admin here if needed.
      </p>

      {error && <div style={styles.errorBox}>{error}</div>}

      {loading ? (
        <div style={styles.faint}>Loading…</div>
      ) : (
        <div style={styles.card}>
          {users.map((u, i) => (
            <div
              key={u.id}
              style={{ ...styles.userRow, borderTop: i === 0 ? "none" : `1px solid var(--color-border)` }}
            >
              <div style={styles.avatar}>
                {u.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.userName}>
                  {u.name}
                  {u.id === user?.id && <span style={styles.youTag}> (you)</span>}
                </div>
                <div style={styles.userEmail}>{u.email}</div>
              </div>
              <div style={styles.lastLogin}>
                {u.last_login ? new Date(u.last_login + "Z").toLocaleDateString() : "Never signed in"}
              </div>
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
            </div>
          ))}
        </div>
      )}
    </section>
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
      <h2 style={styles.sectionTitle}>Attorney Appointment Boards</h2>
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
  const [status, setStatus] = useState<{ connected: boolean; mondayName?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

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
      <h2 style={styles.sectionTitle}>Monday.com Account</h2>
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
          </div>
          <button
            onClick={() => {
              setConnecting(true);
              setConnectError(null);
              getAzureToken()
                .then((token) => {
                  const qs = token ? `?az_token=${encodeURIComponent(token)}` : "";
                  window.location.href = `/api/auth/monday${qs}`;
                })
                .catch((err: unknown) => {
                  setConnecting(false);
                  setConnectError(err instanceof Error ? err.message : String(err));
                });
            }}
            disabled={connecting}
            style={{
              padding: "7px 16px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: status?.connected ? "var(--color-surface-warm)" : "var(--color-amber)",
              color: status?.connected ? "var(--color-ink-muted)" : "#fff",
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
// Main Settings page
// =============================================================================

export function SettingsPage() {
  const { user } = useAuth();
  const { prefs, update } = usePreferences();

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto", padding: "40px 24px 80px" }}>
      <h1 style={styles.pageTitle}>Settings</h1>

      {/* Profile */}
      <section style={{ marginBottom: "40px" }}>
        <h2 style={styles.sectionTitle}>Profile</h2>
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

      {/* Preferences */}
      <section style={{ marginBottom: "40px" }}>
        <h2 style={styles.sectionTitle}>Preferences</h2>
        <p style={styles.sectionDesc}>Stored locally in this browser.</p>

        <div style={styles.card}>
          {/* Theme */}
          <div style={styles.prefRow}>
            <div>
              <div style={styles.prefLabel}>Theme</div>
              <div style={styles.prefHint}>Switch between light and dark appearance</div>
            </div>
            <div style={styles.segmented}>
              {(["light", "dark"] as Theme[]).map((t) => (
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
                  {t === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
          </div>

          {/* Default page */}
          <div style={{ ...styles.prefRow, borderTop: `1px solid var(--color-border)` }}>
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

          {/* Sidebar collapsed */}
          <div style={{ ...styles.prefRow, borderTop: `1px solid var(--color-border)` }}>
            <div>
              <div style={styles.prefLabel}>Sidebar collapsed by default</div>
              <div style={styles.prefHint}>Start with the sidebar in icon-only mode</div>
            </div>
            <button
              onClick={() => update("sidebarCollapsedDefault", !prefs.sidebarCollapsedDefault)}
              style={{
                ...styles.toggle,
                backgroundColor: prefs.sidebarCollapsedDefault ? "var(--color-amber)" : "var(--color-border)",
              }}
              role="switch"
              aria-checked={prefs.sidebarCollapsedDefault}
            >
              <span
                style={{
                  ...styles.toggleKnob,
                  transform: prefs.sidebarCollapsedDefault ? "translateX(18px)" : "translateX(2px)",
                }}
              />
            </button>
          </div>

          {/* Date format */}
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
        </div>
      </section>

      {/* Monday.com personal account */}
      <MondayConnectionSection />

      {/* Attorney Boards */}
      <AttorneyBoardsSection />

      {/* Users — admin only */}
      {user?.role === "admin" && <UsersSection />}
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

  sectionTitle: {
    fontFamily: "var(--font-body)",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: "var(--color-ink-faint)",
    marginBottom: "8px",
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
