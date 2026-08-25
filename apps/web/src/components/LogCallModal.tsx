// =============================================================================
// LogCallModal — quick "someone's on the phone" popup
// =============================================================================
// Replaces the old flow (open Monday, create a Call Log item, remember to
// search + link the profile) with one popup: type the caller's phone number,
// pick the matching client if one comes up (pre-fills the name), add an
// optional note, submit. The name becomes the Monday item's name — matching
// the board's own convention; the note is posted as a comment/update on the
// entry instead, mirrored into the client's timeline when linked. Writes
// straight to the real Call Log board in Monday (POST /api/call-log) — same
// personal-token/queue-fallback rails as every other write-back in this app.
// =============================================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { searchClients, createCallLogEntry, fetchCallLogStaffDirectory } from "../api";
import type { SearchResult, MondayStaffUser } from "../api";
import { useBoardStatusOptions } from "../StatusOptionsProvider";
import { useAuth } from "../auth/useAuth";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";

interface Props {
  onClose: () => void;
  /** Called after a call is successfully logged (or queued), so a list view can refresh. */
  onLogged?: () => void;
}

const LANGUAGE_OPTIONS = ["English", "Spanish", "Portugese"];

function fieldLabel(text: string) {
  return (
    <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-ink-muted)", marginBottom: 4, fontFamily: "var(--font-body)" }}>
      {text}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--color-border-light)",
  background: "var(--color-surface)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-body)",
};

export function LogCallModal({ onClose, onLogged }: Props) {
  const statusDef = useBoardStatusOptions("call_log");
  const { user } = useAuth();

  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<SearchResult | null>(null);

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [language, setLanguage] = useState("");
  const [staff, setStaff] = useState<MondayStaffUser[]>([]);
  const [takenById, setTakenById] = useState("");
  const [highlightedForId, setHighlightedForId] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; pending: boolean } | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Default status once the board's real options load.
  useEffect(() => {
    if (!status && statusDef?.options.length) {
      setStatus(statusDef.options.find((o) => o.label.toLowerCase() === "pending")?.label ?? statusDef.options[0]!.label);
    }
  }, [statusDef, status]);

  // Load the staff directory once, and auto-pick "Taken by" = the signed-in user.
  useEffect(() => {
    fetchCallLogStaffDirectory()
      .then((users) => {
        setStaff(users);
        if (user) {
          const match = users.find(
            (u) => u.email.toLowerCase() === user.email.toLowerCase() || u.name.toLowerCase() === user.name.toLowerCase(),
          );
          if (match) setTakenById(match.id);
        }
      })
      .catch(() => setStaff([])); // Non-fatal — "Taken by" just stays a manual pick.
  }, [user]);

  const runSearch = useCallback((value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (controllerRef.current) controllerRef.current.abort();

    const digits = value.replace(/\D/g, "");
    if (digits.length < 4) {
      setMatches([]);
      setSearched(false);
      return;
    }

    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setSearching(true);
      try {
        const results = await searchClients(value.trim(), controller.signal);
        setMatches(results);
        setSearched(true);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setMatches([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const onPhoneChange = (value: string) => {
    setPhone(value);
    setSelectedProfile(null);
    runSearch(value);
  };

  const selectProfile = (p: SearchResult) => {
    setSelectedProfile(p);
    setMatches([]);
    setSearched(false);
    // Pre-fill from the matched profile — staff can still override (e.g. someone
    // calling on the client's behalf) since this is just the starting value.
    // The phone field up to now may only be a partial/in-progress search
    // string (e.g. "816-605" typed while still looking the caller up), not a
    // real number — replace it with the profile's actual phone on file.
    if (!name.trim()) setName(p.name);
    if (p.phone) setPhone(p.phone);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Add the caller's name.");
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await createCallLogEntry({
        name: name.trim(),
        note: note.trim() || undefined,
        phone: phone.trim() || undefined,
        status: status || undefined,
        language: language || undefined,
        profileLocalId: selectedProfile?.localId ?? null,
        takenByUserId: takenById || null,
        highlightedForUserId: highlightedForId || null,
      });
      setDone({ name: res.name, pending: res.pending });
      onLogged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log the call");
    } finally {
      setSaving(false);
    }
  };

  const logAnother = () => {
    setPhone("");
    setMatches([]);
    setSearched(false);
    setSelectedProfile(null);
    setName("");
    setNote("");
    setLanguage("");
    setHighlightedForId("");
    setDone(null);
    setError(null);
  };

  const staffItems = [{ value: "", label: "—" }, ...staff.map((u) => ({ value: u.id, label: u.name }))];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Log a call</DialogTitle>
          <DialogDescription>Creates the entry on the Call Log board in Monday.com</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
          {done ? (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)" }}>
              <p style={{ marginBottom: 8 }}>
                ✓ Call logged{selectedProfile ? <> and linked to <strong>{selectedProfile.name}</strong></> : null}
                {done.pending ? " — queued (Monday was unreachable, will sync shortly)." : "."}
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <Button type="button" variant="outline" onClick={logAnother}>Log another call</Button>
                <Button type="button" onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              <label style={{ display: "block", marginBottom: 12 }}>
                {fieldLabel("Caller's phone")}
                <input
                  type="tel"
                  autoFocus
                  value={phone}
                  onChange={(e) => onPhoneChange(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="w-full rounded-md px-2 py-1.5 text-sm"
                  style={inputStyle}
                />
              </label>

              {selectedProfile ? (
                <div
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                    padding: "6px 10px", marginBottom: 12, borderRadius: 8,
                    background: "var(--color-amber-light)", border: "1px solid var(--color-border-light)",
                  }}
                >
                  <span style={{ fontSize: 13, fontFamily: "var(--font-body)", color: "var(--color-ink)" }}>
                    Linking to <strong>{selectedProfile.name}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedProfile(null)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-ink-faint)" }}
                  >
                    Unlink
                  </button>
                </div>
              ) : matches.length > 0 ? (
                <div style={{ marginBottom: 12, border: "1px solid var(--color-border-light)", borderRadius: 8, overflow: "hidden" }}>
                  {matches.slice(0, 5).map((m, i) => (
                    <button
                      key={m.localId}
                      type="button"
                      onClick={() => selectProfile(m)}
                      style={{
                        display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                        background: "var(--color-surface)", border: "none",
                        borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)",
                        cursor: "pointer", fontFamily: "var(--font-body)",
                      }}
                    >
                      <div style={{ fontSize: 13, color: "var(--color-ink)" }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>{m.phone ?? m.email ?? ""}</div>
                    </button>
                  ))}
                </div>
              ) : searching ? (
                <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 12 }}>Searching…</p>
              ) : searched ? (
                <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 12 }}>
                  No matching profile — the call will still be logged, just not linked to a client.
                </p>
              ) : null}

              <label style={{ display: "block", marginBottom: 12 }}>
                {fieldLabel("Caller's name")}
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Who's calling?"
                  className="w-full rounded-md px-2 py-1.5 text-sm"
                  style={inputStyle}
                />
              </label>

              <label style={{ display: "block", marginBottom: 12 }}>
                {fieldLabel("Note (optional)")}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What did they need? Posted as a comment on the entry."
                  rows={3}
                  className="w-full rounded-md px-2 py-1.5 text-sm"
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </label>

              <label style={{ display: "block", marginBottom: 12 }}>
                {fieldLabel("Status")}
                {statusDef && statusDef.options.length > 0 ? (
                  <Select items={statusDef.options.map((o) => ({ value: o.label, label: o.label }))} value={status} onValueChange={(v) => setStatus(v ?? "")}>
                    <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="w-[var(--anchor-width)]">
                      {statusDef.options.map((o) => <SelectItem key={o.index} value={o.label}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--color-status-red)" }}>Call Log status options not synced yet.</span>
                )}
              </label>

              <button
                type="button"
                onClick={() => setShowMore((s) => !s)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: showMore ? 12 : 4, fontSize: 12, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
              >
                {showMore ? "▾ Fewer options" : "▸ More options (language, taken by, highlight for)"}
              </button>

              {showMore && (
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <label style={{ flex: 1, display: "block" }}>
                    {fieldLabel("Language")}
                    <Select items={[{ value: "", label: "—" }, ...LANGUAGE_OPTIONS.map((l) => ({ value: l, label: l }))]} value={language} onValueChange={(v) => setLanguage(v ?? "")}>
                      <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="w-[var(--anchor-width)]">
                        <SelectItem value="">—</SelectItem>
                        {LANGUAGE_OPTIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </label>
                  <label style={{ flex: 1, display: "block" }}>
                    {fieldLabel("Taken by")}
                    <Select items={staffItems} value={takenById} onValueChange={(v) => setTakenById(v ?? "")}>
                      <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="w-[var(--anchor-width)]">
                        {staffItems.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </label>
                  <label style={{ flex: 1, display: "block" }}>
                    {fieldLabel("Highlight for")}
                    <Select items={staffItems} value={highlightedForId} onValueChange={(v) => setHighlightedForId(v ?? "")}>
                      <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="w-[var(--anchor-width)]">
                        {staffItems.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              )}

              {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{error}</p>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="button" onClick={submit} disabled={saving || !name.trim()}>
                  {saving ? "Logging…" : "Log call"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
