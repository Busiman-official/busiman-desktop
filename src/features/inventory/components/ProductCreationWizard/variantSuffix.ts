/**
 * Full variant code is BASE-SUFFIX. The grid’s first column is HSN (tax), not the suffix.
 * When `value` (optional suffix from Details) is empty, derive a stable suffix from the variant name.
 */

import type { WizardVariantRow } from './variantGridModel';

const SUFFIX_MAX = 40;

function normalizeExplicitSuffix(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SUFFIX_MAX);
}

function slugFromName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SUFFIX_MAX);
}

/**
 * Per-row suffix for `BASE-SUFFIX` variant codes (uppercase, branch-unique check uses full string).
 */
/** Single new variant on an existing product (Item Master add-variant). */
export function computeVariantSuffixForName(
  name: string,
  existingRows: WizardVariantRow[] = [],
): string {
  const rows = [
    ...existingRows,
    { id: 'new', value: '', name: name.trim() },
  ];
  const suffixes = computeVariantSuffixes(rows);
  return suffixes[suffixes.length - 1] || 'V1';
}

export function computeVariantSuffixes(rows: WizardVariantRow[]): string[] {
  const raw = rows.map((row, i) => {
    const ex = normalizeExplicitSuffix(row.value);
    if (ex) return ex;
    const n = slugFromName(row.name);
    if (n) return n;
    return `V${i + 1}`;
  });

  const usage = new Map<string, number>();
  return raw.map((s) => {
    const prev = usage.get(s) ?? 0;
    usage.set(s, prev + 1);
    if (prev === 0) return s;
    return `${s}-${prev + 1}`.slice(0, SUFFIX_MAX);
  });
}
