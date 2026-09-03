import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  isNewSerial,
} from './posSerialUtils';
import './PosSerialCaptureSection.css';

interface Props {
  line: PosCartLine;
  salesLocationId: string | null;
  /** Serials already picked on other cart lines (duplicate guard). */
  otherCartSerials: string[];
  /**
   * `quantity` is only passed when a scanned/picked serial pushes the count past the line's
   * current quantity — the input never blocks on "quantity full" (see tryAddSerial); instead the
   * quantity itself grows to match, same as a manual + on the stepper would.
   */
  onSerialNumbersChange: (serialNumbers: string[], newSerialNumbers?: string[], quantity?: number) => void;
  focusOnMount?: boolean;
  /**
   * Enter pressed on the scan input while it's empty — the parent (PosCartItemDetailPanel) treats
   * this as "nothing more to add here" and closes/saves, mirroring the old price-field Enter
   * behavior for lines that don't need a serial at all.
   */
  onEmptyEnter?: () => void;
}

export interface PosSerialCaptureSectionHandle {
  /** Focuses the scan input — used when Enter on the price field should redirect here instead of
   * closing the modal (see PosCartItemDetailPanel). No-ops if the input can't take focus right now
   * (e.g. disabled because the quantity's serial slots are already full). */
  focus: () => void;
}

function serialErrorMessage(status: string, message?: string): string {
  if (message?.trim()) return message.trim();
  return serialStatusToLabel(status as SerialValidationStatus).replace(/^[^\s]+\s/, '');
}

export const PosSerialCaptureSection = React.forwardRef<PosSerialCaptureSectionHandle, Props>(function PosSerialCaptureSection(
  {
    line,
    salesLocationId,
    otherCartSerials,
    onSerialNumbersChange,
    focusOnMount = false,
    onEmptyEnter,
  },
  forwardedRef
) {
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
  const isOptional = line.serialOptional === true;

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

  useImperativeHandle(forwardedRef, () => ({ focus: refocusInput }), [refocusInput]);

  const tryAddSerial = useCallback(
    async (raw: string) => {
      const sn = normalizePosSerial(raw);
      if (!sn) return;
      // No "quantity full" block: the scan input drives quantity, not the other way round — a
      // serial beyond the current count just grows the line to match (see nextQuantity below),
      // same as pressing + on the stepper would. The input must never refuse a scan here.
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
        // status === 'NEW' means this serial doesn't exist in the system yet — the server will
        // mint it on checkout (this item is optional-serial, the only case NEW/allowed shows up
        // on an outbound movement). Track it in newSerialNumbers purely so the Picked list below
        // can badge it, same as any other valid pick otherwise.
        const nextNew = row.status === 'NEW' ? [...(line.newSerialNumbers ?? []), sn] : line.newSerialNumbers;
        const nextPicked = [...picked, sn];
        const nextQuantity = nextPicked.length > line.quantity ? nextPicked.length : undefined;
        onSerialNumbersChange(nextPicked, nextNew, nextQuantity);
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
      line.newSerialNumbers,
      line.quantity,
      line.variantId,
      onSerialNumbersChange,
      otherSet,
      picked,
      pickedSet,
      refocusInput,
      salesLocationId,
    ]
  );

  const commitDraft = useCallback(() => {
    if (checking) return;
    void tryAddSerial(draft);
  }, [checking, draft, tryAddSerial]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      // Enter on an empty box means "nothing more to scan here" — hand back to the parent to
      // close/save, same as the old price-field Enter did before it started redirecting focus
      // here. Scoped to Enter only: Tab on an empty box keeps its normal "just move on" no-op
      // (commitDraft() below is a no-op on empty draft anyway) rather than also closing the modal.
      if (e.key === 'Enter' && !draft.trim() && onEmptyEnter) {
        onEmptyEnter();
        return;
      }
      commitDraft();
      return;
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
    const q = listFilter.trim();
    return available.filter((s) => {
      const normalized = normalizePosSerial(s.serialNumber);
      if (pickedSet.has(normalized) || otherSet.has(normalized)) return false;
      if (!q) return true;
      return normalized.includes(q);
    });
  }, [available, listFilter, otherSet, pickedSet]);

  const removePicked = (sn: string) => {
    const u = normalizePosSerial(sn);
    onSerialNumbersChange(
      picked.filter((x) => normalizePosSerial(x) !== u),
      (line.newSerialNumbers ?? []).filter((x) => normalizePosSerial(x) !== u)
    );
    refocusInput();
  };

  return (
    <section className="pos-detail-section pos-serial-section" aria-labelledby="pos-serial-heading">
      <div className="pos-serial-section__head">
        <h4 id="pos-serial-heading" className="pos-detail-section__label pos-serial-section__title">
          Serial numbers
        </h4>
        <span
          className={`pos-serial-section__count ${isComplete || isOptional ? 'pos-serial-section__count--done' : ''}`}
        >
          {pickedCount} of {required} {isComplete ? '✓' : isOptional ? '(optional)' : 'required'}
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
          disabled={checking}
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
                <span className="pos-serial-picked-row__sn">
                  {sn}
                  {isNewSerial(line, sn) ? <span className="pos-serial-picked-row__new">New</span> : null}
                </span>
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
                disabled={checking}
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
});
