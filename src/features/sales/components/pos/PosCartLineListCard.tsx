import React from 'react';
import type { PosCartLine } from './usePosCart';
import { PosQuantityStepper } from './PosQuantityStepper';

interface Props {
  line: PosCartLine;
  lineTotal: number;
  selected: boolean;
  flash: boolean;
  available?: number;
  showStockWarning: boolean;
  onSelect: () => void;
  /** Set absolute quantity (0 removes line in parent). */
  onQuantityChange: (quantity: number) => void;
  onUnitChange: (unitOfMeasure: string) => void;
}

/**
 * Full-width cart row: open detail modal from the main area; adjust qty with ± without opening the modal.
 */
export const PosCartLineListCard: React.FC<Props> = ({
  line,
  lineTotal,
  selected,
  flash,
  available,
  showStockWarning,
  onSelect,
  onQuantityChange,
  onUnitChange,
}) => {
  const onMainKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      className={`pos-cart-list-card ${selected ? 'pos-cart-list-card--selected' : ''} ${flash ? 'pos-cart-list-card--flash' : ''}`}
    >
      <div className="pos-cart-list-card__row">
        <div
          className="pos-cart-list-card__main"
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          onClick={onSelect}
          onKeyDown={onMainKeyDown}
        >
          <div className="pos-cart-list-card__name">{line.label}</div>
          <div className="pos-cart-list-card__sku">{line.sku}</div>
          {(line.serialWarning || line.batchWarning) && (
            <div className="pos-cart-list-card__stub" role="status">
              {line.serialWarning ? 'Serial capture: coming soon. ' : null}
              {line.batchWarning ? 'Batch: coming soon.' : null}
            </div>
          )}
          {showStockWarning && available !== undefined && (
            <div className="pos-cart-list-card__warn">
              Only {available} available (need {line.quantity}).
            </div>
          )}
        </div>
        <div className="pos-cart-list-card__side">
          <div className="pos-cart-list-card__prices">
            <span className="pos-cart-list-card__unit">
              ₹{line.unitPrice.toFixed(2)} / {line.unitOfMeasure || line.baseUnit || 'ea'}
            </span>
            <span className="pos-cart-list-card__total">₹{lineTotal.toFixed(2)}</span>
          </div>
          <div
            className="pos-cart-list-line-stepper"
            aria-live="polite"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <PosQuantityStepper
              quantity={line.quantity}
              onCommit={onQuantityChange}
              min={0}
              max={999_999}
              buttonClassName="pos-cart-list-line-stepper__btn"
              inputClassName="pos-cart-list-line-stepper__val pos-qty-stepper__input"
              inputAriaLabel={`Quantity for ${line.label}`}
            />
          </div>
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <select
              aria-label="Line unit"
              value={line.unitOfMeasure || line.baseUnit || ''}
              onChange={(e) => onUnitChange(e.target.value)}
            >
              {(line.unitOptions?.length ? line.unitOptions : [{ unitCode: line.baseUnit || 'pcs', factorToBase: 1 }]).map((u) => (
                <option key={u.unitCode} value={u.unitCode}>
                  {u.unitCode}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
