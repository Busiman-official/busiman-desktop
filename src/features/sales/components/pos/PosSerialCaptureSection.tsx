import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/shared/components/ui';
import {
  inventoryService,
  MovementType,
  type SerialResponse,
} from '@/services/inventory.service';
import {
  isBlockingSerialStatus,
  serialStatusToLabel,
  type SerialValidationStatus,
} from '@/features/inventory/utils/numberGridUtils';
import type { PosCartLine } from './usePosCart';
import {
  normalizePosSerial,
  pickedSerialCount,
  serialCountRequired,
} from './posSerialUtils';
import './PosSerialCaptureSection.css';

interface Props {
  line: PosCartLine;
  salesLocationId: string | null;
  /** Serials already picked on other cart lines (duplicate guard). */
  otherCartSerials: string[];
  onSerialNumbersChange: (serialNumbers: string[]) => void;
  focusOnMount?: boolean;
}

function serialErrorMessage(status: string, message?: string): string {
  if (message?.trim()) return message.trim();
  return serialStatusToLabel(status as SerialValidationStatus).replace(/^[^\s]+\s/, '');
}

export const PosSerialCaptureSection: React.FC<Props> = ({
  line,
  salesLocationId,
  otherCartSerials,
  onSerialNumbersChange,
  focusOnMount = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastKeyTimeRef = useRef(0);
  const [draft, setDraft] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [listFilter, setListFilter] = useState('');
  const [available, setAvailable] = useState<SerialResponse[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const picked = line.serialNumbers ?? [];
  const pickedSet = useMemo(() => new Set(picked.map(normalizePosSerial)), [picked]);
  const otherSet = useMemo(
    () => new Set(otherCartSerials.map(normalizePosSerial)),
    [otherCartSerials]
  );
  const required = serialCountRequired(line);
  const pickedCount = pickedSerialCount(line);
  const slotsLeft = Math.max(0, required - pickedCount);
  const isComplete = slotsLeft === 0 && required > 0;

  useEffect(() => {
    if (!focusOnMount) return;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [focusOnMount, line.variantId]);

  useEffect(() => {
    if (!line.itemId || !salesLocationId) {
      setAvailable([]);
      return;
    }
    let cancelled = false;
    setListLoading(true);
    inventoryService
      .getSerialsByItem(line.itemId, salesLocationId, 'AVAILABLE', line.variantId, 1, 200)
      .then((rows) => {
        if (!cancelled) setAvailable(rows);
      })
      .catch(() => {
        if (!cancelled) setAvailable([]);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [line.itemId, line.variantId, salesLocationId]);

  const refocusInput = useCallback(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const tryAddSerial = useCallback(
    async (raw: string) => {
      const sn = normalizePosSerial(raw);
      if (!sn) return;
      if (slotsLeft <= 0) {
        setInlineError(`Quantity is ${required}; remove a serial before adding another.`);
        return;
      }
      if (pickedSet.has(sn)) {
        setInlineError('Serial already added to this line.');
        return;
      }
      if (otherSet.has(sn)) {
        setInlineError('Serial already used on another line in this sale.');
        return;
      }
      if (!salesLocationId) {
        setInlineError('Sales location is not configured for this counter.');
        return;
      }

      setChecking(true);
      setInlineError(null);
      try {
        const res = await inventoryService.validateSerialsForMovement({
          itemId: line.itemId,
          movementType: MovementType.ISSUE,
          serialNumbers: [sn],
          fromLocationId: salesLocationId,
          variantId: line.variantId,
        });
        const row = res[0];
        if (!row?.allowForMovementType || isBlockingSerialStatus(row.status as SerialValidationStatus)) {
          setInlineError(serialErrorMessage(row?.status ?? 'NOT_FOUND', row?.message));
          return;
        }
        onSerialNumbersChange([...picked, sn]);
        setDraft('');
        setInlineError(null);
        refocusInput();
      } catch {
        setInlineError('Could not validate serial. Try again.');
      } finally {
        setChecking(false);
      }
    },
    [
      line.itemId,
      line.variantId,
      onSerialNumbersChange,
      otherSet,
      picked,
      pickedSet,
      refocusInput,
      required,
      salesLocationId,
      slotsLeft,
    ]
  );

  const commitDraft = useCallback(() => {
    if (checking) return;
    void tryAddSerial(draft);
  }, [checking, draft, tryAddSerial]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commitDraft();
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    const now = Date.now();
    const gap = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;
    if (gap > 0 && gap < 80 && next.length > draft.length) {
      // Scanner wedge: auto-commit when Enter follows rapid typing is handled on keydown.
    }
    setDraft(next);
    if (inlineError) setInlineError(null);
  };

  const filteredAvailable = useMemo(() => {
    const q = listFilter.trim().toUpperCase();
    return available.filter((s) => {
      const u = normalizePosSerial(s.serialNumber);
      if (pickedSet.has(u) || otherSet.has(u)) return false;
      if (!q) return true;
      return u.includes(q);
    });
  }, [available, listFilter, otherSet, pickedSet]);

  const removePicked = (sn: string) => {
    const u = normalizePosSerial(sn);
    onSerialNumbersChange(picked.filter((x) => normalizePosSerial(x) !== u));
    refocusInput();
  };

  return (
    <section className="pos-detail-section pos-serial-section" aria-labelledby="pos-serial-heading">
      <div className="pos-serial-section__head">
        <h4 id="pos-serial-heading" className="pos-detail-section__label pos-serial-section__title">
          Serial numbers
        </h4>
        <span
          className={`pos-serial-section__count ${isComplete ? 'pos-serial-section__count--done' : ''}`}
        >
          {pickedCount} of {required} {isComplete ? '✓' : 'required'}
        </span>
      </div>

      <div className="pos-serial-section__entry">
        <Input
          ref={inputRef}
          label="Scan or type serial number"
          value={draft}
          onChange={onInputChange}
          onKeyDown={onInputKeyDown}
          placeholder="Scan or type, then Enter"
          disabled={checking || slotsLeft <= 0}
          autoComplete="off"
          spellCheck={false}
        />
        {checking ? <p className="pos-serial-section__hint">Checking serial…</p> : null}
        {inlineError ? (
          <p className="pos-serial-section__error" role="alert">
            {inlineError}
          </p>
        ) : null}
      </div>

      {picked.length > 0 ? (
        <div className="pos-serial-section__picked">
          <span className="pos-serial-section__picked-label">Picked</span>
          <ul className="pos-serial-picked-list">
            {picked.map((sn) => (
              <li key={sn} className="pos-serial-picked-row">
                <span className="pos-serial-picked-row__sn">{sn}</span>
                <button
                  type="button"
                  className="pos-serial-picked-row__remove"
                  onClick={() => removePicked(sn)}
                  aria-label={`Remove serial ${sn}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="pos-serial-section__list-block">
        <div className="pos-serial-section__list-head">
          <span className="pos-serial-section__list-title">
            Available at counter
            {listLoading ? '…' : ` (${filteredAvailable.length})`}
          </span>
          <input
            type="search"
            className="pos-serial-section__list-search"
            value={listFilter}
            onChange={(e) => setListFilter(e.target.value)}
            placeholder="Filter list…"
            aria-label="Filter available serials"
          />
        </div>
        <div className="pos-serial-section__list" role="listbox" aria-label="Available serial numbers">
          {listLoading ? (
            <p className="pos-serial-section__list-empty">Loading…</p>
          ) : filteredAvailable.length === 0 ? (
            <p className="pos-serial-section__list-empty">
              {available.length === 0 ? 'No serials in stock at this counter.' : 'No matches.'}
            </p>
          ) : (
            filteredAvailable.map((s) => (
              <button
                key={s.id ?? s.serialNumber}
                type="button"
                role="option"
                className="pos-serial-section__list-row"
                disabled={checking || slotsLeft <= 0}
                onClick={() => void tryAddSerial(s.serialNumber)}
              >
                <span className="pos-serial-section__list-sn">{s.serialNumber}</span>
                {s.currentLocation?.code ? (
                  <span className="pos-serial-section__list-loc">{s.currentLocation.code}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
};
