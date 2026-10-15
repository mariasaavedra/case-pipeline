// =============================================================================
// Which folder in a client's E-File holds their fee contracts
// =============================================================================
// Staff have named it many ways over the years (a 24-client sample, 2026-10-15):
// "FEE Ks", "FEE K's", "Fee K's", "FEE K'S", "FEEKs", and in a few files
// "Contracts" / "CONTRACTS". The signed contract goes into the one the client
// already has — a Fee K folder before a Contracts one — and only a client with
// neither gets a new "FEE Ks" (decided 2026-10-15).
// =============================================================================

export const FEE_K_FOLDER = "FEE Ks";

const FEE_K = /^fee\s*k[’']?s$/i;
const CONTRACTS = /^contracts?$/i;

export function pickFeeKFolder<T extends { name: string; folder?: unknown }>(children: T[]): T | null {
  const folders = children.filter((c) => c.folder);
  return folders.find((c) => FEE_K.test(c.name.trim())) ?? folders.find((c) => CONTRACTS.test(c.name.trim())) ?? null;
}
