import React from 'react';
import { Button } from '@/shared/components/ui';
import { type PurchaseOrder } from '@/services/purchase.service';

type Props = {
  order: PurchaseOrder;
  loading?: boolean;
  onBack: () => void;
  onCancelOrder: () => void;
};

export const PurchaseOrderDetailPage: React.FC<Props> = ({ order, loading, onBack, onCancelOrder }) => {
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 12,
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div>
          <h2 style={{ margin: 0, color: '#0f172a', fontSize: 20 }}>{order.poNumber}</h2>
          <p style={{ margin: '4px 0 0 0', color: '#64748b' }}>
            {order.supplierName} · {new Date(order.orderDate).toLocaleDateString()} · Status: {order.status}
          </p>
          {order.expectedDeliveryDate ? (
            <p style={{ margin: '4px 0 0 0', color: '#64748b' }}>
              Expected delivery: {new Date(order.expectedDeliveryDate).toLocaleDateString()}
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button variant="secondary" disabled>
            Receive Goods
          </Button>
          <Button variant="secondary" disabled>
            Create Invoice
          </Button>
          <Button
            variant="secondary"
            onClick={onCancelOrder}
            disabled={loading || order.status === 'cancelled' || order.status === 'completed' || order.totalReceivedQty > 0}
          >
            Cancel Order
          </Button>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
              {['Item', 'Ordered', 'Received', 'Pending', 'Unit', 'Expected Price'].map((h) => (
                <th key={h} style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 12px' }}>
                  <strong>{line.itemName}</strong> - {line.variantName}
                  <div style={{ color: '#64748b', fontSize: 12 }}>{line.variantCode}</div>
                </td>
                <td style={{ padding: '10px 12px' }}>{line.quantityOrdered}</td>
                <td style={{ padding: '10px 12px' }}>{line.quantityReceived}</td>
                <td style={{ padding: '10px 12px' }}>{line.pendingQty}</td>
                <td style={{ padding: '10px 12px' }}>{line.unitId || '—'}</td>
                <td style={{ padding: '10px 12px' }}>{line.expectedPrice != null ? `₹${line.expectedPrice.toFixed(2)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
