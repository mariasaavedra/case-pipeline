// =============================================================================
// Notice fields — everything read off a scanned notice, shown or edited
// =============================================================================
// One definition of the fields, their labels and their order, shared by the
// Mail page rows (P12.3) and the review popup (M15), so the two never drift.
//
// The editor sends only what changed; the server validates (a receipt number
// is 3 letters + 10 digits, dates must be dates…), re-matches the notice on
// the corrected fields, and keeps the original reading. Its per-field errors
// are shown under the input that caused them.
// =============================================================================

import { useState } from "react";
import type { FieldEdits, NoticeFields } from "../api";
import { Button } from "./ui/button";

type Kind = "text" | "list" | "date";

interface FieldDef {
  key: keyof FieldEdits;
  label: string;
  kind: Kind;
  placeholder?: string;
  /** Wider cell in the grid. */
  wide?: boolean;
  /** How a list's items are joined — names use ";" since a name may hold a comma. */
  separator?: string;
}

export const NOTICE_FIELDS: FieldDef[] = [
  { key: "noticeType", label: "Notice type", kind: "text", placeholder: "Receipt Notice" },
  { key: "caseType", label: "Case type", kind: "text", placeholder: "I130 - Petition for Alien Relative", wide: true },
  { key: "receiptNumbers", label: "Receipt No.", kind: "list", placeholder: "IOE0912345678" },
  { key: "receivedDate", label: "Received", kind: "date" },
  { key: "priorityDate", label: "Priority date", kind: "date" },
  { key: "noticeDate", label: "Notice date", kind: "date" },
  { key: "petitioner", label: "Petitioner", kind: "text", placeholder: "LAST, FIRST" },
  { key: "beneficiary", label: "Beneficiary", kind: "text", placeholder: "LAST, FIRST" },
  { key: "applicant", label: "Applicant", kind: "text", placeholder: "LAST, FIRST" },
  { key: "aNumbers", label: "A-Number", kind: "list", placeholder: "123-456-789" },
  // Found by looking every client up in the page text, so it's filled on any
  // document — a court notice, a letter — not only where an I-797 labels names.
  { key: "names", label: "Clients named", kind: "list", placeholder: "Norma X. ZAVALA LEIVA", wide: true, separator: "; " },
  { key: "dateOfBirth", label: "Date of birth", kind: "date" },
  { key: "section", label: "Section", kind: "text", wide: true },
];

const faint = { color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" } as const;
const ink = { color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatA(a: string): string {
  return a.length === 9 ? `A-${a.slice(0, 3)}-${a.slice(3, 6)}-${a.slice(6)}` : a;
}

/** A field's value as shown. Lists join; dates read like dates. */
export function displayValue(fields: NoticeFields, def: FieldDef): string | null {
  const v = fields[def.key as keyof NoticeFields];
  if (def.key === "aNumbers") return (v as string[]).map(formatA).join(", ") || null;
  if (Array.isArray(v)) return (v as string[]).join(def.separator ?? ", ") || null;
  if (def.kind === "date") return formatDate(v as string | null);
  return (v as string | null) || null;
}

/** Every field read off the notice. `showEmpty` lists blanks too (the popup does, the list doesn't). */
export function NoticeFieldsGrid({
  fields,
  original,
  showEmpty = false,
}: {
  fields: NoticeFields;
  /** The reading before a person corrected it; changed fields show what it was. */
  original?: NoticeFields | null;
  showEmpty?: boolean;
}) {
  const rows = NOTICE_FIELDS.map((def) => ({ def, value: displayValue(fields, def) })).filter((r) => showEmpty || r.value);
  if (rows.length === 0) {
    return (
      <p className="text-xs" style={faint}>
        Nothing could be read from these pages.
      </p>
    );
  }
  return (
    <div className="grid gap-x-5 gap-y-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
      {rows.map(({ def, value }) => {
        const was = original ? displayValue(original, def) : null;
        const changed = original != null && was !== value;
        return (
          <div key={def.key} className="flex flex-col gap-0.5 min-w-0" style={def.wide ? { gridColumn: "span 2" } : undefined}>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={faint}>
              {def.label}
            </span>
            <span className="text-sm break-words" style={{ ...ink, fontVariantNumeric: "tabular-nums", color: value ? "var(--color-ink)" : "var(--color-ink-faint)" }}>
              {value ?? "—"}
            </span>
            {changed && (
              <span className="text-[10px]" style={{ color: "var(--color-status-yellow)", fontFamily: "var(--font-body)" }}>
                read as {was ?? "blank"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function initialValue(fields: NoticeFields, def: FieldDef): string {
  const v = fields[def.key as keyof NoticeFields];
  if (Array.isArray(v)) return (v as string[]).join(def.separator ?? ", ");
  return (v as string | null) ?? "";
}

/** Edit form. Sends only the fields that changed. */
export function NoticeFieldsEditor({
  fields,
  saving,
  errors,
  onSave,
  onCancel,
}: {
  fields: NoticeFields;
  saving: boolean;
  errors: Record<string, string>;
  onSave: (edits: FieldEdits) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(NOTICE_FIELDS.map((d) => [d.key, initialValue(fields, d)])),
  );

  const submit = () => {
    const edits: Record<string, string> = {};
    for (const def of NOTICE_FIELDS) {
      const v = values[def.key] ?? "";
      if (v.trim() !== initialValue(fields, def).trim()) edits[def.key] = v;
    }
    onSave(edits as FieldEdits);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-x-4 gap-y-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
        {NOTICE_FIELDS.map((def) => {
          const err = errors[def.key];
          return (
            <label key={def.key} className="flex flex-col gap-1 min-w-0" style={def.wide ? { gridColumn: "1 / -1" } : undefined}>
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={faint}>
                {def.label}
                {def.kind === "list" ? (def.separator === "; " ? " (separate with ;)" : " (comma-separated)") : ""}
              </span>
              <input
                type={def.kind === "date" ? "date" : "text"}
                value={values[def.key] ?? ""}
                placeholder={def.placeholder}
                disabled={saving}
                aria-invalid={Boolean(err)}
                onChange={(e) => setValues((prev) => ({ ...prev, [def.key]: e.target.value }))}
                className="rounded-md px-2 py-1.5 text-sm"
                style={{
                  ...ink,
                  border: `1px solid ${err ? "var(--color-status-red)" : "var(--color-border-light)"}`,
                  background: "var(--color-surface)",
                }}
              />
              {err && (
                <span className="text-[11px]" style={{ color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
                  {err}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save and re-match"}
        </Button>
      </div>
    </form>
  );
}
