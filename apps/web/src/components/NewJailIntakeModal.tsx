// =============================================================================
// NewJailIntakeModal — capture a detainee enquiry at first contact
// =============================================================================
// The intake board has 95 columns; nobody fills those in while someone is on
// the phone. This captures what is actually known at first contact and leaves
// the rest for monday. Only the detainee's name is required — half a story
// taken live is still worth having.
//
// The fields themselves live in JailIntakeFields, shared with the "this call is
// a jail intake" section inside Log a call. They were separate until the two
// drifted apart.
//
// Opened from the Jail Intakes board and from both call popups — in that second
// case the caller's details come through prefilled and the intake links back to
// the call.
// =============================================================================

import { useState } from "react";
import { createJailIntake } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import {
  JailIntakeFields,
  emptyJailIntakeFields,
  hasIntakeName,
  toCreateJailIntakeInput,
  type JailIntakeFieldValues,
} from "./JailIntakeFields";

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
  const [fields, setFields] = useState<JailIntakeFieldValues>({
    ...emptyJailIntakeFields,
    pocName: initialPocName ?? "",
    pocPhone: initialPocPhone ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; pending: boolean } | null>(null);

  const submit = async () => {
    if (!hasIntakeName(fields)) {
      setError("Enter the detainee's name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await createJailIntake(toCreateJailIntakeInput(fields, { callLogItemId }));
      setDone({ name: res.name, pending: res.pending });
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create the intake");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[520px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 py-4 pr-12">
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>New jail intake</DialogTitle>
          <DialogDescription>
            {callLogItemId ? "Linked to this call" : "Everything else can be filled in on the board"}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
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
              <JailIntakeFields value={fields} onChange={setFields} />

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
