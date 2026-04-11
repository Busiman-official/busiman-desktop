import type { SalesSettingsData } from '@/services/sales.service';
import type { PosCartLine } from './usePosCart';
import { getLineTaxableNetAfterDiscount } from './posLineMath';

/**
 * POS cart totals: per-line GST rate and inclusive/exclusive (via taxable extraction) match line row
 * and server `computePosOrderTotalsFromLines`. Order discount is spread across line tax bases, then GST
 * is applied per line (same as server).
 */
export function computePosCartTotals(
  lines: PosCartLine[],
  branchTaxPercent: number,
  discountAmount: number
): {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
} {
  const taxablePerLine = lines.map((l) => getLineTaxableNetAfterDiscount(l, branchTaxPercent));
  const ratePerLine = lines.map((l) => l.gstRatePercent ?? branchTaxPercent);
  const taxableSubtotal = taxablePerLine.reduce((s, v) => s + v, 0);
  const d = Math.min(Math.max(0, discountAmount), taxableSubtotal);
  const factor = taxableSubtotal > 0 ? (taxableSubtotal - d) / taxableSubtotal : 0;
  let taxAmount = 0;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const adj = taxablePerLine[i]! * factor;
    const r = Math.max(0, ratePerLine[i] ?? 0) / 100;
    taxAmount += Math.round(adj * r * 100) / 100;
    total += Math.round(adj * (1 + r) * 100) / 100;
  }
  return {
    subtotal: Math.round(taxableSubtotal * 100) / 100,
    discountAmount: Math.round(d * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

/** @deprecated Prefer computePosCartTotals — branch-level taxInclusive no longer matches mixed per-line GST. */
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
