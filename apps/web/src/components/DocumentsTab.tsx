// =============================================================================
// Documents tab — SharePoint file browser
// =============================================================================
// Repurposed from the old "Documents & Notices" board list: this tab now browses
// the client's SharePoint e-file / consult folders in place. Graph is called
// directly from the browser with the signed-in user's delegated token, so nobody
// sees anything SharePoint wouldn't already show them.
// =============================================================================

import { useState, useMemo, useCallback } from "react";
import type { ClientCaseSummary } from "../api";
import { collectClientFolders, type ClientFolder } from "../sharepoint/collectFolders";
import {
  resolveFolder,
  listChildren,
  uploadFile,
  getGraphToken,
  GraphConsentRequiredError,
  GraphError,
  type DriveItem,
  type ResolvedItem,
} from "../sharepoint/graph";
import { SharePointPlaceholder } from "./SharePointPlaceholder";
import { FilePreviewModal } from "./FilePreviewModal";

interface Props {
  data: ClientCaseSummary;
}

interface Crumb {
  item: ResolvedItem;
  label: string;
}

type Status = "roots" | "loading" | "ready" | "consent" | "error";

const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-amber)" strokeWidth="1.6">
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </svg>
);
const FileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.6">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function describe(err: unknown): string {
  if (err instanceof GraphError) {
    if (err.status === 403) return "You don't have access to this folder in SharePoint.";
    if (err.status === 404) return "This link no longer exists in SharePoint (moved, renamed or expired).";
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function DocumentsTab({ data }: Props) {
  const folders = useMemo(() => collectClientFolders(data), [data]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [children, setChildren] = useState<DriveItem[]>([]);
  const [status, setStatus] = useState<Status>("roots");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{ driveId: string; item: DriveItem } | null>(null);

  /** Load a folder's children and set it as the deepest crumb. */
  const open = useCallback(async (item: ResolvedItem, trail: Crumb[]) => {
    setStatus("loading");
    setError(null);
    try {
      const kids = await listChildren(item.driveId, item.itemId);
      setChildren(kids);
      setCrumbs(trail);
      setStatus("ready");
    } catch (err) {
      if (err instanceof GraphConsentRequiredError) {
        setStatus("consent");
        return;
      }
      setError(describe(err));
      setStatus("error");
    }
  }, []);

  const openRoot = useCallback(
    async (folder: ClientFolder) => {
      // Not browsable (e.g. a saved search) → just hand it to SharePoint.
      if (!folder.parsed) {
        window.open(folder.url, "_blank", "noopener");
        return;
      }
      setStatus("loading");
      setError(null);
      try {
        const resolved = await resolveFolder(folder.parsed);
        // A handful of links point at a single file rather than a folder.
        if (!resolved.isFolder) {
          window.open(resolved.webUrl, "_blank", "noopener");
          setStatus("roots");
          return;
        }
        await open(resolved, [{ item: resolved, label: folder.label }]);
      } catch (err) {
        if (err instanceof GraphConsentRequiredError) {
          setStatus("consent");
          return;
        }
        setError(describe(err));
        setStatus("error");
      }
    },
    [open],
  );

  const openChild = useCallback(
    (child: DriveItem) => {
      const parent = crumbs[crumbs.length - 1];
      if (!parent) return;
      if (child.folder) {
        const item: ResolvedItem = {
          driveId: parent.item.driveId,
          itemId: child.id,
          name: child.name,
          webUrl: child.webUrl,
          isFolder: true,
        };
        void open(item, [...crumbs, { item, label: child.name }]);
      } else {
        // Preview in place; the modal itself offers Open-in-SharePoint / Download.
        setPreview({ driveId: parent.item.driveId, item: child });
      }
    },
    [crumbs, open],
  );

  const goTo = useCallback(
    (index: number) => {
      if (index < 0) {
        setCrumbs([]);
        setChildren([]);
        setStatus("roots");
        return;
      }
      const trail = crumbs.slice(0, index + 1);
      const target = trail[trail.length - 1];
      if (target) void open(target.item, trail);
    },
    [crumbs, open],
  );

  /** Upload into the folder currently being viewed, then refresh the listing. */
  const doUpload = useCallback(
    async (files: FileList | File[]) => {
      const parent = crumbs[crumbs.length - 1];
      if (!parent) return;
      setError(null);
      try {
        for (const file of Array.from(files)) {
          setUploading({ name: file.name, progress: 0 });
          await uploadFile(parent.item.driveId, parent.item.itemId, file, (progress) =>
            setUploading({ name: file.name, progress }),
          );
        }
        setChildren(await listChildren(parent.item.driveId, parent.item.itemId));
      } catch (err) {
        if (err instanceof GraphConsentRequiredError) {
          setStatus("consent");
          return;
        }
        setError(describe(err));
      } finally {
        setUploading(null);
      }
    },
    [crumbs],
  );

  /** Consent popup — must run from a click or the browser blocks it. */
  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      await getGraphToken(true);
      setStatus("roots");
      setError(null);
    } catch (err) {
      setError(describe(err));
      setStatus("error");
    } finally {
      setConnecting(false);
    }
  }, []);

  // ---- States ----
  if (folders.length === 0) {
    return (
      <SharePointPlaceholder
        title="No SharePoint folders for this client"
        message="This client has no e-file or consult link on their Monday profile or board items. Once a link is added in Monday, the folder shows up here after the next sync."
      />
    );
  }

  if (status === "consent") {
    return (
      <SharePointPlaceholder
        title="Connect SharePoint"
        message="Grant access once and this tab will browse the client's e-file and consult folders. You'll only ever see what SharePoint already lets you open."
        action={{ label: "Connect SharePoint", onClick: () => void connect(), busy: connecting }}
      />
    );
  }

  return (
    <div className="space-y-3 animate-in">
      {/* Breadcrumb */}
      {crumbs.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontFamily: "var(--font-body)", fontSize: 13 }}>
          <button onClick={() => goTo(-1)} className="kpi-item-client" style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            All folders
          </button>
          {crumbs.map((c, i) => (
            <span key={`${c.item.itemId}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--color-ink-faint)" }}>/</span>
              {i === crumbs.length - 1 ? (
                <span style={{ color: "var(--color-ink)", fontWeight: 500 }}>{c.label}</span>
              ) : (
                <button onClick={() => goTo(i)} className="kpi-item-client" style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  {c.label}
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div
          style={{
            backgroundColor: "var(--color-status-red-bg)",
            color: "var(--color-status-red)",
            border: "1px solid rgba(153,27,27,0.15)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            fontFamily: "var(--font-body)",
          }}
        >
          {error}
        </div>
      )}

      {status === "loading" && (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", fontSize: 14 }}>
          Loading…
        </div>
      )}

      {/* Root folders */}
      {(status === "roots" || status === "error") && crumbs.length === 0 && (
        <div className="card card-elevated" style={{ overflow: "hidden" }}>
          {folders.map((f, i) => (
            <div
              key={f.url}
              className="result-row"
              onClick={() => void openRoot(f)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)" }}
            >
              <FolderIcon />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, color: "var(--color-ink)" }}>{f.label}</div>
                {f.site && <div className="board-tag" style={{ marginTop: 2 }}>{f.site}</div>}
              </div>
              {!f.parsed && (
                <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--color-ink-faint)" }}>Open in SharePoint ↗</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload zone — only inside a folder, where there's a place to put files */}
      {status === "ready" && crumbs.length > 0 && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) void doUpload(e.dataTransfer.files);
          }}
          style={{
            border: `1px dashed ${dragOver ? "var(--color-amber)" : "var(--color-border)"}`,
            backgroundColor: dragOver ? "var(--color-amber-light)" : "transparent",
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            transition: "border-color 0.15s ease, background-color 0.15s ease",
          }}
        >
          {uploading ? (
            <>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Uploading {uploading.name}…
              </span>
              <div style={{ width: 120, height: 6, borderRadius: 3, backgroundColor: "var(--color-border)", overflow: "hidden", flexShrink: 0 }}>
                <div style={{ width: `${Math.round(uploading.progress * 100)}%`, height: "100%", backgroundColor: "var(--color-amber)", transition: "width 0.2s ease" }} />
              </div>
            </>
          ) : (
            <>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink-faint)", flex: 1 }}>
                Drop files here to upload to <strong style={{ color: "var(--color-ink)" }}>{crumbs[crumbs.length - 1]!.label}</strong>
              </span>
              <label className="action-btn" style={{ flexShrink: 0, cursor: "pointer" }}>
                <input
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files?.length) void doUpload(e.target.files);
                    e.target.value = ""; // allow re-picking the same file
                  }}
                />
                Upload files
              </label>
            </>
          )}
        </div>
      )}

      {/* Folder contents */}
      {status === "ready" && crumbs.length > 0 && (
        <div className="card card-elevated" style={{ overflow: "hidden" }}>
          {children.length === 0 && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", fontSize: 13, fontStyle: "italic" }}>
              This folder is empty.
            </div>
          )}
          {children.map((c, i) => (
            <div
              key={c.id}
              className="result-row"
              onClick={() => openChild(c)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)" }}
            >
              {c.folder ? <FolderIcon /> : <FileIcon />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.name}
                </div>
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-ink-faint)", flexShrink: 0 }}>
                {c.folder ? `${c.folder.childCount ?? 0} items` : formatSize(c.size)}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-ink-faint)", flexShrink: 0, minWidth: 78, textAlign: "right" }}>
                {formatDate(c.lastModifiedDateTime)}
              </span>
              {!c.folder && c["@microsoft.graph.downloadUrl"] && (
                <a
                  href={c["@microsoft.graph.downloadUrl"]}
                  download={c.name}
                  onClick={(e) => e.stopPropagation()}
                  className="action-btn"
                  style={{ flexShrink: 0, textDecoration: "none" }}
                >
                  Download
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {preview && (
        <FilePreviewModal driveId={preview.driveId} item={preview.item} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
