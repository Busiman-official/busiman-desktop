import React, { useCallback, useEffect, useRef, useState } from 'react';
import './PosQuantityStepper.css';

function clampInt(n: number, min: number, max: number): number {
  const v = Math.trunc(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export interface PosQuantityStepperProps {
  quantity: number;
  onCommit: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  buttonClassName: string;
  inputClassName: string;
  decrementAriaLabel?: string;
  incrementAriaLabel?: string;
  inputAriaLabel?: string;
}

/**
 * ± stepper with an editable quantity field (integer). Commits on blur or Enter; Escape reverts.
 */
export const PosQuantityStepper: React.FC<PosQuantityStepperProps> = ({
  quantity,
  onCommit,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  disabled = false,
  buttonClassName,
  inputClassName,
  decrementAriaLabel = 'Decrease quantity',
  incrementAriaLabel = 'Increase quantity',
  inputAriaLabel = 'Quantity',
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(quantity));
  const inputRef = useRef<HTMLInputElement>(null);

  const safeMax = Number.isFinite(max) ? max : Number.MAX_SAFE_INTEGER;

  useEffect(() => {
    if (!editing) setDraft(String(quantity));
  }, [quantity, editing]);

  const commit = useCallback(() => {
    const raw = draft.trim();
    if (raw === '') {
      setDraft(String(quantity));
      setEditing(false);
      return;
    }
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(quantity));
      setEditing(false);
      return;
    }
    const next = clampInt(parsed, min, safeMax);
    onCommit(next);
    setEditing(false);
    setDraft(String(next));
  }, [draft, min, safeMax, onCommit, quantity]);

  const bump = (delta: number) => {
    const next = clampInt(quantity + delta, min, safeMax);
    onCommit(next);
  };

  const atMin = quantity <= min;
  const atMax = quantity >= safeMax;

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
        inputMode="numeric"
        autoComplete="off"
        aria-label={inputAriaLabel}
        className={inputClassName}
        disabled={disabled}
        value={editing ? draft : String(quantity)}
        onFocus={() => {
          setEditing(true);
          setDraft(String(quantity));
          inputRef.current?.select();
        }}
        onChange={(e) => {
          const t = e.target.value;
          if (t === '' || /^\d+$/.test(t)) setDraft(t);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            inputRef.current?.blur();
          }
          if (e.key === 'Escape') {
            setDraft(String(quantity));
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
