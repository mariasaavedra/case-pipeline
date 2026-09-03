// =============================================================================
// Build templates/consult-summary.docx
// =============================================================================
// A .docx committed as a binary is unreviewable — nobody can see in a diff that
// a placeholder moved or a label changed. This generates it from the readable
// definition below, so the template's source of truth is text.
//
//   npx tsx scripts/build-consult-template.ts
//
// Placeholders are docxtemplater {{tags}}. Each one is emitted as its OWN run:
// Word normally splits a paragraph into several runs, which silently breaks a
// tag in half, and generating the XML directly is what avoids that.
// =============================================================================

import fs from "node:fs";
import PizZip from "pizzip";

const OUT = "templates/consult-summary.docx";

/** A line of the document: a heading, a label/value row, or free text. */
type Line =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "field"; label: string; tag: string }
  | { kind: "block"; tag: string }
  | { kind: "note"; text: string }
  | { kind: "caption"; text: string }
  | { kind: "source"; tag: string }
  | { kind: "spacer" };

const DOCUMENT: Line[] = [
  { kind: "title", text: "Consultation Summary" },
  { kind: "spacer" },

  { kind: "heading", text: "Client" },
  { kind: "field", label: "Name", tag: "client_name" },
  { kind: "field", label: "Date of birth", tag: "date_of_birth" },
  { kind: "field", label: "A-number", tag: "a_number" },
  { kind: "field", label: "Country of birth", tag: "country_of_birth" },
  { kind: "field", label: "Preferred language", tag: "language" },
  { kind: "spacer" },

  { kind: "heading", text: "Contact" },
  { kind: "field", label: "Email", tag: "email" },
  { kind: "field", label: "Phone", tag: "phone" },
  { kind: "field", label: "Address", tag: "address" },
  { kind: "spacer" },

  { kind: "heading", text: "Consultation" },
  { kind: "field", label: "Date", tag: "consult_date" },
  { kind: "field", label: "Attorney", tag: "attorney" },
  { kind: "field", label: "Outcome", tag: "consult_outcome" },
  { kind: "spacer" },

  { kind: "heading", text: "Reason for consultation" },
  { kind: "caption", text: "In the client's own words, from the booking." },
  { kind: "block", tag: "reason_for_consult" },
  { kind: "spacer" },

  { kind: "heading", text: "Consultation note" },
  // The note has no single home and no firm convention, so where this one came
  // from travels with it — a reader can weigh a Casenote differently from a
  // note actually filed as a Consult note.
  { kind: "source", tag: "note_source" },
  { kind: "block", tag: "consult_note" },
  { kind: "spacer" },

  { kind: "note", text: "Generated automatically from the Monday.com profile — {{generated_at}}" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One run. `props` carries <w:rPr> content. */
const run = (text: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

const para = (runs: string, props = "") =>
  `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs}</w:p>`;

function lineXml(line: Line): string {
  switch (line.kind) {
    case "title":
      return para(run(line.text, "<w:b/><w:sz w:val=\"36\"/><w:color w:val=\"1F3864\"/>"),
        "<w:spacing w:after=\"120\"/>");
    case "heading":
      return para(run(line.text, "<w:b/><w:sz w:val=\"24\"/><w:color w:val=\"2E5496\"/>"),
        "<w:spacing w:before=\"180\" w:after=\"60\"/>");
    case "field":
      // Label and value are separate runs; the tag run is never split.
      return para(run(`${line.label}: `, "<w:b/>") + run(`{{${line.tag}}}`));
    case "block":
      return para(run(`{{${line.tag}}}`));
    case "note":
      return para(run(line.text, "<w:i/><w:sz w:val=\"18\"/><w:color w:val=\"808080\"/>"),
        "<w:spacing w:before=\"240\"/>");
    case "caption":
      return para(run(line.text, "<w:i/><w:sz w:val=\"18\"/><w:color w:val=\"808080\"/>"));
    case "source":
      return para(run("Source: ", "<w:i/><w:sz w:val=\"18\"/><w:color w:val=\"808080\"/>") +
        run(`{{${line.tag}}}`, "<w:i/><w:sz w:val=\"18\"/><w:color w:val=\"808080\"/>"),
        "<w:spacing w:after=\"80\"/>");
    case "spacer":
      return para("");
  }
}

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${DOCUMENT.map(lineXml).join("\n    ")}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
  </w:body>
</w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

const zip = new PizZip();
zip.file("[Content_Types].xml", contentTypes);
zip.folder("_rels")!.file(".rels", rootRels);
zip.folder("word")!.file("document.xml", documentXml);
zip.folder("word")!.folder("_rels")!.file("document.xml.rels", docRels);

fs.writeFileSync(OUT, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));

const tags = DOCUMENT.flatMap((l) => ("tag" in l ? [l.tag] : [])).concat("generated_at");
console.log(`Wrote ${OUT}`);
console.log(`Placeholders: ${tags.join(", ")}`);
