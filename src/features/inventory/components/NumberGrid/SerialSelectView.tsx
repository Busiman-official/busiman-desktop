/**
 * SerialSelectView - SERIAL + SELECT: availableSerials, search, multi-select, derivedQuantity from selected count.
 */

import React, { useState, useMemo, useEffect, useRef, useCallback, forwardRef } from 'react';
import { Input } from '@/shared/components/ui';
import type { SerialResponse } from '@/services/inventory.service';
import type { NumberGridResult } from './NumberGrid';
import type { ValidationError } from '../../utils/numberGridUtils';
import { normalizeSerialNumber, serialNumbersEqual } from '../../utils/serialNumber';

export interface SerialSelectViewProps {
  expectedQuantity: number;
  availableSerials: SerialResponse[];
  initialSelected: string[];
  allowOverReceive: boolean;
  allowPartial: boolean;
  /** SERIAL_OPTIONAL outbound (issue/transfer): lets the user assign a brand-new serial to a
   * previously-bare unit as it leaves ("serialize at exit"), alongside picking from the pool. */
  allowNewSerial?: boolean;
  onResultChange: (r: NumberGridResult) => void;
}

export const SerialSelectView = forwardRef<HTMLInputElement | null, SerialSelectViewProps>(
  (
    {
      expectedQuantity,
      availableSerials,
      initialSelected,
      allowOverReceive,
      allowPartial,
      allowNewSerial,
      onResultChange,
    },
    ref
  ) => {
    const availableSet = useMemo(
      () => new Set(availableSerials.map((s) => normalizeSerialNumber(s.serialNumber))),
      [availableSerials]
    );
    const [selectedSet, setSelectedSet] = useState<Set<string>>(
      () => new Set(initialSelected.map(normalizeSerialNumber).filter((sn) => availableSet.has(sn)))
    );
    const [newlyAssigned, setNewlyAssigned] = useState<string[]>(
      () => initialSelected.map(normalizeSerialNumber).filter((sn) => !availableSet.has(sn))
    );
    const [newSerialInput, setNewSerialInput] = useState('');
    const [newSerialError, setNewSerialError] = useState<string | null>(null);
    const [searchFilter, setSearchFilter] = useState('');
    const [focusedIndex, setFocusedIndex] = useState<number>(-1);
    const listContainerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Map<number, HTMLLabelElement>>(new Map());

    useEffect(() => {
      setSelectedSet(new Set(initialSelected.map(normalizeSerialNumber)));
    }, [initialSelected.join(',')]);

    const filtered = useMemo(() => {
      const q = searchFilter.trim();
      if (!q) return availableSerials;
      return availableSerials.filter((s) => s.serialNumber.includes(q));
    }, [availableSerials, searchFilter]);

    // Reset focus when filter changes
    useEffect(() => {
      setFocusedIndex(-1);
    }, [searchFilter]);

    // Scroll focused item into view
    useEffect(() => {
      if (focusedIndex >= 0 && focusedIndex < filtered.length) {
        const itemEl = itemRefs.current.get(focusedIndex);
        if (itemEl && listContainerRef.current) {
          const container = listContainerRef.current;
          const itemTop = itemEl.offsetTop;
          const itemBottom = itemTop + itemEl.offsetHeight;
          const containerTop = container.scrollTop;
          const containerBottom = containerTop + container.clientHeight;

          if (itemTop < containerTop) {
            container.scrollTo({ top: itemTop - 8, behavior: 'smooth' });
          } else if (itemBottom > containerBottom) {
            container.scrollTo({ top: itemBottom - container.clientHeight + 8, behavior: 'smooth' });
          }
        }
      }
    }, [focusedIndex, filtered.length]);

    const finalList = useMemo(() => [...Array.from(selectedSet), ...newlyAssigned], [selectedSet, newlyAssigned]);
    const n = finalList.length;

    const validationErrors = useMemo((): ValidationError[] => {
      const errs: ValidationError[] = [];
      if (n === 0 && expectedQuantity > 0 && !allowPartial) {
        errs.push({ type: 'global', message: 'Select at least one serial', blocking: true });
      } else if (n > 0) {
        if (!allowOverReceive && n > expectedQuantity) {
          errs.push({ type: 'global', message: `Count (${n}) must not exceed expected (${expectedQuantity})`, blocking: true });
        }
        if (!allowPartial && n < expectedQuantity) {
          errs.push({ type: 'global', message: `Count (${n}) must equal expected (${expectedQuantity})`, blocking: true });
        }
        if (!allowPartial && !allowOverReceive && n !== expectedQuantity) {
          errs.push({ type: 'global', message: `Count (${n}) must equal expected (${expectedQuantity})`, blocking: true });
        }
      }
      return errs;
    }, [n, expectedQuantity, allowOverReceive, allowPartial]);

    const result: NumberGridResult = useMemo(
      () => ({
        finalSerialList: finalList,
        finalBatchList: [],
        derivedQuantity: n,
        validationErrors,
        isValid: validationErrors.filter((e) => e.blocking).length === 0,
      }),
      [finalList, n, validationErrors]
    );

    useEffect(() => {
      onResultChange(result);
    }, [result, onResultChange]);

    const toggle = (sn: string) => {
      const normalized = normalizeSerialNumber(sn);
      setSelectedSet((prev) => {
        const next = new Set(prev);
        if (next.has(normalized)) next.delete(normalized);
        else next.add(normalized);
        return next;
      });
    };

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (filtered.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : prev === -1 ? filtered.length - 1 : prev));
          break;
        case 'Home':
          e.preventDefault();
          setFocusedIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setFocusedIndex(filtered.length - 1);
          break;
        case 'PageDown': {
          e.preventDefault();
          const pageSize = 10;
          setFocusedIndex((prev) => Math.min(prev + pageSize, filtered.length - 1));
          break;
        }
        case 'PageUp': {
          e.preventDefault();
          const pageSize = 10;
          setFocusedIndex((prev) => Math.max(prev - pageSize, 0));
          break;
        }
        case ' ':
        case 'Enter':
          if (focusedIndex >= 0 && focusedIndex < filtered.length) {
            e.preventDefault();
            toggle(filtered[focusedIndex].serialNumber);
          }
          break;
        case 'a':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (allowOverReceive || filtered.length <= expectedQuantity) {
              const all = new Set(filtered.map((s) => normalizeSerialNumber(s.serialNumber)));
              setSelectedSet(all);
            }
          }
          break;
        case 'd':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setSelectedSet(new Set());
          }
          break;
      }
    }, [filtered, focusedIndex, allowOverReceive, expectedQuantity, toggle]);

    const selectAll = useCallback(() => {
      if (allowOverReceive || filtered.length <= expectedQuantity) {
        const all = new Set(filtered.map((s) => normalizeSerialNumber(s.serialNumber)));
        setSelectedSet(all);
      }
    }, [filtered, allowOverReceive, expectedQuantity]);

    const deselectAll = useCallback(() => {
      setSelectedSet(new Set());
    }, []);

    const selectFirstN = useCallback(() => {
      if (expectedQuantity > 0) {
        const firstN = filtered.slice(0, expectedQuantity).map((s) => normalizeSerialNumber(s.serialNumber));
        setSelectedSet(new Set(firstN));
      }
    }, [filtered, expectedQuantity]);

    const invertSelection = useCallback(() => {
      setSelectedSet((prev) => {
        const next = new Set<string>();
        filtered.forEach((s) => {
          const normalized = normalizeSerialNumber(s.serialNumber);
          if (!prev.has(normalized)) next.add(normalized);
        });
        return next;
      });
    }, [filtered]);

    const addNewSerial = useCallback(() => {
      const normalized = normalizeSerialNumber(newSerialInput);
      if (!normalized) return;
      if (availableSet.has(normalized) || selectedSet.has(normalized)) {
        setNewSerialError('Already exists in the pool — select it above instead.');
        return;
      }
      if (newlyAssigned.some((sn) => serialNumbersEqual(sn, normalized))) {
        setNewSerialError('Already added.');
        return;
      }
      setNewlyAssigned((prev) => [...prev, normalized]);
      setNewSerialInput('');
      setNewSerialError(null);
    }, [newSerialInput, availableSet, selectedSet, newlyAssigned]);

    const removeNewSerial = useCallback((sn: string) => {
      setNewlyAssigned((prev) => prev.filter((s) => s !== sn));
    }, []);

    return (
      <div className="number-grid-serial-select">
        <div className="number-grid-field">
          <label>Search</label>
          <Input
            ref={ref}
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter by serial number"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && filtered.length > 0) {
                e.preventDefault();
                setFocusedIndex(0);
                listContainerRef.current?.focus();
              }
            }}
          />
        </div>
        <div className="number-grid-field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <label>Select serials ({n} / {expectedQuantity || '—'})</label>
            <div className="number-grid-bulk-actions" style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                className="number-grid-action-btn"
                onClick={selectAll}
                disabled={!allowOverReceive && filtered.length > expectedQuantity}
                title="Select all (Ctrl+A)"
              >
                Select All
              </button>
              <button
                type="button"
                className="number-grid-action-btn"
                onClick={deselectAll}
                title="Deselect all (Ctrl+D)"
              >
                Clear
              </button>
              {expectedQuantity > 0 && (
                <button
                  type="button"
                  className="number-grid-action-btn"
                  onClick={selectFirstN}
                  title={`Select first ${expectedQuantity}`}
                >
                  Select {expectedQuantity}
                </button>
              )}
              <button
                type="button"
                className="number-grid-action-btn"
                onClick={invertSelection}
                title="Invert selection"
              >
                Invert
              </button>
            </div>
          </div>
          <div
            ref={listContainerRef}
            className="number-grid-serial-select-list"
            tabIndex={0}
            onKeyDown={handleKeyDown}
            role="listbox"
            aria-label="Available serial numbers"
          >
            {filtered.map((s, index) => {
              const normalized = normalizeSerialNumber(s.serialNumber);
              const checked = selectedSet.has(normalized);
              const isFocused = index === focusedIndex;
              return (
                <label
                  key={s.id}
                  ref={(el) => {
                    if (el) itemRefs.current.set(index, el);
                    else itemRefs.current.delete(index);
                  }}
                  className={`number-grid-serial-select-row ${isFocused ? 'focused' : ''} ${checked ? 'selected' : ''}`}
                  data-focused={isFocused}
                  role="option"
                  aria-selected={checked}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(s.serialNumber)}
                    tabIndex={-1}
                  />
                  <span className="serial">{s.serialNumber}</span>
                  {s.currentLocation?.code && <span className="loc">{s.currentLocation.code}</span>}
                </label>
              );
            })}
            {filtered.length === 0 && <div className="number-grid-empty">No serials available</div>}
          </div>
        </div>
        {allowNewSerial && (
          <div className="number-grid-field">
            <label>Assign new serial (unit leaving without one, tag it now)</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <Input
                value={newSerialInput}
                onChange={(e) => { setNewSerialInput(e.target.value); setNewSerialError(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addNewSerial();
                  }
                }}
                placeholder="Scan or type a new serial number"
              />
              <button type="button" className="number-grid-action-btn" onClick={addNewSerial}>
                Add
              </button>
            </div>
            {newSerialError && (
              <div className="number-grid-field-error" style={{ color: '#b91c1c', fontSize: '12px', marginTop: '4px' }}>
                {newSerialError}
              </div>
            )}
            {newlyAssigned.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                {newlyAssigned.map((sn) => (
                  <span
                    key={sn}
                    className="number-grid-serial-chip"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      fontSize: '12px',
                    }}
                  >
                    {sn}
                    <button
                      type="button"
                      onClick={() => removeNewSerial(sn)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}
                      aria-label={`Remove ${sn}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);
SerialSelectView.displayName = 'SerialSelectView';
