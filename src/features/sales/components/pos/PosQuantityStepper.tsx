import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampPosQuantity,
  formatPosQuantityDisplay,
  isPosQuantityDraftAllowed,
  parsePosQuantityInput,
} from './posQuantity';
import './PosQuantityStepper.css';

export interface PosQuantityStepperProps {
  quantity: number;
  onCommit: (next: number) => void;
  min?: number;
  max?: number;
  /** ± button delta (default 1). */
  step?: number;
  disabled?: boolean;
  buttonClassName: string;
  inputClassName: string;
  decrementAriaLabel?: string;
  incrementAriaLabel?: string;
  inputAriaLabel?: string;
}

/**
 * ± stepper with an editable quantity field (supports decimals, e.g. 0.5 L).
 * Commits on blur or Enter; Escape reverts.
 */
export const PosQuantityStepper: React.FC<PosQuantityStepperProps> = ({
  quantity,
  onCommit,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  disabled = false,
  buttonClassName,
  inputClassName,
  decrementAriaLabel = 'Decrease quantity',
  incrementAriaLabel = 'Increase quantity',
  inputAriaLabel = 'Quantity',
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatPosQuantityDisplay(quantity));
  const inputRef = useRef<HTMLInputElement>(null);

  const safeMax = Number.isFinite(max) ? max : Number.MAX_SAFE_INTEGER;
  const bumpDelta = Number.isFinite(step) && step > 0 ? step : 1;

  useEffect(() => {
    if (!editing) setDraft(formatPosQuantityDisplay(quantity));
  }, [quantity, editing]);

  const commit = useCallback(() => {
    const parsed = parsePosQuantityInput(draft);
    if (parsed === null) {
      setDraft(formatPosQuantityDisplay(quantity));
      setEditing(false);
      return;
    }
    const next = clampPosQuantity(parsed, min, safeMax);
    onCommit(next);
    setEditing(false);
    setDraft(formatPosQuantityDisplay(next));
  }, [draft, min, safeMax, onCommit, quantity]);

  const bump = (delta: number) => {
    const next = clampPosQuantity(quantity + delta * bumpDelta, min, safeMax);
    onCommit(next);
  };

  const atMin = quantity <= min + 1e-9;
  const atMax = quantity >= safeMax - 1e-9;

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        aria-label={decrementAriaLabel}
        disabled={disabled || atMin}
        onClick={() => bump(-1)}
      >
        −
      </button>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={inputAriaLabel}
        className={inputClassName}
        disabled={disabled}
        value={editing ? draft : formatPosQuantityDisplay(quantity)}
        onFocus={() => {
          setEditing(true);
          setDraft(formatPosQuantityDisplay(quantity));
          inputRef.current?.select();
        }}
        onChange={(e) => {
          const t = e.target.value;
          if (isPosQuantityDraftAllowed(t)) setDraft(t);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            inputRef.current?.blur();
          }
          if (e.key === 'Escape') {
            setDraft(formatPosQuantityDisplay(quantity));
            setEditing(false);
            inputRef.current?.blur();
          }
        }}
      />
      <button
        type="button"
        className={buttonClassName}
        aria-label={incrementAriaLabel}
        disabled={disabled || atMax}
        onClick={() => bump(1)}
      >
        +
      </button>
    </>
  );
};
