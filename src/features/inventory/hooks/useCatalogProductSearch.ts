import { useCallback, useRef, useState } from 'react';
import {
  catalogRows,
  inventoryService,
  type CatalogVariantRow,
} from '@/services/inventory.service';

export type UseCatalogProductSearchOptions = {
  branchId?: string | null;
  limit?: number;
  minLength?: number;
  isActive?: boolean;
};

export function useCatalogProductSearch({
  branchId,
  limit = 8,
  minLength = 1,
  isActive = true,
}: UseCatalogProductSearchOptions) {
  const [items, setItems] = useState<CatalogVariantRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Guards against an out-of-order response: two searches in flight at once (StrictMode's
  // double-invoke in dev, a fast retype before the first request lands, ...) resolve in whatever
  // order the network happens to deliver them — an OLDER query's response arriving AFTER a NEWER
  // one would otherwise silently clobber the correct, already-rendered results with stale ones.
  // Only the response for whatever query is CURRENTLY the latest-requested one is ever committed.
  const latestQueryRef = useRef<string>('');

  const search = useCallback(
    async (query: string) => {
      const q = query.trim();
      latestQueryRef.current = q;
      if (q.length < minLength) {
        setItems([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const data = await inventoryService.getCatalog({
          search: q,
          branchId: branchId || undefined,
          isActive,
          page: 1,
          limit,
        });
        if (latestQueryRef.current !== q) return; // superseded by a newer search — drop this one
        setItems(catalogRows(data));
      } catch {
        if (latestQueryRef.current !== q) return;
        setItems([]);
      } finally {
        if (latestQueryRef.current === q) setLoading(false);
      }
    },
    [branchId, isActive, limit, minLength]
  );

  const clear = useCallback(() => {
    latestQueryRef.current = '';
    setItems([]);
    setLoading(false);
  }, []);

  return { items, loading, search, clear };
}
