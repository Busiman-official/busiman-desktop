/**
 * SerialInputView - SERIAL + INPUT: textarea, parse, list with backend-verified status.
 * For RECEIPT/ADJUSTMENT: NOT_FOUND → New (allowed). For ISSUE/TRANSFER: SELECT only (no INPUT).
 * Quantity derived from serial count. Apply blocked if any row is ❌, ⚠, 🔒, ♻, or ⏳ Checking.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback, forwardRef } from 'react';
import { inventoryService } from '@/services/inventory.service';
import type { NumberGridResult } from './NumberGrid';
import type { SerialValidationItem, SerialValidationStatus } from '../../utils/numberGridUtils';
import { parseSerialInput, getDuplicateSerials, validateSerialsSync, serialStatusToLabel, parsePastedData } from '../../utils/numberGridUtils';

export interface SerialInputViewProps {
  movementType: string;
  itemId: string;
  variantId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  expectedQuantity: number;
  initialSerialNumbers: string[];
  existingSerialsInDoc: string[];
  allowOverReceive: boolean;
  allowPartial: boolean;
  onResultChange: (r: NumberGridResult) => void;
}

export const SerialInputView = forwardRef<HTMLTextAreaElement | null, SerialInputViewProps>(
  (
    {
      movementType,
      itemId,
      variantId,
      fromLocationId,
      toLocationId,
      expectedQuantity,
      initialSerialNumbers,
      existingSerialsInDoc,
      allowOverReceive,
      allowPartial,
      onResultChange,
    },
    ref
  ) => {
    const [serialInput, setSerialInput] = useState(initialSerialNumbers.length > 0 ? initialSerialNumbers.join('\n') : '');
    const [serialStatuses, setSerialStatuses] = useState<SerialValidationItem[]>([]);
    const [focusedSerialIndex, setFocusedSerialIndex] = useState<number>(-1);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingValue, setEditingValue] = useState<string>('');
    const [scannerMode, setScannerMode] = useState(false);
    const [lastInputTime, setLastInputTime] = useState<number>(0);
    const [textareaFocused, setTextareaFocused] = useState(false);
    const [hintText, setHintText] = useState<string>('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelledRef = useRef(false);
    const listContainerRef = useRef<HTMLDivElement>(null);
    const editInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const serialRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

    const parsed = useMemo(() => parseSerialInput(serialInput), [serialInput]);
    const dupes = useMemo(() => getDuplicateSerials(parsed), [parsed]);
    const dupeSet = useMemo(() => new Set(dupes), [dupes]);
    const docSet = useMemo(() => new Set(existingSerialsInDoc.map((s) => s.toUpperCase())), [existingSerialsInDoc]);

    const validationErrors = useMemo(
      () => validateSerialsSync(parsed, expectedQuantity, existingSerialsInDoc, allowOverReceive, allowPartial),
      [parsed, expectedQuantity, existingSerialsInDoc, allowOverReceive, allowPartial]
    );

    const getRowStatus = useCallback(
      (i: number): { status: SerialValidationStatus; allowForMovementType: boolean } => {
        const s = parsed[i];
        if (dupeSet.has(s) || docSet.has(s)) return { status: 'DUPLICATE', allowForMovementType: false };
        const r = serialStatuses[i];
        if (r) return { status: r.status as SerialValidationStatus, allowForMovementType: r.allowForMovementType };
        return { status: 'CHECKING', allowForMovementType: false };
      },
      [parsed, dupeSet, docSet, serialStatuses]
    );

    useEffect(() => {
      if (parsed.length === 0) {
        setSerialStatuses([]);
        return;
      }
      setSerialStatuses(parsed.map((s) => ({ serialNumber: s, status: 'CHECKING', allowForMovementType: false })));
      cancelledRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        inventoryService
          .validateSerialsForMovement({ itemId, movementType, serialNumbers: parsed, fromLocationId, toLocationId, variantId })
          .then((res) => {
            if (!cancelledRef.current) {
              setSerialStatuses(res.map((item) => ({
                ...item,
                status: item.status as SerialValidationStatus,
              })));
            }
          })
          .catch(() => {
            if (!cancelledRef.current) setSerialStatuses(parsed.map((s) => ({ serialNumber: s, status: 'NOT_FOUND' as SerialValidationStatus, message: 'Validation failed', allowForMovementType: false })));
          });
      }, 350);
      return () => {
        cancelledRef.current = true;
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, [parsed, movementType, itemId, variantId, fromLocationId, toLocationId]);

    const serialStatusesForResult = useMemo(
      () =>
        parsed.map((s, i) => {
          const r = getRowStatus(i);
          return { serialNumber: s, status: r.status, allowForMovementType: r.allowForMovementType };
        }),
      [parsed, getRowStatus]
    );

    const isValid = useMemo(() => {
      const syncOk = validationErrors.filter((e) => e.blocking).length === 0 && (expectedQuantity === 0 || parsed.length > 0);
      const allAllow = parsed.length === 0 || parsed.every((_, i) => getRowStatus(i).allowForMovementType);
      const noneChecking = parsed.length === 0 || !serialStatuses.some((s) => s.status === 'CHECKING');
      return !!(syncOk && allAllow && noneChecking);
    }, [validationErrors, expectedQuantity, parsed, serialStatuses, getRowStatus]);

    const result: NumberGridResult = useMemo(
      () => ({
        finalSerialList: parsed,
        finalBatchList: [],
        derivedQuantity: parsed.length,
        validationErrors,
        serialStatuses: serialStatusesForResult,
        isValid,
      }),
      [parsed, validationErrors, serialStatusesForResult, isValid]
    );

    useEffect(() => {
      onResultChange(result);
    }, [result, onResultChange]);

    // Focus edit input when editing starts
    useEffect(() => {
      if (editingIndex !== null && editInputRef.current) {
        editInputRef.current.focus();
        editInputRef.current.select();
      }
    }, [editingIndex]);

    // Auto-scroll focused item into view
    useEffect(() => {
      if (focusedSerialIndex >= 0 && editingIndex === null) {
        const rowEl = serialRowRefs.current.get(focusedSerialIndex);
        if (rowEl && listContainerRef.current) {
          rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }, [focusedSerialIndex, editingIndex]);

    // Update contextual hint based on focus state
    useEffect(() => {
      if (editingIndex !== null) {
        setHintText('Enter to save, Escape to cancel');
      } else if (focusedSerialIndex >= 0) {
        setHintText('↑↓ navigate, Enter to edit, Delete to remove');
      } else if (textareaFocused) {
        setHintText('Type serials, press Enter to add each (Shift+Enter for newline)');
      } else {
        setHintText('');
      }
    }, [editingIndex, focusedSerialIndex, textareaFocused]);

    const removeSerial = useCallback((index: number) => {
      const newParsed = parsed.filter((_, i) => i !== index);
      setSerialInput(newParsed.join('\n'));
    }, [parsed]);

    const cancelEdit = useCallback(() => {
      setEditingIndex(null);
      setEditingValue('');
    }, []);

    const saveEdit = useCallback(() => {
      if (editingIndex === null) return;
      const newValue = editingValue.trim().toUpperCase();
      if (newValue && newValue !== parsed[editingIndex]) {
        const newParsed = [...parsed];
        newParsed[editingIndex] = newValue;
        setSerialInput(newParsed.join('\n'));
      }
      setEditingIndex(null);
      setEditingValue('');
    }, [editingIndex, editingValue, parsed]);

    const handleListKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (parsed.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedSerialIndex((prev) => {
            const next = prev < parsed.length - 1 ? prev + 1 : prev;
            return next;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedSerialIndex((prev) => {
            if (prev === -1) return parsed.length - 1;
            return prev > 0 ? prev - 1 : 0;
          });
          break;
        case 'Home':
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            // Ctrl+Home: focus textarea
            textareaRef.current?.focus();
            setFocusedSerialIndex(-1);
          } else {
            setFocusedSerialIndex(0);
          }
          break;
        case 'End':
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            // Ctrl+End: focus last item (or Apply button handled by parent)
            setFocusedSerialIndex(parsed.length - 1);
          } else {
            setFocusedSerialIndex(parsed.length - 1);
          }
          break;
        case 'Enter':
          if (focusedSerialIndex >= 0 && focusedSerialIndex < parsed.length && editingIndex === null) {
            e.preventDefault();
            setEditingIndex(focusedSerialIndex);
            setEditingValue(parsed[focusedSerialIndex]);
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (focusedSerialIndex >= 0 && focusedSerialIndex < parsed.length && editingIndex === null) {
            e.preventDefault();
            const indexToRemove = focusedSerialIndex;
            removeSerial(indexToRemove);
            // Adjust focus after removal
            if (parsed.length === 1) {
              setFocusedSerialIndex(-1);
              listContainerRef.current?.blur();
              textareaRef.current?.focus();
            } else if (indexToRemove >= parsed.length - 1) {
              setFocusedSerialIndex(parsed.length - 2);
            } else {
              setFocusedSerialIndex(indexToRemove);
            }
          }
          break;
        case 'Escape':
          if (editingIndex !== null) {
            e.preventDefault();
            cancelEdit();
          } else if (focusedSerialIndex >= 0) {
            // Escape from list: return focus to textarea
            e.preventDefault();
            setFocusedSerialIndex(-1);
            textareaRef.current?.focus();
          }
          break;
        case 'Tab':
          // Tab from list: let it bubble to focus Apply button
          if (!e.shiftKey && focusedSerialIndex >= 0) {
            setFocusedSerialIndex(-1);
          }
          break;
      }
    }, [parsed, focusedSerialIndex, editingIndex, removeSerial, cancelEdit]);

    const clearAll = useCallback(() => {
      setSerialInput('');
      setFocusedSerialIndex(-1);
      setEditingIndex(null);
    }, []);

    const fillExpected = useCallback(() => {
      if (expectedQuantity > 0) {
        const placeholders = Array.from({ length: expectedQuantity }, (_, i) => `SERIAL-${String(i + 1).padStart(3, '0')}`);
        setSerialInput(placeholders.join('\n'));
      }
    }, [expectedQuantity]);

    const removeDuplicates = useCallback(() => {
      const unique = Array.from(new Set(parsed));
      setSerialInput(unique.join('\n'));
    }, [parsed]);

    const sortSerials = useCallback(() => {
      const sorted = [...parsed].sort();
      setSerialInput(sorted.join('\n'));
    }, [parsed]);

    const copyAll = useCallback(() => {
      navigator.clipboard.writeText(parsed.join('\n'));
    }, [parsed]);

    return (
      <div className="number-grid-serial-input">
        <div aria-live="polite" aria-atomic="true" className="number-grid-aria-live">
          {parsed.length > 0 && `Entered ${parsed.length} serial${parsed.length !== 1 ? 's' : ''}. ${focusedSerialIndex >= 0 ? `Row ${focusedSerialIndex + 1} focused.` : ''}`}
        </div>
        <div className="number-grid-field">
          <label htmlFor="serial-input-textarea">Serial numbers ({parsed.length} / {expectedQuantity || '—'}) *</label>
          <div style={{ position: 'relative' }}>
            <textarea
              id="serial-input-textarea"
              ref={(el) => {
                textareaRef.current = el;
                if (typeof ref === 'function') ref(el);
                else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
              }}
              value={serialInput}
              aria-label="Enter serial numbers, one per line or comma separated"
              aria-describedby={hintText && textareaFocused ? "serial-input-hint-text" : undefined}
              onChange={(e) => {
                setSerialInput(e.target.value);
                const now = Date.now();
                const timeSinceLastInput = now - lastInputTime;
                setLastInputTime(now);
                // Detect rapid input (scanner typically < 100ms between chars)
                if (timeSinceLastInput > 0 && timeSinceLastInput < 100 && e.target.value.length > serialInput.length) {
                  setScannerMode(true);
                }
              }}
              onPaste={(e) => {
                e.preventDefault();
                const pasted = e.clipboardData.getData('text');
                const parsed = parsePastedData(pasted);
                if (parsed.length > 0) {
                  const current = parseSerialInput(serialInput);
                  const combined = [...current, ...parsed];
                  setSerialInput(combined.join('\n'));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey) {
                    // Shift+Enter: allow normal newline
                    return;
                  }
                  
                  const textarea = e.currentTarget;
                  const cursorPos = textarea.selectionStart;
                  const textBeforeCursor = serialInput.substring(0, cursorPos);
                  const textAfterCursor = serialInput.substring(cursorPos);
                  const linesBefore = textBeforeCursor.split('\n');
                  const currentLine = linesBefore[linesBefore.length - 1].trim();
                  const nextLineAfterCursor = textAfterCursor.split('\n')[0] || '';
                  
                  // If cursor at end of non-empty line (or only whitespace after cursor on same line)
                  if (currentLine && (textAfterCursor === '' || /^\s*$/.test(nextLineAfterCursor))) {
                    e.preventDefault();
                    // Parse current line and add to existing parsed serials
                    const currentParsed = parseSerialInput(currentLine);
                    if (currentParsed.length > 0) {
                      const existing = parseSerialInput(serialInput);
                      // Avoid duplicates
                      const newSerials = currentParsed.filter(s => !existing.includes(s));
                      if (newSerials.length > 0) {
                        const combined = [...existing, ...newSerials];
                        const newInput = combined.join('\n') + '\n';
                        setSerialInput(newInput);
                        // Keep cursor at start of new line
                        setTimeout(() => {
                          const newCursorPos = newInput.length;
                          textarea.setSelectionRange(newCursorPos, newCursorPos);
                        }, 0);
                      } else {
                        // All duplicates, just clear the current line
                        const lines = serialInput.split('\n');
                        lines[linesBefore.length - 1] = '';
                        setSerialInput(lines.join('\n'));
                        setTimeout(() => {
                          const newPos = textBeforeCursor.length;
                          textarea.setSelectionRange(newPos, newPos);
                        }, 0);
                      }
                    }
                  } else if (currentLine === '' && parsed.length > 0) {
                    // Empty line, move focus to list
                    e.preventDefault();
                    listContainerRef.current?.focus();
                    setFocusedSerialIndex(0);
                  } else if (scannerMode) {
                    // Scanner mode: auto-add on Enter (legacy behavior)
                    e.preventDefault();
                    const lines = serialInput.split('\n').filter(Boolean);
                    if (lines.length > 0) {
                      const lastLine = lines[lines.length - 1].trim();
                      if (lastLine && !parsed.includes(lastLine.toUpperCase())) {
                        setSerialInput(serialInput + (serialInput.endsWith('\n') ? '' : '\n'));
                      }
                    }
                  }
                }
              }}
              placeholder="Enter or paste one serial per line, or comma, tab, semicolon separated"
              rows={6}
              className="number-grid-textarea"
              onFocus={() => {
                setTextareaFocused(true);
                setFocusedSerialIndex(-1);
              }}
              onBlur={() => {
                // Delay to allow clicks on list items
                setTimeout(() => {
                  if (document.activeElement !== listContainerRef.current && 
                      !listContainerRef.current?.contains(document.activeElement) &&
                      editingIndex === null) {
                    setTextareaFocused(false);
                  }
                }, 100);
              }}
            />
            {scannerMode && (
              <div className="number-grid-scanner-badge" title="Scanner mode active - rapid input detected">
                📷 Scanner
              </div>
            )}
            {hintText && textareaFocused && (
              <div className="number-grid-hint" id="serial-input-hint-text" role="status" aria-live="polite">
                💡 {hintText}
              </div>
            )}
          </div>
        </div>
        {parsed.length > 0 && (
          <>
            <div className="number-grid-bulk-actions" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              <button type="button" className="number-grid-action-btn" onClick={clearAll} title="Clear all serials">
                Clear All
              </button>
              {expectedQuantity > 0 && (
                <button type="button" className="number-grid-action-btn" onClick={fillExpected} title={`Fill ${expectedQuantity} placeholder serials`}>
                  Fill Expected
                </button>
              )}
              <button type="button" className="number-grid-action-btn" onClick={removeDuplicates} title="Remove duplicate serials">
                Remove Duplicates
              </button>
              <button type="button" className="number-grid-action-btn" onClick={sortSerials} title="Sort serials alphabetically">
                Sort
              </button>
              <button type="button" className="number-grid-action-btn" onClick={copyAll} title="Copy all serials to clipboard">
                Copy All
              </button>
            </div>
            <div
              ref={listContainerRef}
              className="number-grid-serial-list"
              tabIndex={0}
              onKeyDown={handleListKeyDown}
              onFocus={() => {
                if (parsed.length > 0 && focusedSerialIndex === -1) {
                  setFocusedSerialIndex(0);
                }
              }}
              role="listbox"
              aria-label="Parsed serial numbers"
              aria-activedescendant={focusedSerialIndex >= 0 ? `serial-row-${focusedSerialIndex}` : undefined}
            >
            <div className="number-grid-serial-list-header">
              <span>#</span>
              <span>Serial</span>
              <span>Status</span>
              {/* <span style={{ fontSize: '10px', color: '#888', marginLeft: 'auto' }}>Press Enter to edit, Delete to remove</span> */}
            </div>
            {parsed.map((s, i) => {
              const { status } = getRowStatus(i);
              const isFocused = i === focusedSerialIndex && editingIndex === null;
              const isEditing = i === editingIndex;
              return (
                <div
                  key={`${i}-${s}`}
                  ref={(el) => {
                    if (el) serialRowRefs.current.set(i, el);
                    else serialRowRefs.current.delete(i);
                  }}
                  className={`number-grid-serial-row status-${status.toLowerCase()} ${isFocused ? 'focused' : ''}`}
                  data-focused={isFocused}
                  id={`serial-row-${i}`}
                  role="option"
                  aria-selected={isFocused}
                  tabIndex={isFocused ? 0 : -1}
                  onClick={() => setFocusedSerialIndex(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setFocusedSerialIndex(i);
                      if (e.key === 'Enter') {
                        setEditingIndex(i);
                        setEditingValue(parsed[i]);
                      }
                    }
                  }}
                >
                  <span className="num">{i + 1}</span>
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      className="number-grid-serial-edit-input"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={saveEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveEdit();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      style={{ flex: 1, padding: '2px 4px', fontFamily: 'monospace' }}
                    />
                  ) : (
                    <span className="serial">{s}</span>
                  )}
                  <span className="status">{serialStatusToLabel(status)}</span>
                </div>
              );
            })}
            </div>
          </>
        )}
      </div>
    );
  }
);
SerialInputView.displayName = 'SerialInputView';
