import type { SalesSettingsData } from '@/services/sales.service';

/** Matches server `posCheckout` tax math: discount applied to line subtotal before tax. */
export function computePosTotals(
  lines: Array<{ quantity: number; unitPrice: number }>,
  settings: Pick<SalesSettingsData, 'taxRatePercent' | 'taxInclusive'>,
  discountAmount = 0
): {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
} {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const d = Math.max(0, Math.min(discountAmount, subtotal));
  const taxableNet = Math.max(0, subtotal - d);
  const r = settings.taxRatePercent / 100;
  const taxAmount = settings.taxInclusive ? taxableNet - taxableNet / (1 + r) : taxableNet * r;
  const total = settings.taxInclusive ? taxableNet : taxableNet + taxAmount;
  return {
    subtotal,
    discountAmount: Math.round(d * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}
