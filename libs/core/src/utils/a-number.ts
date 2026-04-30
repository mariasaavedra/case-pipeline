// =============================================================================
// A-Number (Alien Registration Number) Utilities
// =============================================================================

/**
 * Normalize an A-number from various Monday.com formats to a 9-digit string.
 * Handles: "123456789", "123 456 789", "A123-456-789", "A 123 456 789", etc.
 * Returns null if the input doesn't contain exactly 9 digits.
 */
export function normalizeANumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 9) return null;
  return digits;
}

/**
 * Format a normalized 9-digit A-number for display: "A123-456-789"
 */
export function formatANumber(normalized: string | null | undefined): string | null {
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, "");
  if (digits.length !== 9) return normalized;
  return `A${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
}
