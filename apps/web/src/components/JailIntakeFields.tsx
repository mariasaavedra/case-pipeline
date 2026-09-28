// =============================================================================
// JailIntakeFields — the intake capture fields, in one place
// =============================================================================
// Two screens create a jail intake: the New intake popup, and the "this call is
// a jail intake" section inside Log a call. They were built separately, and the
// moment four fields were added to the popup the inline version silently fell
// behind — it kept creating intakes with Description, Country of birth, Date of
// birth and Prior removal left empty, with nothing to signal it.
//
// So the fields live here and both hosts render the same set. Adding a field
// reaches both, or neither.
//
// `omit` exists because Log a call already knows some of this: the caller IS the
// point of contact, and the call's language is reused. Those inputs would be
// asking twice.
// =============================================================================

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  INTAKE_LANGUAGES,
  PRIOR_REMOVAL_OPTIONS,
  type JailIntakeFieldValues,
  type JailIntakeFieldName,
} from "./jail-intake-fields";

export {
  INTAKE_LANGUAGES,
  PRIOR_REMOVAL_OPTIONS,
  emptyJailIntakeFields,
  toCreateJailIntakeInput,
  hasIntakeName,
} from "./jail-intake-fields";
export type { JailIntakeFieldValues, JailIntakeFieldName } from "./jail-intake-fields";

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
  value: JailIntakeFieldValues;
  onChange: (next: JailIntakeFieldValues) => void;
  /** Fields the host already knows and will supply itself. */
  omit?: JailIntakeFieldName[];
}

export function JailIntakeFields({ value, onChange, omit = [] }: Props) {
  const hidden = new Set(omit);
  const set = (k: JailIntakeFieldName) => (v: string) => onChange({ ...value, [k]: v });

  const text = (k: JailIntakeFieldName, label: string, placeholder?: string) => (
    <label style={{ display: "block", marginBottom: 12, flex: 1 }}>
      <span style={labelStyle}>{label}</span>
      <input
        type="text"
        value={value[k]}
        onChange={(e) => set(k)(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md px-2 py-1.5 text-sm"
        style={fieldStyle}
      />
    </label>
  );

  /** A Select must NOT be wrapped in a label — see the note in ui/select usage:
   *  a labelable trigger gets a second, synthesized click and the popover shuts. */
  const select = (k: JailIntakeFieldName, label: string, options: string[], blank: string) => {
    const items = [{ value: "", label: blank }, ...options.map((o) => ({ value: o, label: o }))];
    return (
      <div style={{ display: "block", marginBottom: 12, flex: 1 }}>
        <span style={labelStyle}>{label}</span>
        <Select items={items} value={value[k]} onValueChange={(v) => set(k)(v ?? "")}>
          <SelectTrigger aria-label={label} size="sm" className="w-full border-border-light bg-surface">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-[var(--anchor-width)]">
            <SelectItem value="">{blank}</SelectItem>
            {items.slice(1).map((i) => (
              <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const row = (...children: React.ReactNode[]) => {
    const kept = children.filter(Boolean);
    if (kept.length === 0) return null;
    return <div style={{ display: "flex", gap: 10 }}>{kept}</div>;
  };

  return (
    <>
      {row(text("firstName", "Detainee first name"), text("lastName", "Detainee last name"))}
      {row(text("jail", "Facility", "e.g. Kay County"), text("alienNumber", "A-number", "000-000-000"))}
      {row(
        text("countryOfBirth", "Country of birth"),
        // A TEXT column on the board, not a date: it holds "03/07/1980" and
        // "05-27-95" alike, so a picker would impose a format the board does not use.
        text("dateOfBirth", "Date of birth", "MM/DD/YYYY"),
      )}
      {row(
        !hidden.has("language") && select("language", "Language", INTAKE_LANGUAGES, "Select…"),
        select("priorRemoval", "Prior removal?", PRIOR_REMOVAL_OPTIONS, "Not asked"),
      )}
      {row(
        !hidden.has("pocName") && text("pocName", "Point of contact", "Name and relationship"),
        !hidden.has("pocPhone") && text("pocPhone", "Their phone"),
      )}
      <label style={{ display: "block", marginBottom: 12 }}>
        <span style={labelStyle}>Description</span>
        <textarea
          value={value.description}
          onChange={(e) => set("description")(e.target.value)}
          rows={3}
          placeholder="What the caller told you…"
          className="w-full rounded-md px-2 py-1.5 text-sm"
          style={{ ...fieldStyle, resize: "vertical" }}
        />
      </label>
    </>
  );
}
