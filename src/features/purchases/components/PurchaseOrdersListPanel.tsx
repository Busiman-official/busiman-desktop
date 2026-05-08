import React, { useMemo, useState } from 'react';
import { Button, Input, Select } from '@/shared/components/ui';
import { type PurchaseOrder, type PurchaseOrderStatus } from '@/services/purchase.service';

type Props = {
  rows: PurchaseOrder[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    search: string;
    status: PurchaseOrderStatus | '';
    supplierId: string;
    dateFrom: string;
    dateTo: string;
  };
  supplierOptions: Array<{ id: string; name: string }>;
  onFiltersChange: (patch: Partial<Props['filters']>) => void;
  onPageChange: (page: number) => void;
  onCreate: () => void;
  onOpenOrder: (orderId: string) => void;
};

function statusPill(status: PurchaseOrderStatus): React.CSSProperties {
  const map: Record<PurchaseOrderStatus, React.CSSProperties> = {
    draft: { background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1' },
    confirmed: { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
    partial: { background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' },
    completed: { background: '#ecfdf5', color: '#047857', border: '1px solid #bbf7d0' },
    cancelled: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' },
  };
  return map[status];
}

export const PurchaseOrdersListPanel: React.FC<Props> = ({
  rows,
  total,
  page,
  pageSize,
  filters,
  supplierOptions,
  onFiltersChange,
  onPageChange,
  onCreate,
  onOpenOrder,
}) => {
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr auto',
          gap: 8,
          alignItems: 'end',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 12,
        }}
      >
        <Input
          label="Search PO / Supplier"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          onBlur={() => onFiltersChange({ search: searchDraft.trim() })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onFiltersChange({ search: searchDraft.trim() });
          }}
          placeholder="PO-XXXX or supplier"
        />
        <Select
          label="Status"
          value={filters.status}
          onChange={(e) => onFiltersChange({ status: e.target.value as PurchaseOrderStatus | '' })}
        >
          <option value="">All</option>
          <option value="draft">Draft</option>
          <option value="confirmed">Confirmed</option>
          <option value="partial">Partial</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select
          label="Supplier"
          value={filters.supplierId}
          onChange={(e) => onFiltersChange({ supplierId: e.target.value })}
        >
          <option value="">All suppliers</option>
          {supplierOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Input
          label="Date from"
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onFiltersChange({ dateFrom: e.target.value })}
        />
        <Input
          label="Date to"
          type="date"
          value={filters.dateTo}
          onChange={(e) => onFiltersChange({ dateTo: e.target.value })}
        />
        <Button variant="primary" onClick={onCreate}>
          + Create Order
        </Button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
              {['PO Number', 'Supplier', 'Order Date', 'Items', 'Ordered', 'Received', 'Pending', 'Status'].map((h) => (
                <th key={h} style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#334155' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 16, color: '#64748b' }}>
                  No purchase orders found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onOpenOrder(row.id)}
                  style={{ cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0f172a' }}>{row.poNumber}</td>
                  <td style={{ padding: '10px 12px' }}>{row.supplierName}</td>
                  <td style={{ padding: '10px 12px' }}>{new Date(row.orderDate).toLocaleDateString()}</td>
                  <td style={{ padding: '10px 12px' }}>{row.itemCount}</td>
                  <td style={{ padding: '10px 12px' }}>{row.totalOrderedQty}</td>
                  <td style={{ padding: '10px 12px' }}>{row.totalReceivedQty}</td>
                  <td style={{ padding: '10px 12px' }}>{row.totalPendingQty}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ ...statusPill(row.status), borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#64748b', fontSize: 12 }}>
          Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Prev
          </Button>
          <span style={{ alignSelf: 'center', color: '#475569', fontSize: 12 }}>
            Page {page} / {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
            Next
          </Button>
        </div>
      </div>
    </section>
  );
};
