import { useCallback, useMemo } from 'react';
import { salesService } from '@/services/sales.service';

export function usePriceResolver(branchId: string | null) {
  const resolvePrice = useCallback(
    async (variantId: string, opts?: { customerId?: string; salesPointId?: string }) => {
      return salesService.resolvePrice(variantId, { ...opts, branchId });
    },
    [branchId]
  );

  const resolvePricesBatch = useCallback(
    async (variantIds: string[], opts?: { customerId?: string; salesPointId?: string }) => {
      return salesService.resolvePricesBatch(variantIds, { ...opts, branchId });
    },
    [branchId]
  );

  return useMemo(
    () => ({ resolvePrice, resolvePricesBatch }),
    [resolvePrice, resolvePricesBatch]
  );
}
