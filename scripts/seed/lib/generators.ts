// =============================================================================
// Random data generators for Monday.com seeding
// =============================================================================

import {
  FIRST_NAMES,
  LAST_NAMES,
  EMAIL_DOMAINS,
  CASE_TYPES,
  PRIORITIES,
  CONTRACT_STATUSES,
  CONTRACT_VALUES,
  SAMPLE_NOTES,
} from "./constants";
import type { ProfileData, ContractData } from "./types";

// =============================================================================
// Utility functions
// =============================================================================

export function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// =============================================================================
// Basic generators
// =============================================================================

export function generateName(): string {
  return `${randomElement(FIRST_NAMES)} ${randomElement(LAST_NAMES)}`;
}

export function generateEmail(name: string): string {
  const [first, last] = name.toLowerCase().split(" ");
  const domain = randomElement(EMAIL_DOMAINS);
  const variant = randomInt(1, 100);
  return `${first}.${last}${variant}@${domain}`;
}

export function generatePhone(): string {
  const area = randomInt(200, 999);
  const prefix = randomInt(200, 999);
  const line = randomInt(1000, 9999);
  return `${area}${prefix}${line}`;
}

export function generateDate(daysFromNow: { min: number; max: number }): string {
  const days = randomInt(daysFromNow.min, daysFromNow.max);
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0] as string;
}

export function generateNotes(): string {
  return randomElement(SAMPLE_NOTES);
}

export function generateContractValue(): number {
  return randomElement(CONTRACT_VALUES);
}

export function generateContractId(): string {
  const year = new Date().getFullYear();
  const seq = randomInt(1000, 9999);
  return `CTR-${year}-${seq}`;
}

export function generatePriority(): string {
  return randomElement(PRIORITIES);
}

export function generateCaseType(): string {
  return randomElement(CASE_TYPES);
}

export function generateContractStatus(): string {
  return randomElement(CONTRACT_STATUSES);
}

// =============================================================================
// Composite generators
// =============================================================================

export function generateProfileData(): ProfileData {
  const name = generateName();
  return {
    name,
    email: generateEmail(name),
    phone: generatePhone(),
    notes: generateNotes(),
    nextInteraction: generateDate({ min: 1, max: 30 }),
  };
}

export function generateContractData(): ContractData {
  return {
    caseType: generateCaseType(),
    value: generateContractValue(),
    contractId: generateContractId(),
    status: generateContractStatus(),
  };
}
