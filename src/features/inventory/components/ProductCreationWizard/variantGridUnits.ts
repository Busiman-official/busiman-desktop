/**
 * Allowed units for variant-level UoM (aligned with product master step).
 */
export type VariantUnitOption = { value: string; label: string };

export const VARIANT_UNIT_OPTIONS: VariantUnitOption[] = [
  { value: 'pcs', label: 'pcs (Pieces)' },
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'l', label: 'l' },
  { value: 'ml', label: 'ml' },
  { value: 'm', label: 'm' },
  { value: 'cm', label: 'cm' },
  { value: 'box', label: 'box' },
  { value: 'pack', label: 'pack' },
  { value: 'carton', label: 'carton' },
];

export const VARIANT_UNIT_VALUES = new Set(
  VARIANT_UNIT_OPTIONS.map((o) => o.value)
);

export function resolveVariantUnit(
  rowUnit: string | undefined,
  productDefaultUnit: string
): string {
  const d = productDefaultUnit?.trim() || 'pcs';
  if (!rowUnit?.trim()) return d;
  return VARIANT_UNIT_VALUES.has(rowUnit.trim()) ? rowUnit.trim() : d;
}
