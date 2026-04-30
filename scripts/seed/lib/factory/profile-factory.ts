// =============================================================================
// Profile Factory
// =============================================================================

import type { Database } from "bun:sqlite";
import type { BoardConfig } from "../../../../lib/config/types";
import {
  generateName,
  generateEmail,
  generatePhone,
  generateDate,
  generateNotes,
  generateAddress,
  setFakerSeed,
  faker,
  PRIORITIES,
} from "./column-generators";
import { PROFILE_GROUPS } from "../constants";

export interface GeneratedProfile {
  localId: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  dateOfBirth: string;
  placeOfBirth: string;
  aNumber: string;
  notes: string;
  nextInteraction: string;
  priority: string;
  groupTitle: string;
  columnValues: Record<string, unknown>;
}

export interface ProfileFactoryOptions {
  batchId: number;
  boardConfig: BoardConfig;
}

export class ProfileFactory {
  private db: Database;

  constructor(db: Database, seed?: number) {
    this.db = db;
    if (seed !== undefined) {
      setFakerSeed(seed);
    }
  }

  /**
   * Generates a single profile
   */
  generate(options: ProfileFactoryOptions): GeneratedProfile {
    const name = generateName();
    const localId = faker.string.uuid();
    const email = generateEmail(name);
    const phone = generatePhone();
    const address = generateAddress();
    const notes = generateNotes();
    const priority = faker.helpers.arrayElement(PRIORITIES);
    const nextInteraction = generateDate(1, 30);

    // Date of birth: age 18–80
    const dob = faker.date.birthdate({ min: 18, max: 80, mode: "age" });
    const dateOfBirth = dob.toISOString().split("T")[0] as string;

    // Place of birth: city + country
    const placeOfBirth = `${faker.location.city()}, ${faker.location.country()}`;

    // A-Number: 9-digit string
    const aNumber = faker.string.numeric(9);

    // Weighted group assignment: mostly Active Clients
    const groupTitle = faker.helpers.weightedArrayElement([
      { value: "Active Clients", weight: 65 },
      { value: "Non-clients", weight: 20 },
      { value: "Closed clients", weight: 10 },
      { value: "Clinic Profiles (non clients)", weight: 5 },
    ]);

    const columnValues = this.buildColumnValues(options.boardConfig, {
      name,
      email,
      phone,
      notes,
      priority,
      nextInteraction,
    });

    return {
      localId,
      name,
      email,
      phone,
      address,
      dateOfBirth,
      placeOfBirth,
      aNumber,
      notes,
      nextInteraction,
      priority,
      groupTitle,
      columnValues,
    };
  }

  /**
   * Generates and persists a single profile
   */
  generateAndPersist(options: ProfileFactoryOptions): GeneratedProfile {
    const profile = this.generate(options);
    this.persist(profile, options.batchId);
    return profile;
  }

  /**
   * Generates a batch of profiles
   */
  generateBatch(count: number, options: ProfileFactoryOptions): GeneratedProfile[] {
    const profiles: GeneratedProfile[] = [];
    for (let i = 0; i < count; i++) {
      const profile = this.generateAndPersist(options);
      profiles.push(profile);
    }
    return profiles;
  }

  /**
   * Persists a profile to the database
   */
  persist(profile: GeneratedProfile, batchId: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO profiles (
        batch_id, local_id, name, email, phone, address,
        date_of_birth, place_of_birth, a_number,
        notes, next_interaction, priority, group_title, raw_column_values
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      batchId,
      profile.localId,
      profile.name,
      profile.email,
      profile.phone,
      profile.address,
      profile.dateOfBirth,
      profile.placeOfBirth,
      profile.aNumber,
      profile.notes,
      profile.nextInteraction,
      profile.priority,
      profile.groupTitle,
      JSON.stringify(profile.columnValues)
    );
  }

  /**
   * Builds Monday.com column values based on board config
   */
  private buildColumnValues(
    boardConfig: BoardConfig,
    data: Record<string, string>
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};

    for (const [key, resolution] of Object.entries(boardConfig.columns)) {
      const type = resolution.type ?? this.getTypeFromResolution(resolution);

      if (!type) continue;

      switch (type) {
        case "email":
          if (data.email) {
            values[key] = { email: data.email, text: data.email };
          }
          break;
        case "phone":
          if (data.phone) {
            values[key] = data.phone;
          }
          break;
        case "status":
        case "color":
          if (data.priority) {
            values[key] = { label: data.priority };
          }
          break;
        case "date":
          if (data.nextInteraction) {
            values[key] = { date: data.nextInteraction };
          }
          break;
        case "text":
        case "long_text":
          if (data.notes && (key.includes("notes") || key.includes("text"))) {
            values[key] = data.notes;
          }
          break;
        // Skip read-only and relation types during generation
        case "board_relation":
        case "mirror":
        case "lookup":
        case "item_id":
        case "creation_log":
        case "button":
        case "subtasks":
        case "file":
        case "people":
          break;
      }
    }

    return values;
  }

  /**
   * Extracts type from resolution when using by_title with types array
   */
  private getTypeFromResolution(resolution: { types?: string[] }): string | undefined {
    return resolution.types?.[0];
  }
}
