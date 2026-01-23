/**
 * BatchInputView - BATCH: multi-row table (batchCode, qty, mfg, exp), add/remove,
 * fetchAvailableForBatch on blur (debounced), mfg/exp when required. Quantity = sum of row quantities.
 */

import React, { useState, useMemo, useEffect, useCallback, useRef, forwardRef } from 'react';
import { Input } from '@/shared/components/ui';
import type { IndustryFlags } from '@/services/inventory.service';
import type { BatchRow, ValidationError } from '../../utils/numberGridUtils';
import type { NumberGridResult } from './NumberGrid';
import { validateBatchRowsSync, validateBatchTotalSync, parseBatchTableData } from '../../utils/numberGridUtils';

const DEBOUNCE_MS = 400;

type CellPosition = { row: number; col: 'batchCode' | 'quantity' | 'manufacturingDate' | 'expiryDate' };

export interface BatchInputViewProps {
  expectedQuantity: number;
  initialBatchRows: BatchRow[];
  industryFlags: IndustryFlags;
  itemId: string;
  locationId?: string;
  fetchAvailableForBatch?: (itemId: string, locationId: string, batchCode: string) => Promise<number>;
  allowOverReceive: boolean;
  allowPartial: boolean;
  /** When true: one row only, hide Add/Remove. Used for count (one-batch-per-line). */
  singleBatchMode?: boolean;
  onResultChange: (r: NumberGridResult) => void;
}

const today = () => new Date().toISOString().slice(0, 10);

function toBatchRow(b: BatchRow): BatchRow {
  return {
    batchCode: b.batchCode || '',
    quantity: b.quantity || 0,
    manufacturingDate: b.manufacturingDate,
    expiryDate: b.expiryDate,
  };
}

const BatchInputViewInner = (
  {
    expectedQuantity,
    initialBatchRows,
    industryFlags,
    itemId,
    locationId,
    fetchAvailableForBatch,
    allowOverReceive,
    allowPartial,
    singleBatchMode = false,
    onResultChange,
  }: BatchInputViewProps,
  ref: React.ForwardedRef<HTMLInputElement>
) => {
    const initRows = (): BatchRow[] => {
      const mapped = initialBatchRows.length > 0 ? initialBatchRows.map(toBatchRow) : [{ batchCode: '', quantity: 1, manufacturingDate: '', expiryDate: '' }];
      return singleBatchMode ? [mapped[0] ?? { batchCode: '', quantity: expectedQuantity || 1, manufacturingDate: '', expiryDate: '' }] : mapped;
    };
    const [rows, setRows] = useState<BatchRow[]>(initRows);
    const [rowAvailable, setRowAvailable] = useState<Record<string, number>>({});
    const [focusedCell, setFocusedCell] = useState<CellPosition | null>(null);
    const [copiedRow, setCopiedRow] = useState<BatchRow | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);
    const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map());
    const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

    const focusCell = useCallback((pos: CellPosition | null) => {
      setFocusedCell(pos);
      if (pos) {
        const key = `${pos.row}-${pos.col}`;
        const cellEl = cellRefs.current.get(key);
        if (cellEl) {
          setTimeout(() => cellEl.focus(), 0);
        }
      }
    }, []);

    useEffect(() => {
      mountedRef.current = true;
      const handleJumpToError = (e: CustomEvent) => {
        const { rowIndex, field } = e.detail;
        if (rowIndex != null && rowIndex >= 0 && rowIndex < rows.length) {
          const col = field === 'batchCode' ? 'batchCode' : field === 'quantity' ? 'quantity' : field === 'manufacturingDate' ? 'manufacturingDate' : field === 'expiryDate' ? 'expiryDate' : 'batchCode';
          focusCell({ row: rowIndex, col });
          const rowEl = rowRefs.current.get(rowIndex);
          if (rowEl) {
            setTimeout(() => {
              rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
          }
        }
      };
      window.addEventListener('numbergrid-jump-to-error', handleJumpToError as EventListener);
      return () => {
        mountedRef.current = false;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        window.removeEventListener('numbergrid-jump-to-error', handleJumpToError as EventListener);
      };
    }, [rows.length, focusCell]);

    const finalBatchList = useMemo(
      () => rows.filter((r) => (r.batchCode || '').trim() && (r.quantity || 0) > 0),
      [rows]
    );
    const total = useMemo(() => finalBatchList.reduce((s, r) => s + (r.quantity || 0), 0), [finalBatchList]);
    const rowErrs = useMemo(() => validateBatchRowsSync(rows, industryFlags), [rows, industryFlags]);
    const totalErrs = useMemo(
      () => validateBatchTotalSync(total, expectedQuantity, allowOverReceive, allowPartial),
      [total, expectedQuantity, allowOverReceive, allowPartial]
    );
    const availErrs = useMemo((): ValidationError[] => {
      const errs: ValidationError[] = [];
      rows.forEach((r, i) => {
        const bc = (r.batchCode || '').trim();
        if (!bc) return;
        const k = `${i}-${bc}`;
        const av = rowAvailable[k];
        if (av != null && (r.quantity || 0) > av) {
          errs.push({ type: 'row', rowIndex: i, field: 'quantity', message: `Quantity (${r.quantity}) exceeds available (${av})`, blocking: true });
        }
      });
      return errs;
    }, [rows, rowAvailable]);
    const validationErrors = useMemo(() => [...rowErrs, ...totalErrs, ...availErrs], [rowErrs, totalErrs, availErrs]);

    const result: NumberGridResult = useMemo(
      () => ({
        finalSerialList: [],
        finalBatchList: rows.filter((r) => r.batchCode && r.quantity > 0),
        derivedQuantity: total,
        validationErrors,
        isValid: validationErrors.filter((e) => e.blocking).length === 0 && total > 0,
      }),
      [rows, total, validationErrors]
    );

    useEffect(() => {
      onResultChange(result);
    }, [result, onResultChange]);

    const updateRow = useCallback((i: number, u: Partial<BatchRow>) => {
      setRows((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], ...u };
        return next;
      });
    }, []);

    const addRow = useCallback(() => {
      if (singleBatchMode) return;
      setRows((prev) => [...prev, { batchCode: '', quantity: 1, manufacturingDate: '', expiryDate: '' }]);
    }, [singleBatchMode]);

    const removeRow = useCallback(
      (i: number) => {
        if (singleBatchMode) return;
        setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
      },
      [singleBatchMode]
    );

    const handleBatchCodeBlur = useCallback(
      (i: number) => {
        const r = rows[i];
        const bc = (r?.batchCode || '').trim();
        if (!bc || !fetchAvailableForBatch || !itemId || !locationId) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const myI = i;
        const myBc = bc;
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          fetchAvailableForBatch(itemId, locationId, myBc)
            .then((avail) => {
              if (!mountedRef.current) return;
              setRowAvailable((prev) => ({ ...prev, [`${myI}-${myBc}`]: avail }));
            })
            .catch(() => {});
        }, DEBOUNCE_MS);
      },
      [rows, fetchAvailableForBatch, itemId, locationId]
    );

    const requiresMfg = industryFlags.requiresBatchTracking || false;
    const requiresExpiry = industryFlags.hasExpiryDate || false;

    const getColumnOrder = useCallback((): Array<CellPosition['col']> => {
      const cols: Array<CellPosition['col']> = ['batchCode', 'quantity'];
      if (requiresMfg) cols.push('manufacturingDate');
      if (requiresExpiry) cols.push('expiryDate');
      return cols;
    }, [requiresMfg, requiresExpiry]);

    const getNextCell = useCallback((current: CellPosition, direction: 'next' | 'prev' | 'up' | 'down' | 'left' | 'right'): CellPosition | null => {
      const cols = getColumnOrder();
      const currentColIndex = cols.indexOf(current.col);

      if (direction === 'next' || direction === 'right') {
        if (currentColIndex < cols.length - 1) {
          return { row: current.row, col: cols[currentColIndex + 1] };
        } else if (current.row < rows.length - 1) {
          return { row: current.row + 1, col: cols[0] };
        }
      } else if (direction === 'prev' || direction === 'left') {
        if (currentColIndex > 0) {
          return { row: current.row, col: cols[currentColIndex - 1] };
        } else if (current.row > 0) {
          return { row: current.row - 1, col: cols[cols.length - 1] };
        }
      } else if (direction === 'down') {
        if (current.row < rows.length - 1) {
          return { row: current.row + 1, col: current.col };
        }
      } else if (direction === 'up') {
        if (current.row > 0) {
          return { row: current.row - 1, col: current.col };
        }
      }
      return null;
    }, [rows.length, getColumnOrder]);

    const copyRowAsCsv = useCallback((rowIndex: number) => {
      const row = rows[rowIndex];
      if (!row) return;
      const cols = getColumnOrder();
      const values = cols.map((col) => {
        if (col === 'batchCode') return row.batchCode || '';
        if (col === 'quantity') return String(row.quantity || 0);
        if (col === 'manufacturingDate') return row.manufacturingDate || '';
        if (col === 'expiryDate') return row.expiryDate || '';
        return '';
      });
      navigator.clipboard.writeText(values.join('\t'));
    }, [rows, getColumnOrder]);

    const copyAllAsCsv = useCallback(() => {
      const cols = getColumnOrder();
      const lines = rows.map((row) =>
        cols
          .map((col) => {
            if (col === 'batchCode') return row.batchCode || '';
            if (col === 'quantity') return String(row.quantity || 0);
            if (col === 'manufacturingDate') return row.manufacturingDate || '';
            if (col === 'expiryDate') return row.expiryDate || '';
            return '';
          })
          .join('\t')
      );
      navigator.clipboard.writeText(lines.join('\n'));
    }, [rows, getColumnOrder]);

    const handleCellKeyDown = useCallback((e: React.KeyboardEvent, rowIndex: number, col: CellPosition['col']) => {
      const current: CellPosition = { row: rowIndex, col };

      if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        const next = getNextCell(current, 'next');
        if (next) focusCell(next);
      } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        const prev = getNextCell(current, 'prev');
        if (prev) focusCell(prev);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const down = getNextCell(current, 'down');
        if (down) focusCell(down);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const up = getNextCell(current, 'up');
        if (up) focusCell(up);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !singleBatchMode) {
        e.preventDefault();
        addRow();
        setTimeout(() => {
          focusCell({ row: rows.length, col: 'batchCode' });
        }, 0);
      } else if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey) {
        if (e.shiftKey && !singleBatchMode) {
          e.preventDefault();
          removeRow(rowIndex);
          if (rowIndex > 0) {
            focusCell({ row: rowIndex - 1, col: 'batchCode' });
          }
        } else {
          // Clear current cell - let default behavior handle it
        }
      } else if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
        if (e.shiftKey) {
          // Ctrl+Shift+C: Copy as CSV
          e.preventDefault();
          copyRowAsCsv(rowIndex);
        } else {
          // Ctrl+C: Copy row data for paste
          e.preventDefault();
          setCopiedRow({ ...rows[rowIndex] });
        }
      } else if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
        if (e.shiftKey) {
          // Ctrl+Shift+V: Paste CSV data
          e.preventDefault();
          navigator.clipboard.readText().then((text) => {
            const pastedRows = parseBatchTableData(text, requiresMfg, requiresExpiry);
            if (pastedRows.length > 0) {
              setRows((prev) => {
                const next = [...prev];
                pastedRows.forEach((pastedRow, idx) => {
                  const targetIndex = rowIndex + idx;
                  if (targetIndex < next.length) {
                    next[targetIndex] = { ...next[targetIndex], ...pastedRow };
                  } else if (!singleBatchMode) {
                    next.push(pastedRow);
                  }
                });
                return next;
              });
            }
          });
        } else if (copiedRow) {
          // Ctrl+V: Paste row data
          e.preventDefault();
          updateRow(rowIndex, { ...copiedRow });
        }
      }
    }, [getNextCell, focusCell, singleBatchMode, addRow, rows, removeRow, copiedRow, updateRow]);

    return (
      <div className="number-grid-batch">
        <div className="batch-table-container">
          <table className="batch-table">
            <thead>
              <tr>
                <th>Batch code *</th>
                <th>Qty *</th>
                {requiresMfg && <th>MFG date</th>}
                {requiresExpiry && <th>Expiry date</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <Input
                      ref={(el) => {
                        const key = `${i}-batchCode`;
                        if (el) cellRefs.current.set(key, el);
                        else cellRefs.current.delete(key);
                        if (i === 0) {
                          if (typeof ref === 'function') ref(el);
                          else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
                        }
                      }}
                      value={r.batchCode}
                      onChange={(e) => updateRow(i, { batchCode: e.target.value })}
                      onBlur={() => handleBatchCodeBlur(i)}
                      onKeyDown={(e) => handleCellKeyDown(e, i, 'batchCode')}
                      onFocus={() => setFocusedCell({ row: i, col: 'batchCode' })}
                      placeholder="e.g. BATCH-001"
                    />
                  </td>
                  <td>
                    <Input
                      ref={(el) => {
                        const key = `${i}-quantity`;
                        if (el) cellRefs.current.set(key, el);
                        else cellRefs.current.delete(key);
                      }}
                      type="number"
                      min={0.01}
                      step={1}
                      value={r.quantity || ''}
                      onChange={(e) => updateRow(i, { quantity: parseFloat(e.target.value) || 0 })}
                      onKeyDown={(e) => handleCellKeyDown(e, i, 'quantity')}
                      onFocus={() => setFocusedCell({ row: i, col: 'quantity' })}
                    />
                  </td>
                  {requiresMfg && (
                    <td>
                      <Input
                        ref={(el) => {
                          const key = `${i}-manufacturingDate`;
                          if (el) cellRefs.current.set(key, el);
                          else cellRefs.current.delete(key);
                        }}
                        type="date"
                        value={r.manufacturingDate || ''}
                        onChange={(e) => updateRow(i, { manufacturingDate: e.target.value })}
                        onKeyDown={(e) => handleCellKeyDown(e, i, 'manufacturingDate')}
                        onFocus={() => setFocusedCell({ row: i, col: 'manufacturingDate' })}
                        max={today()}
                      />
                    </td>
                  )}
                  {requiresExpiry && (
                    <td>
                      <Input
                        ref={(el) => {
                          const key = `${i}-expiryDate`;
                          if (el) cellRefs.current.set(key, el);
                          else cellRefs.current.delete(key);
                        }}
                        type="date"
                        value={r.expiryDate || ''}
                        onChange={(e) => updateRow(i, { expiryDate: e.target.value })}
                        onKeyDown={(e) => handleCellKeyDown(e, i, 'expiryDate')}
                        onFocus={() => setFocusedCell({ row: i, col: 'expiryDate' })}
                        min={r.manufacturingDate || undefined}
                      />
                    </td>
                  )}
                  <td>
                    {!singleBatchMode && (
                      <button
                        type="button"
                        className="batch-row-remove"
                        onClick={() => removeRow(i)}
                        disabled={rows.length <= 1}
                        aria-label="Remove row"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={requiresMfg && requiresExpiry ? 2 : 1}>Total</td>
                <td>{total}</td>
                {requiresMfg && <td></td>}
                {requiresExpiry && <td></td>}
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
            {!singleBatchMode && (
              <button type="button" className="batch-add-row" onClick={addRow} title="Add row (Ctrl+Enter)">
                + Add row
              </button>
            )}
            {focusedCell && (
              <>
                <button
                  type="button"
                  className="number-grid-action-btn"
                  onClick={() => copyRowAsCsv(focusedCell.row)}
                  title="Copy row as CSV (Ctrl+C)"
                >
                  Copy Row
                </button>
                <button
                  type="button"
                  className="number-grid-action-btn"
                  onClick={() => {
                    if (!singleBatchMode && focusedCell) {
                      const row = rows[focusedCell.row];
                      if (row) {
                        setRows((prev) => {
                          const next = [...prev];
                          next.splice(focusedCell.row + 1, 0, { ...row });
                          return next;
                        });
                        setTimeout(() => focusCell({ row: focusedCell.row + 1, col: 'batchCode' }), 0);
                      }
                    }
                  }}
                  disabled={singleBatchMode}
                  title="Duplicate row"
                >
                  Duplicate Row
                </button>
                <button
                  type="button"
                  className="number-grid-action-btn"
                  onClick={() => {
                    if (focusedCell) {
                      updateRow(focusedCell.row, { batchCode: '', quantity: 0, manufacturingDate: '', expiryDate: '' });
                    }
                  }}
                  title="Clear row"
                >
                  Clear Row
                </button>
              </>
            )}
            {rows.length > 0 && (
              <button
                type="button"
                className="number-grid-action-btn"
                onClick={copyAllAsCsv}
                title="Copy all rows as CSV"
              >
                Copy All
              </button>
            )}
            {expectedQuantity > 0 && (singleBatchMode || rows.length === 1) && (
              <button
                type="button"
                className="number-grid-action-btn"
                onClick={() => {
                  if (rows.length > 0) {
                    updateRow(0, { ...rows[0], quantity: expectedQuantity });
                  }
                }}
                title="Fill expected quantity"
              >
                Fill Expected Qty
              </button>
            )}
          </div>
        </div>
      </div>
    );
};

export const BatchInputView = forwardRef(BatchInputViewInner) as React.ForwardRefExoticComponent<
  BatchInputViewProps & React.RefAttributes<HTMLInputElement>
>;
BatchInputView.displayName = 'BatchInputView';
