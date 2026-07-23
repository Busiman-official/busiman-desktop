import { useCallback, useState } from 'react';
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

  const search = useCallback(
    async (query: string) => {
      const q = query.trim();
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
        setItems(catalogRows(data));
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [branchId, isActive, limit, minLength]
  );

  const clear = useCallback(() => {
    setItems([]);
    setLoading(false);
  }, []);

  return { items, loading, search, clear };
}
