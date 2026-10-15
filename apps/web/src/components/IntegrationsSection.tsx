// =============================================================================
// IntegrationsSection (P11.5) — Slack + texting, side by side
// =============================================================================
// P11.5.1 Slack: connection status (mode from .env, bot, default channels),
//   every notification the app can post with an on/off switch and a channel
//   (default = the kind's channel from .env), how often the same failure may
//   repost, and "Send test message".
// P11.5.2 Texting: mode, sending number, "Check connection" (the same checks
//   as `npm run sms:check`). Templates stay in Firm setup → Text templates.
//
// Secrets and the on/off modes live in the server's .env; this page can't see
// or change them. Admin-only (the tab is). Rules: routes/integrations.ts.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  fetchIntegrations, fetchSlackChannels, updateNotifySettings, sendSlackTest, checkSmsConnection,
  type IntegrationsStatus, type NotifySettings, type SlackChannelInfo, type CheckStep, type SlackChannelKind,
} from "../api";
import { Button } from "./ui/button";
import { SectionCode } from "./ScreenCode";
import { settingsSectionTitle } from "./settingsStyles";
import { navigate } from "../router";

const desc = { fontSize: 13, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", marginBottom: 12, lineHeight: 1.5 } as const;
const subTitle = { fontSize: 13, fontWeight: 600, color: "var(--color-ink)", fontFamily: "var(--font-body)", margin: "18px 0 6px" } as const;
const inputStyle = { backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border-light)", color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;
const card = { border: "1px solid var(--color-border-light)", borderRadius: 10, padding: 16, marginBottom: 16 } as const;

const MODE_LABEL = {
  on: { text: "On", bg: "rgba(22,163,74,0.12)", fg: "#166534" },
  "dry-run": { text: "Test mode — logs only", bg: "var(--color-amber-light)", fg: "var(--color-ink)" },
  off: { text: "Off", bg: "var(--color-status-red-bg)", fg: "var(--color-status-red)" },
} as const;

function ModeBadge({ mode, envVar }: { mode: keyof typeof MODE_LABEL; envVar: string }) {
  const m = MODE_LABEL[mode];
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: m.bg, color: m.fg }}
      title={`${envVar} in the server's .env`}>
      {m.text}
    </span>
  );
}

function Steps({ steps }: { steps: CheckStep[] }) {
  return (
    <ul className="text-sm space-y-1 mt-2" style={{ fontFamily: "var(--font-body)" }}>
      {steps.map((s, i) => (
        <li key={i} style={{ color: s.ok ? "var(--color-ink)" : "var(--color-status-red)" }}>
          {s.ok ? "✓" : "✗"} {s.label}
          {s.fix && <div className="text-xs ml-4" style={{ color: "var(--color-ink-muted)" }}>→ {s.fix}</div>}
        </li>
      ))}
    </ul>
  );
}

const KIND_TITLE: Record<SlackChannelKind, string> = { events: "Workflow events", ops: "Failure alerts", alerts: "Morning summary" };

export function IntegrationsSection() {
  const [status, setStatus] = useState<IntegrationsStatus | null>(null);
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  const [channels, setChannels] = useState<SlackChannelInfo[] | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [testChannel, setTestChannel] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [smsCheck, setSmsCheck] = useState<{ ok: boolean; steps: CheckStep[] } | null>(null);
  const [checking, setChecking] = useState(false);

  const loadChannels = (refresh = false) =>
    fetchSlackChannels(refresh)
      .then((c) => { setChannels(c); setChannelError(null); })
      .catch((e: Error) => setChannelError(e.message));

  useEffect(() => {
    fetchIntegrations()
      .then((s) => {
        setStatus(s);
        setSettings(s.slack.settings);
        setTestChannel(s.slack.envChannels.events ?? s.slack.envChannels.ops ?? "");
        if (s.slack.tokenSet) void loadChannels();
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const nameOf = useMemo(() => {
    const m = new Map(channels?.map((c) => [c.id, c]) ?? []);
    return (id: string | null) => {
      if (!id) return null;
      const c = m.get(id);
      return c ? `${c.isPrivate ? "🔒" : "#"}${c.name}` : id;
    };
  }, [channels]);

  if (error) {
    return <div className="px-4 py-2 rounded-lg text-sm" style={{ backgroundColor: "var(--color-status-red-bg)", color: "var(--color-status-red)" }}>{error}</div>;
  }
  if (!status || !settings) return <p className="text-sm" style={{ color: "var(--color-ink-faint)" }}>Loading…</p>;

  const slack = status.slack;
  const bot = slack.bot;
  const setEvent = (key: string, p: Partial<{ enabled: boolean; channel: string | null }>) => {
    setSettings((s) => s && { ...s, events: { ...s.events, [key]: { ...s.events[key]!, ...p } } });
    setSavedAt(null);
  };

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      setSettings(await updateNotifySettings(settings));
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      await sendSlackTest(testChannel);
      setTestResult(`✓ Posted in ${nameOf(testChannel)} — check Slack.`);
    } catch (e) {
      setTestResult(`✗ ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  async function check() {
    setChecking(true);
    try {
      setSmsCheck(await checkSmsConnection());
    } catch (e) {
      setSmsCheck({ ok: false, steps: [{ ok: false, label: (e as Error).message }] });
    } finally {
      setChecking(false);
    }
  }

  /** A channel picker: "Default (#name)" + every channel the bot can post to. */
  const channelSelect = (value: string | null, kind: SlackChannelKind, onChange: (v: string | null) => void, label: string) => {
    const def = slack.envChannels[kind];
    return (
      <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}
        className="text-sm rounded px-2 py-1" style={{ ...inputStyle, maxWidth: 220 }} disabled={!channels && !value}>
        <option value="">{def ? `Default (${nameOf(def)})` : kind === "events" && slack.webhookSet ? "Default (old webhook)" : "Default — none set"}</option>
        {channels?.map((c) => (
          <option key={c.id} value={c.id} disabled={c.isPrivate && !c.isMember}>
            {c.isPrivate ? "🔒" : "#"}{c.name}{!c.isMember ? (c.isPrivate ? " — invite the bot first" : " (bot not in it)") : ""}
          </option>
        ))}
        {value && !channels?.some((c) => c.id === value) && <option value={value}>{value}</option>}
      </select>
    );
  };

  const kinds = (["events", "ops"] as const).filter((k) => slack.catalog.some((e) => e.kind === k));

  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={settingsSectionTitle}>Integrations<SectionCode code="P11.5" inline /></h2>
      <p style={desc}>
        What the app posts to Slack and how it texts clients. Passwords, tokens and the on/off switches live in the
        server&apos;s settings file — this page can see whether they&apos;re set, never what they are.
      </p>

      {/* ---------------- Slack ---------------- */}
      <div style={card}>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>Slack</h3>
          <SectionCode code="P11.5.1" inline />
          <ModeBadge mode={slack.mode} envVar="SLACK_MODE" />
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--color-ink-muted)" }}>
          {!slack.tokenSet
            ? "No bot token on the server (SLACK_BOT_TOKEN)."
            : bot && "error" in bot
              ? <span style={{ color: "var(--color-status-red)" }}>Slack refused the token: {bot.error}</span>
              : bot ? <>Posting as <strong>{bot.name}</strong> in {bot.team}.</> : null}
          {slack.mode === "dry-run" && " Test mode: posts are written to the server log instead of Slack."}
          {slack.mode === "off" && " Nothing is posted until SLACK_MODE is on."}
        </p>
        {channelError && <p className="text-xs mt-1" style={{ color: "var(--color-status-red)" }}>Channel list: {channelError}</p>}

        {kinds.map((kind) => (
          <div key={kind}>
            <h4 style={subTitle}>{KIND_TITLE[kind]}</h4>
            <table className="w-full">
              <tbody>
                {slack.catalog.filter((e) => e.kind === kind).map((e) => {
                  const s = settings.events[e.key] ?? { enabled: true, channel: null };
                  return (
                    <tr key={e.key} style={{ borderTop: "1px solid var(--color-border-light)", opacity: s.enabled ? 1 : 0.55 }}>
                      <td className="py-2 pr-2 align-top" style={{ width: 28 }}>
                        <input type="checkbox" checked={s.enabled} aria-label={`Post ${e.label}`}
                          onChange={(ev) => setEvent(e.key, { enabled: ev.target.checked })} />
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <div className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{e.label}</div>
                        <div className="text-xs" style={{ color: "var(--color-ink-faint)" }}>{e.description}</div>
                      </td>
                      <td className="py-2 align-top text-right">
                        {channelSelect(s.channel, e.kind, (v) => setEvent(e.key, { channel: v }), `Channel for ${e.label}`)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        <label className="flex items-center gap-2 text-sm mt-4" style={{ color: "var(--color-ink)" }}>
          The same failure posts again only after
          <input type="number" min={slack.opsRepeatLimits.min} max={slack.opsRepeatLimits.max} value={settings.opsRepeatMinutes}
            onChange={(e) => { setSettings({ ...settings, opsRepeatMinutes: Number(e.target.value) }); setSavedAt(null); }}
            className="w-20 rounded px-2 py-1 text-sm tabular-nums" style={inputStyle} />
          minutes
        </label>

        <div className="flex items-center gap-3 mt-4">
          <Button type="button" size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          {savedAt && <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>Saved</span>}
        </div>

        <h4 style={subTitle}>Send a test message</h4>
        <div className="flex items-center gap-2 flex-wrap">
          <select aria-label="Test channel" value={testChannel} onChange={(e) => setTestChannel(e.target.value)}
            className="text-sm rounded px-2 py-1" style={{ ...inputStyle, maxWidth: 240 }} disabled={!channels}>
            <option value="">Pick a channel…</option>
            {channels?.filter((c) => c.isMember || !c.isPrivate).map((c) => (
              <option key={c.id} value={c.id}>{c.isPrivate ? "🔒" : "#"}{c.name}</option>
            ))}
          </select>
          <Button type="button" size="sm" variant="outline" onClick={test} disabled={!testChannel || testing || !slack.tokenSet}>
            {testing ? "Sending…" : "Send test message"}
          </Button>
          <button type="button" className="text-xs hover:underline" style={{ color: "var(--color-ink-muted)" }}
            onClick={() => void loadChannels(true)} disabled={!slack.tokenSet}>
            Refresh channels
          </button>
        </div>
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-faint)" }}>
          Posts even in test mode. A private channel shows up only after <code>/invite @{bot && "name" in bot ? bot.name : "the bot"}</code> in it.
        </p>
        {testResult && <p className="text-sm mt-1" style={{ color: testResult.startsWith("✓") ? "var(--color-ink)" : "var(--color-status-red)" }}>{testResult}</p>}
      </div>

      {/* ---------------- Texting ---------------- */}
      <div style={card}>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>Texting (RingCentral)</h3>
          <SectionCode code="P11.5.2" inline />
          <ModeBadge mode={status.sms.mode} envVar="SMS_MODE" />
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--color-ink-muted)" }}>
          {status.sms.configured ? <>Texts go out from <strong>{status.sms.fromNumber}</strong>.</> : "RingCentral isn't set up on the server (RINGCENTRAL_*)."}
          {status.sms.mode === "dry-run" && " Test mode: texts are recorded, not sent."}
          {" "}{status.sms.templates} template{status.sms.templates === 1 ? "" : "s"} —{" "}
          <a href="/settings/firm" className="hover:underline" style={{ color: "var(--color-ink)" }}
            onClick={(e) => { e.preventDefault(); navigate("/settings/firm"); }}>edit in Firm setup → Text templates</a>.
        </p>
        <div className="mt-3">
          <Button type="button" size="sm" variant="outline" onClick={check} disabled={checking}>
            {checking ? "Checking…" : "Check connection"}
          </Button>
        </div>
        {smsCheck && <Steps steps={smsCheck.steps} />}
        <p className="text-xs mt-3" style={{ color: "var(--color-ink-faint)" }}>{status.sms.tenDlcNote}</p>
      </div>
    </section>
  );
}
