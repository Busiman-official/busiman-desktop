import { useCallback, useRef, useState } from 'react';
import { searchService } from '@/features/inventory/services/search.service';
import type { ItemSearchResult } from '@/features/inventory/types/search.types';

export type UseItemProductSearchOptions = {
  branchId: string;
  limit?: number;
  categoryFilter?: string | null;
};

export function useItemProductSearch({
  branchId,
  limit = 12,
  categoryFilter = null,
}: UseItemProductSearchOptions) {
  const [items, setItems] = useState<ItemSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  // Guards against an out-of-order response — see the identical comment in
  // useCatalogProductSearch. searchService's single shared AbortController only cancels the
  // PREVIOUS request from THIS service instance at the moment a new one starts; it doesn't
  // guarantee responses resolve in request order, so an older query's result can still land after
  // a newer one and silently overwrite it with stale (or empty) data.
  const latestQueryRef = useRef<string>('');

  const search = useCallback(
    async (query: string) => {
      const q = query.trim();
      latestQueryRef.current = q;
      if (!q) {
        setItems([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await searchService.search(q, { types: ['item'], branchId }, limit);
        if (latestQueryRef.current !== q) return; // superseded by a newer search — drop this one
        let list = (res.items || []) as ItemSearchResult[];
        if (categoryFilter) {
          list = list.filter(
            (it) => it.category?.toLowerCase() === categoryFilter.toLowerCase()
          );
        }
        setItems(list);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'Search canceled') return;
        if (latestQueryRef.current !== q) return;
        setItems([]);
      } finally {
        if (latestQueryRef.current === q) setLoading(false);
      }
    },
    [branchId, categoryFilter, limit]
  );

  const clear = useCallback(() => {
    searchService.cancel();
    latestQueryRef.current = '';
    setItems([]);
    setLoading(false);
  }, []);

  return { items, loading, search, clear };
}
