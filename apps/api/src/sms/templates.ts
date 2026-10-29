// =============================================================================
// SMS templates — firm-wide; anyone adds or edits one, admins reorder/delete
// =============================================================================
// Stored in data/sms-templates.json (same pattern as document-settings.json):
// the defaults below until someone saves. Staff add and edit templates from the
// send popup (M28 / M2's "Send a text"); Settings → Firm (admin) replaces the
// whole list. Each template has an English and a
// Spanish text; placeholders are filled by renderSmsTemplate (libs/core).
//
// `{{link}}` is filled by staff in the send popup (a Calendly booking link,
// say) unless an admin writes the link into the template itself.
// `{{uploadLink}}` is filled by the Upload link popup (M30) with the link it
// just made; that template is REQUIRED_SMS_TEMPLATES, so it is always there.
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
  {
    key: "upload_link",
    label: "Upload link",
    en: "Hi {{firstName}}, this is {{firmName}}. Send us your documents here (photos, PDF or Word): {{uploadLink}}\nQuestions? Call {{firmPhone}}. Reply STOP to opt out.",
    es: "Hola {{firstName}}, le escribe {{firmName}}. Envíenos sus documentos aquí (fotos, PDF o Word): {{uploadLink}}\n¿Preguntas? Llame al {{firmPhone}}. Responda STOP para no recibir mensajes.",
  },
  // The Buzón's own texts (docs/features/buzon.md): sent by the app — the first
  // one when a Fee K is paid, reminders on the days set in Settings → Firm → Buzón.
  {
    key: "buzon_link",
    label: "Buzón: documents for your case",
    en: "Hi {{firstName}}, this is {{firmName}}. Thank you for your payment. To start your case, please send us these documents here: {{uploadLink}}\nQuestions? Call {{firmPhone}}. Reply STOP to opt out.",
    es: "Hola {{firstName}}, le escribe {{firmName}}. Gracias por su pago. Para empezar su caso, envíenos estos documentos aquí: {{uploadLink}}\n¿Preguntas? Llame al {{firmPhone}}. Responda STOP para no recibir mensajes.",
  },
  {
    key: "buzon_reminder",
    label: "Buzón: reminder",
    en: "Hi {{firstName}}, this is {{firmName}}. We still need: {{missing}}. Send them here: {{uploadLink}}\nQuestions? Call {{firmPhone}}. Reply STOP to opt out.",
    es: "Hola {{firstName}}, le escribe {{firmName}}. Todavía necesitamos: {{missing}}. Envíelos aquí: {{uploadLink}}\n¿Preguntas? Llame al {{firmPhone}}. Responda STOP para no recibir mensajes.",
  },
  {
    key: "buzon_received",
    label: "Buzón: we received your documents",
    en: "Hi {{firstName}}, this is {{firmName}}. We received your documents. Thank you! {{stillNeeded}}\nQuestions? Call {{firmPhone}}. Reply STOP to opt out.",
    es: "Hola {{firstName}}, le escribe {{firmName}}. Recibimos sus documentos. ¡Gracias! {{stillNeeded}}\n¿Preguntas? Llame al {{firmPhone}}. Responda STOP para no recibir mensajes.",
  },
  // The phone menu's "press 1" text (docs/features/phone-ivr.md): sent by the
  // app to whoever called, so no {{firstName}} — most callers aren't clients
  // yet — and no {{link}}: no one is there to fill it, so the link is written
  // in (staff change it in Settings → Firm). A {{placeholder}} left in stops it.
  {
    key: "ivr_scheduling_link",
    label: "Phone menu: scheduling link",
    en: "This is {{firmName}}. You can schedule your consultation here: https://sharma-crawford.com/schedule-a-consultation/\nQuestions? Call {{firmPhone}}. Reply STOP to opt out.",
    es: "Le escribe {{firmName}}. Puede agendar su consulta aquí: https://sharma-crawford.com/schedule-a-consultation/\n¿Preguntas? Llame al {{firmPhone}}. Responda STOP para no recibir mensajes.",
  },
];

/**
 * Templates a feature opens by key (the Upload link popup → upload_link). One
 * missing from the saved list is added back from the defaults, so a list an
 * admin saved before it existed — or a deleted one — never breaks that button.
 * An admin can still reword it.
 */
export const REQUIRED_SMS_TEMPLATES = ["upload_link", "buzon_link", "buzon_reminder", "buzon_received", "ivr_scheduling_link"] as const;

export function withRequiredTemplates(list: SmsTemplate[]): SmsTemplate[] {
  const missing = DEFAULT_SMS_TEMPLATES.filter(
    (d) => (REQUIRED_SMS_TEMPLATES as readonly string[]).includes(d.key) && !list.some((t) => t.key === d.key),
  );
  return [...list, ...structuredClone(missing)];
}

/** Longest template text accepted (≈ 6 Unicode segments). */
export const SMS_TEMPLATE_MAX = 400;

let configPath: string | null = null;

export function initSmsTemplates(dataDir: string): void {
  configPath = path.join(dataDir, "sms-templates.json");
}

export function loadSmsTemplates(): SmsTemplate[] {
  if (!configPath) return structuredClone(DEFAULT_SMS_TEMPLATES);
  try {
    return withRequiredTemplates(sanitizeSmsTemplates(JSON.parse(fs.readFileSync(configPath, "utf-8"))));
  } catch {
    return structuredClone(DEFAULT_SMS_TEMPLATES);
  }
}

export function saveSmsTemplates(input: unknown): SmsTemplate[] {
  if (!configPath) throw new Error("sms-templates path not initialized");
  const clean = withRequiredTemplates(sanitizeSmsTemplates(input));
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  return clean;
}

export class SmsTemplateError extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message);
  }
}

/** One template from untrusted input, or why not. The key is not taken from it. */
function oneTemplate(input: unknown): Omit<SmsTemplate, "key"> {
  const [t] = sanitizeSmsTemplates([{ ...(typeof input === "object" && input !== null ? input : {}), key: "x" }]);
  if (!t) throw new SmsTemplateError("A template needs a name and an English or Spanish text", 400);
  return { label: t.label, en: t.en, es: t.es };
}

/**
 * Any signed-in user can add a template (M28 "+ New"). Appended to the list;
 * the key comes from the name, made unique against the existing ones.
 */
export function createSmsTemplate(input: unknown): SmsTemplate {
  const t = oneTemplate(input);
  const list = loadSmsTemplates();
  const saved = saveSmsTemplates([...list, t]);
  return saved[saved.length - 1]!;
}

/** Any signed-in user can edit a template's name and texts; its key never changes. */
export function updateSmsTemplate(key: string, input: unknown): SmsTemplate {
  const t = oneTemplate(input);
  const list = loadSmsTemplates();
  const i = list.findIndex((x) => x.key === key);
  if (i < 0) throw new SmsTemplateError("Template not found", 404);
  list[i] = { key, ...t };
  return saveSmsTemplates(list)[i]!;
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
