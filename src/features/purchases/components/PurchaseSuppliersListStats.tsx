import React from 'react';
import type { PurchaseSupplierListStats } from '@/services/purchase.service';
import { formatInr } from '../utils/supplierDirectory';
import {
  isPartialPayablesFilter,
  isPendingPayablesFilter,
  type PurchaseSupplierListFilters,
} from '../utils/purchaseSupplierListFilters';
import '@/features/sales/components/panels/SalesHistoryPanel.css';

type Props = {
  stats: PurchaseSupplierListStats;
  statsLoading?: boolean;
  filters: PurchaseSupplierListFilters;
  onStatClick: (card: 'outstanding' | 'pending' | 'partial') => void;
};

export const PurchaseSuppliersListStats: React.FC<Props> = ({
  stats,
  statsLoading,
  filters,
  onStatClick,
}) => {
  const pendingActive = isPendingPayablesFilter(filters);
  const partialActive = isPartialPayablesFilter(filters);

  return (
    <div className="sales-history-stats po-list-stats">
      <button
        type="button"
        className={`sales-history-stat sales-history-stat--blue${pendingActive ? ' po-list-stats__card--active' : ''}`}
        onClick={() => onStatClick('outstanding')}
      >
        <div className="sales-history-stat__label">Total outstanding</div>
        <div className="sales-history-stat__value">
          {statsLoading ? '…' : formatInr(stats.totalOutstanding)}
        </div>
        <div className="sales-history-stat__ctx">Tap to filter pending payables</div>
      </button>

      <button
        type="button"
        className={`sales-history-stat sales-history-stat--amber${pendingActive ? ' po-list-stats__card--active' : ''}`}
        onClick={() => onStatClick('pending')}
      >
        <div className="sales-history-stat__label">Suppliers with pending</div>
        <div className="sales-history-stat__value">{statsLoading ? '…' : stats.suppliersWithPending}</div>
        <div className="sales-history-stat__ctx">Tap again to show all</div>
      </button>

      <button
        type="button"
        className={`sales-history-stat${partialActive ? ' po-list-stats__card--active' : ''}`}
        onClick={() => onStatClick('partial')}
      >
        <div className="sales-history-stat__label">Partial payables</div>
        <div className="sales-history-stat__value">
          {statsLoading ? '…' : stats.suppliersWithPartial}
        </div>
        <div className="sales-history-stat__ctx">Suppliers with partial bills</div>
      </button>
    </div>
  );
};
