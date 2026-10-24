// =============================================================================
// Buzón — the rules for its automatic texts (no I/O) (docs/features/buzon.md)
// =============================================================================
// Decides whether the app may text a client on its own, when the next reminder
// is due, and the words that go in. Every decision that could text the wrong
// person, at the wrong time, or too often lives here, tested in rules.test.ts.
// =============================================================================

import type { BuzonSettings } from "./settings.js";

export type AutoTextKind = "link" | "reminder" | "received";

export interface ClientBuzonSettings {
  /** Never text this client on its own (VAWA / U visa / a phone someone else reads). */
  noAutoTexts: boolean;
  /** null = the firm's reminders; "off"; "custom" = `days`. */
  reminders: null | "off" | "custom";
  days: number[] | null;
}

export const NO_CLIENT_SETTINGS: ClientBuzonSettings = { noAutoTexts: false, reminders: null, days: null };

/**
 * May the app text this client on its own? Each "no" carries the reason staff
 * are told ("Buzón ready for X, not texted: …").
 */
export function autoTextBlocked(input: {
  kind: AutoTextKind;
  firm: BuzonSettings;
  client: ClientBuzonSettings;
  phoneE164: string | null;
  smsMode: "off" | "dry-run" | "on";
}): string | null {
  if (input.client.noAutoTexts) return "this client is set to no automatic texts";
  if (input.kind === "link" && !input.firm.autoText) return "automatic texts are off in Settings → Firm → Buzón";
  if (input.kind === "received" && !input.firm.receivedText) return "the \"we received\" text is off in Settings";
  if (input.smsMode === "off") return "texting is off on this server (SMS_MODE)";
  if (!input.phoneE164) return "no US phone number on the profile";
  return null;
}

/** The reminder days that apply to this client, or null when they get none. */
export function reminderDays(firm: BuzonSettings, client: ClientBuzonSettings): number[] | null {
  if (client.noAutoTexts || client.reminders === "off") return null;
  if (client.reminders === "custom") return client.days?.length ? client.days : null;
  return firm.reminders.on ? firm.reminders.days : null;
}

/**
 * When the next reminder is due: `days[n]` days after the first text, where n
 * is how many reminders already went. null = no more reminders.
 */
export function nextReminderAt(firstTextAt: Date, remindersSent: number, days: number[]): Date | null {
  const day = days[remindersSent];
  return day === undefined ? null : new Date(firstTextAt.getTime() + day * 86_400_000);
}

/** The hour and weekday in the firm's zone. */
export function firmClock(now: Date, timeZone: string): { hour: number; weekday: number; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
  return { hour: Number(parts.hour) % 24, weekday, date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Texts only go out in office hours (firm time), weekdays when set. */
export function inSendWindow(now: Date, r: BuzonSettings["reminders"], timeZone: string): boolean {
  const { hour, weekday } = firmClock(now, timeZone);
  if (r.weekdaysOnly && (weekday === 0 || weekday === 6)) return false;
  return hour >= r.fromHour && hour < r.toHour;
}

/** "Passport, Birth certificate and Marriage certificate" / "Pasaporte, Acta de nacimiento y Acta de matrimonio". */
export function joinNames(names: string[], lang: "en" | "es"): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${lang === "es" ? "y" : "and"} ${names[names.length - 1]}`;
}

/** A text is short: the first few names, then "and 3 more". */
export function missingList(names: string[], lang: "en" | "es", max = 4): string {
  if (names.length <= max) return joinNames(names, lang);
  const more = names.length - max;
  return `${names.slice(0, max).join(", ")} ${lang === "es" ? `y ${more} más` : `and ${more} more`}`;
}

/** The "we received" text's second sentence. */
export function stillNeededSentence(names: string[], lang: "en" | "es"): string {
  if (!names.length) return lang === "es" ? "Ya tenemos todo lo que necesitamos." : "We have everything we need.";
  return lang === "es" ? `Todavía necesitamos: ${missingList(names, "es")}.` : `We still need: ${missingList(names, "en")}.`;
}

/** Preferred Language "Espanol" / "Spanish" → es; anything else → en; nothing → es (most clients). */
export function clientLanguage(label: string | null | undefined): "es" | "en" {
  const l = label?.trim() ?? "";
  if (!l) return "es";
  return /^(span|espa)/i.test(l) ? "es" : "en";
}
