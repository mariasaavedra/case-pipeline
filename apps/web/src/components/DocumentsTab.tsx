// =============================================================================
// Documents tab — SharePoint file browser
// =============================================================================
// Repurposed from the old "Documents & Notices" board list: this tab now browses
// the client's SharePoint e-file / consult folders in place. Graph is called
// directly from the browser with the signed-in user's delegated token, so nobody
// sees anything SharePoint wouldn't already show them.
//
// `pick` turns it into a picker (M19, from the consult prep popup): each file
// gets an Attach toggle, and files uploaded here are reported back so the
// caller can attach them too.
//
// Inside a folder, New folder makes a subfolder. `eFile` (P3.6 only) adds
// "Find or create e-file folder" when the client has no e-file link: the same
// lookup as M18 (E-Files, then Closed; created under E-Files/{initial}/ only
// when neither has one), and the link is written to the profile's E-File.
// =============================================================================

import { useState, useMemo, useCallback } from "react";
import { consultFolderName } from "@case-pipeline/core";
import { setProfileEFile } from "../api";
import { collectClientFolders, type ClientFolder, type FolderSource } from "../sharepoint/collectFolders";
import {
  resolveFolder,
  listChildren,
  uploadFile,
  createFolder,
  folderNameProblem,
  findOrCreateClientFolder,
  getGraphToken,
  GraphConsentRequiredError,
  GraphError,
  type DriveItem,
  type ResolvedItem,
} from "../sharepoint/graph";
import { SharePointPlaceholder } from "./SharePointPlaceholder";
import { FilePreviewModal } from "./FilePreviewModal";

/** A file chosen in pick mode. */
export interface PickedFile {
  name: string;
  url: string;
  /** Where it lives in SharePoint, so it can be copied into Monday (absent for folder links). */
  driveId?: string;
  itemId?: string;
  size?: number;
}

interface Props {
  /** A ClientCaseSummary, or just a profile's folder links. */
  data: FolderSource;
  pick?: {
    /** URLs already chosen. */
    selected: ReadonlySet<string>;
    onToggle: (file: PickedFile) => void;
    /** A file uploaded in pick mode — it is also chosen. */
    onUploaded?: (file: File, item: DriveItem) => void;
  };
  /** The client whose e-file folder can be found or created here (P3.6). */
  eFile?: { profileLocalId: string; firstName?: string | null; lastName?: string | null };
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

export function DocumentsTab({ data, pick, eFile }: Props) {
  // An e-file linked from here shows at once, before the next sync brings it.
  const [linkedEFile, setLinkedEFile] = useState<string | null>(null);
  const folders = useMemo(
    () => collectClientFolders(linkedEFile ? { ...data, profile: { ...data.profile, eFile: linkedEFile } } : data),
    [data, linkedEFile],
  );
  const hasEFile = folders.some((f) => f.label.startsWith("e-file") || f.label.startsWith("Archived"));
  const [eFileBusy, setEFileBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
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
    setNewFolder(null);
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
          const uploaded = await uploadFile(parent.item.driveId, parent.item.itemId, file, (progress) =>
            setUploading({ name: file.name, progress }),
          );
          pick?.onUploaded?.(file, uploaded);
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
    [crumbs, pick],
  );

  /** A subfolder in the folder being viewed, then refresh the listing. */
  const doCreateFolder = useCallback(async () => {
    const parent = crumbs[crumbs.length - 1];
    if (!parent || newFolder === null) return;
    const problem = folderNameProblem(newFolder);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setCreatingFolder(true);
    try {
      await createFolder(parent.item.driveId, parent.item.itemId, newFolder);
      setNewFolder(null);
      setChildren(await listChildren(parent.item.driveId, parent.item.itemId));
    } catch (err) {
      if (err instanceof GraphConsentRequiredError) {
        setStatus("consent");
        return;
      }
      setError(err instanceof GraphError && err.status === 409 ? `There is already a "${newFolder.trim()}" here.` : describe(err));
    } finally {
      setCreatingFolder(false);
    }
  }, [crumbs, newFolder]);

  /** Find the client's e-file folder (or make it) and link it on Monday. */
  const findOrCreateEFile = useCallback(async () => {
    if (!eFile) return;
    const named = consultFolderName({ firstName: eFile.firstName, lastName: eFile.lastName });
    if (!named.ok) {
      setError(`Can't name the folder: ${named.detail}. Fix the name on the Monday profile, or paste the link there.`);
      return;
    }
    setError(null);
    setNotice(null);
    setEFileBusy(true);
    try {
      const r = await findOrCreateClientFolder({
        want: "e_file", folder: named.name.folder, initial: named.name.initial, year: new Date().getFullYear(),
      });
      const linked = await setProfileEFile(eFile.profileLocalId, r.url);
      setLinkedEFile(r.url);
      setNotice(
        `${r.created ? "Created" : "Found"} ${r.path} and set it as the client's E-File on Monday` +
          (linked.pending ? " (Monday is unreachable — it will be written when it's back)." : "."),
      );
    } catch (err) {
      if (err instanceof GraphConsentRequiredError) {
        setStatus("consent");
        return;
      }
      setError(describe(err));
    } finally {
      setEFileBusy(false);
    }
  }, [eFile]);

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
  if (folders.length === 0 && status !== "consent") {
    return (
      <>
        <SharePointPlaceholder
          title="No SharePoint folders for this client"
          message={
            eFile
              ? "This client has no e-file or consult link on their Monday profile or board items. Find or create their e-file folder, or add a link in Monday."
              : "This client has no e-file or consult link on their Monday profile or board items. Once a link is added in Monday, the folder shows up here after the next sync."
          }
          action={eFile ? { label: "Find or create e-file folder", onClick: () => void findOrCreateEFile(), busy: eFileBusy } : undefined}
        />
        {error && <p style={{ textAlign: "center", color: "var(--color-status-red)", fontFamily: "var(--font-body)", fontSize: 13 }}>{error}</p>}
      </>
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

      {notice && (
        <div
          style={{
            backgroundColor: "var(--color-status-green-bg)",
            color: "var(--color-ink)",
            border: "1px solid var(--color-border-light)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            fontFamily: "var(--font-body)",
          }}
        >
          {notice}
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
          {eFile && !hasEFile && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--color-border-light)" }}>
              <span style={{ flex: 1, fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink-faint)" }}>
                No e-file folder linked on this client's profile.
              </span>
              <button type="button" className="action-btn" disabled={eFileBusy} onClick={() => void findOrCreateEFile()} style={{ flexShrink: 0 }}>
                {eFileBusy ? "Working…" : "Find or create e-file folder"}
              </button>
            </div>
          )}
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
          {newFolder !== null ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void doCreateFolder();
              }}
              style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, flexWrap: "wrap", minWidth: 0 }}
            >
              <FolderIcon />
              <input
                autoFocus
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setNewFolder(null);
                    setError(null);
                  }
                }}
                placeholder={`New folder in ${crumbs[crumbs.length - 1]!.label}`}
                aria-label="New folder name"
                maxLength={200}
                disabled={creatingFolder}
                style={{
                  flex: "1 1 160px", minWidth: 0, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--color-border)",
                  fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-ink)", background: "var(--color-surface)",
                }}
              />
              <button type="submit" className="action-btn" disabled={creatingFolder || !newFolder.trim()} style={{ flexShrink: 0 }}>
                {creatingFolder ? "Creating…" : "Create"}
              </button>
              <button type="button" className="action-btn" disabled={creatingFolder} onClick={() => { setNewFolder(null); setError(null); }} style={{ flexShrink: 0 }}>
                Cancel
              </button>
            </form>
          ) : uploading ? (
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
              <button type="button" className="action-btn" style={{ flexShrink: 0 }} onClick={() => setNewFolder("")}>
                New folder
              </button>
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
              {pick && !c.folder && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    pick.onToggle({ name: c.name, url: c.webUrl, driveId: c.parentReference?.driveId, itemId: c.id, size: c.size });
                  }}
                  className="action-btn"
                  aria-pressed={pick.selected.has(c.webUrl)}
                  style={{
                    flexShrink: 0,
                    ...(pick.selected.has(c.webUrl)
                      ? { background: "var(--color-amber-light)", color: "var(--color-amber-dark)", borderColor: "var(--color-amber)" }
                      : {}),
                  }}
                >
                  {pick.selected.has(c.webUrl) ? "✓ Attached" : "Attach"}
                </button>
              )}
              {!pick && !c.folder && c["@microsoft.graph.downloadUrl"] && (
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
