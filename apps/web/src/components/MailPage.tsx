// =============================================================================
// MailPage — scan incoming mail, match each notice to a client's Open Form
// =============================================================================
// Drop one PDF (a whole day's mail scanned in one pass is fine — the API splits
// it into notices), and each notice comes back with the Open Form it belongs to
// and what the write-back WOULD do. The scan is saved; notices that need a
// person also land in Alerts → "Mail to review" (M15 settles them, here or
// there). Nothing reaches Monday yet.
//
// The PDF never leaves the browser except for the one scan request: the preview
// on the right is a local blob URL.
//
// Pages without a text layer are read by OCR on the server. Its confidence is
// shown per notice, because a misread digit is the one failure the matching
// can't catch by itself.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import {
  scanMail,
  fetchSampleMailPdf,
  type MailScanResult,
  type MailScanDocument,
  type MatchStatus,
  type MatchedOpenForm,
} from "../api";
import { Link } from "./Link";
import { clientPath } from "../router";
import { Button } from "./ui/button";
import { MailReviewModal } from "./MailReviewModal";
import { SectionCode } from "./ScreenCode";

const STATUS_META: Record<MatchStatus, { label: string; color: string; bg: string }> = {
  matched: { label: "Matched", color: "var(--color-status-green)", bg: "var(--color-status-green-bg)" },
  needs_attention: { label: "Needs attention", color: "var(--color-status-yellow)", bg: "var(--color-status-yellow-bg)" },
  no_match: { label: "No match", color: "var(--color-status-red)", bg: "var(--color-status-red-bg)" },
  unreadable: { label: "Unreadable", color: "var(--color-status-gray)", bg: "var(--color-status-gray-bg)" },
};

const SPLIT_LABEL: Record<MailScanDocument["splitReason"], string> = {
  first_page: "first page",
  page_marker: "“Page 1 of N”",
  notice_header: "new notice header",
  new_identifiers: "different receipt / A-number",
  after_separator: "after blank separator",
};

const ACTION_LABEL = {
  fill_receipt: "Would fill Receipt No. + attach PDF",
  attach_only: "Would attach PDF",
} as const;

function pageRange(pages: number[]): string {
  if (pages.length === 1) return `Page ${pages[0]}`;
  return `Pages ${pages[0]}–${pages[pages.length - 1]}`;
}

function formatA(a: string): string {
  return `A-${a.slice(0, 3)}-${a.slice(3, 6)}-${a.slice(6)}`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const faint = { color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" } as const;
const ink = { color: "var(--color-ink)", fontFamily: "var(--font-body)" } as const;

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5 min-w-[110px]">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={faint}>
        {label}
      </span>
      <span className="text-sm" style={{ ...ink, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

/** Below this, OCR'd identifiers deserve a second look against the preview. */
const LOW_OCR_CONFIDENCE = 75;

function OcrBadge({ confidence }: { confidence: number | null }) {
  const low = confidence != null && confidence < LOW_OCR_CONFIDENCE;
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap"
      title="No text layer on these pages — read by OCR"
      style={{
        color: low ? "var(--color-status-yellow)" : "var(--color-status-blue)",
        backgroundColor: low ? "var(--color-status-yellow-bg)" : "var(--color-status-blue-bg)",
        fontFamily: "var(--font-body)",
      }}
    >
      OCR{confidence != null ? ` ${confidence}%` : ""}
    </span>
  );
}

function StatusPill({ status }: { status: MatchStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      className="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color: m.color, backgroundColor: m.bg, fontFamily: "var(--font-body)" }}
    >
      {m.label}
    </span>
  );
}

function FormLine({ form }: { form: MatchedOpenForm }) {
  return (
    <li className="text-xs flex flex-wrap gap-x-2" style={ink}>
      <span className="font-medium">{form.formType ?? "Unknown form"}</span>
      <span style={faint}>{form.name}</span>
      {form.status && <span style={faint}>· {form.status}</span>}
      <span style={faint}>· {form.receiptNo ? `Receipt ${form.receiptNo}` : "no receipt yet"}</span>
    </li>
  );
}

function DocumentRow({
  doc,
  selected,
  onSelect,
  resolved,
  onReview,
}: {
  doc: MailScanDocument;
  selected: boolean;
  onSelect: () => void;
  /** "assigned" / "dismissed" once settled in this session. */
  resolved: string | undefined;
  onReview: () => void;
}) {
  const { fields, match } = doc;
  const person = fields.people[0];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="px-5 py-3"
      style={{
        borderBottom: "1px solid var(--color-border-light)",
        borderLeft: `3px solid ${selected ? "var(--color-amber)" : "transparent"}`,
        background: selected ? "var(--color-surface-warm)" : undefined,
        cursor: "pointer",
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={ink}>
              {fields.noticeType ?? "Unknown document"}
              {fields.formType ? ` · ${fields.formType}` : ""}
            </span>
            <StatusPill status={match.status} />
            {doc.ocrPages.length > 0 && <OcrBadge confidence={doc.ocrConfidence} />}
            {resolved && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-full"
                style={{ color: "var(--color-status-green)", backgroundColor: "var(--color-status-green-bg)", fontFamily: "var(--font-body)" }}
              >
                {resolved === "assigned" ? "Assigned" : "Dismissed"}
              </span>
            )}
          </div>
          <span className="text-[11px]" style={faint}>
            {pageRange(doc.pages)} · split on {SPLIT_LABEL[doc.splitReason]}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
        {doc.needsReview && doc.id != null && !resolved && (
          <Button
            type="button"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
          >
            Review
          </Button>
        )}
        {match.profile && (
          <Link
            href={clientPath(match.profile.localId)}
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] font-medium px-2 py-1 rounded-md"
            style={{ color: "var(--color-amber)", backgroundColor: "var(--color-amber-light)", textDecoration: "none" }}
          >
            {match.profile.name}
          </Link>
        )}
        </div>
      </div>

      <p className="text-sm mt-2" style={{ ...ink, color: "var(--color-ink-muted)" }}>
        {match.message}
      </p>

      {doc.ocrConfidence != null && doc.ocrConfidence < LOW_OCR_CONFIDENCE && (
        <p className="text-[11px] mt-1" style={{ color: "var(--color-status-yellow)", fontFamily: "var(--font-body)" }}>
          Low OCR confidence — compare the numbers below with the preview before trusting the match.
        </p>
      )}

      {doc.uncertainPages.length > 0 && (
        <p className="text-[11px] mt-1" style={{ color: "var(--color-status-yellow)", fontFamily: "var(--font-body)" }}>
          Page {doc.uncertainPages.join(", ")} joined this notice only because nothing marked a new one — check the split.
        </p>
      )}

      <div className="flex flex-wrap gap-5 mt-2">
        <Field label="Receipt No." value={fields.receiptNumbers.join(", ") || null} />
        <Field label="A-Number" value={fields.aNumbers.map(formatA).join(", ") || null} />
        <Field label="Notice date" value={formatDate(fields.noticeDate)} />
        <Field label={person?.role ?? "Name"} value={person?.name ?? null} />
      </div>

      {match.proposedAction && match.openForm && (
        <div
          className="mt-3 text-xs px-3 py-2 rounded-md"
          style={{ background: "var(--color-status-green-bg)", color: "var(--color-status-green)", fontFamily: "var(--font-body)" }}
        >
          <span className="font-semibold">{ACTION_LABEL[match.proposedAction]}</span> on Open Form “{match.openForm.name}”
          {match.openForm.formType ? ` (${match.openForm.formType})` : ""}
        </div>
      )}

      {(match.candidateForms.length > 0 || match.candidateProfiles.length > 0) && (
        <div className="mt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={faint}>
            {match.status === "matched" ? "Also on file" : "Candidates"}
          </span>
          <ul className="mt-1 flex flex-col gap-1">
            {match.candidateProfiles.map((p) => (
              <li key={p.localId} className="text-xs" style={ink}>
                <Link href={clientPath(p.localId)} onClick={(e) => e.stopPropagation()} style={{ color: "var(--color-amber)" }}>
                  {p.name}
                </Link>
                {p.aNumber && <span style={faint}> · A# {p.aNumber}</span>}
              </li>
            ))}
            {match.candidateForms.map((f) => (
              <FormLine key={f.localId} form={f} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function MailPage() {
  const [file, setFile] = useState<{ name: string; blob: Blob } | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [result, setResult] = useState<MailScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MatchStatus | "all">("all");
  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [resolved, setResolved] = useState<Record<number, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file.blob);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const run = async (name: string, blob: Blob, sample = false) => {
    setFile({ name, blob });
    setResolved({});
    setResult(null);
    setError(null);
    setFilter("all");
    setSelected(0);
    setScanning(true);
    try {
      setResult(await scanMail(blob, { name, sample }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a PDF file.");
      return;
    }
    void run(f.name, f);
  };

  const trySample = async (scanned: boolean) => {
    setError(null);
    setScanning(true);
    try {
      const blob = await fetchSampleMailPdf(scanned);
      await run(scanned ? "sample-mail-scanned.pdf" : "sample-mail.pdf", blob, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the sample");
      setScanning(false);
    }
  };

  const visible = useMemo(
    () =>
      (result?.documents ?? [])
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => filter === "all" || d.match.status === filter),
    [result, filter],
  );
  const current = result?.documents[selected] ?? null;

  const chip = (key: MatchStatus | "all", label: string, count: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className="text-xs px-3 py-1.5 rounded-full"
      style={{
        border: "1px solid var(--color-border-light)",
        background: filter === key ? "var(--color-amber-light)" : "var(--color-surface)",
        color: filter === key ? "var(--color-amber)" : "var(--color-ink-muted)",
        fontFamily: "var(--font-body)",
        cursor: "pointer",
      }}
    >
      {label} ({count})
    </button>
  );

  return (
    <div className="animate-in">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--color-ink)" }}>
            Mail
          </h1>
          <p className="text-sm mt-0.5" style={faint}>
            Scan incoming notices and match each one to a client’s Open Form.
          </p>
        </div>
        <span
          className="text-[11px] px-2 py-1 rounded-md"
          style={{ background: "var(--color-status-blue-bg)", color: "var(--color-status-blue)", fontFamily: "var(--font-body)" }}
        >
          Prototype · scans are saved; nothing is sent to Monday yet
        </span>
      </div>

      {/* Drop zone */}
      <SectionCode code="P12.1" />
      <div
        className="card card-elevated mb-4 px-5 py-6 flex flex-col items-center gap-3 text-center"
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
          {file ? (
            <>
              <span className="font-medium">{file.name}</span>
              {result && <span style={faint}> · {result.totalPages} pages · {result.documents.length} notices</span>}
            </>
          ) : (
            "Drop a scanned PDF here — one notice or a whole day’s mail in one file."
          )}
        </p>
        <div className="flex gap-2 flex-wrap justify-center">
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={scanning}>
            {file ? "Scan another PDF" : "Choose PDF"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void trySample(false)} disabled={scanning}>
            Try a sample PDF
          </Button>
          <Button type="button" variant="outline" onClick={() => void trySample(true)} disabled={scanning}>
            Try a scanned sample (OCR)
          </Button>
        </div>
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
          Image-only scans are read with OCR, about a second per page. Handwriting can’t be read.
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm" style={{ color: "var(--color-status-red)", fontFamily: "var(--font-body)" }}>
          {error}
        </p>
      )}

      {scanning && (
        <p className="mb-4 text-sm" style={faint}>
          Reading pages… image-only pages take about a second each.
        </p>
      )}

      {result && (
        <>
          {(() => {
            const open = result.documents.filter((d) => d.needsReview && d.id != null && !resolved[d.id]).length;
            if (open === 0) return null;
            return (
              <div
                className="mb-3 px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 flex-wrap"
                style={{ background: "var(--color-status-yellow-bg)", color: "var(--color-status-yellow)", fontFamily: "var(--font-body)" }}
              >
                <span>
                  {open} notice{open > 1 ? "s" : ""} need{open > 1 ? "" : "s"} a person. Review {open > 1 ? "them" : "it"} here, or later from{" "}
                  <Link href="/alerts" style={{ color: "inherit", fontWeight: 600 }}>
                    Alerts → Mail to review
                  </Link>
                  .
                </span>
              </div>
            );
          })()}

          <SectionCode code="P12.2" />
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {chip("all", "All", result.documents.length)}
            {(Object.keys(STATUS_META) as MatchStatus[]).map((s) => chip(s, STATUS_META[s].label, result.summary[s]))}
            <span className="text-[11px] ml-auto" style={faint}>
              {[
                result.ocrPages.length > 0 &&
                  `${result.ocrPages.length} of ${result.totalPages} pages read by OCR`,
                result.separatorPages.length > 0 &&
                  `blank separator page${result.separatorPages.length > 1 ? "s" : ""} ${result.separatorPages.join(", ")} skipped`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          <SectionCode code="P12.3" />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="card card-elevated overflow-hidden self-start">
              {visible.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm" style={faint}>
                  {result.documents.length === 0 ? "No pages with content found." : "Nothing in this group."}
                </p>
              ) : (
                visible.map(({ d, i }) => (
                  <DocumentRow
                    key={i}
                    doc={d}
                    selected={i === selected}
                    onSelect={() => setSelected(i)}
                    resolved={d.id != null ? resolved[d.id] : undefined}
                    onReview={() => d.id != null && setReviewing(d.id)}
                  />
                ))
              )}
            </div>

            {pdfUrl && current && (
              <div className="card card-elevated overflow-hidden lg:sticky lg:top-4 self-start">
                <div className="px-4 py-2 text-xs" style={{ ...faint, borderBottom: "1px solid var(--color-border-light)" }}>
                  {pageRange(current.pages)} of {file?.name}
                </div>
                {/* key forces a reload: changing only the #page fragment doesn't move the viewer */}
                <iframe
                  key={`${pdfUrl}-${current.pages[0]}`}
                  title="Notice preview"
                  src={`${pdfUrl}#page=${current.pages[0]}&view=FitH`}
                  className="w-full block"
                  style={{ height: "min(75vh, 900px)", border: 0 }}
                />
              </div>
            )}
          </div>
        </>
      )}

      {reviewing != null && (
        <MailReviewModal
          documentId={reviewing}
          onClose={() => setReviewing(null)}
          onResolved={(doc) => setResolved((prev) => ({ ...prev, [doc.id]: doc.reviewState }))}
        />
      )}
    </div>
  );
}
