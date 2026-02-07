// =============================================================================
// Main Seeder Orchestrator
// =============================================================================
// Orchestrates data generation into local SQLite (read-only branch: no Monday.com sync)

import type { Database } from "bun:sqlite";
import type { BoardConfig } from "../../../../lib/config/types";
import { initializeDatabase, closeDatabase } from "../db";
import { initializeSchema } from "../db/schema";
import { ProfileFactory } from "../factory/profile-factory";
import { ContractFactory } from "../factory/contract-factory";
import { setFakerSeed, faker } from "../factory/column-generators";
import { loadBoardsConfig } from "../../../../lib/config";

// =============================================================================
// Types
// =============================================================================

export interface SeederConfig {
  dbPath: string;
  seed?: number;
  profileCount: number;
  contractsPerProfile: { min: number; max: number };
  dryRun?: boolean;
  batchId?: number;
}

export interface SeederResult {
  batchId: number;
  profiles: { generated: number };
  contracts: { generated: number };
  duration: number;
}

export interface BatchInfo {
  id: number;
  batchName: string;
  seedValue: number | null;
  createdAt: string;
  status: string;
  profileCount: number;
  contractCount: number;
}

// =============================================================================
// Seeder Class
// =============================================================================

export class Seeder {
  private db: Database;
  private config: SeederConfig;
  private boardsConfig: Record<string, BoardConfig> = {};

  constructor(config: SeederConfig) {
    this.config = config;
    this.db = initializeDatabase({ path: config.dbPath });
  }

  /**
   * Initializes the seeder (schema and config)
   */
  async initialize(): Promise<void> {
    console.log("\nInitializing database...");
    initializeSchema(this.db);

    console.log("Loading board configurations...");
    this.boardsConfig = await loadBoardsConfig();
    console.log(`  Loaded ${Object.keys(this.boardsConfig).length} boards`);
  }

  /**
   * Runs the data generation pipeline (local SQLite only)
   */
  async run(): Promise<SeederResult> {
    const startTime = performance.now();

    // Set faker seed for reproducible generation
    if (this.config.seed !== undefined) {
      setFakerSeed(this.config.seed);
    }

    // Create new batch
    const batchId = this.createBatch();

    const result: SeederResult = {
      batchId,
      profiles: { generated: 0 },
      contracts: { generated: 0 },
      duration: 0,
    };

    try {
      // Validate required board configs exist
      const profilesBoardConfig = this.boardsConfig.profiles;
      const contractsBoardConfig = this.boardsConfig.contracts;

      if (!profilesBoardConfig) {
        throw new Error("Missing 'profiles' board configuration in config/boards.yaml");
      }
      if (!contractsBoardConfig) {
        throw new Error("Missing 'contracts' board configuration in config/boards.yaml");
      }

      // Phase 1: Generate profiles
      console.log("\n[1/2] Generating profiles...");
      const profileFactory = new ProfileFactory(this.db, this.config.seed);
      const profiles = profileFactory.generateBatch(this.config.profileCount, {
        batchId,
        boardConfig: profilesBoardConfig,
      });
      result.profiles.generated = profiles.length;
      console.log(`  Generated ${profiles.length} profiles`);

      // Phase 2: Generate contracts for each profile
      console.log("\n[2/2] Generating contracts...");
      const contractFactory = new ContractFactory(this.db, this.config.seed);

      for (const profile of profiles) {
        const count = faker.number.int({
          min: this.config.contractsPerProfile.min,
          max: this.config.contractsPerProfile.max,
        });
        const contracts = contractFactory.generateBatchForProfile(count, {
          batchId,
          boardConfig: contractsBoardConfig,
          profileLocalId: profile.localId,
          profileName: profile.name,
        });
        result.contracts.generated += contracts.length;
      }
      console.log(`  Generated ${result.contracts.generated} contracts`);

      // Update batch status
      this.updateBatchStatus(batchId, "generated");

      result.duration = performance.now() - startTime;
      return result;
    } catch (error) {
      this.updateBatchStatus(batchId, "failed");
      throw error;
    }
  }

  /**
   * Lists all batches
   */
  listBatches(): BatchInfo[] {
    const batches = this.db
      .prepare(
        `SELECT
           b.id,
           b.batch_name as batchName,
           b.seed_value as seedValue,
           b.created_at as createdAt,
           b.status,
           (SELECT COUNT(*) FROM profiles WHERE batch_id = b.id) as profileCount,
           (SELECT COUNT(*) FROM contracts WHERE batch_id = b.id) as contractCount
         FROM seed_batches b
         ORDER BY b.id DESC`
      )
      .all() as BatchInfo[];

    return batches;
  }

  /**
   * Creates a new batch record
   */
  private createBatch(): number {
    const configHash = this.hashConfig(this.boardsConfig);
    const batchName = `batch-${Date.now()}`;

    const stmt = this.db.prepare(`
      INSERT INTO seed_batches (batch_name, seed_value, config_hash, status)
      VALUES (?, ?, ?, 'generating')
    `);

    const result = stmt.run(batchName, this.config.seed ?? null, configHash);
    return Number(result.lastInsertRowid);
  }

  /**
   * Updates batch status
   */
  private updateBatchStatus(batchId: number, status: string): void {
    this.db.prepare("UPDATE seed_batches SET status = ? WHERE id = ?").run(status, batchId);
  }

  /**
   * Hashes config for drift detection
   */
  private hashConfig(config: Record<string, BoardConfig>): string {
    const str = JSON.stringify(config);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Cleans up resources
   */
  cleanup(): void {
    closeDatabase();
  }
}
