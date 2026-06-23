import { useState, useEffect } from "react";
import { useAuth } from "../auth/useAuth";
import { apiFetch } from "../api";

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  created_at: string;
  last_login: string | null;
}

export function AdminPage() {
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
    if (target.id === user?.id) return; // can't demote yourself
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
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "22px",
          fontWeight: 600,
          color: "var(--color-ink)",
          marginBottom: "6px",
        }}
      >
        User Management
      </h1>
      <p style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", fontSize: "13px", marginBottom: "28px" }}>
        Manage who can access Case Pipeline and their permission level.
      </p>

      {error && (
        <div
          style={{
            backgroundColor: "var(--color-status-red-bg)",
            color: "var(--color-status-red)",
            border: "1px solid rgba(153,27,27,0.15)",
            borderRadius: "8px",
            padding: "10px 14px",
            fontSize: "13px",
            fontFamily: "var(--font-body)",
            marginBottom: "16px",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", fontSize: "14px" }}>
          Loading…
        </div>
      ) : (
        <div
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          {users.map((u, i) => (
            <div
              key={u.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                padding: "14px 20px",
                borderTop: i === 0 ? "none" : "1px solid var(--color-border)",
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  backgroundColor: "var(--color-amber)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-body)",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {u.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "14px", color: "var(--color-ink)" }}>
                  {u.name}
                  {u.id === user?.id && (
                    <span style={{ marginLeft: "8px", fontSize: "11px", color: "var(--color-ink-faint)" }}>(you)</span>
                  )}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--color-ink-faint)" }}>
                  {u.email}
                </div>
              </div>

              {/* Last login */}
              <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--color-ink-faint)", flexShrink: 0, display: "none" }}
                className="md:block">
                {u.last_login ? new Date(u.last_login + "Z").toLocaleDateString() : "Never"}
              </div>

              {/* Role badge + toggle */}
              <button
                onClick={() => toggleRole(u)}
                disabled={updating === u.id || u.id === user?.id}
                style={{
                  flexShrink: 0,
                  padding: "4px 12px",
                  borderRadius: "20px",
                  border: "1px solid",
                  fontSize: "12px",
                  fontFamily: "var(--font-body)",
                  fontWeight: 500,
                  cursor: u.id === user?.id ? "default" : "pointer",
                  opacity: updating === u.id ? 0.5 : 1,
                  backgroundColor: u.role === "admin" ? "rgba(245, 158, 11, 0.1)" : "var(--color-surface)",
                  borderColor: u.role === "admin" ? "rgba(245, 158, 11, 0.4)" : "var(--color-border)",
                  color: u.role === "admin" ? "var(--color-amber)" : "var(--color-ink-faint)",
                }}
                title={u.id === user?.id ? "Cannot change your own role" : `Change to ${u.role === "admin" ? "user" : "admin"}`}
              >
                {u.role}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
