import type { SalesQuotationLine } from '@/services/sales.service';

/**
 * POS/order API lines store `lineTotal` as exclusive taxable; customer-facing line amount with GST.
 */
export function orderLineGrossWithGst(ln: {
  lineTotal?: number;
  posGstRatePercent?: number;
}): number {
  const taxable = Number(ln.lineTotal ?? 0);
  const tr = ln.posGstRatePercent;
  const r = tr != null && Number.isFinite(tr) && tr >= 0 ? Math.max(0, tr) / 100 : 0;
  return Math.round(taxable * (1 + r) * 100) / 100;
}

/** Line total with GST for UI/PDF when `lineTotal` is stored as exclusive taxable (new quotations). */
export function quotationLineGrossInr(
  ln: Pick<SalesQuotationLine, 'lineTotal' | 'taxRatePercent' | 'priceIncludesGst'>
): number {
  const base = Number(ln.lineTotal ?? 0);
  const tr = ln.taxRatePercent;
  const r = tr != null && Number.isFinite(tr) && tr >= 0 ? Math.max(0, tr) / 100 : 0;
  if (ln.priceIncludesGst !== undefined && ln.priceIncludesGst !== null) {
    return Math.round(base * (1 + r) * 100) / 100;
  }
  return base;
}

export type CreateOrderLinePayload = {
  variantId: string;
  quantity: number;
  unitOfMeasure?: string;
  unitPrice?: number;
  posListUnitPrice?: number;
  posLineDiscountAmount?: number;
  posGstRatePercent?: number;
  posGstInclusive?: boolean;
  posLineNotes?: string;
  posHsn?: string;
};

function idStr(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && '_id' in (v as object)) return String((v as { _id?: unknown })._id);
  return String(v);
}

/**
 * Build POST /sales/orders `lines` from persisted order lines (POS / B2B metadata preserved for quotations).
 */
export function mapOrderLinesForCreateApi(lines: unknown[] | undefined): CreateOrderLinePayload[] {
  if (!lines?.length) return [];
  return lines.map((raw) => {
    const ln = raw as Record<string, unknown>;
    const variantId = idStr(ln.variantId);
    const quantity = Number(ln.quantity ?? 0);
    const unitPrice = ln.unitPrice != null ? Number(ln.unitPrice) : undefined;
    const out: CreateOrderLinePayload = { variantId, quantity };
    const uom = typeof ln.unitOfMeasure === 'string' ? ln.unitOfMeasure.trim().toLowerCase() : '';
    if (uom) out.unitOfMeasure = uom;
    if (unitPrice !== undefined && Number.isFinite(unitPrice)) out.unitPrice = unitPrice;
    const pl = ln.posListUnitPrice;
    if (pl != null && Number.isFinite(Number(pl)) && Number(pl) >= 0) {
      out.posListUnitPrice = Math.round(Number(pl) * 10000) / 10000;
    }
    const pd = ln.posLineDiscountAmount;
    if (pd != null && Number.isFinite(Number(pd)) && Number(pd) > 0) {
      out.posLineDiscountAmount = Math.round(Number(pd) * 100) / 100;
    }
    const pg = ln.posGstRatePercent;
    if (pg != null && Number.isFinite(Number(pg)) && Number(pg) >= 0) {
      out.posGstRatePercent = Number(pg);
    }
    const pn = typeof ln.posLineNotes === 'string' ? ln.posLineNotes.trim() : '';
    if (pn) out.posLineNotes = pn.slice(0, 2000);
    const ph = typeof ln.posHsn === 'string' ? ln.posHsn.trim().toUpperCase() : '';
    if (ph) out.posHsn = ph.slice(0, 16);
    if (ln.posGstInclusive === false) out.posGstInclusive = false;
    return out;
  });
}

/**
 * Build create-order lines from a saved quotation (list rate, discount, GST, notes, HSN → same shape as POS draft).
 */
export function mapQuotationLinesForCreateApi(lines: SalesQuotationLine[]): CreateOrderLinePayload[] {
  if (!lines?.length) return [];
  return lines.map((ln) => {
    const variantId = String(ln.variantId ?? '');
    const quantity = Number(ln.quantity ?? 0);
    const listUnit = Number(ln.unitPrice ?? 0);
    const disc = ln.discountAmount != null ? Number(ln.discountAmount) : 0;
    const lineTot = Number(ln.lineTotal ?? 0);
    const eff = quantity > 0 ? lineTot / quantity : listUnit;
    const out: CreateOrderLinePayload = {
      variantId,
      quantity,
      unitOfMeasure: typeof ln.unitOfMeasure === 'string' ? ln.unitOfMeasure.trim().toLowerCase() : undefined,
      unitPrice: Math.round(eff * 10000) / 10000,
    };
    if (listUnit > 0 && Math.abs(listUnit - eff) > 0.0001) {
      out.posListUnitPrice = Math.round(listUnit * 10000) / 10000;
    }
    if (disc > 0) out.posLineDiscountAmount = Math.round(disc * 100) / 100;
    const tr = ln.taxRatePercent;
    if (tr != null && Number.isFinite(tr) && tr >= 0) out.posGstRatePercent = tr;
    const note = typeof ln.lineNotes === 'string' ? ln.lineNotes.trim() : '';
    if (note) out.posLineNotes = note.slice(0, 2000);
    const h = typeof ln.hsn === 'string' ? ln.hsn.trim().toUpperCase() : '';
    if (h) out.posHsn = h.slice(0, 16);
    if (ln.priceIncludesGst === false) out.posGstInclusive = false;
    return out;
  });
}
