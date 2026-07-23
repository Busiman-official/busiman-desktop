/**
 * POS / quotation flow: search existing customers, view/edit selection, or add new.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input } from '@/shared/components/ui';
import { Select } from '@/shared/components/ui/Select';
import {
  salesService,
  type CustomerPaymentTerms,
  type CustomerSegment,
  type SalesCustomer,
} from '@/services/sales.service';
import { INDIAN_STATES_UT } from './indianStates';
import './PosCustomerSelectionModal.css';

const DEBOUNCE_MS = 280;

type Mode = 'sale' | 'quotation';

type UICustomerKind = 'retail' | 'wholesale' | 'b2b' | 'government';

const PAYMENT_OPTIONS: { value: CustomerPaymentTerms; label: string }[] = [
  { value: 'immediate', label: 'Immediate' },
  { value: 'net15', label: 'Net 15' },
  { value: 'net30', label: 'Net 30' },
  { value: 'net45', label: 'Net 45' },
  { value: 'net60', label: 'Net 60' },
];

const KIND_OPTIONS: { value: UICustomerKind; label: string }[] = [
  { value: 'retail', label: 'Retail' },
  { value: 'wholesale', label: 'Wholesale' },
  { value: 'b2b', label: 'B2B' },
  { value: 'government', label: 'Government' },
];

function segmentToKind(s: CustomerSegment): UICustomerKind {
  if (s === 'wholesale') return 'wholesale';
  if (s === 'corporate') return 'b2b';
  if (s === 'government') return 'government';
  return 'retail';
}

function kindToSegment(k: UICustomerKind): CustomerSegment {
  if (k === 'wholesale') return 'wholesale';
  if (k === 'b2b') return 'corporate';
  if (k === 'government') return 'government';
  return 'regular';
}

function kindLabel(s: CustomerSegment): string {
  const m: Record<string, string> = {
    regular: 'Retail',
    vip: 'VIP',
    corporate: 'B2B',
    wholesale: 'Wholesale',
    government: 'Government',
  };
  return m[s] || s;
}

function paymentLabel(p?: CustomerPaymentTerms | string): string {
  const row = PAYMENT_OPTIONS.find((x) => x.value === p);
  return row?.label || (p ? String(p) : '—');
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Partial / full phone match for search + auto-select (min 4 digits in query). */
function phoneQueryMatchesStored(stored: string | undefined, queryDigits: string): boolean {
  if (!queryDigits || queryDigits.length < 4) return false;
  const pd = digitsOnly(stored || '');
  if (!pd) return false;
  const qd = queryDigits;
  if (pd === qd) return true;
  if (pd.endsWith(qd) || qd.endsWith(pd)) return true;
  const tail10 = (x: string) => x.slice(-10);
  if (qd.length >= 10 && tail10(pd) === tail10(qd)) return true;
  return false;
}

export type PosNewCustomerPayload = {
  name: string;
  phone: string;
  email?: string;
  gstNumber?: string;
  segment: CustomerSegment;
  stateUt?: string;
  paymentTerms?: CustomerPaymentTerms;
  billingAddress?: string;
  shippingAddress?: string;
};

type EditDraft = {
  name: string;
  email: string;
  phone: string;
  gstNumber: string;
  kind: UICustomerKind;
  stateUt: string;
  paymentTerms: CustomerPaymentTerms;
  billingAddress: string;
  shippingAddress: string;
};

function customerToEditDraft(c: SalesCustomer): EditDraft {
  return {
    name: c.name || '',
    email: c.email || '',
    phone: c.phone || '',
    gstNumber: c.gstNumber || '',
    kind: segmentToKind(c.segment),
    stateUt: c.stateUt || '',
    paymentTerms: c.paymentTerms || 'immediate',
    billingAddress: c.billingAddress || c.address || '',
    shippingAddress: c.shippingAddress || '',
  };
}

export type PosCustomerSelectionModalProps = {
  isOpen: boolean;
  mode: Mode;
  branchId: string;
  busy: boolean;
  error: string | null;
  counterCustomerId: string | null;
  counterCustomerName: string | null;
  onClose: () => void;
  onConfirmExisting: (customerId: string) => void;
  onConfirmNew: (payload: PosNewCustomerPayload) => void;
  onWalkIn: () => void;
  onUseCounterCustomer: (customerId: string) => void;
  /** Disable walk-in when on-account amount is set (requires a registered customer). */
  walkInDisabled?: boolean;
};

export const PosCustomerSelectionModal: React.FC<PosCustomerSelectionModalProps> = ({
  isOpen,
  mode,
  branchId,
  busy,
  error,
  counterCustomerId,
  counterCustomerName,
  onClose,
  onConfirmExisting,
  onConfirmNew,
  onWalkIn,
  onUseCounterCustomer,
  walkInDisabled = false,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [hits, setHits] = useState<SalesCustomer[]>([]);
  const [hitsLoading, setHitsLoading] = useState(false);
  const [selected, setSelected] = useState<SalesCustomer | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newGst, setNewGst] = useState('');
  const [newKind, setNewKind] = useState<UICustomerKind>('retail');
  const [newStateUt, setNewStateUt] = useState('');
  const [newPayment, setNewPayment] = useState<CustomerPaymentTerms>('immediate');
  const [newBilling, setNewBilling] = useState('');
  const [newShipping, setNewShipping] = useState('');
  const [sameAsBilling, setSameAsBilling] = useState(true);

  /** Avoid duplicate auto-select (e.g. Strict Mode) for the same phone + customer id. */
  const lastAutoSelectKeyRef = useRef<string | null>(null);

  const resetAll = useCallback(() => {
    setSearchInput('');
    setDebouncedSearch('');
    setHits([]);
    setHitsLoading(false);
    setSelected(null);
    setDetailLoading(false);
    setEditing(false);
    setEditDraft(null);
    setSavingEdit(false);
    setLocalError(null);
    setNewName('');
    setNewPhone('');
    setNewEmail('');
    setNewGst('');
    setNewKind('retail');
    setNewStateUt('');
    setNewPayment('immediate');
    setNewBilling('');
    setNewShipping('');
    setSameAsBilling(true);
    lastAutoSelectKeyRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    resetAll();
  }, [isOpen, resetAll]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput, isOpen]);

  useEffect(() => {
    if (!isOpen || !branchId) return;
    let cancelled = false;
    setHitsLoading(true);
    salesService
      .listCustomers(branchId, {
        q: debouncedSearch || undefined,
        pageSize: 25,
        page: 1,
        status: 'all',
      })
      .then((r) => {
        if (!cancelled) setHits(r.rows || []);
      })
      .catch(() => {
        if (!cancelled) setHits([]);
      })
      .finally(() => {
        if (!cancelled) setHitsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, branchId, debouncedSearch]);

  useEffect(() => {
    if (sameAsBilling) setNewShipping(newBilling);
  }, [sameAsBilling, newBilling]);

  const replaceHit = useCallback((updated: SalesCustomer) => {
    setHits((prev) => prev.map((h) => (h._id === updated._id ? { ...h, ...updated } : h)));
  }, []);

  const selectCustomer = useCallback(
    (c: SalesCustomer) => {
      if (selected?._id === c._id && !editing) {
        setSelected(null);
        setEditDraft(null);
        return;
      }
      setLocalError(null);
      setSelected(c);
      setEditing(false);
      setEditDraft(null);
      setDetailLoading(true);
      salesService
        .getCustomer(c._id, branchId)
        .then((full) => {
          setSelected(full);
          replaceHit(full);
        })
        .catch(() => {
          setLocalError('Could not load customer details.');
        })
        .finally(() => setDetailLoading(false));
    },
    [branchId, editing, replaceHit, selected?._id]
  );

  const displayHits = useMemo(() => {
    const qd = digitsOnly(newPhone);
    if (qd.length < 4) return hits;
    const narrowed = hits.filter((c) => phoneQueryMatchesStored(c.phone, qd));
    return narrowed.length ? narrowed : hits;
  }, [hits, newPhone]);

  /** Typing mobile filters the list; when exactly one customer matches the digits, select them. */
  useEffect(() => {
    if (!isOpen || selected || editing || hitsLoading) return;
    const qd = digitsOnly(newPhone);
    if (qd.length < 4) return;
    const matches = displayHits.filter((c) => phoneQueryMatchesStored(c.phone, qd));
    if (matches.length !== 1) return;
    const hit = matches[0];
    const key = `${hit._id}:${qd}`;
    if (lastAutoSelectKeyRef.current === key) return;
    lastAutoSelectKeyRef.current = key;
    selectCustomer(hit);
  }, [isOpen, displayHits, hitsLoading, newPhone, selected, editing, selectCustomer]);

  useEffect(() => {
    if (!selected) lastAutoSelectKeyRef.current = null;
  }, [selected]);

  const startEdit = useCallback(() => {
    if (!selected) return;
    setEditDraft(customerToEditDraft(selected));
    setEditing(true);
    setLocalError(null);
  }, [selected]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditDraft(null);
    setLocalError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!selected || !editDraft) return;
    const nm = editDraft.name.trim();
    const ph = editDraft.phone.trim();
    if (!nm) {
      setLocalError('Name is required.');
      return;
    }
    if (!ph) {
      setLocalError('Phone is required.');
      return;
    }
    setSavingEdit(true);
    setLocalError(null);
    try {
      const updated = await salesService.patchCustomer(
        selected._id,
        {
          name: nm,
          email: editDraft.email.trim() || undefined,
          phone: ph,
          gstNumber: editDraft.gstNumber.trim() || undefined,
          segment: kindToSegment(editDraft.kind),
          stateUt: editDraft.stateUt.trim() || undefined,
          paymentTerms: editDraft.paymentTerms,
          billingAddress: editDraft.billingAddress.trim() || undefined,
          shippingAddress: editDraft.shippingAddress.trim() || undefined,
        },
        branchId
      );
      setSelected(updated);
      replaceHit(updated);
      setEditing(false);
      setEditDraft(null);
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : 'Could not save customer.');
    } finally {
      setSavingEdit(false);
    }
  }, [branchId, editDraft, replaceHit, selected]);

  const footerPrimaryDisabled = useMemo(
    () => busy || savingEdit || editing || detailLoading,
    [busy, savingEdit, editing, detailLoading]
  );

  const onPrimary = useCallback(() => {
    setLocalError(null);
    if (selected) {
      onConfirmExisting(selected._id);
      return;
    }
    const nm = newName.trim();
    const ph = newPhone.trim();
    if (!ph) {
      setLocalError('Mobile number is required.');
      return;
    }
    onConfirmNew({
      name: nm || 'Customer',
      phone: ph,
      email: newEmail.trim() || undefined,
      gstNumber: newGst.trim() || undefined,
      segment: kindToSegment(newKind),
      stateUt: newStateUt.trim() || undefined,
      paymentTerms: newPayment,
      billingAddress: newBilling.trim() || undefined,
      shippingAddress: (sameAsBilling ? newBilling : newShipping).trim() || undefined,
    });
  }, [
    newBilling,
    newEmail,
    newGst,
    newKind,
    newName,
    newPayment,
    newPhone,
    newShipping,
    newStateUt,
    onConfirmExisting,
    onConfirmNew,
    sameAsBilling,
    selected,
  ]);

  const showNewSection = !selected;
  const combinedError = localError || error;

  if (!isOpen) return null;

  return (
    <div className="pos-cust-modal">
      {combinedError ? (
        <div className="pos-cust-modal__err sales-panel-error" role="alert">
          {combinedError}
        </div>
      ) : null}

      <div className="pos-cust-modal__scroll">
        {counterCustomerId && counterCustomerName ? (
          <div className="pos-cust-modal__quick">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onUseCounterCustomer(counterCustomerId)}
              disabled={busy || savingEdit}
            >
              Use counter: {counterCustomerName}
            </Button>
          </div>
        ) : null}

        <section className="pos-cust-modal__section" aria-labelledby="pos-cust-search-heading">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, phone, or customer code"
            disabled={busy || savingEdit}
            aria-label="Search customers"
          />
          <div className="pos-cust-modal__results" aria-live="polite">
            {hitsLoading ? (
              <p className="pos-cust-modal__results-empty">Searching…</p>
            ) : displayHits.length === 0 ? (
              <p className="pos-cust-modal__results-empty">No matching customers.</p>
            ) : (
              <ul className="pos-cust-modal__list" aria-label="Customer search results">
                {displayHits.map((c) => (
                  <li key={c._id}>
                    <button
                      type="button"
                      className={
                        selected?._id === c._id
                          ? 'pos-cust-modal__row pos-cust-modal__row--selected'
                          : 'pos-cust-modal__row'
                      }
                      disabled={busy || savingEdit}
                      onClick={() => selectCustomer(c)}
                    >
                      <span className="pos-cust-modal__row-name">{c.name}</span>
                      <span className="pos-cust-modal__row-meta">
                        {[c.phone, c.customerCode].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {selected && !editing ? (
          <div className="pos-cust-modal__card pos-cust-modal__card--readonly">
            <div className="pos-cust-modal__card-head">
              <span className="pos-cust-modal__card-title">Selected customer</span>
              <Button type="button" variant="secondary" size="sm" onClick={startEdit} disabled={busy || savingEdit}>
                Edit details
              </Button>
            </div>
            {detailLoading ? (
              <p className="pos-cust-modal__muted">Loading details…</p>
            ) : (
              <dl className="pos-cust-modal__dl">
                <div>
                  <dt>Name</dt>
                  <dd>{selected.name}</dd>
                </div>
                <div>
                  <dt>Customer code</dt>
                  <dd>{selected.customerCode}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{selected.phone || '—'}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{selected.email || '—'}</dd>
                </div>
                <div>
                  <dt>GSTIN</dt>
                  <dd>{selected.gstNumber || '—'}</dd>
                </div>
                <div>
                  <dt>Customer type</dt>
                  <dd>{kindLabel(selected.segment)}</dd>
                </div>
                <div>
                  <dt>State / UT</dt>
                  <dd>{selected.stateUt || '—'}</dd>
                </div>
                <div>
                  <dt>Payment terms</dt>
                  <dd>{paymentLabel(selected.paymentTerms)}</dd>
                </div>
                <div className="pos-cust-modal__dl-full">
                  <dt>Billing address</dt>
                  <dd>{selected.billingAddress || selected.address || '—'}</dd>
                </div>
                <div className="pos-cust-modal__dl-full">
                  <dt>Shipping address</dt>
                  <dd>{selected.shippingAddress || '—'}</dd>
                </div>
              </dl>
            )}
          </div>
        ) : null}

        {selected && editing && editDraft ? (
          <div className="pos-cust-modal__card pos-cust-modal__card--editing">
            <div className="pos-cust-modal__card-head">
              <span className="pos-cust-modal__card-title">Editing customer</span>
            </div>
            <div className="pos-cust-modal__row pos-cust-modal__row--3">
              <Input
                label="Name"
                value={editDraft.name}
                onChange={(e) => setEditDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                disabled={savingEdit}
              />
              <Input
                label="Phone"
                value={editDraft.phone}
                onChange={(e) => setEditDraft((d) => (d ? { ...d, phone: e.target.value } : d))}
                disabled={savingEdit}
              />
              <Input
                label="Email"
                value={editDraft.email}
                onChange={(e) => setEditDraft((d) => (d ? { ...d, email: e.target.value } : d))}
                disabled={savingEdit}
              />
            </div>
            <div className="pos-cust-modal__row pos-cust-modal__row--4">
              <Input
                label="GSTIN"
                value={editDraft.gstNumber}
                onChange={(e) =>
                  setEditDraft((d) => (d ? { ...d, gstNumber: e.target.value.toUpperCase() } : d))
                }
                disabled={savingEdit}
              />
              <Select
                label="Customer type"
                value={editDraft.kind}
                onChange={(e) =>
                  setEditDraft((d) => (d ? { ...d, kind: e.target.value as UICustomerKind } : d))
                }
                options={KIND_OPTIONS}
                disabled={savingEdit}
              />
              <Select
                label="State / UT"
                value={editDraft.stateUt}
                onChange={(e) => setEditDraft((d) => (d ? { ...d, stateUt: e.target.value } : d))}
                options={[{ value: '', label: 'Select…' }, ...INDIAN_STATES_UT]}
                disabled={savingEdit}
              />
              <Select
                label="Payment terms"
                value={editDraft.paymentTerms}
                onChange={(e) =>
                  setEditDraft((d) =>
                    d ? { ...d, paymentTerms: e.target.value as CustomerPaymentTerms } : d
                  )
                }
                options={PAYMENT_OPTIONS}
                disabled={savingEdit}
              />
            </div>
            <div className="pos-cust-modal__row pos-cust-modal__row--2">
              <div>
                <label className="pos-cust-modal__area-label">Billing address</label>
                <textarea
                  className="pos-cust-modal__textarea"
                  rows={3}
                  value={editDraft.billingAddress}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, billingAddress: e.target.value } : d))}
                  disabled={savingEdit}
                />
              </div>
              <div>
                <label className="pos-cust-modal__area-label">Shipping address</label>
                <textarea
                  className="pos-cust-modal__textarea"
                  rows={3}
                  value={editDraft.shippingAddress}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, shippingAddress: e.target.value } : d))}
                  disabled={savingEdit}
                />
              </div>
            </div>
            <div className="pos-cust-modal__edit-actions">
              <Button type="button" variant="secondary" onClick={cancelEdit} disabled={savingEdit}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={() => void saveEdit()} disabled={savingEdit}>
                {savingEdit ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        ) : null}

        {showNewSection && !editing ? (
          <>
            <div className="pos-cust-modal__divider" role="separator" aria-label="or add new customer">
              <span>or add new customer</span>
            </div>
            <section className="pos-cust-modal__section" aria-labelledby="pos-cust-new-heading">
              <div className="pos-cust-modal__row pos-cust-modal__row--3">
                <Input
                  label="Name (optional)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={busy}
                  placeholder="Defaults to Customer if empty"
                />
                <Input
                  label="Mobile number"
                  value={newPhone}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewPhone(v);
                    setSearchInput(v);
                  }}
                  disabled={busy}
                  required
                />
                <Input label="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} disabled={busy} />
              </div>
              <div className="pos-cust-modal__row pos-cust-modal__row--4">
                <Input
                  label="GSTIN"
                  value={newGst}
                  onChange={(e) => setNewGst(e.target.value.toUpperCase())}
                  disabled={busy}
                />
                <Select
                  label="Customer type"
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as UICustomerKind)}
                  options={KIND_OPTIONS}
                  disabled={busy}
                />
                <Select
                  label="State / UT"
                  value={newStateUt}
                  onChange={(e) => setNewStateUt(e.target.value)}
                  options={[{ value: '', label: 'Select…' }, ...INDIAN_STATES_UT]}
                  disabled={busy}
                />
                <Select
                  label="Payment terms"
                  value={newPayment}
                  onChange={(e) => setNewPayment(e.target.value as CustomerPaymentTerms)}
                  options={PAYMENT_OPTIONS}
                  disabled={busy}
                />
              </div>
              <div className="pos-cust-modal__row pos-cust-modal__row--2">
                <div>
                  <label className="pos-cust-modal__area-label">Billing address</label>
                  <textarea
                    className="pos-cust-modal__textarea"
                    rows={3}
                    value={newBilling}
                    onChange={(e) => setNewBilling(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="pos-cust-modal__area-label">Shipping address</label>
                  <textarea
                    className="pos-cust-modal__textarea"
                    rows={3}
                    value={sameAsBilling ? newBilling : newShipping}
                    onChange={(e) => setNewShipping(e.target.value)}
                    disabled={busy || sameAsBilling}
                  />
                  <label className="pos-cust-modal__checkbox">
                    <input
                      type="checkbox"
                      checked={sameAsBilling}
                      onChange={(e) => setSameAsBilling(e.target.checked)}
                      disabled={busy}
                    />
                    Same as billing
                  </label>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>

      <footer className="pos-cust-modal__footer">
        <div className="pos-cust-modal__footer-left">
          {mode === 'sale' ? (
            <>
              <p className="pos-cust-modal__footer-note">
                {walkInDisabled
                  ? 'On-account amount requires a registered customer.'
                  : 'Select a customer, add a new one, or complete as walk-in.'}
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={onWalkIn}
                disabled={busy || savingEdit || editing || walkInDisabled}
                title={
                  walkInDisabled
                    ? 'Clear on-account amount to complete as walk-in'
                    : 'Complete sale without linking a customer'
                }
              >
                Walk-in customer
              </Button>
            </>
          ) : (
            <p className="pos-cust-modal__footer-note">Select the customer.</p>
          )}
        </div>
        <div className="pos-cust-modal__footer-right">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy && !savingEdit}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onPrimary}
            disabled={footerPrimaryDisabled}
          >
            {mode === 'quotation' ? 'Save & continue' : 'Save customer & charge'}
          </Button>
        </div>
      </footer>
    </div>
  );
};
