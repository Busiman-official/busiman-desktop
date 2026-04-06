/**
 * Pure validation for wizard variant rows (step 2).
 */

import type { WizardVariantRow } from './variantGridModel';
import type { VariantRowFieldErrorKey } from './variantGridModel';

export type VariantRowErrors = {
  hsn?: string;
  value?: string;
  name?: string;
  barcode?: string;
};

/**
 * Full step-2 validation: required fields, duplicate barcode (non-empty).
 */
export function validateAllVariantRows(rows: WizardVariantRow[]): Record<number, VariantRowErrors> {
  const rowErrors: Record<number, VariantRowErrors> = {};
  const normalizedBarcodes = new Map<string, number>();

  rows.forEach((row, idx) => {
    const name = row.name.trim();
    const hsn = (row.hsn || '').trim();
    const bc = (row.barcode || '').trim();
    const bcKey = bc ? bc.toUpperCase() : '';

    if (hsn && !/^\d{4}(\d{2}){0,2}$/.test(hsn)) {
      rowErrors[idx] = { ...(rowErrors[idx] || {}), hsn: 'HSN must be 4, 6, or 8 digits' };
    }

    if (!name) {
      rowErrors[idx] = { ...(rowErrors[idx] || {}), name: 'Variant name is required' };
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

  if (field === 'hsn') {
    const h = (row.hsn || '').trim();
    if (!h) return undefined;
    if (!/^\d{4}(\d{2}){0,2}$/.test(h)) return 'HSN must be 4, 6, or 8 digits';
    return undefined;
  }

  if (field === 'value') {
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
