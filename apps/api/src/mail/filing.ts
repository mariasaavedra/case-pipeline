// =============================================================================
// Filing a piece of mail (P12 → M31): the rules, no I/O
// =============================================================================
// A staff member uploads one piece of mail, checks what was read, picks the
// client, and files it. The browser saves the PDF to the client's E-File → CC
// folder and e-mails the client from the staff member's own Outlook; the API
// then records the decision, updates the Open Form (receipt fields only) and
// posts the note below on the client's profile. The PDF itself never stays on
// this server (decided 2026-10-23).
// =============================================================================

import type { NoticeFields } from "@case-pipeline/query";
import { EMAIL_RE } from "../contract-info.js";

export interface FileMailInput {
  profileLocalId: string;
  openFormLocalId: string | null;
  savedTo: { url: string; fileName: string; folder: string };
  emailedTo: string | null;
  note: string | null;
}

const MAX_NOTE = 2000;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Where the file landed must be the firm's SharePoint, nowhere else. */
function isSharePointUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname.endsWith(".sharepoint.com");
  } catch {
    return false;
  }
}

export function parseFileMailInput(raw: unknown): FileMailInput | { error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const profileLocalId = str(body.profileLocalId);
  if (!profileLocalId) return { error: "Pick the client" };
  const saved = (body.savedTo ?? {}) as Record<string, unknown>;
  const url = str(saved.url);
  const fileName = str(saved.fileName);
  if (!url || !fileName || !isSharePointUrl(url)) return { error: "Save the letter to the client's E-File first" };
  const emailedTo = str(body.emailedTo);
  if (emailedTo && !EMAIL_RE.test(emailedTo)) return { error: "That e-mail address isn't valid" };
  const note = str(body.note);
  if (note && note.length > MAX_NOTE) return { error: `The note is too long (${MAX_NOTE} characters at most)` };
  return {
    profileLocalId,
    openFormLocalId: str(body.openFormLocalId),
    savedTo: { url, fileName: fileName.slice(0, 200), folder: (str(saved.folder) ?? "E-File → CC").slice(0, 300) },
    emailedTo,
    note,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** What the letter is, in one line: "Receipt Notice · I130 - PETITION… · Receipt IOE…". */
export function mailSummary(f: NoticeFields): string {
  return [
    f.noticeType ?? "Letter",
    f.caseType ?? f.formType,
    f.receiptNumbers.length ? `Receipt ${f.receiptNumbers.join(", ")}` : null,
    f.noticeDate ? `dated ${f.noticeDate}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The automatic note on the client's profile (a Monday update, HTML). */
export function mailFiledNote(opts: { fields: NoticeFields; input: FileMailInput; openFormName: string | null }): string {
  const { fields, input, openFormName } = opts;
  const parts = [
    `<p>📬 Mail received: <strong>${esc(mailSummary(fields))}</strong>${openFormName ? ` (Open Form “${esc(openFormName)}”)` : ""}.</p>`,
    `<p>Saved in ${esc(input.savedTo.folder)}: <a href="${esc(input.savedTo.url)}">${esc(input.savedTo.fileName)}</a></p>`,
    input.emailedTo ? `<p>E-mailed to the client at ${esc(input.emailedTo)}.</p>` : `<p>The client was not e-mailed.</p>`,
  ];
  if (input.note) parts.push(`<p>${esc(input.note).replace(/\n/g, "<br>")}</p>`);
  return parts.join("");
}

/** A link column as Monday stores it: {url, text}, or a bare string in older rows. */
export function linkUrl(v: unknown): string | null {
  const raw = v && typeof v === "object" ? (v as { url?: unknown }).url : v;
  return typeof raw === "string" && /^https?:\/\//i.test(raw.trim()) ? raw.trim() : null;
}
