// =============================================================================
// Contract Factory
// =============================================================================

import type BetterSqlite3 from "better-sqlite3";
type Database = BetterSqlite3.Database;
import type { BoardConfig } from "../../../../lib/config/types";
import {
  generateContractId,
  setFakerSeed,
  faker,
  CONTRACT_STATUSES,
  CASE_FEE_SCHEDULE,
} from "./column-generators";

export interface GeneratedContract {
  localId: string;
  profileLocalId: string;
  name: string;
  caseType: string;
  value: number;
  contractId: string;
  status: string;
  columnValues: Record<string, unknown>;
}

export interface ContractFactoryOptions {
  batchId: number;
  boardConfig: BoardConfig;
  profileLocalId: string;
  profileName: string;
}

export class ContractFactory {
  private db: Database;

  constructor(db: Database, seed?: number) {
    this.db = db;
    if (seed !== undefined) {
      setFakerSeed(seed);
    }
  }

  /**
   * Generates a single contract
   */
  generate(options: ContractFactoryOptions): GeneratedContract {
    const caseFee = faker.helpers.arrayElement(CASE_FEE_SCHEDULE);
    const caseType = caseFee.caseType;
    const value = caseFee.fee;
    const contractId = generateContractId();
    const status = faker.helpers.arrayElement(CONTRACT_STATUSES);
    const localId = faker.string.uuid();
    const name = `${options.profileName} - ${caseType}`;

    const columnValues = this.buildColumnValues(options.boardConfig, {
      caseType,
      value,
      contractId,
      status,
    });

    return {
      localId,
      profileLocalId: options.profileLocalId,
      name,
      caseType,
      value,
      contractId,
      status,
      columnValues,
    };
  }

  /**
   * Generates and persists a single contract
   */
  generateAndPersist(options: ContractFactoryOptions): GeneratedContract {
    const contract = this.generate(options);
    this.persist(contract, options.batchId);
    return contract;
  }

  /**
   * Generates a batch of contracts for a profile
   */
  generateBatchForProfile(
    count: number,
    options: ContractFactoryOptions
  ): GeneratedContract[] {
    const contracts: GeneratedContract[] = [];
    for (let i = 0; i < count; i++) {
      const contract = this.generateAndPersist(options);
      contracts.push(contract);
    }
    return contracts;
  }

  /**
   * Persists a contract to the database
   */
  persist(contract: GeneratedContract, batchId: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO contracts (
        batch_id, local_id, profile_local_id, name,
        case_type, value, contract_id, status, raw_column_values
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      batchId,
      contract.localId,
      contract.profileLocalId,
      contract.name,
      contract.caseType,
      contract.value,
      contract.contractId,
      contract.status,
      JSON.stringify(contract.columnValues)
    );
  }

  /**
   * Builds Monday.com column values based on board config
   */
  private buildColumnValues(
    boardConfig: BoardConfig,
    data: { caseType: string; value: number; contractId: string; status: string }
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};

    for (const [key, resolution] of Object.entries(boardConfig.columns)) {
      const type = resolution.type ?? this.getTypeFromResolution(resolution);

      if (!type) continue;

      // Case type column
      if (key === "case_type" || key.includes("case_type")) {
        if (type === "status" || type === "color") {
          values[key] = { label: data.caseType };
        } else if (type === "dropdown") {
          values[key] = { labels: [data.caseType] };
        } else if (type === "text") {
          values[key] = data.caseType;
        }
        continue;
      }

      // Value/amount column
      if (key === "value" || key.includes("value") || key.includes("amount")) {
        if (type === "numbers") {
          values[key] = data.value.toString();
        }
        continue;
      }

      // Contract ID column
      if (key === "contract_id" || key.includes("contract_id")) {
        if (type === "text") {
          values[key] = data.contractId;
        }
        continue;
      }

      // Status column (different from case_type)
      if (key === "status" && !key.includes("case")) {
        if (type === "status" || type === "color") {
          values[key] = { label: data.status };
        }
        continue;
      }

      // Skip relation/mirror types - handled during sync
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
