import { useCallback } from 'react';
import { salesService } from '@/services/sales.service';

export function usePriceResolver(branchId: string | null) {
  return useCallback(
    async (variantId: string, opts?: { customerId?: string; salesPointId?: string }) => {
      return salesService.resolvePrice(variantId, { ...opts, branchId });
    },
    [branchId]
  );
}
