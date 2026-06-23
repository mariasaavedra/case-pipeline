import { useAuth } from "../auth/useAuth";

export function LoginPage() {
  const { login } = useAuth();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--color-bg)",
      }}
    >
      <div
        style={{
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "12px",
          padding: "48px 40px",
          width: "100%",
          maxWidth: "360px",
          textAlign: "center",
        }}
      >
        {/* Logo */}
        <div
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "10px",
            backgroundColor: "var(--color-amber)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "15px",
            color: "#fff",
          }}
        >
          CP
        </div>

        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "20px",
            fontWeight: 600,
            color: "var(--color-ink)",
            marginBottom: "6px",
          }}
        >
          Case Pipeline
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            color: "var(--color-ink-faint)",
            marginBottom: "32px",
          }}
        >
          Sign in with your firm Microsoft account
        </p>

        <button
          onClick={login}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            width: "100%",
            padding: "11px 16px",
            borderRadius: "8px",
            border: "1px solid var(--color-border)",
            backgroundColor: "#fff",
            color: "#1a1a1a",
            fontFamily: "var(--font-body)",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f5f5f5")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#fff")}
        >
          {/* Microsoft logo */}
          <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
            <rect x="1" y="1" width="9" height="9" fill="#F25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
            <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
          </svg>
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}
