// =============================================================================
// Filing a piece of mail (M32): the CC folder, the file name, the client e-mail
// =============================================================================
// The letter goes into the client's E-File → CC folder (every E-File has one;
// spelled "CC", "CCs" or "CC's"), and the client is told by e-mail from the
// staff member's own Outlook — English and Spanish in one message, like the
// payment links (lib/payment-email.ts).
// =============================================================================

import type { NoticeFields } from "../api";
import { FIRM_PHONE } from "./payment-email";

/** The CC folder inside an E-File, however it was spelled. Created as "CC" when missing. */
export const CC_FOLDER_NAME = "CC";
const CC_RE = /^\s*cc(?:['’]?s)?\s*$/i;

export function pickCcFolder<T extends { name: string; folder?: unknown }>(children: T[]): T | null {
  return children.find((c) => c.folder && CC_RE.test(c.name)) ?? null;
}

/**
 * Graph's sendMail takes a JSON body of about 4 MB; base64 makes a file a third
 * bigger. Above this the letter is not attached (it's in the E-File either way).
 */
export const MAX_ATTACH_BYTES = 2.5 * 1024 * 1024;

/** SharePoint refuses these in a file name. */
const BAD_CHARS = /["*:<>?/\\|#%]/g;

/** "2026-10-20 Receipt Notice I130.pdf" — the notice date, else today. */
export function defaultMailFileName(f: Pick<NoticeFields, "noticeDate" | "noticeType" | "formType">, today: string): string {
  const name = [f.noticeDate ?? today, f.noticeType ?? "Mail", f.formType].filter(Boolean).join(" ");
  return cleanMailFileName(name);
}

/** Safe for SharePoint, always ending in .pdf. */
export function cleanMailFileName(raw: string): string {
  const base = raw.replace(/\.pdf$/i, "").replace(BAD_CHARS, "-").replace(/\s+/g, " ").trim().slice(0, 150);
  return `${base || "Mail"}.pdf`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface MailEmail {
  subject: string;
  html: string;
  /** The same message as plain text, for the preview in M32. */
  text: string;
}

/** What the letter is, for the client: "Receipt Notice (I130), dated 2026-10-20, receipt IOE…". */
function describe(f: NoticeFields, lang: "en" | "es"): string {
  const t = lang === "en" ? { dated: "dated", receipt: "receipt" } : { dated: "con fecha", receipt: "recibo" };
  const what = f.noticeType ?? (lang === "en" ? "a letter" : "una carta");
  return [
    `${what}${f.formType ? ` (${f.formType})` : ""}`,
    f.noticeDate ? `${t.dated} ${f.noticeDate}` : null,
    f.receiptNumbers.length ? `${t.receipt} ${f.receiptNumbers.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function mailClientEmail(opts: {
  clientName: string;
  fields: NoticeFields;
  /** The letter is attached (else: it's in their file). */
  attached: boolean;
  /** Anything the staff member adds, as typed (one language). */
  message: string;
  senderName: string;
}): MailEmail {
  const { clientName, fields, attached, senderName } = opts;
  const message = opts.message.trim();
  const subject = `Mail received / Correspondencia recibida — ${clientName}`;

  const en = {
    hello: `Dear ${clientName},`,
    intro: `Our office received mail about your case: ${describe(fields, "en")}.`,
    copy: attached ? "A copy is attached to this e-mail. We also saved it in your file." : "We saved it in your file.",
    next: "If anything is needed from you, we will contact you.",
    outro: `If you have any questions, reply to this e-mail or call us at ${FIRM_PHONE}.`,
  };
  const es = {
    hello: `Estimado/a ${clientName}:`,
    intro: `Nuestra oficina recibió correspondencia sobre su caso: ${describe(fields, "es")}.`,
    copy: attached ? "Adjuntamos una copia a este correo. También la guardamos en su expediente." : "La guardamos en su expediente.",
    next: "Si necesitamos algo de usted, nos comunicaremos con usted.",
    outro: `Si tiene alguna pregunta, responda a este correo o llámenos al ${FIRM_PHONE}.`,
  };

  const htmlBlock = (t: typeof en) => `
    <p>${esc(t.hello)}</p>
    <p>${esc(t.intro)}</p>
    <p>${esc(t.copy)} ${esc(t.next)}</p>
    <p>${esc(t.outro)}</p>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
    ${htmlBlock(en)}
    <hr style="border:none;border-top:1px solid #ccc;margin:20px 0">
    <div style="font-style:italic">${htmlBlock(es)}</div>
    ${message ? `<p>${esc(message).replace(/\n/g, "<br>")}</p>` : ""}
    <p>${esc(senderName)}<br>Sharma-Crawford Attorneys at Law<br>${FIRM_PHONE}</p>
  </div>`;

  const textBlock = (t: typeof en) => [t.hello, "", t.intro, "", `${t.copy} ${t.next}`, "", t.outro].join("\n");
  const text = [
    textBlock(en), "", "———", "", textBlock(es), "",
    ...(message ? [message, ""] : []),
    senderName, "Sharma-Crawford Attorneys at Law", FIRM_PHONE,
  ].join("\n");

  return { subject, html, text };
}

/** A Blob as base64, for a Graph file attachment. */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
