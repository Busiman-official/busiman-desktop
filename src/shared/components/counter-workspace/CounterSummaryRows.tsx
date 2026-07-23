import React from 'react';

export interface CounterSummaryRowsProps {
  subtotal: number;
  total: number;
  adjustmentInput: string;
  onAdjustmentInputChange: (value: string) => void;
  /** discount subtracts from subtotal (sales); freight adds to subtotal (purchases). */
  adjustmentKind?: 'discount' | 'freight';
  adjustmentAriaLabel?: string;
  adjustmentInputRef?: React.RefObject<HTMLInputElement | null>;
  onAdjustmentKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  formatAmount?: (n: number) => string;
}

const defaultFormat = (n: number) => `₹${n.toFixed(2)}`;

export const CounterSummaryRows: React.FC<CounterSummaryRowsProps> = ({
  subtotal,
  total,
  adjustmentInput,
  onAdjustmentInputChange,
  adjustmentKind = 'discount',
  adjustmentAriaLabel,
  adjustmentInputRef,
  onAdjustmentKeyDown,
  formatAmount = defaultFormat,
}) => {
  const adjustmentLabel = adjustmentKind === 'freight' ? 'Freight' : 'Discount';
  const ariaLabel =
    adjustmentAriaLabel ||
    (adjustmentKind === 'freight' ? 'Freight charges amount' : 'Order discount amount');

  return (
  <div className="pos-summary__rows">
    <div className="pos-summary__row">
      <span>Subtotal</span>
      <span>{formatAmount(subtotal)}</span>
    </div>
    <div className="pos-summary__row">
      <span>{adjustmentLabel}</span>
      <span className="pos-summary__discount-inline">
        <span className="pos-summary__discount-currency">₹</span>
        <input
          ref={adjustmentInputRef}
          className="pos-summary__discount-field"
          type="number"
          min={0}
          step="0.01"
          value={adjustmentInput}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onAdjustmentInputChange(e.target.value)}
          onKeyDown={onAdjustmentKeyDown}
          aria-label={ariaLabel}
        />
      </span>
    </div>
    <div className="pos-summary__row pos-summary__row--total">
      <span>Total</span>
      <span>{formatAmount(total)}</span>
    </div>
  </div>
  );
};
