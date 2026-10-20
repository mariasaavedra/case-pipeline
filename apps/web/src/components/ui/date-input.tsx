// =============================================================================
// DateInput — every typed date is MM/DD/YYYY
// =============================================================================
// <input type="date"> shows whatever order the browser's locale picks, so the
// same field read 20/10/2026 on one desk and 10/20/2026 on the next. This one
// is always typed American-style; the value in and out stays ISO (YYYY-MM-DD,
// "" when empty), so it drops in where a date input was — same `value`,
// `onChange(e.target.value)`, `min` / `max`.
//
// Slashes are added while typing ("10202026" → 10/20/2026), a 2-digit year
// means 20xx, and the calendar button opens the browser's own picker. Only a
// real date inside min/max reaches onChange; anything else is flagged and, on
// leaving the field, put back to the last good value.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/** ISO YYYY-MM-DD → MM/DD/YYYY ("" stays ""). */
export function isoToUs(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/** MM/DD/YYYY (or M/D/YY) → ISO, or null when it isn't a real date. "" → "". */
export function usToIso(text: string): string | null {
  const t = text.trim();
  if (t === "") return "";
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yyyy = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Slashes as they type: digits only → MM/DD/YYYY; typed slashes are kept. */
export function maskUsDate(raw: string): string {
  if (raw.includes("/")) return raw.replace(/[^\d/]/g, "").slice(0, 10);
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

interface Props {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  min?: string;
  max?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}

export function DateInput({ value, onChange, min, max, id, className, style, autoFocus, disabled, "aria-label": ariaLabel }: Props) {
  const [text, setText] = useState(() => isoToUs(value));
  const picker = useRef<HTMLInputElement>(null);

  // Follow the value when it changes from outside (a reset, the picker).
  useEffect(() => {
    setText((t) => (usToIso(t) === (value ?? "") ? t : isoToUs(value)));
  }, [value]);

  const iso = usToIso(text);
  const outOfRange = !!iso && ((!!min && iso < min) || (!!max && iso > max));
  const invalid = iso === null || outOfRange;
  const problem = iso === null
    ? "Type the date as MM/DD/YYYY"
    : outOfRange
      ? max && iso > max ? `Not after ${isoToUs(max)}` : `Not before ${isoToUs(min)}`
      : undefined;

  const type = (raw: string) => {
    const next = maskUsDate(raw);
    setText(next);
    const parsed = usToIso(next);
    if (parsed !== null && !(parsed && ((min && parsed < min) || (max && parsed > max)))) onChange({ target: { value: parsed } });
  };

  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); }
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", width: className?.includes("w-full") || style?.width === "100%" ? "100%" : undefined }}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="MM/DD/YYYY"
        autoComplete="off"
        maxLength={10}
        value={text}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        title={problem}
        className={className}
        style={{ ...style, paddingRight: 28, ...(invalid ? { borderColor: "var(--urgency-overdue)" } : null) }}
        onChange={(e) => type(e.target.value)}
        onBlur={() => { if (invalid) setText(isoToUs(value)); }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open calendar"
        disabled={disabled}
        onClick={openPicker}
        style={{ position: "absolute", right: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-ink-faint)", lineHeight: 0 }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
      </button>
      {/* The browser's calendar, opened from the button; never typed in. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value ?? ""}
        min={min}
        max={max}
        onChange={(e) => { setText(isoToUs(e.target.value)); onChange({ target: { value: e.target.value } }); }}
        style={{ position: "absolute", right: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none", border: 0, padding: 0 }}
      />
    </span>
  );
}
