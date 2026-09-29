import { useState } from "react";
import type { ClientUpdate, MentionedUser } from "../api";
import { postTimelineReply, stripMentionMarkers } from "../api";
import { Button } from "./ui/button";
import { MentionTextarea } from "./MentionTextarea";

interface Props {
  parent: ClientUpdate;
  onPosted: (reply: ClientUpdate) => void;
  onCancel: () => void;
}

/** Inline composer for a sub-note under one timeline entry. */
export function ReplyComposer({ parent, onPosted, onCancel }: Props) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<MentionedUser[]>([]);
  const [posting, setPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Monday threads replies under updates only; anything else goes out as a
  // "Re: …" update on the same item. Say which, so staff know where to look.
  const isMondayUpdate = parent.sourceType === "update" || parent.sourceType === "reply";
  const hint = isMondayUpdate
    ? "Posts as a reply under this update in Monday.com"
    : "Posts to Monday.com as a “Re:” update on the same item";

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setErrorMsg("");
    try {
      const reply = await postTimelineReply(
        parent.localId,
        stripMentionMarkers(trimmed, mentions),
        mentions.length ? mentions.map((m) => m.id) : undefined,
      );
      onPosted(reply);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to post sub-note");
      setPosting(false);
    }
  };

  return (
    <div
      className="rounded-lg p-3 mt-2"
      style={{ border: "1px solid var(--color-border-light)", backgroundColor: "var(--color-surface)" }}
    >
      <MentionTextarea
        value={text}
        onChange={(v) => { setText(v); setErrorMsg(""); }}
        mentions={mentions}
        onMentionsChange={setMentions}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void handleSubmit();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        placeholder="Add a sub-note… (⌘↵ to post, @ to tag someone)"
        rows={2}
        disabled={posting}
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
      <div className="flex items-center justify-between gap-2 mt-2">
        <span
          className="text-xs"
          style={{
            color: errorMsg ? "var(--color-status-red)" : "var(--color-ink-faint)",
            fontFamily: "var(--font-body)",
          }}
        >
          {errorMsg || hint}
        </span>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={posting}>
            Cancel
          </Button>
          <Button size="sm" className="font-semibold" onClick={() => void handleSubmit()} disabled={!text.trim() || posting}>
            {posting ? "Posting…" : "Post sub-note"}
          </Button>
        </div>
      </div>
    </div>
  );
}
