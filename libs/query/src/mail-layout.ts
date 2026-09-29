// =============================================================================
// Mail layout reader — every labelled field on a notice, by position
// =============================================================================
// An I-797 prints most of its fields as a grid: a row of labels, and each
// value in the row BELOW, under its label —
//
//     Receipt Number              Case Type
//     IOE0912345678               I130 - PETITION FOR ALIEN RELATIVE
//     Received Date   Priority Date   Notice Date     Page
//     08/14/2026                      08/20/2026      1 of 1
//
// — while other notices (and our own inline samples) write "Label: value".
// Plain text loses the columns, so this reads words WITH their positions (from
// the PDF text layer, or from OCR's word boxes) and, for each label, takes the
// words to its right on the same line, or else the words beneath it inside its
// column (bounded by the next label on the label's row). "Priority Date" with
// nothing under it therefore comes back empty instead of stealing the Notice
// Date next to it.
//
// Pure: the readers in apps/api turn a page into Word[]; this never touches a
// PDF. Without positions (a string page), words are synthesised from the text
// with character offsets, which keeps "Label: value" working.
// =============================================================================

export interface Word {
  text: string;
  /** Left/right edge. Any unit, as long as one page uses one unit. */
  x0: number;
  x1: number;
  /** Top/bottom edge, y growing DOWN the page. */
  y0: number;
  y1: number;
}

export type LayoutKey =
  | "receiptNumber"
  | "caseType"
  | "receivedDate"
  | "priorityDate"
  | "noticeDate"
  | "noticeType"
  | "petitioner"
  | "beneficiary"
  | "applicant"
  | "aNumber"
  | "dateOfBirth"
  | "section"
  | "page";

/** Raw text found for each label (first occurrence wins). */
export type LayoutValues = Partial<Record<LayoutKey, string>>;

interface Line {
  words: Word[];
  y0: number;
  y1: number;
}

// Label phrases, as lowercase word sequences. Longest first so "receipt
// number" is tried before anything shorter could claim "receipt".
const LABELS: Array<[string[], LayoutKey]> = (
  [
    [["alien", "registration", "number"], "aNumber"],
    [["uscis", "a#"], "aNumber"],
    [["receipt", "number"], "receiptNumber"],
    [["receipt", "#"], "receiptNumber"],
    [["receipt", "no"], "receiptNumber"],
    [["case", "type"], "caseType"],
    [["form", "type"], "caseType"],
    [["received", "date"], "receivedDate"],
    [["date", "received"], "receivedDate"],
    [["priority", "date"], "priorityDate"],
    [["notice", "date"], "noticeDate"],
    [["notice", "type"], "noticeType"],
    [["date", "of", "birth"], "dateOfBirth"],
    [["birth", "date"], "dateOfBirth"],
    [["alien", "number"], "aNumber"],
    [["a", "number"], "aNumber"],
    [["a-number"], "aNumber"],
    [["a#"], "aNumber"],
    [["dob"], "dateOfBirth"],
    [["petitioner"], "petitioner"],
    [["beneficiary"], "beneficiary"],
    [["applicant"], "applicant"],
    [["section"], "section"],
    [["classification"], "section"],
    [["page"], "page"],
  ] as Array<[string[], LayoutKey]>
).sort((a, b) => b[0].length - a[0].length);

// Scanner OCR often glues a stray quote onto a label ("‘Case Type").
const norm = (w: string) => w.toLowerCase().replace(/^[‘’'"“”`]+/, "").replace(/[:.,]+$/g, "");

const NAME_KEYS = new Set<LayoutKey>(["petitioner", "beneficiary", "applicant"]);
// The I-797 grid prints "Applicant  A123 456 789" with the name on the row below.
const A_NUMBER_ONLY_RE = /^A\s*[#:-]?\s*[\dOoIl|]{2,3}[\s-]?[\dOoIl|]{3}[\s-]?[\dOoIl|]{3}$/i;

interface LabelHit {
  key: LayoutKey;
  start: number; // word index in line
  end: number; // exclusive
  x0: number;
  x1: number;
  colon: boolean;
  /** Multi-word ("Receipt Number") or "#"-bearing labels can't be ordinary prose. */
  distinctive: boolean;
}

function findLabels(line: Line): LabelHit[] {
  const hits: LabelHit[] = [];
  const words = line.words.map((w) => norm(w.text));
  for (let i = 0; i < words.length; ) {
    let matched = false;
    for (const [phrase, key] of LABELS) {
      if (i + phrase.length > words.length) continue;
      if (phrase.every((p, k) => words[i + k] === p)) {
        const last = line.words[i + phrase.length - 1]!;
        hits.push({
          key,
          start: i,
          end: i + phrase.length,
          x0: line.words[i]!.x0,
          x1: last.x1,
          colon: /:$/.test(last.text),
          distinctive: phrase.length > 1 || phrase.some((p) => p.includes("#")),
        });
        i += phrase.length;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  // A label word inside ordinary prose ("…the section of the Act…") is not a
  // field. Trust it when it ends in a colon, sits on a short line, or shares
  // its line with other labels (a grid header row).
  const trusted = hits.length >= 2 || line.words.length <= 6;
  return hits.filter((h) => h.colon || h.distinctive || trusted);
}

function groupLines(words: Word[]): Line[] {
  const sorted = words
    .filter((w) => w.text.trim())
    .slice()
    .sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const heights = sorted.map((w) => w.y1 - w.y0).filter((h) => h > 0).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 1;
  const lines: Line[] = [];
  for (const w of sorted) {
    const yc = (w.y0 + w.y1) / 2;
    const line = lines[lines.length - 1];
    if (line && Math.abs(yc - (line.y0 + line.y1) / 2) <= median * 0.5) {
      line.words.push(w);
      line.y0 = Math.min(line.y0, w.y0);
      line.y1 = Math.max(line.y1, w.y1);
    } else {
      lines.push({ words: [w], y0: w.y0, y1: w.y1 });
    }
  }
  for (const l of lines) l.words.sort((a, b) => a.x0 - b.x0);
  return lines;
}

/** Split text into words with character-offset positions — for pages that came without boxes. */
export function wordsFromText(text: string): Word[] {
  const words: Word[] = [];
  text.split(/\r?\n/).forEach((line, row) => {
    for (const m of line.matchAll(/\S+/g)) {
      words.push({ text: m[0], x0: m.index!, x1: m.index! + m[0].length, y0: row, y1: row + 1 });
    }
  });
  return words;
}

/**
 * Read every labelled field. `words` come from the page's text layer or OCR;
 * without them the text is split with character positions (inline values only).
 */
export function readLayout(text: string, words?: Word[] | null): LayoutValues {
  const lines = groupLines(words && words.length > 0 ? words : wordsFromText(text));
  const out: LayoutValues = {};
  const lineHeight = (l: Line) => Math.max(l.y1 - l.y0, 1e-6);

  lines.forEach((line, li) => {
    const labels = findLabels(line);
    labels.forEach((label, k) => {
      if (label.key in out) return;
      const next = labels[k + 1];

      // 1. Inline: the words after the label, up to the next label.
      const inline = line.words
        .slice(label.end, next ? next.start : line.words.length)
        .map((w) => w.text)
        .join(" ")
        .replace(/^[:#\s-]+/, "")
        .trim();
      if (inline && NAME_KEYS.has(label.key) && A_NUMBER_ONLY_RE.test(inline)) {
        // Not the name — the A-number beside it. Keep it and look below for the name.
        out.aNumber ??= inline.replace(/^A\s*[#:-]?\s*/i, "");
      } else if (inline) {
        out[label.key] = inline;
        return;
      }

      // 2. Beneath: the first lower line with words in this label's column.
      const h = lineHeight(line);
      const left = label.x0 - h * 1.5;
      const right = next ? next.x0 - h * 0.5 : Number.POSITIVE_INFINITY;
      for (let j = li + 1; j < lines.length && j <= li + 3; j++) {
        const below = lines[j]!;
        if (below.y0 - line.y1 > h * 3.5) break;
        const inColumn = below.words.filter((w) => {
          const xc = (w.x0 + w.x1) / 2;
          return xc >= left && xc < right;
        });
        if (inColumn.length === 0) continue;
        // A row of labels below is the next header, not a value.
        if (findLabels({ ...below, words: inColumn }).length > 0 && findLabels(below).length >= 2) break;
        // A label inside the value's row ("LOPEZ, JUAN  A# 123…") ends the value.
        const cut = findLabels({ ...below, words: inColumn }).find((l) => l.start > 0);
        const value = inColumn.slice(0, cut ? cut.start : inColumn.length);
        out[label.key] = value.map((w) => w.text).join(" ").trim();
        return;
      }
    });
  });
  return out;
}
