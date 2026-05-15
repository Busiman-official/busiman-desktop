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
  detailsByMethod: Record<string, PosPaymentMethodDetails | undefined>;
  overAllocated: boolean;
  onNonCashChange: (methodCode: string, raw: string) => void;
  onOpenDetails: (methodCode: string, label: string) => void;
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
  detailsByMethod,
  overAllocated,
  onNonCashChange,
  onOpenDetails,
}) => {
  if (payOpts.length === 0) return null;

  return (
    <div className="pos-payment-split" role="group" aria-label="Payment split">
      <div className="pos-payment-split__row">
        {payOpts.map((p) => {
          const isCash = isCashMethodCode(p.value);
          const showDetails = supportsPaymentDetailsModal(p.value);
          const hasDetails = paymentDetailsFilled(detailsByMethod[p.value]);
          const displayAmount = isCash
            ? cashAmount
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
                  value={
                    isCash
                      ? total > 0
                        ? cashAmount.toFixed(2)
                        : "0"
                      : displayAmount
                  }
                  readOnly={isCash}
                  disabled={disabled}
                  onChange={(e) => onNonCashChange(p.value, e.target.value)}
                  aria-label={`${p.label} amount`}
                  aria-readonly={isCash}
                />
              </div>
              {showDetails ? (
                <button
                  type="button"
                  className="pos-payment-split__details-btn"
                  onClick={() => onOpenDetails(p.value, p.label)}
                  disabled={disabled}
                  aria-label={`${p.label} payment details`}
                  title={
                    hasDetails
                      ? `${p.label} details saved`
                      : `Add ${p.label} details`
                  }
                >
                  <DocumentIcon />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {overAllocated ? (
        <p className="pos-payment-split__error" role="alert">
          Split exceeds total — reduce card, UPI, or bank.
        </p>
      ) : null}
    </div>
  );
};
