import { useCallback, useState } from 'react';

export interface PosCartLine {
  variantId: string;
  itemId: string;
  sku: string;
  label: string;
  quantity: number;
  unitPrice: number;
  isNonStock?: boolean;
  /** MISC + tracked inventory: allow selling below zero on hand (matches server POS / movement rules). */
  allowNegativeStock?: boolean;
  serialWarning?: boolean;
  batchWarning?: boolean;
  /** Per-line discount (this sale only). */
  lineDiscountType?: 'per_unit' | 'flat' | 'percent';
  lineDiscountValue?: number;
  /** Exclusive GST % on net after line discount; if omitted, panel uses branch default. */
  gstRatePercent?: number;
  /**
   * When true (default), unit price includes GST at the selected rate.
   * When false, unit price is before tax and GST is added on top.
   */
  gstInclusive?: boolean;
  notes?: string;
  hsn?: string;
  unitOfMeasure?: string;
  baseUnit?: string;
  unitOptions?: Array<{ unitCode: string; factorToBase: number }>;
}

function mergeLine(prev: PosCartLine[], line: PosCartLine): PosCartLine[] {
  const i = prev.findIndex((l) => l.variantId === line.variantId);
  if (i >= 0) {
    const next = [...prev];
    next[i] = {
      ...next[i],
      quantity: next[i].quantity + line.quantity,
      unitPrice: line.unitPrice,
      isNonStock: next[i].isNonStock || line.isNonStock,
      allowNegativeStock: next[i].allowNegativeStock || line.allowNegativeStock,
      serialWarning: next[i].serialWarning || line.serialWarning,
      batchWarning: next[i].batchWarning || line.batchWarning,
      lineDiscountType: next[i].lineDiscountType ?? line.lineDiscountType,
      lineDiscountValue: next[i].lineDiscountValue ?? line.lineDiscountValue,
      gstRatePercent: next[i].gstRatePercent ?? line.gstRatePercent,
      gstInclusive: next[i].gstInclusive ?? line.gstInclusive ?? true,
      notes: next[i].notes ?? line.notes,
      hsn: next[i].hsn ?? line.hsn,
      unitOfMeasure: next[i].unitOfMeasure ?? line.unitOfMeasure,
      baseUnit: next[i].baseUnit ?? line.baseUnit,
      unitOptions: next[i].unitOptions ?? line.unitOptions,
    };
    return next;
  }
  return [...prev, line];
}

export function usePosCart(initial?: PosCartLine[]) {
  const [lines, setLines] = useState<PosCartLine[]>(initial ?? []);
  const [lastMergedVariantId, setLastMergedVariantId] = useState<string | null>(null);

  const addOrMerge = useCallback((line: PosCartLine) => {
    setLines((prev) => mergeLine(prev, line));
    setLastMergedVariantId(line.variantId);
    window.setTimeout(() => setLastMergedVariantId(null), 450);
  }, []);

  const setQty = useCallback((variantId: string, quantity: number) => {
    setLines((prev) =>
      prev
        .map((l) => (l.variantId === variantId ? { ...l, quantity } : l))
        .filter((l) => l.quantity > 0)
    );
  }, []);

  const removeLine = useCallback((variantId: string) => {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }, []);

  const updateLine = useCallback((variantId: string, patch: Partial<PosCartLine>) => {
    setLines((prev) =>
      prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l))
    );
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setLastMergedVariantId(null);
  }, []);

  const replaceLines = useCallback((next: PosCartLine[]) => {
    setLines(next);
  }, []);

  return {
    lines,
    lastMergedVariantId,
    addOrMerge,
    setQty,
    removeLine,
    updateLine,
    clear,
    replaceLines,
  };
}
