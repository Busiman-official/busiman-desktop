import React from 'react';
import type { PurchaseOrderListStats } from '@/services/purchase.service';
import { formatInr } from '../utils/supplierDirectory';
import {
  hasListScopeFilters,
  isDraftListFilter,
  isOverdueListFilter,
  isReceivableListFilter,
  type PoListStatCard,
  type PurchaseOrderListFilters,
} from '../utils/purchaseOrderListFilters';
import '@/features/sales/components/panels/SalesHistoryPanel.css';

type Props = {
  stats: PurchaseOrderListStats;
  statsLoading?: boolean;
  filters: PurchaseOrderListFilters;
  onStatClick: (card: PoListStatCard) => void;
};

function formatUnits(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

export const PurchaseOrdersListStats: React.FC<Props> = ({
  stats,
  statsLoading,
  filters,
  onStatClick,
}) => {
  const scopeNote = hasListScopeFilters(filters)
    ? 'Scoped to search / supplier / order dates'
    : 'All open purchase activity in branch';

  return (
    <div className="sales-history-stats po-list-stats">
      <button
        type="button"
        className={`sales-history-stat sales-history-stat--blue${isReceivableListFilter(filters) ? ' po-list-stats__card--active' : ''}`}
        onClick={() => onStatClick('receivable')}
      >
        <div className="sales-history-stat__label">To receive</div>
        <div className="sales-history-stat__value">{statsLoading ? '…' : stats.receivablePoCount}</div>
        <div className="sales-history-stat__ctx">
          {statsLoading
            ? scopeNote
            : `${formatUnits(stats.pendingUnits)} units · ${formatInr(stats.pendingValue)} pending`}
        </div>
      </button>

      <button
        type="button"
        className={`sales-history-stat sales-history-stat--amber${isOverdueListFilter(filters) ? ' po-list-stats__card--active' : ''}`}
        onClick={() => onStatClick('overdue')}
      >
        <div className="sales-history-stat__label">Overdue</div>
        <div className="sales-history-stat__value">{statsLoading ? '…' : stats.overduePoCount}</div>
        <div className="sales-history-stat__ctx">
          {statsLoading ? scopeNote : 'Past expected delivery · still pending'}
        </div>
      </button>

      <button
        type="button"
        className={`sales-history-stat${isDraftListFilter(filters) ? ' po-list-stats__card--active' : ''}`}
        onClick={() => onStatClick('draft')}
      >
        <div className="sales-history-stat__label">Draft</div>
        <div className="sales-history-stat__value">{statsLoading ? '…' : stats.draftCount}</div>
        <div className="sales-history-stat__ctx">
          {statsLoading ? scopeNote : 'Need confirm before receive'}
        </div>
      </button>
    </div>
  );
};
