import { useEffect, useRef } from 'react';
import type { PurchaseReturn } from '@/services/purchase.service';
import type { PurchaseReturnListFilters } from '../utils/purchaseReturnDisplay';

type Params = {
  enabled: boolean;
  rows: PurchaseReturn[];
  page: number;
  pageCount: number;
  filterDrawerOpen: boolean;
  onFilterDrawerOpenChange: (open: boolean) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onFiltersChange: (patch: Partial<PurchaseReturnListFilters>) => void;
  onClearAllFilters: () => void;
  onCreate: () => void;
  onOpenReturn: (returnId: string) => void;
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

export function usePurchaseReturnsListKeyboard({
  enabled,
  rows,
  page,
  pageCount,
  filterDrawerOpen,
  onFilterDrawerOpenChange,
  searchInputRef,
  onFiltersChange,
  onClearAllFilters,
  onCreate,
  onOpenReturn,
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
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (e.key.toLowerCase() === 'n' && !inTextEntry && !mod && !e.altKey) {
        e.preventDefault();
        onCreate();
        return;
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
        onOpenReturn(row.id);
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
    onOpenReturn,
    onPageChange,
    searchInputRef,
  ]);
}
