// =============================================================================
// Build "READ ME - template fields.docx" for the contract templates folder
// =============================================================================
// The cheat sheet staff use when editing a contract template in Word: every
// {{tag}} the app fills, what it prints, an example. Generated from
// CONTRACT_FIELDS (apps/web/src/lib/contract-fill.ts) so it can't drift from
// what the app actually supports. Upload the result to the templates folder
// (SharePoint: Fee Contracts / App Templates) after adding a field.
//
//   npx tsx scripts/build-contract-readme.ts out.docx
// =============================================================================

import fs from "node:fs";
import PizZip from "pizzip";
import { CONTRACT_FIELDS } from "../apps/web/src/lib/contract-fill";

const out = process.argv[2];
if (!out) {
  console.error("usage: tsx scripts/build-contract-readme.ts out.docx");
  process.exit(2);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (text: string, opts: { bold?: boolean; mono?: boolean; size?: number } = {}) =>
  `<w:r><w:rPr>${opts.mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ""}${opts.bold ? "<w:b/>" : ""}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ""}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;
const cell = (content: string, width: number) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${para(content)}</w:tc>`;
const row = (cells: string[], header = false) => `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.join("")}</w:tr>`;
const border = '<w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/>';

const body = [
  para(run("Contract templates — fields the app fills in", { bold: true, size: 32 })),
  para(run("Every Word file in this folder is a contract template in the dashboard (Contracts → ⋯ → Generate contract…), named after the file.")),
  para(run("To leave a blank for the app to fill, type its field exactly as below, with the double braces, e.g. "), run("Dear {{client_name}},", { mono: true })),
  para(run("• Amounts print with their $ sign: write "), run("{{attorney_fee}}", { mono: true }), run(", not "), run("${{attorney_fee}}", { mono: true }), run(".")),
  para(run("• A typo (e.g. "), run("{{clinet_name}}", { mono: true }), run(") or a missing brace is caught: the dashboard shows the problem and won't generate until the file is fixed.")),
  para(run("• Only the fields a template uses are asked for. Use the formatting you want (bold, size…) on the whole field, braces included.")),
  para(run("• Word keeps every version of a file (… → Version history), so a bad edit can be undone.")),
  para(run("• To add a contract: put a new Word file (.docx) here. To retire one: move it out of this folder.")),
  para(""),
  `<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3800"/><w:gridCol w:w="2800"/></w:tblGrid>`,
  row([cell(run("Type this", { bold: true }), 3000), cell(run("What it is", { bold: true }), 3800), cell(run("Prints like", { bold: true }), 2800)], true),
  ...CONTRACT_FIELDS.map((f) => row([cell(run(`{{${f.tag}}}`, { mono: true }), 3000), cell(run(f.label), 3800), cell(run(f.example), 2800)])),
  "</w:tbl>",
  para(""),
  para(run("Need a field that isn't listed? Ask for it to be added to the dashboard first — an unknown field blocks the template.", { size: 20 })),
].join("");

const zip = new PizZip();
zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
fs.writeFileSync(out, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer);
console.log(`Wrote ${out} (${CONTRACT_FIELDS.length} fields)`);
