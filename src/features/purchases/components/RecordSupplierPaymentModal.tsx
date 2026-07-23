import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/shared/components/ui';
import { Modal } from '@/shared/components/modals/Modal';
import { PosPaymentSplitSection } from '@/features/sales/components/pos/PosPaymentSplitSection';
import { PosPaymentDetailsModal } from '@/features/sales/components/pos/PosPaymentDetailsModal';
import {
  buildExplicitTenderPayments,
  emptyTenderAmountInputs,
  roundMoney,
  sumTenderAmounts,
  tenderAmountsFromInputs,
  type PosPaymentMethodDetails,
  type PosPaymentOption,
} from '@/features/sales/components/pos/posPaymentSplit';
import { salesService, type SalesSettingsData } from '@/services/sales.service';
import {
  purchaseService,
  type PostPurchaseReceiptPaymentInput,
  type PurchaseBillRow,
} from '@/services/purchase.service';
import { formatInr } from '../utils/supplierDirectory';
import { extractErrorMessage } from '@/utils/error';
import './RecordSupplierPaymentModal.css';

type Props = {
  isOpen: boolean;
  branchId?: string | null;
  supplierName: string;
  bill: PurchaseBillRow | null;
  onClose: () => void;
  onSuccess: () => void;
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function paymentOptionsFromSettings(s: SalesSettingsData | null): PosPaymentOption[] {
  if (!s?.paymentMethods?.length) {
    return [
      { value: 'cash', label: 'Cash' },
      { value: 'card', label: 'Card' },
      { value: 'upi', label: 'UPI' },
    ];
  }
  return [...s.paymentMethods]
    .filter((p) => p.enabled !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((p) => ({ value: p.code, label: p.label }));
}

export const RecordSupplierPaymentModal: React.FC<Props> = ({
  isOpen,
  branchId,
  supplierName,
  bill,
  onClose,
  onSuccess,
}) => {
  const [payOpts, setPayOpts] = useState<PosPaymentOption[]>([]);
  const [paymentDate, setPaymentDate] = useState(todayYmd);
  const [tenderInputs, setTenderInputs] = useState<Record<string, string>>({});
  const [paymentDetailsByMethod, setPaymentDetailsByMethod] = useState<
    Record<string, PosPaymentMethodDetails | undefined>
  >({});
  const [paymentDetailsModal, setPaymentDetailsModal] = useState<{
    methodCode: string;
    methodLabel: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balanceDue = bill?.onCreditAmount ?? 0;

  useEffect(() => {
    if (!branchId || !isOpen) return;
    salesService
      .getSettings(branchId)
      .then((s) => setPayOpts(paymentOptionsFromSettings(s)))
      .catch(() => setPayOpts(paymentOptionsFromSettings(null)));
  }, [branchId, isOpen]);

  const resetForm = useCallback(() => {
    setPaymentDate(todayYmd());
    setTenderInputs(emptyTenderAmountInputs(payOpts));
    setPaymentDetailsByMethod({});
    setPaymentDetailsModal(null);
    setError(null);
  }, [payOpts]);

  useEffect(() => {
    if (isOpen) resetForm();
  }, [isOpen, resetForm, bill?.id]);

  const tenderAmounts = useMemo(
    () => tenderAmountsFromInputs(payOpts, tenderInputs),
    [payOpts, tenderInputs]
  );
  const paidNow = useMemo(() => sumTenderAmounts(tenderAmounts), [tenderAmounts]);
  const paymentTotal = roundMoney(balanceDue);
  const paymentUnallocated = roundMoney(paymentTotal - paidNow);
  const paymentOverAllocated = paymentUnallocated < -0.0001;

  const handleSubmit = useCallback(async () => {
    if (!branchId || !bill) return;
    if (paidNow <= 0) {
      setError('Enter a payment amount.');
      return;
    }
    if (paymentOverAllocated) {
      setError('Payment exceeds balance due.');
      return;
    }

    const lines = buildExplicitTenderPayments(payOpts, tenderInputs, paymentDetailsByMethod);
    const payments: PostPurchaseReceiptPaymentInput[] = lines.map((l) => ({
      methodCode: l.methodCode,
      amount: l.amount,
      details: l.details,
    }));

    setBusy(true);
    setError(null);
    try {
      await purchaseService.recordBillPayment(bill.id, { payments, paymentDate }, branchId);
      onSuccess();
      onClose();
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'Could not record payment'));
    } finally {
      setBusy(false);
    }
  }, [
    bill,
    branchId,
    onClose,
    onSuccess,
    paidNow,
    payOpts,
    paymentDate,
    paymentDetailsByMethod,
    paymentOverAllocated,
    tenderInputs,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (paymentDetailsModal) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void handleSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onClose, paymentDetailsModal, handleSubmit]);

  if (!bill) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Record payment"
        size="md"
        closeOnEscape={false}
      >
        <div className="record-supplier-pay">
          <p className="record-supplier-pay__meta">
            {supplierName} · {bill.billNumber} · Balance {formatInr(balanceDue)}
          </p>
          <label className="record-supplier-pay__date">
            <span>Payment date</span>
            <input
              type="date"
              value={paymentDate}
              max={todayYmd()}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </label>
          <div className="record-supplier-pay__split">
            <PosPaymentSplitSection
              payOpts={payOpts}
              total={paymentTotal}
              disabled={busy}
              nonCashInputs={tenderInputs}
              cashAmount={tenderAmounts.cash ?? 0}
              onAccountInput=""
              onAccountAmount={0}
              onAccountNeedsCustomer={false}
              paidNow={paidNow}
              unallocated={paymentUnallocated}
              detailsByMethod={paymentDetailsByMethod}
              overAllocated={paymentOverAllocated}
              onNonCashChange={(code, raw) =>
                setTenderInputs((prev) => ({ ...prev, [code]: raw }))
              }
              onOnAccountChange={() => {}}
              onOpenDetails={(methodCode, methodLabel) =>
                setPaymentDetailsModal({ methodCode, methodLabel })
              }
              manualTenderEntry
              tenderInputs={tenderInputs}
              onTenderChange={(code, raw) =>
                setTenderInputs((prev) => ({ ...prev, [code]: raw }))
              }
            />
          </div>
          {error ? <p className="record-supplier-pay__error">{error}</p> : null}
          <p className="record-supplier-pay__hint">Ctrl+Enter save · Esc close</p>
          <div className="record-supplier-pay__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={() => void handleSubmit()} disabled={busy}>
              Save payment
            </Button>
          </div>
        </div>
      </Modal>

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
    </>
  );
};
