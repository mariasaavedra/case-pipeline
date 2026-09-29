// =============================================================================
// mail-probe — what the mail reader makes of real PDFs, page by page
// =============================================================================
// npm run mail:probe -- path/to/scan.pdf [more.pdf …] [--text]
//
// Runs the same reader the upload route uses (text layer, OCR, repairs, layout)
// and the splitter, WITHOUT a database: no matching, nothing saved. Prints one
// line per page and the resulting split. --text also writes each page's text
// next to the PDF (<name>.pdf.txt) for reading what OCR actually saw.
//
// Real scans hold client data: keep them out of the repo (data/ is gitignored).
// =============================================================================

import fs from "node:fs";
import { readPdfPages, closeOcr } from "../apps/api/src/mail/ocr";
import { analyzePage, splitIntoDocuments } from "../libs/query/src/mail";

const args = process.argv.slice(2);
const writeText = args.includes("--text");
const files = args.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.error("Usage: npm run mail:probe -- <scan.pdf> [more.pdf …] [--text]");
  process.exit(1);
}

for (const file of files) {
  const started = Date.now();
  const pages = await readPdfPages(new Uint8Array(fs.readFileSync(file)));
  if (writeText) {
    fs.writeFileSync(
      `${file}.txt`,
      pages.map((p, i) => `=== PAGE ${i + 1} ocr=${Boolean(p.ocr)} confidence=${p.ocrConfidence ?? "-"}\n${p.text}`).join("\n"),
    );
  }
  const infos = pages.map((p, i) => analyzePage(i + 1, p));
  console.log(`\n## ${file} (${Date.now() - started} ms)`);
  for (const p of infos) {
    const f = p.fields;
    const flags = [p.blank && "blank", p.hasNoticeHeader && "header", p.looksLikeNotice ? "notice" : "other"].filter(Boolean);
    const marker = p.pageMarker ? ` page ${p.pageMarker.index}/${p.pageMarker.total}` : "";
    const conf = p.ocrConfidence != null ? ` ocr ${p.ocrConfidence}%` : p.ocr ? " scanner-text" : "";
    const names = [f.petitioner && `pet ${f.petitioner}`, f.beneficiary && `ben ${f.beneficiary}`, f.applicant && `app ${f.applicant}`];
    console.log(
      `  p${p.page}${conf}${marker} [${flags.join(",")}] ` +
        [f.receiptNumbers.join("/") || "no receipt", f.aNumbers.map((a) => `A${a}`).join("/") || "no A#", f.formType ?? "no form",
          f.noticeType, f.noticeDate, ...names].filter(Boolean).join(" · "),
    );
  }
  const { documents, separatorPages } = splitIntoDocuments(infos);
  if (separatorPages.length) console.log(`  separators: ${separatorPages.join(", ")}`);
  for (const d of documents) {
    const unsure = d.uncertainPages.length ? ` — check page ${d.uncertainPages.join(", ")}` : "";
    console.log(`  → notice pages ${d.pages.join(",")} (${d.splitReason}) ${d.fields.receiptNumbers.join("/") || "no receipt"} ${d.fields.formType ?? ""}${unsure}`);
  }
}
await closeOcr();
