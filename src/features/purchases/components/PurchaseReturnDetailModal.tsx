/**
 * Purchase return detail — lines, money trail and lifecycle actions
 * (post draft, cancel draft, record debit note / refund, replacement, print).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/shared/components/modals/Modal';
import { Button, Input } from '@/shared/components/ui';
import { purchaseService, type PurchaseReturn } from '@/services/purchase.service';
import { formatInr } from '../utils/supplierDirectory';
import {
  formatReturnDate,
  reasonLabel,
  returnStatusClass,
  returnStatusLabel,
  settlementFollowUp,
  settlementLabel,
} from '../utils/purchaseReturnDisplay';
import './PurchaseReturns.css';

type Props = {
  branchId?: string | null;
  ret: PurchaseReturn | null;
  onClose: () => void;
  onChanged: (updated: PurchaseReturn) => void;
};

function buildPrintHtml(ret: PurchaseReturn): string {
  const rows = ret.lines
    .map(
      (l) =>
        `<tr><td>${l.variantName || l.itemName}</td><td>${l.quantity}</td><td>${l.fromLocationName || ''}</td><td>${reasonLabel(l.reason)}</td><td style="text-align:right">₹${l.lineTotal.toFixed(2)}</td></tr>`
    )
    .join('');
  return `<!doctype html><html><head><title>${ret.returnNumber}</title><style>
    body{font-family:system-ui,sans-serif;padding:24px;color:#0f172a}
    h1{font-size:18px;margin:0 0 4px}
    p{margin:2px 0;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
    th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
    tfoot td{font-weight:600}
  </style></head><body>
    <h1>Purchase return ${ret.returnNumber}</h1>
    <p>Supplier: <strong>${ret.supplierName}</strong> (${ret.supplierId})</p>
    <p>Against bill: ${ret.billNumber} · Date: ${formatReturnDate(ret.returnDate || ret.createdAt)}</p>
    ${ret.rmaNumber ? `<p>RMA: ${ret.rmaNumber}</p>` : ''}
    <p>Settlement: ${settlementLabel(ret.settlementType)} · Status: ${returnStatusLabel(ret.status)}</p>
    <table>
      <thead><tr><th>Item</th><th>Qty</th><th>From</th><th>Reason</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td style="text-align:right">₹${ret.totalAmount.toFixed(2)}</td></tr></tfoot>
    </table>
    ${ret.notes ? `<p style="margin-top:12px">Notes: ${ret.notes}</p>` : ''}
  </body></html>`;
}

export const PurchaseReturnDetailModal: React.FC<Props> = ({ branchId, ret, onClose, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debitNote, setDebitNote] = useState('');
  const [refundAmount, setRefundAmount] = useState('');

  useEffect(() => {
    setError(null);
    setDebitNote('');
    setRefundAmount('');
  }, [ret?.id]);

  const run = useCallback(
    async (fn: () => Promise<PurchaseReturn>) => {
      setBusy(true);
      setError(null);
      try {
        const updated = await fn();
        onChanged(updated);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setBusy(false);
      }
    },
    [onChanged]
  );

  const handlePost = useCallback(() => {
    if (!ret) return;
    if (!window.confirm('Post this return? Stock will be issued out and the settlement applied.')) return;
    void run(() => purchaseService.postReturn(ret.id, branchId));
  }, [branchId, ret, run]);

  const handleCancel = useCallback(() => {
    if (!ret) return;
    const reason = window.prompt('Cancel this draft return? Optional reason:');
    if (reason === null) return;
    void run(() => purchaseService.cancelReturn(ret.id, reason.trim() || undefined, branchId));
  }, [branchId, ret, run]);

  const handleDebitNote = useCallback(() => {
    if (!ret || !debitNote.trim()) return;
    void run(() =>
      purchaseService.updateReturnSettlement(ret.id, { supplierDebitNoteNumber: debitNote.trim() }, branchId)
    );
  }, [branchId, debitNote, ret, run]);

  const handleRefund = useCallback(() => {
    if (!ret) return;
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid refund amount');
      return;
    }
    void run(() => purchaseService.updateReturnSettlement(ret.id, { refundReceivedAmount: amount }, branchId));
    setRefundAmount('');
  }, [branchId, refundAmount, ret, run]);

  const handleReplacementReceived = useCallback(() => {
    if (!ret) return;
    void run(() => purchaseService.updateReturnSettlement(ret.id, { replacementReceived: true }, branchId));
  }, [branchId, ret, run]);

  const handlePrint = useCallback(() => {
    if (!ret) return;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    w.document.write(buildPrintHtml(ret));
    w.document.close();
    w.focus();
    w.print();
  }, [ret]);

  if (!ret) return null;

  const refundPending = Math.max(0, ret.refundDue - ret.refundReceived);
  const followUp = settlementFollowUp(ret);

  return (
    <Modal
      isOpen={Boolean(ret)}
      onClose={onClose}
      title={`Return ${ret.returnNumber}`}
      titleId="purchase-return-detail-title"
      size="lg"
      className="pr-detail-wrap"
    >
      <div className="pr-detail">
        {error ? <div className="pr-wizard__alert">{error}</div> : null}

        <div className="pr-detail__head">
          <div className="pr-detail__chips">
            <span className={`po-list__status-chip ${returnStatusClass(ret.status)}`}>
              {returnStatusLabel(ret.status)}
            </span>
            <span className="po-list__status-chip po-list__status-chip--po-only">
              {settlementLabel(ret.settlementType)}
            </span>
            {followUp ? <span className="pr-detail__followup">{followUp}</span> : null}
          </div>
          <div className="pr-detail__head-actions">
            <Button type="button" size="sm" variant="secondary" onClick={handlePrint}>
              Print
            </Button>
            {ret.status === 'draft' ? (
              <>
                <Button type="button" size="sm" variant="danger" disabled={busy} onClick={handleCancel}>
                  Cancel return
                </Button>
                <Button type="button" size="sm" variant="primary" disabled={busy} onClick={handlePost}>
                  {busy ? 'Posting…' : 'Post return'}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <dl className="pr-detail__grid">
          <dt>Supplier</dt>
          <dd>
            <strong>{ret.supplierName}</strong> <span className="pr-wizard__muted">({ret.supplierId})</span>
          </dd>
          <dt>Against bill</dt>
          <dd>{ret.billNumber}</dd>
          <dt>Return date</dt>
          <dd>{formatReturnDate(ret.returnDate || ret.createdAt)}</dd>
          {ret.movementNumber ? (
            <>
              <dt>Stock movement</dt>
              <dd>{ret.movementNumber}</dd>
            </>
          ) : null}
          {ret.rmaNumber ? (
            <>
              <dt>RMA number</dt>
              <dd>{ret.rmaNumber}</dd>
            </>
          ) : null}
          {ret.cancelReason ? (
            <>
              <dt>Cancel reason</dt>
              <dd>{ret.cancelReason}</dd>
            </>
          ) : null}
          {ret.notes ? (
            <>
              <dt>Notes</dt>
              <dd>{ret.notes}</dd>
            </>
          ) : null}
        </dl>

        <table className="pr-wizard__review">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>From</th>
              <th>Reason</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {ret.lines.map((l, i) => (
              <tr key={`${l.variantId}-${i}`}>
                <td>{l.variantName || l.itemName}</td>
                <td>{l.quantity}</td>
                <td>{l.fromLocationName || '—'}</td>
                <td>
                  {reasonLabel(l.reason)}
                  {l.reasonNote ? <div className="pr-wizard__muted">{l.reasonNote}</div> : null}
                </td>
                <td>{formatInr(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Total</td>
              <td>
                <strong>{formatInr(ret.totalAmount)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>

        {ret.status === 'completed' ? (
          <div className="pr-detail__money">
            <h4>Settlement</h4>
            <div className="pr-detail__money-grid">
              <div>
                <label>Adjusted on bill</label>
                <strong>{formatInr(ret.creditApplied)}</strong>
              </div>
              <div>
                <label>Refund due</label>
                <strong>{formatInr(ret.refundDue)}</strong>
              </div>
              <div>
                <label>Refund received</label>
                <strong>{formatInr(ret.refundReceived)}</strong>
              </div>
            </div>

            {ret.settlementType === 'credit' ? (
              ret.supplierDebitNoteNumber ? (
                <p className="pr-wizard__muted">Supplier debit note: {ret.supplierDebitNoteNumber}</p>
              ) : (
                <div className="pr-detail__action-row">
                  <Input
                    label="Supplier debit / credit note number"
                    value={debitNote}
                    onChange={(e) => setDebitNote(e.target.value)}
                    placeholder="e.g. DN-2024-114"
                  />
                  <Button type="button" variant="secondary" disabled={busy || !debitNote.trim()} onClick={handleDebitNote}>
                    Record
                  </Button>
                </div>
              )
            ) : null}

            {refundPending > 0 ? (
              <div className="pr-detail__action-row">
                <Input
                  label={`Record refund received (pending ${formatInr(refundPending)})`}
                  type="number"
                  min={0}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
                <Button type="button" variant="secondary" disabled={busy || !refundAmount} onClick={handleRefund}>
                  Record
                </Button>
              </div>
            ) : null}

            {ret.settlementType === 'replacement' ? (
              ret.replacementReceived ? (
                <p className="pr-wizard__muted">Replacement goods received.</p>
              ) : (
                <div className="pr-detail__action-row">
                  <p className="pr-wizard__muted">
                    Receive the fresh goods via Purchases → Receipts, then mark this done.
                  </p>
                  <Button type="button" variant="secondary" disabled={busy} onClick={handleReplacementReceived}>
                    Mark replacement received
                  </Button>
                </div>
              )
            ) : null}
          </div>
        ) : null}

        {ret.status === 'draft' ? (
          <p className="pr-wizard__hint">
            This is a draft — stock has not moved and the bill is untouched. Post it to issue the stock and apply the
            settlement, or cancel it to discard.
          </p>
        ) : null}
      </div>
    </Modal>
  );
};
