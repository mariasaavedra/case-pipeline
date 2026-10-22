// =============================================================================
// SlackMessageEditor — the words + send time of a queued Slack message
// =============================================================================
// Shared by M18 step 2 (queue the attorney's "LB's 1:00 PM Ready") and P17's
// Slack Queue tab (edit it). The text is Slack's own markup — *bold*,
// <url|label> links, <@U…> mentions — so a preview under the box shows what
// the attorney will see. See routes/slack-queue.ts.
// =============================================================================

import type { ReactNode } from "react";

const fieldStyle = {
  border: "1px solid var(--color-border-light)",
  background: "var(--color-surface)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-body)",
} as const;

const labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-ink-muted)",
  marginBottom: 4,
  fontFamily: "var(--font-body)",
} as const;

/** One line of Slack mrkdwn → React: *bold*, <url|label>, <@U…> (shown as @attorney). */
function renderLine(line: string, mention: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /<@([UW][A-Z0-9]+)>|<(https?:\/\/[^|>]+)\|([^>]+)>|<(https?:\/\/[^>]+)>|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const k = `${m.index}`;
    if (m[1]) out.push(<span key={k} style={{ background: "rgba(29,155,209,0.12)", color: "#1264a3", borderRadius: 3, padding: "0 2px" }}>@{mention}</span>);
    else if (m[2]) out.push(<a key={k} href={m[2]} target="_blank" rel="noopener noreferrer" style={{ color: "#1264a3" }}>{m[3]}</a>);
    else if (m[4]) out.push(<a key={k} href={m[4]} target="_blank" rel="noopener noreferrer" style={{ color: "#1264a3" }}>{m[4]}</a>);
    else if (m[5]) out.push(<strong key={k}>{m[5]}</strong>);
    last = re.lastIndex;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function SlackPreview({ text, mention }: { text: string; mention: string }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
      {text.split("\n").map((l, i) => (
        <div key={i}>{renderLine(l, mention).map((n) => (typeof n === "string" ? unescape(n) : n))}</div>
      ))}
    </div>
  );
}

export interface SlackMessageValue {
  text: string;
  sendDate: string;
  sendTime: string;
}

export function SlackMessageEditor({ value, onChange, mention, disabled }: {
  value: SlackMessageValue;
  onChange: (v: SlackMessageValue) => void;
  /** Who a <@U…> mention stands for, for the preview. */
  mention: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <label style={{ flex: 1 }}>
          <span style={labelStyle}>Send on</span>
          <input type="date" value={value.sendDate} disabled={disabled}
            onChange={(e) => onChange({ ...value, sendDate: e.target.value })}
            className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
        </label>
        <label style={{ flex: 1 }}>
          <span style={labelStyle}>At (Central)</span>
          <input type="time" value={value.sendTime} disabled={disabled}
            onChange={(e) => onChange({ ...value, sendTime: e.target.value })}
            className="w-full rounded-md px-2 py-1.5 text-sm" style={fieldStyle} />
        </label>
      </div>
      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={labelStyle}>Message</span>
        <textarea value={value.text} disabled={disabled} rows={5} maxLength={2000}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          className="w-full rounded-md px-2 py-1.5 text-sm" style={{ ...fieldStyle, fontFamily: "var(--font-mono)", resize: "vertical" }} />
        <span style={{ display: "block", fontSize: 11, color: "var(--color-ink-faint)", marginTop: 3, fontFamily: "var(--font-body)" }}>
          Slack markup: *bold*, &lt;link|label&gt;, &lt;@U…&gt; tags the attorney.
        </span>
      </label>
      <div style={{ borderLeft: "3px solid var(--color-border)", padding: "6px 10px", background: "var(--color-surface-warm)", borderRadius: 4 }}>
        <span style={{ ...labelStyle, marginBottom: 2, fontSize: 11 }}>Preview</span>
        <SlackPreview text={value.text} mention={mention} />
      </div>
    </div>
  );
}

/** "Slack is off" / "no channel" — why a queued message won't reach anyone. Null = fine. */
export function slackWarning(s: { mode: string; enabled: boolean; channel: string | null }): string | null {
  if (s.mode === "off") return "Slack is off on this server (SLACK_MODE) — queued messages will fail instead of posting.";
  if (!s.enabled) return "\"Consult ready\" is turned off in Settings → Integrations — queued messages will fail.";
  if (!s.channel) return "No Slack channel set for \"Consult ready\" — an admin sets it in Settings → Integrations.";
  if (s.mode === "dry-run") return "Slack is in dry-run on this server: messages are logged, not posted.";
  return null;
}
