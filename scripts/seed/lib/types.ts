// =============================================================================
// Seed-specific TypeScript types
// =============================================================================

export interface ProfileData {
  name: string;
  email: string;
  phone: string;
  notes: string;
  nextInteraction: string;
}

export interface ContractData {
  caseType: string;
  value: number;
  contractId: string;
  status: string;
}

export interface SeedConfig {
  mondayApiToken: string;
  profileCount: number;
  contractsPerProfile: { min: number; max: number };
}
