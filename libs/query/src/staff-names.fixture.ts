// Test fixture: a tiny roster for the StaffResolver seam. Mayra under two
// spellings (inactive), Ana under one.
import type { StaffResolver } from "./staff-names";

const people: Record<string, { id: number; name: string; active: boolean }> = {
  "mayra ruiz": { id: 1, name: "Mayra Ruiz", active: false },
  "mayra r.": { id: 1, name: "Mayra Ruiz", active: false },
  "ana reyes": { id: 2, name: "Ana Reyes", active: true },
};

export const testResolver: StaffResolver = (n) => people[n.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;
