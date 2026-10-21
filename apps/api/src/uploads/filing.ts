// =============================================================================
// Client uploads → the client's E-File → CAF: the rules (no I/O)
// =============================================================================
// Shared by the filing script (scripts/client-uploads.ts, which uploads) and
// the API job (uploads/job.ts, which tells staff). docs/features/client-uploads.md.
// =============================================================================

/** The E-File subfolder client uploads go in (decided 2026-10-21). */
export const CAF_FOLDER = "CAF";

/** Minutes after a link's last file before its batch is filed: a client sending 8 photos is one batch. */
export const QUIET_MINUTES = 10;

/** A file that failed this many times waits for a person (the Slack ops post says so). */
export const MAX_ATTEMPTS = 8;

/** Uploads with nowhere to go this long get an ops post. */
export const WAITING_ALERT_HOURS = 24;

interface Child {
  name: string;
  folder?: unknown;
  file?: unknown;
  size?: number;
}

/** An existing CAF folder, any capitalisation. */
export function pickCafFolder<T extends Child>(children: T[]): T | null {
  return children.find((c) => c.folder && c.name.trim().toLowerCase() === CAF_FOLDER.toLowerCase()) ?? null;
}

/**
 * Already in CAF: same name and size. A run that uploaded but died before
 * stamping the row finds its own file here instead of filing it twice.
 */
export function alreadyFiled<T extends Child>(children: T[], name: string, size: number): T | null {
  return children.find((c) => c.file && c.name.toLowerCase() === name.toLowerCase() && c.size === size) ?? null;
}

const KIND_WORDS: Record<string, [string, string]> = {
  id: ["ID", "IDs"],
  notice: ["notice", "notices"],
  evidence: ["evidence", "evidence"],
  other: ["document", "documents"],
};

/** "2 notices, 1 ID" — most first. */
export function kindSummary(kinds: string[]): string {
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => {
      const [one, many] = KIND_WORDS[k] ?? KIND_WORDS.other!;
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(", ");
}

export interface FiledFile {
  storedName: string;
  kind: string;
  note: string | null;
  sharepointUrl: string;
  filedWhere: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** The Monday update on the client's profile: what came in, each file linked. Notes are the client's own words. */
export function uploadNoteHtml(files: FiledFile[]): string {
  const where = files[0]?.filedWhere ?? "E-File";
  const items = files
    .map((f) => {
      const note = f.note ? ` — “${escapeHtml(f.note)}”` : "";
      return `<li><a href="${escapeHtml(f.sharepointUrl)}">${escapeHtml(f.storedName)}</a>${note}</li>`;
    })
    .join("");
  return `<p>📤 The client sent ${files.length === 1 ? "1 document" : `${files.length} documents`} through their upload link (${kindSummary(files.map((f) => f.kind))}). Filed in their ${escapeHtml(where)} → ${CAF_FOLDER}.</p><ul>${items}</ul>`;
}
