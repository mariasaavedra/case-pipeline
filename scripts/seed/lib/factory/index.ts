// =============================================================================
// Factory Module Exports
// =============================================================================

export { SeededRandom } from "./seeded-random";
export {
  generateColumnValue,
  generateName,
  generateEmail,
  generatePhone,
  generateFormattedPhone,
  generateDate,
  generateContractId,
  generateNotes,
  generateAddress,
  generateCompanyName,
  getColumnContext,
  setFakerSeed,
  getFakerSeed,
  faker,
  CASE_TYPES,
  CASE_FEE_SCHEDULE,
  PRIORITIES,
  CONTRACT_STATUSES,
  CONTRACT_VALUES,
} from "./column-generators";
export { ProfileFactory, type GeneratedProfile, type ProfileFactoryOptions } from "./profile-factory";
export { FeeKFactory, type GeneratedFeeK, type FeeKFactoryOptions } from "./fee-k-factory";
export { BoardItemFactory, type GeneratedBoardItem, type BoardItemCreateOptions, type ItemRelationship } from "./board-item-factory";
export {
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
} from "./board-generators";
