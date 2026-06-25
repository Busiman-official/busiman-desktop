import React, { useEffect, useMemo, useRef } from 'react';
import { Button } from '@/shared/components/ui';
import { EmptyState } from '@/shared/components/data-display';
import { type PurchaseOrder, type PurchaseOrderListStats } from '@/services/purchase.service';
import { formatInr, purchaseOrderGrandTotal } from '../utils/supplierDirectory';
import { isReceivablePurchaseOrder } from '../utils/receivablePurchaseOrders';
import {
  buildActiveFilterChips,
  DEFAULT_PO_LIST_STATUSES,
  filtersForStatCard,
  hasActiveListFilters,
  purchaseOrderStatusLabel,
  type PoListStatCard,
  type PurchaseOrderListFilters,
} from '../utils/purchaseOrderListFilters';
import { PurchaseOrdersListStats } from './PurchaseOrdersListStats';
import './PurchaseOrdersListPanel.css';

type Props = {
  rows: PurchaseOrder[];
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  stats: PurchaseOrderListStats;
  statsLoading?: boolean;
  filters: PurchaseOrderListFilters;
  supplierOptions: Array<{ id: string; name: string }>;
  onFiltersChange: (patch: Partial<PurchaseOrderListFilters>) => void;
  onPageChange: (page: number) => void;
  onCreate: () => void;
  onOpenOrder: (orderId: string) => void;
  onReceiveOrder?: (order: PurchaseOrder) => void;
  highlightedRowIndex: number;
  onHighlightedRowIndexChange: (index: number) => void;
};

function formatShortDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function receivePercent(order: PurchaseOrder): number {
  const ordered = Math.max(0, order.totalOrderedQty);
  if (ordered <= 0) return 0;
  return Math.min(100, Math.round((order.totalReceivedQty / ordered) * 100));
}

export const PurchaseOrdersListPanel: React.FC<Props> = ({
  rows,
  total,
  page,
  pageSize,
  loading,
  stats,
  statsLoading,
  filters,
  supplierOptions,
  onFiltersChange,
  onPageChange,
  onCreate,
  onOpenOrder,
  onReceiveOrder,
  highlightedRowIndex,
  onHighlightedRowIndexChange,
}) => {
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);

  const supplierName = useMemo(
    () => supplierOptions.find((s) => s.id === filters.supplierId)?.name,
    [filters.supplierId, supplierOptions]
  );
  const activeChips = useMemo(
    () => buildActiveFilterChips(filters, supplierName),
    [filters, supplierName]
  );
  const showActiveStrip = hasActiveListFilters(filters);

  const clearAllFilters = () => {
    onFiltersChange({
      search: '',
      statuses: [...DEFAULT_PO_LIST_STATUSES],
      overdueOnly: false,
      supplierId: '',
      dateFrom: '',
      dateTo: '',
    });
  };

  const handleStatClick = (card: PoListStatCard) => {
    onFiltersChange(filtersForStatCard(card));
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
      <PurchaseOrdersListStats
        stats={stats}
        statsLoading={statsLoading}
        filters={filters}
        onStatClick={handleStatClick}
      />
      {showActiveStrip ? (
        <div className="po-list__active">
          <span className="po-list__active-label">Active filters</span>
          {activeChips.map((chip) => (
            <span key={chip.key} className="po-list__active-chip">
              {chip.label}
            </span>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={clearAllFilters}>
            Clear all
          </Button>
        </div>
      ) : null}

      <div className="po-list__card">
        {loading ? (
          <div className="po-list__loading">Loading purchase orders…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={showActiveStrip ? 'No orders match your filters' : 'No purchase orders yet'}
            message={
              showActiveStrip
                ? 'Try different filters or clear them.'
                : 'Create a purchase order to plan supplier purchases.'
            }
            action={
              showActiveStrip ? (
                <Button variant="secondary" onClick={clearAllFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" onClick={onCreate}>
                  Create first order
                </Button>
              )
            }
          />
        ) : (
          <div className="po-list__table-wrap" ref={tableWrapRef}>
            <table className="po-list__table">
              <thead>
                <tr>
                  {['PO', 'Supplier', 'Order date', 'Expected', 'Progress', 'Amount', 'Status', 'Actions'].map(
                    (h) => (
                      <th key={h}>{h}</th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => {
                  const pct = receivePercent(row);
                  const canReceive = isReceivablePurchaseOrder(row);
                  const amount = purchaseOrderGrandTotal(row);
                  const showProgress =
                    row.status !== 'draft' && row.status !== 'cancelled';
                  const highlighted = rowIndex === highlightedRowIndex;

                  return (
                    <tr
                      key={row.id}
                      data-list-row-index={rowIndex}
                      className={`po-list__row${highlighted ? ' po-list__row--highlighted' : ''}`}
                      onMouseEnter={() => onHighlightedRowIndexChange(rowIndex)}
                      onClick={() => onHighlightedRowIndexChange(rowIndex)}
                    >
                      <td>
                        <div className="po-list__po-num">{row.poNumber}</div>
                        <div className="po-list__po-meta">
                          {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
                          {row.priority === 'urgent' ? (
                            <span className="po-list__urgent"> · Urgent</span>
                          ) : null}
                        </div>
                      </td>
                      <td>{row.supplierName}</td>
                      <td>{formatShortDate(row.orderDate)}</td>
                      <td>{formatShortDate(row.expectedDeliveryDate)}</td>
                      <td>
                        {!showProgress ? (
                          <span className="po-list__progress-label">—</span>
                        ) : (
                          <>
                            <div className="po-list__progress-bar" aria-hidden>
                              <div className="po-list__progress-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="po-list__progress-label">
                              {row.totalReceivedQty} / {row.totalOrderedQty} ({pct}%)
                            </span>
                          </>
                        )}
                      </td>
                      <td className="po-list__amount">{formatInr(amount)}</td>
                      <td>
                        <span className={`po-list__pill po-list__pill--${row.status}`}>
                          {purchaseOrderStatusLabel(row.status)}
                        </span>
                      </td>
                      <td>
                        <div className="po-list__actions">
                          <Button type="button" size="sm" variant="secondary" onClick={() => onOpenOrder(row.id)}>
                            Open
                          </Button>
                          {canReceive && onReceiveOrder ? (
                            <Button type="button" size="sm" variant="primary" onClick={() => onReceiveOrder(row)}>
                              Receive
                            </Button>
                          ) : null}
                        </div>
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
          <span className="po-list__kbd-hint">
            ↑↓ move · Enter open · R receive · 1–3 filters · / search · Ctrl+Shift+Enter new PO
          </span>
          <div className="po-list__foot-pages">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              Previous
            </Button>
            <span className="po-list__foot-meta">
              Page {page} of {pages}
            </span>
            <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
};
