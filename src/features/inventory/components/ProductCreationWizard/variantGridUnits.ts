/**
 * Allowed units for variant-level UoM (aligned with product master step).
 */
export type VariantUnitOption = { value: string; label: string };

export const VARIANT_UNIT_OPTIONS: VariantUnitOption[] = [
  { value: 'pcs', label: 'pcs' },
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

export function buildVariantUnitOptions(params: {
  baseUnit: string;
  alternateUnits?: Array<{ unitCode: string; isActive?: boolean }>;
  fallbackOptions?: VariantUnitOption[];
}): VariantUnitOption[] {
  const base = (params.baseUnit || 'pcs').trim().toLowerCase();
  const fromConfig = (params.alternateUnits || [])
    .filter((u) => u && u.unitCode && u.isActive !== false)
    .map((u) => ({ value: u.unitCode.trim().toLowerCase(), label: u.unitCode.trim().toLowerCase() }));
  const merged = [
    { value: base, label: base },
    ...fromConfig,
    ...(params.fallbackOptions || VARIANT_UNIT_OPTIONS),
  ];
  const seen = new Set<string>();
  return merged.filter((o) => {
    const key = o.value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
