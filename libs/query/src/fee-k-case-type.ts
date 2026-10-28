// =============================================================================
// A Fee K's case type
// =============================================================================
// Two Fee Ks dropdowns hold it. "Fee K Type" (raw key fee_k_type, since
// 2026-10) is the curated one Monday requires and the app writes; older Fee Ks
// only have "Contract for…" (raw key contract_for). Readers take Fee K Type
// when it has a label, else Contract for — the same labels JSON either way.
// =============================================================================

/** SQL for the case-type labels JSON of the Fee K row aliased `alias`. */
export function feeKCaseTypeSql(alias = "c"): string {
  const raw = `${alias}.raw_column_values`;
  return `(CASE WHEN json_type(${raw}, '$.fee_k_type.labels') = 'array'
                 AND json_array_length(${raw}, '$.fee_k_type.labels') > 0
            THEN json_extract(${raw}, '$.fee_k_type.labels')
            ELSE json_extract(${raw}, '$.contract_for.labels') END)`;
}

/** The Fee K Type column id (config/boards.yaml fee_k_type). */
export const FEE_K_TYPE_COLUMN_ID = "dropdown_mm89vqtc";

/**
 * The "Fee K Type" dropdown in a synced Fee Ks schema — the one the app writes.
 * By id (it began as "Dup. of Contract for..." and was renamed), else by title.
 */
export function caseTypeColumn<C extends { columnId: string; type: string; title: string }>(schema: { columns: C[] }): C | undefined {
  return schema.columns.find((c) => c.columnId === FEE_K_TYPE_COLUMN_ID)
    ?? schema.columns.find((c) => c.type === "dropdown" && c.title.trim().toLowerCase() === "fee k type");
}

/** A label for comparing: trimmed, inner whitespace collapsed, lower case. */
const labelKey = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The dropdown option a typed or picked case type means: same label ignoring
 * case and spacing (Monday keeps labels like "Bond MTN  (c)" with a double
 * space, which a trimmed / collapsed pick no longer matches exactly). Write the
 * option's own label back, never the typed one.
 */
export function findCaseTypeOption<O extends { label: string }>(options: readonly O[], label: string): O | undefined {
  const key = labelKey(label);
  return options.find((o) => labelKey(o.label) === key);
}
