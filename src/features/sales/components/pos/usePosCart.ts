import { useCallback, useState } from 'react';
import { mergePosSerialNumbers } from './posSerialUtils';

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
  /** Only meaningful when serialWarning is true — see PosResolvedLineMeta.serialOptional. */
  serialOptional?: boolean;
  batchWarning?: boolean;
  /** Confirmed serial numbers for ISSUE (one per unit when serialWarning). */
  serialNumbers?: string[];
  /**
   * Subset of serialNumbers that don't exist yet — server will mint them on checkout
   * ("serialize-at-exit", SERIAL_OPTIONAL items only). Kept separate purely so the UI can badge
   * them distinctly from serials picked out of existing stock; checkout sends serialNumbers as-is
   * either way, the server re-derives new-vs-existing itself.
   */
  newSerialNumbers?: string[];
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
  /** Purchase receipt put-away target (any hierarchy depth). */
  toLocationId?: string;
  toLocationPath?: string;
}

export function posCartLineKey(line: PosCartLine, splitByLocation = false): string {
  if (!splitByLocation) return line.variantId;
  return `${line.variantId}::${line.toLocationId ?? ''}`;
}

function mergeLine(prev: PosCartLine[], line: PosCartLine, splitByLocation: boolean): PosCartLine[] {
  const key = posCartLineKey(line, splitByLocation);
  const i = prev.findIndex((l) => posCartLineKey(l, splitByLocation) === key);
  if (i >= 0) {
    const next = [...prev];
    next[i] = {
      ...next[i],
      quantity: next[i].quantity + line.quantity,
      unitPrice: line.unitPrice,
      isNonStock: next[i].isNonStock || line.isNonStock,
      allowNegativeStock: next[i].allowNegativeStock || line.allowNegativeStock,
      serialWarning: next[i].serialWarning || line.serialWarning,
      // Optional only if BOTH merging lines agree it's optional — if either resolved as strictly
      // required (stale meta, a variant override race, etc.) the merged line must not silently
      // relax to optional and let checkout skip a serial it actually needs.
      serialOptional: (next[i].serialOptional ?? true) && (line.serialOptional ?? true),
      batchWarning: next[i].batchWarning || line.batchWarning,
      serialNumbers: mergePosSerialNumbers(next[i].serialNumbers, line.serialNumbers),
      newSerialNumbers: mergePosSerialNumbers(next[i].newSerialNumbers, line.newSerialNumbers),
      lineDiscountType: next[i].lineDiscountType ?? line.lineDiscountType,
      lineDiscountValue: next[i].lineDiscountValue ?? line.lineDiscountValue,
      gstRatePercent: next[i].gstRatePercent ?? line.gstRatePercent,
      gstInclusive: next[i].gstInclusive ?? line.gstInclusive ?? true,
      notes: next[i].notes ?? line.notes,
      hsn: next[i].hsn ?? line.hsn,
      unitOfMeasure: next[i].unitOfMeasure ?? line.unitOfMeasure,
      baseUnit: next[i].baseUnit ?? line.baseUnit,
      unitOptions: next[i].unitOptions ?? line.unitOptions,
      toLocationId: next[i].toLocationId ?? line.toLocationId,
      toLocationPath: next[i].toLocationPath ?? line.toLocationPath,
    };
    return next;
  }
  return [...prev, line];
}

type UsePosCartOptions = {
  /** Same variant at different storage locations stays separate (receipts). */
  splitByLocation?: boolean;
};

export function usePosCart(initial?: PosCartLine[], options?: UsePosCartOptions) {
  const splitByLocation = options?.splitByLocation === true;
  const [lines, setLines] = useState<PosCartLine[]>(initial ?? []);
  const [lastMergedVariantId, setLastMergedVariantId] = useState<string | null>(null);

  const addOrMerge = useCallback(
    (line: PosCartLine) => {
      setLines((prev) => mergeLine(prev, line, splitByLocation));
      setLastMergedVariantId(line.variantId);
      window.setTimeout(() => setLastMergedVariantId(null), 450);
    },
    [splitByLocation]
  );

  const setQty = useCallback(
    (lineKey: string, quantity: number) => {
      setLines((prev) =>
        prev
          .map((l) => (posCartLineKey(l, splitByLocation) === lineKey ? { ...l, quantity } : l))
          .filter((l) => l.quantity > 0)
      );
    },
    [splitByLocation]
  );

  const removeLine = useCallback(
    (lineKey: string) => {
      setLines((prev) => prev.filter((l) => posCartLineKey(l, splitByLocation) !== lineKey));
    },
    [splitByLocation]
  );

  const updateLine = useCallback(
    (lineKey: string, patch: Partial<PosCartLine>) => {
      setLines((prev) => {
        const idx = prev.findIndex((l) => posCartLineKey(l, splitByLocation) === lineKey);
        if (idx < 0) return prev;
        const current = prev[idx];
        const updated = { ...current, ...patch };
        const newKey = posCartLineKey(updated, splitByLocation);
        if (newKey === lineKey) {
          return prev.map((l, i) => (i === idx ? updated : l));
        }
        const rest = prev.filter((_, i) => i !== idx);
        const mergeIdx = rest.findIndex((l) => posCartLineKey(l, splitByLocation) === newKey);
        if (mergeIdx >= 0) {
          const next = [...rest];
          next[mergeIdx] = mergeLine([next[mergeIdx]], updated, splitByLocation)[0];
          return next;
        }
        return [...rest, updated];
      });
    },
    [splitByLocation]
  );

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
    splitByLocation,
    addOrMerge,
    setQty,
    removeLine,
    updateLine,
    clear,
    replaceLines,
    lineKey: (line: PosCartLine) => posCartLineKey(line, splitByLocation),
  };
}
