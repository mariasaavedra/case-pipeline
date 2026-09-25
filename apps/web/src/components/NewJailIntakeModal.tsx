// =============================================================================
// NewJailIntakeModal — capture a detainee enquiry at first contact
// =============================================================================
// The intake board has 95 columns; nobody fills those in while someone is on
// the phone. This captures what is actually known at first contact and leaves
// the rest for monday. Only the detainee's name is required — half a story
// taken live is still worth having.
//
// Opened from two places: the Jail Intakes board, and the notes popup on a call,
// since a call is often where an intake starts. In that second case the caller's
// details come through prefilled and the new intake is linked back to the call.
// =============================================================================

import { useState } from "react";
import { createJailIntake } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";

// The board's own Language options, in its order.
const LANGUAGES = [
  "Hindi", "English", "Espanol", "Arabic", "French", "Farsi",
  "Tigrinya", "Creole", "Quiche", "Russian", "Vietnamese", "Portuguese",
];

const labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-ink-muted)",
  marginBottom: 4,
  fontFamily: "var(--font-body)",
} as const;

const fieldStyle = {
  border: "1px solid var(--color-border-light)",
  background: "var(--color-surface)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-body)",
} as const;

interface Props {
  onClose: () => void;
  /** Refresh the list behind the modal once something was created. */
  onCreated?: () => void;
  /** Set when opened from a call — links the intake back to it. */
  callLogItemId?: string | null;
  /** Prefill from the call: whoever rang, and on what number. */
  initialPocName?: string;
  initialPocPhone?: string;
}

export function NewJailIntakeModal({
  onClose,
  onCreated,
  callLogItemId,
  initialPocName,
  initialPocPhone,
}: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jail, setJail] = useState("");
  const [alienNumber, setAlienNumber] = useState("");
  const [language, setLanguage] = useState("");
  const [pocName, setPocName] = useState(initialPocName ?? "");
  const [pocPhone, setPocPhone] = useState(initialPocPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; pending: boolean } | null>(null);

  const languageItems = [
    { value: "", label: "Select…" },
    ...LANGUAGES.map((l) => ({ value: l, label: l })),
  ];

  const submit = async () => {
    if (!firstName.trim() && !lastName.trim()) {
      setError("Enter the detainee's name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await createJailIntake({
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        jail: jail.trim() || undefined,
        alienNumber: alienNumber.trim() || undefined,
        language: language || undefined,
        pocName: pocName.trim() || undefined,
        pocPhone: pocPhone.trim() || undefined,
        callLogItemId: callLogItemId ?? undefined,
      });
      setDone({ name: res.name, pending: res.pending });
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create the intake");
    } finally {
      setSaving(false);
    }
  };

  const text = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder?: string,
  ) => (
    <label style={{ display: "block", marginBottom: 12, flex: 1 }}>
      <span style={labelStyle}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md px-2 py-1.5 text-sm"
        style={fieldStyle}
      />
    </label>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[520px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>New jail intake</DialogTitle>
          <DialogDescription>
            {callLogItemId ? "Linked to this call" : "Everything else can be filled in on the board"}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
          {done ? (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)" }}>
              <p style={{ marginBottom: 8 }}>
                ✓ Intake for <strong>{done.name}</strong>{" "}
                {done.pending ? "queued (will sync to Monday shortly)" : "created in Monday"}.
              </p>
              <p style={{ fontSize: 12, color: "var(--color-ink-faint)" }}>
                It will appear on the Jail Intakes board after the next sync.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 rounded-md px-3 py-1.5 text-sm"
                style={{
                  background: "var(--color-amber-light)",
                  color: "var(--color-amber)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10 }}>
                {text("First name", firstName, setFirstName)}
                {text("Last name", lastName, setLastName)}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                {text("Facility", jail, setJail, "e.g. Kay County")}
                {text("A-number", alienNumber, setAlienNumber, "000-000-000")}
              </div>

              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={labelStyle}>Language</span>
                <Select items={languageItems} value={language} onValueChange={(v) => setLanguage(v ?? "")}>
                  <SelectTrigger size="sm" className="w-full border-border-light bg-surface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="w-[var(--anchor-width)]">
                    <SelectItem value="">Select…</SelectItem>
                    {languageItems.slice(1).map((i) => (
                      <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <div style={{ display: "flex", gap: 10 }}>
                {text("Point of contact", pocName, setPocName, "Name and relationship")}
                {text("Their phone", pocPhone, setPocPhone)}
              </div>

              {error && (
                <p role="alert" style={{ fontSize: 12, color: "var(--color-status-red)", marginBottom: 8 }}>
                  {error}
                </p>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                  Cancel
                </Button>
                <Button type="button" onClick={submit} disabled={saving}>
                  {saving ? "Creating…" : "Create intake"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
