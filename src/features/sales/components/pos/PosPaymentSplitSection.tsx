import React from "react";
import {
  isCashMethodCode,
  supportsPaymentDetailsModal,
  paymentDetailsFilled,
  type PosPaymentOption,
  type PosPaymentMethodDetails,
} from "./posPaymentSplit";

type Props = {
  payOpts: PosPaymentOption[];
  total: number;
  disabled: boolean;
  nonCashInputs: Record<string, string>;
  cashAmount: number;
  onAccountInput: string;
  onAccountAmount: number;
  onAccountNeedsCustomer: boolean;
  paidNow: number;
  unallocated: number;
  detailsByMethod: Record<string, PosPaymentMethodDetails | undefined>;
  overAllocated: boolean;
  onNonCashChange: (methodCode: string, raw: string) => void;
  onOnAccountChange: (raw: string) => void;
  onOpenDetails: (methodCode: string, label: string) => void;
  /** Label for pending supplier balance (default: On account). */
  onAccountLabel?: string;
  onAccountTitle?: string;
  onAccountInputRef?: React.RefObject<HTMLInputElement | null>;
  registerPaymentInputRef?: (methodCode: string, el: HTMLInputElement | null) => void;
  onPaymentInputKeyDown?: (methodCode: string, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onOnAccountKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** When true, cash is editable and not auto-computed as remainder. */
  manualTenderEntry?: boolean;
  tenderInputs?: Record<string, string>;
  onTenderChange?: (methodCode: string, raw: string) => void;
};

function DocumentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

export const PosPaymentSplitSection: React.FC<Props> = ({
  payOpts,
  total,
  disabled,
  nonCashInputs,
  cashAmount,
  onAccountInput,
  onAccountAmount,
  onAccountNeedsCustomer,
  paidNow,
  unallocated,
  detailsByMethod,
  overAllocated,
  onNonCashChange,
  onOnAccountChange,
  onOpenDetails,
  onAccountLabel = "On account",
  onAccountTitle,
  onAccountInputRef,
  registerPaymentInputRef,
  onPaymentInputKeyDown,
  onOnAccountKeyDown,
  manualTenderEntry = false,
  tenderInputs,
  onTenderChange,
}) => {
  if (payOpts.length === 0) return null;

  const showSummary =
    total > 0 && (paidNow > 0 || onAccountAmount > 0 || Math.abs(unallocated) > 0.0001);

  return (
    <div className="pos-payment-split" role="group" aria-label="Payment split">
      <div className="pos-payment-split__row">
        {payOpts.map((p) => {
          const isCash = isCashMethodCode(p.value);
          const showDetails = supportsPaymentDetailsModal(p.value);
          const hasDetails = paymentDetailsFilled(detailsByMethod[p.value]);
          const manual = manualTenderEntry && tenderInputs && onTenderChange;
          const displayAmount = manual
            ? (tenderInputs[p.value] ?? "")
            : isCash
              ? total > 0
                ? cashAmount.toFixed(2)
                : "0"
              : (nonCashInputs[p.value] ?? "");

          return (
            <div
              key={p.value}
              className={[
                "pos-payment-split__cell",
                isCash ? "pos-payment-split__cell--cash" : "",
                showDetails ? "pos-payment-split__cell--details" : "",
                hasDetails ? "pos-payment-split__cell--has-proof" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="pos-payment-split__label">{p.label}</span>
              <div className="pos-payment-split__amount">
                <input
                  type="number"
                  className="pos-payment-split__input no-spinner"
                  min={0}
                  step="0.01"
                  value={displayAmount}
                  readOnly={isCash && !manual}
                  disabled={disabled}
                  ref={(el) => registerPaymentInputRef?.(p.value, el)}
                  onChange={(e) =>
                    manual ? onTenderChange!(p.value, e.target.value) : onNonCashChange(p.value, e.target.value)
                  }
                  onKeyDown={(e) => onPaymentInputKeyDown?.(p.value, e)}
                  aria-label={`${p.label} amount`}
                  aria-readonly={isCash && !manual}
                />
              </div>
              {showDetails ? (
                <button
                  type="button"
                  className="pos-payment-split__details-btn"
                  onClick={() => onOpenDetails(p.value, p.label)}
                  disabled={disabled}
                  aria-label={`${p.label} payment details`}
                  title={hasDetails ? `${p.label} details saved` : `Add ${p.label} details`}
                >
                  <DocumentIcon />
                </button>
              ) : null}
            </div>
          );
        })}
        <div
          className={[
            "pos-payment-split__cell",
            "pos-payment-split__cell--onaccount",
            onAccountAmount > 0 ? "pos-payment-split__cell--onaccount-active" : "",
            onAccountNeedsCustomer && onAccountAmount > 0 ? "pos-payment-split__cell--onaccount-warn" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          title={
            onAccountTitle ??
            (onAccountNeedsCustomer
              ? "Enter amount here; select a customer at checkout to put it on account"
              : "Pending balance — deducted from cash above")
          }
        >
          <span className="pos-payment-split__label">{onAccountLabel}</span>
          <div className="pos-payment-split__amount">
            <input
              type="number"
              className="pos-payment-split__input no-spinner"
              min={0}
              step="0.01"
              value={onAccountInput}
              disabled={disabled}
              ref={onAccountInputRef}
              onChange={(e) => onOnAccountChange(e.target.value)}
              onKeyDown={onOnAccountKeyDown}
              aria-label={`${onAccountLabel} pending amount`}
            />
          </div>
        </div>
      </div>
      
    </div>
  );
};
