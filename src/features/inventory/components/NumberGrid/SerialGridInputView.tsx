/**
 * SerialGridInputView - one-step, carry-forward spreadsheet grid for serial entry.
 * Serial number is the first column of the same table as any per-serial template detail
 * columns (resolved from the item/variant's SerialAttributeTemplate). Typing a serial into
 * the trailing ghost row and pressing Enter commits it and appends a new ghost row below,
 * which auto-inherits the detail values of the row above (carry-forward). Backend identity
 * validation (NOT_FOUND/duplicate/etc.) reuses the same debounced call as SerialInputView.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef, forwardRef } from 'react';
import { inventoryService } from '@/services/inventory.service';
import type { AttributeField, SerialAttributeTemplate } from '@/services/inventory.service';
import type { NumberGridResult } from './NumberGrid';
import type { SerialValidationItem, SerialValidationStatus, ValidationError } from '../../utils/numberGridUtils';
import { getDuplicateSerials, validateSerialsSync, serialStatusToLabel } from '../../utils/numberGridUtils';
import { normalizeSerialNumber } from '../../utils/serialNumber';

export interface SerialGridInputViewProps {
  movementType: string;
  itemId: string;
  variantId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  expectedQuantity: number;
  initialSerialNumbers: string[];
  initialSerialAttributes?: Record<string, Record<string, any>>;
  existingSerialsInDoc: string[];
  allowOverReceive: boolean;
  allowPartial: boolean;
  onResultChange: (r: NumberGridResult) => void;
  /** Called once (and whenever it changes) with a callable that clears the whole grid, so the NumberGrid shell's footer can drive it. */
  registerClearAll?: (fn: () => void) => void;
}

interface GridRow {
  key: string;
  serial: string;
  committed: boolean;
  values: Record<string, string>;
  inherited: Record<string, boolean>;
}

interface GridColumn {
  key: string;
  label: string;
  type: 'serial' | AttributeField['type'];
  required: boolean;
  options?: string[];
}

let rowSeq = 0;
function nextRowKey(): string {
  rowSeq += 1;
  return `row-${rowSeq}`;
}

function emptyValues(fields: AttributeField[]): Record<string, string> {
  const v: Record<string, string> = {};
  fields.forEach((f) => {
    v[f.key] = '';
  });
  return v;
}

/** Baseline for a row with nothing above it to carry forward from: each field's configured
 * template default (shown italic/inherited-styled, same as a carried-forward value, since the
 * user hasn't explicitly confirmed it), or blank when no default is set. */
function defaultRowValues(fields: AttributeField[]): { values: Record<string, string>; inherited: Record<string, boolean> } {
  const values: Record<string, string> = {};
  const inherited: Record<string, boolean> = {};
  fields.forEach((f) => {
    if (f.defaultValue != null && f.defaultValue !== '') {
      values[f.key] = f.defaultValue;
      inherited[f.key] = true;
    } else {
      values[f.key] = '';
      inherited[f.key] = false;
    }
  });
  return { values, inherited };
}

function blankRow(fields: AttributeField[]): GridRow {
  const { values, inherited } = defaultRowValues(fields);
  return { key: nextRowKey(), serial: '', committed: false, values, inherited };
}

function ghostFrom(prev: GridRow, fields: AttributeField[]): GridRow {
  const inherited: Record<string, boolean> = {};
  fields.forEach((f) => {
    inherited[f.key] = true;
  });
  return { key: nextRowKey(), serial: '', committed: false, values: { ...prev.values }, inherited };
}

function ensureTrailingGhost(rows: GridRow[], fields: AttributeField[]): GridRow[] {
  if (rows.length === 0) return [blankRow(fields)];
  const last = rows[rows.length - 1];
  if (last.committed) return [...rows, ghostFrom(last, fields)];
  return rows;
}

function buildInitialRows(
  serials: string[],
  attrs: Record<string, Record<string, any>> | undefined,
  fields: AttributeField[]
): GridRow[] {
  if (serials.length === 0) return [blankRow(fields)];
  const rows: GridRow[] = [];
  let prevValues: Record<string, string> = defaultRowValues(fields).values;
  serials.forEach((s) => {
    const serialAttrs = attrs?.[s] || {};
    const values = emptyValues(fields);
    const inherited: Record<string, boolean> = {};
    fields.forEach((f) => {
      if (Object.prototype.hasOwnProperty.call(serialAttrs, f.key) && serialAttrs[f.key] !== '' && serialAttrs[f.key] != null) {
        values[f.key] = String(serialAttrs[f.key]);
        inherited[f.key] = false;
      } else {
        values[f.key] = prevValues[f.key] || '';
        inherited[f.key] = true;
      }
    });
    rows.push({ key: nextRowKey(), serial: s, committed: true, values, inherited });
    prevValues = values;
  });
  return ensureTrailingGhost(rows, fields);
}

function cellKey(r: number, c: number): string {
  return `${r}-${c}`;
}

export const SerialGridInputView = forwardRef<HTMLInputElement | HTMLTextAreaElement | null, SerialGridInputViewProps>(
  (
    {
      movementType,
      itemId,
      variantId,
      fromLocationId,
      toLocationId,
      expectedQuantity,
      initialSerialNumbers,
      initialSerialAttributes,
      existingSerialsInDoc,
      allowOverReceive,
      allowPartial,
      onResultChange,
      registerClearAll,
    },
    ref
  ) => {
    const [template, setTemplate] = useState<SerialAttributeTemplate | null>(null);
    const [templateLoaded, setTemplateLoaded] = useState(false);
    const fields = useMemo<AttributeField[]>(() => template?.fields ?? [], [template]);

    useEffect(() => {
      let cancelled = false;
      setTemplateLoaded(false);
      inventoryService
        .getSerialAttributeTemplate(itemId, variantId)
        .then((t) => {
          if (!cancelled) {
            setTemplate(t);
            setTemplateLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setTemplate(null);
            setTemplateLoaded(true);
          }
        });
      return () => {
        cancelled = true;
      };
    }, [itemId, variantId]);

    const initialSerialNumbersRef = useRef(initialSerialNumbers);
    const initialSerialAttributesRef = useRef(initialSerialAttributes);
    initialSerialNumbersRef.current = initialSerialNumbers;
    initialSerialAttributesRef.current = initialSerialAttributes;

    const [rows, setRows] = useState<GridRow[]>(() => buildInitialRows(initialSerialNumbers, initialSerialAttributes, []));
    const [history, setHistory] = useState<GridRow[][]>(() => [rows]);
    const [, setHistoryIndex] = useState(0);
    const rowsHydratedRef = useRef(false);

    // Once the item/variant's SerialAttributeTemplate resolves, rebuild the initial rows so
    // pre-existing serials (reopening the grid to fix a typo) get correct per-field carry-forward flags.
    useEffect(() => {
      if (!templateLoaded || rowsHydratedRef.current) return;
      rowsHydratedRef.current = true;
      const hydrated = buildInitialRows(initialSerialNumbersRef.current, initialSerialAttributesRef.current, fields);
      setRows(hydrated);
      setHistory([hydrated]);
      setHistoryIndex(0);
    }, [templateLoaded, fields]);

    const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
    const cellRefs = useRef<Map<string, HTMLInputElement | HTMLSelectElement>>(new Map());

    useEffect(() => {
      // Re-run once the grid actually mounts (templateLoaded flips true) too — the target
      // cell's input doesn't exist in the DOM yet while the loading state is shown, so a
      // focus request made before then would silently no-op.
      const el = cellRefs.current.get(cellKey(focus.r, focus.c));
      el?.focus();
    }, [focus, templateLoaded]);

    const columns = useMemo<GridColumn[]>(
      () => [
        { key: 'serial', label: 'Serial number', type: 'serial', required: true },
        ...fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options })),
      ],
      [fields]
    );

    const registerCellRef = useCallback(
      (r: number, c: number) => (el: HTMLInputElement | HTMLSelectElement | null) => {
        const k = cellKey(r, c);
        if (el) cellRefs.current.set(k, el);
        else cellRefs.current.delete(k);
        if (r === 0 && c === 0) {
          if (typeof ref === 'function') ref(el as HTMLInputElement | null);
          else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el as HTMLInputElement | null;
        }
      },
      [ref]
    );

    const moveFocus = useCallback(
      (r: number, c: number) => {
        setFocus((prev) => {
          const maxR = rows.length - 1;
          const maxC = columns.length - 1;
          const nr = Math.max(0, Math.min(r, maxR));
          const nc = Math.max(0, Math.min(c, maxC));
          if (nr === prev.r && nc === prev.c) return prev;
          return { r: nr, c: nc };
        });
      },
      [rows.length, columns.length]
    );

    const pushHistory = useCallback((snapshot: GridRow[]) => {
      setHistoryIndex((currentIndex) => {
        setHistory((prev) => {
          const trimmed = prev.slice(0, currentIndex + 1);
          trimmed.push(snapshot);
          if (trimmed.length > 50) trimmed.shift();
          return trimmed;
        });
        return Math.min(currentIndex + 1, 49);
      });
    }, []);

    const undo = useCallback(() => {
      setHistoryIndex((idx) => {
        if (idx <= 0) return idx;
        setRows(history[idx - 1]);
        return idx - 1;
      });
    }, [history]);

    const redo = useCallback(() => {
      setHistoryIndex((idx) => {
        if (idx >= history.length - 1) return idx;
        setRows(history[idx + 1]);
        return idx + 1;
      });
    }, [history]);

    const updateSerialText = useCallback((r: number, value: string) => {
      setRows((prev) => {
        const next = [...prev];
        next[r] = { ...next[r], serial: value };
        return next;
      });
    }, []);

    const commitSerial = useCallback(
      (r: number) => {
        setRows((prev) => {
          const row = prev[r];
          if (!row) return prev;
          const norm = normalizeSerialNumber(row.serial);
          if (!norm) return prev;
          if (row.committed && row.serial === norm) return prev;
          const next = [...prev];
          next[r] = { ...row, serial: norm, committed: true };
          const withGhost = ensureTrailingGhost(next, fields);
          pushHistory(withGhost);
          return withGhost;
        });
      },
      [fields, pushHistory]
    );

    const updateDetailValue = useCallback((r: number, key: string, value: string) => {
      setRows((prev) => {
        const next = [...prev];
        const row = next[r];
        next[r] = { ...row, values: { ...row.values, [key]: value }, inherited: { ...row.inherited, [key]: false } };
        return next;
      });
    }, []);

    const handleDetailBlur = useCallback(() => {
      pushHistory(rows);
    }, [rows, pushHistory]);

    const removeRow = useCallback(
      (r: number) => {
        setRows((prev) => {
          if (prev.length <= 1) return prev;
          const next = prev.filter((_, i) => i !== r);
          const withGhost = ensureTrailingGhost(next, fields);
          pushHistory(withGhost);
          return withGhost;
        });
        setFocus((f) => ({ r: Math.max(0, Math.min(f.r, r - 1)), c: 0 }));
      },
      [fields, pushHistory]
    );

    const fillDownColumn = useCallback(
      (c: number, fromRow: number) => {
        if (c === 0) return; // never fill the identity column
        setRows((prev) => {
          const key = columns[c].key;
          const sourceVal = prev[fromRow]?.values[key] ?? '';
          const next = prev.map((row, i) => {
            if (i <= fromRow) return row;
            return { ...row, values: { ...row.values, [key]: sourceVal }, inherited: { ...row.inherited, [key]: false } };
          });
          pushHistory(next);
          return next;
        });
      },
      [columns, pushHistory]
    );

    const handleCellPaste = useCallback(
      (e: React.ClipboardEvent, r: number, c: number) => {
        const text = e.clipboardData.getData('text');
        if (!text.includes('\n') && !text.includes('\t')) return; // single value: let default paste happen
        e.preventDefault();
        const lines = text
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .split('\n')
          .filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
        if (lines.length === 0) return;
        const grid = lines.map((line) => line.split('\t'));
        setRows((prev) => {
          let next = [...prev];
          for (let i = 0; i < grid.length; i++) {
            const targetR = r + i;
            while (targetR >= next.length) {
              const prevRow = next[next.length - 1];
              next.push(prevRow ? ghostFrom(prevRow, fields) : blankRow(fields));
            }
            const row: GridRow = { ...next[targetR], values: { ...next[targetR].values }, inherited: { ...next[targetR].inherited } };
            for (let j = 0; j < grid[i].length; j++) {
              const targetC = c + j;
              if (targetC >= columns.length) break;
              const cellVal = grid[i][j].trim();
              if (targetC === 0) {
                const norm = normalizeSerialNumber(cellVal);
                if (norm) {
                  row.serial = norm;
                  row.committed = true;
                }
              } else {
                const key = columns[targetC].key;
                row.values[key] = cellVal;
                row.inherited[key] = false;
              }
            }
            next[targetR] = row;
          }
          next = ensureTrailingGhost(next, fields);
          pushHistory(next);
          return next;
        });
      },
      [columns, fields, pushHistory]
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>, r: number, c: number) => {
        const isSerialCol = c === 0;
        const ctrlOrCmd = e.ctrlKey || e.metaKey;
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            moveFocus(r + 1, c);
            break;
          case 'ArrowUp':
            e.preventDefault();
            moveFocus(r - 1, c);
            break;
          case 'ArrowLeft': {
            const type = columns[c].type;
            let atStart = true;
            if (type === 'string' || type === 'serial') {
              const el = e.currentTarget as HTMLInputElement;
              atStart = el.selectionStart === 0 && el.selectionEnd === 0;
            }
            if (atStart) {
              e.preventDefault();
              moveFocus(r, c - 1);
            }
            break;
          }
          case 'ArrowRight': {
            const type = columns[c].type;
            let atEnd = true;
            if (type === 'string' || type === 'serial') {
              const el = e.currentTarget as HTMLInputElement;
              atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
            }
            if (atEnd) {
              e.preventDefault();
              moveFocus(r, c + 1);
            }
            break;
          }
          case 'Enter':
            e.preventDefault();
            if (isSerialCol) {
              const norm = normalizeSerialNumber(rows[r]?.serial ?? '');
              if (norm) {
                commitSerial(r);
                // Bypass moveFocus's clamp: it reads rows.length from this render's stale
                // closure, but commitSerial's ensureTrailingGhost guarantees row r+1 exists
                // once the pending state update lands, so jumping there directly is safe.
                setFocus({ r: r + 1, c: 0 });
              }
            } else {
              pushHistory(rows);
              moveFocus(r + 1, c);
            }
            break;
          case 'Backspace': {
            if (isSerialCol) {
              const row = rows[r];
              const val = (e.currentTarget as HTMLInputElement).value;
              if (val === '' && row && !row.committed && r > 0) {
                e.preventDefault();
                moveFocus(r - 1, 0);
              }
            }
            break;
          }
          case 'Home':
            if (ctrlOrCmd) {
              e.preventDefault();
              setFocus({ r: 0, c: 0 });
            }
            break;
          case 'End':
            if (ctrlOrCmd) {
              e.preventDefault();
              setFocus({ r: rows.length - 1, c: columns.length - 1 });
            }
            break;
          case 'd':
          case 'D':
            if (ctrlOrCmd) {
              e.preventDefault();
              fillDownColumn(c, r);
            }
            break;
          case 'z':
          case 'Z':
            if (ctrlOrCmd && !e.shiftKey) {
              e.preventDefault();
              undo();
            } else if (ctrlOrCmd && e.shiftKey) {
              e.preventDefault();
              redo();
            }
            break;
          case 'y':
            if (ctrlOrCmd) {
              e.preventDefault();
              redo();
            }
            break;
          default:
            break;
        }
      },
      [rows, columns, moveFocus, commitSerial, fillDownColumn, undo, redo, pushHistory]
    );

    const clearAll = useCallback(() => {
      const fresh = [blankRow(fields)];
      setRows(fresh);
      setHistory([fresh]);
      setHistoryIndex(0);
      setFocus({ r: 0, c: 0 });
    }, [fields]);

    useEffect(() => {
      registerClearAll?.(clearAll);
    }, [registerClearAll, clearAll]);

    // Jump-to-error support (dispatched by the NumberGrid shell's error summary panel).
    useEffect(() => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail as { rowIndex?: number; field?: string } | undefined;
        if (detail?.rowIndex == null) return;
        const committedIdxs: number[] = [];
        rows.forEach((rr, i) => {
          if (rr.committed) committedIdxs.push(i);
        });
        const gridRowIndex = committedIdxs[detail.rowIndex];
        if (gridRowIndex == null) return;
        let col = 0;
        if (detail.field) {
          const fIdx = columns.findIndex((cl) => cl.label === detail.field || cl.key === detail.field);
          if (fIdx >= 0) col = fIdx;
        }
        setFocus({ r: gridRowIndex, c: col });
      };
      window.addEventListener('numbergrid-jump-to-error', handler);
      return () => window.removeEventListener('numbergrid-jump-to-error', handler);
    }, [rows, columns]);

    const committedSerials = useMemo(() => rows.filter((r) => r.committed).map((r) => r.serial), [rows]);
    const dupeSet = useMemo(() => new Set(getDuplicateSerials(committedSerials)), [committedSerials]);
    const docSet = useMemo(() => new Set(existingSerialsInDoc.map((s) => normalizeSerialNumber(s))), [existingSerialsInDoc]);

    const [serialStatuses, setSerialStatuses] = useState<SerialValidationItem[]>([]);
    const cancelledRef = useRef(false);

    useEffect(() => {
      if (committedSerials.length === 0) {
        setSerialStatuses([]);
        return;
      }
      setSerialStatuses(committedSerials.map((s) => ({ serialNumber: s, status: 'CHECKING', allowForMovementType: false })));
      cancelledRef.current = false;
      const t = setTimeout(() => {
        inventoryService
          .validateSerialsForMovement({ itemId, movementType, serialNumbers: committedSerials, fromLocationId, toLocationId, variantId })
          .then((res) => {
            if (!cancelledRef.current) {
              setSerialStatuses(res.map((item) => ({ ...item, status: item.status as SerialValidationStatus })));
            }
          })
          .catch(() => {
            if (!cancelledRef.current) {
              setSerialStatuses(
                committedSerials.map((s) => ({ serialNumber: s, status: 'NOT_FOUND' as SerialValidationStatus, message: 'Validation failed', allowForMovementType: false }))
              );
            }
          });
      }, 350);
      return () => {
        cancelledRef.current = true;
        clearTimeout(t);
      };
    }, [committedSerials, movementType, itemId, variantId, fromLocationId, toLocationId]);

    const getCommittedStatus = useCallback(
      (i: number): { status: SerialValidationStatus; allowForMovementType: boolean } => {
        const s = committedSerials[i];
        if (dupeSet.has(s) || docSet.has(s)) return { status: 'DUPLICATE', allowForMovementType: false };
        const r = serialStatuses[i];
        if (r) return { status: r.status as SerialValidationStatus, allowForMovementType: r.allowForMovementType };
        return { status: 'CHECKING', allowForMovementType: false };
      },
      [committedSerials, dupeSet, docSet, serialStatuses]
    );

    const rowStatuses = useMemo(() => {
      let idx = 0;
      return rows.map((row) => {
        if (!row.committed) return null;
        const st = getCommittedStatus(idx).status;
        idx += 1;
        return st;
      });
    }, [rows, getCommittedStatus]);

    const rowNumbers = useMemo(() => {
      let n = 0;
      return rows.map((row) => (row.committed ? (n += 1) : null));
    }, [rows]);

    const validationErrors = useMemo<ValidationError[]>(() => {
      const errs = validateSerialsSync(committedSerials, expectedQuantity, existingSerialsInDoc, allowOverReceive, allowPartial);
      let idx = 0;
      rows.forEach((row) => {
        if (!row.committed) return;
        fields.forEach((f) => {
          if (f.required && !(row.values[f.key] || '').trim()) {
            errs.push({ type: 'row', rowIndex: idx, field: f.label, message: `${f.label} is required`, blocking: true });
          }
        });
        idx += 1;
      });
      return errs;
    }, [committedSerials, expectedQuantity, existingSerialsInDoc, allowOverReceive, allowPartial, rows, fields]);

    const isValid = useMemo(() => {
      // Block Apply until the template has resolved — otherwise a row could be committed
      // (and counted as valid) before we even know which fields are required.
      if (!templateLoaded) return false;
      const syncOk = validationErrors.filter((e) => e.blocking).length === 0 && (expectedQuantity === 0 || committedSerials.length > 0);
      const allAllow = committedSerials.length === 0 || committedSerials.every((_, i) => getCommittedStatus(i).allowForMovementType);
      const noneChecking = committedSerials.length === 0 || !serialStatuses.some((s) => s.status === 'CHECKING');
      return !!(syncOk && allAllow && noneChecking);
    }, [templateLoaded, validationErrors, expectedQuantity, committedSerials, getCommittedStatus, serialStatuses]);

    const serialStatusesForResult = useMemo(
      () =>
        committedSerials.map((s, i) => {
          const st = getCommittedStatus(i);
          return { serialNumber: s, status: st.status, allowForMovementType: st.allowForMovementType };
        }),
      [committedSerials, getCommittedStatus]
    );

    const serialAttributesResult = useMemo(() => {
      if (fields.length === 0) return undefined;
      const out: Record<string, Record<string, any>> = {};
      rows.forEach((row) => {
        if (!row.committed) return;
        const vals: Record<string, any> = {};
        fields.forEach((f) => {
          const raw = row.values[f.key];
          if (raw != null && raw !== '') {
            vals[f.key] = f.type === 'number' ? Number(raw) : raw;
          }
        });
        if (Object.keys(vals).length > 0) out[row.serial] = vals;
      });
      return Object.keys(out).length > 0 ? out : undefined;
    }, [rows, fields]);

    const result: NumberGridResult = useMemo(
      () => ({
        finalSerialList: committedSerials,
        finalBatchList: [],
        derivedQuantity: committedSerials.length,
        validationErrors,
        serialStatuses: serialStatusesForResult,
        serialAttributes: serialAttributesResult,
        isValid,
      }),
      [committedSerials, validationErrors, serialStatusesForResult, serialAttributesResult, isValid]
    );

    useEffect(() => {
      onResultChange(result);
    }, [result, onResultChange]);

    return (
      <div className="number-grid-serial-grid-wrap">
        <div aria-live="polite" aria-atomic="true" className="number-grid-aria-live">
          {committedSerials.length > 0 && `Entered ${committedSerials.length} serial${committedSerials.length !== 1 ? 's' : ''}.`}
        </div>
        {!templateLoaded ? (
          <div className="number-grid-grid-loading" role="status" aria-live="polite">
            <div className="number-grid-grid-loading-spinner" aria-hidden="true" />
            <span>Loading serial entry template…</span>
          </div>
        ) : (
        <div className="number-grid-serial-grid-scroll">
          <table className="number-grid-serial-grid-table">
            <thead>
              <tr>
                <th className="col-num">#</th>
                {columns.map((col) => (
                  <th key={col.key}>
                    {col.label}
                    {(col.type === 'serial' || col.required) && <span className="number-grid-required-mark"> *</span>}
                  </th>
                ))}
                <th className="col-actions" aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => {
                const status = rowStatuses[r];
                const statusClass = status ? `status-${status.toLowerCase()}` : '';
                return (
                  <tr key={row.key} className={`number-grid-grid-row ${row.committed ? statusClass : 'ghost'}`}>
                    <td className="cell cell-num">{rowNumbers[r] ?? ''}</td>
                    {columns.map((col, c) => {
                      if (col.key === 'serial') {
                        return (
                          <td key={col.key} className={`cell cell-serial ${statusClass}`}>
                            <input
                              ref={registerCellRef(r, c)}
                              type="text"
                              className="number-grid-grid-input"
                              value={row.serial}
                              placeholder={row.committed ? '' : 'Scan or type serial…'}
                              onChange={(e) => updateSerialText(r, e.target.value)}
                              onBlur={() => commitSerial(r)}
                              onFocus={() => setFocus({ r, c })}
                              onKeyDown={(e) => handleKeyDown(e, r, c)}
                              onPaste={(e) => handleCellPaste(e, r, c)}
                              aria-label={`Row ${r + 1} serial number`}
                            />
                            {row.committed && status && (
                              <span className="number-grid-grid-status" title={status}>
                                {serialStatusToLabel(status)}
                              </span>
                            )}
                          </td>
                        );
                      }
                      const field = fields.find((f) => f.key === col.key);
                      if (!field) return null;
                      const value = row.values[col.key] ?? '';
                      const isInherited = !!row.inherited[col.key];
                      if (field.type === 'select') {
                        return (
                          <td key={col.key} className={`cell ${isInherited ? 'cell-inherited' : ''}`}>
                            <select
                              ref={registerCellRef(r, c)}
                              className={`number-grid-grid-input ${isInherited ? 'inherited' : ''}`}
                              value={value}
                              onChange={(e) => updateDetailValue(r, col.key, e.target.value)}
                              onBlur={handleDetailBlur}
                              onFocus={() => setFocus({ r, c })}
                              onKeyDown={(e) => handleKeyDown(e, r, c)}
                              aria-label={`Row ${r + 1} ${field.label}`}
                            >
                              <option value="" />
                              {(field.options || []).map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      }
                      return (
                        <td key={col.key} className={`cell ${isInherited ? 'cell-inherited' : ''}`}>
                          <input
                            ref={registerCellRef(r, c)}
                            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                            className={`number-grid-grid-input ${isInherited ? 'inherited' : ''}`}
                            value={value}
                            onChange={(e) => updateDetailValue(r, col.key, e.target.value)}
                            onBlur={handleDetailBlur}
                            onFocus={() => setFocus({ r, c })}
                            onKeyDown={(e) => handleKeyDown(e, r, c)}
                            onPaste={(e) => handleCellPaste(e, r, c)}
                            aria-label={`Row ${r + 1} ${field.label}`}
                          />
                        </td>
                      );
                    })}
                    <td className="cell cell-actions">
                      {row.committed && (
                        <button
                          type="button"
                          className="number-grid-grid-remove"
                          onClick={() => removeRow(r)}
                          aria-label={`Remove row ${r + 1}`}
                          title="Remove row"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>
    );
  }
);
SerialGridInputView.displayName = 'SerialGridInputView';
