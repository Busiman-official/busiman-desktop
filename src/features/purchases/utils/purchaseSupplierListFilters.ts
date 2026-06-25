export type SupplierPayablesFilter = 'all' | 'pending' | 'partial';

export type SupplierListSort = 'outstanding_desc' | 'name_asc' | 'last_receipt_desc';

export type PurchaseSupplierListFilters = {
  search: string;
  payablesFilter: SupplierPayablesFilter;
  sort: SupplierListSort;
};

export const DEFAULT_SUPPLIER_LIST_FILTERS: PurchaseSupplierListFilters = {
  search: '',
  payablesFilter: 'all',
  sort: 'outstanding_desc',
};

export const EMPTY_SUPPLIER_LIST_FILTERS: PurchaseSupplierListFilters = {
  search: '',
  payablesFilter: 'all',
  sort: 'outstanding_desc',
};

export type SupplierListStatCard = 'outstanding' | 'pending' | 'partial';

export function hasActiveSupplierListFilters(filters: PurchaseSupplierListFilters): boolean {
  return Boolean(filters.search.trim()) || filters.payablesFilter !== 'all';
}

export function isPendingPayablesFilter(filters: PurchaseSupplierListFilters): boolean {
  return filters.payablesFilter === 'pending' && !filters.search.trim();
}

export function isPartialPayablesFilter(filters: PurchaseSupplierListFilters): boolean {
  return filters.payablesFilter === 'partial' && !filters.search.trim();
}

export function togglePendingPayablesFilter(
  filters: PurchaseSupplierListFilters
): Partial<PurchaseSupplierListFilters> {
  return {
    payablesFilter: filters.payablesFilter === 'pending' ? 'all' : 'pending',
  };
}

export function togglePartialPayablesFilter(
  filters: PurchaseSupplierListFilters
): Partial<PurchaseSupplierListFilters> {
  return {
    payablesFilter: filters.payablesFilter === 'partial' ? 'all' : 'partial',
  };
}

/** @deprecated Use togglePendingPayablesFilter */
export function togglePendingOnlyFilter(
  filters: PurchaseSupplierListFilters
): Partial<PurchaseSupplierListFilters> {
  return togglePendingPayablesFilter(filters);
}

export function applySupplierStatCard(
  filters: PurchaseSupplierListFilters,
  card: SupplierListStatCard
): Partial<PurchaseSupplierListFilters> {
  if (card === 'partial') {
    return {
      payablesFilter: filters.payablesFilter === 'partial' ? 'all' : 'partial',
      search: '',
    };
  }
  return {
    payablesFilter: filters.payablesFilter === 'pending' ? 'all' : 'pending',
    search: '',
  };
}

export function isOutstandingStatFilter(filters: PurchaseSupplierListFilters): boolean {
  return isPendingPayablesFilter(filters);
}

export function isPendingSuppliersStatFilter(filters: PurchaseSupplierListFilters): boolean {
  return isPendingPayablesFilter(filters);
}

export function isPartialStatFilter(filters: PurchaseSupplierListFilters): boolean {
  return isPartialPayablesFilter(filters);
}

/** @deprecated Use isPendingPayablesFilter */
export function isPendingOnlyFilter(filters: PurchaseSupplierListFilters): boolean {
  return isPendingPayablesFilter(filters);
}

export function listStatsQueryParams(filters: PurchaseSupplierListFilters) {
  return {
    search: filters.search || undefined,
  };
}

export function listSuppliersQueryParams(filters: PurchaseSupplierListFilters) {
  return {
    search: filters.search || undefined,
    pendingOnly: filters.payablesFilter === 'pending',
    partialOnly: filters.payablesFilter === 'partial',
    sort: filters.sort,
  };
}
