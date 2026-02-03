// =============================================================================
// Constants for Monday.com seeding
// =============================================================================

import { loadBoardsConfig } from "../../../lib/config";

// Board IDs - loaded from config/boards.yaml
export interface BoardIds {
  profilesBoardId: string;
  contractsBoardId: string;
}

export async function loadBoardIds(): Promise<BoardIds> {
  const boards = await loadBoardsConfig();
  return {
    profilesBoardId: boards.profiles.id,
    contractsBoardId: boards.contracts.id,
  };
}

// Name generation data
export const FIRST_NAMES = [
  "James", "Maria", "Robert", "Linda", "Michael", "Barbara", "William", "Elizabeth",
  "David", "Jennifer", "Carlos", "Patricia", "Jose", "Susan", "Ahmed", "Sarah",
  "Wei", "Karen", "Raj", "Nancy", "Yuki", "Lisa", "Omar", "Margaret", "Ivan", "Rafael"
];

export const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson"
];

export const EMAIL_DOMAINS = [
  "gmail.com", "yahoo.com", "outlook.com", "company.com", "business.org"
];

// Monday.com column values
export const CASE_TYPES = [
  "Immigration Court", "I130", "Full Packet", "I90", "File Copy", "I601a"
];

export const PRIORITIES = ["High", "Medium", "Low", "No priority"];

export const CONTRACT_STATUSES = ["To be sent", "Sent", "Signed", "Paid"];

export const CONTRACT_VALUES = [5000, 10000, 15000, 25000, 50000, 75000, 100000, 150000];

export const SAMPLE_NOTES = [
  "Initial consultation completed. Client is responsive and engaged.",
  "Awaiting documentation from client. Follow up scheduled.",
  "Case review in progress. Strong documentation provided.",
  "Client requested expedited timeline. Prioritizing accordingly.",
  "All paperwork received. Moving to next phase.",
  "Meeting scheduled to discuss strategy and next steps.",
  "Client has questions about timeline. Need to clarify expectations.",
];

// Default configuration
export const DEFAULT_CONFIG = {
  profileCount: 5,
  contractsPerProfile: { min: 1, max: 3 },
};
