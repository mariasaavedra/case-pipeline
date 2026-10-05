// =============================================================================
// Turn a contract's Word form fields into {{tags}}
// =============================================================================
// Contract templates live in SharePoint and staff maintain them in Word (see
// docs/features/contract-signing.md). A tag is just text — {{client_name}} —
// so a NEW template only needs the tags typed in. This helper is for the
// firm's existing drafts, whose blanks are legacy form fields labelled
// "Client Name", "AF", "multiply AF by .03"…: each field becomes plain text
// carrying its tag, in the run it already lives in, so formatting is kept.
// A "$" typed just before a money field is dropped (amounts print with "$").
//
//   npx tsx scripts/tag-contract-template.ts in.docx out.docx
//
// Prints every field it found and what it became; a field whose label isn't
// in LABELS is left as it is and listed, so nothing is silently guessed.
// =============================================================================

import fs from "node:fs";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Form-field label (lower-cased, trimmed) → tag. */
const LABELS: Record<string, string> = {
  "date fee k created": "date",
  "date": "date",
  "client name": "client_name",
  "email address": "email",
  "address": "address",
  "city, state zip": "city_state_zip",
  "master / individual hearing": "hearing_type",
  "hearing date": "hearing_date",
  "form name": "form_name",
  "af": "attorney_fee",
  "ff": "filing_fee",
  "multiply af by .03": "surcharge",
  "af + sf (if any)": "total_fee",
  "af+ff+pf+sf": "total_fee",
  "attorney name": "attorney_name",
  "attorney's name": "attorney_name",
  "fee k creator initials": "creator_initials",
};
const MONEY = new Set(["attorney_fee", "filing_fee", "surcharge", "total_fee", "postage_fee", "interview_fee"]);

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: tsx scripts/tag-contract-template.ts in.docx out.docx");
  process.exit(2);
}

const zip = new PizZip(fs.readFileSync(input));
const doc = new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(), "text/xml");
const runs = Array.from(doc.getElementsByTagNameNS(W, "r")) as Element[];
const fldType = (r: Element) => (r.getElementsByTagNameNS(W, "fldChar")[0] as Element | undefined)?.getAttributeNS(W, "fldCharType") ?? null;
const texts = (r: Element) => Array.from(r.getElementsByTagNameNS(W, "t")) as Element[];

let tagged = 0;
const untouched: string[] = [];
for (let i = 0; i < runs.length; i++) {
  if (fldType(runs[i]!) !== "begin") continue;
  // begin … instrText … separate [result runs] end
  let j = i + 1;
  let instr = "";
  while (j < runs.length && fldType(runs[j]!) !== "separate") {
    instr += Array.from(runs[j]!.getElementsByTagNameNS(W, "instrText")).map((n) => n.textContent).join("");
    j++;
  }
  const sep = j;
  let k = sep + 1;
  while (k < runs.length && fldType(runs[k]!) !== "end") k++;
  if (!instr.includes("FORMTEXT") || k >= runs.length) continue;
  const result = runs.slice(sep + 1, k);
  const label = result.flatMap(texts).map((t) => t.textContent ?? "").join("").trim();
  const tag = LABELS[label.toLowerCase()];
  if (!tag || result.length === 0) {
    untouched.push(label || "(empty)");
    i = k;
    continue;
  }
  // The tag goes into the first result run; the field's own runs go.
  const [first, ...rest] = result.flatMap(texts);
  if (!first) continue;
  first.textContent = `{{${tag}}}`;
  for (const t of rest) t.textContent = "";
  if (MONEY.has(tag)) {
    // A literal "$" right before the field: the amount brings its own.
    const prev = texts(runs[i - 1] ?? runs[i]!).pop();
    if (prev?.textContent?.endsWith("$")) prev.textContent = prev.textContent.slice(0, -1);
  }
  for (const r of [runs[i]!, ...runs.slice(i + 1, sep + 1), runs[k]!]) r.parentNode?.removeChild(r);
  console.log(`  "${label}" → {{${tag}}}`);
  tagged++;
  i = k;
}

zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
fs.writeFileSync(output, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer);
console.log(`${tagged} field(s) tagged → ${output}`);
if (untouched.length > 0) console.log(`Left as form fields (no tag for the label): ${untouched.map((l) => `"${l}"`).join(", ")}`);
