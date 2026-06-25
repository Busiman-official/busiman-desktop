import { useEffect, useRef } from 'react';
import type { PurchaseOrder } from '@/services/purchase.service';
import { isReceivablePurchaseOrder } from '../utils/receivablePurchaseOrders';
import {
  EMPTY_PURCHASE_ORDER_LIST_FILTERS,
  filtersForStatCard,
  type PoListStatCard,
  type PurchaseOrderListFilters,
} from '../utils/purchaseOrderListFilters';

type Params = {
  enabled: boolean;
  rows: PurchaseOrder[];
  page: number;
  pageCount: number;
  filterDrawerOpen: boolean;
  onFilterDrawerOpenChange: (open: boolean) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onCreate: () => void;
  onFiltersChange: (patch: Partial<PurchaseOrderListFilters>) => void;
  onClearAllFilters: () => void;
  onOpenOrder: (orderId: string) => void;
  onReceiveOrder: (order: PurchaseOrder) => void;
  onPageChange: (page: number) => void;
  highlightedRowIndex: number;
  onHighlightedRowIndexChange: (index: number) => void;
};

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

function statCardFromDigit(digit: string): PoListStatCard | 'default' | null {
  if (digit === '1') return 'receivable';
  if (digit === '2') return 'overdue';
  if (digit === '3') return 'draft';
  if (digit === '0') return 'default';
  return null;
}

export function usePurchaseOrdersListKeyboard({
  enabled,
  rows,
  page,
  pageCount,
  filterDrawerOpen,
  onFilterDrawerOpenChange,
  searchInputRef,
  onCreate,
  onFiltersChange,
  onClearAllFilters,
  onOpenOrder,
  onReceiveOrder,
  onPageChange,
  highlightedRowIndex,
  onHighlightedRowIndexChange,
}: Params): void {
  const rowsRef = useRef(rows);
  const highlightedRef = useRef(highlightedRowIndex);
  const pageRef = useRef(page);
  const pageCountRef = useRef(pageCount);
  const drawerOpenRef = useRef(filterDrawerOpen);

  rowsRef.current = rows;
  highlightedRef.current = highlightedRowIndex;
  pageRef.current = page;
  pageCountRef.current = pageCount;
  drawerOpenRef.current = filterDrawerOpen;

  useEffect(() => {
    if (!enabled) return;

    const clampHighlight = (next: number) => {
      const len = rowsRef.current.length;
      if (len <= 0) return 0;
      return Math.max(0, Math.min(len - 1, next));
    };

    const moveHighlight = (delta: number) => {
      onHighlightedRowIndexChange(clampHighlight(highlightedRef.current + delta));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target;
      const inTextEntry = isTextEntryTarget(target);
      const searchFocused = target === searchInputRef.current;

      if (mod && e.shiftKey && e.key === 'Enter') {
        if (drawerOpenRef.current || inTextEntry) return;
        e.preventDefault();
        e.stopPropagation();
        onCreate();
        return;
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        onFilterDrawerOpenChange(true);
        return;
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        e.stopPropagation();
        onClearAllFilters();
        onFilterDrawerOpenChange(false);
        searchInputRef.current?.blur();
        return;
      }

      if (e.key === 'Escape') {
        if (drawerOpenRef.current) {
          e.preventDefault();
          e.stopPropagation();
          onFilterDrawerOpenChange(false);
          return;
        }
        if (searchFocused) {
          e.preventDefault();
          e.stopPropagation();
          onFiltersChange({ search: '' });
          searchInputRef.current?.blur();
        }
        return;
      }

      if (drawerOpenRef.current) return;

      if (e.key === '/' && !inTextEntry) {
        e.preventDefault();
        e.stopPropagation();
        const input = searchInputRef.current;
        if (!input) return;
        input.focus();
        input.select();
        return;
      }

      if (!inTextEntry && !mod && !e.altKey) {
        const stat = statCardFromDigit(e.key);
        if (stat === 'default') {
          e.preventDefault();
          onFiltersChange({
            statuses: [...EMPTY_PURCHASE_ORDER_LIST_FILTERS.statuses],
            overdueOnly: false,
            dateFrom: '',
            dateTo: '',
          });
          return;
        }
        if (stat) {
          e.preventDefault();
          onFiltersChange(filtersForStatCard(stat));
          return;
        }
      }

      if (inTextEntry && !searchFocused) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveHighlight(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveHighlight(-1);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        onHighlightedRowIndexChange(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        onHighlightedRowIndexChange(Math.max(0, rowsRef.current.length - 1));
        return;
      }

      if (e.key === 'PageDown') {
        if (pageRef.current >= pageCountRef.current) return;
        e.preventDefault();
        onPageChange(pageRef.current + 1);
        return;
      }
      if (e.key === 'PageUp') {
        if (pageRef.current <= 1) return;
        e.preventDefault();
        onPageChange(pageRef.current - 1);
        return;
      }

      if (e.key === 'Enter' && !inTextEntry) {
        const row = rowsRef.current[highlightedRef.current];
        if (!row) return;
        e.preventDefault();
        onOpenOrder(row.id);
        return;
      }

      if ((e.key === 'r' || e.key === 'R') && !mod && !inTextEntry) {
        const row = rowsRef.current[highlightedRef.current];
        if (!row || !isReceivablePurchaseOrder(row)) return;
        e.preventDefault();
        onReceiveOrder(row);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    enabled,
    onClearAllFilters,
    onCreate,
    onFilterDrawerOpenChange,
    onFiltersChange,
    onHighlightedRowIndexChange,
    onOpenOrder,
    onPageChange,
    onReceiveOrder,
    searchInputRef,
  ]);
}
