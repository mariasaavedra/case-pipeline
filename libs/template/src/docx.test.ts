// =============================================================================
// DOCX rendering tests — against the real templates/client-template.docx
// =============================================================================

import { test, expect, describe } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";
import { renderDocxTemplate } from "./docx";

const TEMPLATE_PATH = fileURLToPath(
  new URL("../../../templates/client-template.docx", import.meta.url),
);

function documentXml(docx: Buffer): string {
  return new PizZip(docx).file("word/document.xml")!.asText();
}

describe("renderDocxTemplate", () => {
  const vars = {
    contact_name: "Ana Garcia",
    email: "ana.garcia@example.com",
    phone: "(555) 123-4567",
    priority: "High",
    next_interaction: "2026-08-01",
    notes: "Bring passport and I-94.",
  };

  test("substitutes all {{tags}} in the client letter template", () => {
    const out = renderDocxTemplate(readFileSync(TEMPLATE_PATH), vars);
    const xml = documentXml(out);

    expect(xml).toContain("Ana Garcia");
    expect(xml).toContain("ana.garcia@example.com");
    expect(xml).toContain("(555) 123-4567");
    expect(xml).not.toContain("{{");
    expect(xml).not.toContain("undefined");
  });

  test("missing variables render as empty strings, not 'undefined'", () => {
    const { notes: _notes, ...withoutNotes } = vars;
    const out = renderDocxTemplate(readFileSync(TEMPLATE_PATH), withoutNotes);
    const xml = documentXml(out);

    expect(xml).toContain("Ana Garcia");
    expect(xml).not.toContain("undefined");
    expect(xml).not.toContain("{{");
  });

  test("output is a valid docx zip with the standard parts", () => {
    const out = renderDocxTemplate(readFileSync(TEMPLATE_PATH), vars);
    const zip = new PizZip(out);
    expect(zip.file("word/document.xml")).not.toBeNull();
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
  });
});
