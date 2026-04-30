export function SharePointPlaceholder() {
  return (
    <div className="py-16 text-center animate-in">
      <div className="max-w-md mx-auto space-y-4">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ backgroundColor: "var(--color-surface-warm)", border: "1px solid var(--color-border-light)" }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>
        <div>
          <h3
            className="text-base font-semibold mb-1"
            style={{ color: "var(--color-ink)", fontFamily: "var(--font-display)" }}
          >
            SharePoint Integration
          </h3>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "var(--color-ink-faint)", fontFamily: "var(--font-body)" }}
          >
            Client e-files and consult files from SharePoint will be available here.
            Browse folders, preview documents, and access files without leaving the dashboard.
          </p>
        </div>
        <span
          className="inline-block text-[11px] font-medium px-3 py-1.5 rounded-full"
          style={{
            backgroundColor: "var(--color-surface-warm)",
            color: "var(--color-ink-faint)",
            border: "1px solid var(--color-border-light)",
            fontFamily: "var(--font-mono)",
          }}
        >
          Coming Soon
        </span>
      </div>
    </div>
  );
}
