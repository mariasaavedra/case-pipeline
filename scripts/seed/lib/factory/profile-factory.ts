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
  setFakerSeed,
  faker,
  PRIORITIES,
} from "./column-generators";

export interface GeneratedProfile {
  localId: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  nextInteraction: string;
  priority: string;
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
    const notes = generateNotes();
    const priority = faker.helpers.arrayElement(PRIORITIES);
    const nextInteraction = generateDate(1, 30);

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
      notes,
      nextInteraction,
      priority,
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
        batch_id, local_id, name, email, phone, notes,
        next_interaction, priority, raw_column_values
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      batchId,
      profile.localId,
      profile.name,
      profile.email,
      profile.phone,
      profile.notes,
      profile.nextInteraction,
      profile.priority,
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
