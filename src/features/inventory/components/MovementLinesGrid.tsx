/**
 * Movement Lines Grid - Editable spreadsheet-style table
 */

import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { MovementLineRequest, MovementType, InventoryItem, Location, inventoryService } from '@/services/inventory.service';
import type { SerialResponse } from '@/services/inventory.service';
import { Button, Input, Select } from '@/shared/components/ui';
import { confirmWithFocusRecovery } from '@/shared/utils/dialog';
import { getNumberGridMode } from '../utils/numberGridUtils';
import type { BatchRow } from '../utils/numberGridUtils';
import { getTrackingType, type TrackingType } from '../utils/trackingUtils';
import { NumberGrid } from './NumberGrid';
import './MovementLinesGrid.css';

export interface MovementLinesGridHandle {
  focusErrorLineNext: (fromRow: number) => void;
  focusFirstItemSelect: () => void;
}

export interface LineValidation {
  status: 'valid' | 'warning' | 'error';
  messages: string[];
}

export interface StockMapEntry {
  available: number;
  reserved?: number;
  blocked?: number;
}

type VariantOption = { id: string; code: string; name: string; isDefault: boolean; isActive: boolean; metadata?: Record<string, unknown> };

interface MovementLinesGridProps {
  lines: MovementLineRequest[];
  onChange: (lines: MovementLineRequest[]) => void;
  items: InventoryItem[];
  locations: Location[];
  variantsByItem?: Record<string, VariantOption[]>;
  variantLocked?: boolean;
  defaultFromLocationId?: string;
  defaultToLocationId?: string;
  movementType: MovementType;
  stockMap?: Record<string, StockMapEntry>;
  lineValidations?: Record<number, LineValidation>;
  fetchAvailableForBatch?: (itemId: string, locationId: string, batchNumber: string, variantId?: string) => Promise<number>;
  onBatchSerialOpenChange?: (index: number | null) => void;
}

function resolveDefaultVariantId(variants: VariantOption[]): string | null {
  if (!variants.length) return null;
  const v = variants.find((x) => x.isDefault && x.isActive) || variants.find((x) => x.isActive);
  return v?.id ?? null;
}

function MovementLinesGridInner(
  {
    lines,
    onChange,
    items,
    locations,
    variantsByItem = {},
    variantLocked = false,
    defaultFromLocationId,
    defaultToLocationId,
    movementType,
    stockMap = {},
    lineValidations = {},
    fetchAvailableForBatch,
    onBatchSerialOpenChange,
  }: MovementLinesGridProps,
  ref: React.ForwardedRef<MovementLinesGridHandle>
) {
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [batchSerialLineIndex, setBatchSerialLineIndex] = useState<number | null>(null);
  const [availableSerialsForSelect, setAvailableSerialsForSelect] = useState<SerialResponse[]>([]);
  const [reconciledHintForLine, setReconciledHintForLine] = useState<Record<number, boolean>>({});
  const reconciledHintTimeouts = useRef<Record<number, NodeJS.Timeout>>({});
  const [focusedRow, setFocusedRow] = useState<number>(0);
  const [focusedCol, setFocusedCol] = useState<number>(1);
  const cellRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLElement | null>>({});
  const selectRefs = useRef<Record<string, HTMLSelectElement | null>>({});

  const addLine = () => {
    const newLineIndex = lines.length;
    onChange([
      ...lines,
      {
        itemId: '',
        quantity: 1,
        unitOfMeasure: 'pcs',
      },
    ]);
    // Focus the product name (Item) dropdown of the newly added line
    setTimeout(() => focusCell(newLineIndex, 1), 0);
  };

  const removeLine = (index: number) => {
    onChange(lines.filter((_, i) => i !== index));
    const newSelected = new Set(selectedRows);
    newSelected.delete(index);
    setSelectedRows(newSelected);
  };

  const duplicateLine = (index: number) => {
    const lineToDuplicate = lines[index];
    const newLines = [...lines];
    newLines.splice(index + 1, 0, {
      ...lineToDuplicate,
      quantity: 1,
      batchNumber: undefined,
      manufacturingDate: undefined,
      expiryDate: undefined,
      serialNumbers: undefined,
    });
    onChange(newLines);
  };

  const updateLine = (index: number, updates: Partial<MovementLineRequest>) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], ...updates };
    onChange(newLines);
    // Clear reconciled hint when quantity is manually edited
    if (updates.quantity !== undefined && reconciledHintForLine[index]) {
      clearReconciledHint(index);
    }
  };

  const clearReconciledHint = (index: number) => {
    if (reconciledHintTimeouts.current[index]) {
      clearTimeout(reconciledHintTimeouts.current[index]);
      delete reconciledHintTimeouts.current[index];
    }
    setReconciledHintForLine((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const setReconciledHint = (index: number) => {
    clearReconciledHint(index);
    setReconciledHintForLine((prev) => ({ ...prev, [index]: true }));
    reconciledHintTimeouts.current[index] = setTimeout(() => {
      clearReconciledHint(index);
    }, 4000);
  };

  useEffect(() => {
    return () => {
      Object.values(reconciledHintTimeouts.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  // Sync Select refs after render
  useEffect(() => {
    lines.forEach((line, rowIndex) => {
      [1, 2, 3, 4].forEach((colIndex) => {
        const item = items.find((i) => i.id === line?.itemId);
        const use =
          colIndex === 1 ||
          (colIndex === 2 && item?.hasVariants) ||
          (colIndex === 3 && needsFromLocation(movementType)) ||
          (colIndex === 4 && needsToLocation(movementType));
        if (use) {
          const selectEl = document.querySelector(`select[data-row="${rowIndex}"][data-col="${colIndex}"]`) as HTMLSelectElement | null;
          if (selectEl) {
            const key = `r-${rowIndex}-c-${colIndex}`;
            cellRefs.current[key] = selectEl;
            selectRefs.current[key] = selectEl;
          }
        }
      });
    });
  }, [lines, movementType, items]);

  // Fetch availableSerials for NumberGrid when mode is SELECT and trackingType is SERIAL
  useEffect(() => {
    if (batchSerialLineIndex == null) {
      setAvailableSerialsForSelect([]);
      return;
    }
    const ln = lines[batchSerialLineIndex];
    const it = items.find((i) => i.id === ln?.itemId);
    const trackingType = getBatchSerialMode(it) === 'batch' ? 'BATCH' : 'SERIAL';
    const { mode, serialStatus } = getNumberGridMode(movementType, ln?.quantity ?? 0);
    const locId = ln?.fromLocationId || defaultFromLocationId || '';
    if (mode !== 'SELECT' || trackingType !== 'SERIAL' || !ln?.itemId || !locId) {
      setAvailableSerialsForSelect([]);
      return;
    }
    inventoryService
      .getSerialsByItem(ln.itemId, locId, serialStatus, ln.variantId)
      .then(setAvailableSerialsForSelect)
      .catch(() => setAvailableSerialsForSelect([]));
  }, [batchSerialLineIndex, lines, movementType, items, defaultFromLocationId]);

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const rows = pastedText.split('\n').filter((row) => row.trim());
    
    const newLines: MovementLineRequest[] = [];
    for (const row of rows) {
      const cols = row.split('\t').map((col) => col.trim());
      if (cols.length >= 2) {
        const sku = cols[0];
        const qty = parseFloat(cols[1]) || 1;
        const item = items.find((i) => i.sku.toLowerCase() === sku.toLowerCase());
        if (item) {
          newLines.push({
            itemId: item.id,
            quantity: qty,
            unitOfMeasure: item.unitOfMeasure,
            fromLocationId: cols[2] ? locations.find((l) => l.code === cols[2])?.id : defaultFromLocationId,
            toLocationId: cols[3] ? locations.find((l) => l.code === cols[3])?.id : defaultToLocationId,
          });
        }
      }
    }
    
    if (newLines.length > 0) {
      onChange([...lines, ...newLines]);
    }
  };

  const getSelectedItem = (itemId: string) => {
    return items.find((item) => item.id === itemId);
  };

  const needsFromLocation = (type: MovementType) => {
    return [
      MovementType.TRANSFER,
      MovementType.ISSUE,
      MovementType.DAMAGE,
      MovementType.WASTE,
      MovementType.LOSS,
      MovementType.BLOCK,
    ].includes(type);
  };

  const needsToLocation = (type: MovementType) => {
    return [
      MovementType.RECEIPT,
      MovementType.TRANSFER,
      MovementType.ADJUSTMENT,
    ].includes(type);
  };

  const getEffectiveFromId = (line: MovementLineRequest) =>
    line.fromLocationId || defaultFromLocationId || '';
  const getEffectiveToId = (line: MovementLineRequest) =>
    line.toLocationId || defaultToLocationId || '';
  const getStockKey = (line: MovementLineRequest) =>
    `${line.itemId || ''}|${line.variantId ?? 'na'}|${getEffectiveFromId(line)}`;

  const getTrackingTypeForItem = (item: InventoryItem | undefined): TrackingType => {
    if (!item) return 'NONE';
    return getTrackingType(item.industryFlags);
  };

  const getColumnHeaderForTracking = (lines: MovementLineRequest[], items: InventoryItem[]): string => {
    const trackingTypes = new Set<TrackingType>();
    lines.forEach((line) => {
      const item = items.find((i) => i.id === line.itemId);
      trackingTypes.add(getTrackingTypeForItem(item));
    });
    
    if (trackingTypes.size === 0 || (trackingTypes.size === 1 && trackingTypes.has('NONE'))) {
      return 'Batch/Serial';
    }
    if (trackingTypes.size === 1) {
      const type = Array.from(trackingTypes)[0];
      return type === 'BATCH' ? 'Batch' : 'Serial';
    }
    // Mixed types
    return 'Batch/Serial';
  };

  const getBatchSerialSummary = (line: MovementLineRequest, item: InventoryItem | undefined): string => {
    if (!item) return '-';
    const trackingType = getTrackingTypeForItem(item);
    
    if (trackingType === 'BATCH') {
      if (line.batchNumber) {
        const p = [`B: ${line.batchNumber}`];
        if (line.expiryDate) p.push(`exp ${line.expiryDate.slice(0, 7)}`);
        return p.join(', ');
      }
      return '— Click to enter batch';
    } else if (trackingType === 'SERIAL') {
      if (line.serialNumbers && line.serialNumbers.length > 0) {
        return `S: ${line.serialNumbers.length} serials`;
      }
      return '— Click to enter serials';
    }
    
    // NONE tracking
    return '-';
  };

  const getBatchSerialMode = (item: InventoryItem | undefined): 'batch' | 'serial' | null => {
    if (!item?.industryFlags) return null;
    if (item.industryFlags.requiresBatchTracking) return 'batch';
    if (item.industryFlags.requiresSerialTracking) return 'serial';
    return null;
  };

  const val = (idx: number) => lineValidations[idx] ?? { status: 'valid' as const, messages: [] };

  // Compute focusable columns for current movement type
  const getFocusableColumns = (): number[] => {
    const cols: number[] = [0]; // Checkbox
    cols.push(1); // Item
    cols.push(2); // Variant (read-only but focusable)
    if (needsFromLocation(movementType)) cols.push(3); // From Location
    if (needsToLocation(movementType)) cols.push(4); // To Location
    // Skip 5: Available (read-only)
    cols.push(6); // Quantity
    // Skip 7: UoM (read-only)
    cols.push(8); // Batch/Serial
    cols.push(9); // Line Reason
    cols.push(10); // Status
    // Skip 11: Actions (not focusable)
    return cols;
  };

  const focusableColumns = getFocusableColumns();

  const getCellKey = (row: number, col: number): string => `r-${row}-c-${col}`;

  const focusCell = (row: number, col: number) => {
    const key = getCellKey(row, col);
    let cell = cellRefs.current[key];
    if (!cell && selectRefs.current[key]) {
      cell = selectRefs.current[key];
    }
    // DOM fallback: find by data-row/data-col when refs missed (e.g. after re-render)
    if (!cell) {
      const el = document.querySelector(`[data-row="${row}"][data-col="${col}"]`) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null;
      if (el && typeof el.focus === 'function') cell = el;
    }
    if (cell) {
      // Blur active SELECT first so native dropdown closes before moving focus
      const active = document.activeElement;
      if (active?.tagName === 'SELECT') (active as HTMLElement).blur();
      cell.focus();
      setFocusedRow(row);
      setFocusedCol(col);
    } else {
      const idx = focusableColumns.indexOf(col);
      if (idx >= 0 && idx < focusableColumns.length - 1) {
        focusCell(row, focusableColumns[idx + 1]);
      }
    }
  };

  const getNextFocusableCol = (currentCol: number, direction: 'next' | 'prev'): number | null => {
    const idx = focusableColumns.indexOf(currentCol);
    if (idx < 0) return focusableColumns[0] ?? null;
    if (direction === 'next') {
      return idx < focusableColumns.length - 1 ? focusableColumns[idx + 1] : null;
    } else {
      return idx > 0 ? focusableColumns[idx - 1] : null;
    }
  };

  // Helper to move focus to next element after dropdown selection
  const moveFocusAfterSelect = (rowIndex: number, currentCol: number) => {
    const nextCol = getNextFocusableCol(currentCol, 'next');
    if (nextCol !== null) {
      // Move to next column in same row
      setTimeout(() => focusCell(rowIndex, nextCol), 0);
    } else {
      // Last column, move to first column of next row
      if (rowIndex < lines.length - 1) {
        setTimeout(() => focusCell(rowIndex + 1, focusableColumns[0]), 0);
      } else {
        // Last row, wrap to first column of current row
        setTimeout(() => focusCell(rowIndex, focusableColumns[0]), 0);
      }
    }
  };

  // Reusable handler for Select onChange that updates line and moves focus
  const handleSelectChange = (
    rowIndex: number,
    colIndex: number,
    updateFn: (value: string) => void
  ) => {
    return (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateFn(e.target.value);
      // Move focus after selection (works even if same option selected via Enter)
      moveFocusAfterSelect(rowIndex, colIndex);
    };
  };

  // Handler for Select keyboard events - allows dropdown to open/close naturally
  const handleSelectKeyDown = (rowIndex: number, colIndex: number) => {
    return (e: React.KeyboardEvent<HTMLSelectElement>) => {
      // Disable ArrowUp/ArrowDown for option selection - use for row navigation instead
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        // Move focus to previous/next row, same column
        if (e.key === 'ArrowUp' && rowIndex > 0) {
          focusCell(rowIndex - 1, colIndex);
        } else if (e.key === 'ArrowDown') {
          if (rowIndex < lines.length - 1) {
            focusCell(rowIndex + 1, colIndex);
          } else {
            // Last row, add new line and focus it
            addLine();
          }
        }
        return;
      }
      // Let Select handle Enter naturally (open/close dropdown, select option)
      // Focus movement happens in onChange after selection
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Arrow keys are handled by onKeyDownCapture on wrapper div
        return;
      }
      // Pass other keys to main handler
      handleKeyDown(e, rowIndex, colIndex);
    };
  };

  const handleKeyDown = (e: React.KeyboardEvent, rowIndex: number, colIndex: number) => {
    if (batchSerialLineIndex !== null) return; // Don't handle when editor is open

    const isSelect = (e.target as HTMLElement)?.tagName === 'SELECT';

    // Tab / Shift+Tab
    if (e.key === 'Tab') {
      e.preventDefault();
      const nextCol = getNextFocusableCol(colIndex, e.shiftKey ? 'prev' : 'next');
      if (nextCol !== null) {
        focusCell(rowIndex, nextCol);
      } else if (!e.shiftKey) {
        // Last cell, move to next row
        if (rowIndex < lines.length - 1) {
          focusCell(rowIndex + 1, focusableColumns[0]);
        }
      } else {
        // First cell, move to previous row
        if (rowIndex > 0) {
          focusCell(rowIndex - 1, focusableColumns[focusableColumns.length - 1]);
        }
      }
      return;
    }

    // Enter: next editable in same row, or next row if on last column
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey) {
      if (isSelect) {
        // Select Enter opens/closes dropdown naturally - onChange handles focus movement
        return;
      }
      e.preventDefault();
      const nextCol = getNextFocusableCol(colIndex, 'next');
      if (nextCol !== null) {
        focusCell(rowIndex, nextCol);
      } else {
        // Last column, move to first column of next row
        if (rowIndex < lines.length - 1) {
          focusCell(rowIndex + 1, focusableColumns[0]);
        } else {
          // Last row, wrap to first column of current row
          focusCell(rowIndex, focusableColumns[0]);
        }
      }
      return;
    }

    // Arrow keys (let SELECT use ArrowUp/ArrowDown to open/navigate the dropdown)
    if (e.key === 'ArrowUp') {
      if (isSelect) return;
      e.preventDefault();
      if (rowIndex > 0) {
        focusCell(rowIndex - 1, colIndex);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      if (isSelect) return;
      e.preventDefault();
      if (rowIndex < lines.length - 1) {
        focusCell(rowIndex + 1, colIndex);
      } else {
        addLine();
        setTimeout(() => focusCell(lines.length, colIndex), 0);
      }
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevCol = getNextFocusableCol(colIndex, 'prev');
      if (prevCol !== null) focusCell(rowIndex, prevCol);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextCol = getNextFocusableCol(colIndex, 'next');
      if (nextCol !== null) focusCell(rowIndex, nextCol);
      return;
    }

    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      e.stopPropagation();
      const lineToDuplicate = lines[rowIndex];
      const newLines = [...lines];
      newLines.splice(rowIndex + 1, 0, {
        ...lineToDuplicate,
        quantity: 1,
        batchNumber: undefined,
        manufacturingDate: undefined,
        expiryDate: undefined,
        serialNumbers: undefined,
      });
      onChange(newLines);
      setTimeout(() => focusCell(rowIndex + 1, 1), 0);
      return;
    }

    if (e.ctrlKey && e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      const line = lines[rowIndex];
      const hasData = line.itemId || (line.quantity && line.quantity > 0) || line.batchNumber || (line.serialNumbers && line.serialNumbers.length > 0);
      if (hasData && !confirmWithFocusRecovery('Remove line with data?')) {
        return;
      }
      removeLine(rowIndex);
      // Focus the last remaining line's Item (product) dropdown
      const lastRowIndex = Math.max(0, lines.length - 2);
      if (lines.length > 1) {
        setTimeout(() => focusCell(lastRowIndex, 1), 0);
      }
      return;
    }

    if (e.altKey && e.key === 'b') {
      e.preventDefault();
      e.stopPropagation();
      const item = getSelectedItem(lines[rowIndex]?.itemId ?? '');
      const mode = getBatchSerialMode(item);
      if (mode) {
        setBatchSerialLineIndex(rowIndex);
        onBatchSerialOpenChange?.(rowIndex);
      }
      return;
    }

    if (e.altKey && e.key === 'r') {
      e.preventDefault();
      e.stopPropagation();
      focusCell(rowIndex, 9); // Line Reason
      return;
    }

    if (e.altKey && e.key === 's') {
      e.preventDefault();
      e.stopPropagation();
      focusCell(rowIndex, 10); // Status
      return;
    }

    // F2: focus next error line
    if (e.key === 'F2') {
      e.preventDefault();
      e.stopPropagation();
      focusErrorLineNext(rowIndex);
      return;
    }
  };

  const focusErrorLineNext = (fromRow: number) => {
    let nextRow = fromRow + 1;
    while (nextRow < lines.length) {
      const validation = lineValidations[nextRow];
      if (validation?.status === 'error') {
        focusCell(nextRow, 1); // Focus Item (first focusable)
        return;
      }
      nextRow++;
    }
    // Wrap from start
    for (let i = 0; i <= fromRow; i++) {
      const validation = lineValidations[i];
      if (validation?.status === 'error') {
        focusCell(i, 1);
        return;
      }
    }
  };

  useImperativeHandle(ref, () => ({
    focusErrorLineNext: (fromRow: number) => {
      focusErrorLineNext(fromRow);
    },
    focusFirstItemSelect: () => {
      setTimeout(() => focusCell(0, 1), 0);
    },
  }));

  return (
    <div className="movement-lines-grid">
      <div className="lines-grid-toolbar">
        <Button variant="ghost" size="sm" onClick={addLine}>
          + Add New Item
        </Button>
        {selectedRows.size > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(lines.filter((_, i) => !selectedRows.has(i)));
              setSelectedRows(new Set());
            }}
          >
            Delete Selected ({selectedRows.size})
          </Button>
        )}
      </div>

      <div className="lines-grid-container" onPaste={handlePaste}>
        <table>
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input
                  type="checkbox"
                  checked={selectedRows.size === lines.length && lines.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedRows(new Set(lines.map((_, i) => i)));
                    } else {
                      setSelectedRows(new Set());
                    }
                  }}
                />
              </th>
              <th>Item *</th>
              <th>{lines.some((l) => items.find((i) => i.id === l.itemId)?.hasVariants) ? 'Variant *' : 'Variant'}</th>
              {needsFromLocation(movementType) && <th>From Location</th>}
              {needsToLocation(movementType) && <th>To Location</th>}
              {needsFromLocation(movementType) && <th>Available</th>}
              <th>Quantity *</th>
              <th>UoM</th>
              <th>{getColumnHeaderForTracking(lines, items)}</th>
              <th>Line Reason</th>
              <th style={{ width: '36px' }}>Status</th>
              <th style={{ width: '80px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const item = getSelectedItem(line.itemId);
              const isFocusedRow = focusedRow === index;
              return (
                <tr key={index} className={isFocusedRow ? 'focused-row' : ''}>
                  <td>
                    <input
                      ref={(el) => {
                        cellRefs.current[getCellKey(index, 0)] = el;
                      }}
                      type="checkbox"
                      checked={selectedRows.has(index)}
                      onChange={(e) => {
                        const newSelected = new Set(selectedRows);
                        if (e.target.checked) {
                          newSelected.add(index);
                        } else {
                          newSelected.delete(index);
                        }
                        setSelectedRows(newSelected);
                      }}
                      onKeyDown={(e) => handleKeyDown(e, index, 0)}
                      onFocus={() => {
                        setFocusedRow(index);
                        setFocusedCol(0);
                      }}
                      data-row={index}
                      data-col={0}
                    />
                  </td>
                  <td>
                    <div
                      ref={(el) => {
                        if (el) {
                          const selectEl = el.querySelector('select') as HTMLSelectElement | null;
                          if (selectEl) {
                            cellRefs.current[getCellKey(index, 1)] = selectEl;
                            selectRefs.current[getCellKey(index, 1)] = selectEl;
                          }
                        }
                      }}
                      onKeyDownCapture={(e) => {
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleKeyDown(e, index, 1);
                        }
                      }}
                    >
                      <Select
                        value={line.itemId}
                        onChange={handleSelectChange(index, 1, (value) => {
                          const selectedItem = items.find((i) => i.id === value);
                          const defId = selectedItem?.hasVariants ? resolveDefaultVariantId(variantsByItem[value] || []) : null;
                          const trackingType = getTrackingType(selectedItem?.industryFlags);
                          const updates: Partial<MovementLineRequest> = {
                            itemId: value,
                            variantId: defId || undefined,
                            unitOfMeasure: selectedItem?.unitOfMeasure || 'pcs',
                          };
                          // Clear tracking data that doesn't match the item's tracking type
                          if (trackingType !== 'SERIAL') {
                            updates.serialNumbers = undefined;
                          }
                          if (trackingType !== 'BATCH') {
                            updates.batchNumber = undefined;
                            updates.manufacturingDate = undefined;
                            updates.expiryDate = undefined;
                          }
                          updateLine(index, updates);
                        })}
                        onKeyDown={handleSelectKeyDown(index, 1)}
                        onFocus={() => {
                          setFocusedRow(index);
                          setFocusedCol(1);
                        }}
                        style={{ width: '200px' }}
                        data-row={index}
                        data-col={1}
                      >
                        <option value="">Select Item</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.sku} - {item.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td>
                    {item?.hasVariants ? (
                      <div
                        ref={(el) => {
                          if (el) {
                            const selectEl = el.querySelector('select') as HTMLSelectElement | null;
                            if (selectEl) {
                              cellRefs.current[getCellKey(index, 2)] = selectEl;
                              selectRefs.current[getCellKey(index, 2)] = selectEl;
                            }
                          }
                        }}
                        onKeyDownCapture={(e) => {
                          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleKeyDown(e, index, 2);
                          }
                        }}
                      >
                        <Select
                          value={line.variantId || ''}
                          onChange={handleSelectChange(index, 2, (value) => {
                            updateLine(index, {
                              variantId: value || undefined,
                              batchNumber: undefined,
                              serialNumbers: undefined,
                              manufacturingDate: undefined,
                              expiryDate: undefined,
                            });
                          })}
                          onKeyDown={handleSelectKeyDown(index, 2)}
                          onFocus={() => { setFocusedRow(index); setFocusedCol(2); }}
                          disabled={variantLocked}
                          style={{ width: '160px' }}
                          data-row={index}
                          data-col={2}
                          title={variantLocked ? 'Variant is locked' : undefined}
                        >
                          <option value="">Select...</option>
                          {(variantsByItem[line.itemId] || []).filter((v) => v.isActive).map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.code} - {v.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : (
                      <span
                        ref={(el) => { cellRefs.current[getCellKey(index, 2)] = el; }}
                        tabIndex={-1}
                        onKeyDown={(e) => handleKeyDown(e, index, 2)}
                        onFocus={() => { setFocusedRow(index); setFocusedCol(2); }}
                        data-row={index}
                        data-col={2}
                        style={{ cursor: 'default' }}
                      >
                        -
                      </span>
                    )}
                  </td>
                  {needsFromLocation(movementType) && (
                    <td>
                      <div
                        ref={(el) => {
                          const selectEl = el?.querySelector('select') as HTMLSelectElement | null;
                          cellRefs.current[getCellKey(index, 3)] = selectEl;
                          selectRefs.current[getCellKey(index, 3)] = selectEl;
                        }}
                        onKeyDownCapture={(e) => {
                          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleKeyDown(e, index, 3);
                          }
                        }}
                      >
                        <Select
                          value={line.fromLocationId || defaultFromLocationId || ''}
                          onChange={handleSelectChange(index, 3, (value) => {
                            updateLine(index, { fromLocationId: value || undefined });
                          })}
                          onKeyDown={handleSelectKeyDown(index, 3)}
                          onFocus={() => {
                            setFocusedRow(index);
                            setFocusedCol(3);
                          }}
                          style={{ width: '150px' }}
                          data-row={index}
                          data-col={3}
                        >
                          <option value="">Use Default</option>
                          {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.code}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </td>
                  )}
                  {needsToLocation(movementType) && (
                    <td>
                      <div
                        ref={(el) => {
                          const selectEl = el?.querySelector('select') as HTMLSelectElement | null;
                          cellRefs.current[getCellKey(index, 4)] = selectEl;
                          selectRefs.current[getCellKey(index, 4)] = selectEl;
                        }}
                        onKeyDownCapture={(e) => {
                          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleKeyDown(e, index, 4);
                          }
                        }}
                      >
                        <Select
                          value={line.toLocationId || defaultToLocationId || ''}
                          onChange={handleSelectChange(index, 4, (value) => {
                            updateLine(index, { toLocationId: value || undefined });
                          })}
                          onKeyDown={handleSelectKeyDown(index, 4)}
                          onFocus={() => {
                            setFocusedRow(index);
                            setFocusedCol(4);
                          }}
                          style={{ width: '150px' }}
                          data-row={index}
                          data-col={4}
                        >
                          <option value="">Use Default</option>
                          {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.code}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </td>
                  )}
                  {needsFromLocation(movementType) && (
                    <td className="available-qty-cell">
                      {line.itemId && getEffectiveFromId(line) ? (() => {
                        const s = stockMap[getStockKey(line)];
                        if (s == null) return <span className="available-loading">…</span>;
                        const opt = [s.reserved, s.blocked].filter((n) => n != null && n > 0);
                        return (
                          <span title={opt.length ? `Reserved: ${s.reserved ?? 0}, Blocked: ${s.blocked ?? 0}` : undefined}>
                            {s.available}
                            {opt.length ? ` (R:${s.reserved ?? 0} B:${s.blocked ?? 0})` : ''}
                          </span>
                        );
                      })() : <span>-</span>}
                    </td>
                  )}
                  <td>
                    <Input
                      ref={(el) => { cellRefs.current[getCellKey(index, 6)] = el; }}
                      type="number"
                      value={line.quantity || ''}
                      onChange={(e) => updateLine(index, { quantity: parseFloat(e.target.value) || 0 })}
                      onKeyDown={(e) => handleKeyDown(e, index, 6)}
                      onFocus={() => { setFocusedRow(index); setFocusedCol(6); }}
                      min="0.01"
                      step="0.01"
                      style={{ width: '100px' }}
                      data-row={index}
                      data-col={6}
                    />
                  </td>
                  <td>
                    <Input
                      value={line.unitOfMeasure || 'pcs'}
                      readOnly
                      style={{ width: '80px' }}
                    />
                  </td>
                  <td className="batch-serial-cell">
                    {(() => {
                      const trackingType = getTrackingTypeForItem(item);
                      if (trackingType === 'NONE') {
                        return (
                          <span
                            ref={(el) => { cellRefs.current[getCellKey(index, 8)] = el; }}
                            tabIndex={0}
                            onKeyDown={(e) => handleKeyDown(e, index, 8)}
                            onFocus={() => { setFocusedRow(index); setFocusedCol(8); }}
                            data-row={index}
                            data-col={8}
                            title="No tracking required"
                          >
                            -
                          </span>
                        );
                      }
                      const summary = getBatchSerialSummary(line, item);
                      const trackingLabel = trackingType === 'BATCH' ? 'Batch' : 'Serial';
                      return (
                        <button
                          type="button"
                          ref={(el) => { cellRefs.current[getCellKey(index, 8)] = el; }}
                          className="batch-serial-trigger"
                          onClick={() => {
                            setBatchSerialLineIndex(index);
                            onBatchSerialOpenChange?.(index);
                          }}
                          onKeyDown={(e) => handleKeyDown(e, index, 8)}
                          onFocus={() => { setFocusedRow(index); setFocusedCol(8); }}
                          data-row={index}
                          data-col={8}
                          title={`Tracking: ${trackingLabel}`}
                        >
                          <span style={{ fontSize: '10px', color: '#666', marginRight: '4px' }}>
                            [{trackingLabel}]
                          </span>
                          {summary}
                        </button>
                      );
                    })()}
                  </td>
                  <td>
                    <Input
                      ref={(el) => { cellRefs.current[getCellKey(index, 9)] = el; }}
                      value={line.lineReasonCode || ''}
                      onChange={(e) => updateLine(index, { lineReasonCode: e.target.value || undefined })}
                      onKeyDown={(e) => handleKeyDown(e, index, 9)}
                      onFocus={() => { setFocusedRow(index); setFocusedCol(9); }}
                      placeholder="Override reason"
                      style={{ width: '120px' }}
                      data-row={index}
                      data-col={9}
                    />
                  </td>
                  <td className="status-cell" title={val(index).messages.join('; ') || 'Valid'}>
                    <span className={`status-dot status-${val(index).status}`} aria-label={val(index).messages[0] || val(index).status} />
                  </td>
                  <td>
                    <div className="line-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => duplicateLine(index)}
                        tabIndex={-1}
                        title="Duplicate"
                      >
                        📋
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(index)}
                        tabIndex={-1}
                        title="Remove"
                      >
                        ×
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {lines.length === 0 && (
          <div className="empty-lines-message">
            <p>No lines added yet. Click "Add New Item" to start.</p>
            <p className="hint">Tip: Paste from Excel (SKU, Qty, From, To) to add multiple lines at once.</p>
          </div>
        )}
      </div>

      {batchSerialLineIndex != null && (() => {
        const idx = batchSerialLineIndex;
        const ln = lines[idx];
        const it = getSelectedItem(ln?.itemId ?? '');
        const batchSerialMode = getBatchSerialMode(it);
        if (!ln || !it || !batchSerialMode) return null;

        const trackingType = batchSerialMode === 'batch' ? 'BATCH' : 'SERIAL';
        const { mode: inputMode } = getNumberGridMode(movementType, ln.quantity ?? 0);
        const locationId = inputMode === 'SELECT' ? (getEffectiveFromId(ln) || undefined) : undefined;

        const existingSerialsInDoc = lines
          .flatMap((l, j) => (j === idx ? [] : l.serialNumbers ?? []))
          .filter(Boolean);

        const initialBatchRows: BatchRow[] = ln.batchNumber
          ? [{ batchCode: ln.batchNumber, quantity: ln.quantity || 0, manufacturingDate: ln.manufacturingDate, expiryDate: ln.expiryDate }]
          : [];

        return (
          <NumberGrid
            isOpen={true}
            mode={inputMode}
            trackingType={trackingType}
            movementType={movementType}
            itemId={ln.itemId}
            variantId={ln.variantId}
            locationId={locationId}
            fromLocationId={getEffectiveFromId(ln) || undefined}
            toLocationId={getEffectiveToId(ln) || undefined}
            expectedQuantity={ln.quantity || 0}
            initialSerialNumbers={ln.serialNumbers}
            initialBatchRows={initialBatchRows}
            existingSerialsInDoc={existingSerialsInDoc}
            availableSerials={inputMode === 'SELECT' && trackingType === 'SERIAL' ? availableSerialsForSelect : []}
            allowOverReceive={false}
            allowPartial={false}
            industryFlags={(it.industryFlags ?? {}) as import('@/services/inventory.service').IndustryFlags}
            fetchAvailableForBatch={fetchAvailableForBatch}
            onApply={(r) => {
              const oldQty = ln.quantity || 0;
              if (trackingType === 'SERIAL') {
                updateLine(idx, { serialNumbers: r.finalSerialList, quantity: r.derivedQuantity });
              } else {
                updateLine(idx, {
                  batchNumber: r.finalBatchList[0]?.batchCode,
                  manufacturingDate: r.finalBatchList[0]?.manufacturingDate,
                  expiryDate: r.finalBatchList[0]?.expiryDate,
                  quantity: r.derivedQuantity,
                });
              }
              if (oldQty !== r.derivedQuantity) setReconciledHint(idx);
              setBatchSerialLineIndex(null);
              onBatchSerialOpenChange?.(null);
            }}
            onCancel={() => {
              setBatchSerialLineIndex(null);
              onBatchSerialOpenChange?.(null);
            }}
          />
        );
      })()}
    </div>
  );
}

export const MovementLinesGrid = forwardRef(MovementLinesGridInner) as React.ForwardRefExoticComponent<
  MovementLinesGridProps & React.RefAttributes<MovementLinesGridHandle>
>;
MovementLinesGrid.displayName = 'MovementLinesGrid';
