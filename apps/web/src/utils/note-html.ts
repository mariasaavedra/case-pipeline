// =============================================================================
// Note HTML — render a synced note/email body safely, with quoted history split
// =============================================================================
// Timeline bodies come from Monday as HTML: update bodies, E&A activity notes,
// and whole email threads copied out of staff mailboxes. `text_body` is a
// whitespace-collapsed copy for search and dedup, which reads as one wall of
// text, so the timeline renders the HTML instead — which means sanitizing it.
//
// Email bodies also carry every earlier message in the thread. `quoted` holds
// that tail (from the first reply/forward marker onward) so the UI can fold it.
// =============================================================================

import DOMPurify from "dompurify";

export interface NoteHtml {
  /** The note itself, sanitized. */
  main: string;
  /** Quoted earlier messages (emails only), sanitized; null when none found. */
  quoted: string | null;
}

// Presentation attributes are dropped so an email's fonts and colors can't
// override the dashboard's (or turn unreadable in dark mode).
const PRESENTATION_ATTRS = ["style", "color", "bgcolor", "face", "background", "width", "height", "align", "valign", "size"];

// Elements that start a quoted earlier message, per mail client:
// Gmail, Apple Mail/Thunderbird, Outlook (web + desktop), Yahoo.
const QUOTE_SELECTORS = [
  ".gmail_quote",
  ".gmail_attr",
  "blockquote[type='cite']",
  "#divRplyFwdMsg",
  "#appendonsend",
  "#mail-editor-reference-message-container",
  ".yahoo_quoted",
  "blockquote",
].join(",");

// Outlook desktop writes the header block as plain paragraphs ("From: … Sent: …").
const HEADER_RE = /^\s*(From|De)\s*:.{1,300}?(Sent|Enviado|Date|Fecha)\s*:/is;

let hooked = false;
function ensureHooks(): void {
  if (hooked) return;
  hooked = true;
  // Links open outside the dashboard, without handing it a window.opener.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

function sanitize(html: string): DocumentFragment {
  ensureHooks();
  return DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "video", "audio"],
  });
}

/** First element that begins the quoted history, in document order. */
function findQuoteStart(root: DocumentFragment): Element | null {
  const bySelector = root.querySelector(QUOTE_SELECTORS);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let byHeader: Element | null = null;
  for (let n = walker.nextNode() as Element | null; n; n = walker.nextNode() as Element | null) {
    if (!/^(P|DIV)$/.test(n.tagName)) continue;
    const text = n.textContent ?? "";
    // Short blocks only: an ancestor holding the whole thread also "starts with From:".
    if (text.length < 600 && HEADER_RE.test(text)) {
      byHeader = n;
      break;
    }
  }
  if (!bySelector) return byHeader;
  if (!byHeader) return bySelector;
  return bySelector.compareDocumentPosition(byHeader) & Node.DOCUMENT_POSITION_PRECEDING ? byHeader : bySelector;
}

function serialize(frag: DocumentFragment): string {
  const div = document.createElement("div");
  div.appendChild(frag);
  div.querySelectorAll("*").forEach((el) => {
    for (const attr of PRESENTATION_ATTRS) el.removeAttribute(attr);
  });
  return div.innerHTML.trim();
}

/** True when the fragment holds nothing a reader would see. */
function isBlank(html: string): boolean {
  return !/<img\b/i.test(html) && html.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "") === "";
}

export function renderNoteHtml(html: string, opts: { splitQuoted?: boolean } = {}): NoteHtml {
  const root = sanitize(html);
  let quoted: string | null = null;

  if (opts.splitQuoted) {
    const start = findQuoteStart(root);
    if (start) {
      const range = document.createRange();
      range.setStartBefore(start);
      range.setEndAfter(root.lastChild!);
      const tail = serialize(range.extractContents());
      if (!isBlank(tail)) quoted = tail;
    }
  }

  const main = serialize(root);
  // A reply that is only quoted text (e.g. a bare forward) keeps it visible.
  if (isBlank(main) && quoted) return { main: quoted, quoted: null };
  return { main, quoted };
}
