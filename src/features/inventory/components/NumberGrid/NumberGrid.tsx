/**
 * NumberGrid - Unified modal for serial and batch entry on a movement line.
 * Supports INPUT/SELECT mode and SERIAL/BATCH tracking. Uses Modal, owns footer, Apply/Cancel, Ctrl+Enter, focus-on-open.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal } from '@/shared/components/modals';
import { Button } from '@/shared/components/ui';
import { confirmWithFocusRecovery } from '@/shared/utils/dialog';
import type { MovementType, IndustryFlags } from '@/services/inventory.service';
import type { SerialResponse } from '@/services/inventory.service';
import type { BatchRow, ValidationError, SerialValidationItem } from '../../utils/numberGridUtils';
import { serialNumbersEqual } from '../../utils/serialNumber';
import { SerialInputView } from './SerialInputView';
import { SerialGridInputView } from './SerialGridInputView';
import { SerialSelectView } from './SerialSelectView';
import { BatchInputView } from './BatchInputView';
import './NumberGrid.css';

export interface NumberGridResult {
  finalSerialList: string[];
  finalBatchList: BatchRow[];
  derivedQuantity: number;
  validationErrors: ValidationError[];
  serialStatuses?: SerialValidationItem[];
  /** Per-serial custom attribute values (Warranty expiry, Grade, Notes, etc.), keyed by serial number then field key. */
  serialAttributes?: Record<string, Record<string, any>>;
  isValid: boolean;
}

function getEmptyResult(): NumberGridResult {
  return {
    finalSerialList: [],
    finalBatchList: [],
    derivedQuantity: 0,
    validationErrors: [],
    isValid: false,
  };
}

export type NumberGridInputMode = 'INPUT' | 'SELECT';
export type NumberGridTrackingType = 'SERIAL' | 'BATCH';

export interface NumberGridProps {
  isOpen: boolean;
  mode: NumberGridInputMode;
  trackingType: NumberGridTrackingType;
  movementType: MovementType;
  itemId: string;
  variantId?: string;
  locationId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  expectedQuantity: number;
  initialSerialNumbers?: string[];
  /** SERIAL + INPUT + useSerialGrid only: per-serial attribute values to re-hydrate on reopen. */
  initialSerialAttributes?: Record<string, Record<string, any>>;
  initialBatchRows?: BatchRow[];
  existingSerialsInDoc?: string[];
  availableSerials?: SerialResponse[];
  allowOverReceive?: boolean;
  allowPartial?: boolean;
  /** SELECT mode only, SERIAL_OPTIONAL items: lets the user assign a brand-new serial to a
   * previously-bare unit as it leaves ("serialize at exit"), alongside picking from the pool. */
  allowNewSerial?: boolean;
  /** When true (count flow): BatchInputView uses one row only, hide Add/Remove. */
  singleBatchMode?: boolean;
  /** When true (SERIAL + INPUT only): render the one-step carry-forward spreadsheet grid (SerialGridInputView) instead of the legacy textarea+list, resolving and showing the item/variant's SerialAttributeTemplate as extra columns. */
  useSerialGrid?: boolean;
  /** Shown as the modal header title when provided (falls back to "Serial numbers"/"Batch details"). */
  itemName?: string;
  industryFlags: IndustryFlags;
  fetchAvailableForBatch?: (itemId: string, locationId: string, batchCode: string) => Promise<number>;
  onApply: (result: NumberGridResult) => void;
  onCancel: () => void;
  onChange?: (partial: Partial<NumberGridResult>) => void;
  onValidate?: (result: NumberGridResult) => void;
}

export const NumberGrid: React.FC<NumberGridProps> = ({
  isOpen,
  mode,
  trackingType,
  movementType,
  itemId,
  variantId,
  locationId,
  fromLocationId,
  toLocationId,
  expectedQuantity,
  initialSerialNumbers = [],
  initialSerialAttributes,
  initialBatchRows = [],
  existingSerialsInDoc = [],
  availableSerials = [],
  allowOverReceive = false,
  allowPartial = false,
  allowNewSerial = false,
  singleBatchMode,
  useSerialGrid = false,
  itemName,
  industryFlags,
  fetchAvailableForBatch,
  onApply,
  onCancel,
  onChange,
  onValidate,
}) => {
  const [result, setResult] = useState<NumberGridResult>(getEmptyResult);
  const [history, setHistory] = useState<NumberGridResult[]>([getEmptyResult()]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [errorSummaryExpanded, setErrorSummaryExpanded] = useState(false);
  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const errorRefs = useRef<Map<string, HTMLElement>>(new Map());
  const clearGridRef = useRef<(() => void) | null>(null);
  const registerClearAll = useCallback((fn: () => void) => {
    clearGridRef.current = fn;
  }, []);

  const handleResultChange = useCallback(
    (r: NumberGridResult) => {
      setResult(r);
      onChange?.({ ...r });
      onValidate?.(r);

      // Debounced history update
      if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = setTimeout(() => {
        setHistoryIndex((currentIndex) => {
          setHistory((prev) => {
            const newHistory = prev.slice(0, currentIndex + 1);
            newHistory.push(r);
            // Limit to 50 entries
            if (newHistory.length > 50) {
              newHistory.shift();
              return newHistory;
            }
            return newHistory;
          });
          return currentIndex + 1;
        });
      }, 500);
    },
    [onChange, onValidate]
  );

  // Reset result and history when opening
  useEffect(() => {
    if (isOpen) {
      setResult(getEmptyResult());
      setHistory([getEmptyResult()]);
      setHistoryIndex(0);
    }
  }, [isOpen]);

  // Focus first input when opened
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      firstInputRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Ctrl+Enter to Apply
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter' && result.isValid) {
        e.preventDefault();
        onApply(result);
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, onApply, onCancel]);

  const title = itemName || (trackingType === 'SERIAL' ? 'Serial numbers' : 'Batch details');
  const isSerialGridActive = mode === 'INPUT' && trackingType === 'SERIAL' && useSerialGrid;
  const blockingErrs = result.validationErrors.filter((e) => e.blocking);

  const hasUnsavedChanges =
    result.derivedQuantity > 0 ||
    result.finalSerialList.length > 0 ||
    result.finalBatchList.some((r) => (r.batchCode || '').trim() !== '');

  const handleClose = useCallback(() => {
    if (hasUnsavedChanges && !confirmWithFocusRecovery('Discard unsaved changes?')) return;
    onCancel();
  }, [hasUnsavedChanges, onCancel]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const prevResult = history[newIndex];
      setResult(prevResult);
      onChange?.(prevResult);
      onValidate?.(prevResult);
    }
  }, [historyIndex, history, onChange, onValidate]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const nextResult = history[newIndex];
      setResult(nextResult);
      onChange?.(nextResult);
      onValidate?.(nextResult);
    }
  }, [historyIndex, history, onChange, onValidate]);

  // Global keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const onKey = (e: KeyboardEvent) => {
      // SerialGridInputView owns its own row-array Undo/Redo (Ctrl+Z/Y) when active, to avoid desyncing
      // its internal grid state from this shell's derived-result history.
      if (useSerialGrid && trackingType === 'SERIAL' && mode === 'INPUT') {
        // fall through to other shortcuts below (Ctrl+S/K/?), skip Undo/Redo
      } else {
        // Ctrl+Z / Cmd+Z: Undo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        }
        // Ctrl+Y / Cmd+Y or Ctrl+Shift+Z: Redo
        if (((e.ctrlKey || e.metaKey) && e.key === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
          e.preventDefault();
          handleRedo();
        }
      }
      // Ctrl+S / Cmd+S: Apply (alternative to Ctrl+Enter)
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (result.isValid) {
          onApply(result);
          onCancel();
        }
      }
      // Ctrl+K / Cmd+K: Focus first input
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        firstInputRef.current?.focus();
      }
      // ? or Ctrl+/: Show shortcuts help
      if (e.key === '?' || ((e.ctrlKey || e.metaKey) && e.key === '/')) {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, result, handleUndo, handleRedo, onApply, onCancel, useSerialGrid, trackingType, mode]);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="lg" className="number-grid-modal">
      <div className="number-grid-body">
        {mode === 'INPUT' && trackingType === 'SERIAL' && useSerialGrid && (
          <SerialGridInputView
            ref={firstInputRef}
            movementType={movementType}
            itemId={itemId}
            variantId={variantId}
            fromLocationId={fromLocationId}
            toLocationId={toLocationId}
            expectedQuantity={expectedQuantity}
            initialSerialNumbers={initialSerialNumbers}
            initialSerialAttributes={initialSerialAttributes}
            existingSerialsInDoc={existingSerialsInDoc}
            allowOverReceive={allowOverReceive}
            allowPartial={allowPartial}
            onResultChange={handleResultChange}
            registerClearAll={registerClearAll}
          />
        )}
        {mode === 'INPUT' && trackingType === 'SERIAL' && !useSerialGrid && (
          <SerialInputView
            ref={firstInputRef}
            movementType={movementType}
            itemId={itemId}
            variantId={variantId}
            fromLocationId={fromLocationId}
            toLocationId={toLocationId}
            expectedQuantity={expectedQuantity}
            initialSerialNumbers={initialSerialNumbers}
            existingSerialsInDoc={existingSerialsInDoc}
            allowOverReceive={allowOverReceive}
            allowPartial={allowPartial}
            onResultChange={handleResultChange}
          />
        )}
        {mode === 'SELECT' && trackingType === 'SERIAL' && (
          <SerialSelectView
            ref={firstInputRef}
            expectedQuantity={expectedQuantity}
            availableSerials={availableSerials}
            initialSelected={initialSerialNumbers}
            allowOverReceive={allowOverReceive}
            allowPartial={allowPartial}
            allowNewSerial={allowNewSerial}
            onResultChange={handleResultChange}
          />
        )}
        {trackingType === 'BATCH' && (
          <BatchInputView
            ref={firstInputRef}
            expectedQuantity={expectedQuantity}
            initialBatchRows={initialBatchRows}
            industryFlags={industryFlags}
            itemId={itemId}
            locationId={locationId}
            fetchAvailableForBatch={fetchAvailableForBatch}
            allowOverReceive={allowOverReceive}
            allowPartial={allowPartial}
            singleBatchMode={singleBatchMode}
            onResultChange={handleResultChange}
          />
        )}
        {result.validationErrors.length > 0 && (
          <div className="number-grid-error-summary" aria-expanded={errorSummaryExpanded}>
            <div
              className="number-grid-error-summary-header"
              onClick={() => setErrorSummaryExpanded(!errorSummaryExpanded)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setErrorSummaryExpanded(!errorSummaryExpanded);
                }
              }}
              aria-expanded={errorSummaryExpanded}
              aria-label={`${result.validationErrors.length} error${result.validationErrors.length !== 1 ? 's' : ''} found. Click to ${errorSummaryExpanded ? 'collapse' : 'expand'} details.`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>
                  {result.validationErrors.length} error{result.validationErrors.length !== 1 ? 's' : ''} found
                </span>
                {!errorSummaryExpanded && (
                  <span style={{ 
                    fontSize: '10px', 
                    color: '#dc2626', 
                    background: 'rgba(220, 38, 38, 0.1)', 
                    padding: '2px 6px', 
                    borderRadius: '10px',
                    fontWeight: 600
                  }}>
                    Click to view
                  </span>
                )}
              </span>
              <span style={{ fontSize: '12px', transition: 'transform 0.2s', transform: errorSummaryExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
                ▼
              </span>
            </div>
            {errorSummaryExpanded && (
              <ul className="number-grid-error-summary-list">
                {result.validationErrors.map((err, idx) => {
                  const errorId = `error-${err.type}-${err.rowIndex ?? 'global'}-${idx}`;
                  // Extract serial numbers from error message if it's a duplicate error
                  const isSerialError = trackingType === 'SERIAL' && err.message.includes('Duplicate serials:');
                  const serialMatch = isSerialError ? err.message.match(/Duplicate serials: ([^…]+)/) : null;
                  return (
                    <li
                      key={errorId}
                      ref={(el) => {
                        if (el) errorRefs.current.set(errorId, el);
                        else errorRefs.current.delete(errorId);
                      }}
                    >
                      {err.type === 'row' && err.rowIndex != null ? (
                        <button
                          type="button"
                          className="number-grid-error-link"
                          onClick={() => {
                            // Scroll to error row - this will be handled by child components
                            const event = new CustomEvent('numbergrid-jump-to-error', {
                              detail: { rowIndex: err.rowIndex, field: err.field },
                            });
                            window.dispatchEvent(event);
                          }}
                        >
                          Row {err.rowIndex + 1}, {err.field}: {err.message}
                        </button>
                      ) : isSerialError && serialMatch ? (
                        <div>
                          <span>{err.message.split(':')[0]}: </span>
                          {serialMatch[1].split(', ').map((serial, i) => {
                            const serialIndex = result.finalSerialList.findIndex((s) =>
                              serialNumbersEqual(s, serial.trim())
                            );
                            return serialIndex >= 0 ? (
                              <button
                                key={i}
                                type="button"
                                className="number-grid-error-link"
                                onClick={() => {
                                  const event = new CustomEvent('numbergrid-jump-to-error', {
                                    detail: { rowIndex: serialIndex },
                                  });
                                  window.dispatchEvent(event);
                                }}
                                style={{ marginRight: '4px' }}
                              >
                                {serial.trim()}
                              </button>
                            ) : (
                              <span key={i} style={{ marginRight: '4px' }}>{serial.trim()}</span>
                            );
                          })}
                        </div>
                      ) : (
                        <span>{err.message}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="number-grid-footer">
        <div className="number-grid-summary">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span>
              Entered: <strong>{result.derivedQuantity}</strong> | Expected: <strong>{expectedQuantity || '—'}</strong>
            </span>
            {expectedQuantity > 0 && (
              <div className="number-grid-progress-container" style={{ flex: '1', minWidth: '100px', maxWidth: '200px' }}>
                <div className="number-grid-progress-bar">
                  <div
                    className="number-grid-progress-fill"
                    style={{
                      width: `${Math.min(100, (result.derivedQuantity / expectedQuantity) * 100)}%`,
                      backgroundColor: result.derivedQuantity === expectedQuantity ? '#22c55e' : result.derivedQuantity > expectedQuantity ? '#f59e0b' : '#3b82f6',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          {blockingErrs.length > 0 && (
            <span className="number-grid-errors">
              {blockingErrs.length} error{blockingErrs.length !== 1 ? 's' : ''} — expand error summary for details
            </span>
          )}
        </div>
        <div className="number-grid-actions">
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {isSerialGridActive ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearGridRef.current?.()}
                title="Clear all rows"
                aria-label="Clear all rows"
              >
                Clear All
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleUndo}
                  disabled={historyIndex <= 0}
                  title="Undo (Ctrl+Z)"
                  aria-label="Undo last change"
                >
                  ↶ Undo
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1}
                  title="Redo (Ctrl+Y)"
                  aria-label="Redo last undone change"
                >
                  ↷ Redo
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowShortcuts(true)}
              title="Show keyboard shortcuts (?)"
              aria-label="Show keyboard shortcuts help"
            >
              ?
            </Button>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!isSerialGridActive && (
              <Button variant="ghost" onClick={handleClose} aria-label="Cancel and close">
                Cancel
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => {
                if (result.isValid) {
                  onApply(result);
                  onCancel();
                }
              }}
              disabled={!result.isValid}
              aria-label="Apply changes"
            >
              Apply
            </Button>
          </div>
        </div>
      </div>
      {showShortcuts && (
        <Modal
          isOpen={showShortcuts}
          onClose={() => setShowShortcuts(false)}
          title="Keyboard Shortcuts"
          size="md"
        >
          <div style={{ padding: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Global</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                  <div><kbd>Ctrl+Enter</kbd> or <kbd>Ctrl+S</kbd> - Apply</div>
                  <div><kbd>Escape</kbd> - Cancel</div>
                  <div><kbd>Ctrl+Z</kbd> - Undo</div>
                  <div><kbd>Ctrl+Y</kbd> or <kbd>Ctrl+Shift+Z</kbd> - Redo</div>
                  <div><kbd>Ctrl+K</kbd> - Focus first input</div>
                  <div><kbd>?</kbd> or <kbd>Ctrl+/</kbd> - Show this help</div>
                </div>
              </div>
              {trackingType === 'SERIAL' && mode === 'INPUT' && useSerialGrid && (
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Serial Grid</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                    <div><kbd>Enter</kbd> (in Serial column) - Commit row, move to next</div>
                    <div><kbd>Arrow Keys</kbd> - Navigate cells</div>
                    <div><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> - Next / previous cell</div>
                    <div><kbd>Backspace</kbd> (empty last row) - Move to row above</div>
                    <div><kbd>Ctrl+D</kbd> - Fill cell value down the column</div>
                    <div><kbd>Ctrl+Home</kbd> / <kbd>Ctrl+End</kbd> - Jump to first / last cell</div>
                    <div><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> - Undo / Redo grid changes</div>
                    <div>Paste a multi-line/tab block to fill multiple rows and columns</div>
                  </div>
                </div>
              )}
              {trackingType === 'SERIAL' && mode === 'INPUT' && !useSerialGrid && (
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Serial Input</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                    <div><kbd>Arrow Up/Down</kbd> - Navigate serial list</div>
                    <div><kbd>Enter</kbd> - Edit selected serial</div>
                    <div><kbd>Delete</kbd> - Remove selected serial</div>
                    <div><kbd>Escape</kbd> - Cancel edit</div>
                  </div>
                </div>
              )}
              {trackingType === 'SERIAL' && mode === 'SELECT' && (
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Serial Select</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                    <div><kbd>Arrow Up/Down</kbd> - Navigate list</div>
                    <div><kbd>Space</kbd> or <kbd>Enter</kbd> - Toggle selection</div>
                    <div><kbd>Home/End</kbd> - Jump to first/last</div>
                    <div><kbd>Page Up/Down</kbd> - Scroll by page</div>
                    <div><kbd>Ctrl+A</kbd> - Select all</div>
                    <div><kbd>Ctrl+D</kbd> - Deselect all</div>
                  </div>
                </div>
              )}
              {trackingType === 'BATCH' && (
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Batch Table</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                    <div><kbd>Tab</kbd> - Move to next cell</div>
                    <div><kbd>Arrow Keys</kbd> - Navigate cells</div>
                    <div><kbd>Ctrl+Enter</kbd> - Add new row</div>
                    <div><kbd>Shift+Delete</kbd> - Remove row</div>
                    <div><kbd>Ctrl+C</kbd> - Copy row data</div>
                    <div><kbd>Ctrl+V</kbd> - Paste row data</div>
                    <div><kbd>Ctrl+Shift+C</kbd> - Copy row as CSV</div>
                    <div><kbd>Ctrl+Shift+V</kbd> - Paste CSV data</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
};
