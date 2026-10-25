// =============================================================================
// Client upload page — the file queue and the upload call
// =============================================================================
// Two files at a time (phones on slow data choke on more), each its own POST
// so a dropped connection loses one file, not the batch. XHR rather than
// fetch: fetch can't report upload progress.
// =============================================================================

import type { KindKey, Strings } from "./strings";

/** Same limit as the API (apps/api/src/uploads/rules.ts MAX_FILE_BYTES). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const CONCURRENCY = 2;

export type ErrorKey = keyof Strings["errors"];

export type ItemState =
  | { s: "waiting" }
  | { s: "sending"; pct: number }
  | { s: "done"; duplicate: boolean }
  | { s: "error"; error: ErrorKey; retry: boolean };

export interface QueueItem {
  id: number;
  file: File;
  kind: KindKey;
  note: string;
  /** The checklist document it is sent for (the Buzón list), else undefined. */
  itemId?: number;
  state: ItemState;
}

/** Checked before sending, so a 200 MB video fails at once, not after a long wait. */
export function precheck(file: { size: number }): ErrorKey | null {
  if (file.size === 0) return "other";
  if (file.size > MAX_FILE_BYTES) return "tooBig";
  return null;
}

/** The waiting items to start now, oldest first. */
export function toStart(items: QueueItem[], concurrency = CONCURRENCY): QueueItem[] {
  const busy = items.filter((i) => i.state.s === "sending").length;
  return items.filter((i) => i.state.s === "waiting").slice(0, Math.max(0, concurrency - busy));
}

/** The API's answer → what to tell the client, and whether "Try again" can help. */
export function errorFor(status: number, code?: string): { error: ErrorKey; retry: boolean } {
  if (status === 0) return { error: "network", retry: true };
  if (status === 404) return { error: "dead", retry: false };
  if (status === 413) return code === "link_full" ? { error: "linkFull", retry: false } : { error: "tooBig", retry: false };
  if (status === 415) return { error: "type", retry: false };
  if (status === 429) return { error: "tooMany", retry: true };
  if (status === 400 && code === "item") return { error: "itemGone", retry: false };
  return { error: "other", retry: status >= 500 || status === 400 };
}

export function allSettled(items: QueueItem[]): boolean {
  return items.length > 0 && items.every((i) => i.state.s === "done" || i.state.s === "error");
}

export interface UploadOutcome {
  ok: boolean;
  status: number;
  duplicate?: boolean;
  code?: string;
}

export function uploadUrl(token: string, item: Pick<QueueItem, "file" | "kind" | "note" | "itemId">): string {
  const q = new URLSearchParams({ name: item.file.name || "photo.jpg", kind: item.kind });
  if (item.note.trim()) q.set("note", item.note.trim());
  if (item.itemId !== undefined) q.set("item", String(item.itemId));
  return `/api/u/${encodeURIComponent(token)}/files?${q}`;
}

export function sendFile(token: string, item: QueueItem, onProgress: (pct: number) => void): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl(token, item));
    // The API reads the type from the bytes; this only keeps express.json off the body.
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let body: { data?: { duplicate?: boolean }; code?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch { /* not JSON (a proxy's error page) */ }
      const ok = xhr.status >= 200 && xhr.status < 300;
      resolve({ ok, status: xhr.status, duplicate: body.data?.duplicate, code: body.code });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.ontimeout = () => resolve({ ok: false, status: 0 });
    xhr.timeout = 10 * 60_000;
    xhr.send(item.file);
  });
}
