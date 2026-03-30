import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBranchContext } from '@/hooks/useBranchContext';

/**
 * Effective branch for `/sales` API calls: explicit `?branchId=` (admins) wins over the user's branch.
 */
export function useSalesBranchId(): string | null {
  const [searchParams] = useSearchParams();
  const { branchId: authBranchId } = useBranchContext();
  return useMemo(() => {
    const q = searchParams.get('branchId');
    return (q && q.trim()) || authBranchId || null;
  }, [searchParams, authBranchId]);
}
