import { useState, useRef, useEffect } from "react";
import type { ClientUpdate } from "../api";
import { postProfileUpdate, fetchMondayStatus } from "../api";
import { Link } from "./Link";

interface Props {
  profileLocalId: string;
  onPosted: (update: ClientUpdate) => void;
  compact?: boolean;
}

export function NoteComposer({ profileLocalId, onPosted, compact = false }: Props) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mondayConnected, setMondayConnected] = useState<boolean | null>(null);

  useEffect(() => {
    fetchMondayStatus()
      .then((s) => setMondayConnected(s.connected))
      .catch(() => setMondayConnected(false));
  }, []);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || status === "loading") return;

    setStatus("loading");
    setErrorMsg("");
    try {
      const newUpdate = await postProfileUpdate(profileLocalId, trimmed);
      onPosted(newUpdate);
      setText("");
      setStatus("idle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to post update");
      setStatus("error");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div
      className="rounded-xl p-4"
      style={{
        border: "1px solid var(--color-border-light)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      {mondayConnected === false && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 mb-3 text-xs"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-amber) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)",
            color: "var(--color-ink)",
            fontFamily: "var(--font-body)",
            lineHeight: 1.5,
          }}
        >
          <span style={{ fontSize: 15 }}>Hey!</span>
          <span>
            Your Monday.com account isn't connected — notes will post under the firm's shared account.{" "}
            <Link
              href="/settings"
              style={{
                color: "var(--color-amber)",
                fontWeight: 600,
                textDecoration: "underline",
              }}
            >
              Connect your account →
            </Link>
          </span>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => { setText(e.target.value); setStatus("idle"); setErrorMsg(""); }}
        onKeyDown={handleKeyDown}
        placeholder="Add a note to this profile… (⌘↵ to post)"
        rows={compact ? 2 : 3}
        disabled={status === "loading"}
        style={{
          width: "100%",
          resize: "vertical",
          border: "none",
          outline: "none",
          background: "transparent",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          color: "var(--color-ink)",
          lineHeight: 1.6,
        }}
      />
      <div
        className="flex items-center justify-between mt-3 pt-3"
        style={{ borderTop: "1px solid var(--color-border-light)" }}
      >
        {errorMsg ? (
          <span className="text-xs" style={{ color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
            {errorMsg}
          </span>
        ) : (
          <span className="text-xs" style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>
            Posts to Monday.com and appears in the timeline
          </span>
        )}
        <button
          onClick={() => void handleSubmit()}
          disabled={!text.trim() || status === "loading"}
          className="text-xs font-semibold px-4 py-1.5 rounded-lg transition-opacity"
          style={{
            backgroundColor: "var(--color-amber)",
            color: "#fff",
            border: "none",
            cursor: !text.trim() || status === "loading" ? "not-allowed" : "pointer",
            opacity: !text.trim() || status === "loading" ? 0.5 : 1,
            fontFamily: "var(--font-body)",
          }}
        >
          {status === "loading" ? "Posting…" : "Post Note"}
        </button>
      </div>
    </div>
  );
}
