import React, { useMemo } from 'react';
import { Button, Input, Select, Textarea } from '@/shared/components/ui';
import type { PosCartLine } from './usePosCart';
import { PosQuantityStepper } from './PosQuantityStepper';
import { formatPosQuantityDisplay, POS_QTY_MIN } from './posQuantity';
import {
  POS_GST_RATE_OPTIONS,
  getLineDiscountAmount,
  getLineGstAmount,
  getLineNetAfterDiscount,
  getLineTaxableNetAfterDiscount,
  isGstInclusive,
  normalizePosGstRatePercent,
} from './posLineMath';
import './PosCartItemDetailPanel.css';

interface Props {
  line: PosCartLine | null;
  branchTaxPercent: number;
  onUpdate: (patch: Partial<PosCartLine>) => void;
  onRemove: () => void;
  onSave: () => void;
  onClose: () => void;
  /** When true, render for placement inside a dialog (no sidebar chrome / empty placeholder). */
  embeddedInModal?: boolean;
}

export const PosCartItemDetailPanel: React.FC<Props> = ({
  line,
  branchTaxPercent,
  onUpdate,
  onRemove,
  onSave,
  onClose,
  embeddedInModal = false,
}) => {
  const effectiveGst = line ? (line.gstRatePercent ?? normalizePosGstRatePercent(branchTaxPercent)) : 0;

  const summary = useMemo(() => {
    if (!line) return null;
    const branchGst = normalizePosGstRatePercent(branchTaxPercent);
    const subtotal = line.quantity * line.unitPrice;
    const discount = getLineDiscountAmount(line);
    const net = getLineNetAfterDiscount(line);
    const taxable = getLineTaxableNetAfterDiscount(line, branchGst);
    const gst = getLineGstAmount(line, branchGst);
    const inclusive = isGstInclusive(line);
    const total = inclusive ? net : net + gst;
    return { subtotal, discount, net, taxable, gst, total, inclusive };
  }, [line, branchTaxPercent]);

  if (!line) {
    if (embeddedInModal) return null;
    return (
      <aside className="pos-detail-panel pos-detail-panel--empty" aria-label="Line details">
        <div className="pos-detail-panel__placeholder">
          <p className="pos-detail-panel__placeholder-title">Select a product</p>
          <p className="pos-detail-panel__placeholder-sub">Click a line in the cart to edit quantity, price, GST, and more.</p>
        </div>
      </aside>
    );
  }

  const Wrapper: React.ElementType = embeddedInModal ? 'div' : 'aside';
  const rootClass = embeddedInModal ? 'pos-detail-panel pos-detail-panel--modal' : 'pos-detail-panel';

  return (
    <Wrapper className={rootClass} aria-label="Edit line">
      <header className="pos-detail-panel__header">
        <div className="pos-detail-panel__header-text">
          <h3 className="pos-detail-panel__title">{line.label}</h3>
          <p className="pos-detail-panel__sku">SKU: {line.sku}</p>
        </div>
        <button type="button" className="pos-detail-panel__close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>

      <div className="pos-detail-panel__body">
        <section className="pos-detail-section">
          <h4 className="pos-detail-section__label">Quantity &amp; price</h4>

          <div className="pos-detail-qty-row">
            <span className="pos-detail-section__hint">Quantity</span>
            <div className="pos-detail-stepper">
              <PosQuantityStepper
                quantity={line.quantity}
                onCommit={(n) => onUpdate({ quantity: n })}
                min={POS_QTY_MIN}
                max={999_999}
                buttonClassName="pos-detail-stepper__btn"
                inputClassName="pos-detail-stepper__val pos-qty-stepper__input"
                inputAriaLabel={`Quantity for ${line.label}`}
              />
              <Select
                value={line.unitOfMeasure || line.baseUnit || 'pcs'}
                onChange={(e) => onUpdate({ unitOfMeasure: e.target.value })}
              >
                {(line.unitOptions?.length ? line.unitOptions : [{ unitCode: line.baseUnit || 'pcs', factorToBase: 1 }]).map((u) => (
                  <option key={u.unitCode} value={u.unitCode}>
                    {u.unitCode}{u.factorToBase > 1 ? ` (1 = ${u.factorToBase} ${line.baseUnit || 'pcs'})` : ''}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <Input
            label={isGstInclusive(line) ? 'Unit price (₹, incl. GST)' : 'Unit price (₹, excl. GST)'}
            type="number"
            onFocus={(e) => e.target.select()}
            min={0}
            step={0.01}
            value={line.unitPrice}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onUpdate({ unitPrice: Number.isFinite(v) && v >= 0 ? v : 0 });
            }}
          />
        </section>

        <section className="pos-detail-section">
          <h4 className="pos-detail-section__label">GST</h4>
          <div className="pos-detail-gst-mode" role="radiogroup" aria-label="GST pricing">
            <button
              type="button"
              className={`pos-detail-gst-mode__opt ${isGstInclusive(line) ? 'pos-detail-gst-mode__opt--active' : ''}`}
              onClick={() => onUpdate({ gstInclusive: true })}
            >
              GST included
            </button>
            <button
              type="button"
              className={`pos-detail-gst-mode__opt ${!isGstInclusive(line) ? 'pos-detail-gst-mode__opt--active' : ''}`}
              onClick={() => onUpdate({ gstInclusive: false })}
            >
              GST extra
            </button>
          </div>
          <p className="pos-detail-section__fineprint">
            {isGstInclusive(line)
              ? 'Unit price includes GST at the rate below. Line discount applies to this inclusive amount. Checkout sends tax-exclusive amounts to match branch tax settings.'
              : 'GST is calculated on the amount after line discount and added to the line total. Checkout uses branch tax settings for charging.'}
          </p>
          <div className="pos-detail-gst-pills" role="group" aria-label="GST rate">
            {POS_GST_RATE_OPTIONS.map((rate) => (
              <button
                key={rate}
                type="button"
                className={`pos-detail-gst-pill ${effectiveGst === rate ? 'pos-detail-gst-pill--active' : ''}`}
                onClick={() => onUpdate({ gstRatePercent: rate })}
              >
                {rate === 0 ? 'No GST' : `${rate}%`}
              </button>
            ))}
          </div>
        </section>

        <section className="pos-detail-section">
          <h4 className="pos-detail-section__label">Discount</h4>
          <div className="pos-detail-discount-row">
            <Select
              label="Type"
              value={line.lineDiscountType ?? 'flat'}
              onChange={(e) => onUpdate({ lineDiscountType: e.target.value as 'flat' | 'percent' })}
            >
              <option value="flat">Flat (₹)</option>
              <option value="percent">Percentage (%)</option>
            </Select>
            <Input
              label={line.lineDiscountType === 'percent' ? 'Percent' : 'Amount (₹)'}
              type="number"
              onFocus={(e) => e.target.select()}
              min={0}
              step={line.lineDiscountType === 'percent' ? 1 : 0.01}
              value={line.lineDiscountValue ?? 0}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onUpdate({ lineDiscountValue: Number.isFinite(v) && v >= 0 ? v : 0 });
              }}
            />
          </div>
        </section>

        <section className="pos-detail-section">
          <h4 className="pos-detail-section__label">Extra details</h4>
          <Textarea
            label="Notes"
            value={line.notes ?? ''}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            rows={3}
            placeholder="Line note for this sale…"
          />
          <Input
            label="HSN / SAC"
            value={line.hsn ?? ''}
            onChange={(e) => onUpdate({ hsn: e.target.value })}
            placeholder="e.g. 0402"
          />
        </section>

        {summary && (
          <div className="pos-detail-summary">
            <div className="pos-detail-summary__row">
              <span>{summary.inclusive ? 'Unit price (incl. GST)' : 'Unit price (excl. GST)'}</span>
              <span>₹{line.unitPrice.toFixed(2)}</span>
            </div>
            <div className="pos-detail-summary__row">
              <span>Quantity</span>
              <span>
                × {formatPosQuantityDisplay(line.quantity)} {line.unitOfMeasure || line.baseUnit || 'pcs'}
              </span>
            </div>
            <div className="pos-detail-summary__row">
              <span>Subtotal</span>
              <span>₹{summary.subtotal.toFixed(2)}</span>
            </div>
            <div className="pos-detail-summary__row pos-detail-summary__row--deduct">
              <span>Discount</span>
              <span>−₹{summary.discount.toFixed(2)}</span>
            </div>
            {summary.inclusive && effectiveGst > 0 ? (
              <div className="pos-detail-summary__row">
                <span>Taxable value (ex-GST)</span>
                <span>₹{summary.taxable.toFixed(2)}</span>
              </div>
            ) : null}
            <div className="pos-detail-summary__row">
              <span>
                GST ({effectiveGst}%)
                {summary.inclusive ? ' (part of line)' : ''}
              </span>
              <span>₹{summary.gst.toFixed(2)}</span>
            </div>
            <div className="pos-detail-summary__row pos-detail-summary__row--total">
              <span>Total</span>
              <span>₹{summary.total.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      <footer className="pos-detail-panel__footer">
        <Button type="button" variant="secondary" className="pos-detail-panel__remove" onClick={onRemove}>
          Remove item
        </Button>
        <Button type="button" variant="primary" onClick={onSave}>
          Save changes
        </Button>
      </footer>
    </Wrapper>
  );
};
