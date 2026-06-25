import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/shared/components/ui';
import { SideDrawer } from '@/shared/components/modals/SideDrawer';
import type { PurchaseReturnSettlementType, PurchaseReturnStatus } from '@/services/purchase.service';
import {
  countReturnModalFilters,
  SETTLEMENT_OPTIONS,
  type PurchaseReturnListFilters,
} from '../utils/purchaseReturnDisplay';
import './PurchaseOrdersListControls.css';

type Props = {
  filters: PurchaseReturnListFilters;
  filterDrawerOpen: boolean;
  onFilterDrawerOpenChange: (open: boolean) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onFiltersChange: (patch: Partial<PurchaseReturnListFilters>) => void;
  onCreate: () => void;
};

const STATUS_OPTIONS: { key: PurchaseReturnStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export const PurchaseReturnsListControls: React.FC<Props> = ({
  filters,
  filterDrawerOpen,
  onFilterDrawerOpenChange,
  searchInputRef,
  onFiltersChange,
  onCreate,
}) => {
  const [searchDraft, setSearchDraft] = useState(filters.search);

  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  const modalFilterCount = useMemo(() => countReturnModalFilters(filters), [filters]);

  const applySearch = useCallback(() => {
    onFiltersChange({ search: searchDraft.trim() });
  }, [onFiltersChange, searchDraft]);

  const clearDrawer = useCallback(() => {
    onFiltersChange({
      status: '',
      settlementType: '',
      pendingSettlementOnly: false,
    });
    onFilterDrawerOpenChange(false);
  }, [onFilterDrawerOpenChange, onFiltersChange]);

  const toggleStatus = (status: PurchaseReturnStatus) => {
    onFiltersChange({ status: filters.status === status ? '' : status });
  };

  const toggleSettlement = (settlementType: PurchaseReturnSettlementType) => {
    onFiltersChange({
      settlementType: filters.settlementType === settlementType ? '' : settlementType,
    });
  };

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
            placeholder="Search supplier, item, RMA · /"
            aria-label="Search purchase returns"
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
        <Button type="button" variant="primary" onClick={onCreate} title="New return (N)">
          + Return
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
        title="Return filters"
        width="360px"
      >
        <div className="po-orders-filter-drawer">
          <div className="po-orders-filter-drawer__section">
            <span className="po-orders-filter-drawer__label">Status</span>
            <p className="po-orders-filter-drawer__hint">Tap to toggle on or off</p>
            <div className="po-orders-filter-drawer__chips" role="group" aria-label="Return status">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`po-orders-filter-drawer__chip${
                    filters.status === opt.key ? ' po-orders-filter-drawer__chip--active' : ''
                  }`}
                  aria-pressed={filters.status === opt.key}
                  onClick={() => toggleStatus(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="po-orders-filter-drawer__section">
            <span className="po-orders-filter-drawer__label">Settlement</span>
            <div className="po-orders-filter-drawer__chips" role="group" aria-label="Settlement type">
              {SETTLEMENT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`po-orders-filter-drawer__chip${
                    filters.settlementType === opt.key ? ' po-orders-filter-drawer__chip--active' : ''
                  }`}
                  aria-pressed={filters.settlementType === opt.key}
                  onClick={() => toggleSettlement(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="po-orders-filter-drawer__section">
            <span className="po-orders-filter-drawer__label">Follow-up</span>
            <div className="po-orders-filter-drawer__chips">
              <button
                type="button"
                className={`po-orders-filter-drawer__chip${
                  filters.pendingSettlementOnly ? ' po-orders-filter-drawer__chip--active' : ''
                }`}
                aria-pressed={filters.pendingSettlementOnly}
                onClick={() =>
                  onFiltersChange({ pendingSettlementOnly: !filters.pendingSettlementOnly })
                }
              >
                Pending settlement only
              </button>
            </div>
          </div>

          <div className="po-orders-filter-drawer__actions">
            <Button type="button" variant="secondary" onClick={clearDrawer}>
              Clear filters
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
