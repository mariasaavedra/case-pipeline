// =============================================================================
// Board-Specific Data Generators
// =============================================================================
// Each function returns { name, group, overrides } for use with BoardItemFactory.
// Status labels derived from production Monday.com snapshot (2026-02-16).

import { faker } from "./column-generators";
import { generateDate, generatePhone, generateAddress } from "./column-generators";
import type { GeneratedProfile } from "./profile-factory";
import type { GeneratedFeeK } from "./fee-k-factory";
import {
  COURT_HEARING_TYPES,
  COURT_HEARING_STATUSES,
  COURT_SEEKING,
  COURT_ENTRY_TYPES,
  COURT_HEARING_YEARS,
  COURT_ECAS_OPTIONS,
  COURT_RELIEF_TAGS,
  OPEN_FORM_STATUSES,
  MOTION_TYPE_TAGS,
  MOTION_STATUSES,
  APPEAL_STATUSES,
  FOIA_TYPE_TAGS,
  FOIA_STATUSES,
  LITIGATION_COMPLAINT_STATUSES,
  LITIGATION_CURRENT_STATUSES,
  I918B_STATUSES,
  ADDRESS_CHANGE_STATUSES,
  ADDRESS_CHANGE_COURT_OR_USCIS,
  ADDRESS_CHANGE_ECAS_OPTIONS,
  RFE_STATUSES,
  RFE_TYPE_TAGS,
  ORIGINALS_STATUSES,
  ORIGINALS_RECEIPT_TYPES,
  ORIGINALS_WHAT_WE_HAVE,
  APPOINTMENT_STATUSES,
  LANGUAGES,
  JAIL_INTAKE_STATUSES,
  JAIL_INTAKE_ATTORNEYS,
  DETENTION_FACILITIES,
  JAIL_EVER_REMOVED,
} from "../constants";

// =============================================================================
// Types
// =============================================================================

export interface BoardGenResult {
  name: string;
  group?: string;
  attorney?: string;
  overrides: Record<string, unknown>;
}

// =============================================================================
// Court Cases (EOIR immigration court monitoring only)
// =============================================================================

export function generateCourtCaseData(
  profile: GeneratedProfile,
  feeK: GeneratedFeeK
): BoardGenResult {
  const attorney = faker.helpers.arrayElement(["WH", "LB", "M", "R"]);
  const aNumber = `A${faker.string.numeric(9)}`;
  const hearingType = faker.helpers.weightedArrayElement(COURT_HEARING_TYPES);
  const hearingStatus = faker.helpers.weightedArrayElement(COURT_HEARING_STATUSES);
  const entry = faker.helpers.weightedArrayElement(COURT_ENTRY_TYPES);
  const seeking = faker.helpers.arrayElement(COURT_SEEKING);
  const year = faker.helpers.arrayElement(COURT_HEARING_YEARS);
  const ecas = faker.helpers.weightedArrayElement(COURT_ECAS_OPTIONS);
  const relief = faker.helpers.arrayElement(COURT_RELIEF_TAGS);

  return {
    name: `${attorney} - ${profile.name} [${aNumber}]`,
    group: "Court Case",
    attorney,
    overrides: {
      hearing_type: { label: hearingType },
      status: { label: hearingStatus },
      x_next_hearing_date: { date: generateDate(7, 365) },
      nta_date: { date: generateDate(-730, -30) },
      year: { label: year },
      entry: { label: entry },
      seeking: { label: seeking },
      ecas_or_eservice: { label: ecas },
      relief: { labels: [relief] },
    },
  };
}

// =============================================================================
// Open Forms
// =============================================================================

export function generateOpenFormData(
  profile: GeneratedProfile,
  feeK: GeneratedFeeK,
  group?: string
): BoardGenResult {
  const status = faker.helpers.weightedArrayElement(OPEN_FORM_STATUSES);

  return {
    name: `${profile.name} - ${feeK.caseType}`,
    group: group ?? "Open Forms",
    overrides: {
      // Status (project_status)
      status: { label: status },
      // Dates
      target_date: { date: generateDate(14, 90) },
      assignment_date: { date: generateDate(-30, -1) },
      hire_date: { date: generateDate(-90, -1) },
    },
  };
}

// =============================================================================
// Motions (standalone — linked to court case, not creating one)
// =============================================================================

export function generateMotionData(
  profile: GeneratedProfile,
  feeK: GeneratedFeeK
): BoardGenResult {
  const motionTag = faker.helpers.arrayElement(MOTION_TYPE_TAGS);
  const status = faker.helpers.arrayElement(MOTION_STATUSES);
  const hearingType = faker.helpers.arrayElement(["Master", "Bond", "Trial"]);

  return {
    name: `${profile.name} - ${motionTag}`,
    group: "Motions to be sent",
    overrides: {
      // Status (project_status)
      status: { label: status },
      // Hearing type
      hearing_type: { label: hearingType },
      // Motion type tag
      motion: { labels: [motionTag] },
      // Next hearing date
      next_hearing_date: { date: generateDate(7, 120) },
    },
  };
}

// =============================================================================
// Appeals
// =============================================================================

export function generateAppealData(
  profile: GeneratedProfile,
  _feeK: GeneratedFeeK
): BoardGenResult {
  const status = faker.helpers.arrayElement(APPEAL_STATUSES);

  return {
    name: `${profile.name} - Appeal`,
    group: "Appeals",
    overrides: {
      status: { label: status },
      decision_date: { date: generateDate(-60, -1) },
      appeal_due: { date: generateDate(1, 30) },
      second_half_due: { date: generateDate(30, 90) },
    },
  };
}

// =============================================================================
// FOIAs
// =============================================================================

export function generateFoiaData(
  profile: GeneratedProfile,
  _feeK: GeneratedFeeK
): BoardGenResult {
  const foiaType = faker.helpers.arrayElement(FOIA_TYPE_TAGS);
  const status = faker.helpers.arrayElement(FOIA_STATUSES);

  return {
    name: `${profile.name} - FOIA (${foiaType})`,
    group: "Pending FOIAs",
    overrides: {
      status: { label: status },
      type: { labels: [foiaType] },
    },
  };
}

// =============================================================================
// Litigation
// =============================================================================

export function generateLitigationData(
  profile: GeneratedProfile,
  _feeK: GeneratedFeeK
): BoardGenResult {
  const complaintStatus = faker.helpers.arrayElement(LITIGATION_COMPLAINT_STATUSES);
  const currentStatus = faker.helpers.arrayElement(LITIGATION_CURRENT_STATUSES);

  return {
    name: `${profile.name} - Litigation`,
    group: "Litigation",
    overrides: {
      type_of_case: "Mandamus",
      status_of_complaint: { label: complaintStatus },
      current_status: { label: currentStatus },
      due_date: { date: generateDate(7, 90) },
      hearing_date: { date: generateDate(30, 180) },
    },
  };
}

// =============================================================================
// I918B's
// =============================================================================

export function generateI918BData(
  profile: GeneratedProfile,
  _feeK: GeneratedFeeK
): BoardGenResult {
  const status = faker.helpers.weightedArrayElement(I918B_STATUSES);

  return {
    name: `${profile.name} - I918B`,
    group: "Pending I918 B's",
    overrides: {
      status: { label: status },
      hire_date_for_i918b_request: { date: generateDate(-60, -1) },
      signed_date: { date: generateDate(-30, -1) },
      due_date_for_u_visa_hire: { date: generateDate(30, 120) },
      expiration_date: { date: generateDate(180, 365) },
    },
  };
}

// =============================================================================
// Address Changes (direct from Profile, no Fee K)
// =============================================================================

export function generateAddressChangeData(
  profile: GeneratedProfile
): BoardGenResult {
  const status = faker.helpers.weightedArrayElement(ADDRESS_CHANGE_STATUSES);
  const courtOrUscis = faker.helpers.weightedArrayElement(ADDRESS_CHANGE_COURT_OR_USCIS);
  const ecas = faker.helpers.weightedArrayElement(ADDRESS_CHANGE_ECAS_OPTIONS);

  return {
    name: `${profile.name} - Address Change`,
    group: "Address Changes",
    overrides: {
      status: { label: status },
      court_or_uscis: { label: courtOrUscis },
      ecas_or_paper: { label: ecas },
      date_received: { date: generateDate(-14, -1) },
      date_sent: { date: generateDate(1, 14) },
    },
  };
}

// =============================================================================
// Originals + Cards + Notices (direct from Profile, no Fee K)
// =============================================================================

export function generateOriginalData(
  profile: GeneratedProfile
): BoardGenResult {
  const status = faker.helpers.weightedArrayElement(ORIGINALS_STATUSES);
  const receiptType = faker.helpers.weightedArrayElement(ORIGINALS_RECEIPT_TYPES);
  const whatWeHave = faker.helpers.arrayElement(ORIGINALS_WHAT_WE_HAVE);

  return {
    name: `${profile.name} - ${whatWeHave}`,
    group: "Sent To Client",
    overrides: {
      status: { label: status },
      receipt_type: { label: receiptType },
      what_we_have: { labels: [whatWeHave] },
      date_received: { date: generateDate(-30, -1) },
    },
  };
}

// =============================================================================
// RFEs (direct from Profile, occasionally with Fee K)
// =============================================================================

export function generateRfeData(
  profile: GeneratedProfile
): BoardGenResult {
  const status = faker.helpers.weightedArrayElement(RFE_STATUSES);
  const rfeType = faker.helpers.arrayElement(RFE_TYPE_TAGS);
  const attorney = faker.helpers.arrayElement(["WH", "LB", "M", "R"]);

  return {
    name: `${attorney} - ${rfeType}: ${profile.name}`,
    group: "USCIS RFEs",
    attorney,
    overrides: {
      status: { label: status },
      type: { labels: [rfeType] },
      received_date: { date: generateDate(-30, -1) },
      warning: { date: generateDate(14, 60) },
      due_date: { date: generateDate(30, 87) },
    },
  };
}

// =============================================================================
// Appointments (entry point, linked to Profile)
// =============================================================================

export function generateAppointmentData(
  profile: GeneratedProfile
): BoardGenResult {
  const language = faker.helpers.weightedArrayElement(LANGUAGES);
  const status = faker.helpers.weightedArrayElement(APPOINTMENT_STATUSES);
  const [firstName, ...lastParts] = profile.name.split(" ");
  const lastName = lastParts.join(" ");
  const calendly = faker.helpers.weightedArrayElement([
    { value: "yes", weight: 55 },
    { value: "", weight: 45 },
  ]);

  return {
    name: profile.name,
    group: "Past Consults",
    overrides: {
      status: { label: status },
      consult_date: { date: generateDate(-90, -1) },
      first_name: firstName,
      last_name: lastName,
      phone: generatePhone(),
      email: profile.email,
      address: generateAddress(),
      language: { label: language },
      description: faker.lorem.sentence(),
      ...(calendly ? { calendly: { label: calendly } } : {}),
    },
  };
}

// =============================================================================
// Jail Intakes (separate entry point)
// =============================================================================

export function generateJailIntakeData(
  profileName?: string
): BoardGenResult {
  const name = profileName ?? faker.person.fullName();
  const status = faker.helpers.weightedArrayElement(JAIL_INTAKE_STATUSES);
  const facility = faker.helpers.weightedArrayElement(DETENTION_FACILITIES);
  const language = faker.helpers.weightedArrayElement(LANGUAGES);
  const attorney = faker.helpers.weightedArrayElement(JAIL_INTAKE_ATTORNEYS);
  const everRemoved = faker.helpers.weightedArrayElement(JAIL_EVER_REMOVED);

  return {
    name: `${name} - Jail Intake`,
    group: "Jail Intakes",
    overrides: {
      status: { label: status },
      detention_facility: { label: facility },
      appt_with: { label: attorney },
      alien_number: faker.string.numeric(9),
      date_of_birth: faker.date.birthdate({ min: 18, max: 65, mode: "age" }).toISOString().split("T")[0],
      country_of_birth: faker.location.country(),
      intake_created: { date: generateDate(-30, -1) },
      consult_date: { date: generateDate(-14, 14) },
      language: { label: language },
      have_you_even_been_removed: { label: everRemoved },
    },
  };
}
