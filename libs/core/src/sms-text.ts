// =============================================================================
// SMS text rules — shared by the API (sends) and the web (preview)
// =============================================================================
// Pure functions, no I/O: the phone number a text goes to, how many SMS
// segments a body costs, and how a template's {{placeholders}} are filled.
// The send route and the preview must agree on all three, so they live here
// once.
// =============================================================================

/**
 * A US phone number as E.164 ("+18165551234"), or null when it isn't one.
 * Accepts the shapes Monday holds: "(816) 555-1234", "816.555.1234",
 * "1-816-555-1234", "+1 816 555 1234". International numbers are refused —
 * the firm's RingCentral number texts US numbers only.
 */
export function toUsE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  // NANP: area code and exchange can't start with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

/** "(816) 555-1234" for display. Falls back to the input when it isn't a US number. */
export function formatUsPhone(raw: string): string {
  const e164 = toUsE164(raw);
  if (!e164) return raw;
  return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
}

// GSM 03.38 basic set + the extension table (each extension char costs 2).
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";

export interface SmsSegments {
  /** "gsm" = 160 per single text; "unicode" = 70 (any á, í, ó, ú, emoji…). */
  encoding: "gsm" | "unicode";
  /** Length in the encoding's units. */
  units: number;
  segments: number;
  /** Units per segment for this body (single vs. multipart). */
  perSegment: number;
}

/**
 * How many SMS segments a body is billed and delivered as. Spanish matters
 * here: é and ñ are GSM, but á, í, ó, ú are not — one of them turns the whole
 * message into 70-character segments.
 */
export function smsSegments(body: string): SmsSegments {
  let units = 0;
  let gsm = true;
  for (const ch of body) {
    if (GSM_BASIC.includes(ch)) units += 1;
    else if (GSM_EXTENDED.includes(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (!gsm) {
    // UCS-2: characters outside the BMP (most emoji) take two units.
    units = 0;
    for (const ch of body) units += ch.codePointAt(0)! > 0xffff ? 2 : 1;
    const perSegment = units <= 70 ? 70 : 67;
    return { encoding: "unicode", units, segments: Math.max(1, Math.ceil(units / perSegment)), perSegment };
  }
  const perSegment = units <= 160 ? 160 : 153;
  return { encoding: "gsm", units, segments: Math.max(1, Math.ceil(units / perSegment)), perSegment };
}

/** Placeholder names a template may use. */
export const SMS_PLACEHOLDERS = ["firstName", "name", "firmName", "firmPhone", "link", "links", "sender", "uploadLink", "missing", "stillNeeded"] as const;
export type SmsPlaceholder = (typeof SMS_PLACEHOLDERS)[number];

export interface RenderedSms {
  body: string;
  /** Placeholders the template uses that had no value — the text can't go out like this. */
  missing: string[];
}

/**
 * Fill `{{name}}` placeholders. An empty or absent value is left in the text
 * as `{{name}}` and reported in `missing`, so staff see exactly what is
 * unfilled instead of a client getting "Hola , …".
 */
export function renderSmsTemplate(template: string, vars: Partial<Record<string, string>>): RenderedSms {
  const missing = new Set<string>();
  const body = template.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (whole, key: string) => {
    const v = vars[key]?.trim();
    if (v) return v;
    missing.add(key);
    return whole;
  });
  return { body, missing: [...missing] };
}

/** Placeholders still in a body (after staff edited it). */
export function unfilledPlaceholders(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)].map((m) => m[1]!))];
}

/** First word of a name, for "Hi {{firstName}}". "GARCIA LOPEZ, Maria" → "Maria". */
export function firstNameOf(fullName: string): string {
  const n = fullName.trim();
  if (!n) return "";
  // Monday profiles are sometimes "SURNAME, Given".
  const comma = n.indexOf(",");
  const given = comma >= 0 ? n.slice(comma + 1).trim() : n;
  const first = given.split(/\s+/)[0] ?? "";
  // Names typed in capitals read as shouting in a text.
  return first === first.toUpperCase() && first.length > 1
    ? first.charAt(0) + first.slice(1).toLowerCase()
    : first;
}
