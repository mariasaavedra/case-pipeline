// =============================================================================
// Client upload page (/u/<token>) — docs/features/client-uploads.md
// =============================================================================
// Phone-first, no login, no account. Upload-only: it shows the client's first
// name and what THEY sent during this visit, nothing from their case file.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { FIRM_NAME, FIRM_PHONE, FIRM_PHONE_TEL, STRINGS, type KindKey, type Lang } from "./strings";
import { allSettled, errorFor, precheck, sendFile, toStart, type QueueItem } from "./queue";

const KIND_ORDER: KindKey[] = ["notice", "id", "evidence", "other"];
const ACCEPT = "image/*,application/pdf,.pdf,.heic,.heif,.tif,.tiff,.doc,.docx";
const LANG_KEY = "upload.lang";

type Page = { s: "loading" } | { s: "dead" } | { s: "ready"; firstName: string | null };

export function tokenFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/u\/([A-Za-z0-9_-]{43})\/?$/);
  return m ? m[1]! : null;
}

function savedLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === "es" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function UploadPage() {
  const token = tokenFromPath(window.location.pathname);
  const [page, setPage] = useState<Page>(token ? { s: "loading" } : { s: "dead" });
  const [lang, setLang] = useState<Lang>(() => savedLang() ?? (navigator.language?.toLowerCase().startsWith("en") ? "en" : "es"));
  const [kind, setKind] = useState<KindKey>("notice");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<QueueItem[]>([]);
  const nextId = useRef(1);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const t = STRINGS[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/u/${token}`)
      .then(async (res) => {
        if (!res.ok) return setPage({ s: "dead" });
        const body = (await res.json()) as { data: { firstName: string | null; language: Lang } };
        setPage({ s: "ready", firstName: body.data.firstName });
        if (!savedLang()) setLang(body.data.language);
      })
      .catch(() => setPage({ s: "dead" }));
  }, [token]);

  const chooseLang = (l: Lang) => {
    setLang(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch { /* private window */ }
  };

  const update = useCallback((id: number, state: QueueItem["state"]) => {
    setItems((all) => all.map((i) => (i.id === id ? { ...i, state } : i)));
  }, []);

  // Start waiting files whenever a slot frees up.
  useEffect(() => {
    if (!token) return;
    for (const item of toStart(items)) {
      update(item.id, { s: "sending", pct: 0 });
      void sendFile(token, item, (pct) => update(item.id, { s: "sending", pct })).then((r) => {
        if (r.ok) update(item.id, { s: "done", duplicate: !!r.duplicate });
        else {
          update(item.id, { s: "error", ...errorFor(r.status, r.code) });
          if (r.status === 404) setPage({ s: "dead" });
        }
      });
    }
  }, [items, token, update]);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const added: QueueItem[] = Array.from(list).map((file) => {
      const bad = precheck(file);
      return {
        id: nextId.current++, file, kind, note,
        state: bad ? { s: "error", error: bad, retry: false } : { s: "waiting" },
      };
    });
    setItems((all) => [...all, ...added]);
  };

  if (page.s === "loading") {
    return <Shell t={t} lang={lang} onLang={chooseLang}><p className="text-ink-muted">{t.loading}</p></Shell>;
  }
  if (page.s === "dead") {
    return (
      <Shell t={t} lang={lang} onLang={chooseLang}>
        <h1 className="font-display text-2xl text-ink">{t.deadTitle}</h1>
        <p className="mt-2 text-ink-muted">{t.deadBody}</p>
      </Shell>
    );
  }

  // "We received your documents" only when nothing still needs the client's attention.
  const settled = allSettled(items) && !items.some((i) => i.state.s === "error");
  const anyDone = items.some((i) => i.state.s === "done");

  return (
    <Shell t={t} lang={lang} onLang={chooseLang}>
      <h1 className="font-display text-3xl text-ink">{t.title(page.firstName)}</h1>
      <p className="mt-2 text-ink-muted">{t.intro}</p>

      <fieldset className="mt-6">
        <legend className="font-medium text-ink">{t.kindQuestion}</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KIND_ORDER.map((k) => (
            <label
              key={k}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${
                kind === k ? "border-amber bg-amber-light text-ink" : "border-border bg-card text-ink"
              }`}
            >
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="size-5 accent-amber" />
              {t.kinds[k]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-5 block">
        <span className="font-medium text-ink">{t.noteLabel}</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          placeholder={t.notePlaceholder}
          rows={2}
          className="mt-2 w-full rounded-xl border border-border bg-card px-4 py-3 text-base text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
        />
      </label>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => camera.current?.click()}
          className="min-h-14 rounded-xl bg-navy px-4 text-lg font-medium text-white active:bg-navy-light"
        >
<span aria-hidden className="mr-2">📷</span>{t.takePhoto}
        </button>
        <button
          type="button"
          onClick={() => picker.current?.click()}
          className="min-h-14 rounded-xl border-2 border-navy bg-card px-4 text-lg font-medium text-navy active:bg-surface-warm"
        >
<span aria-hidden className="mr-2">📎</span>{t.chooseFiles}
        </button>
      </div>
      <p className="mt-2 text-sm text-ink-faint">{t.allowed}</p>
      <input
        ref={camera} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
      />
      <input
        ref={picker} type="file" accept={ACCEPT} multiple className="hidden" data-testid="file-picker"
        onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
      />

      {settled && anyDone && (
        <div role="status" className="mt-6 rounded-xl border border-status-green bg-status-green-bg px-4 py-4 text-status-green">
          <p className="text-lg font-semibold">✓ {t.doneTitle}</p>
          <p className="mt-1">{t.doneBody}</p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="mt-6 space-y-2" aria-live="polite">
          {[...items].reverse().map((item) => (
            <FileRow
              key={item.id}
              item={item}
              t={t}
              onRetry={() => update(item.id, { s: "waiting" })}
              onRemove={() => setItems((all) => all.filter((i) => i.id !== item.id))}
            />
          ))}
        </ul>
      )}
    </Shell>
  );
}

function FileRow({ item, t, onRetry, onRemove }: { item: QueueItem; t: (typeof STRINGS)[Lang]; onRetry: () => void; onRemove: () => void }) {
  const st = item.state;
  return (
    <li className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-ink">{item.file.name || t.takePhoto}</span>
        <span className="shrink-0 text-sm text-ink-faint">{formatSize(item.file.size)}</span>
      </div>
      <div className="mt-1 text-sm text-ink-muted">{t.kinds[item.kind]}</div>
      {st.s === "waiting" && <p className="mt-2 text-sm text-ink-muted">{t.waiting}</p>}
      {st.s === "sending" && (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded-full bg-border-light" role="progressbar" aria-valuenow={st.pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-amber transition-[width]" style={{ width: `${st.pct}%` }} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">{t.sending(st.pct)}</p>
        </div>
      )}
      {st.s === "done" && <p className="mt-2 text-sm font-medium text-status-green">✓ {st.duplicate ? t.duplicate : t.received}</p>}
      {st.s === "error" && (
        <div className="mt-2">
          <p className="text-sm text-status-red">{t.errors[st.error]}</p>
          <div className="mt-2 flex gap-2">
            {st.retry && (
              <button type="button" onClick={onRetry} className="min-h-10 rounded-lg bg-navy px-3 text-sm font-medium text-white">{t.retry}</button>
            )}
            <button type="button" onClick={onRemove} className="min-h-10 rounded-lg border border-border px-3 text-sm text-ink-muted">{t.remove}</button>
          </div>
        </div>
      )}
    </li>
  );
}

function Shell({ t, lang, onLang, children }: { t: (typeof STRINGS)[Lang]; lang: Lang; onLang: (l: Lang) => void; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface font-body text-base">
      <header className="border-b border-border bg-navy px-4 py-3">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          <span className="font-display text-lg text-white">{FIRM_NAME}</span>
          <button
            type="button"
            onClick={() => onLang(lang === "es" ? "en" : "es")}
            className="min-h-10 shrink-0 rounded-lg border border-white/40 px-3 text-sm text-white"
          >
            {t.langSwitch}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-xl px-4 pb-10 text-sm text-ink-muted">
        <p>{t.privacy}</p>
        <p className="mt-2">
          {t.questions} <a href={`tel:${FIRM_PHONE_TEL}`} className="font-medium text-amber-dark underline">{FIRM_PHONE}</a>
        </p>
      </footer>
    </div>
  );
}
