// =============================================================================
// DOCX rendering — fill a .docx template with mapped variables
// =============================================================================
// Templates use {{variable}} tags (same names as the .txt Handlebars templates,
// mapped by mapper.ts). Missing values render as empty strings rather than the
// literal "undefined".

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export function renderDocxTemplate(
  templateContent: Buffer,
  vars: Record<string, string>,
): Buffer {
  const zip = new PizZip(templateContent);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  doc.render(vars);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
