// =============================================================================
// Write the fake scanned-mail PDF to disk
// =============================================================================
// The same PDF the Mail page's "Try a sample PDF" button uses, for opening in a
// viewer or feeding to the scan endpoint by hand. Built from the chosen DB so
// its notices match real rows there. Every page is stamped SAMPLE.
//
//   npm run mail:sample                 # from seed.db → data/samples/sample-mail.pdf
//   npm run mail:sample -- --db=live    # from live.db (contains real client names)
//   npm run mail:sample -- --scanned    # image-only pages, so every page needs OCR
// =============================================================================

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { buildSampleMailPdf, buildScannedSampleMailPdf } from "../apps/api/src/mail/sample";

const source = process.argv.includes("--db=live") ? "live" : "seed";
const dbPath = path.resolve("data", `${source}.db`);
const scanned = process.argv.includes("--scanned");
const outPath = path.resolve("data", "samples", scanned ? "sample-mail-scanned.pdf" : "sample-mail.pdf");

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const bytes = scanned ? await buildScannedSampleMailPdf(db) : await buildSampleMailPdf(db);
db.close();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, bytes);
console.log(`Wrote ${path.relative(process.cwd(), outPath)} (${bytes.length.toLocaleString()} bytes) from ${source}.db`);
