// =============================================================================
// BuzonClientSection — this client's Buzón texts, inside M30 (docs/features/buzon.md)
// =============================================================================
// "No automatic texts" (VAWA / U visa / a phone someone else may read): the
// app never texts them on its own — the link, reminders and thank-you texts
// stop. Reminders: the firm's days (Settings → Firm → Buzón), off, or this
// client's own days. "Remind now" sends the reminder at once (a person pressed
// it, so it works even with automatic texts off). Then the texts sent so far.
// API = routes/buzon.ts.
// =============================================================================

import { useEffect, useState } from "react";
import { fetchClientBuzon, remindNow, updateClientBuzon, type BuzonText, type ClientBuzon, type ClientBuzonSettings } from "../api";
import { Button } from "./ui/button";
import { shortDate } from "./UploadLinkModal";
import { parseDays } from "./BuzonSettingsSection";

const KIND: Record<BuzonText["kind"], string> = {
  link: "Link (automatic)",
  reminder: "Reminder",
  received: "\"We received\"",
  remind_now: "Reminder (Remind now)",
  gave_up: "Every reminder went — staff told",
};
const STATUS: Record<BuzonText["status"], string> = { sent: "sent", dry_run: "test mode, not sent", failed: "not sent", skipped: "" };

const inputStyle = { border: "1px solid var(--color-border-light)", background: "var(--color-surface)", color: "var(--color-ink)" } as const;

export function BuzonClientSection({ profileLocalId, refreshKey = 0 }: { profileLocalId: string; refreshKey?: number }) {
  const [data, setData] = useState<ClientBuzon | null>(null);
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchClientBuzon(profileLocalId)
      .then((d) => { setData(d); setDays((d.settings.days ?? d.firmReminders.days).join(", ")); })
      .catch((e: Error) => setError(e.message));
  }, [profileLocalId, refreshKey]);

  async function save(s: ClientBuzonSettings) {
    setBusy(true);
    setError(null);
    try {
      setData(await updateClientBuzon(profileLocalId, s));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remind() {
    if (!data || !window.confirm(`Text ${data.client.name} a reminder now?`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await remindNow(profileLocalId);
      setData(r);
      setNotice(r.status === "dry_run" ? "Test mode: recorded, not sent." : "Reminder sent.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p role="alert" className="text-xs" style={{ color: "var(--color-status-red)" }}>{error}</p> : null;
  const s = data.settings;
  const mode = s.reminders ?? "firm";

  return (
    <div className="space-y-2" data-testid="buzon-client">
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)" }}>Texts</span>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={s.noAutoTexts} disabled={busy} onChange={(e) => save({ ...s, noAutoTexts: e.target.checked })} />
        No automatic texts for this client
      </label>
      {s.noAutoTexts && (
        <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
          The app won&apos;t text the link, reminders or &quot;we received&quot; on its own. Staff can still text from here.
        </p>
      )}
      {!s.noAutoTexts && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span style={{ color: "var(--color-ink-muted)" }}>Reminders:</span>
          <select className="rounded px-1 py-1 text-xs" style={inputStyle} value={mode} disabled={busy} aria-label="Reminders"
            onChange={(e) => {
              const v = e.target.value;
              void save({ ...s, reminders: v === "firm" ? null : (v as "off" | "custom"), days: v === "custom" ? parseDays(days) : null });
            }}>
            <option value="firm">{data.firmReminders.on ? `Firm default (days ${data.firmReminders.days.join(", ")})` : "Firm default (off)"}</option>
            <option value="off">Off for this client</option>
            <option value="custom">Their own days</option>
          </select>
          {mode === "custom" && (
            <>
              <input className="rounded px-2 py-1 text-xs" style={{ ...inputStyle, width: 90 }} value={days} aria-label="This client's reminder days"
                onChange={(e) => setDays(e.target.value)} onBlur={() => save({ ...s, reminders: "custom", days: parseDays(days) })} />
              <span style={{ color: "var(--color-ink-faint)" }}>days after the first text</span>
            </>
          )}
          {data.nextReminder && <span style={{ color: "var(--color-ink-faint)" }}>· next {shortDate(data.nextReminder.slice(0, 19).replace("T", " "))}</span>}
        </div>
      )}

      {data.missing.length > 0 && (
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy || !data.canRemind} onClick={remind}
            title={data.canRemind ? `Texts: still missing — ${data.missing.join(", ")}` : "Needs an active link that can be resent, a phone number and texting on"}>
            Remind now
          </Button>
          {!data.canRemind && (
            <span className="text-xs" style={{ color: "var(--color-ink-faint)" }}>
              {data.client.hasPhone ? "Make a new link first (this one can't be resent)." : "No US phone on the profile."}
            </span>
          )}
        </div>
      )}
      {notice && <p className="text-xs" style={{ color: "var(--color-status-green)" }}>{notice}</p>}

      {data.texts.length > 0 && (
        <ul className="text-xs space-y-0.5" style={{ color: "var(--color-ink-muted)" }}>
          {data.texts.map((t, i) => (
            <li key={i}>
              {shortDate(t.sentAt)} · {KIND[t.kind]}
              {STATUS[t.status] ? ` · ${STATUS[t.status]}` : ""}
              {t.error ? ` (${t.error})` : ""}
              {t.byName ? ` · ${t.byName}` : ""}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs" style={{ color: "var(--color-status-red)" }}>{error}</p>}
    </div>
  );
}
