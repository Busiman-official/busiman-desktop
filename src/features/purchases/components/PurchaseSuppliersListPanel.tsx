import React, { useEffect, useMemo, useRef } from 'react';
import { Button } from '@/shared/components/ui';
import { EmptyState } from '@/shared/components/data-display';
import {
  type PurchaseSupplierListStats,
  type PurchaseSupplierSummary,
  type SupplierPayableStatus,
} from '@/services/purchase.service';
import { formatInr } from '../utils/supplierDirectory';
import {
  DEFAULT_SUPPLIER_LIST_FILTERS,
  applySupplierStatCard,
  hasActiveSupplierListFilters,
  isPartialPayablesFilter,
  isPendingPayablesFilter,
  togglePartialPayablesFilter,
  togglePendingPayablesFilter,
  type PurchaseSupplierListFilters,
  type SupplierListStatCard,
} from '../utils/purchaseSupplierListFilters';
import { PurchaseSuppliersListStats } from './PurchaseSuppliersListStats';
import './PurchaseOrdersListPanel.css';

type Props = {
  rows: PurchaseSupplierSummary[];
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  stats: PurchaseSupplierListStats;
  statsLoading?: boolean;
  filters: PurchaseSupplierListFilters;
  onFiltersChange: (patch: Partial<PurchaseSupplierListFilters>) => void;
  onPageChange: (page: number) => void;
  onOpenSupplier: (supplierId: string) => void;
  highlightedRowIndex: number;
  onHighlightedRowIndexChange: (index: number) => void;
};

function formatShortDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusLabel(status: SupplierPayableStatus): string {
  if (status === 'pending') return 'Pending';
  if (status === 'po_only') return 'PO only';
  return 'Clear';
}

function statusClass(status: SupplierPayableStatus): string {
  if (status === 'pending') return 'po-list__status-chip--pending';
  if (status === 'po_only') return 'po-list__status-chip--po-only';
  return 'po-list__status-chip--clear';
}

export const PurchaseSuppliersListPanel: React.FC<Props> = ({
  rows,
  total,
  page,
  pageSize,
  loading,
  stats,
  statsLoading,
  filters,
  onFiltersChange,
  onPageChange,
  onOpenSupplier,
  highlightedRowIndex,
  onHighlightedRowIndexChange,
}) => {
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);
  const showActiveStrip = hasActiveSupplierListFilters(filters);

  const clearAllFilters = () => {
    onFiltersChange({
      search: '',
      payablesFilter: DEFAULT_SUPPLIER_LIST_FILTERS.payablesFilter,
      sort: DEFAULT_SUPPLIER_LIST_FILTERS.sort,
    });
  };

  const handleStatClick = (card: SupplierListStatCard) => {
    onFiltersChange(applySupplierStatCard(filters, card));
  };

  useEffect(() => {
    if (highlightedRowIndex < 0 || !tableWrapRef.current) return;
    const el = tableWrapRef.current.querySelector<HTMLElement>(
      `[data-list-row-index="${highlightedRowIndex}"]`
    );
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightedRowIndex, rows.length]);

  return (
    <section className="po-list">
      <PurchaseSuppliersListStats
        stats={stats}
        statsLoading={statsLoading}
        filters={filters}
        onStatClick={handleStatClick}
      />

      {showActiveStrip ? (
        <div className="po-list__active">
          <span className="po-list__active-label">Active filters</span>
          {filters.search ? (
            <span className="po-list__active-chip">Search: {filters.search}</span>
          ) : null}
          {filters.payablesFilter === 'pending' ? (
            <button
              type="button"
              className="po-list__active-chip po-list__active-chip--toggle"
              onClick={() => onFiltersChange(togglePendingPayablesFilter(filters))}
            >
              Payments pending ×
            </button>
          ) : null}
          {filters.payablesFilter === 'partial' ? (
            <button
              type="button"
              className="po-list__active-chip po-list__active-chip--toggle"
              onClick={() => onFiltersChange(togglePartialPayablesFilter(filters))}
            >
              Partially paid ×
            </button>
          ) : null}
          <Button type="button" size="sm" variant="secondary" onClick={clearAllFilters}>
            Clear all
          </Button>
        </div>
      ) : null}

      <div className="po-list__card">
        {loading ? (
          <div style={{ padding: 24, color: '#64748b' }}>Loading suppliers…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No suppliers found"
            message={
              isPendingPayablesFilter(filters) || isPartialPayablesFilter(filters)
                ? 'No suppliers match your filters.'
                : 'Create a supplier or add a purchase order to get started.'
            }
          />
        ) : (
          <div className="po-list__table-wrap" ref={tableWrapRef}>
            <table className="po-list__table">
              <thead>
                <tr>
                  {['Supplier', 'GSTIN', 'Status', 'Outstanding', 'Open bills', 'Last receipt'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => {
                  const highlighted = rowIndex === highlightedRowIndex;
                  return (
                    <tr
                      key={row.supplierId}
                      data-list-row-index={rowIndex}
                      className={`po-list__row${highlighted ? ' po-list__row--highlighted' : ''}${row.payableStatus === 'pending' ? ' po-list__row--due' : ''}`}
                      onMouseEnter={() => onHighlightedRowIndexChange(rowIndex)}
                      onClick={() => {
                        onHighlightedRowIndexChange(rowIndex);
                        onOpenSupplier(row.supplierId);
                      }}
                    >
                      <td>
                        <strong>{row.supplierName}</strong>
                        <div style={{ color: '#64748b', fontSize: 12 }}>{row.supplierId}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>{row.gstin || '—'}</td>
                      <td>
                        <span className={`po-list__status-chip ${statusClass(row.payableStatus)}`}>
                          {statusLabel(row.payableStatus)}
                        </span>
                      </td>
                      <td className="po-list__amount">{formatInr(row.outstanding)}</td>
                      <td>{row.openBillCount}</td>
                      <td>{formatShortDate(row.lastReceiptDate)}</td>
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
          <span className="po-list__kbd-hint">
            ↑↓ move · Enter open · 1–3 filters · / search · Ctrl+Shift+F filter
          </span>
          <div className="po-list__foot-pages">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Prev
            </Button>
            <span className="po-list__foot-meta">
              Page {page} / {pages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={page >= pages}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
};
