// =============================================================================
// Jail intake field values — the shape, the board's options, and the mapping
// =============================================================================
// Kept apart from the component so it can be tested: JailIntakeFields.tsx pulls
// in ui/select, which uses a "@/" alias vitest does not resolve in this
// workspace. Splitting also puts the part worth pinning — the mapping onto the
// create request — in a file with no UI in it.
//
// Two screens create an intake (the New intake popup, and the "this call is a
// jail intake" section in Log a call). They were written separately once and the
// inline copy silently fell four fields behind, which is why this is shared.
// =============================================================================

/** The board's own Language options, in its order. */
export const INTAKE_LANGUAGES = [
  "Hindi", "English", "Espanol", "Arabic", "French", "Farsi",
  "Tigrinya", "Creole", "Quiche", "Russian", "Vietnamese", "Portuguese",
];

/** The board's own options on "Have you even been removed?" (its spelling). */
export const PRIOR_REMOVAL_OPTIONS = ["No", "Yes", "Unknown"];

export interface JailIntakeFieldValues {
  firstName: string;
  lastName: string;
  jail: string;
  alienNumber: string;
  language: string;
  pocName: string;
  pocPhone: string;
  countryOfBirth: string;
  dateOfBirth: string;
  priorRemoval: string;
  /** YYYY-MM-DD — a real date column on the board, unlike dateOfBirth. */
  pickedUpByIce: string;
  description: string;
}

export type JailIntakeFieldName = keyof JailIntakeFieldValues;

export const emptyJailIntakeFields: JailIntakeFieldValues = {
  firstName: "",
  lastName: "",
  jail: "",
  alienNumber: "",
  language: "",
  pocName: "",
  pocPhone: "",
  countryOfBirth: "",
  dateOfBirth: "",
  priorRemoval: "",
  pickedUpByIce: "",
  description: "",
};

/** Map the captured values onto `createJailIntake`'s input, dropping the blanks. */
export function toCreateJailIntakeInput(
  v: JailIntakeFieldValues,
  extra: { callLogItemId?: string | null; pocName?: string; pocPhone?: string; language?: string } = {},
) {
  const t = (s: string) => s.trim() || undefined;
  return {
    firstName: v.firstName.trim(),
    lastName: t(v.lastName),
    jail: t(v.jail),
    alienNumber: t(v.alienNumber),
    // The host may supply these instead of showing the inputs.
    language: v.language || extra.language || undefined,
    pocName: t(v.pocName) ?? extra.pocName,
    pocPhone: t(v.pocPhone) ?? extra.pocPhone,
    countryOfBirth: t(v.countryOfBirth),
    dateOfBirth: t(v.dateOfBirth),
    priorRemoval: v.priorRemoval || undefined,
    pickedUpByIce: v.pickedUpByIce || undefined,
    description: t(v.description),
    callLogItemId: extra.callLogItemId ?? undefined,
  };
}

/** True when there is enough to create an intake at all. */
export function hasIntakeName(v: JailIntakeFieldValues): boolean {
  return !!(v.firstName.trim() || v.lastName.trim());
}
