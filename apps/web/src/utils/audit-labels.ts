// =============================================================================
// Audit log → plain English (P11.4.3)
// =============================================================================
// The API stores machine names ("monday.status_changed") plus a free-form
// metadata blob per action. This turns one entry into a sentence a paralegal
// can read. Unknown actions fall back to a tidied version of the raw name, so a
// new action the API starts logging still shows up — just less prettily.
// =============================================================================

type Meta = Record<string, unknown>;

export interface AuditActionFamily {
  /** Value sent as ?action= (prefix match on the API). */
  value: string;
  label: string;
}

/** Filter options, in the order the dropdown shows them. */
export const AUDIT_FAMILIES: { group: string; options: AuditActionFamily[] }[] = [
  {
    group: "Changes in Monday.com",
    options: [
      { value: "monday", label: "All Monday.com changes" },
      { value: "monday.status_changed", label: "Status changes" },
      { value: "monday.column_changed", label: "Field edits" },
      { value: "monday.update_posted", label: "Notes posted" },
      { value: "monday.call_logged", label: "Calls logged" },
      { value: "monday.appointment_created", label: "Appointments booked" },
      { value: "monday.contract_created", label: "Contracts created" },
      { value: "monday.jail_intake_created", label: "Jail intakes created" },
    ],
  },
  {
    group: "In this app",
    options: [
      { value: "mail", label: "Mail scans and assignments" },
      { value: "doc", label: "Documents generated" },
      { value: "user", label: "Users and roles" },
      { value: "sync", label: "Sync repairs" },
    ],
  },
  {
    group: "Firm settings",
    options: [
      { value: "attorney_board", label: "Attorney boards" },
      { value: "status_overrides", label: "Status tags" },
      { value: "urgency_settings", label: "Urgency" },
      { value: "kpi_columns", label: "Dashboard card columns" },
    ],
  },
];

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function quoted(v: unknown): string {
  const s = str(v);
  return s ? `“${s}”` : "(empty)";
}

/** "status_overrides.updated" → "Status overrides updated". */
function tidy(action: string): string {
  const s = action.replace(/[._]/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface AuditDescription {
  /** One short sentence, e.g. "Changed status to “Received”". */
  title: string;
  /** Optional second line with the before/after or other specifics. */
  detail: string | null;
  /** True when Monday was down and the change waited in the write queue. */
  queued: boolean;
}

export function describeAudit(action: string, metadata: unknown): AuditDescription {
  const m: Meta = metadata && typeof metadata === "object" ? (metadata as Meta) : {};
  const queued = m.queued === true;
  const d = (title: string, detail: string | null = null): AuditDescription => ({ title, detail, queued });

  switch (action) {
    case "monday.status_changed":
      return d(`Changed status to ${quoted(m.to)}`, str(m.from) ? `Was ${quoted(m.from)}` : null);
    case "monday.column_changed":
      return d(`Edited a field${str(m.columnId) ? ` (${m.columnId})` : ""}`, str(m.value) ? `Set to ${quoted(m.value)}` : null);
    case "monday.update_posted":
      return d("Posted a note");
    case "monday.call_logged":
      return d("Logged a call", str(m.status) ? `Outcome ${quoted(m.status)}` : null);
    case "monday.call_edited":
      return d("Edited a call");
    case "monday.call_note_added":
      return d(m.replyTo ? "Replied on a call" : "Added a note to a call");
    case "monday.appointment_created":
      return d("Booked an appointment");
    case "monday.contract_created":
      return d("Created a contract", str(m.caseType) ? `Case type ${quoted(m.caseType)}` : null);
    case "monday.jail_intake_created":
      return d("Created a jail intake");
    case "monday.jail_intake_note_added":
      return d("Added a note to a jail intake");
    case "doc.generated":
      return d("Generated a document", str(m.template) ? `Template ${quoted(m.template)}` : null);
    case "mail.scan":
      return d("Scanned mail");
    case "mail.writeback":
      return d("Wrote a mail notice back to its Open Form");
    case "mail.review.assign":
      return d("Assigned a mail notice", str(m.note));
    case "mail.review.dismiss":
      return d("Dismissed a mail notice", str(m.note));
    case "user.role_changed":
      return d(`Made ${str(m.email) ?? "a user"} ${m.role === "admin" ? "an admin" : "a regular user"}`);
    case "user.profile_updated": {
      const changed = Array.isArray(m.changed) ? m.changed.join(", ") : null;
      return d(`Updated ${str(m.email) ?? "a user"}`, changed ? `Changed ${changed}` : null);
    }
    case "attorney_board.added":
      return d(`Added attorney board ${quoted(m.displayName)}`);
    case "attorney_board.updated":
      return d(`Updated attorney board${str(m.displayName) ? ` ${quoted(m.displayName)}` : ""}`);
    case "attorney_board.removed":
      return d("Removed an attorney board");
    case "status_overrides.updated":
      return d("Updated status tags", typeof m.count === "number" ? `${m.count} custom tags in total` : null);
    case "urgency_settings.updated":
      return d("Updated urgency settings");
    case "kpi_columns.updated":
      return d("Changed the dashboard card columns");
    case "sync.row_restored":
      return d("Restored an archived row");
    case "sync.write_queue_cleared":
      return d("Cleared failed Monday.com writes", typeof m.removed === "number" ? `${m.removed} removed` : null);
    default:
      return d(tidy(action));
  }
}

/** "2026-09-29 14:03:11" (UTC, as stored) → the reader's local calendar day, "2026-09-29". */
export function localDayKey(createdAt: string): string {
  return ymd(new Date(createdAt.replace(" ", "T") + "Z"));
}

/** A Date's local calendar day as "YYYY-MM-DD". */
export function ymd(t: Date): string {
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
