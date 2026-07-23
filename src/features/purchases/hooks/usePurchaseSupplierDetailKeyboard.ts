import { useEffect, useRef } from 'react';
import type { PurchaseBillRow, PurchaseSupplierOrderRow } from '@/services/purchase.service';

export type SupplierDetailKeyboardTab = 'orders' | 'bills' | 'payments' | 'returns' | 'profile';

type Params = {
  enabled: boolean;
  tab: SupplierDetailKeyboardTab;
  bills: PurchaseBillRow[];
  purchaseOrders: PurchaseSupplierOrderRow[];
  paymentModalOpen: boolean;
  onBack: () => void;
  onRecordPaymentForBill: (bill: PurchaseBillRow) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenBillOrder: (bill: PurchaseBillRow) => void;
  highlightedBillIndex: number;
  onHighlightedBillIndexChange: (index: number) => void;
  highlightedOrderIndex: number;
  onHighlightedOrderIndexChange: (index: number) => void;
};

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

function clampIndex(next: number, len: number): number {
  if (len <= 0) return 0;
  return Math.max(0, Math.min(len - 1, next));
}

export function usePurchaseSupplierDetailKeyboard({
  enabled,
  tab,
  bills,
  purchaseOrders,
  paymentModalOpen,
  onBack,
  onRecordPaymentForBill,
  onOpenOrder,
  onOpenBillOrder,
  highlightedBillIndex,
  onHighlightedBillIndexChange,
  highlightedOrderIndex,
  onHighlightedOrderIndexChange,
}: Params): void {
  const billsRef = useRef(bills);
  const ordersRef = useRef(purchaseOrders);
  const highlightedBillRef = useRef(highlightedBillIndex);
  const highlightedOrderRef = useRef(highlightedOrderIndex);
  const paymentOpenRef = useRef(paymentModalOpen);
  const tabRef = useRef(tab);

  billsRef.current = bills;
  ordersRef.current = purchaseOrders;
  highlightedBillRef.current = highlightedBillIndex;
  highlightedOrderRef.current = highlightedOrderIndex;
  paymentOpenRef.current = paymentModalOpen;
  tabRef.current = tab;

  useEffect(() => {
    if (!enabled) return;

    const openBills = () => billsRef.current.filter((b) => b.onCreditAmount > 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (paymentOpenRef.current) return;
      const mod = e.ctrlKey || e.metaKey;
      const inTextEntry = isTextEntryTarget(e.target);
      const activeTab = tabRef.current;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onBack();
        return;
      }

      if (activeTab === 'bills' && mod && e.key.toLowerCase() === 'p') {
        const bill = billsRef.current[highlightedBillRef.current];
        if (!bill || bill.onCreditAmount <= 0) {
          const firstOpen = openBills()[0];
          if (!firstOpen) return;
          e.preventDefault();
          e.stopPropagation();
          onRecordPaymentForBill(firstOpen);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onRecordPaymentForBill(bill);
        return;
      }

      if (inTextEntry) return;

      if (activeTab === 'orders') {
        const len = ordersRef.current.length;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          onHighlightedOrderIndexChange(clampIndex(highlightedOrderRef.current + 1, len));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          onHighlightedOrderIndexChange(clampIndex(highlightedOrderRef.current - 1, len));
          return;
        }
        if (e.key === 'Home') {
          e.preventDefault();
          onHighlightedOrderIndexChange(0);
          return;
        }
        if (e.key === 'End') {
          e.preventDefault();
          onHighlightedOrderIndexChange(clampIndex(len - 1, len));
          return;
        }
        if (e.key === 'Enter') {
          const order = ordersRef.current[highlightedOrderRef.current];
          if (!order?.id) return;
          e.preventDefault();
          onOpenOrder(order.id);
        }
        return;
      }

      if (activeTab === 'bills') {
        const len = billsRef.current.length;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          onHighlightedBillIndexChange(clampIndex(highlightedBillRef.current + 1, len));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          onHighlightedBillIndexChange(clampIndex(highlightedBillRef.current - 1, len));
          return;
        }
        if (e.key === 'Home') {
          e.preventDefault();
          onHighlightedBillIndexChange(0);
          return;
        }
        if (e.key === 'End') {
          e.preventDefault();
          onHighlightedBillIndexChange(clampIndex(len - 1, len));
          return;
        }
        if (e.key === 'Enter') {
          const bill = billsRef.current[highlightedBillRef.current];
          if (!bill) return;
          if (bill.purchaseOrderId) {
            e.preventDefault();
            onOpenBillOrder(bill);
            return;
          }
          if (bill.onCreditAmount <= 0) return;
          e.preventDefault();
          onRecordPaymentForBill(bill);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    enabled,
    onBack,
    onHighlightedBillIndexChange,
    onHighlightedOrderIndexChange,
    onOpenOrder,
    onOpenBillOrder,
    onRecordPaymentForBill,
  ]);
}
