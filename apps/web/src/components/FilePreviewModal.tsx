import { useState, useEffect } from "react";
import { getPreviewUrl, GraphConsentRequiredError, GraphError, type DriveItem } from "../sharepoint/graph";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

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
    };
  }, [driveId, item, downloadUrl, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[94vh] w-[94vw] flex-col gap-0 p-0 sm:max-w-[1100px]">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-3 pr-12">
          <DialogTitle
            className="min-w-0 flex-1 truncate text-sm font-medium"
            style={{ fontFamily: "var(--font-body)", color: "var(--color-ink)" }}
          >
            {item.name}
          </DialogTitle>
          <a href={item.webUrl} target="_blank" rel="noopener noreferrer" className="action-btn" style={{ textDecoration: "none", flexShrink: 0 }}>
            Open in SharePoint ↗
          </a>
          {downloadUrl && (
            <a href={downloadUrl} download={item.name} className="action-btn" style={{ textDecoration: "none", flexShrink: 0 }}>
              Download
            </a>
          )}
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
      </DialogContent>
    </Dialog>
  );
}
