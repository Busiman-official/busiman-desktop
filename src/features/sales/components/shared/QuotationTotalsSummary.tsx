import React from 'react';
import type { SalesQuotation } from '@/services/sales.service';
import './QuotationTotalsSummary.css';

function formatInr(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Item subtotal (ex-GST) — matches PDF Sub-Total (items) row. */
export function quotationItemsSubtotalInr(q: Pick<SalesQuotation, 'lines'>): number {
  return Math.round(
    (q.lines || []).reduce((s, ln) => s + Number(ln.lineTotal ?? 0), 0) * 100
  ) / 100;
}

export const QuotationTotalsSummary: React.FC<{ quotation: SalesQuotation; className?: string }> = ({
  quotation,
  className = '',
}) => {
  const q = quotation;
  const itemsSub = quotationItemsSubtotalInr(q);
  const orderDisc = Number(q.discountAmount ?? 0);
  const tax = Number(q.taxAmount ?? 0);
  const delivery = Number(q.deliveryAmount ?? 0);
  const total = Number(q.total ?? 0);

  return (
    <dl className={`quot-totals ${className}`.trim()}>
      <div className="quot-totals__row">
        <dt>Items subtotal</dt>
        <dd>{formatInr(itemsSub)}</dd>
      </div>
      {orderDisc > 0 ? (
        <div className="quot-totals__row quot-totals__row--disc">
          <dt>Order discount</dt>
          <dd>−{formatInr(orderDisc)}</dd>
        </div>
      ) : null}
      {tax > 0 ? (
        <div className="quot-totals__row">
          <dt>GST / tax</dt>
          <dd>{formatInr(tax)}</dd>
        </div>
      ) : null}
      {delivery > 0 ? (
        <div className="quot-totals__row">
          <dt>Delivery</dt>
          <dd>{formatInr(delivery)}</dd>
        </div>
      ) : null}
      <div className="quot-totals__row quot-totals__row--grand">
        <dt>Total</dt>
        <dd>{formatInr(total)}</dd>
      </div>
    </dl>
  );
};
