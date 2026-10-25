import { describe, it, expect } from "vitest";
import {
  NO_CLIENT_SETTINGS, autoTextBlocked, clientLanguage, inSendWindow, missingList, nextReminderAt, reminderDays, stillNeededSentence,
} from "./rules.js";
import { DEFAULT_BUZON_SETTINGS, sanitizeBuzonSettings, type BuzonSettings } from "./settings.js";

const firm = (over: Partial<BuzonSettings> = {}, reminders: Partial<BuzonSettings["reminders"]> = {}): BuzonSettings =>
  ({ ...DEFAULT_BUZON_SETTINGS, ...over, reminders: { ...DEFAULT_BUZON_SETTINGS.reminders, ...reminders } });
const TZ = "America/Chicago";

describe("autoTextBlocked", () => {
  const base = { kind: "link" as const, firm: firm(), client: NO_CLIENT_SETTINGS, phoneE164: "+18165551234", smsMode: "on" as const };
  it("texts when everything allows it", () => {
    expect(autoTextBlocked(base)).toBeNull();
  });
  it("the client's switch wins over everything", () => {
    expect(autoTextBlocked({ ...base, client: { ...NO_CLIENT_SETTINGS, noAutoTexts: true } })).toMatch(/no automatic texts/);
  });
  it("firm switch, received text off by default, SMS off, no phone", () => {
    expect(autoTextBlocked({ ...base, firm: firm({ autoText: false }) })).toMatch(/Settings/);
    expect(autoTextBlocked({ ...base, kind: "received" })).toMatch(/received/);
    expect(autoTextBlocked({ ...base, kind: "received", firm: firm({ receivedText: true }) })).toBeNull();
    expect(autoTextBlocked({ ...base, smsMode: "off" })).toMatch(/SMS_MODE/);
    expect(autoTextBlocked({ ...base, phoneE164: null })).toMatch(/phone/);
  });
});

describe("reminderDays", () => {
  it("off by default; the firm's days once on; the client can turn them off or set their own", () => {
    expect(reminderDays(firm(), NO_CLIENT_SETTINGS)).toBeNull();
    expect(reminderDays(firm({}, { on: true }), NO_CLIENT_SETTINGS)).toEqual([3, 7, 14]);
    expect(reminderDays(firm({}, { on: true }), { ...NO_CLIENT_SETTINGS, reminders: "off" })).toBeNull();
    expect(reminderDays(firm(), { ...NO_CLIENT_SETTINGS, reminders: "custom", days: [2, 5] })).toEqual([2, 5]);
    expect(reminderDays(firm({}, { on: true }), { ...NO_CLIENT_SETTINGS, noAutoTexts: true })).toBeNull();
  });
});

describe("nextReminderAt", () => {
  it("counts from the first text; none after the last day", () => {
    const first = new Date("2026-10-20T15:00:00Z");
    expect(nextReminderAt(first, 0, [3, 7])?.toISOString()).toBe("2026-10-23T15:00:00.000Z");
    expect(nextReminderAt(first, 1, [3, 7])?.toISOString()).toBe("2026-10-27T15:00:00.000Z");
    expect(nextReminderAt(first, 2, [3, 7])).toBeNull();
  });
});

describe("inSendWindow", () => {
  const r = DEFAULT_BUZON_SETTINGS.reminders;
  it("9 to 6 firm time, weekdays only", () => {
    expect(inSendWindow(new Date("2026-10-23T14:30:00Z"), r, TZ)).toBe(true); // Fri 9:30 CDT
    expect(inSendWindow(new Date("2026-10-23T13:30:00Z"), r, TZ)).toBe(false); // Fri 8:30
    expect(inSendWindow(new Date("2026-10-23T23:30:00Z"), r, TZ)).toBe(false); // Fri 18:30
    expect(inSendWindow(new Date("2026-10-24T15:00:00Z"), r, TZ)).toBe(false); // Sat
    expect(inSendWindow(new Date("2026-10-24T15:00:00Z"), { ...r, weekdaysOnly: false }, TZ)).toBe(true);
  });
});

describe("words", () => {
  it("lists names in the client's language, short", () => {
    expect(missingList(["Passport"], "en")).toBe("Passport");
    expect(missingList(["Pasaporte", "Acta de nacimiento"], "es")).toBe("Pasaporte y Acta de nacimiento");
    expect(missingList(["a", "b", "c", "d", "e", "f"], "en")).toBe("a, b, c, d and 2 more");
    expect(stillNeededSentence([], "es")).toBe("Ya tenemos todo lo que necesitamos.");
    expect(stillNeededSentence(["Passport"], "en")).toBe("We still need: Passport.");
  });
  it("language from Preferred Language; none = Spanish", () => {
    expect(clientLanguage("Espanol")).toBe("es");
    expect(clientLanguage("English")).toBe("en");
    expect(clientLanguage(null)).toBe("es");
  });
});

describe("sanitizeBuzonSettings", () => {
  it("keeps sane values, falls back on nonsense", () => {
    const s = sanitizeBuzonSettings({ autoText: false, reminders: { on: true, days: [14, 3, 3, 0, 200, "7"], fromHour: 20, toHour: 8 }, receivedText: true });
    expect(s).toEqual({ autoText: false, reminders: { on: true, days: [3, 7, 14], fromHour: 9, toHour: 18, weekdaysOnly: true }, receivedText: true });
    expect(sanitizeBuzonSettings(null)).toEqual(DEFAULT_BUZON_SETTINGS);
  });
});
