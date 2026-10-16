// A picker label for a staff name: inactive people (former staff still holding
// open work, per the roster) are marked, not hidden, so their cases stay findable.
export const INACTIVE_SUFFIX = " (inactive)";

export function staffLabel(name: string, inactive: readonly string[] | undefined): string {
  return inactive?.includes(name) ? `${name}${INACTIVE_SUFFIX}` : name;
}
