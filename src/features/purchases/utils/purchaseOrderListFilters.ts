import type { PurchaseOrderStatus } from '@/services/purchase.service';

export type PurchaseOrderListFilters = {
  search: string;
  statuses: PurchaseOrderStatus[];
  overdueOnly: boolean;
  supplierId: string;
  dateFrom: string;
  dateTo: string;
};

/** Active PO list: hide completed and cancelled until user enables them in filters. */
export const DEFAULT_PO_LIST_STATUSES: PurchaseOrderStatus[] = ['draft', 'confirmed', 'partial'];

export const RECEIVABLE_PO_STATUSES: PurchaseOrderStatus[] = ['confirmed', 'partial'];

export const DRAFT_PO_STATUSES: PurchaseOrderStatus[] = ['draft'];

export const EMPTY_PURCHASE_ORDER_LIST_FILTERS: PurchaseOrderListFilters = {
  search: '',
  statuses: [...DEFAULT_PO_LIST_STATUSES],
  overdueOnly: false,
  supplierId: '',
  dateFrom: '',
  dateTo: '',
};

export const PO_LIST_STATUS_CHIPS: Array<{ id: PurchaseOrderStatus; label: string }> = [
  { id: 'draft', label: 'Draft' },
  { id: 'confirmed', label: 'Open' },
  { id: 'partial', label: 'Partial' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const ALL_PO_STATUSES: PurchaseOrderStatus[] = ['draft', 'confirmed', 'partial', 'completed', 'cancelled'];

export type PoListStatCard = 'receivable' | 'overdue' | 'draft';

export function purchaseOrderStatusLabel(status: PurchaseOrderStatus): string {
  if (status === 'confirmed') return 'Open';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function sameStatuses(a: PurchaseOrderStatus[], b: PurchaseOrderStatus[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((s) => set.has(s));
}

export function areDefaultPoListStatuses(statuses: PurchaseOrderStatus[]): boolean {
  return sameStatuses(statuses, DEFAULT_PO_LIST_STATUSES);
}

export function isReceivableListFilter(filters: PurchaseOrderListFilters): boolean {
  return !filters.overdueOnly && sameStatuses(filters.statuses, RECEIVABLE_PO_STATUSES);
}

export function isOverdueListFilter(filters: PurchaseOrderListFilters): boolean {
  return filters.overdueOnly && sameStatuses(filters.statuses, RECEIVABLE_PO_STATUSES);
}

export function isDraftListFilter(filters: PurchaseOrderListFilters): boolean {
  return !filters.overdueOnly && sameStatuses(filters.statuses, DRAFT_PO_STATUSES);
}

export function filtersForStatCard(card: PoListStatCard): Partial<PurchaseOrderListFilters> {
  if (card === 'receivable') {
    return { statuses: [...RECEIVABLE_PO_STATUSES], overdueOnly: false, dateFrom: '', dateTo: '' };
  }
  if (card === 'overdue') {
    return { statuses: [...RECEIVABLE_PO_STATUSES], overdueOnly: true, dateFrom: '', dateTo: '' };
  }
  return { statuses: [...DRAFT_PO_STATUSES], overdueOnly: false, dateFrom: '', dateTo: '' };
}

export function togglePoListStatus(
  current: PurchaseOrderStatus[],
  status: PurchaseOrderStatus
): PurchaseOrderStatus[] {
  if (current.includes(status)) {
    const next = current.filter((s) => s !== status);
    return next.length > 0 ? next : current;
  }
  return [...current, status].sort(
    (a, b) => ALL_PO_STATUSES.indexOf(a) - ALL_PO_STATUSES.indexOf(b)
  );
}

function localDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function orderDatePresetRange(preset: 'today' | 'week' | 'month'): Pick<PurchaseOrderListFilters, 'dateFrom' | 'dateTo'> {
  const now = new Date();
  const end = localDateISO(now);
  if (preset === 'today') return { dateFrom: end, dateTo: end };
  const start = new Date(now);
  if (preset === 'week') start.setDate(start.getDate() - 6);
  else start.setDate(1);
  return { dateFrom: localDateISO(start), dateTo: end };
}

export function listStatsQueryParams(filters: PurchaseOrderListFilters): {
  search?: string;
  supplierId?: string;
  dateFrom?: string;
  dateTo?: string;
} {
  return {
    search: filters.search.trim() || undefined,
    supplierId: filters.supplierId || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  };
}

export function countModalFilters(filters: PurchaseOrderListFilters): number {
  let n = 0;
  if (!areDefaultPoListStatuses(filters.statuses)) n += 1;
  if (filters.overdueOnly) n += 1;
  if (filters.supplierId) n += 1;
  if (filters.dateFrom || filters.dateTo) n += 1;
  return n;
}

export function hasActiveListFilters(filters: PurchaseOrderListFilters): boolean {
  return Boolean(filters.search.trim()) || countModalFilters(filters) > 0;
}

export function hasListScopeFilters(filters: PurchaseOrderListFilters): boolean {
  return Boolean(filters.search.trim()) || Boolean(filters.supplierId) || Boolean(filters.dateFrom || filters.dateTo);
}

export type PurchaseOrderListFilterChip = { key: string; label: string };

export function buildActiveFilterChips(
  filters: PurchaseOrderListFilters,
  supplierName?: string
): PurchaseOrderListFilterChip[] {
  const chips: PurchaseOrderListFilterChip[] = [];
  if (filters.search.trim()) {
    chips.push({ key: 'search', label: `Search: "${filters.search.trim()}"` });
  }
  if (filters.overdueOnly) {
    chips.push({ key: 'overdueOnly', label: 'Overdue delivery' });
  }
  if (!areDefaultPoListStatuses(filters.statuses)) {
    chips.push({
      key: 'statuses',
      label: `Status: ${filters.statuses.map(purchaseOrderStatusLabel).join(', ')}`,
    });
  }
  if (filters.supplierId) {
    chips.push({ key: 'supplierId', label: supplierName ? `Supplier: ${supplierName}` : 'Supplier filter' });
  }
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom || '…';
    const to = filters.dateTo || '…';
    chips.push({ key: 'dateRange', label: `Ordered: ${from} – ${to}` });
  }
  return chips;
}
