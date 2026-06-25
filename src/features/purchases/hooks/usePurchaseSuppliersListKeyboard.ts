import { useEffect, useRef } from 'react';
import type { PurchaseSupplierSummary } from '@/services/purchase.service';
import {
  EMPTY_SUPPLIER_LIST_FILTERS,
  applySupplierStatCard,
  togglePartialPayablesFilter,
  togglePendingPayablesFilter,
  type SupplierListStatCard,
  type PurchaseSupplierListFilters,
} from '../utils/purchaseSupplierListFilters';

type Params = {
  enabled: boolean;
  filters: PurchaseSupplierListFilters;
  rows: PurchaseSupplierSummary[];
  page: number;
  pageCount: number;
  filterDrawerOpen: boolean;
  onFilterDrawerOpenChange: (open: boolean) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onFiltersChange: (patch: Partial<PurchaseSupplierListFilters>) => void;
  onClearAllFilters: () => void;
  onOpenSupplier: (supplierId: string) => void;
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

function statCardFromDigit(digit: string): SupplierListStatCard | 'default' | null {
  if (digit === '1') return 'outstanding';
  if (digit === '2') return 'pending';
  if (digit === '3') return 'partial';
  if (digit === '0') return 'default';
  return null;
}

export function usePurchaseSuppliersListKeyboard({
  enabled,
  filters,
  rows,
  page,
  pageCount,
  filterDrawerOpen,
  onFilterDrawerOpenChange,
  searchInputRef,
  onFiltersChange,
  onClearAllFilters,
  onOpenSupplier,
  onPageChange,
  highlightedRowIndex,
  onHighlightedRowIndexChange,
}: Params): void {
  const filtersRef = useRef(filters);
  const rowsRef = useRef(rows);
  const highlightedRef = useRef(highlightedRowIndex);
  const pageRef = useRef(page);
  const pageCountRef = useRef(pageCount);
  const drawerOpenRef = useRef(filterDrawerOpen);

  filtersRef.current = filters;
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

      if (drawerOpenRef.current && e.key.toLowerCase() === 'p' && !mod && !inTextEntry) {
        e.preventDefault();
        onFiltersChange(togglePendingPayablesFilter(filtersRef.current));
        return;
      }
      if (drawerOpenRef.current && e.key.toLowerCase() === 'l' && !mod && !inTextEntry) {
        e.preventDefault();
        onFiltersChange(togglePartialPayablesFilter(filtersRef.current));
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
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (!inTextEntry && !mod && !e.altKey) {
        const stat = statCardFromDigit(e.key);
        if (stat === 'default') {
          e.preventDefault();
          onFiltersChange({ ...EMPTY_SUPPLIER_LIST_FILTERS });
          return;
        }
        if (stat) {
          e.preventDefault();
          onFiltersChange(applySupplierStatCard(filtersRef.current, stat));
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
        onOpenSupplier(row.supplierId);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    enabled,
    onClearAllFilters,
    onFilterDrawerOpenChange,
    onFiltersChange,
    onHighlightedRowIndexChange,
    onOpenSupplier,
    onPageChange,
    searchInputRef,
  ]);
}
