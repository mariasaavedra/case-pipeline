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
// Weighted group distributions per board (derived from production snapshot)
// =============================================================================

const COURT_CASE_GROUP_WEIGHTS = [
  { value: "Court Case", weight: 55 },
  { value: "Inactive Court Cases", weight: 15 },
  { value: "Granted", weight: 12 },
  { value: "Ordered Removed/VD", weight: 10 },
  { value: "Withdrew", weight: 8 },
];

const MOTION_GROUP_WEIGHTS = [
  { value: "Motions to be sent", weight: 35 },
  { value: "Awaiting on decision", weight: 30 },
  { value: "Granted", weight: 20 },
  { value: "Denied", weight: 15 },
];

const FOIA_GROUP_WEIGHTS = [
  { value: "Pending FOIAs", weight: 60 },
  { value: "Filed", weight: 40 },
];

const I918B_GROUP_WEIGHTS = [
  { value: "Pending I918 B's", weight: 30 },
  { value: "To Be Requested", weight: 20 },
  { value: "Signed I918 B's", weight: 15 },
  { value: "Agency did not sign", weight: 10 },
  { value: "Did not hire", weight: 8 },
  { value: "Hired for U-visa", weight: 7 },
  { value: "Extension Letters", weight: 5 },
  { value: "Expired", weight: 5 },
];

const ADDRESS_CHANGE_GROUP_WEIGHTS = [
  { value: "Address Changes", weight: 40 },
  { value: "Address Change (payment Pending)", weight: 15 },
  { value: "EAD Extension Letters", weight: 15 },
  { value: "Completed Changes of Address", weight: 30 },
];

const ORIGINALS_GROUP_WEIGHTS = [
  { value: "Cards", weight: 30 },
  { value: "Green Notices", weight: 25 },
  { value: "CYF Appts", weight: 10 },
  { value: "Sent To Client", weight: 35 },
];

const RFE_GROUP_WEIGHTS = [
  { value: "USCIS RFEs", weight: 40 },
  { value: "NVC RFEs", weight: 15 },
  { value: "Sent Out", weight: 25 },
  { value: "No Action Needed/ Completed/ Denied", weight: 20 },
];

const JAIL_INTAKE_GROUP_WEIGHTS = [
  { value: "Jail Intakes", weight: 40 },
  { value: "Scheduled", weight: 35 },
  { value: "NEED TO BE SCHEDULED", weight: 25 },
];

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
    group: faker.helpers.weightedArrayElement(COURT_CASE_GROUP_WEIGHTS),
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
    group: faker.helpers.weightedArrayElement(MOTION_GROUP_WEIGHTS),
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
    group: faker.helpers.weightedArrayElement(FOIA_GROUP_WEIGHTS),
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
    group: faker.helpers.weightedArrayElement(I918B_GROUP_WEIGHTS),
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
    group: faker.helpers.weightedArrayElement(ADDRESS_CHANGE_GROUP_WEIGHTS),
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
    group: faker.helpers.weightedArrayElement(ORIGINALS_GROUP_WEIGHTS),
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
    group: faker.helpers.weightedArrayElement(RFE_GROUP_WEIGHTS),
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

  // Weighted group assignment determines date range
  const group = faker.helpers.weightedArrayElement([
    { value: "Upcoming", weight: 25 },
    { value: "Past Consults", weight: 35 },
    { value: "Today's consults", weight: 10 },
    { value: "Hire", weight: 15 },
    { value: "No Hire", weight: 15 },
  ]);
  const consultDate =
    group === "Upcoming" ? generateDate(1, 30) :
    group === "Today's consults" ? generateDate(0, 0) :
    generateDate(-90, -1);

  return {
    name: profile.name,
    group,
    overrides: {
      status: { label: status },
      consult_date: { date: consultDate },
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
    group: faker.helpers.weightedArrayElement(JAIL_INTAKE_GROUP_WEIGHTS),
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
