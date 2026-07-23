import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/shared/components/ui';
import { ConfirmDialog } from '@/shared/components/modals/ConfirmDialog';
import { inventoryService, type Location } from '@/services/inventory.service';
import { type PurchaseOrder, type PurchaseOrderLine } from '@/services/purchase.service';
import { isReceivablePurchaseOrder } from '../utils/receivablePurchaseOrders';
import { purchaseOrderStatusLabel } from '../utils/purchaseOrderListFilters';
import {
  PAYMENT_TERM_OPTIONS,
  computePurchaseOrderTotals,
  formatInr,
  pendingPurchaseOrderValue,
} from '../utils/supplierDirectory';
import './PurchaseOrderDetailPage.css';

type DetailTab = 'timeline' | 'notes' | 'attachments';

type Props = {
  order: PurchaseOrder;
  branchId?: string | null;
  loading?: boolean;
  onBack: () => void;
  onConfirmOrder?: () => void;
  onCancelOrder: () => void;
  onReceiveGoods?: () => void;
  onNavbarTrailingChange?: (node: React.ReactNode | null) => void;
};

function formatShortDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function supplierInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

function paymentTermsLabel(order: PurchaseOrder): string {
  const snap = order.supplierContactSnapshot?.defaultPaymentTerms?.trim();
  if (snap) return snap;
  const raw = order.paymentTerms?.trim();
  if (!raw) return '—';
  return PAYMENT_TERM_OPTIONS.find((o) => o.value === raw)?.label || raw;
}

function receivePercent(order: PurchaseOrder): number {
  const ordered = Math.max(0, order.totalOrderedQty);
  if (ordered <= 0) return 0;
  return Math.min(100, Math.round((order.totalReceivedQty / ordered) * 100));
}

function isPoOverdue(order: PurchaseOrder): boolean {
  if (!order.expectedDeliveryDate || order.totalPendingQty <= 0) return false;
  if (order.status === 'completed' || order.status === 'cancelled' || order.status === 'draft') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${order.expectedDeliveryDate}T12:00:00`) < today;
}

function lineRowTotal(line: PurchaseOrderLine): number {
  return computePurchaseOrderTotals({ lines: [line], shippingFreight: 0 }).linesSum;
}

type TimelineEvent = {
  key: string;
  dot: 'blue' | 'green' | 'amber' | 'grey' | 'red';
  title: string;
  desc: string;
  ts: string;
};

function buildTimeline(order: PurchaseOrder): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      key: 'created',
      dot: 'blue',
      title: 'Order created',
      desc: `${order.itemCount} line(s) · ${order.totalOrderedQty} units`,
      ts: formatDateTime(order.createdAt),
    },
  ];
  if (order.status !== 'draft' && order.status !== 'cancelled') {
    events.push({
      key: 'confirmed',
      dot: 'green',
      title: order.submittedToSupplier ? 'Sent to supplier' : 'Order confirmed',
      desc: purchaseOrderStatusLabel(order.status === 'confirmed' ? 'confirmed' : order.status),
      ts: formatDateTime(order.updatedAt),
    });
  }
  if (order.totalReceivedQty > 0) {
    events.push({
      key: 'received',
      dot: 'amber',
      title: order.status === 'completed' ? 'Fully received' : 'Partial receipt',
      desc: `${order.totalReceivedQty} of ${order.totalOrderedQty} units received`,
      ts: formatDateTime(order.updatedAt),
    });
  }
  if (order.status === 'completed') {
    events.push({
      key: 'completed',
      dot: 'green',
      title: 'Order completed',
      desc: 'All units received',
      ts: formatDateTime(order.updatedAt),
    });
  }
  if (order.status === 'cancelled') {
    events.push({
      key: 'cancelled',
      dot: 'red',
      title: 'Order cancelled',
      desc: 'No further receiving allowed',
      ts: formatDateTime(order.updatedAt),
    });
  }
  return events;
}

export const PurchaseOrderDetailPage: React.FC<Props> = ({
  order,
  branchId,
  loading,
  onBack,
  onConfirmOrder,
  onCancelOrder,
  onReceiveGoods,
  onNavbarTrailingChange,
}) => {
  const [tab, setTab] = useState<DetailTab>('timeline');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    if (!branchId) {
      setLocations([]);
      return;
    }
    inventoryService
      .getAllLocations({ branchId, isActive: true })
      .then((rows) => setLocations(rows.filter((l) => l.isActive !== false)))
      .catch(() => setLocations([]));
  }, [branchId]);

  const totals = useMemo(() => computePurchaseOrderTotals(order), [order]);
  const pendingValue = useMemo(() => pendingPurchaseOrderValue(order), [order]);
  const pct = receivePercent(order);
  const overdue = isPoOverdue(order);
  const timeline = useMemo(() => buildTimeline(order), [order]);
  const snap = order.supplierContactSnapshot;

  const locationName = useMemo(() => {
    if (!order.deliveryLocationId) return '—';
    return locations.find((l) => l.id === order.deliveryLocationId)?.name || order.deliveryLocationId;
  }, [locations, order.deliveryLocationId]);

  const canConfirm = order.status === 'draft' && Boolean(onConfirmOrder);
  const canReceive = isReceivablePurchaseOrder(order) && Boolean(onReceiveGoods);
  const canCancel =
    order.status !== 'cancelled' &&
    order.status !== 'completed' &&
    order.totalReceivedQty <= 0;

  const onReceiveGoodsRef = useRef(onReceiveGoods);
  onReceiveGoodsRef.current = onReceiveGoods;

  const navbarTrailing = useMemo(
    () => (
      <div className="po-detail-header-actions">
        {canConfirm ? (
          <Button type="button" variant="primary" disabled={loading} onClick={() => setConfirmOpen(true)}>
            Confirm order
          </Button>
        ) : null}
        {canReceive ? (
          <Button
            type="button"
            variant="primary"
            disabled={loading}
            onClick={() => onReceiveGoodsRef.current?.()}
            title="Receive goods (Ctrl+R)"
          >
            Receive goods
          </Button>
        ) : null}
        <Button type="button" variant="secondary" disabled title="Bills module coming soon">
          Create bill
        </Button>
        {canCancel ? (
          <Button type="button" variant="secondary" disabled={loading} onClick={() => setCancelOpen(true)}>
            Cancel
          </Button>
        ) : null}
      </div>
    ),
    [canCancel, canConfirm, canReceive, loading]
  );

  useEffect(() => {
    if (!onNavbarTrailingChange) return;
    onNavbarTrailingChange(navbarTrailing);
    return () => onNavbarTrailingChange(null);
  }, [navbarTrailing, onNavbarTrailingChange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmOpen) {
          e.preventDefault();
          e.stopPropagation();
          setConfirmOpen(false);
          return;
        }
        if (cancelOpen) {
          e.preventDefault();
          e.stopPropagation();
          setCancelOpen(false);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onBack();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'r') return;
      if (!canReceive || loading || confirmOpen || cancelOpen) return;
      e.preventDefault();
      e.stopPropagation();
      onReceiveGoods?.();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [cancelOpen, canReceive, confirmOpen, loading, onBack, onReceiveGoods]);

  const statusClass = `po-detail__status-pill po-detail__status-pill--${order.status}`;

  return (
    <section className="po-detail">
      {overdue ? (
        <div className="po-detail__banner po-detail__banner--overdue" role="status">
          Overdue — expected {formatShortDate(order.expectedDeliveryDate)} · {order.totalPendingQty} units pending (
          {formatInr(pendingValue)})
        </div>
      ) : null}
      {order.status === 'draft' ? (
        <div className="po-detail__banner po-detail__banner--draft" role="status">
          Draft — confirm this order before receiving goods.
        </div>
      ) : null}
      {order.priority === 'urgent' && order.status !== 'cancelled' && order.status !== 'completed' ? (
        <div className="po-detail__banner po-detail__banner--urgent" role="status">
          Urgent priority — prioritize receiving and supplier follow-up.
        </div>
      ) : null}

      <div className="po-detail__summary">
        <div className="po-detail__summary-cell">
          <div className="po-detail__summary-label">Order value</div>
          <div className="po-detail__summary-value po-detail__summary-value--blue">{formatInr(totals.grandTotal)}</div>
          <div className="po-detail__summary-sub">
            {order.itemCount} line{order.itemCount === 1 ? '' : 's'}
          </div>
        </div>
        <div className="po-detail__summary-cell">
          <div className="po-detail__summary-label">Receive progress</div>
          <div className="po-detail__summary-value">
            {order.totalReceivedQty}/{order.totalOrderedQty}
          </div>
          <div className="po-detail__summary-sub">{pct}% received</div>
          <div className="po-detail__progress" aria-hidden>
            <div className="po-detail__progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="po-detail__summary-cell">
          <div className="po-detail__summary-label">Pending</div>
          <div className="po-detail__summary-value po-detail__summary-value--amber">{order.totalPendingQty}</div>
          <div className="po-detail__summary-sub">
            units · {formatInr(pendingValue)}
          </div>
        </div>
        <div className="po-detail__summary-cell">
          <div className="po-detail__summary-label">Expected delivery</div>
          <div className="po-detail__summary-value" style={{ fontSize: 17 }}>
            {formatShortDate(order.expectedDeliveryDate)}
          </div>
          <div className="po-detail__summary-sub">{locationName}</div>
        </div>
      </div>

      <div className="po-detail__main">
        <div className="po-detail__col">
          <div className="po-detail__card">
            <div className="po-detail__card-hd">
              <span className="po-detail__card-title">Order lines</span>
              <span className={statusClass}>{purchaseOrderStatusLabel(order.status)}</span>
            </div>
            <div className="po-detail__table-wrap">
              <table className="po-detail__table">
                <thead>
                  <tr>
                    {['Item', 'Ordered', 'Received', 'Pending', 'Unit', 'Rate', 'Line total'].map((h) => (
                      <th key={h} className={h === 'Item' ? '' : 'po-detail__num'}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => {
                    const pending = Math.max(0, Number(line.pendingQty) || 0);
                    const rowClass =
                      pending > 0 && order.status !== 'cancelled'
                        ? 'po-detail__row--pending'
                        : pending === 0 && line.quantityReceived > 0
                          ? 'po-detail__row--done'
                          : '';
                    return (
                      <tr key={line.id} className={rowClass}>
                        <td>
                          <div className="po-detail__item-name">{line.itemName}</div>
                          <div className="po-detail__item-meta">
                            {line.variantName} · {line.variantCode}
                          </div>
                        </td>
                        <td className="po-detail__num">{line.quantityOrdered}</td>
                        <td className="po-detail__num">{line.quantityReceived}</td>
                        <td className="po-detail__num">{line.pendingQty}</td>
                        <td>{line.unitId || '—'}</td>
                        <td className="po-detail__num">
                          {line.expectedPrice != null ? formatInr(line.expectedPrice) : '—'}
                        </td>
                        <td className="po-detail__num">{formatInr(lineRowTotal(line))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="po-detail__totals">
              <div className="po-detail__totals-row">
                <span>Subtotal</span>
                <span>{formatInr(totals.subtotal)}</span>
              </div>
              {totals.totalDiscount > 0 ? (
                <div className="po-detail__totals-row">
                  <span>Discount</span>
                  <span>− {formatInr(totals.totalDiscount)}</span>
                </div>
              ) : null}
              {totals.totalTax > 0 ? (
                <div className="po-detail__totals-row">
                  <span>Tax</span>
                  <span>{formatInr(totals.totalTax)}</span>
                </div>
              ) : null}
              {totals.freight > 0 ? (
                <div className="po-detail__totals-row">
                  <span>Shipping / freight</span>
                  <span>{formatInr(totals.freight)}</span>
                </div>
              ) : null}
              <div className="po-detail__totals-row po-detail__totals-row--total">
                <span>Order total</span>
                <span>{formatInr(totals.grandTotal)}</span>
              </div>
            </div>
          </div>

          <div className="po-detail__card">
            <div className="po-detail__tabs" role="tablist" aria-label="Order activity">
              {(
                [
                  ['timeline', 'Timeline'],
                  ['notes', 'Notes'],
                  ['attachments', 'Attachments'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="po-detail__tab-panel" role="tabpanel">
              {tab === 'timeline' ? (
                <div className="po-detail__timeline">
                  {timeline.map((ev) => (
                    <div key={ev.key} className="po-detail__tl-item">
                      <span className={`po-detail__tl-dot po-detail__tl-dot--${ev.dot}`} />
                      <div className="po-detail__tl-title">{ev.title}</div>
                      <div className="po-detail__tl-desc">{ev.desc}</div>
                      <div className="po-detail__tl-ts">{ev.ts}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {tab === 'notes' ? (
                <>
                  {order.supplierMessage?.trim() ? (
                    <div className="po-detail__note">
                      <div className="po-detail__note-label">Supplier message</div>
                      <div className="po-detail__note-body">{order.supplierMessage}</div>
                    </div>
                  ) : null}
                  {order.notes?.trim() ? (
                    <div className="po-detail__note">
                      <div className="po-detail__note-label">Order notes</div>
                      <div className="po-detail__note-body">{order.notes}</div>
                    </div>
                  ) : null}
                  {order.internalNotes?.trim() ? (
                    <div className="po-detail__note">
                      <div className="po-detail__note-label">Internal notes</div>
                      <div className="po-detail__note-body">{order.internalNotes}</div>
                    </div>
                  ) : null}
                  {!order.supplierMessage?.trim() && !order.notes?.trim() && !order.internalNotes?.trim() ? (
                    <p className="po-detail__muted">No notes on this order.</p>
                  ) : null}
                </>
              ) : null}
              {tab === 'attachments' ? (
                order.attachments?.length ? (
                  order.attachments.map((file) => (
                    <div key={file.fileName} className="po-detail__note">
                      <div className="po-detail__note-label">{file.fileName}</div>
                      <div className="po-detail__note-body">
                        {file.mimeType || 'File'}
                        {file.size ? ` · ${Math.round(file.size / 1024)} KB` : ''}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="po-detail__muted">No attachments.</p>
                )
              ) : null}
            </div>
          </div>
        </div>

        <div className="po-detail__col">
          <div className="po-detail__card">
            <div className="po-detail__card-hd">
              <span className="po-detail__card-title">Supplier</span>
            </div>
            <div className="po-detail__supplier">
              <div className="po-detail__supplier-head">
                <div className="po-detail__avatar">{supplierInitials(order.supplierName)}</div>
                <div>
                  <div className="po-detail__supplier-name">{order.supplierName}</div>
                  <div className="po-detail__supplier-meta">{snap?.gstin || '—'}</div>
                </div>
              </div>
              {snap?.phone ? <div className="po-detail__supplier-meta">{snap.phone}</div> : null}
              {snap?.email ? <div className="po-detail__supplier-meta">{snap.email}</div> : null}
              <div className="po-detail__supplier-meta">Payment terms: {paymentTermsLabel(order)}</div>
              {snap?.outstandingDues != null && snap.outstandingDues > 0 ? (
                <div className="po-detail__supplier-meta">Outstanding: {formatInr(snap.outstandingDues)}</div>
              ) : null}
            </div>
          </div>

          <div className="po-detail__card">
            <div className="po-detail__card-hd">
              <span className="po-detail__card-title">Order details</span>
            </div>
            <div className="po-detail__kv">
              {(
                [
                  ['PO number', order.poNumber],
                  ['Order date', formatShortDate(order.orderDate)],
                  ['Expected delivery', formatShortDate(order.expectedDeliveryDate)],
                  ['Receiving location', locationName],
                  ['Payment terms', paymentTermsLabel(order)],
                  ['Priority', order.priority ? order.priority.charAt(0).toUpperCase() + order.priority.slice(1) : 'Normal'],
                  ['Submitted to supplier', order.submittedToSupplier ? 'Yes' : 'No'],
                  ['Created', formatDateTime(order.createdAt)],
                  ['Last updated', formatDateTime(order.updatedAt)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="po-detail__kv-row">
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Confirm purchase order?"
        message={`Confirm ${order.poNumber} with ${order.supplierName} for ${formatInr(totals.grandTotal)}?`}
        confirmLabel="Confirm order"
        onConfirm={() => {
          setConfirmOpen(false);
          onConfirmOrder?.();
        }}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        isOpen={cancelOpen}
        title="Cancel purchase order?"
        message={`Cancel ${order.poNumber}? This cannot be undone.`}
        confirmLabel="Cancel order"
        variant="danger"
        onConfirm={() => {
          setCancelOpen(false);
          onCancelOrder();
        }}
        onCancel={() => setCancelOpen(false)}
      />
    </section>
  );
};
