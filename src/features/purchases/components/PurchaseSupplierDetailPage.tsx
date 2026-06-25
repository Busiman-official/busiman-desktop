import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button } from '@/shared/components/ui';
import {
  purchaseService,
  type PurchaseBillRow,
  type PurchaseSupplierDetail,
} from '@/services/purchase.service';
import { formatInr, paymentTermsToLabel } from '../utils/supplierDirectory';
import {
  computeSupplierKpis,
  mailtoHrefFor,
  openExternalUrl,
  payableStatusBadge,
  telHrefFor,
} from '../utils/supplierDetailDisplay';
import { usePurchaseSupplierDetailKeyboard } from '../hooks/usePurchaseSupplierDetailKeyboard';
import { RecordSupplierPaymentModal } from './RecordSupplierPaymentModal';
import { SupplierFormModal } from './SupplierFormModal';
import { PurchaseReturnsPanel } from './PurchaseReturnsPanel';
import {
  PurchaseSupplierDetailTable,
  PurchaseSupplierDetailTableRow,
} from './PurchaseSupplierDetailTable';
import './PurchaseSupplierDetailPage.css';

type Props = {
  detail: PurchaseSupplierDetail;
  branchId?: string | null;
  loading?: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onNewPo: (supplierId: string) => void;
};

type DetailTab = 'orders' | 'bills' | 'payments' | 'returns' | 'profile';

const DETAIL_TABS: ReadonlyArray<{ id: DetailTab; label: string }> = [
  { id: 'bills', label: 'Bills' },
  { id: 'orders', label: 'Purchase orders' },
  { id: 'payments', label: 'Payments' },
  { id: 'returns', label: 'Returns' },
  { id: 'profile', label: 'Profile' },
];

function formatShortDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function billStatusLabel(status: string): string {
  if (status === 'partially_paid') return 'Partial';
  if (status === 'paid') return 'Paid';
  return 'On credit';
}

function poStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
}

function supplierInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

export const PurchaseSupplierDetailPage: React.FC<Props> = ({
  detail,
  branchId,
  loading,
  onBack,
  onRefresh,
  onNewPo,
}) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>('bills');
  const [highlightedOrderIndex, setHighlightedOrderIndex] = useState(0);
  const [highlightedBillIndex, setHighlightedBillIndex] = useState(0);
  const [paymentBill, setPaymentBill] = useState<PurchaseBillRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [returnBillId, setReturnBillId] = useState<string | null>(null);
  const [returnsModalOpen, setReturnsModalOpen] = useState(false);

  const startReturnForBill = useCallback((bill: PurchaseBillRow) => {
    setReturnBillId(bill.id);
    setTab('returns');
  }, []);

  const openBills = useMemo(
    () => detail.bills.filter((b) => b.onCreditAmount > 0),
    [detail.bills]
  );
  const canPay = openBills.length > 0;

  const openPayment = useCallback((bill: PurchaseBillRow) => {
    if (bill.onCreditAmount <= 0) return;
    setPaymentBill(bill);
  }, []);

  const recordPaymentFromSelection = useCallback(() => {
    const bill = detail.bills[highlightedBillIndex];
    if (bill?.onCreditAmount > 0) {
      openPayment(bill);
      return;
    }
    const firstOpen = detail.bills.find((b) => b.onCreditAmount > 0);
    if (firstOpen) openPayment(firstOpen);
  }, [detail.bills, highlightedBillIndex, openPayment]);

  const purchaseOrders = detail.purchaseOrders ?? [];
  const payments = detail.payments ?? [];

  useEffect(() => {
    setHighlightedOrderIndex(0);
    setHighlightedBillIndex(0);
    setTab('bills');
  }, [detail.supplierId]);

  const openOrder = useCallback(
    (orderId: string) => {
      const p = new URLSearchParams();
      p.set('tab', 'orders');
      p.set('returnSupplier', detail.supplierId);
      navigate(`/purchases/orders/${orderId}?${p.toString()}`, { replace: true });
    },
    [navigate, detail.supplierId]
  );

  const openBillOrder = useCallback(
    (bill: PurchaseBillRow) => {
      if (!bill.purchaseOrderId) return;
      openOrder(bill.purchaseOrderId);
    },
    [openOrder]
  );

  usePurchaseSupplierDetailKeyboard({
    enabled: !paymentBill && !editOpen && !returnsModalOpen,
    tab,
    bills: detail.bills,
    purchaseOrders,
    paymentModalOpen: Boolean(paymentBill),
    onBack,
    onRecordPaymentForBill: openPayment,
    onOpenOrder: openOrder,
    onOpenBillOrder: openBillOrder,
    highlightedBillIndex,
    onHighlightedBillIndexChange: setHighlightedBillIndex,
    highlightedOrderIndex,
    onHighlightedOrderIndexChange: setHighlightedOrderIndex,
  });

  const profile = detail.master;
  const kpis = useMemo(() => computeSupplierKpis(detail), [detail]);
  const payableBadge = payableStatusBadge(detail.payableStatus);
  const isActive = profile?.isActive ?? true;
  const gstin = profile?.gstin || detail.gstin;
  const showPoFootnote = purchaseOrders.length >= 25;

  const handleArchiveToggle = useCallback(async () => {
    if (!profile?.id) {
      setEditOpen(true);
      return;
    }
    setArchiveBusy(true);
    try {
      await purchaseService.patchSupplierMaster(profile.id, { isActive: !isActive }, branchId);
      onRefresh();
    } finally {
      setArchiveBusy(false);
    }
  }, [branchId, isActive, onRefresh, profile?.id]);

  return (
    <section className="po-sup-detail">
      <div className="sd-page sd-page--embedded">
        {detail.outstanding > 0 ? (
          <div className="sd-payable-banner">
            <span>
              <strong>Payable balance:</strong> {formatInr(detail.outstanding)} — {detail.openBillCount} open
              bill{detail.openBillCount === 1 ? '' : 's'}
            </span>
            <Button
              type="button"
              variant="primary"
              disabled={loading || !canPay}
              onClick={() => {
                setTab('bills');
                recordPaymentFromSelection();
              }}
              title="Record payment (Ctrl+P)"
            >
              Record payment
            </Button>
          </div>
        ) : null}

        <header className="sd-hero">
          <div className="sd-hero-main">
            <div className="sd-avatar" aria-hidden>
              {supplierInitials(detail.supplierName)}
            </div>
            <div className="sd-hero-text">
              <h1>{detail.supplierName}</h1>
              <div className="sd-mono">{detail.supplierId}</div>
              <div className="sd-hero-badges">
                <Badge variant={isActive ? 'success' : 'neutral'}>{isActive ? 'Active' : 'Inactive'}</Badge>
                <Badge variant={payableBadge.variant}>{payableBadge.label}</Badge>
                {gstin ? <Badge variant="neutral">GSTIN</Badge> : null}
              </div>
            </div>
          </div>
          <div className="sd-hero-actions">
            <Button
              type="button"
              variant="primary"
              disabled={!isActive || loading}
              onClick={() => onNewPo(detail.supplierId)}
              title={!isActive ? 'Reactivate this supplier to create a PO.' : undefined}
            >
              New PO
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading || !canPay}
              onClick={recordPaymentFromSelection}
              title="Record payment (Ctrl+P)"
            >
              Record payment
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            {telHrefFor(profile?.phone) ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => openExternalUrl(telHrefFor(profile?.phone))}
              >
                Call
              </Button>
            ) : (
              <Button type="button" variant="secondary" disabled title="No phone">
                Call
              </Button>
            )}
            {mailtoHrefFor(profile?.email, detail.supplierName) ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => openExternalUrl(mailtoHrefFor(profile?.email, detail.supplierName))}
              >
                Email
              </Button>
            ) : (
              <Button type="button" variant="secondary" disabled title="No email">
                Email
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={archiveBusy || loading}
              onClick={() => void handleArchiveToggle()}
            >
              {archiveBusy ? '…' : isActive ? 'Archive' : 'Unarchive'}
            </Button>
          </div>
        </header>

        <section className="sd-kpis" aria-label="Key metrics">
          {kpis.map((kpi) => (
            <div key={kpi.id} className={`sd-kpi${kpi.toneClass ? ` ${kpi.toneClass}` : ''}`}>
              <label>{kpi.label}</label>
              <strong>{kpi.value}</strong>
              <em>{kpi.subtext}</em>
            </div>
          ))}
        </section>

        <nav className="sd-tabs" role="tablist" aria-label="Supplier sections">
          {DETAIL_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className={`sd-tab${tab === t.id ? ' active' : ''}`}
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'orders' ? (
          <div className="sd-panel">
            <div className="sd-panel__head">
              <h3>Purchase orders</h3>
              <span className="po-sup-detail__hint">Esc back · Enter open · ↑↓ move</span>
            </div>
            <PurchaseSupplierDetailTable
              columns={['PO', 'Status', 'Order date', 'Pending qty', '']}
              highlightedIndex={highlightedOrderIndex}
              rowCount={purchaseOrders.length}
              emptyMessage="No purchase orders for this supplier."
            >
              {purchaseOrders.map((po, idx) => (
                <PurchaseSupplierDetailTableRow
                  key={po.id}
                  rowIndex={idx}
                  highlightedIndex={highlightedOrderIndex}
                  onHighlightedIndexChange={setHighlightedOrderIndex}
                >
                  <td>
                    <strong>{po.poNumber}</strong>
                  </td>
                  <td>{poStatusLabel(po.status)}</td>
                  <td>{formatShortDate(po.orderDate)}</td>
                  <td>{po.totalPendingQty}</td>
                  <td>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        openOrder(po.id);
                      }}
                    >
                      Open
                    </Button>
                  </td>
                </PurchaseSupplierDetailTableRow>
              ))}
            </PurchaseSupplierDetailTable>
            {showPoFootnote ? (
              <div className="sd-panel__foot">Showing latest 25 orders.</div>
            ) : null}
          </div>
        ) : null}

        {tab === 'bills' ? (
          <div className="sd-panel">
            <div className="sd-panel__head">
              <h3>Bills</h3>
              <span className="po-sup-detail__hint">Esc back · Enter open · Ctrl+P pay · ↑↓ move</span>
            </div>
            <PurchaseSupplierDetailTable
              columns={['Bill', 'Receipt date', 'Total', 'Paid', 'Balance', 'Status', '']}
              highlightedIndex={highlightedBillIndex}
              rowCount={detail.bills.length}
              emptyMessage="No bills yet."
            >
              {detail.bills.map((bill, idx) => {
                const canPayBill = bill.onCreditAmount > 0;
                const canOpenOrder = Boolean(bill.purchaseOrderId);
                return (
                  <PurchaseSupplierDetailTableRow
                    key={bill.id}
                    rowIndex={idx}
                    highlightedIndex={highlightedBillIndex}
                    onHighlightedIndexChange={setHighlightedBillIndex}
                    rowClassName={canPayBill ? 'po-sup-detail__row--due' : ''}
                  >
                    <td>
                      <strong>{bill.billNumber}</strong>
                      {bill.movementNumber ? (
                        <div className="po-sup-detail__sub">{bill.movementNumber}</div>
                      ) : null}
                    </td>
                    <td>{formatShortDate(bill.receiptDate)}</td>
                    <td className="po-sup-detail__num">{formatInr(bill.totalAmount)}</td>
                    <td className="po-sup-detail__num">{formatInr(bill.amountPaid)}</td>
                    <td className="po-sup-detail__num">{formatInr(bill.onCreditAmount)}</td>
                    <td>{billStatusLabel(bill.status)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {canOpenOrder ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              openBillOrder(bill);
                            }}
                          >
                            Open
                          </Button>
                        ) : null}
                        {canPayBill ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPayment(bill);
                            }}
                          >
                            Pay
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          title="Return items from this bill"
                          onClick={(e) => {
                            e.stopPropagation();
                            startReturnForBill(bill);
                          }}
                        >
                          Return
                        </Button>
                      </div>
                    </td>
                  </PurchaseSupplierDetailTableRow>
                );
              })}
            </PurchaseSupplierDetailTable>
          </div>
        ) : null}

        {tab === 'payments' ? (
          <div className="sd-panel">
            <div className="sd-panel__head">
              <h3>Payment history</h3>
            </div>
            <div className="po-sup-detail__table-wrap">
              <table className="po-sup-detail__table">
                <thead>
                  <tr>
                    {['Date', 'Bill', 'Method', 'Amount'].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!payments.length ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 16, color: '#64748b' }}>
                        No payments recorded yet.
                      </td>
                    </tr>
                  ) : (
                    payments.map((p, i) => (
                      <tr key={`${p.billId}-${i}-${p.paidAt}`} className="po-sup-detail__row">
                        <td>{formatShortDate(p.paidAt)}</td>
                        <td>{p.billNumber}</td>
                        <td>{p.methodCode}</td>
                        <td className="po-sup-detail__num">{formatInr(p.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === 'returns' ? (
          <div className="sd-panel">
            <PurchaseReturnsPanel
              branchId={branchId}
              supplierId={detail.supplierId}
              initialBillId={returnBillId}
              onInitialBillConsumed={() => setReturnBillId(null)}
              onChanged={onRefresh}
              onModalOpenChange={setReturnsModalOpen}
            />
          </div>
        ) : null}

        {tab === 'profile' ? (
          <div className="sd-panel">
            <div className="sd-panel__head">
              <h3>Supplier profile</h3>
              <Button type="button" size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            </div>
            {!profile ? (
              <p className="sd-profile-empty">No master profile yet. Use Edit to add contact details.</p>
            ) : (
              <dl className="sd-dl">
                <dt>Phone</dt>
                <dd>{profile.phone || '—'}</dd>
                <dt>Email</dt>
                <dd>{profile.email || '—'}</dd>
                <dt>Contact person</dt>
                <dd>{profile.contactPerson || '—'}</dd>
                <dt>GSTIN</dt>
                <dd>{profile.gstin || detail.gstin || '—'}</dd>
                <dt>Payment terms</dt>
                <dd>{profile.paymentTerms ? paymentTermsToLabel(profile.paymentTerms) : '—'}</dd>
                <dt>Status</dt>
                <dd>{profile.isActive ? 'Active' : 'Inactive'}</dd>
                <dt>Notes</dt>
                <dd>{profile.notes || '—'}</dd>
              </dl>
            )}
          </div>
        ) : null}
      </div>

      <RecordSupplierPaymentModal
        isOpen={Boolean(paymentBill)}
        branchId={branchId}
        supplierName={detail.supplierName}
        bill={paymentBill}
        onClose={() => setPaymentBill(null)}
        onSuccess={onRefresh}
      />

      <SupplierFormModal
        isOpen={editOpen}
        branchId={branchId}
        mode={profile ? 'edit' : 'create'}
        initial={
          profile || {
            id: '',
            supplierCode: detail.supplierId,
            name: detail.supplierName,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        }
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          onRefresh();
        }}
      />
    </section>
  );
};
