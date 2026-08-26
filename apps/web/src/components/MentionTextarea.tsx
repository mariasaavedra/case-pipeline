// =============================================================================
// MentionTextarea — a plain textarea with @mention autocomplete
// =============================================================================
// Typing "@" opens a dropdown of staff (same directory LogCallModal already
// uses for Taken by/Highlighted for); picking one inserts a readable "@Full
// Name " token. The dropdown renders below the textarea rather than at the
// exact caret position — precise caret-coordinate tracking needs mirroring
// the text into a hidden div to measure, which is finicky; for a small,
// fixed-size compose box "below the box" is close enough and keeps this
// dependency-free.
//
// `mentions` is reconciled on every keystroke against the visible text (an
// "@Name" token that's been edited or deleted just falls out of the list) —
// simple recompute, not incremental diffing. The caller is responsible for
// stripping the "@" before sending the text to Monday (see
// `stripMentionMarkers` in api.ts) — mentions_list alone drives Monday's
// rendering/notification, per Monday's own docs.
// =============================================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { fetchCallLogStaffDirectory } from "../api";
import type { MentionedUser } from "../api";

interface Props {
  value: string;
  onChange: (value: string) => void;
  mentions: MentionedUser[];
  onMentionsChange: (mentions: MentionedUser[]) => void;
  placeholder?: string;
  rows?: number;
}

interface Candidate {
  id: string;
  name: string;
}

function findMentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  const upToCursor = text.slice(0, cursor);
  const at = upToCursor.lastIndexOf("@");
  if (at === -1) return null;
  const query = upToCursor.slice(at + 1);
  if (/\s/.test(query)) return null; // the "@" started a token that's since ended
  const precedingChar = at > 0 ? upToCursor[at - 1] : null;
  if (precedingChar && !/\s/.test(precedingChar)) return null; // e.g. "user@email"
  return { start: at, query };
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--color-border-light)",
  background: "var(--color-surface)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-body)",
};

export function MentionTextarea({ value, onChange, mentions, onMentionsChange, placeholder, rows = 3 }: Props) {
  const [staff, setStaff] = useState<Candidate[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [queryStart, setQueryStart] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchCallLogStaffDirectory()
      .then((users) => setStaff(users.map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => setStaff([])); // Non-fatal — mentions just stay unavailable.
  }, []);

  const matches = open ? staff.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6) : [];

  const reconcile = useCallback(
    (text: string) => {
      const stillPresent = mentions.filter((m) => text.includes(`@${m.name}`));
      if (stillPresent.length !== mentions.length) onMentionsChange(stillPresent);
    },
    [mentions, onMentionsChange],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);
    reconcile(text);

    const cursor = e.target.selectionStart ?? text.length;
    const found = findMentionQuery(text, cursor);
    if (found) {
      setOpen(true);
      setQuery(found.query);
      setQueryStart(found.start);
      setHighlighted(0);
    } else {
      setOpen(false);
    }
  };

  const select = (candidate: Candidate) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? value.length;
    const before = value.slice(0, queryStart);
    const after = value.slice(cursor);
    const inserted = `@${candidate.name} `;
    const nextValue = `${before}${inserted}${after}`;
    onChange(nextValue);
    if (!mentions.some((m) => m.id === candidate.id)) {
      onMentionsChange([...mentions, { id: candidate.id, name: candidate.name }]);
    }
    setOpen(false);
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      textarea?.focus();
      textarea?.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      select(matches[highlighted]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)} // let a click on a suggestion land first
        placeholder={placeholder}
        rows={rows}
        className="w-full rounded-md px-2 py-1.5 text-sm"
        style={{ ...inputStyle, resize: "vertical" }}
      />
      {open && matches.length > 0 && (
        <div
          role="listbox"
          className="status-menu"
          style={{
            position: "absolute", zIndex: 40, top: "100%", left: 0, marginTop: 4,
            width: "100%", maxHeight: 200, overflowY: "auto",
            backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)",
            borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 4,
          }}
        >
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => e.preventDefault()} // keep textarea focus/selection through the click
              onClick={() => select(m)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6,
                border: "none", background: i === highlighted ? "var(--color-surface-warm)" : "transparent",
                cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink)",
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
