/** Max fractional digits for POS line quantity (e.g. 0.5 L). */
export const POS_QTY_MAX_DECIMALS = 3;

/** Smallest sellable quantity in the stepper (detail panel, etc.). */
export const POS_QTY_MIN = 0.001;

const QTY_FACTOR = 10 ** POS_QTY_MAX_DECIMALS;

/** Round to supported precision and avoid float noise (0.1 + 0.2). */
export function roundPosQuantity(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * QTY_FACTOR) / QTY_FACTOR;
}

export function clampPosQuantity(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, roundPosQuantity(n)));
}

/** Parse user input; accepts `.5` and `0,5`. Returns null if empty/invalid. */
export function parsePosQuantityInput(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (t === '' || t === '.') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return roundPosQuantity(n);
}

/** While typing in the stepper field. */
export function isPosQuantityDraftAllowed(draft: string): boolean {
  if (draft === '') return true;
  return /^(\d+(\.\d{0,3})?|\.\d{0,3})$/.test(draft);
}

/** Display qty without trailing zeros (1, 0.5, 0.125). */
export function formatPosQuantityDisplay(n: number): string {
  const r = roundPosQuantity(n);
  if (!Number.isFinite(r)) return '0';
  const fixed = r.toFixed(POS_QTY_MAX_DECIMALS);
  return fixed.replace(/\.?0+$/, '');
}
