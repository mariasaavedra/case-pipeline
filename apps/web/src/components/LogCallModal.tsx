// =============================================================================
// LogCallModal — quick "someone's on the phone" popup (+ edit mode)
// =============================================================================
// Replaces the old flow (open Monday, create a Call Log item, remember to
// search + link the profile) with one popup: type the caller's phone number,
// pick the matching client if one comes up (pre-fills the name), add an
// optional note, submit. The name becomes the Monday item's name — matching
// the board's own convention; the note is posted as a comment/update on the
// entry instead, mirrored into the client's timeline when linked. Writes
// straight to the real Call Log board in Monday (POST /api/call-log) — same
// personal-token/queue-fallback rails as every other write-back in this app.
//
// Linking is deliberately NOT tied to the number that called. The phone field
// offers suggestions (matched against the client's Phone AND Phone 2, since
// people call from either), but a separate "Find the client" box searches the
// whole profile list by name/email/number — a spouse's phone, a shared office
// line, or a brand-new number all still reach the right client. Once linked,
// the client's recent 360-view notes appear inline so whoever answered has the
// context without leaving the popup.
//
// The caller's name is optional: an unnamed call is still a call, so a blank
// name falls back to the number dialled (the server does the same, so the two
// can't disagree — see routes/call-log-write.ts's resolveCallerName).
//
// Passing `entry` switches this into edit mode. Edit offers the SAME form as
// create — every field, plus the entry's existing note thread in place of the
// create-only "add a note" box — submitting through PATCH /api/call-log/:localId
// instead of POST.
// =============================================================================

import { useState, useRef, useEffect, useCallback } from "react";
import {
  searchClients,
  createCallLogEntry,
  updateCallLogEntry,
  fetchCallLogStaffDirectory,
  fetchCallLogNotes,
  addCallLogNote,
  stripMentionMarkers,
} from "../api";
import type { SearchResult, MondayStaffUser, CallLogEntry, MentionedUser, NoteThreadEntry } from "../api";
import { useBoardStatusOptions } from "../StatusOptionsProvider";
import { useAuth } from "../auth/useAuth";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { MentionTextarea } from "./MentionTextarea";
import { ProfileNotesPreview } from "./ProfileNotesPreview";

interface Props {
  onClose: () => void;
  /** Called after a call is successfully logged/edited (or queued), so a list view can refresh. */
  onLogged?: () => void;
  /** Present → edit mode: prefills every field from this entry and PATCHes it instead of creating a new call. */
  entry?: CallLogEntry;
}

// "Portugese" (no "u") is not a typo — it's Monday's actual live status label
// on the Language column (confirmed via a direct board-schema read); spelling
// it "Portuguese" here would fail server.ts's languageCol.options validation
// against the real synced label and reject every submission with that choice.
const LANGUAGE_OPTIONS = ["English", "Spanish", "Portugese"];

/** Digits before a phone lookup is worth running. */
const MIN_PHONE_DIGITS = 4;

/** Characters before a name lookup is worth running. */
const MIN_NAME_CHARS = 2;

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

/** Both numbers on file, for the suggestion row — either one may be why this
 * profile matched, and the front desk needs to see which. */
function contactLine(p: SearchResult): string {
  return [p.phone, p.phone2].filter(Boolean).join(" · ") || p.email || "";
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function NoteEntry({ entry, indent }: { entry: NoteThreadEntry; indent?: boolean }) {
  return (
    <div style={{ marginLeft: indent ? 20 : 0, marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", marginBottom: 2 }}>
        <strong style={{ color: "var(--color-ink-muted)" }}>{entry.authorName ?? "Unknown"}</strong> · {formatTimestamp(entry.createdAt)}
      </div>
      <div style={{ fontSize: 13, color: "var(--color-ink)", fontFamily: "var(--font-body)", whiteSpace: "pre-wrap" }}>
        {entry.body || <em style={{ color: "var(--color-ink-faint)" }}>(empty)</em>}
      </div>
      {entry.replies.map((r) => <NoteEntry key={r.id} entry={r} indent />)}
    </div>
  );
}

/**
 * One debounced, abortable client lookup. Two of these run independently — the
 * phone field's and the name field's — so a slow name search can't clobber the
 * results of a number typed after it.
 */
function useClientLookup() {
  const [matches, setMatches] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (controllerRef.current) controllerRef.current.abort();
    setMatches([]);
    setSearched(false);
    setSearching(false);
  }, []);

  const run = useCallback((value: string, minLength: (v: string) => boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (controllerRef.current) controllerRef.current.abort();

    if (!minLength(value)) {
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

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (controllerRef.current) controllerRef.current.abort();
  }, []);

  return { matches, searching, searched, run, reset };
}

/** The suggestion list under either search box. */
function MatchList({ matches, onSelect }: { matches: SearchResult[]; onSelect: (p: SearchResult) => void }) {
  return (
    <div style={{ marginBottom: 12, border: "1px solid var(--color-border-light)", borderRadius: 8, overflow: "hidden" }}>
      {matches.slice(0, 5).map((m, i) => (
        <button
          key={m.localId}
          type="button"
          onClick={() => onSelect(m)}
          style={{
            display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
            background: "var(--color-surface)", border: "none",
            borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)",
            cursor: "pointer", fontFamily: "var(--font-body)",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--color-ink)" }}>{m.name}</div>
          <div style={{ fontSize: 11, color: "var(--color-ink-faint)" }}>{contactLine(m)}</div>
        </button>
      ))}
    </div>
  );
}

export function LogCallModal({ onClose, onLogged, entry }: Props) {
  const isEdit = !!entry;
  const statusDef = useBoardStatusOptions("call_log");
  const { user } = useAuth();

  const [phone, setPhone] = useState(entry?.phone ?? "");
  const [clientQuery, setClientQuery] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<SearchResult | null>(
    entry?.profileLocalId
      ? { localId: entry.profileLocalId, name: entry.profileName ?? "", email: null, phone: null, phone2: null, address: null }
      : null,
  );

  const phoneLookup = useClientLookup();
  const nameLookup = useClientLookup();

  const [name, setName] = useState(entry?.name ?? "");
  const [note, setNote] = useState("");
  const [noteMentions, setNoteMentions] = useState<MentionedUser[]>([]);
  const [status, setStatus] = useState(entry?.status ?? "");
  const [showMore, setShowMore] = useState(false);
  const [language, setLanguage] = useState(entry?.language ?? "");
  const [staff, setStaff] = useState<MondayStaffUser[]>([]);
  const [takenById, setTakenById] = useState("");
  const [highlightedForId, setHighlightedForId] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; pending: boolean } | null>(null);

  // Default status once the board's real options load. In edit mode the entry's
  // own status is already the initial value, so this only fills a blank one.
  useEffect(() => {
    if (!status && statusDef?.options.length) {
      setStatus(statusDef.options.find((o) => o.label.toLowerCase() === "pending")?.label ?? statusDef.options[0]!.label);
    }
  }, [statusDef, status]);

  // Load the staff directory once. Creating a call auto-picks "Taken by" = the
  // signed-in user; editing one resolves the names already stored on the entry
  // back to their Monday ids (the list view only ever mirrors the names).
  useEffect(() => {
    fetchCallLogStaffDirectory()
      .then((users) => {
        setStaff(users);
        const byName = (n: string | null | undefined) =>
          n ? users.find((u) => u.name.toLowerCase() === n.toLowerCase())?.id ?? "" : "";
        if (isEdit && entry) {
          setTakenById(byName(entry.takenBy));
          setHighlightedForId(byName(entry.highlightedFor));
          return;
        }
        if (user) {
          const match = users.find(
            (u) => u.email.toLowerCase() === user.email.toLowerCase() || u.name.toLowerCase() === user.name.toLowerCase(),
          );
          if (match) setTakenById(match.id);
        }
      })
      .catch(() => setStaff([])); // Non-fatal — the people pickers just stay manual.
  }, [isEdit, entry, user]);

  // Edit mode opens prefilled with the phone already on file — without this,
  // an unlinked call whose phone matches a real client would show no match
  // list at all until staff manually retyped the number (the lookup only fires
  // from the input's onChange otherwise).
  useEffect(() => {
    if (isEdit && phone && !selectedProfile) {
      phoneLookup.run(phone, (v) => v.replace(/\D/g, "").length >= MIN_PHONE_DIGITS);
    }
    // Deliberately mount-only — re-running on every phone/selectedProfile
    // change would just duplicate what onPhoneChange already does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Edit mode's note section: the entry's real Monday comment thread, same
  // source as CallNotesModal. Only meaningful once the item exists in Monday.
  const [thread, setThread] = useState<NoteThreadEntry[] | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [notePending, setNotePending] = useState(false);

  const loadThread = useCallback(async () => {
    if (!entry) return;
    setThreadError(null);
    try {
      const res = await fetchCallLogNotes(entry.localId);
      setThread(res.updates);
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "Failed to load notes");
    }
  }, [entry]);

  useEffect(() => {
    if (isEdit) loadThread();
  }, [isEdit, loadThread]);

  const onPhoneChange = (value: string) => {
    setPhone(value);
    setSelectedProfile(null);
    nameLookup.reset();
    phoneLookup.run(value, (v) => v.replace(/\D/g, "").length >= MIN_PHONE_DIGITS);
  };

  const onClientQueryChange = (value: string) => {
    setClientQuery(value);
    phoneLookup.reset();
    nameLookup.run(value, (v) => v.trim().length >= MIN_NAME_CHARS);
  };

  const selectProfile = (p: SearchResult) => {
    setSelectedProfile(p);
    phoneLookup.reset();
    nameLookup.reset();
    setClientQuery("");
    // Pre-fill from the matched profile — staff can still override (e.g. someone
    // calling on the client's behalf) since this is just the starting value.
    if (!name.trim()) setName(p.name);
    // Only adopt the profile's number when the phone field is still blank or was
    // just a partial in-progress search string. A number already typed in full
    // is the number that actually called — which may be neither of the two on
    // file, and overwriting it would lose the only record of it.
    if (!phone.trim() && p.phone) setPhone(p.phone);
  };

  const unlink = () => {
    setSelectedProfile(null);
    // Re-open the match list immediately so staff can pick a different client
    // without having to retype the phone.
    if (phone) phoneLookup.run(phone, (v) => v.replace(/\D/g, "").length >= MIN_PHONE_DIGITS);
  };

  // A nameless call is logged under the number that dialled. Mirrors the
  // server's resolveCallerName so the preview here matches what gets written.
  const effectiveName = name.trim() || phone.trim();

  const submit = async () => {
    if (!effectiveName) {
      setError("Add the caller's name or phone number.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isEdit && entry) {
        await updateCallLogEntry(entry.localId, {
          name: effectiveName,
          phone: phone.trim(),
          profileLocalId: selectedProfile?.localId ?? null,
          status,
          language,
          takenByUserId: takenById || null,
          highlightedForUserId: highlightedForId || null,
        });
        onLogged?.();
        onClose();
        return;
      }
      const trimmedNote = note.trim();
      const res = await createCallLogEntry({
        name: effectiveName,
        note: trimmedNote ? stripMentionMarkers(trimmedNote, noteMentions) : undefined,
        phone: phone.trim() || undefined,
        status: status || undefined,
        language: language || undefined,
        profileLocalId: selectedProfile?.localId ?? null,
        takenByUserId: takenById || null,
        highlightedForUserId: highlightedForId || null,
        mentionedUserIds: noteMentions.length ? noteMentions.map((m) => m.id) : undefined,
      });
      setDone({ name: res.name, pending: res.pending });
      onLogged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${isEdit ? "save the call" : "log the call"}`);
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!entry || !note.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const trimmed = note.trim();
      const res = await addCallLogNote(
        entry.localId,
        stripMentionMarkers(trimmed, noteMentions),
        noteMentions.length ? noteMentions.map((m) => m.id) : undefined,
      );
      setNotePending(res.pending);
      setNote("");
      setNoteMentions([]);
      await loadThread();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add the note");
    } finally {
      setSaving(false);
    }
  };

  const logAnother = () => {
    setPhone("");
    setClientQuery("");
    phoneLookup.reset();
    nameLookup.reset();
    setSelectedProfile(null);
    setName("");
    setNote("");
    setNoteMentions([]);
    setLanguage("");
    setHighlightedForId("");
    setDone(null);
    setError(null);
  };

  const staffItems = [{ value: "", label: "—" }, ...staff.map((u) => ({ value: u.id, label: u.name }))];
  const languageItems = [{ value: "", label: "—" }, ...LANGUAGE_OPTIONS.map((l) => ({ value: l, label: l }))];

  // Whichever box the front desk is using drives the suggestions shown.
  const activeLookup = nameLookup.matches.length > 0 || nameLookup.searching || nameLookup.searched
    ? nameLookup
    : phoneLookup;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>{isEdit ? "Edit call" : "Log a call"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Updates the entry on the Call Log board in Monday.com" : "Creates the entry on the Call Log board in Monday.com"}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {done ? (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)" }}>
              <p style={{ marginBottom: 8 }}>
                ✓ Call logged as <strong>{done.name}</strong>
                {selectedProfile ? <> and linked to <strong>{selectedProfile.name}</strong></> : null}
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
                <>
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
                      onClick={unlink}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-ink-faint)" }}
                    >
                      Unlink
                    </button>
                  </div>
                  <ProfileNotesPreview profileLocalId={selectedProfile.localId} profileName={selectedProfile.name} />
                </>
              ) : (
                <>
                  {/* Linking is not limited to the number that called: this searches
                      every profile by name, email, or either number on file. */}
                  <label style={{ display: "block", marginBottom: 12 }}>
                    {fieldLabel("Find the client (any name or number)")}
                    <input
                      type="search"
                      value={clientQuery}
                      onChange={(e) => onClientQueryChange(e.target.value)}
                      placeholder="Search all clients by name…"
                      className="w-full rounded-md px-2 py-1.5 text-sm"
                      style={inputStyle}
                    />
                  </label>

                  {activeLookup.matches.length > 0 ? (
                    <MatchList matches={activeLookup.matches} onSelect={selectProfile} />
                  ) : activeLookup.searching ? (
                    <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 12 }}>Searching…</p>
                  ) : activeLookup.searched ? (
                    <p style={{ fontSize: 12, color: "var(--color-ink-faint)", marginBottom: 12 }}>
                      No matching profile — search by name above, or leave the call unlinked.
                    </p>
                  ) : null}
                </>
              )}

              <label style={{ display: "block", marginBottom: 12 }}>
                {fieldLabel("Caller's name (optional)")}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={phone.trim() ? `Defaults to ${phone.trim()}` : "Who's calling?"}
                  className="w-full rounded-md px-2 py-1.5 text-sm"
                  style={inputStyle}
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
                    <Select items={languageItems} value={language} onValueChange={(v) => setLanguage(v ?? "")}>
                      <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="w-[var(--anchor-width)]">
                        {languageItems.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
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

              {/* Notes. Creating a call posts one comment with the entry; editing
                  one appends to the same Monday thread, so the existing notes are
                  shown above the box rather than silently replaced. */}
              {isEdit && (
                <div style={{ marginBottom: 12, paddingTop: 4, borderTop: "1px solid var(--color-border-light)" }}>
                  {fieldLabel("Notes on this call")}
                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {threadError ? (
                    <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>{threadError}</p>
                  ) : thread === null ? (
                    <p style={{ fontSize: 12, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>Loading notes…</p>
                  ) : thread.length > 0 ? (
                    thread.map((u) => <NoteEntry key={u.id} entry={u} />)
                  ) : (
                    <p style={{ fontSize: 12, color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}>No notes yet.</p>
                  )}
                  </div>
                </div>
              )}

              {notePending && (
                <p style={{ fontSize: 12, color: "var(--color-amber-dark)", fontFamily: "var(--font-body)", marginBottom: 8 }}>
                  Note queued — Monday was unreachable, will sync shortly.
                </p>
              )}

              <label style={{ display: "block", marginBottom: 12 }}>
                {fieldLabel(isEdit ? "Add a note" : "Note (optional)")}
                <MentionTextarea
                  value={note}
                  onChange={setNote}
                  mentions={noteMentions}
                  onMentionsChange={setNoteMentions}
                  placeholder={
                    isEdit
                      ? "What's the update? Type @ to tag someone."
                      : "What did they need? Posted as a comment on the entry. Type @ to tag someone."
                  }
                  rows={3}
                />
              </label>

              {/* An edit's note posts on its own (the call already exists in
                  Monday, and a note is an append, not a field edit) so it can be
                  added without also re-saving the form. */}
              {isEdit && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                  <Button type="button" variant="outline" onClick={addNote} disabled={saving || !note.trim()}>
                    {saving ? "Working…" : "Add note"}
                  </Button>
                </div>
              )}

              {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>{error}</p>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <Button type="button" variant="outline" onClick={onClose}>{isEdit ? "Close" : "Cancel"}</Button>
                <Button type="button" onClick={submit} disabled={saving || !effectiveName}>
                  {isEdit ? (saving ? "Saving…" : "Save") : (saving ? "Logging…" : "Log call")}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
