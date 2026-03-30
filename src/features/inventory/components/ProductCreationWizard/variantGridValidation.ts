/**
 * Pure validation for wizard variant rows (step 2).
 */

import type { WizardVariantRow } from './variantGridModel';
import type { VariantRowFieldErrorKey } from './variantGridModel';

export type VariantRowErrors = {
  value?: string;
  name?: string;
  barcode?: string;
};

/**
 * Full step-2 validation: required fields, duplicate code suffix, duplicate barcode (non-empty).
 */
export function validateAllVariantRows(rows: WizardVariantRow[]): Record<number, VariantRowErrors> {
  const rowErrors: Record<number, VariantRowErrors> = {};
  const normalizedCodes = new Map<string, number>();
  const normalizedBarcodes = new Map<string, number>();

  rows.forEach((row, idx) => {
    const value = row.value.trim().toUpperCase();
    const name = row.name.trim();
    const bc = (row.barcode || '').trim();
    const bcKey = bc ? bc.toUpperCase() : '';

    if (!value) {
      rowErrors[idx] = { ...(rowErrors[idx] || {}), value: 'Code suffix is required' };
    }
    if (!name) {
      rowErrors[idx] = { ...(rowErrors[idx] || {}), name: 'Variant name is required' };
    }

    if (value) {
      if (normalizedCodes.has(value)) {
        rowErrors[idx] = { ...(rowErrors[idx] || {}), value: 'Duplicate code suffix' };
        const dupAt = normalizedCodes.get(value)!;
        rowErrors[dupAt] = { ...(rowErrors[dupAt] || {}), value: 'Duplicate code suffix' };
      } else {
        normalizedCodes.set(value, idx);
      }
    }

    if (bcKey) {
      if (normalizedBarcodes.has(bcKey)) {
        rowErrors[idx] = { ...(rowErrors[idx] || {}), barcode: 'Duplicate barcode' };
        const dupAt = normalizedBarcodes.get(bcKey)!;
        rowErrors[dupAt] = { ...(rowErrors[dupAt] || {}), barcode: 'Duplicate barcode' };
      } else {
        normalizedBarcodes.set(bcKey, idx);
      }
    }
  });

  return rowErrors;
}

/**
 * Error message for a single field on one row, given current rows (cross-row dup checks).
 */
export function getFieldError(
  rows: WizardVariantRow[],
  rowIndex: number,
  field: VariantRowFieldErrorKey
): string | undefined {
  const row = rows[rowIndex];
  if (!row) return undefined;

  if (field === 'value') {
    const value = row.value.trim().toUpperCase();
    if (!value) return 'Code suffix is required';
    const dup = rows.findIndex(
      (r, i) => i !== rowIndex && r.value.trim().toUpperCase() === value && value.length > 0
    );
    if (dup >= 0) return 'Duplicate code suffix';
    return undefined;
  }

  if (field === 'name') {
    if (!row.name.trim()) return 'Variant name is required';
    return undefined;
  }

  if (field === 'barcode') {
    const bc = (row.barcode || '').trim();
    if (!bc) return undefined;
    const key = bc.toUpperCase();
    const dup = rows.findIndex(
      (r, i) => i !== rowIndex && (r.barcode || '').trim().toUpperCase() === key
    );
    if (dup >= 0) return 'Duplicate barcode';
    return undefined;
  }

  return undefined;
}

/** Whether the user may leave this cell (navigation blocked if false). */
export function canLeaveCell(
  rows: WizardVariantRow[],
  rowIndex: number,
  field: VariantRowFieldErrorKey
): boolean {
  return getFieldError(rows, rowIndex, field) === undefined;
}
