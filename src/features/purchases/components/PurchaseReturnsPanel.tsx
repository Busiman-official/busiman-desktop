/**
 * Purchase returns (RTV) panel — stats, list, wizard and detail.
 * Search + filter controls live in the module header (or inline when embedded).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/shared/components/ui';
import { EmptyState } from '@/shared/components/data-display';
import {
  purchaseService,
  type PurchaseReturn,
  type PurchaseReturnStats,
} from '@/services/purchase.service';
import { formatInr } from '../utils/supplierDirectory';
import {
  EMPTY_RETURN_LIST_FILTERS,
  formatReturnDate,
  hasActiveReturnFilters,
  returnStatusClass,
  returnStatusLabel,
  settlementFollowUp,
  settlementLabel,
  type PurchaseReturnListFilters,
} from '../utils/purchaseReturnDisplay';
import { usePurchaseReturnsListKeyboard } from '../hooks/usePurchaseReturnsListKeyboard';
import { PurchaseReturnsListControls } from './PurchaseReturnsListControls';
import { NewPurchaseReturnModal } from './NewPurchaseReturnModal';
import { PurchaseReturnDetailModal } from './PurchaseReturnDetailModal';
import './PurchaseOrdersListPanel.css';
import './PurchaseReturns.css';

const EMPTY_STATS: PurchaseReturnStats = {
  monthCount: 0,
  monthValue: 0,
  draftCount: 0,
  creditPendingCount: 0,
  creditPendingValue: 0,
  refundDueValue: 0,
  replacementPendingCount: 0,
};

type Props = {
  branchId?: string | null;
  supplierId?: string;
  initialBillId?: string | null;
  onInitialBillConsumed?: () => void;
  onChanged?: () => void;
  onModalOpenChange?: (open: boolean) => void;
  /** When true, controls render in the Purchases module header (parent passes filter props). */
  hideControls?: boolean;
  filters?: PurchaseReturnListFilters;
  onFiltersChange?: (patch: Partial<PurchaseReturnListFilters>) => void;
  filterDrawerOpen?: boolean;
  onFilterDrawerOpenChange?: (open: boolean) => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  highlightedRowIndex?: number;
  onHighlightedRowIndexChange?: (index: number) => void;
  wizardOpen?: boolean;
  onWizardOpenChange?: (open: boolean) => void;
};

export const PurchaseReturnsPanel: React.FC<Props> = ({
  branchId,
  supplierId,
  initialBillId,
  onInitialBillConsumed,
  onChanged,
  onModalOpenChange,
  hideControls = false,
  filters: filtersProp,
  onFiltersChange: onFiltersChangeProp,
  filterDrawerOpen: filterDrawerOpenProp,
  onFilterDrawerOpenChange: onFilterDrawerOpenChangeProp,
  searchInputRef: searchInputRefProp,
  highlightedRowIndex: highlightedRowIndexProp,
  onHighlightedRowIndexChange: onHighlightedRowIndexChangeProp,
  wizardOpen: wizardOpenProp,
  onWizardOpenChange: onWizardOpenChangeProp,
}) => {
  const embedded = !hideControls;

  const [internalFilters, setInternalFilters] = useState<PurchaseReturnListFilters>(EMPTY_RETURN_LIST_FILTERS);
  const [internalFilterDrawerOpen, setInternalFilterDrawerOpen] = useState(false);
  const internalSearchRef = useRef<HTMLInputElement>(null);
  const [internalHighlightedIndex, setInternalHighlightedIndex] = useState(0);
  const [internalWizardOpen, setInternalWizardOpen] = useState(false);

  const filters = filtersProp ?? internalFilters;
  const onFiltersChange =
    onFiltersChangeProp ??
    ((patch: Partial<PurchaseReturnListFilters>) => {
      setInternalFilters((prev) => ({ ...prev, ...patch }));
      setPage(1);
      setInternalHighlightedIndex(0);
    });
  const filterDrawerOpen = filterDrawerOpenProp ?? internalFilterDrawerOpen;
  const onFilterDrawerOpenChange = onFilterDrawerOpenChangeProp ?? setInternalFilterDrawerOpen;
  const searchInputRef = searchInputRefProp ?? internalSearchRef;
  const highlightedIndex = highlightedRowIndexProp ?? internalHighlightedIndex;
  const onHighlightedRowIndexChange = onHighlightedRowIndexChangeProp ?? setInternalHighlightedIndex;
  const wizardOpen = wizardOpenProp ?? internalWizardOpen;
  const setWizardOpen = onWizardOpenChangeProp ?? setInternalWizardOpen;

  const [rows, setRows] = useState<PurchaseReturn[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PurchaseReturnStats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(false);
  const [wizardBillId, setWizardBillId] = useState<string | null>(null);
  const [detailReturn, setDetailReturn] = useState<PurchaseReturn | null>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setStatsLoading(true);
    setError(null);
    try {
      const [data, statsData] = await Promise.all([
        purchaseService.listReturns(
          {
            page,
            pageSize,
            supplierId,
            search: filters.search || undefined,
            status: filters.status,
            settlementType: filters.settlementType,
            pendingSettlementOnly: filters.pendingSettlementOnly,
          },
          branchId
        ),
        purchaseService.getReturnStats({ supplierId }, branchId),
      ]);
      setRows(data.rows);
      setTotal(data.total);
      setStats(statsData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load purchase returns');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
      setStatsLoading(false);
    }
  }, [branchId, filters, page, supplierId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!initialBillId) return;
    setWizardBillId(initialBillId);
    setWizardOpen(true);
    onInitialBillConsumed?.();
  }, [initialBillId, onInitialBillConsumed, setWizardOpen]);

  useEffect(() => {
    if (highlightedIndex < 0 || !tableWrapRef.current) return;
    const el = tableWrapRef.current.querySelector<HTMLElement>(`[data-list-row-index="${highlightedIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, rows.length]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);

  const patchFilters = useCallback(
    (patch: Partial<PurchaseReturnListFilters>) => {
      onFiltersChange(patch);
      setPage(1);
      onHighlightedRowIndexChange(0);
    },
    [onFiltersChange, onHighlightedRowIndexChange]
  );

  const clearFilters = useCallback(() => {
    onFiltersChange({ ...EMPTY_RETURN_LIST_FILTERS });
    setPage(1);
    onHighlightedRowIndexChange(0);
  }, [onFiltersChange, onHighlightedRowIndexChange]);

  const openNewReturn = useCallback(() => {
    setWizardBillId(null);
    setWizardOpen(true);
  }, [setWizardOpen]);

  const handleChanged = useCallback(() => {
    void load();
    onChanged?.();
  }, [load, onChanged]);

  const modalOpen = wizardOpen || Boolean(detailReturn);

  useEffect(() => {
    onModalOpenChange?.(modalOpen);
  }, [modalOpen, onModalOpenChange]);

  const handleReturnPageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
    onHighlightedRowIndexChange(0);
  }, [onHighlightedRowIndexChange]);

  usePurchaseReturnsListKeyboard({
    enabled: !modalOpen,
    rows,
    page,
    pageCount: pages,
    filterDrawerOpen,
    onFilterDrawerOpenChange,
    searchInputRef,
    onFiltersChange: patchFilters,
    onClearAllFilters: clearFilters,
    onCreate: openNewReturn,
    onOpenReturn: (id) => {
      const row = rows.find((r) => r.id === id);
      if (row) setDetailReturn(row);
    },
    onPageChange: handleReturnPageChange,
    highlightedRowIndex: highlightedIndex,
    onHighlightedRowIndexChange,
  });

  const showSupplierCol = !supplierId;
  const columns = [
    ...(showSupplierCol ? ['Supplier'] : []),
    'Date',
    'Items',
    'Qty',
    'Amount',
    'Settlement',
    'Status',
    'Follow-up',
    '',
  ];

  return (
    <section className="po-list pr-panel">
      {embedded ? (
        <div className="pr-panel__embedded-controls">
          <PurchaseReturnsListControls
            filters={filters}
            filterDrawerOpen={filterDrawerOpen}
            onFilterDrawerOpenChange={onFilterDrawerOpenChange}
            searchInputRef={searchInputRef}
            onFiltersChange={patchFilters}
            onCreate={openNewReturn}
          />
        </div>
      ) : null}

      <div className="sales-history-stats po-list-stats">
        <div className="sales-history-stat sales-history-stat--blue">
          <div className="sales-history-stat__label">Returned this month</div>
          <div className="sales-history-stat__value">{statsLoading ? '…' : formatInr(stats.monthValue)}</div>
          <div className="sales-history-stat__ctx">
            {statsLoading ? '' : `${stats.monthCount} return${stats.monthCount === 1 ? '' : 's'} completed`}
          </div>
        </div>
        <button
          type="button"
          className={`sales-history-stat sales-history-stat--amber${filters.settlementType === 'credit' && filters.pendingSettlementOnly ? ' po-list-stats__card--active' : ''}`}
          onClick={() =>
            patchFilters(
              filters.settlementType === 'credit' && filters.pendingSettlementOnly
                ? { settlementType: '', pendingSettlementOnly: false }
                : { settlementType: 'credit', pendingSettlementOnly: true, status: '' }
            )
          }
        >
          <div className="sales-history-stat__label">Credits awaiting debit note</div>
          <div className="sales-history-stat__value">{statsLoading ? '…' : formatInr(stats.creditPendingValue)}</div>
          <div className="sales-history-stat__ctx">
            {statsLoading ? '' : `${stats.creditPendingCount} return${stats.creditPendingCount === 1 ? '' : 's'} · tap to filter`}
          </div>
        </button>
        <button
          type="button"
          className={`sales-history-stat${filters.settlementType === 'refund' && filters.pendingSettlementOnly ? ' po-list-stats__card--active' : ''}`}
          onClick={() =>
            patchFilters(
              filters.settlementType === 'refund' && filters.pendingSettlementOnly
                ? { settlementType: '', pendingSettlementOnly: false }
                : { settlementType: 'refund', pendingSettlementOnly: true, status: '' }
            )
          }
        >
          <div className="sales-history-stat__label">Refunds due from suppliers</div>
          <div className="sales-history-stat__value">{statsLoading ? '…' : formatInr(stats.refundDueValue)}</div>
          <div className="sales-history-stat__ctx">Tap to filter pending refunds</div>
        </button>
        <button
          type="button"
          className={`sales-history-stat${filters.settlementType === 'replacement' && filters.pendingSettlementOnly ? ' po-list-stats__card--active' : ''}`}
          onClick={() =>
            patchFilters(
              filters.settlementType === 'replacement' && filters.pendingSettlementOnly
                ? { settlementType: '', pendingSettlementOnly: false }
                : { settlementType: 'replacement', pendingSettlementOnly: true, status: '' }
            )
          }
        >
          <div className="sales-history-stat__label">Replacements pending</div>
          <div className="sales-history-stat__value">{statsLoading ? '…' : stats.replacementPendingCount}</div>
          <div className="sales-history-stat__ctx">Goods owed back by suppliers</div>
        </button>
      </div>

      {error ? <div className="pr-panel__error">{error}</div> : null}

      {hasActiveReturnFilters(filters) ? (
        <div className="po-list__active">
          <span className="po-list__active-label">Active filters</span>
          {filters.search ? <span className="po-list__active-chip">Search: {filters.search}</span> : null}
          {filters.status ? <span className="po-list__active-chip">Status: {returnStatusLabel(filters.status)}</span> : null}
          {filters.settlementType ? (
            <span className="po-list__active-chip">Settlement: {settlementLabel(filters.settlementType)}</span>
          ) : null}
          {filters.pendingSettlementOnly ? <span className="po-list__active-chip">Pending settlement</span> : null}
          <Button type="button" size="sm" variant="secondary" onClick={clearFilters}>
            Clear all
          </Button>
        </div>
      ) : null}

      <div className="po-list__card">
        {loading ? (
          <div style={{ padding: 24, color: '#64748b' }}>Loading returns…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No returns found"
            message={
              hasActiveReturnFilters(filters)
                ? 'No returns match your filters.'
                : 'When you send goods back to a supplier, record the return here so stock and money stay accurate.'
            }
            action={<Button type="button" variant="primary" onClick={openNewReturn}>+ New return</Button>}
          />
        ) : (
          <div className="po-list__table-wrap" ref={tableWrapRef}>
            <table className="po-list__table">
              <thead>
                <tr>
                  {columns.map((h, i) => (
                    <th key={`${h}-${i}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => {
                  const highlighted = rowIndex === highlightedIndex;
                  const followUp = settlementFollowUp(row);
                  const itemsPreview = row.lines
                    .slice(0, 2)
                    .map((l) => l.variantName || l.itemName)
                    .join(', ');
                  const extra = row.lines.length - 2;
                  return (
                    <tr
                      key={row.id}
                      data-list-row-index={rowIndex}
                      className={`po-list__row${highlighted ? ' po-list__row--highlighted' : ''}${followUp ? ' po-list__row--due' : ''}`}
                      onMouseEnter={() => onHighlightedRowIndexChange(rowIndex)}
                      onClick={() => {
                        onHighlightedRowIndexChange(rowIndex);
                        setDetailReturn(row);
                      }}
                    >
                      {showSupplierCol ? (
                        <td>
                          <strong>{row.supplierName}</strong>
                          <div style={{ color: '#64748b', fontSize: 12 }}>{row.supplierId}</div>
                        </td>
                      ) : null}
                      <td>{formatReturnDate(row.returnDate || row.createdAt)}</td>
                      <td>
                        {itemsPreview || '—'}
                        {extra > 0 ? <span style={{ color: '#64748b' }}> +{extra} more</span> : null}
                      </td>
                      <td>{row.totalQuantity}</td>
                      <td className="po-list__amount">{formatInr(row.totalAmount)}</td>
                      <td>{settlementLabel(row.settlementType)}</td>
                      <td>
                        <span className={`po-list__status-chip ${returnStatusClass(row.status)}`}>
                          {returnStatusLabel(row.status)}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: followUp ? '#b45309' : '#64748b' }}>{followUp || '—'}</td>
                      <td>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailReturn(row);
                          }}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && total > 0 ? (
        <div className="po-list__foot">
          <span className="po-list__foot-meta">
            Showing {showingFrom}–{showingTo} of {total}
          </span>
          <span className="po-list__kbd-hint">↑↓ move · Enter open · N new return · / search · Ctrl+Shift+F filter</span>
          <div className="po-list__foot-pages">
            <Button type="button" size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </Button>
            <span className="po-list__foot-meta">
              Page {page} / {pages}
            </span>
            <Button type="button" size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <NewPurchaseReturnModal
        open={wizardOpen}
        branchId={branchId}
        supplierId={supplierId}
        initialBillId={wizardBillId}
        onClose={() => {
          setWizardOpen(false);
          setWizardBillId(null);
        }}
        onSuccess={(ret) => {
          setWizardOpen(false);
          setWizardBillId(null);
          handleChanged();
          setDetailReturn(ret);
        }}
      />

      <PurchaseReturnDetailModal
        branchId={branchId}
        ret={detailReturn}
        onClose={() => setDetailReturn(null)}
        onChanged={(updated) => {
          setDetailReturn(updated);
          handleChanged();
        }}
      />
    </section>
  );
};
