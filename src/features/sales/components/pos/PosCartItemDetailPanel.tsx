import React, { useEffect, useMemo, useRef } from 'react';
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
import { ReceivingLocationSelect } from '@/features/inventory/components/ReceivingLocationSelect';
import { PosSerialCaptureSection, type PosSerialCaptureSectionHandle } from './PosSerialCaptureSection';
import { trimSerialsToQuantity, trimNewSerials } from './posSerialUtils';
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
  /** Focus unit price when the modal opens (search add flow). */
  focusPriceOnMount?: boolean;
  /** Focus serial input when the modal opens (serialized product add / incomplete line). */
  focusSerialOnMount?: boolean;
  /** Sales point stock location for serial ISSUE validation. */
  salesLocationId?: string | null;
  /** Serials on other cart lines (duplicate guard). */
  otherCartSerials?: string[];
  /** Receipt counter: qty, unit, cost, notes only (no GST/discount). */
  mode?: 'sales' | 'receipt';
  receiptBranchId?: string | null;
  headerDefaultLocationId?: string | null;
}

export const PosCartItemDetailPanel: React.FC<Props> = ({
  line,
  branchTaxPercent,
  onUpdate,
  onRemove,
  onSave,
  onClose,
  embeddedInModal = false,
  focusPriceOnMount = false,
  focusSerialOnMount = false,
  salesLocationId = null,
  otherCartSerials = [],
  mode = 'sales',
  receiptBranchId = null,
  headerDefaultLocationId = null,
}) => {
  const isReceipt = mode === 'receipt';
  const priceInputRef = useRef<HTMLInputElement>(null);
  const serialSectionRef = useRef<PosSerialCaptureSectionHandle>(null);
  const effectiveGst = line ? (line.gstRatePercent ?? normalizePosGstRatePercent(branchTaxPercent)) : 0;

  useEffect(() => {
    if (!embeddedInModal || !line) return;
    if (focusSerialOnMount && line.serialWarning) return;
    if (!focusPriceOnMount) return;
    const id = window.requestAnimationFrame(() => {
      priceInputRef.current?.focus();
      priceInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [embeddedInModal, focusPriceOnMount, focusSerialOnMount, line?.serialWarning, line?.variantId]);

  const summary = useMemo(() => {
    if (!line) return null;
    if (isReceipt) {
      const lineTotal = line.quantity * line.unitPrice;
      return { lineTotal };
    }
    const branchGst = normalizePosGstRatePercent(branchTaxPercent);
    const subtotal = line.quantity * line.unitPrice;
    const discount = getLineDiscountAmount(line);
    const net = getLineNetAfterDiscount(line);
    const taxable = getLineTaxableNetAfterDiscount(line, branchGst);
    const gst = getLineGstAmount(line, branchGst);
    const inclusive = isGstInclusive(line);
    const total = inclusive ? net : net + gst;
    return { subtotal, discount, net, taxable, gst, total, inclusive };
  }, [branchTaxPercent, isReceipt, line]);

  if (!line) {
    if (embeddedInModal) return null;
    return (
      <aside className="pos-detail-panel pos-detail-panel--empty" aria-label="Line details">
        <div className="pos-detail-panel__placeholder">
          <p className="pos-detail-panel__placeholder-title">Select a product</p>
          <p className="pos-detail-panel__placeholder-sub">
            {isReceipt
              ? 'Click a line in the cart to edit quantity, unit cost, and notes.'
              : 'Click a line in the cart to edit quantity, price, GST, and more.'}
          </p>
        </div>
      </aside>
    );
  }

  const Wrapper: React.ElementType = embeddedInModal ? 'div' : 'aside';
  const rootClass = embeddedInModal ? 'pos-detail-panel pos-detail-panel--modal' : 'pos-detail-panel';

  const isSerialLine = !isReceipt && line.serialWarning === true;

  const handleQtyCommit = (n: number) => {
    if (isSerialLine) {
      const keptSerials = trimSerialsToQuantity(line, n);
      onUpdate({
        quantity: n,
        serialNumbers: keptSerials,
        newSerialNumbers: trimNewSerials(line, keptSerials),
      });
      return;
    }
    onUpdate({ quantity: n });
  };

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
                onCommit={handleQtyCommit}
                min={POS_QTY_MIN}
                max={999_999}
                buttonClassName="pos-detail-stepper__btn"
                inputClassName="pos-detail-stepper__val pos-qty-stepper__input"
                inputAriaLabel={`Quantity for ${line.label}`}
              />
              <Select
                value={line.unitOfMeasure || line.baseUnit || 'pcs'}
                onChange={(e) => onUpdate({ unitOfMeasure: e.target.value })}
                disabled={isSerialLine}
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
            ref={priceInputRef}
            label={isReceipt ? 'Unit cost (₹)' : isGstInclusive(line) ? 'Unit price (₹, incl. GST)' : 'Unit price (₹, excl. GST)'}
            type="number"
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              // This item can carry a serial — Enter here hands off to the scan input instead of
              // saving/closing, so a cashier who tabs into price first (or has it auto-focused,
              // see focusPriceOnMount) can't blow past capturing/skipping the serial by accident.
              // The scan input's own empty-Enter (see onEmptyEnter below) is what actually closes.
              if (isSerialLine) {
                serialSectionRef.current?.focus();
                return;
              }
              onSave();
            }}
            min={0}
            step={0.01}
            value={line.unitPrice}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onUpdate({ unitPrice: Number.isFinite(v) && v >= 0 ? v : 0 });
            }}
          />
        </section>

        {isSerialLine ? (
          <PosSerialCaptureSection
            ref={serialSectionRef}
            line={line}
            salesLocationId={salesLocationId}
            otherCartSerials={otherCartSerials}
            focusOnMount={focusSerialOnMount && embeddedInModal}
            onSerialNumbersChange={(serialNumbers, newSerialNumbers, quantity) =>
              onUpdate({
                serialNumbers,
                newSerialNumbers,
                ...(quantity != null ? { quantity } : {}),
              })
            }
            onEmptyEnter={onSave}
          />
        ) : null}

        {isReceipt && receiptBranchId ? (
          <section className="pos-detail-section">
            <ReceivingLocationSelect
              branchId={receiptBranchId}
              label="Storage location"
              value={line.toLocationId ?? headerDefaultLocationId}
              onChange={(locationId, meta) =>
                onUpdate({ toLocationId: locationId, toLocationPath: meta.pathLabel })
              }
            />
          </section>
        ) : null}

        {!isReceipt ? (
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
        ) : null}

        {!isReceipt ? (
        <section className="pos-detail-section">
          <h4 className="pos-detail-section__label">Discount</h4>
          <div className="pos-detail-discount-row">
            <Select
              label="Type"
              value={line.lineDiscountType ?? 'per_unit'}
              onChange={(e) =>
                onUpdate({ lineDiscountType: e.target.value as 'per_unit' | 'flat' | 'percent' })
              }
            >
              <option value="per_unit">Per product (₹)</option>
              <option value="flat">Flat (₹)</option>
              <option value="percent">Percentage (%)</option>
            </Select>
            <Input
              label={
                line.lineDiscountType === 'percent'
                  ? 'Percent'
                  : line.lineDiscountType === 'flat'
                    ? 'Amount (₹)'
                    : 'Per unit (₹)'
              }
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
        ) : null}

        <section className="pos-detail-section">
          <h4 className="pos-detail-section__label">Extra details</h4>
          <Textarea
            label="Notes"
            value={line.notes ?? ''}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            rows={3}
            placeholder={isReceipt ? 'Line note for this receipt…' : 'Line note for this sale…'}
          />
          {!isReceipt ? (
          <Input
            label="HSN / SAC"
            value={line.hsn ?? ''}
            onChange={(e) => onUpdate({ hsn: e.target.value })}
            placeholder="e.g. 0402"
          />
          ) : null}
        </section>

        {summary && isReceipt ? (
          <div className="pos-detail-summary">
            <div className="pos-detail-summary__row">
              <span>Unit cost</span>
              <span>₹{line.unitPrice.toFixed(2)}</span>
            </div>
            <div className="pos-detail-summary__row">
              <span>Quantity</span>
              <span>
                × {formatPosQuantityDisplay(line.quantity)} {line.unitOfMeasure || line.baseUnit || 'pcs'}
              </span>
            </div>
            <div className="pos-detail-summary__row pos-detail-summary__row--total">
              <span>Line total</span>
              <span>₹{summary.lineTotal.toFixed(2)}</span>
            </div>
          </div>
        ) : null}

        {summary && !isReceipt && 'total' in summary ? (
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
        ) : null}
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
