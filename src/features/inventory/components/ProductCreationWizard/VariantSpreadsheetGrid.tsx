/**
 * Excel-like keyboard grid for wizard variant entry (step 2 only).
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input, Select, Tooltip } from '@/shared/components/ui';
import { EmptyState } from '@/shared/components/data-display';
import {
  VARIANT_GRID_COL_COUNT,
  VARIANT_GRID_COL_KEYS,
  type WizardVariantRow,
  createEmptyVariantRow,
  duplicateVariantRow,
  isEditableTextCol,
} from './variantGridModel';
import { getFieldError, validateAllVariantRows } from './variantGridValidation';
import type { VariantRowFieldErrorKey } from './variantGridModel';
import { resolveVariantUnit, type VariantUnitOption } from './variantGridUnits';

export type VariantSpreadsheetGridHandle = {
  focusCell: (rowIndex: number, colIndex: number) => void;
  focusFirstCode: () => void;
};

export interface VariantSpreadsheetGridProps {
  rows: WizardVariantRow[];
  onRowsChange: (rows: WizardVariantRow[]) => void;
  rowErrors: Record<number, { hsn?: string; value?: string; name?: string; barcode?: string }>;
  onRowErrorsChange: React.Dispatch<
    React.SetStateAction<Record<number, { hsn?: string; value?: string; name?: string; barcode?: string }>>
  >;
  /** Product master default unit (step 1); used when a row has no per-variant unit. */
  unitOfMeasure: string;
  unitOptions?: VariantUnitOption[];
  emptyTitle: string;
  emptyMessage: string;
  emptyAction: React.ReactNode;
  className?: string;
  /** When false, step panel may be hidden — refocus when this becomes true (e.g. step 2 active). */
  isStepActive?: boolean;
  /** Opens variant details drawer for the given row. */
  onOpenDetails: (rowIndex: number) => void;
}

const GRID_TEMPLATE_COLUMNS = `100px minmax(150px,1fr) 130px 80px 100px 72px 72px 48px`;

function colIndexToField(colIndex: number): VariantRowFieldErrorKey | null {
  if (colIndex === 0) return 'hsn';
  if (colIndex === 1) return 'name';
  if (colIndex === 2) return 'barcode';
  return null;
}

export const VariantSpreadsheetGrid = forwardRef<VariantSpreadsheetGridHandle, VariantSpreadsheetGridProps>(
  function VariantSpreadsheetGrid(
    {
      rows,
      onRowsChange,
      rowErrors,
      onRowErrorsChange,
      unitOfMeasure,
      unitOptions = [],
      emptyTitle,
      emptyMessage,
      emptyAction,
      className = '',
      isStepActive = true,
      onOpenDetails,
    },
    ref
  ) {
    const [activeRow, setActiveRow] = useState(0);
    const [activeCol, setActiveCol] = useState(0);
    const parentRef = useRef<HTMLDivElement>(null);
    const cellRefs = useRef<Map<string, HTMLElement>>(new Map());
    const pendingFocusRef = useRef<{ row: number; col: number } | null>(null);
    /** Start false so the first time `isStepActive` is true we treat it as a transition into the step. */
    const prevStepActiveRef = useRef(false);

    const rowCount = rows.length;

    const virtualizer = useVirtualizer({
      count: rowCount,
      getScrollElement: () => parentRef.current,
      /** Initial guess; row `ref={virtualizer.measureElement}` + `data-index` measure real height (no fixed gap). */
      estimateSize: () => 38,
      overscan: 6,
    });

    const setCellRef = useCallback((rowIndex: number, colIndex: number, el: HTMLElement | null) => {
      const key = `${rowIndex}-${colIndex}`;
      if (el) cellRefs.current.set(key, el);
      else cellRefs.current.delete(key);
    }, []);

    /**
     * Virtual rows + hidden tabpanels mean refs are often missing on the first frame.
     * Scroll target row into view and retry focus across animation frames until the input mounts.
     *
     * attempt 0: defer one frame so React commit + roving tabindex (tabIndex 0 on new cell) apply
     * before focus(); otherwise the border updates but focus can stay on the previous input.
     */
    const attemptFocusCell = useCallback(
      (rowIndex: number, colIndex: number, attempt = 0) => {
        if (rowCount === 0) return;
        const safeRow = Math.max(0, Math.min(rowIndex, rowCount - 1));
        const safeCol = Math.max(0, Math.min(colIndex, VARIANT_GRID_COL_COUNT - 1));

        if (attempt === 0) {
          requestAnimationFrame(() => attemptFocusCell(rowIndex, colIndex, 1));
          return;
        }

        virtualizer.scrollToIndex(safeRow, { align: 'auto' });
        const el = cellRefs.current.get(`${safeRow}-${safeCol}`);
        if (el && typeof el.focus === 'function' && document.documentElement.contains(el)) {
          try {
            el.focus({ preventScroll: true });
          } catch {
            /* ignore */
          }
          return;
        }
        if (attempt < 45) {
          requestAnimationFrame(() => attemptFocusCell(rowIndex, colIndex, attempt + 1));
        }
      },
      [rowCount, virtualizer]
    );

    useEffect(() => {
      if (rowCount === 0) return;
      setActiveRow((r) => Math.min(r, rowCount - 1));
    }, [rowCount]);

    useImperativeHandle(
      ref,
      () => ({
        focusCell: (rowIndex: number, colIndex: number) => {
          pendingFocusRef.current = { row: rowIndex, col: colIndex };
          setActiveRow(rowIndex);
          setActiveCol(colIndex);
        },
        focusFirstCode: () => {
          pendingFocusRef.current = { row: 0, col: 0 };
          setActiveRow(0);
          setActiveCol(0);
        },
      }),
      [attemptFocusCell]
    );

    useLayoutEffect(() => {
      if (rowCount === 0) return;
      const pending = pendingFocusRef.current;
      if (pending) {
        pendingFocusRef.current = null;
        attemptFocusCell(pending.row, pending.col, 0);
        return;
      }
      attemptFocusCell(activeRow, activeCol, 0);
    }, [activeRow, activeCol, rowCount, attemptFocusCell]);

    /** Refocus first code when the variants step becomes visible (e.g. `hidden` removed on tabpanel). */
    useEffect(() => {
      const wasActive = prevStepActiveRef.current;
      prevStepActiveRef.current = isStepActive;
      if (!isStepActive || rowCount === 0) return;
      if (wasActive) return;
      setActiveRow(0);
      setActiveCol(0);
      pendingFocusRef.current = { row: 0, col: 0 };
      requestAnimationFrame(() => {
        requestAnimationFrame(() => attemptFocusCell(0, 0, 0));
      });
    }, [isStepActive, rowCount, attemptFocusCell]);

    const applyFieldError = useCallback(
      (rowIndex: number, field: VariantRowFieldErrorKey, message: string | undefined) => {
        onRowErrorsChange((prev) => {
          const next = { ...prev };
          const cur = { ...(next[rowIndex] || {}) };
          if (message) {
            cur[field] = message;
          } else {
            delete cur[field];
          }
          if (Object.keys(cur).length === 0) delete next[rowIndex];
          else next[rowIndex] = cur;
          return next;
        });
      },
      [onRowErrorsChange]
    );

    const validateCurrentEditableOrThrow = useCallback(
      (rowIndex: number, colIndex: number): boolean => {
        const field = colIndexToField(colIndex);
        if (!field) return true;
        const msg = getFieldError(rows, rowIndex, field);
        applyFieldError(rowIndex, field, msg);
        return msg === undefined;
      },
      [rows, applyFieldError]
    );

    const moveTo = useCallback((nextRow: number, nextCol: number) => {
      const r = Math.max(0, Math.min(nextRow, rowCount - 1));
      const c = Math.max(0, Math.min(nextCol, VARIANT_GRID_COL_COUNT - 1));
      pendingFocusRef.current = { row: r, col: c };
      setActiveRow(r);
      setActiveCol(c);
    }, [rowCount]);

    const goNext = useCallback(() => {
      if (rowCount === 0) return;
      if (!validateCurrentEditableOrThrow(activeRow, activeCol)) return;

      if (activeCol < VARIANT_GRID_COL_COUNT - 1) {
        moveTo(activeRow, activeCol + 1);
        return;
      }
      if (activeRow < rowCount - 1) {
        moveTo(activeRow + 1, 0);
        return;
      }
      const appended = [...rows, createEmptyVariantRow(unitOfMeasure)];
      onRowsChange(appended);
      pendingFocusRef.current = { row: appended.length - 1, col: 0 };
      setActiveRow(appended.length - 1);
      setActiveCol(0);
    }, [activeRow, activeCol, rowCount, rows, moveTo, onRowsChange, validateCurrentEditableOrThrow, unitOfMeasure]);

    const goPrev = useCallback(() => {
      if (rowCount === 0) return;
      if (!validateCurrentEditableOrThrow(activeRow, activeCol)) return;

      if (activeCol > 0) {
        moveTo(activeRow, activeCol - 1);
        return;
      }
      if (activeRow > 0) {
        moveTo(activeRow - 1, VARIANT_GRID_COL_COUNT - 1);
      }
    }, [activeRow, activeCol, rowCount, moveTo, validateCurrentEditableOrThrow]);

    const moveHorizontalArrow = useCallback(
      (dir: -1 | 1, input: HTMLInputElement | null) => {
        const colKey = VARIANT_GRID_COL_KEYS[activeCol];
        if (isEditableTextCol(colKey) && input) {
          const len = input.value.length;
          const start = input.selectionStart ?? 0;
          const end = input.selectionEnd ?? 0;
          if (start !== end) return false;
          if (dir < 0 && start > 0) return false;
          if (dir > 0 && start < len) return false;
        }
        if (!validateCurrentEditableOrThrow(activeRow, activeCol)) return true;

        let r = activeRow;
        let c = activeCol + dir;
        if (c < 0) {
          if (r <= 0) return true;
          r -= 1;
          c = VARIANT_GRID_COL_COUNT - 1;
        } else if (c >= VARIANT_GRID_COL_COUNT) {
          if (r >= rowCount - 1) return true;
          r += 1;
          c = 0;
        }
        pendingFocusRef.current = { row: r, col: c };
        moveTo(r, c);
        return true;
      },
      [activeRow, activeCol, rowCount, moveTo, validateCurrentEditableOrThrow]
    );

    const handleArrowVertical = useCallback(
      (dir: -1 | 1) => {
        if (!validateCurrentEditableOrThrow(activeRow, activeCol)) return;
        const nextRow = activeRow + dir;
        if (nextRow < 0 || nextRow >= rowCount) return;
        moveTo(nextRow, activeCol);
      },
      [activeRow, activeCol, rowCount, moveTo, validateCurrentEditableOrThrow]
    );

    const deleteRowAt = useCallback(
      (index: number) => {
        if (rowCount === 0) return;
        const row = rows[index];
        const nonempty =
          row.value.trim() ||
          row.name.trim() ||
          (row.barcode || '').trim() ||
          (row.hsn || '').trim();
        if (nonempty && !window.confirm('Delete this variant row?')) return;

        const next = rows.filter((_, i) => i !== index);
        onRowsChange(next);
        onRowErrorsChange({});

        if (next.length === 0) {
          setActiveRow(0);
          setActiveCol(0);
          return;
        }
        const targetRow = Math.min(index, next.length - 1);
        setActiveRow(targetRow);
        setActiveCol(activeCol);
        pendingFocusRef.current = { row: targetRow, col: activeCol };
      },
      [rowCount, rows, onRowsChange, onRowErrorsChange, activeCol]
    );

    const duplicateAt = useCallback(
      (index: number) => {
        const next = duplicateVariantRow(rows, index);
        onRowsChange(next);
        onRowErrorsChange(validateAllVariantRows(next));
        const newIndex = index + 1;
        setActiveRow(newIndex);
        setActiveCol(activeCol);
        pendingFocusRef.current = { row: newIndex, col: activeCol };
      },
      [rows, onRowsChange, onRowErrorsChange, activeCol]
    );

    const patchRow = useCallback(
      (rowIndex: number, patch: Partial<WizardVariantRow>) => {
        const next = [...rows];
        const cur = next[rowIndex];
        if (!cur) return;
        next[rowIndex] = { ...cur, ...patch };
        onRowsChange(next);
        const keys = Object.keys(patch) as (keyof WizardVariantRow)[];
        keys.forEach((k) => {
          if (k === 'id') return;
          const fk =
            k === 'hsn'
              ? 'hsn'
              : k === 'value'
                ? 'value'
                : k === 'name'
                  ? 'name'
                  : k === 'barcode'
                    ? 'barcode'
                    : null;
          if (fk) applyFieldError(rowIndex, fk, undefined);
        });
      },
      [rows, onRowsChange, applyFieldError]
    );

    const onCellKeyDown = useCallback(
      (
        e: React.KeyboardEvent,
        rowIndex: number,
        colIndex: number,
        inputEl: HTMLInputElement | null
      ) => {
        const colKey = VARIANT_GRID_COL_KEYS[colIndex];

        if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
          e.preventDefault();
          e.stopPropagation();
          duplicateAt(rowIndex);
          return;
        }

        if (
          (e.key === 'Delete' && e.ctrlKey) ||
          (e.key === 'Delete' && e.shiftKey) ||
          (e.key === 'Backspace' && e.ctrlKey)
        ) {
          if (isEditableTextCol(colKey)) {
            e.preventDefault();
            e.stopPropagation();
            deleteRowAt(rowIndex);
            return;
          }
        }

        if (e.key === 'Delete' && !e.ctrlKey && !e.shiftKey) {
          if (colKey === 'delete' || colKey === 'default') {
            e.preventDefault();
            e.stopPropagation();
            deleteRowAt(rowIndex);
            return;
          }
        }

        if (colKey === 'details') {
          if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            e.stopPropagation();
            onOpenDetails(rowIndex);
            return;
          }
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            goNext();
            return;
          }
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            const moved = moveHorizontalArrow(e.key === 'ArrowRight' ? 1 : -1, null);
            if (moved) {
              e.preventDefault();
              e.stopPropagation();
            }
            return;
          }
        }

        if (colKey === 'unit' || colKey === 'sellingPrice') {
          if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) goPrev();
            else goNext();
            return;
          }
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            goNext();
            return;
          }
          if (e.key === 'ArrowLeft') {
            const moved = moveHorizontalArrow(-1, null);
            if (moved) {
              e.preventDefault();
              e.stopPropagation();
            }
            return;
          }
          if (e.key === 'ArrowRight') {
            const moved = moveHorizontalArrow(1, null);
            if (moved) {
              e.preventDefault();
              e.stopPropagation();
            }
            return;
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            if (e.altKey) {
              e.preventDefault();
              e.stopPropagation();
              handleArrowVertical(e.key === 'ArrowDown' ? 1 : -1);
            }
            return;
          }
        }

        if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) goPrev();
          else goNext();
          return;
        }

        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          goNext();
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          handleArrowVertical(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          handleArrowVertical(-1);
          return;
        }
        if (e.key === 'ArrowLeft') {
          const moved = moveHorizontalArrow(-1, inputEl);
          if (moved) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
        if (e.key === 'ArrowRight') {
          const moved = moveHorizontalArrow(1, inputEl);
          if (moved) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
      },
      [duplicateAt, deleteRowAt, goNext, goPrev, handleArrowVertical, moveHorizontalArrow, onOpenDetails]
    );

    if (rowCount === 0) {
      return (
        <div className={`variant-spreadsheet-grid variant-spreadsheet-grid--empty ${className}`.trim()}>
          <EmptyState title={emptyTitle} message={emptyMessage} action={emptyAction} />
        </div>
      );
    }

    return (
      <div
        className={`variant-spreadsheet-grid ${className}`.trim()}
        role="grid"
        aria-label="Variant entry"
        aria-rowcount={rowCount}
        aria-colcount={VARIANT_GRID_COL_COUNT}
      >
        <div
          className="variant-grid-header-row"
          style={{ display: 'grid', gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
        >
          {VARIANT_GRID_COL_KEYS.map((key, i) => (
            <div
              key={key}
              className="variant-grid-header-cell"
              role="columnheader"
              aria-colindex={i + 1}
            >
              {key === 'delete'
                ? ''
                : key === 'hsn'
                  ? 'HSN'
                  : key === 'name'
                    ? 'Name'
                    : key === 'barcode'
                      ? 'Barcode'
                        : key === 'unit'
                        ? 'Unit'
                        : key === 'sellingPrice'
                          ? 'Selling Price'
                          : key === 'details'
                            ? 'More'
                            : 'Default'}
            </div>
          ))}
        </div>
        <div className="variant-grid-body-scroll" ref={parentRef} tabIndex={-1}>
          <div
            className="variant-grid-virtual-inner"
            style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}
          >
            {virtualizer.getVirtualItems().map((vRow) => {
              const rowIndex = vRow.index;
              const row = rows[rowIndex]!;
              const isDefaultRow = rowIndex === 0;
              return (
                <div
                  key={row.id}
                  ref={virtualizer.measureElement}
                  data-index={vRow.index}
                  role="row"
                  aria-rowindex={rowIndex + 1}
                  className="variant-grid-virtual-row"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  <VariantGridRowView
                    row={row}
                    rowIndex={rowIndex}
                    rowErrors={rowErrors[rowIndex]}
                    activeRow={activeRow}
                    activeCol={activeCol}
                    unitOfMeasure={unitOfMeasure}
                    unitOptions={unitOptions}
                    isDefaultRow={isDefaultRow}
                    gridTemplateColumns={GRID_TEMPLATE_COLUMNS}
                    setCellRef={setCellRef}
                    patchRow={patchRow}
                    onCellKeyDown={onCellKeyDown}
                    onActivate={moveTo}
                    onDelete={() => deleteRowAt(rowIndex)}
                    onOpenDetails={onOpenDetails}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);

type RowViewProps = {
  row: WizardVariantRow;
  rowIndex: number;
  rowErrors?: { hsn?: string; name?: string; barcode?: string };
  activeRow: number;
  activeCol: number;
  unitOfMeasure: string;
  unitOptions?: VariantUnitOption[];
  isDefaultRow: boolean;
  gridTemplateColumns: string;
  setCellRef: (rowIndex: number, colIndex: number, el: HTMLElement | null) => void;
  patchRow: (rowIndex: number, patch: Partial<WizardVariantRow>) => void;
  onCellKeyDown: (
    e: React.KeyboardEvent,
    rowIndex: number,
    colIndex: number,
    input: HTMLInputElement | null
  ) => void;
  onActivate: (row: number, col: number) => void;
  onDelete: () => void;
  onOpenDetails: (rowIndex: number) => void;
};

const VariantGridRowView = React.memo(function VariantGridRowView({
  row,
  rowIndex,
  rowErrors,
  activeRow,
  activeCol,
  unitOfMeasure,
  unitOptions = [],
  isDefaultRow,
  gridTemplateColumns,
  setCellRef,
  patchRow,
  onCellKeyDown,
  onActivate,
  onDelete,
  onOpenDetails,
}: RowViewProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null]);

  return (
    <div className="variant-grid-data-row" style={{ display: 'grid', gridTemplateColumns }}>
      <div
        role="gridcell"
        aria-colindex={1}
        className={`variant-grid-cell ${activeRow === rowIndex && activeCol === 0 ? 'variant-grid-cell--active' : ''}`}
        data-col="hsn"
        onClick={() => onActivate(rowIndex, 0)}
      >
        <div className="wizard-variant-cell-stack">
          <Input
            ref={(el) => {
              inputRefs.current[0] = el;
              setCellRef(rowIndex, 0, el);
            }}
            value={row.hsn || ''}
            onChange={(e) => patchRow(rowIndex, { hsn: e.target.value })}
            placeholder="HSN"
            aria-label={`Variant ${rowIndex + 1} HSN`}
            className={rowErrors?.hsn ? 'input--error' : ''}
            tabIndex={activeRow === rowIndex && activeCol === 0 ? 0 : -1}
            onKeyDown={(e) => onCellKeyDown(e, rowIndex, 0, inputRefs.current[0])}
            onFocus={() => onActivate(rowIndex, 0)}
          />
          {rowErrors?.hsn && <div className="wizard-field-error">{rowErrors.hsn}</div>}
        </div>
      </div>
      <div
        role="gridcell"
        aria-colindex={2}
        className={`variant-grid-cell ${activeRow === rowIndex && activeCol === 1 ? 'variant-grid-cell--active' : ''}`}
        data-col="name"
        onClick={() => onActivate(rowIndex, 1)}
      >
        <div className="wizard-variant-cell-stack">
          <Input
            ref={(el) => {
              inputRefs.current[1] = el;
              setCellRef(rowIndex, 1, el);
            }}
            value={row.name}
            onChange={(e) => patchRow(rowIndex, { name: e.target.value })}
            placeholder="e.g. Small"
            aria-label={`Variant ${rowIndex + 1} name`}
            className={rowErrors?.name ? 'input--error' : ''}
            tabIndex={activeRow === rowIndex && activeCol === 1 ? 0 : -1}
            onKeyDown={(e) => onCellKeyDown(e, rowIndex, 1, inputRefs.current[1])}
            onFocus={() => onActivate(rowIndex, 1)}
          />
          {rowErrors?.name && <div className="wizard-field-error">{rowErrors.name}</div>}
        </div>
      </div>
      <div
        role="gridcell"
        aria-colindex={3}
        className={`variant-grid-cell ${activeRow === rowIndex && activeCol === 2 ? 'variant-grid-cell--active' : ''}`}
        data-col="barcode"
        onClick={() => onActivate(rowIndex, 2)}
      >
        <div className="wizard-variant-cell-stack">
          <Input
            ref={(el) => {
              inputRefs.current[2] = el;
              setCellRef(rowIndex, 2, el);
            }}
            value={row.barcode || ''}
            onChange={(e) => patchRow(rowIndex, { barcode: e.target.value })}
            placeholder="Optional"
            aria-label={`Variant ${rowIndex + 1} barcode`}
            className={`wizard-variant-barcode-input ${rowErrors?.barcode ? 'input--error' : ''}`}
            tabIndex={activeRow === rowIndex && activeCol === 2 ? 0 : -1}
            onKeyDown={(e) => onCellKeyDown(e, rowIndex, 2, inputRefs.current[2])}
            onFocus={() => onActivate(rowIndex, 2)}
          />
          {rowErrors?.barcode && <div className="wizard-field-error">{rowErrors.barcode}</div>}
        </div>
      </div>
      <div
        role="gridcell"
        aria-colindex={4}
        className={`variant-grid-cell ${activeRow === rowIndex && activeCol === 3 ? 'variant-grid-cell--active' : ''}`}
        data-col="unit"
        onClick={() => onActivate(rowIndex, 3)}
      >
        <div className="wizard-variant-cell-stack">
          <Tooltip
            content="Press Space to open the list."
            position="bottom"
            openOnFocus={true}
            delay={0}
          >
            <Select
              ref={(el) => setCellRef(rowIndex, 3, el)}
              className="variant-grid-unit-select"
              options={unitOptions || []}
              value={resolveVariantUnit(row.unitOfMeasure, unitOfMeasure)}
              onChange={(e) => patchRow(rowIndex, { unitOfMeasure: e.target.value })}
              aria-label={`Variant ${rowIndex + 1} unit of measure`}
              tabIndex={activeRow === rowIndex && activeCol === 3 ? 0 : -1}
              onKeyDown={(e) => onCellKeyDown(e, rowIndex, 3, null)}
              onFocus={() => onActivate(rowIndex, 3)}
            />
          </Tooltip>
        </div>
      </div>
      <div
        role="gridcell"
        aria-colindex={5}
        className={`variant-grid-cell ${activeRow === rowIndex && activeCol === 4 ? 'variant-grid-cell--active' : ''}`}
        data-col="sellingPrice"
        onClick={() => onActivate(rowIndex, 4)}
      >
        <div className="wizard-variant-cell-stack">
          <Input
            ref={(el) => setCellRef(rowIndex, 4, el)}
            type="number"
            min={0}
            step={0.01}
            value={row.sellingPriceOverride ?? ''}
            onChange={(e) => patchRow(rowIndex, { sellingPriceOverride: e.target.value === '' ? undefined : Number(e.target.value) })}
            placeholder="0.00"
            aria-label={`Variant ${rowIndex + 1} selling price`}
            tabIndex={activeRow === rowIndex && activeCol === 4 ? 0 : -1}
            onKeyDown={(e) => onCellKeyDown(e, rowIndex, 4, null)}
            onFocus={() => onActivate(rowIndex, 4)}
          />
        </div>
      </div>
      <div
        role="gridcell"
        aria-colindex={6}
        className={`variant-grid-cell ${activeRow === rowIndex && activeCol === 5 ? 'variant-grid-cell--active' : ''}`}
        data-col="details"
        onClick={() => onActivate(rowIndex, 5)}
      >
        <Tooltip content="Variant details (editable) — Space to open" position="left" openOnFocus={true} delay={0}>
          <button
            type="button"
            ref={(el) => setCellRef(rowIndex, 5, el)}
            className="wizard-variant-details-btn"
            tabIndex={activeRow === rowIndex && activeCol === 5 ? 0 : -1}
            aria-label={`Open details for variant ${rowIndex + 1}`}
            onKeyDown={(e) => onCellKeyDown(e, rowIndex, 5, null)}
            onFocus={() => onActivate(rowIndex, 5)}
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetails(rowIndex);
            }}
          >
            <span aria-hidden>More</span>
          </button>
        </Tooltip>
      </div>
      <div
        role="gridcell"
        aria-colindex={7}
        aria-readonly="true"
        className={`variant-grid-cell ${activeRow === rowIndex && activeCol === 6 ? 'variant-grid-cell--active' : ''}`}
        data-col="default"
        onClick={() => onActivate(rowIndex, 6)}
      >
        <div
          ref={(el) => setCellRef(rowIndex, 6, el)}
          className="variant-grid-readonly-cell variant-grid-default-cell"
          tabIndex={activeRow === rowIndex && activeCol === 6 ? 0 : -1}
          onKeyDown={(e) => onCellKeyDown(e, rowIndex, 6, null)}
          onFocus={() => onActivate(rowIndex, 6)}
        >
          {isDefaultRow ? (
            <span className="wizard-variant-default-badge" title="First variant is saved as default">
              Default
            </span>
          ) : (
            <span className="wizard-variant-default-dash">—</span>
          )}
        </div>
      </div>
      <div
        role="gridcell"
        aria-colindex={8}
        className={`variant-grid-cell ${activeRow === rowIndex && activeCol === 7 ? 'variant-grid-cell--active' : ''}`}
        data-col="delete"
        onClick={() => onActivate(rowIndex, 7)}
      >
        <Tooltip content="Remove row (Ctrl+Delete)">
          <button
            type="button"
            ref={(el) => setCellRef(rowIndex, 7, el)}
            className="wizard-variant-row-delete"
            aria-label={`Remove variant row ${rowIndex + 1}`}
            tabIndex={activeRow === rowIndex && activeCol === 7 ? 0 : -1}
            onKeyDown={(e) => onCellKeyDown(e, rowIndex, 7, null)}
            onFocus={() => onActivate(rowIndex, 7)}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path
                d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </Tooltip>
      </div>
    </div>
  );
});

VariantSpreadsheetGrid.displayName = 'VariantSpreadsheetGrid';
