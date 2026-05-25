import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/shared/components/ui';
import { PosPaymentSplitSection } from '@/features/sales/components/pos/PosPaymentSplitSection';
import { PosPaymentDetailsModal } from '@/features/sales/components/pos/PosPaymentDetailsModal';
import {
  buildExplicitTenderPayments,
  emptyTenderAmountInputs,
  getOnAccountAmountInput,
  isCashMethodCode,
  parsePaymentAmountInput,
  roundMoney,
  sumTenderAmounts,
  tenderAmountsFromInputs,
  type PosPaymentMethodDetails,
  type PosPaymentOption,
} from '@/features/sales/components/pos/posPaymentSplit';
import { salesService } from '@/services/sales.service';
import { extractErrorMessage } from '@/utils/error';
import './RecordPickupPaymentModal.css';

export type FulfillmentOrderLine = {
  orderLineId: string;
  variantName?: string;
  variantCode?: string;
  quantity?: number;
  fulfilledQty?: number;
  pendingPickQty?: number;
};

export type FulfillmentModalMode = 'full' | 'payment-only';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  orderId: string;
  branchId: string | null;
  orderNumber?: string;
  lines: FulfillmentOrderLine[];
  balanceDue: number;
  total: number;
  customerId?: string | null;
  payOpts: PosPaymentOption[];
  sessionOpen: boolean;
  /** Used to allow payment on completed orders when the counter session is closed. */
  orderStatus?: string;
  /** Pickup + payment vs payment collection only (all goods already picked). */
  mode?: FulfillmentModalMode;
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatInr(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const RecordPickupPaymentModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSuccess,
  orderId,
  branchId,
  orderNumber,
  lines,
  balanceDue,
  total,
  customerId,
  payOpts,
  sessionOpen,
  orderStatus,
  mode = 'full',
}) => {
  const paymentOnly = mode === 'payment-only';
  const [pickupDate, setPickupDate] = useState(todayYmd);
  const [pickInputs, setPickInputs] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [tenderInputs, setTenderInputs] = useState<Record<string, string>>({});
  const [onAccountInput, setOnAccountInput] = useState('');
  const [paymentDetailsByMethod, setPaymentDetailsByMethod] = useState<
    Record<string, PosPaymentMethodDetails | undefined>
  >({});
  const [paymentDetailsModal, setPaymentDetailsModal] = useState<{
    methodCode: string;
    methodLabel: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxPickupYmd = todayYmd();

  const resetForm = useCallback(() => {
    setPickupDate(todayYmd());
    setPickInputs({});
    setNote('');
    setTenderInputs(emptyTenderAmountInputs(payOpts));
    setOnAccountInput('');
    setPaymentDetailsByMethod({});
    setPaymentDetailsModal(null);
    setError(null);
  }, [payOpts]);

  useEffect(() => {
    if (isOpen) resetForm();
  }, [isOpen, resetForm]);

  const tenderAmounts = useMemo(
    () => tenderAmountsFromInputs(payOpts, tenderInputs),
    [payOpts, tenderInputs]
  );
  const onAccountAmount = useMemo(() => getOnAccountAmountInput(onAccountInput), [onAccountInput]);
  const paymentTotal = roundMoney(balanceDue);
  const paidNow = useMemo(() => sumTenderAmounts(tenderAmounts), [tenderAmounts]);
  const cashAmountForSection = useMemo(() => {
    const cashOpt = payOpts.find((p) => isCashMethodCode(p.value));
    return cashOpt ? tenderAmounts[cashOpt.value] ?? 0 : 0;
  }, [payOpts, tenderAmounts]);
  const paymentAllocated = roundMoney(paidNow + onAccountAmount);
  const paymentUnallocated = roundMoney(paymentTotal - paymentAllocated);
  const paymentOverAllocated = paymentUnallocated < -0.0001;
  const onAccountNeedsCustomer = onAccountAmount > 0 && !customerId?.trim();

  const totalPickNow = useMemo(() => {
    return Object.values(pickInputs).reduce((s, raw) => s + parsePaymentAmountInput(raw), 0);
  }, [pickInputs]);

  const hasPending = lines.some((l) => (l.pendingPickQty ?? 0) > 0);

  const clampPickupDate = (raw: string) => {
    if (!raw || raw > maxPickupYmd) return maxPickupYmd;
    return raw;
  };

  const handleSubmit = async () => {
    if (!branchId) return;
    const allowPaymentWithoutSession =
      paymentOnly && String(orderStatus || '').toLowerCase() === 'completed';
    if (!sessionOpen && !allowPaymentWithoutSession) {
      setError(
        paymentOnly
          ? 'Counter session is closed. Open the session to record payment.'
          : 'Counter session is closed. Open the session to record pickup.'
      );
      return;
    }
    if (pickupDate > maxPickupYmd) {
      setError(paymentOnly ? 'Payment date cannot be in the future.' : 'Pickup date cannot be in the future.');
      return;
    }

    const fulfillmentLines = lines
      .map((ln) => ({
        orderLineId: ln.orderLineId,
        quantityPicked: parsePaymentAmountInput(pickInputs[ln.orderLineId] ?? ''),
      }))
      .filter((l) => l.quantityPicked > 0);

    const pickSum = fulfillmentLines.reduce((s, l) => s + l.quantityPicked, 0);
    const paymentSum = roundMoney(paidNow + onAccountAmount);

    if (pickSum <= 0 && paymentSum <= 0) {
      setError('Enter pick quantity and/or payment.');
      return;
    }
    if (!paymentOnly && paymentSum > 0 && pickSum <= 0 && hasPending) {
      setError('Record a pickup before taking payment.');
      return;
    }
    if (paymentOnly && paymentSum <= 0) {
      setError('Enter a payment amount.');
      return;
    }
    if (paymentSum > 0 && balanceDue > 0) {
      if (paymentOverAllocated) {
        setError('Payment exceeds balance due.');
        return;
      }
      if (onAccountNeedsCustomer) {
        setError('Select a customer for on-account amount.');
        return;
      }
    }

    for (const ln of lines) {
      const qty = parsePaymentAmountInput(pickInputs[ln.orderLineId] ?? '');
      const pending = ln.pendingPickQty ?? Math.max(0, Number(ln.quantity ?? 0) - Number(ln.fulfilledQty ?? 0));
      if (qty > pending + 0.0001) {
        setError(`Cannot pick ${qty} for ${ln.variantName || ln.variantCode || 'item'} — only ${pending} pending.`);
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      let payments: ReturnType<typeof buildExplicitTenderPayments> | undefined;
      let onAccount: number | undefined;
      if (paymentSum > 0 && balanceDue > 0) {
        payments = buildExplicitTenderPayments(payOpts, tenderInputs, paymentDetailsByMethod);
        if (onAccountAmount > 0) onAccount = onAccountAmount;
      }

      await salesService.recordOrderFulfillment(
        orderId,
        {
          pickupDate,
          lines: paymentOnly ? [] : fulfillmentLines,
          payments,
          onAccountAmount: onAccount,
          note: paymentOnly ? undefined : note.trim() || undefined,
          paymentOnly: paymentOnly || undefined,
        },
        branchId
      );
      onSuccess();
      onClose();
    } catch (e: unknown) {
      setError(extractErrorMessage(e, paymentOnly ? 'Could not record payment' : 'Could not record pickup'));
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="rpp-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="rpp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rpp-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rpp-header">
          <h2 id="rpp-title">{paymentOnly ? 'Record payment' : 'Record pickup & payment'}</h2>
          {orderNumber ? <p className="rpp-sub">{orderNumber}</p> : null}
        </div>

        <div className="rpp-body">
          {!paymentOnly ? (
            <label className="rpp-field">
              <span>Pickup date</span>
              <input
                type="date"
                value={pickupDate}
                min="2000-01-01"
                max={maxPickupYmd}
                onChange={(e) => setPickupDate(clampPickupDate(e.target.value))}
                disabled={busy}
                aria-label="Pickup date"
              />
            </label>
          ) : null}

          {!paymentOnly ? (
            <>
          <div className="rpp-section">
            <div className="rpp-section-title">Picked / delivered qty</div>
            {!hasPending ? (
              <p className="rpp-muted">All items have been picked for this order.</p>
            ) : (
              <table className="rpp-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Ordered</th>
                    <th>Picked</th>
                    <th>Pending</th>
                    <th>Pick now</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln) => {
                    const ordered = Number(ln.quantity ?? 0);
                    const picked = Number(ln.fulfilledQty ?? 0);
                    const pending = ln.pendingPickQty ?? Math.max(0, roundMoney(ordered - picked));
                    return (
                      <tr key={ln.orderLineId}>
                        <td>
                          <div className="rpp-product">{ln.variantName || 'Item'}</div>
                          <div className="rpp-muted">{ln.variantCode || '—'}</div>
                        </td>
                        <td>{ordered}</td>
                        <td>{picked}</td>
                        <td>{pending}</td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            max={pending}
                            step="any"
                            className="rpp-qty-input"
                            value={pickInputs[ln.orderLineId] ?? ''}
                            disabled={busy || pending <= 0}
                            onChange={(e) =>
                              setPickInputs((prev) => ({ ...prev, [ln.orderLineId]: e.target.value }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <label className="rpp-field">
            <span>Note (optional)</span>
            <input
              type="text"
              value={note}
              maxLength={200}
              disabled={busy}
              placeholder="e.g. Will collect rest on Friday"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
            </>
          ) : null}

          {balanceDue > 0 ? (
            <div className="rpp-section">
              <div className="rpp-section-title">
                Payment ({formatInr(balanceDue)} due of {formatInr(total)})
              </div>
              {paymentOnly ? (
                <label className="rpp-field rpp-field--payment-date">
                  <span>Payment date</span>
                  <input
                    type="date"
                    value={pickupDate}
                    min="2000-01-01"
                    max={maxPickupYmd}
                    onChange={(e) => setPickupDate(clampPickupDate(e.target.value))}
                    disabled={busy}
                    aria-label="Payment date"
                  />
                </label>
              ) : null}
              <PosPaymentSplitSection
                payOpts={payOpts}
                total={paymentTotal}
                disabled={busy}
                nonCashInputs={tenderInputs}
                cashAmount={cashAmountForSection}
                manualTenderEntry
                tenderInputs={tenderInputs}
                onTenderChange={(methodCode, raw) =>
                  setTenderInputs((prev) => ({ ...prev, [methodCode]: raw }))
                }
                onAccountInput={onAccountInput}
                onAccountAmount={onAccountAmount}
                onAccountNeedsCustomer={onAccountNeedsCustomer}
                paidNow={paidNow}
                unallocated={paymentUnallocated}
                detailsByMethod={paymentDetailsByMethod}
                overAllocated={paymentOverAllocated}
                onNonCashChange={() => {}}
                onOnAccountChange={setOnAccountInput}
                onOpenDetails={(methodCode, methodLabel) =>
                  setPaymentDetailsModal({ methodCode, methodLabel })
                }
              />
            </div>
          ) : null}

          {error ? (
            <p className="rpp-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="rpp-footer">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={
              busy ||
              (paymentOnly
                ? balanceDue <= 0 || roundMoney(paidNow + onAccountAmount) <= 0
                : (!hasPending && balanceDue <= 0) ||
                  (totalPickNow <= 0 && roundMoney(paidNow + onAccountAmount) <= 0))
            }
            onClick={() => void handleSubmit()}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>

        {paymentDetailsModal ? (
          <PosPaymentDetailsModal
            isOpen
            methodCode={paymentDetailsModal.methodCode}
            methodLabel={paymentDetailsModal.methodLabel}
            initial={paymentDetailsByMethod[paymentDetailsModal.methodCode]}
            onClose={() => setPaymentDetailsModal(null)}
            onSave={(details) => {
              setPaymentDetailsByMethod((prev) => ({
                ...prev,
                [paymentDetailsModal.methodCode]: details,
              }));
              setPaymentDetailsModal(null);
            }}
          />
        ) : null}
      </div>
    </div>,
    document.body
  );
};
