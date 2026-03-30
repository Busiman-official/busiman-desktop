import { useCallback, useState } from 'react';

export interface PosCartLine {
  variantId: string;
  itemId: string;
  sku: string;
  label: string;
  quantity: number;
  unitPrice: number;
  serialWarning?: boolean;
  batchWarning?: boolean;
}

function mergeLine(prev: PosCartLine[], line: PosCartLine): PosCartLine[] {
  const i = prev.findIndex((l) => l.variantId === line.variantId);
  if (i >= 0) {
    const next = [...prev];
    next[i] = {
      ...next[i],
      quantity: next[i].quantity + line.quantity,
      unitPrice: line.unitPrice,
      serialWarning: next[i].serialWarning || line.serialWarning,
      batchWarning: next[i].batchWarning || line.batchWarning,
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
    clear,
    replaceLines,
  };
}
