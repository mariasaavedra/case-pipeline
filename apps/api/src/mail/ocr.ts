// =============================================================================
// PDF → page text, with OCR for pages that have no text layer
// =============================================================================
// A page is read from its text layer when it has one (e-notices, scanner PDFs
// with OCR switched on). Only a page with next to no text is rendered to an
// image and run through Tesseract — about a second a page, so a scan that
// already carries text costs nothing extra.
//
// Tesseract here is tesseract.js (WASM) with the English model vendored by
// @tesseract.js-data/eng, so the server never downloads anything at runtime.
// Rendering uses @napi-rs/canvas (prebuilt for the bookworm Docker image).
//
// Both paths also return WORD POSITIONS (text-layer items, or OCR word boxes),
// because an I-797 prints its values under their labels and plain text loses
// the columns — see libs/query/src/mail-layout.ts.
//
// One worker, created on first use and shut down after IDLE_MS without work:
// it holds ~100 MB, which isn't worth keeping for a page that is used a few
// times a day. tesseract.js queues recognize() calls on a worker itself, so
// concurrent scans simply wait their turn.
// =============================================================================

import { createRequire } from "node:module";
import path from "node:path";
import { extractText, extractTextItems, getDocumentProxy, renderPageAsImage, type StructuredTextItem } from "unpdf";
import { createWorker, OEM, type Worker, type Block } from "tesseract.js";
import type { MailPageInput, Word } from "@case-pipeline/query";

/** Below this many non-space characters a text layer is treated as missing. */
const MIN_TEXT_CHARS = 40;
/** Render width in pixels — ~260 DPI for a letter page, plenty for print. */
const RENDER_WIDTH = 2200;
const IDLE_MS = 10 * 60 * 1000;

const require = createRequire(import.meta.url);
const LANG_PATH = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");

let workerPromise: Promise<Worker> | null = null;
let idleTimer: NodeJS.Timeout | null = null;

function getWorker(): Promise<Worker> {
  if (idleTimer) clearTimeout(idleTimer);
  if (!workerPromise) {
    workerPromise = createWorker("eng", OEM.LSTM_ONLY, {
      langPath: LANG_PATH,
      gzip: true,
      // Default caching writes the unpacked model into the CWD.
      cacheMethod: "none",
    }).catch((err: unknown) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const w = workerPromise;
    workerPromise = null;
    idleTimer = null;
    void w?.then((worker) => worker.terminate()).catch(() => {});
  }, IDLE_MS);
  idleTimer.unref();
}

export function needsOcr(text: string): boolean {
  return text.replace(/\s/g, "").length < MIN_TEXT_CHARS;
}

/**
 * Text-layer items → words, top-down. An item is a run of text ("Receipt
 * Number") at a point in PDF space (origin bottom-left); split it into words,
 * spreading its width by character count.
 */
export function wordsFromTextItems(items: StructuredTextItem[], pageHeight: number): Word[] {
  const words: Word[] = [];
  for (const it of items) {
    const str = it.str ?? "";
    if (!str.trim()) continue;
    const perChar = str.length ? it.width / str.length : 0;
    const y1 = pageHeight - it.y;
    const y0 = y1 - (it.height || 10);
    for (const m of str.matchAll(/\S+/g)) {
      const x0 = it.x + m.index! * perChar;
      words.push({ text: m[0], x0, x1: x0 + m[0].length * perChar, y0, y1 });
    }
  }
  return words;
}

/** OCR blocks → words, in image pixels (already top-down). */
export function wordsFromOcrBlocks(blocks: Block[] | null | undefined): Word[] {
  const words: Word[] = [];
  for (const b of blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines)
        for (const w of l.words) {
          if (w.text.trim()) words.push({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 });
        }
  return words;
}

export interface ReadPdfOptions {
  /** false skips OCR entirely (text layer only). Default true. */
  ocr?: boolean;
}

export async function readPdfPages(bytes: Uint8Array, opts: ReadPdfOptions = {}): Promise<MailPageInput[]> {
  // pdf.js may detach the buffer it is handed; keep our own copy for rendering.
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: false });
  const { items } = await extractTextItems(pdf);
  const pages: MailPageInput[] = [];
  for (const [i, t] of text.entries()) {
    const height = (await pdf.getPage(i + 1)).getViewport({ scale: 1 }).height;
    pages.push({ text: t, words: wordsFromTextItems(items[i] ?? [], height) });
  }
  if (opts.ocr === false) return pages;

  const todo = pages.map((p, i) => (needsOcr(p.text) ? i : -1)).filter((i) => i >= 0);
  if (todo.length === 0) return pages;

  const worker = await getWorker();
  try {
    for (const i of todo) {
      const scale = RENDER_WIDTH / (await pdf.getPage(i + 1)).getViewport({ scale: 1 }).width;
      const image = await renderPageAsImage(pdf, i + 1, {
        scale,
        canvasImport: () => import("@napi-rs/canvas"),
      });
      const { data } = await worker.recognize(Buffer.from(image), {}, { text: true, blocks: true });
      pages[i] = {
        text: data.text,
        ocr: true,
        ocrConfidence: Math.round(data.confidence),
        words: wordsFromOcrBlocks(data.blocks),
      };
    }
  } finally {
    scheduleIdleShutdown();
  }
  return pages;
}

/** For tests and shutdown: release the worker now. */
export async function closeOcr(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const w = workerPromise;
  workerPromise = null;
  if (w) await (await w).terminate();
}
