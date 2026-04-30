// =============================================================================
// Column Value Generators (Powered by Faker.js)
// =============================================================================
// Type-specific generators that produce realistic Monday.com column values

import { faker } from "@faker-js/faker";
import {
  CASE_TYPES,
  CASE_FEE_SCHEDULE,
  PRIORITIES,
  CONTRACT_STATUSES,
  CONTRACT_VALUES,
} from "../constants";

// =============================================================================
// Faker Seed Management
// =============================================================================

let currentSeed: number | undefined;

/**
 * Sets the seed for reproducible fake data generation
 */
export function setFakerSeed(seed?: number): void {
  currentSeed = seed;
  if (seed !== undefined) {
    faker.seed(seed);
  }
}

/**
 * Gets the current faker seed
 */
export function getFakerSeed(): number | undefined {
  return currentSeed;
}

// =============================================================================
// Types
// =============================================================================

export interface GeneratorContext {
  name?: string;
  labels?: string[];
  minDays?: number;
  maxDays?: number;
  min?: number;
  max?: number;
  samples?: string[];
  itemIds?: number[];
  locale?: string;
}

export type ColumnGenerator = (context?: GeneratorContext) => unknown;

// =============================================================================
// Basic Generators (using Faker)
// =============================================================================

/**
 * Generates a realistic full name
 */
export function generateName(): string {
  return faker.person.fullName();
}

/**
 * Generates a realistic email address
 */
export function generateEmail(name?: string): string {
  if (name) {
    const [firstName, lastName] = name.split(" ");
    return faker.internet.email({ firstName, lastName });
  }
  return faker.internet.email();
}

/**
 * Generates a realistic phone number
 */
export function generatePhone(): string {
  // Generate a clean 10-digit phone number
  return faker.string.numeric(10);
}

/**
 * Generates a formatted US phone number
 */
export function generateFormattedPhone(): string {
  return faker.phone.number({ style: "national" });
}

/**
 * Generates a date within a range from today
 */
export function generateDate(minDays = 1, maxDays = 30): string {
  const days = faker.number.int({ min: minDays, max: maxDays });
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0] as string;
}

/**
 * Generates a contract ID
 */
export function generateContractId(): string {
  const year = new Date().getFullYear();
  const num = faker.string.numeric(4);
  return `CTR-${year}-${num}`;
}

/**
 * Generates realistic notes/comments
 */
export function generateNotes(): string {
  // Generate a realistic case note
  const templates = [
    () => `Initial consultation completed. ${faker.lorem.sentence()}`,
    () => `Client meeting scheduled for ${faker.date.future().toLocaleDateString()}. ${faker.lorem.sentence()}`,
    () => `Documentation received: ${faker.lorem.words(3)}. ${faker.lorem.sentence()}`,
    () => `Follow-up required regarding ${faker.lorem.words(2)}. ${faker.lorem.sentence()}`,
    () => `Case review in progress. ${faker.lorem.sentences(2)}`,
    () => `${faker.lorem.sentence()} Awaiting client response.`,
    () => `Priority update: ${faker.lorem.sentence()}`,
  ];
  return faker.helpers.arrayElement(templates)();
}

/**
 * Generates a realistic street address
 */
export function generateAddress(): string {
  return faker.location.streetAddress({ useFullAddress: true });
}

/**
 * Generates a company name
 */
export function generateCompanyName(): string {
  return faker.company.name();
}

// =============================================================================
// Monday.com Column Type Generators
// =============================================================================

const columnGenerators: Record<string, ColumnGenerator> = {
  email: (ctx) => {
    const email = generateEmail(ctx?.name);
    return { email, text: email };
  },

  phone: () => generatePhone(),

  status: (ctx) => {
    const labels = ctx?.labels ?? PRIORITIES;
    return { label: faker.helpers.arrayElement(labels) };
  },

  color: (ctx) => {
    const labels = ctx?.labels ?? PRIORITIES;
    return { label: faker.helpers.arrayElement(labels) };
  },

  date: (ctx) => {
    const minDays = ctx?.minDays ?? 1;
    const maxDays = ctx?.maxDays ?? 30;
    return { date: generateDate(minDays, maxDays) };
  },

  numbers: (ctx) => {
    const min = ctx?.min ?? 1000;
    const max = ctx?.max ?? 100000;
    return faker.number.int({ min, max }).toString();
  },

  text: (ctx) => {
    if (ctx?.samples && ctx.samples.length > 0) {
      return faker.helpers.arrayElement(ctx.samples);
    }
    return generateNotes();
  },

  long_text: (ctx) => {
    if (ctx?.samples && ctx.samples.length > 0) {
      return faker.helpers.arrayElement(ctx.samples);
    }
    return generateNotes();
  },

  dropdown: (ctx) => {
    const labels = ctx?.labels ?? CASE_TYPES;
    return { labels: [faker.helpers.arrayElement(labels)] };
  },

  board_relation: (ctx) => {
    const itemIds = ctx?.itemIds ?? [];
    return { item_ids: itemIds };
  },

  // Read-only types - return null (won't be sent to API)
  mirror: () => null,
  lookup: () => null,
  item_id: () => null,
  creation_log: () => null,
  button: () => null,
  subtasks: () => null,
  file: () => null,
  people: () => null,
};

/**
 * Generates a value for a specific column type
 */
export function generateColumnValue(
  type: string,
  context?: GeneratorContext
): unknown {
  const generator = columnGenerators[type];
  if (!generator) {
    console.warn(`No generator for column type: ${type}`);
    return null;
  }
  return generator(context);
}

/**
 * Gets context for a column type based on column key
 */
export function getColumnContext(columnKey: string, columnType: string): GeneratorContext {
  if (columnKey.includes("priority") || columnKey.includes("status")) {
    if (columnType === "status" || columnType === "color") {
      return { labels: PRIORITIES };
    }
  }

  if (columnKey.includes("case_type") || columnKey.includes("casetype")) {
    return { labels: CASE_TYPES };
  }

  if (columnKey.includes("contract_status") || columnKey === "status") {
    if (columnType === "status" || columnType === "color") {
      return { labels: CONTRACT_STATUSES };
    }
  }

  if (columnKey.includes("value") || columnKey.includes("amount")) {
    if (columnType === "numbers") {
      return { min: CONTRACT_VALUES[0], max: CONTRACT_VALUES[CONTRACT_VALUES.length - 1] };
    }
  }

  return {};
}

// Re-export business-specific constants (these remain static as they're domain-specific)
export {
  CASE_TYPES,
  CASE_FEE_SCHEDULE,
  PRIORITIES,
  CONTRACT_STATUSES,
  CONTRACT_VALUES,
};

// Export faker instance for advanced use cases
export { faker };
