// =============================================================================
// MailPage (P12) — file incoming mail, one piece at a time
// =============================================================================
// A staff member scans ONE letter to a PDF and drops it here. The API reads it
// (text layer, else OCR) and M31 opens with what it could read pre-filled:
// they check it, pick the client (and Open Form), and file it — saved to the
// client's E-File → CC folder, the client e-mailed, a note on the profile.
// One upload per letter (decided 2026-10-23: splitting a whole day's scan
// guessed wrong too often).
//
// The PDF stays in this browser: the server reads it in memory and keeps only
// what was read; the file goes from here to SharePoint and Outlook.
//
// Older scans that were split and stored still wait in Alerts → "Mail to
// review" (M15) until someone settles them.
// =============================================================================

import { useRef, useState } from "react";
import { scanMail, type MailScanDocument } from "../api";
import { Link } from "./Link";
import { ClientLink } from "./ClientPeek";
import { Button } from "./ui/button";
import { MailFileModal, type FiledMail } from "./MailFileModal";
import { SectionCode } from "./ScreenCode";

const faint = { color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" } as const;
const ink = { color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

const NOTE_LABEL: Record<FiledMail["note"], string> = {
  posted: "note on the profile",
  queued: "note queued (Monday was unreachable)",
  skipped: "no Monday note (not a Monday profile)",
};

export function MailPage() {
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<{ doc: MailScanDocument & { id: number }; pdf: File } | null>(null);
  const [filed, setFiled] = useState<FiledMail[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const read = async (f: File) => {
    setError(null);
    setReading(f.name);
    try {
      const result = await scanMail(f, { name: f.name });
      const doc = result.documents[0];
      if (!doc || doc.id == null) throw new Error("Nothing could be read from that PDF");
      setOpen({ doc: { ...doc, id: doc.id }, pdf: f });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the PDF");
    } finally {
      setReading(null);
    }
  };

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setError("One letter at a time: drop a single PDF.");
      return;
    }
    const f = files[0]!;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a PDF file.");
      return;
    }
    void read(f);
  };

  return (
    <div className="animate-in">
      <div className="mb-4">
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
          Mail
        </h1>
        <p className="text-sm mt-0.5" style={faint}>
          Upload one letter, check what was read, and file it to the client: E-File → CC, an e-mail to the client, a note on their profile.
        </p>
      </div>

      <SectionCode code="P12.1" />
      <div
        className="card card-elevated mb-4 px-5 py-8 flex flex-col items-center gap-3 text-center"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
        style={{
          border: `2px dashed ${dragging ? "var(--color-amber)" : "var(--color-border)"}`,
          background: dragging ? "var(--color-amber-light)" : undefined,
        }}
      >
        <svg width="28" height="28" viewBox="0 0 20 20" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5" aria-hidden>
          <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
          <path d="M3 5.5l7 5 7-5" />
        </svg>
        <p className="text-sm" style={ink}>
          {reading ? (
            <>
              Reading <span className="font-medium">{reading}</span>… scanned pages take about a second each.
            </>
          ) : (
            "Drop the PDF of one letter here (all its pages in one file)."
          )}
        </p>
        <Button type="button" onClick={() => inputRef.current?.click()} disabled={reading != null}>
          {filed.length ? "Upload the next letter" : "Choose PDF"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-[11px]" style={faint}>
          The file isn’t kept on our server — it goes only to the client’s E-File and the e-mail. Handwriting can’t be read.
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm" style={{ color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
          {error}
        </p>
      )}

      {filed.length > 0 && (
        <>
          <SectionCode code="P12.2" />
          <div className="card card-elevated overflow-hidden">
            <div className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ ...faint, borderBottom: "1px solid var(--color-border-light)" }}>
              Filed just now ({filed.length})
            </div>
            {filed.map((f) => (
              <div key={f.documentId} className="px-5 py-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-1" style={{ ...ink, borderBottom: "1px solid var(--color-border-light)" }}>
                <ClientLink clientId={f.clientLocalId} className="font-semibold" style={{ color: "var(--color-amber)" }}>
                  {f.clientName}
                </ClientLink>
                <a href={f.saved.url} target="_blank" rel="noreferrer" className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {f.saved.fileName}
                </a>
                <span className="text-xs" style={faint}>
                  {[f.emailedTo ? `e-mailed ${f.emailedTo}` : "not e-mailed", NOTE_LABEL[f.note], f.writeback === "failed" || f.writeback === "partial" ? "Open Form not fully updated — check its Receipt No. in Monday" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mt-4 text-xs" style={faint}>
        Older scans that still need a decision are in{" "}
        <Link href="/alerts" style={{ color: "var(--color-amber)" }}>
          Alerts → Mail to review
        </Link>
        .
      </p>

      {open && (
        <MailFileModal
          doc={open.doc}
          pdf={open.pdf}
          onClose={() => setOpen(null)}
          onFiled={(f) => {
            setFiled((prev) => [f, ...prev]);
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}
