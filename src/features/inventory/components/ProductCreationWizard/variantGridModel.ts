/**
 * Column model and helpers for the wizard variant spreadsheet grid.
 */

import { resolveVariantUnit } from './variantGridUnits';

/** Matches CreateVariantRequest.images / ImageUpload ImageData */
export type WizardVariantImage = {
  url: string;
  publicId: string;
  isPrimary: boolean;
};

export type VariantGridColKey =
  | 'hsn'
  | 'name'
  | 'barcode'
  | 'unit'
  | 'sellingPrice'
  | 'details'
  | 'default'
  | 'delete';

/** Ordered columns (0..7) for focus navigation. */
export const VARIANT_GRID_COL_KEYS: readonly VariantGridColKey[] = [
  'hsn',
  'name',
  'barcode',
  'unit',
  'sellingPrice',
  'details',
  'default',
  'delete',
] as const;

export const VARIANT_GRID_COL_COUNT = VARIANT_GRID_COL_KEYS.length;

export interface WizardVariantRow {
  id: string;
  value: string;
  name: string;
  barcode?: string;
  /** Per-variant unit; when unset, product master default applies. */
  unitOfMeasure?: string;
  /** Per-variant gallery; sent as `images` on createVariant. */
  images?: WizardVariantImage[];
  /** Optional supplier / alternate SKU; merged into `metadata` on save. */
  supplierSku?: string;
  /** GST HSN (India): 4, 6, or 8 digits; per variant. */
  hsn?: string;
  /** Extra key/value metadata for API (optional). */
  metadata?: Record<string, unknown>;
  costPriceOverride?: number;
  sellingPriceOverride?: number;
  mrpOverride?: number;
  taxOverride?: number;
  reorderLevel?: number;
  minStock?: number;
  maxStock?: number;
  allowBackorder?: boolean;
  trackSerialOverride?: boolean;
  trackBatchOverride?: boolean;
  isActive?: boolean;
  isDiscontinued?: boolean;
  /** Whether this specific variant can be booked for after-sales service/repair. Defaults to the master's setting. */
  serviceable?: boolean;
  weightOverride?: number;
  dimensionsOverride?: {
    length?: number;
    width?: number;
    height?: number;
  };
  packSize?: number;
  unitsPerBox?: number;
  shelfLifeDaysOverride?: number;
}

export type VariantRowFieldErrorKey = 'hsn' | 'value' | 'name' | 'barcode';

export function colKeyToIndex(key: VariantGridColKey): number {
  return VARIANT_GRID_COL_KEYS.indexOf(key);
}

export function isEditableTextCol(key: VariantGridColKey): boolean {
  return key === 'hsn' || key === 'name' || key === 'barcode';
}

export function isReadonlyCol(key: VariantGridColKey): boolean {
  return key === 'details' || key === 'default';
}

export function newVariantRowId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeImages(raw: unknown): WizardVariantImage[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: WizardVariantImage[] = [];
  for (const item of raw) {
    const o = item as Record<string, unknown>;
    if (
      typeof o.url === 'string' &&
      typeof o.publicId === 'string' &&
      typeof o.isPrimary === 'boolean'
    ) {
      out.push({ url: o.url, publicId: o.publicId, isPrimary: o.isPrimary });
    }
  }
  return out.length ? out : undefined;
}

function normalizeMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return { ...(raw as Record<string, unknown>) };
}

/** Accept numbers and numeric strings from JSON drafts / older saves. */
function normalizeNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t === '') return undefined;
    const n = Number(t);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function normalizeBoolean(raw: unknown): boolean | undefined {
  if (typeof raw !== 'boolean') return undefined;
  return raw;
}

function normalizeDimensionsOverride(raw: unknown): WizardVariantRow['dimensionsOverride'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const length = normalizeNumber(o.length);
  const width = normalizeNumber(o.width);
  const height = normalizeNumber(o.height);
  if (length == null && width == null && height == null) return undefined;
  return { length, width, height };
}

export function createEmptyVariantRow(productDefaultUnit = 'pcs'): WizardVariantRow {
  const u = productDefaultUnit?.trim() || 'pcs';
  return {
    id: newVariantRowId(),
    value: '',
    name: '',
    barcode: '',
    unitOfMeasure: u,
  };
}

/** Normalize rows from draft/localStorage (add missing ids and per-row unit). */
export function normalizeVariantRows(raw: unknown, productDefaultUnit = 'pcs'): WizardVariantRow[] {
  const d = productDefaultUnit?.trim() || 'pcs';
  if (!Array.isArray(raw)) return [];
  return raw.map((r: unknown) => {
    const o = r as Record<string, unknown>;
    const rowUnit = typeof o.unitOfMeasure === 'string' ? o.unitOfMeasure : undefined;
    const images = normalizeImages(o.images);
    const supplierSku = typeof o.supplierSku === 'string' ? o.supplierSku : undefined;
    const hsn = typeof o.hsn === 'string' ? o.hsn.trim() : undefined;
    const metadata = normalizeMetadata(o.metadata);
    const dimensionsOverride = normalizeDimensionsOverride(o.dimensionsOverride);
    return {
      id: typeof o.id === 'string' && o.id.length > 0 ? o.id : newVariantRowId(),
      value: typeof o.value === 'string' ? o.value : '',
      name: typeof o.name === 'string' ? o.name : '',
      barcode: typeof o.barcode === 'string' ? o.barcode : undefined,
      unitOfMeasure: resolveVariantUnit(rowUnit, d),
      ...(images ? { images } : {}),
      ...(supplierSku !== undefined ? { supplierSku } : {}),
      ...(hsn && hsn.length > 0 ? { hsn } : {}),
      ...(metadata ? { metadata } : {}),
      ...(normalizeNumber(o.costPriceOverride) != null ? { costPriceOverride: normalizeNumber(o.costPriceOverride) } : {}),
      ...(normalizeNumber(o.sellingPriceOverride) != null ? { sellingPriceOverride: normalizeNumber(o.sellingPriceOverride) } : {}),
      ...(normalizeNumber(o.mrpOverride) != null ? { mrpOverride: normalizeNumber(o.mrpOverride) } : {}),
      ...(normalizeNumber(o.taxOverride) != null ? { taxOverride: normalizeNumber(o.taxOverride) } : {}),
      ...(normalizeNumber(o.reorderLevel) != null ? { reorderLevel: normalizeNumber(o.reorderLevel) } : {}),
      ...(normalizeNumber(o.minStock) != null ? { minStock: normalizeNumber(o.minStock) } : {}),
      ...(normalizeNumber(o.maxStock) != null ? { maxStock: normalizeNumber(o.maxStock) } : {}),
      ...(normalizeBoolean(o.allowBackorder) != null ? { allowBackorder: normalizeBoolean(o.allowBackorder) } : {}),
      ...(normalizeBoolean(o.trackSerialOverride) != null ? { trackSerialOverride: normalizeBoolean(o.trackSerialOverride) } : {}),
      ...(normalizeBoolean(o.trackBatchOverride) != null ? { trackBatchOverride: normalizeBoolean(o.trackBatchOverride) } : {}),
      ...(normalizeBoolean(o.isActive) != null ? { isActive: normalizeBoolean(o.isActive) } : {}),
      ...(normalizeBoolean(o.isDiscontinued) != null ? { isDiscontinued: normalizeBoolean(o.isDiscontinued) } : {}),
      ...(normalizeBoolean(o.serviceable) != null ? { serviceable: normalizeBoolean(o.serviceable) } : {}),
      ...(normalizeNumber(o.weightOverride) != null ? { weightOverride: normalizeNumber(o.weightOverride) } : {}),
      ...(dimensionsOverride ? { dimensionsOverride } : {}),
      ...(normalizeNumber(o.packSize) != null ? { packSize: normalizeNumber(o.packSize) } : {}),
      ...(normalizeNumber(o.unitsPerBox) != null ? { unitsPerBox: normalizeNumber(o.unitsPerBox) } : {}),
      ...(normalizeNumber(o.shelfLifeDaysOverride) != null ? { shelfLifeDaysOverride: normalizeNumber(o.shelfLifeDaysOverride) } : {}),
    };
  });
}

export function duplicateVariantRow(rows: WizardVariantRow[], rowIndex: number): WizardVariantRow[] {
  const row = rows[rowIndex];
  if (!row) return rows;
  const clone: WizardVariantRow = {
    id: newVariantRowId(),
    value: row.value,
    name: row.name,
    barcode: row.barcode,
    unitOfMeasure: row.unitOfMeasure,
    images: row.images ? row.images.map((img) => ({ ...img })) : undefined,
    supplierSku: row.supplierSku,
    hsn: row.hsn,
    metadata: row.metadata ? { ...row.metadata } : undefined,
    costPriceOverride: row.costPriceOverride,
    sellingPriceOverride: row.sellingPriceOverride,
    mrpOverride: row.mrpOverride,
    taxOverride: row.taxOverride,
    reorderLevel: row.reorderLevel,
    minStock: row.minStock,
    maxStock: row.maxStock,
    allowBackorder: row.allowBackorder,
    trackSerialOverride: row.trackSerialOverride,
    trackBatchOverride: row.trackBatchOverride,
    isActive: row.isActive,
    isDiscontinued: row.isDiscontinued,
    weightOverride: row.weightOverride,
    dimensionsOverride: row.dimensionsOverride ? { ...row.dimensionsOverride } : undefined,
    packSize: row.packSize,
    unitsPerBox: row.unitsPerBox,
    shelfLifeDaysOverride: row.shelfLifeDaysOverride,
  };
  const next = [...rows];
  next.splice(rowIndex + 1, 0, clone);
  return next;
}

export function removeVariantRowAt(rows: WizardVariantRow[], rowIndex: number): WizardVariantRow[] {
  return rows.filter((_, i) => i !== rowIndex);
}
