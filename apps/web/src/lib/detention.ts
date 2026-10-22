import type { Detention, DetentionSource } from "../api";

/** Why the pill says detained — its tooltip. Rule = libs/query/src/detention.ts. */
const SOURCE: Record<DetentionSource, string> = {
  facility: "From the Det. Facility on this client's open court case",
  name: "The client's or court case's name says detained",
  intake: "Booked from a jail intake",
  appointment: "A detainee consult (Det Hire / Det No Hire / detainee status)",
};

export function detentionTitle(d: Detention): string {
  return SOURCE[d.source];
}

/** "Detained at CoreCivic", or just "Detained" when no place is known. */
export function detentionLabel(d: Detention): string {
  return d.at ? `Detained at ${d.at}` : "Detained";
}
