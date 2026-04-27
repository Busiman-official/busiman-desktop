import React from 'react';
import type { PosCartLine } from './usePosCart';

interface Props {
  line: PosCartLine;
  lineTotal: number;
  highlight: boolean;
  available?: number;
  showStockWarning: boolean;
  onQtyChange: (variantId: string, qty: number) => void;
  onRemove: (variantId: string) => void;
}

/**
 * Extension points: when serial/batch capture ships, open modals from here using line.serialWarning / line.batchWarning.
 */
export const PosCartLineCard: React.FC<Props> = ({
  line,
  lineTotal,
  highlight,
  available,
  showStockWarning,
  onQtyChange,
  onRemove,
}) => (
  <div className={`pos-line-card ${highlight ? 'pos-line-card--flash' : ''}`}>
    <div className="pos-line-card__main">
      <div className="pos-line-card__title">{line.label}</div>
      <div className="pos-line-card__sub">{line.sku}</div>
      {(line.serialWarning || line.batchWarning) && (
        <div className="pos-line-card__stub" role="status">
          {line.serialWarning ? 'Serial numbers: capture coming soon. ' : null}
          {line.batchWarning ? 'Batch selection: coming soon.' : null}
        </div>
      )}
      {showStockWarning && available !== undefined && (
        <div className="pos-line-card__warn">
          Only {available} available at this location (cart needs {line.quantity}).
        </div>
      )}
    </div>
    <div className="pos-line-card__controls">
      <div className="pos-line-card__stepper">
        <button
          type="button"
          className="pos-stepper-btn"
          aria-label="Decrease quantity"
          onClick={() => onQtyChange(line.variantId, line.quantity - 1)}
        >
          −
        </button>
        <span className="pos-stepper-val">{line.quantity}</span>
        <button
          type="button"
          className="pos-stepper-btn"
          aria-label="Increase quantity"
          onClick={() => onQtyChange(line.variantId, line.quantity + 1)}
        >
          +
        </button>
      </div>
      <div className="pos-line-card__prices">
        <span className="pos-line-card__unit">₹{line.unitPrice.toFixed(2)} / {line.unitOfMeasure || line.baseUnit || 'ea'}</span>
        <span className="pos-line-card__line-total">₹{lineTotal.toFixed(2)}</span>
      </div>
      <button type="button" className="pos-line-card__remove" onClick={() => onRemove(line.variantId)}>
        Remove
      </button>
    </div>
  </div>
);
