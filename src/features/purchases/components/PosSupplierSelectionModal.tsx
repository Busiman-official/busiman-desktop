/**
 * Purchase receipt / create-order flow: search existing suppliers or add new.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input } from '@/shared/components/ui';
import { Select } from '@/shared/components/ui/Select';
import type { PurchaseOrderSupplierContact } from '@/services/purchase.service';
import { scrollElementIntoContainer } from '@/shared/utils/scrollIntoContainer';
import {
  PAYMENT_TERM_OPTIONS,
  filterSuppliers,
  formatInr,
  paymentLabelToValue,
  supplierRecordToSnapshot,
  type SupplierRecord,
} from '../utils/supplierDirectory';
import { defaultExpectedDeliveryYmd } from '../utils/supplierDirectory';
import '@/features/sales/components/pos/PosCustomerSelectionModal.css';

export type PosSupplierModalMode = 'post_receipt' | 'create_order';

export type PosSupplierConfirmPayload = {
  supplierId: string;
  supplierName: string;
  deliveryNoteNumber?: string;
  supplierInvoiceNumber?: string;
  expectedDeliveryDate?: string;
};

export type PosSupplierSkipPayload = {
  expectedDeliveryDate?: string;
};

export type PosSupplierSelectionModalProps = {
  isOpen: boolean;
  mode: PosSupplierModalMode;
  busy: boolean;
  error: string | null;
  poLocked: boolean;
  lockedSupplier?: {
    id: string;
    name: string;
    snapshot?: PurchaseOrderSupplierContact;
    poNumber?: string;
  } | null;
  supplierDirectory: SupplierRecord[];
  onSupplierSaved?: (record: SupplierRecord) => void;
  resolveNewSupplier?: (draft: {
    name: string;
    gstin: string;
    email: string;
    phone?: string;
    paymentTermsLabel: string;
  }) => Promise<SupplierRecord | null>;
  onClose: () => void;
  onConfirm: (payload: PosSupplierConfirmPayload) => void;
  onSkipSupplier?: (payload: PosSupplierSkipPayload) => void;
};

function supplierContactForRecord(record: SupplierRecord): PurchaseOrderSupplierContact {
  const term = paymentLabelToValue(record.paymentTermsLabel);
  return supplierRecordToSnapshot(record, term, record.email || undefined);
}

function focusNext(e: React.KeyboardEvent, next: HTMLElement | null | undefined) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  next?.focus();
}

/** Keep keyboard Tab on new-supplier fields only (still focusable via script / Enter). */
const SKIP_TAB = -1;

export const PosSupplierSelectionModal: React.FC<PosSupplierSelectionModalProps> = ({
  isOpen,
  mode,
  busy,
  error,
  poLocked,
  lockedSupplier,
  supplierDirectory,
  onSupplierSaved,
  resolveNewSupplier,
  onClose,
  onConfirm,
  onSkipSupplier,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const deliveryNoteRef = useRef<HTMLInputElement>(null);
  const supplierInvoiceRef = useRef<HTMLInputElement>(null);
  const expectedDeliveryRef = useRef<HTMLInputElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);
  const newGstRef = useRef<HTMLInputElement>(null);
  const newPhoneRef = useRef<HTMLInputElement>(null);
  const newEmailRef = useRef<HTMLInputElement>(null);
  const newPaymentRef = useRef<HTMLSelectElement>(null);
  const useNewBtnRef = useRef<HTMLButtonElement>(null);
  const primaryBtnRef = useRef<HTMLButtonElement>(null);

  const [searchInput, setSearchInput] = useState('');
  const [activeListIndex, setActiveListIndex] = useState(-1);
  const [selected, setSelected] = useState<SupplierRecord | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [deliveryNoteNumber, setDeliveryNoteNumber] = useState('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(defaultExpectedDeliveryYmd());

  const [newName, setNewName] = useState('');
  const [newGst, setNewGst] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPayment, setNewPayment] = useState('net_30');

  const resetAll = useCallback(() => {
    setSearchInput('');
    setActiveListIndex(-1);
    setSelected(null);
    setLocalError(null);
    setDeliveryNoteNumber('');
    setSupplierInvoiceNumber('');
    setExpectedDeliveryDate(defaultExpectedDeliveryYmd());
    setNewName('');
    setNewGst('');
    setNewPhone('');
    setNewEmail('');
    setNewPayment('net_30');
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    resetAll();
    if (poLocked && lockedSupplier) {
      setSelected({
        id: lockedSupplier.id,
        name: lockedSupplier.name,
        gstin: lockedSupplier.snapshot?.gstin || '—',
        email: lockedSupplier.snapshot?.email || '',
        paymentTermsLabel: lockedSupplier.snapshot?.defaultPaymentTerms || 'Net 30',
      });
    }
  }, [isOpen, lockedSupplier, poLocked, resetAll]);

  const allSuppliers = supplierDirectory;

  const displayHits = useMemo(
    () => filterSuppliers(allSuppliers, searchInput),
    [allSuppliers, searchInput]
  );

  const showPicker = !poLocked;
  const showNewSection = showPicker && !selected;
  const isCreateOrder = mode === 'create_order';

  useEffect(() => {
    if (!isOpen || displayHits.length === 0) {
      setActiveListIndex(-1);
      return;
    }
    setActiveListIndex(0);
  }, [displayHits, isOpen, searchInput]);

  useEffect(() => {
    if (!isOpen || busy) return;
    const t = window.setTimeout(() => {
      if (poLocked && mode === 'post_receipt') {
        deliveryNoteRef.current?.focus();
        return;
      }
      if (showPicker) {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (isCreateOrder) {
        expectedDeliveryRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [busy, isCreateOrder, isOpen, mode, poLocked, showPicker]);

  useEffect(() => {
    if (activeListIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-supplier-index="${activeListIndex}"]`);
    if (el) scrollElementIntoContainer(listRef.current, el);
  }, [activeListIndex, displayHits.length]);

  const selectedContact = useMemo(() => {
    if (!selected) return null;
    if (poLocked && lockedSupplier?.snapshot) return lockedSupplier.snapshot;
    return supplierContactForRecord(selected);
  }, [lockedSupplier?.snapshot, poLocked, selected]);

  const focusAfterSupplierPick = useCallback(() => {
    window.setTimeout(() => {
      if (mode === 'post_receipt') deliveryNoteRef.current?.focus();
      else expectedDeliveryRef.current?.focus();
    }, 0);
  }, [mode]);

  const pickSupplier = useCallback(
    (s: SupplierRecord) => {
      if (poLocked) return;
      setLocalError(null);
      setSelected(s);
      focusAfterSupplierPick();
    },
    [focusAfterSupplierPick, poLocked]
  );

  const buildConfirmPayload = useCallback(
    (active: SupplierRecord | null): PosSupplierConfirmPayload | null => {
      const expectedDate =
        mode === 'create_order' ? expectedDeliveryDate.trim() || undefined : undefined;
      if (!active) return null;
      return {
        supplierId: active.id,
        supplierName: active.name,
        deliveryNoteNumber:
          mode === 'post_receipt' ? deliveryNoteNumber.trim() || undefined : undefined,
        supplierInvoiceNumber:
          mode === 'post_receipt' ? supplierInvoiceNumber.trim() || undefined : undefined,
        expectedDeliveryDate: expectedDate,
      };
    },
    [deliveryNoteNumber, expectedDeliveryDate, mode, supplierInvoiceNumber]
  );

  const buildSkipPayload = useCallback((): PosSupplierSkipPayload => {
    return {
      expectedDeliveryDate:
        mode === 'create_order' ? expectedDeliveryDate.trim() || undefined : undefined,
    };
  }, [expectedDeliveryDate, mode]);

  const buildNewSupplierDraft = useCallback(() => {
    const nm = newName.trim();
    if (!nm) return null;
    const paymentLabel =
      PAYMENT_TERM_OPTIONS.find((o) => o.value === newPayment)?.label || 'Net 30';
    return {
      name: nm,
      gstin: newGst.trim() || '—',
      email: newEmail.trim(),
      phone: newPhone.trim() || undefined,
      paymentTermsLabel: paymentLabel,
    };
  }, [newEmail, newGst, newName, newPayment, newPhone]);

  const onPrimary = useCallback(async () => {
    setLocalError(null);
    let active = selected;
    if (!active) {
      const draft = buildNewSupplierDraft();
      if (!draft) {
        setLocalError(
          mode === 'create_order'
            ? 'Select a supplier, add a new one, or skip to choose on the order page.'
            : 'Select a supplier or enter a name to add a new one.'
        );
        return;
      }
      if (resolveNewSupplier) {
        active = await resolveNewSupplier(draft);
        if (!active) {
          setLocalError('Could not save supplier. Try again.');
          return;
        }
      } else {
        onSupplierSaved?.({
          id: '',
          name: draft.name,
          gstin: draft.gstin,
          email: draft.email,
          phone: draft.phone,
          paymentTermsLabel: draft.paymentTermsLabel,
        });
        setLocalError('Select a supplier from the list after saving.');
        return;
      }
      onSupplierSaved?.(active);
    }
    const payload = buildConfirmPayload(active);
    if (!payload) {
      setLocalError('Supplier is required.');
      return;
    }
    onConfirm(payload);
  }, [
    buildConfirmPayload,
    buildNewSupplierDraft,
    mode,
    onConfirm,
    onSupplierSaved,
    resolveNewSupplier,
    selected,
  ]);

  const addNewToList = useCallback(async () => {
    const draft = buildNewSupplierDraft();
    if (!draft) {
      setLocalError('Name is required to add a supplier.');
      return;
    }
    if (!resolveNewSupplier) {
      setLocalError('Cannot add supplier right now.');
      return;
    }
    const record = await resolveNewSupplier(draft);
    if (!record) {
      setLocalError('Could not save supplier.');
      return;
    }
    onSupplierSaved?.(record);
    setSelected(record);
    setLocalError(null);
    focusAfterSupplierPick();
  }, [buildNewSupplierDraft, focusAfterSupplierPick, onSupplierSaved, resolveNewSupplier]);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (displayHits.length === 0) return;
      setActiveListIndex((i) => (i < displayHits.length - 1 ? i + 1 : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (displayHits.length === 0) return;
      setActiveListIndex((i) => (i <= 0 ? displayHits.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = displayHits[activeListIndex >= 0 ? activeListIndex : 0];
      if (pick) pickSupplier(pick);
    }
  };

  const primaryDisabled = busy || (!selected && !newName.trim());
  const primaryLabel = busy
    ? isCreateOrder
      ? 'Creating…'
      : 'Posting…'
    : isCreateOrder
      ? 'Create order'
      : 'Confirm & post receipt';

  const onSkip = useCallback(() => {
    if (!onSkipSupplier || busy) return;
    onSkipSupplier(buildSkipPayload());
  }, [buildSkipPayload, busy, onSkipSupplier]);

  useEffect(() => {
    if (!isOpen || !showNewSection || busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = [newNameRef, newGstRef, newPhoneRef, newEmailRef, newPaymentRef]
        .map((r) => r.current)
        .filter((el): el is HTMLInputElement | HTMLSelectElement => Boolean(el));
      if (els.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const idx = els.findIndex((el) => el === document.activeElement);
      if (idx < 0) {
        if (e.shiftKey) els[els.length - 1].focus();
        else els[0].focus();
        return;
      }
      const nextIdx = e.shiftKey ? (idx - 1 + els.length) % els.length : (idx + 1) % els.length;
      els[nextIdx].focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, isOpen, showNewSection]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.dataset.receiptSupplierModalOpen = '1';
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        if (isCreateOrder && onSkipSupplier && !busy) {
          e.preventDefault();
          e.stopPropagation();
          onSkip();
        }
        return;
      }
      if (mod && e.shiftKey && e.key === 'Enter') {
        if (isCreateOrder && !primaryDisabled) {
          e.preventDefault();
          e.stopPropagation();
          onPrimary();
        }
        return;
      }
      if (mod && e.key === 'Enter' && !e.shiftKey) {
        if (!primaryDisabled && !isCreateOrder) {
          e.preventDefault();
          e.stopPropagation();
          onPrimary();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      delete document.body.dataset.receiptSupplierModalOpen;
      window.removeEventListener('keydown', onKey, true);
    };
  }, [busy, isCreateOrder, isOpen, onPrimary, onSkip, onSkipSupplier, primaryDisabled]);

  const combinedError = localError || error;

  if (!isOpen) return null;

  const keyboardHint = poLocked
    ? 'Enter between fields · Ctrl+Enter confirm · Esc close'
    : isCreateOrder
      ? '↑↓ supplier · Enter select · Tab new supplier only · Ctrl+S skip · Ctrl+Shift+Enter create · Esc close'
      : '↑↓ supplier · Enter select · Tab new supplier only · Ctrl+Enter post · Esc close';

  return (
    <div className="pos-cust-modal">
      <p className="pos-cust-modal__kbd-hint">{keyboardHint}</p>
      {combinedError ? (
        <div className="pos-cust-modal__err sales-panel-error" role="alert">
          {combinedError}
        </div>
      ) : null}

      <div className="pos-cust-modal__scroll">
        {poLocked && lockedSupplier ? (
          <div className="pos-cust-modal__card pos-cust-modal__card--readonly">
            <div className="pos-cust-modal__card-head">
              <span className="pos-cust-modal__card-title">
                From purchase order {lockedSupplier.poNumber || ''}
              </span>
            </div>
            <dl className="pos-cust-modal__dl">
              <div className="pos-cust-modal__dl-full">
                <dt>Supplier</dt>
                <dd>
                  🔒 {lockedSupplier.name}
                  <span className="pos-cust-modal__muted" style={{ display: 'block', marginTop: 4 }}>
                    Supplier fixed — linked to PO
                  </span>
                </dd>
              </div>
              {selectedContact ? (
                <>
                  <div>
                    <dt>GSTIN</dt>
                    <dd>{selectedContact.gstin || '—'}</dd>
                  </div>
                  <div>
                    <dt>Payment terms</dt>
                    <dd>{selectedContact.defaultPaymentTerms || '—'}</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </div>
        ) : null}

        {showPicker ? (
          <section className="pos-cust-modal__section" aria-labelledby="pos-supplier-search-heading">
            <h3 id="pos-supplier-search-heading" className="pos-cust-modal__section-title">
              Search suppliers
            </h3>
            <Input
              ref={searchInputRef}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search by supplier name or GST number"
              disabled={busy}
              tabIndex={SKIP_TAB}
              aria-label="Search suppliers"
              aria-autocomplete="list"
              aria-controls="pos-supplier-results-list"
            />
            <div className="pos-cust-modal__results" aria-live="polite">
              {displayHits.length === 0 ? (
                <p className="pos-cust-modal__results-empty">No matching suppliers.</p>
              ) : (
                <ul
                  id="pos-supplier-results-list"
                  ref={listRef}
                  className="pos-cust-modal__list"
                  role="listbox"
                  aria-label="Supplier search results"
                >
                  {displayHits.map((s, idx) => {
                    const active = idx === activeListIndex;
                    const isSelected = selected?.id === s.id;
                    return (
                      <li key={s.id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected || active}
                          data-supplier-index={idx}
                          className={`pos-cust-modal__row${active ? ' pos-cust-modal__row--active' : ''}${isSelected ? ' pos-cust-modal__row--selected' : ''}`}
                          disabled={busy}
                          tabIndex={SKIP_TAB}
                          onMouseEnter={() => setActiveListIndex(idx)}
                          onClick={() => pickSupplier(s)}
                        >
                          <span className="pos-cust-modal__row-name">{s.name}</span>
                          <span className="pos-cust-modal__row-meta">
                            {[s.gstin !== '—' ? s.gstin : null, s.paymentTermsLabel]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        ) : null}

        {selected && selectedContact ? (
          <div className="pos-cust-modal__card pos-cust-modal__card--readonly">
            <div className="pos-cust-modal__card-head">
              <span className="pos-cust-modal__card-title">Selected supplier</span>
            </div>
            <dl className="pos-cust-modal__dl">
              <div>
                <dt>Name</dt>
                <dd>{selected.name}</dd>
              </div>
              <div>
                <dt>GSTIN</dt>
                <dd>{selectedContact.gstin || selected.gstin || '—'}</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>
                  {[selectedContact.contactPerson, selectedContact.phone].filter(Boolean).join(' · ') || '—'}
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{selectedContact.email || selected.email || '—'}</dd>
              </div>
              <div>
                <dt>Payment terms</dt>
                <dd>{selectedContact.defaultPaymentTerms || selected.paymentTermsLabel || '—'}</dd>
              </div>
              <div>
                <dt>Outstanding</dt>
                <dd>{formatInr(selectedContact.outstandingDues ?? 0)}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        {mode === 'create_order' ? (
          <section className="pos-cust-modal__section" aria-label="Expected delivery">
            <h3 className="pos-cust-modal__section-title">Expected delivery</h3>
            <Input
              ref={expectedDeliveryRef}
              label="Expected delivery date"
              type="date"
              value={expectedDeliveryDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              onKeyDown={(e) => focusNext(e, primaryBtnRef.current)}
              disabled={busy}
              tabIndex={SKIP_TAB}
            />
          </section>
        ) : null}

        {mode === 'post_receipt' ? (
          <section className="pos-cust-modal__section" aria-label="Receipt references">
            <h3 className="pos-cust-modal__section-title">Receipt references (optional)</h3>
            <div className="pos-cust-modal__row pos-cust-modal__row--2">
              <Input
                ref={deliveryNoteRef}
                label="Delivery note #"
                value={deliveryNoteNumber}
                onChange={(e) => setDeliveryNoteNumber(e.target.value)}
                onKeyDown={(e) => focusNext(e, supplierInvoiceRef.current)}
                disabled={busy}
                tabIndex={SKIP_TAB}
              />
              <Input
                ref={supplierInvoiceRef}
                label="Supplier invoice #"
                value={supplierInvoiceNumber}
                onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                onKeyDown={(e) => focusNext(e, primaryBtnRef.current)}
                disabled={busy}
                tabIndex={SKIP_TAB}
              />
            </div>
          </section>
        ) : null}

        {showNewSection ? (
          <>
            <div className="pos-cust-modal__divider" role="separator" aria-label="or add new supplier">
              <span>or add new supplier</span>
            </div>
            <section className="pos-cust-modal__section" aria-labelledby="pos-supplier-new-heading">
              <h3 id="pos-supplier-new-heading" className="pos-cust-modal__section-title">
                New supplier
              </h3>
              <div className="pos-cust-modal__row pos-cust-modal__row--3">
                <Input
                  ref={newNameRef}
                  label="Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => focusNext(e, newGstRef.current)}
                  disabled={busy}
                  required
                />
                <Input
                  ref={newGstRef}
                  label="GSTIN"
                  value={newGst}
                  onChange={(e) => setNewGst(e.target.value.toUpperCase())}
                  onKeyDown={(e) => focusNext(e, newPhoneRef.current)}
                  disabled={busy}
                />
                <Input
                  ref={newPhoneRef}
                  label="Contact phone"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  onKeyDown={(e) => focusNext(e, newEmailRef.current)}
                  disabled={busy}
                />
              </div>
              <div className="pos-cust-modal__row pos-cust-modal__row--2">
                <Input
                  ref={newEmailRef}
                  label="Email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => focusNext(e, newPaymentRef.current)}
                  disabled={busy}
                />
                <Select
                  ref={newPaymentRef}
                  label="Payment terms"
                  value={newPayment}
                  onChange={(e) => setNewPayment(e.target.value)}
                  onKeyDown={(e) => focusNext(e, useNewBtnRef.current)}
                  options={PAYMENT_TERM_OPTIONS}
                  disabled={busy}
                />
              </div>
              <div className="pos-cust-modal__edit-actions" style={{ borderTop: 'none', paddingTop: 0 }}>
                <Button
                  ref={useNewBtnRef}
                  type="button"
                  variant="secondary"
                  onClick={addNewToList}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addNewToList();
                    }
                  }}
                  disabled={busy || !newName.trim()}
                  tabIndex={SKIP_TAB}
                >
                  Use this supplier
                </Button>
              </div>
            </section>
          </>
        ) : null}
      </div>

      <footer className="pos-cust-modal__footer">
        <div className="pos-cust-modal__footer-left">
          <p className="pos-cust-modal__footer-note">
            {isCreateOrder
              ? 'Select a supplier, or skip to create a draft with supplier TBD.'
              : poLocked
                ? 'Confirm supplier and references, then post goods receipt.'
                : 'Select a supplier or add a new one, then post goods receipt.'}
          </p>
          {isCreateOrder && onSkipSupplier ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onSkip}
              disabled={busy}
              tabIndex={SKIP_TAB}
              title="Skip supplier (Ctrl+S)"
            >
              Skip supplier
            </Button>
          ) : null}
        </div>
        <div className="pos-cust-modal__footer-right">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy} tabIndex={SKIP_TAB}>
            Cancel
          </Button>
          <Button
            ref={primaryBtnRef}
            type="button"
            variant="primary"
            onClick={onPrimary}
            disabled={primaryDisabled}
            tabIndex={SKIP_TAB}
            title={isCreateOrder ? 'Create order (Ctrl+Shift+Enter)' : 'Post receipt (Ctrl+Enter)'}
          >
            {primaryLabel}
          </Button>
        </div>
      </footer>
    </div>
  );
};
