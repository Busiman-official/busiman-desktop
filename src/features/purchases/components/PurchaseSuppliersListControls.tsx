import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/shared/components/ui';
import { SideDrawer } from '@/shared/components/modals/SideDrawer';
import {
  togglePartialPayablesFilter,
  togglePendingPayablesFilter,
  type PurchaseSupplierListFilters,
} from '../utils/purchaseSupplierListFilters';
import './PurchaseOrdersListControls.css';

type Props = {
  filters: PurchaseSupplierListFilters;
  filterDrawerOpen: boolean;
  onFilterDrawerOpenChange: (open: boolean) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onFiltersChange: (patch: Partial<PurchaseSupplierListFilters>) => void;
  onCreateSupplier: () => void;
};

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export const PurchaseSuppliersListControls: React.FC<Props> = ({
  filters,
  filterDrawerOpen,
  onFilterDrawerOpenChange,
  searchInputRef,
  onFiltersChange,
  onCreateSupplier,
}) => {
  const [searchDraft, setSearchDraft] = useState(filters.search);

  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  const modalFilterCount = useMemo(() => {
    let n = 0;
    if (filters.payablesFilter === 'pending') n += 1;
    if (filters.payablesFilter === 'partial') n += 1;
    return n;
  }, [filters.payablesFilter]);

  const applySearch = useCallback(() => {
    onFiltersChange({ search: searchDraft.trim() });
  }, [onFiltersChange, searchDraft]);

  const clearDrawer = useCallback(() => {
    onFiltersChange({ search: '', payablesFilter: 'all' });
    onFilterDrawerOpenChange(false);
  }, [onFilterDrawerOpenChange, onFiltersChange]);

  return (
    <>
      <div className="po-orders-header-controls">
        <div className="po-orders-header-controls__search">
          <span className="po-orders-header-controls__search-icon" aria-hidden>
            ⌕
          </span>
          <input
            ref={searchInputRef}
            type="search"
            className="po-orders-header-controls__search-input"
            value={searchDraft}
            placeholder="Search supplier · /"
            aria-label="Search suppliers"
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applySearch();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setSearchDraft('');
                onFiltersChange({ search: '' });
                searchInputRef.current?.blur();
              }
            }}
            onBlur={applySearch}
          />
        </div>
        <Button type="button" variant="primary" onClick={onCreateSupplier} title="Create supplier">
          + Supplier
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="po-orders-header-controls__filter"
          onClick={() => onFilterDrawerOpenChange(true)}
          title="Filter (Ctrl+Shift+F)"
        >
          <FilterIcon />
          {modalFilterCount > 0 ? (
            <span className="po-orders-header-controls__filter-badge">{modalFilterCount}</span>
          ) : null}
        </Button>
      </div>

      <SideDrawer
        isOpen={filterDrawerOpen}
        onClose={() => onFilterDrawerOpenChange(false)}
        title="Supplier filters"
        width="360px"
      >
        <div className="po-orders-filter-drawer">
          <div className="po-orders-filter-drawer__section">
            <span className="po-orders-filter-drawer__label">Payables</span>
            <p className="po-orders-filter-drawer__hint">Tap to toggle on or off</p>
            <div className="po-orders-filter-drawer__chips" role="group" aria-label="Payables filter">
              <button
                type="button"
                className={`po-orders-filter-drawer__chip${
                  filters.payablesFilter === 'pending' ? ' po-orders-filter-drawer__chip--active' : ''
                }`}
                aria-pressed={filters.payablesFilter === 'pending'}
                onClick={() => onFiltersChange(togglePendingPayablesFilter(filters))}
              >
                Payments pending
              </button>
              <button
                type="button"
                className={`po-orders-filter-drawer__chip${
                  filters.payablesFilter === 'partial' ? ' po-orders-filter-drawer__chip--active' : ''
                }`}
                aria-pressed={filters.payablesFilter === 'partial'}
                onClick={() => onFiltersChange(togglePartialPayablesFilter(filters))}
              >
                Partially paid
              </button>
            </div>
          </div>
          <div className="po-orders-filter-drawer__section">
            <span className="po-orders-filter-drawer__label">Sort</span>
            <select
              className="po-orders-filter-drawer__select"
              value={filters.sort}
              onChange={(e) =>
                onFiltersChange({
                  sort: e.target.value as PurchaseSupplierListFilters['sort'],
                })
              }
            >
              <option value="outstanding_desc">Outstanding (high first)</option>
              <option value="name_asc">Name (A–Z)</option>
              <option value="last_receipt_desc">Last receipt (newest)</option>
            </select>
          </div>
          <div className="po-orders-filter-drawer__actions">
            <Button type="button" variant="secondary" onClick={clearDrawer}>
              Clear all
            </Button>
            <Button type="button" variant="primary" onClick={() => onFilterDrawerOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      </SideDrawer>
    </>
  );
};
