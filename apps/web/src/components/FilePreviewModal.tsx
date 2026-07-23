import { useState, useEffect } from "react";
import { getPreviewUrl, GraphConsentRequiredError, GraphError, type DriveItem } from "../sharepoint/graph";
import { ModalPortal } from "./ModalPortal";

interface Props {
  driveId: string;
  item: DriveItem;
  onClose: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "image"; url: string }
  | { kind: "iframe"; url: string }
  | { kind: "unsupported"; message: string };

function isImage(item: DriveItem): boolean {
  return !!item.file?.mimeType?.startsWith("image/");
}

/**
 * Near-fullscreen preview of a SharePoint file. Images render directly from the
 * pre-authenticated download URL; everything else goes through Graph's /preview
 * (Office viewer / PDF). Unsupported types fall back to Download / Open in
 * SharePoint, which are always present in the header.
 */
export function FilePreviewModal({ driveId, item, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const downloadUrl = item["@microsoft.graph.downloadUrl"];

  useEffect(() => {
    let cancelled = false;

    // Close on Escape.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);

    if (isImage(item) && downloadUrl) {
      setState({ kind: "image", url: downloadUrl });
    } else {
      getPreviewUrl(driveId, item.id)
        .then((url) => !cancelled && setState({ kind: "iframe", url }))
        .catch((err) => {
          if (cancelled) return;
          const message =
            err instanceof GraphConsentRequiredError
              ? "SharePoint access is needed to preview this file."
              : err instanceof GraphError && err.status === 415
                ? "This file type can't be previewed. Download it or open it in SharePoint."
                : err instanceof GraphError && err.status === 403
                  ? "You don't have access to preview this file."
                  : "Couldn't load a preview. Download it or open it in SharePoint.";
          setState({ kind: "unsupported", message });
        });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [driveId, item, downloadUrl, onClose]);

  return (
    <ModalPortal>
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "3vh 3vw",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          height: "100%",
          maxWidth: 1100,
          background: "var(--color-card)",
          borderRadius: 12,
          border: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-ink)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.name}
          </span>
          <a href={item.webUrl} target="_blank" rel="noopener noreferrer" className="action-btn" style={{ textDecoration: "none", flexShrink: 0 }}>
            Open in SharePoint ↗
          </a>
          {downloadUrl && (
            <a href={downloadUrl} download={item.name} className="action-btn" style={{ textDecoration: "none", flexShrink: 0 }}>
              Download
            </a>
          )}
          <button onClick={onClose} className="action-btn" style={{ flexShrink: 0 }} title="Close (Esc)">
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, background: "var(--color-surface-warm)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {state.kind === "loading" && (
            <span style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", fontSize: 14 }}>Loading preview…</span>
          )}
          {state.kind === "image" && (
            <img src={state.url} alt={item.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          )}
          {state.kind === "iframe" && (
            <iframe title={item.name} src={state.url} style={{ width: "100%", height: "100%", border: "none" }} />
          )}
          {state.kind === "unsupported" && (
            <span style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)", fontSize: 14, maxWidth: 420, textAlign: "center", padding: 24 }}>
              {state.message}
            </span>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
