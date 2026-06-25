import type { PurchaseOrder } from '@/services/purchase.service';

export function isReceivablePurchaseOrder(order: PurchaseOrder): boolean {
  if (order.status === 'draft' || order.status === 'cancelled' || order.status === 'completed') {
    return false;
  }
  return order.totalPendingQty > 0;
}

export function filterReceivablePurchaseOrders(
  orders: PurchaseOrder[],
  query: string
): PurchaseOrder[] {
  const receivable = orders.filter(isReceivablePurchaseOrder);
  const q = query.trim().toLowerCase();
  if (!q) return receivable;
  return receivable.filter(
    (o) =>
      o.poNumber.toLowerCase().includes(q) ||
      o.supplierName.toLowerCase().includes(q) ||
      o.supplierId.toLowerCase().includes(q)
  );
}
