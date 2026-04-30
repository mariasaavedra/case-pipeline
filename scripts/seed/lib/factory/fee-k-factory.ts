// =============================================================================
// Fee K (Contract) Factory
// =============================================================================

import type { Database } from "bun:sqlite";
import type { BoardConfig } from "../../../../lib/config/types";
import {
  generateContractId,
  generateDate,
  setFakerSeed,
  faker,
  CASE_FEE_SCHEDULE,
  CONTRACT_STATUSES,
} from "./column-generators";

export interface GeneratedFeeK {
  localId: string;
  profileLocalId: string;
  name: string;
  caseType: string;
  value: number;
  contractId: string;
  status: string;
  columnValues: Record<string, unknown>;
}

export interface FeeKFactoryOptions {
  batchId: number;
  boardConfig: BoardConfig;
  profileLocalId: string;
  profileName: string;
}

export class FeeKFactory {
  private db: Database;

  constructor(db: Database, seed?: number) {
    this.db = db;
    if (seed !== undefined) {
      setFakerSeed(seed);
    }
  }

  generate(options: FeeKFactoryOptions): GeneratedFeeK {
    const caseFee = faker.helpers.arrayElement(CASE_FEE_SCHEDULE);
    const caseType = caseFee.caseType;
    const value = caseFee.fee;
    const contractId = generateContractId();
    const status = faker.helpers.arrayElement(CONTRACT_STATUSES);
    const localId = faker.string.uuid();
    const name = `${options.profileName} - ${caseType}`;

    const ff = faker.number.int({ min: 0, max: 1500 });
    const pf = faker.number.int({ min: 0, max: 500 });
    const hireDate = generateDate(-90, -1);

    const columnValues = this.buildColumnValues(options.boardConfig, {
      caseType,
      value,
      contractId,
      status,
      ff,
      pf,
      hireDate,
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

  generateAndPersist(options: FeeKFactoryOptions): GeneratedFeeK {
    const feeK = this.generate(options);
    this.persist(feeK, options.batchId);
    return feeK;
  }

  generateBatchForProfile(
    count: number,
    options: FeeKFactoryOptions
  ): GeneratedFeeK[] {
    const feeKs: GeneratedFeeK[] = [];
    for (let i = 0; i < count; i++) {
      const feeK = this.generateAndPersist(options);
      feeKs.push(feeK);
    }
    return feeKs;
  }

  persist(feeK: GeneratedFeeK, batchId: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO contracts (
        batch_id, local_id, profile_local_id, name,
        case_type, value, contract_id, status, raw_column_values
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      batchId,
      feeK.localId,
      feeK.profileLocalId,
      feeK.name,
      feeK.caseType,
      feeK.value,
      feeK.contractId,
      feeK.status,
      JSON.stringify(feeK.columnValues)
    );
  }

  private buildColumnValues(
    boardConfig: BoardConfig,
    data: {
      caseType: string;
      value: number;
      contractId: string;
      status: string;
      ff: number;
      pf: number;
      hireDate: string;
    }
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};

    for (const [key, resolution] of Object.entries(boardConfig.columns)) {
      const type = resolution.type ?? resolution.types?.[0];
      if (!type) continue;

      // Contract stage / status
      if (key === "contract_stage" || key === "status") {
        if (type === "status" || type === "color") {
          values[key] = { label: data.status };
        }
        continue;
      }

      // Contract for (case type as dropdown)
      if (key === "contract_for") {
        if (type === "dropdown") {
          values[key] = { labels: [data.caseType] };
        }
        continue;
      }

      // Attorney Fee
      if (key === "af") {
        if (type === "numbers") {
          values[key] = data.value.toString();
        }
        continue;
      }

      // Filing Fee
      if (key === "ff") {
        if (type === "numbers") {
          values[key] = data.ff.toString();
        }
        continue;
      }

      // Processing Fee
      if (key === "pf") {
        if (type === "numbers") {
          values[key] = data.pf.toString();
        }
        continue;
      }

      // Hire date
      if (key === "hire_date") {
        if (type === "date") {
          values[key] = { date: data.hireDate };
        }
        continue;
      }

      // Skip relation/mirror/readonly types
    }

    return values;
  }
}
