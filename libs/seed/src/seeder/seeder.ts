// =============================================================================
// Main Seeder Orchestrator
// =============================================================================
// Orchestrates data generation into local SQLite (read-only branch: no Monday.com sync)

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { BoardConfig } from "@case-pipeline/config/types";
import { initializeDatabase, closeDatabase } from "../db";
import { initializeSchema } from "../db/schema";
import { ProfileFactory } from "../factory/profile-factory";
import type { GeneratedProfile } from "../factory/profile-factory";
import { FeeKFactory } from "../factory/fee-k-factory";
import { BoardItemFactory } from "../factory/board-item-factory";
import {
  generateCourtCaseData,
  generateOpenFormData,
  generateMotionData,
  generateAppealData,
  generateFoiaData,
  generateLitigationData,
  generateI918BData,
  generateAddressChangeData,
  generateOriginalData,
  generateRfeData,
  generateAppointmentData,
  generateJailIntakeData,
} from "../factory/board-generators";
import { UpdateFactory } from "../factory/update-factory";
import { setFakerSeed, faker } from "../factory/column-generators";
import { loadBoardsConfig } from "@case-pipeline/config";
import { CASE_TYPE_BOARD_MAP, ATTORNEY_BOARDS } from "../constants";
import type { BoardDestination } from "../constants";
// Real profile fixtures are gitignored (PII). Import is optional.
let seedRealProfiles: ((db: Database, batchId: number) => number) | null = null;
try {
  // @ts-ignore — file may not exist on disk
  const mod = require("../fixtures/real-profiles");
  seedRealProfiles = mod.seedRealProfiles;
} catch {
  // Fixture file not present — skip
}

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

export interface BoardCounts {
  [boardKey: string]: number;
}

export interface SeederResult {
  batchId: number;
  profiles: { generated: number };
  feeKs: { generated: number };
  boardItems: BoardCounts;
  updates: { generated: number };
  relationships: number;
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
  boardItemCount: number;
}

// =============================================================================
// Board generator dispatch
// =============================================================================

type BoardGeneratorFn = (
  profile: GeneratedProfile,
  feeK: { caseType: string; localId: string },
  dest: BoardDestination
) => { name: string; group?: string; attorney?: string; overrides: Record<string, unknown> };

const BOARD_GENERATORS: Record<string, BoardGeneratorFn> = {
  court_cases: (profile, feeK) => generateCourtCaseData(profile, feeK as any),
  _cd_open_forms: (profile, feeK, dest) => generateOpenFormData(profile, feeK as any, dest.group),
  motions: (profile, feeK) => generateMotionData(profile, feeK as any),
  appeals: (profile, feeK) => generateAppealData(profile, feeK as any),
  foias: (profile, feeK) => generateFoiaData(profile, feeK as any),
  litigation: (profile, feeK) => generateLitigationData(profile, feeK as any),
  _lt_i918b_s: (profile, feeK) => generateI918BData(profile, feeK as any),
};

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
   * Runs the full data generation pipeline
   */
  async run(): Promise<SeederResult> {
    const startTime = performance.now();

    if (this.config.seed !== undefined) {
      setFakerSeed(this.config.seed);
    }

    const batchId = this.createBatch();

    const result: SeederResult = {
      batchId,
      profiles: { generated: 0 },
      feeKs: { generated: 0 },
      boardItems: {},
      updates: { generated: 0 },
      relationships: 0,
      duration: 0,
    };

    try {
      const profilesBoardConfig = this.boardsConfig.profiles;
      const feeKsBoardConfig = this.boardsConfig.fee_ks;

      if (!profilesBoardConfig) {
        throw new Error("Missing 'profiles' board in config/boards.yaml");
      }
      if (!feeKsBoardConfig) {
        throw new Error("Missing 'fee_ks' board in config/boards.yaml");
      }

      const boardItemFactory = new BoardItemFactory(this.db);

      // Phase 1: Generate profiles
      console.log("\n[1/7] Generating profiles...");
      const profileFactory = new ProfileFactory(this.db, this.config.seed);
      const profiles = profileFactory.generateBatch(this.config.profileCount, {
        batchId,
        boardConfig: profilesBoardConfig,
      });
      result.profiles.generated = profiles.length;
      console.log(`  Generated ${profiles.length} profiles`);

      // Phase 2: Generate Fee Ks + work board items
      console.log("\n[2/7] Generating fee Ks and work board items...");
      const feeKFactory = new FeeKFactory(this.db, this.config.seed);

      for (const profile of profiles) {
        const count = faker.number.int({
          min: this.config.contractsPerProfile.min,
          max: this.config.contractsPerProfile.max,
        });
        const feeKs = feeKFactory.generateBatchForProfile(count, {
          batchId,
          boardConfig: feeKsBoardConfig,
          profileLocalId: profile.localId,
          profileName: profile.name,
        });
        result.feeKs.generated += feeKs.length;

        // Create work board items for each Fee K
        for (const feeK of feeKs) {
          const destinations = CASE_TYPE_BOARD_MAP[feeK.caseType];
          if (!destinations) continue;

          for (const dest of destinations) {
            const boardConfig = this.boardsConfig[dest.board];
            if (!boardConfig) continue;

            const generator = BOARD_GENERATORS[dest.board];
            if (!generator) continue;

            const data = generator(profile, feeK, dest);
            const item = boardItemFactory.create({
              batchId,
              boardKey: dest.board,
              boardConfig,
              name: data.name,
              groupTitle: data.group ?? dest.group,
              overrides: data.overrides,
              profileLocalId: profile.localId,
              attorney: data.attorney,
            });
            result.boardItems[dest.board] = (result.boardItems[dest.board] || 0) + 1;

            // Relationship: item → profile
            boardItemFactory.createRelationship(batchId, {
              sourceTable: "board_items",
              sourceLocalId: item.localId,
              targetTable: "profiles",
              targetLocalId: profile.localId,
              relationshipType: "profile",
              columnKey: "profile",
            });
            result.relationships++;

            // Relationship: item → fee_k
            boardItemFactory.createRelationship(batchId, {
              sourceTable: "board_items",
              sourceLocalId: item.localId,
              targetTable: "contracts",
              targetLocalId: feeK.localId,
              relationshipType: "fee_k",
              columnKey: "link_to_fee_ks",
            });
            result.relationships++;
          }
        }
      }
      console.log(`  Generated ${result.feeKs.generated} fee Ks`);
      for (const [board, count] of Object.entries(result.boardItems)) {
        console.log(`  Generated ${count} ${board}`);
      }

      // Phase 3: Direct-from-profile boards
      console.log("\n[3/7] Generating direct-from-profile items...");
      this.generateDirectItems(batchId, profiles, boardItemFactory, result);

      // Phase 4: Appointments (entry points)
      console.log("\n[4/7] Generating appointments...");
      this.generateAppointments(batchId, profiles, boardItemFactory, result);

      // Phase 5: Jail Intakes
      console.log("\n[5/7] Generating jail intakes...");
      this.generateJailIntakes(batchId, profiles, boardItemFactory, result);

      // Phase 6: Client Updates
      console.log("\n[6/7] Generating client updates...");
      this.generateUpdates(batchId, profiles, result);

      // Phase 7: Real profile fixtures (from sampled Monday.com data, optional)
      if (seedRealProfiles) {
        console.log("\n[7/7] Seeding real profile fixtures...");
        const fixtureCount = seedRealProfiles(this.db, batchId);
        result.profiles.generated += fixtureCount;
      } else {
        console.log("\n[7/7] Skipping real fixtures (file not present)");
      }

      this.updateBatchStatus(batchId, "generated");
      result.duration = performance.now() - startTime;
      return result;
    } catch (error) {
      this.updateBatchStatus(batchId, "failed");
      throw error;
    }
  }

  /**
   * Generate Address Changes, Originals, RFEs
   * NVC Notices: disabled per user (too specific — only CVP or I-130+I-601A)
   */
  private generateDirectItems(
    batchId: number,
    profiles: GeneratedProfile[],
    factory: BoardItemFactory,
    result: SeederResult
  ): void {
    const directBoards: Array<{
      boardKey: string;
      chance: number;
      generator: (p: GeneratedProfile) => { name: string; group?: string; attorney?: string; overrides: Record<string, unknown> };
    }> = [
      { boardKey: "address_changes", chance: 0.3, generator: generateAddressChangeData },
      // NVC Notices: 0% — per user, leave empty for now
      // { boardKey: "nvc_notices", chance: 0.0, generator: generateNvcNoticeData },
      { boardKey: "_na_originals_cards_notices", chance: 0.25, generator: generateOriginalData },
      { boardKey: "rfes_all", chance: 0.15, generator: generateRfeData },
    ];

    for (const { boardKey, chance, generator } of directBoards) {
      const boardConfig = this.boardsConfig[boardKey];
      if (!boardConfig) continue;

      let count = 0;
      for (const profile of profiles) {
        if (faker.number.float({ min: 0, max: 1 }) > chance) continue;

        const data = generator(profile);
        const item = factory.create({
          batchId,
          boardKey,
          boardConfig,
          name: data.name,
          groupTitle: data.group,
          overrides: data.overrides,
          profileLocalId: profile.localId,
          attorney: data.attorney,
        });
        count++;

        factory.createRelationship(batchId, {
          sourceTable: "board_items",
          sourceLocalId: item.localId,
          targetTable: "profiles",
          targetLocalId: profile.localId,
          relationshipType: "profile",
          columnKey: "profiles",
        });
        result.relationships++;
      }
      if (count > 0) {
        result.boardItems[boardKey] = (result.boardItems[boardKey] || 0) + count;
        console.log(`  Generated ${count} ${boardKey}`);
      }
    }
  }

  /**
   * Generate appointment entries (1 per profile, random attorney board)
   */
  private generateAppointments(
    batchId: number,
    profiles: GeneratedProfile[],
    factory: BoardItemFactory,
    result: SeederResult
  ): void {
    for (const profile of profiles) {
      const boardKey = faker.helpers.arrayElement(ATTORNEY_BOARDS);
      const boardConfig = this.boardsConfig[boardKey];
      if (!boardConfig) continue;

      const data = generateAppointmentData(profile);
      // Attorney derived from board key: appointments_r → R, appointments_wh → WH
      const attorney = boardKey.replace("appointments_", "").toUpperCase();
      const item = factory.create({
        batchId,
        boardKey,
        boardConfig,
        name: data.name,
        groupTitle: data.group,
        overrides: data.overrides,
        profileLocalId: profile.localId,
        attorney,
      });
      result.boardItems[boardKey] = (result.boardItems[boardKey] || 0) + 1;

      factory.createRelationship(batchId, {
        sourceTable: "board_items",
        sourceLocalId: item.localId,
        targetTable: "profiles",
        targetLocalId: profile.localId,
        relationshipType: "profile",
        columnKey: "profiles",
      });
      result.relationships++;
    }
    const totalAppts = ATTORNEY_BOARDS.reduce(
      (sum, b) => sum + (result.boardItems[b] || 0),
      0
    );
    console.log(`  Generated ${totalAppts} appointments across ${ATTORNEY_BOARDS.length} boards`);
  }

  /**
   * Generate jail intakes (~5% of profiles)
   */
  private generateJailIntakes(
    batchId: number,
    profiles: GeneratedProfile[],
    factory: BoardItemFactory,
    result: SeederResult
  ): void {
    const boardConfig = this.boardsConfig._fa_jail_intakes;
    if (!boardConfig) return;

    let count = 0;
    for (const profile of profiles) {
      if (faker.number.float({ min: 0, max: 1 }) > 0.05) continue;

      const data = generateJailIntakeData(profile.name);
      factory.create({
        batchId,
        boardKey: "_fa_jail_intakes",
        boardConfig,
        name: data.name,
        groupTitle: data.group,
        overrides: data.overrides,
        profileLocalId: profile.localId,
      });
      count++;
    }
    if (count > 0) {
      result.boardItems._fa_jail_intakes = count;
      console.log(`  Generated ${count} jail intakes`);
    }
  }

  /**
   * Generate updates/case notes for each profile
   */
  private generateUpdates(
    batchId: number,
    profiles: GeneratedProfile[],
    result: SeederResult
  ): void {
    const updateFactory = new UpdateFactory(this.db);

    for (const profile of profiles) {
      // Get this profile's board items for linking
      const rows = this.db
        .prepare(
          "SELECT local_id, board_key FROM board_items WHERE batch_id = ? AND profile_local_id = ?"
        )
        .all(batchId, profile.localId) as Array<{ local_id: string; board_key: string }>;

      const boardItems = rows.map((r) => ({
        localId: r.local_id,
        boardKey: r.board_key,
      }));

      const updates = updateFactory.generateBatchForProfile(
        batchId,
        profile.localId,
        boardItems
      );
      result.updates.generated += updates.length;
    }
    console.log(`  Generated ${result.updates.generated} updates`);
  }

  /**
   * Lists all batches
   */
  listBatches(): BatchInfo[] {
    return this.db
      .prepare(
        `SELECT
           b.id,
           b.batch_name as batchName,
           b.seed_value as seedValue,
           b.created_at as createdAt,
           b.status,
           (SELECT COUNT(*) FROM profiles WHERE batch_id = b.id) as profileCount,
           (SELECT COUNT(*) FROM contracts WHERE batch_id = b.id) as contractCount,
           (SELECT COUNT(*) FROM board_items WHERE batch_id = b.id) as boardItemCount
         FROM seed_batches b
         ORDER BY b.id DESC`
      )
      .all() as BatchInfo[];
  }

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

  private updateBatchStatus(batchId: number, status: string): void {
    this.db.prepare("UPDATE seed_batches SET status = ? WHERE id = ?").run(status, batchId);
  }

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

  cleanup(): void {
    closeDatabase();
  }
}

