import React from 'react';
import {
  formatInrAmount,
  formatPaymentDetailLines,
  paymentMethodChip,
  paymentMethodLabel,
  type PaymentMethodLabelSource,
  type SalesOrderPaymentLine,
} from '../../utils/orderPayments';
import './OrderPaymentsBreakdown.css';

type Props = {
  payments: SalesOrderPaymentLine[];
  methods?: PaymentMethodLabelSource;
  compact?: boolean;
  className?: string;
};

export const OrderPaymentsBreakdown: React.FC<Props> = ({
  payments,
  methods,
  compact = false,
  className = '',
}) => {
  if (!payments.length) return null;

  if (compact) {
    return (
      <ul className={`order-payments-breakdown order-payments-breakdown--compact ${className}`.trim()}>
        {payments.map((p, i) => {
          const chip = paymentMethodChip(p.methodCode, methods);
          return (
            <li key={`${p.methodCode}-${i}`} className="order-payments-breakdown__compact-line">
              <span className={chip.cls}>{chip.label}</span>
              <span className="order-payments-breakdown__amount">{formatInrAmount(p.amount)}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={`order-payments-breakdown ${className}`.trim()}>
      <table className="order-payments-breakdown__table">
        <thead>
          <tr>
            <th>Method</th>
            <th className="order-payments-breakdown__th-num">Amount</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p, i) => {
            const chip = paymentMethodChip(p.methodCode, methods);
            const detailLines = formatPaymentDetailLines(p.methodCode, p.details);
            const att = p.details?.attachment;
            return (
              <tr key={`${p.methodCode}-${i}`}>
                <td>
                  <span className={chip.cls}>{paymentMethodLabel(p.methodCode, methods)}</span>
                </td>
                <td className="order-payments-breakdown__td-num">{formatInrAmount(p.amount)}</td>
                <td>
                  {detailLines.length ? (
                    <ul className="order-payments-breakdown__details">
                      {detailLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="order-payments-breakdown__muted">—</span>
                  )}
                  {att?.url ? (
                    <div className="order-payments-breakdown__proof">
                      <a href={att.url} target="_blank" rel="noopener noreferrer">
                        {att.fileName?.trim() || 'View proof'}
                      </a>
                      {/\.(jpe?g|png|gif|webp)(\?|$)/i.test(att.url) ? (
                        <a
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="order-payments-breakdown__thumb-link"
                        >
                          <img src={att.url} alt="" className="order-payments-breakdown__thumb" />
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
