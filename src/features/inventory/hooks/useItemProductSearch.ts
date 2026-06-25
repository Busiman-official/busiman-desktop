import { useCallback, useState } from 'react';
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

  const search = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q) {
        setItems([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await searchService.search(q, { types: ['item'], branchId }, limit);
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
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [branchId, categoryFilter, limit]
  );

  const clear = useCallback(() => {
    searchService.cancel();
    setItems([]);
    setLoading(false);
  }, []);

  return { items, loading, search, clear };
}
