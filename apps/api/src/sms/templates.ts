// =============================================================================
// SMS templates — firm-wide, admin-editable
// =============================================================================
// Stored in data/sms-templates.json (same pattern as document-settings.json):
// the defaults below until an admin saves. Each template has an English and a
// Spanish text; placeholders are filled by renderSmsTemplate (libs/core).
//
// `{{link}}` is filled by staff in the send popup (a Calendly booking link,
// say) unless an admin writes the link into the template itself.
//
// Every default ends with opt-out wording: 10DLC campaigns are approved on the
// sample messages, and carriers expect STOP language in them.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

export interface SmsTemplate {
  /** Stable key — survives a rename. */
  key: string;
  label: string;
  en: string;
  es: string;
}

export const DEFAULT_SMS_TEMPLATES: SmsTemplate[] = [
  {
    key: "consult_link",
    label: "Consultation link",
    en: "Hi {{firstName}}, this is {{firmName}}. You can book your consultation here: {{link}}\nQuestions? Call {{firmPhone}}. Reply STOP to opt out.",
    es: "Hola {{firstName}}, le escribe {{firmName}}. Puede agendar su consulta aquí: {{link}}\n¿Preguntas? Llame al {{firmPhone}}. Responda STOP para no recibir mensajes.",
  },
  {
    key: "payment_links",
    label: "Payment links",
    en: "Hi {{firstName}}, here are your payment links from {{firmName}}:\n{{links}}\nQuestions? Call {{firmPhone}}. Reply STOP to opt out.",
    es: "Hola {{firstName}}, estos son sus enlaces de pago de {{firmName}}:\n{{links}}\n¿Preguntas? Llame al {{firmPhone}}. Responda STOP para no recibir mensajes.",
  },
];

/** Longest template text accepted (≈ 6 Unicode segments). */
export const SMS_TEMPLATE_MAX = 400;

let configPath: string | null = null;

export function initSmsTemplates(dataDir: string): void {
  configPath = path.join(dataDir, "sms-templates.json");
}

export function loadSmsTemplates(): SmsTemplate[] {
  if (!configPath) return structuredClone(DEFAULT_SMS_TEMPLATES);
  try {
    return sanitizeSmsTemplates(JSON.parse(fs.readFileSync(configPath, "utf-8")));
  } catch {
    return structuredClone(DEFAULT_SMS_TEMPLATES);
  }
}

export function saveSmsTemplates(input: unknown): SmsTemplate[] {
  if (!configPath) throw new Error("sms-templates path not initialized");
  const clean = sanitizeSmsTemplates(input);
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  return clean;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Coerce untrusted input. A template needs a label and at least one language;
 * keys are derived from the label when absent and made unique.
 */
export function sanitizeSmsTemplates(input: unknown): SmsTemplate[] {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  return list.flatMap((raw) => {
    const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const label = str(o.label, 80);
    const en = str(o.en, SMS_TEMPLATE_MAX);
    const es = str(o.es, SMS_TEMPLATE_MAX);
    if (!label || (!en && !es)) return [];
    let key = str(o.key, 60).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
      || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
      || "template";
    while (seen.has(key)) key += "_2";
    seen.add(key);
    return [{ key, label, en, es }];
  });
}
