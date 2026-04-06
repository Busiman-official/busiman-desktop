import type { PosCartLine } from './usePosCart';

/** GST rates available in the line editor. */
export const POS_GST_RATE_OPTIONS = [0, 5, 12, 18, 28] as const;

/** Default: unit price includes GST (matches typical retail tagging). */
export function isGstInclusive(line: PosCartLine): boolean {
  return line.gstInclusive !== false;
}

/** Snap branch settings tax to the nearest allowed POS pill (defaults to 18). */
export function normalizePosGstRatePercent(branchRate: number | undefined | null): number {
  const opts = POS_GST_RATE_OPTIONS;
  if (branchRate == null || !Number.isFinite(branchRate)) return 18;
  const n = Math.round(branchRate);
  if (opts.includes(n as (typeof opts)[number])) return n;
  return opts.reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best));
}

export function getLineDiscountAmount(line: PosCartLine): number {
  const sub = line.quantity * line.unitPrice;
  const raw = line.lineDiscountValue ?? 0;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (line.lineDiscountType === 'percent') {
    return Math.min(sub, Math.round(((sub * raw) / 100) * 100) / 100);
  }
  return Math.min(sub, Math.round(raw * 100) / 100);
}

/** Line amount after discount (same currency as unit price: inclusive or exclusive, depending on line). */
export function getLineNetAfterDiscount(line: PosCartLine): number {
  const sub = line.quantity * line.unitPrice;
  return Math.max(0, sub - getLineDiscountAmount(line));
}

/**
 * Taxable value (ex-GST) after line discount — used to send exclusive effective unit price to the server.
 */
export function getLineTaxableNetAfterDiscount(line: PosCartLine, defaultGstPercent: number): number {
  const netAfterDisc = getLineNetAfterDiscount(line);
  const rate = line.gstRatePercent ?? defaultGstPercent;
  const r = Math.max(0, rate) / 100;
  if (isGstInclusive(line)) {
    if (r <= 0) return netAfterDisc;
    return Math.round((netAfterDisc / (1 + r)) * 100) / 100;
  }
  return netAfterDisc;
}

/**
 * GST component for the line. Inclusive: extracted from the amount after discount. Exclusive: added on top of taxable net.
 */
export function getLineGstAmount(line: PosCartLine, defaultGstPercent: number): number {
  const rate = line.gstRatePercent ?? defaultGstPercent;
  const r = Math.max(0, rate) / 100;
  const netAfterDisc = getLineNetAfterDiscount(line);
  if (isGstInclusive(line)) {
    if (r <= 0) return 0;
    return Math.round(((netAfterDisc * r) / (1 + r)) * 100) / 100;
  }
  return Math.round(netAfterDisc * r * 100) / 100;
}

/** Customer line total: inclusive = amount after discount (GST embedded); exclusive = taxable + GST. */
export function getLineTotalWithGst(line: PosCartLine, defaultGstPercent: number): number {
  const netAfterDisc = getLineNetAfterDiscount(line);
  if (isGstInclusive(line)) {
    return Math.round(netAfterDisc * 100) / 100;
  }
  const gst = getLineGstAmount(line, defaultGstPercent);
  return Math.round((netAfterDisc + gst) * 100) / 100;
}

/** Map lines to quantity + effective exclusive unit price after line discount (for order-level POS totals). */
export function linesAdjustedForOrderTotals(
  lines: PosCartLine[],
  defaultGstPercent: number
): Array<{ quantity: number; unitPrice: number }> {
  return lines.map((l) => {
    const taxableTotal = getLineTaxableNetAfterDiscount(l, defaultGstPercent);
    const eff = l.quantity > 0 ? taxableTotal / l.quantity : 0;
    return { quantity: l.quantity, unitPrice: Math.round(eff * 10000) / 10000 };
  });
}

/** Checkout / draft API payload: per-line exclusive unit price after line discount (server tax is order-level). */
export function linesForCheckoutPayload(
  lines: PosCartLine[],
  defaultGstPercent: number
): Array<{ variantId: string; quantity: number; unitPrice: number }> {
  return lines.map((l) => {
    const taxableTotal = getLineTaxableNetAfterDiscount(l, defaultGstPercent);
    const eff = l.quantity > 0 ? taxableTotal / l.quantity : 0;
    return {
      variantId: l.variantId,
      quantity: l.quantity,
      unitPrice: Math.round(eff * 10000) / 10000,
    };
  });
}

/** B2B draft order for quotation: includes POS line detail panel fields for printed PDF. */
export function linesForQuotationDraftOrder(
  lines: PosCartLine[],
  branchTaxPercent: number
): Array<{
  variantId: string;
  quantity: number;
  unitPrice: number;
  posListUnitPrice: number;
  posLineDiscountAmount: number;
  posGstRatePercent: number;
  posLineNotes?: string;
  posHsn?: string;
}> {
  return lines.map((l) => {
    const taxableTotal = getLineTaxableNetAfterDiscount(l, branchTaxPercent);
    const eff = l.quantity > 0 ? taxableTotal / l.quantity : 0;
    const disc = getLineDiscountAmount(l);
    const gst = normalizePosGstRatePercent(l.gstRatePercent ?? branchTaxPercent);
    const notes = l.notes?.trim();
    const hsn = l.hsn?.trim();
    return {
      variantId: l.variantId,
      quantity: l.quantity,
      unitPrice: Math.round(eff * 10000) / 10000,
      posListUnitPrice: Math.round(l.unitPrice * 10000) / 10000,
      posLineDiscountAmount: Math.round(disc * 100) / 100,
      posGstRatePercent: gst,
      ...(notes ? { posLineNotes: notes } : {}),
      ...(hsn ? { posHsn: hsn } : {}),
    };
  });
}
