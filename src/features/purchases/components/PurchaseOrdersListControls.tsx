import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Select } from '@/shared/components/ui';
import { SideDrawer } from '@/shared/components/modals/SideDrawer';
import {
  countModalFilters,
  DEFAULT_PO_LIST_STATUSES,
  orderDatePresetRange,
  PO_LIST_STATUS_CHIPS,
  togglePoListStatus,
  type PurchaseOrderListFilters,
} from '../utils/purchaseOrderListFilters';
import './PurchaseOrdersListControls.css';

type ModalFilterDraft = Omit<PurchaseOrderListFilters, 'search'>;

type Props = {
  filters: PurchaseOrderListFilters;
  supplierOptions: Array<{ id: string; name: string }>;
  filterDrawerOpen: boolean;
  onFilterDrawerOpenChange: (open: boolean) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onFiltersChange: (patch: Partial<PurchaseOrderListFilters>) => void;
  onCreate: () => void;
};

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M7 12h10M10 18h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function modalDraftFromFilters(filters: PurchaseOrderListFilters): ModalFilterDraft {
  return {
    statuses: [...filters.statuses],
    overdueOnly: filters.overdueOnly,
    supplierId: filters.supplierId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  };
}

const DEFAULT_MODAL_DRAFT: ModalFilterDraft = {
  statuses: [...DEFAULT_PO_LIST_STATUSES],
  overdueOnly: false,
  supplierId: '',
  dateFrom: '',
  dateTo: '',
};

export const PurchaseOrdersListControls: React.FC<Props> = ({
  filters,
  supplierOptions,
  filterDrawerOpen,
  onFilterDrawerOpenChange,
  searchInputRef,
  onFiltersChange,
  onCreate,
}) => {
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [draft, setDraft] = useState<ModalFilterDraft>(() => modalDraftFromFilters(filters));

  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  useEffect(() => {
    if (filterDrawerOpen) {
      setDraft(modalDraftFromFilters(filters));
    }
  }, [filterDrawerOpen, filters]);

  const modalFilterCount = useMemo(() => countModalFilters(filters), [filters]);

  const applySearch = useCallback(() => {
    onFiltersChange({ search: searchDraft.trim() });
  }, [onFiltersChange, searchDraft]);

  const openDrawer = useCallback(() => {
    setDraft(modalDraftFromFilters(filters));
    onFilterDrawerOpenChange(true);
  }, [filters, onFilterDrawerOpenChange]);

  const applyDrawer = useCallback(() => {
    onFiltersChange({
      statuses: draft.statuses.length ? draft.statuses : [...DEFAULT_PO_LIST_STATUSES],
      overdueOnly: draft.overdueOnly,
      supplierId: draft.supplierId,
      dateFrom: draft.dateFrom,
      dateTo: draft.dateTo,
    });
    onFilterDrawerOpenChange(false);
  }, [draft, onFilterDrawerOpenChange, onFiltersChange]);

  const clearDrawer = useCallback(() => {
    setDraft(DEFAULT_MODAL_DRAFT);
    onFiltersChange(DEFAULT_MODAL_DRAFT);
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
            placeholder="Search PO or supplier · /"
            aria-label="Search purchase orders"
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applySearch();
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setSearchDraft('');
                onFiltersChange({ search: '' });
                searchInputRef.current?.blur();
              }
            }}
            onBlur={applySearch}
          />
          {searchDraft ? (
            <button
              type="button"
              className="po-orders-header-controls__search-clear"
              aria-label="Clear search"
              onClick={() => {
                setSearchDraft('');
                onFiltersChange({ search: '' });
              }}
            >
              ×
            </button>
          ) : null}
        </div>

        <div className="po-orders-header-controls__filter-btn">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label="Filter purchase orders"
            title="Filter (Ctrl+Shift+F)"
            onClick={openDrawer}
          >
            <FilterIcon />
          </Button>
          {modalFilterCount > 0 ? (
            <span className="po-orders-header-controls__filter-badge" aria-hidden>
              {modalFilterCount}
            </span>
          ) : null}
        </div>

        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={onCreate}
          title="Create order (Ctrl+Shift+Enter)"
        >
          + Create order
        </Button>
      </div>

      <SideDrawer
        isOpen={filterDrawerOpen}
        onClose={() => onFilterDrawerOpenChange(false)}
        title="Filter purchase orders"
        width="420px"
      >
        <div className="po-orders-filter-drawer__section">
          <span className="po-orders-filter-drawer__label">Status</span>
          <p className="po-orders-filter-drawer__hint">Select one or more</p>
          <div className="po-orders-filter-drawer__chips" role="group" aria-label="Status">
            {PO_LIST_STATUS_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={`po-orders-filter-drawer__chip${
                  draft.statuses.includes(chip.id) ? ' po-orders-filter-drawer__chip--active' : ''
                }`}
                aria-pressed={draft.statuses.includes(chip.id)}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    statuses: togglePoListStatus(prev.statuses, chip.id),
                  }))
                }
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        <div className="po-orders-filter-drawer__section">
          <label className="po-orders-filter-drawer__check">
            <input
              type="checkbox"
              checked={draft.overdueOnly}
              onChange={(e) => setDraft((prev) => ({ ...prev, overdueOnly: e.target.checked }))}
            />
            Overdue delivery only
          </label>
        </div>

        <div className="po-orders-filter-drawer__section">
          <Select
            label="Supplier"
            value={draft.supplierId}
            onChange={(e) => setDraft((prev) => ({ ...prev, supplierId: e.target.value }))}
          >
            <option value="">All suppliers</option>
            {supplierOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="po-orders-filter-drawer__section">
          <span className="po-orders-filter-drawer__label">Order date</span>
          <div className="po-orders-filter-drawer__dates">
            <Input
              label="From"
              type="date"
              value={draft.dateFrom}
              onChange={(e) => setDraft((prev) => ({ ...prev, dateFrom: e.target.value }))}
            />
            <Input
              label="To"
              type="date"
              value={draft.dateTo}
              onChange={(e) => setDraft((prev) => ({ ...prev, dateTo: e.target.value }))}
            />
          </div>
          <div className="po-orders-filter-drawer__presets">
            {(['today', 'week', 'month'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                className="po-orders-filter-drawer__preset"
                onClick={() => setDraft((prev) => ({ ...prev, ...orderDatePresetRange(preset) }))}
              >
                {preset === 'today' ? 'Today' : preset === 'week' ? 'This week' : 'This month'}
              </button>
            ))}
          </div>
        </div>

        <div className="po-orders-filter-drawer__footer">
          <Button type="button" variant="secondary" onClick={clearDrawer}>
            Reset filters
          </Button>
          <Button type="button" variant="primary" onClick={applyDrawer}>
            Apply
          </Button>
        </div>
      </SideDrawer>
    </>
  );
};
