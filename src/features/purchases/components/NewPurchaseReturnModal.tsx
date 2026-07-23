/**
 * Purchase return (RTV) wizard — pick bill → items → reason → settlement → review.
 * Posts stock out of inventory and applies the chosen financial settlement.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/shared/components/modals/Modal';
import { LoadingState } from '@/shared/components/data-display/LoadingState';
import { Button, Input, Select } from '@/shared/components/ui';
import {
  purchaseService,
  type PurchaseReturn,
  type PurchaseReturnLineReason,
  type PurchaseReturnSettlementType,
  type ReturnableBill,
  type ReturnableBillLine,
} from '@/services/purchase.service';
import { formatInr } from '../utils/supplierDirectory';
import {
  RETURN_REASONS,
  SETTLEMENT_OPTIONS,
  formatReturnDate,
  settlementLabel,
} from '../utils/purchaseReturnDisplay';
import './PurchaseReturns.css';

const STEPS = ['Find bill', 'Select items', 'Reason & references', 'Settlement', 'Review & post'] as const;

export interface NewPurchaseReturnModalProps {
  open: boolean;
  onClose: () => void;
  branchId?: string | null;
  /** Pre-scope the bill picker to one supplier. */
  supplierId?: string;
  /** Skip the picker and start from this bill. */
  initialBillId?: string | null;
  onSuccess?: (ret: PurchaseReturn) => void;
}

type LineState = {
  qty: number;
  locationId: string;
};

function defaultLocationFor(line: ReturnableBillLine): string {
  return line.stockByLocation?.[0]?.locationId ?? '';
}

function onHandAt(line: ReturnableBillLine, locationId: string): number {
  return line.stockByLocation?.find((s) => s.locationId === locationId)?.onHand ?? 0;
}

export const NewPurchaseReturnModal: React.FC<NewPurchaseReturnModalProps> = ({
  open,
  onClose,
  branchId,
  supplierId,
  initialBillId,
  onSuccess,
}) => {
  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [bills, setBills] = useState<ReturnableBill[]>([]);
  const [billsLoading, setBillsLoading] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [bill, setBill] = useState<ReturnableBill | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [lineState, setLineState] = useState<Record<string, LineState>>({});
  const [reason, setReason] = useState<PurchaseReturnLineReason | null>(null);
  const [reasonNote, setReasonNote] = useState('');
  const [rmaNumber, setRmaNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [settlement, setSettlement] = useState<PurchaseReturnSettlementType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pendingAdvance = useRef(false);

  const reset = useCallback(() => {
    pendingAdvance.current = false;
    setStep(1);
    setSearchQuery('');
    setDebouncedSearch('');
    setSelectedBillId(null);
    setBill(null);
    setLineState({});
    setReason(null);
    setReasonNote('');
    setRmaNumber('');
    setNotes('');
    setSettlement(null);
    setSubmitError(null);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    reset();
    if (initialBillId?.trim()) {
      pendingAdvance.current = true;
      setSelectedBillId(initialBillId.trim());
    }
  }, [open, initialBillId, reset]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (!open || !branchId) return;
    setBillsLoading(true);
    purchaseService
      .getReturnSourceBills({ supplierId, search: debouncedSearch || undefined }, branchId)
      .then(setBills)
      .catch(() => setBills([]))
      .finally(() => setBillsLoading(false));
  }, [open, branchId, supplierId, debouncedSearch]);

  useEffect(() => {
    if (!open || !branchId || !selectedBillId) {
      setBill(null);
      return;
    }
    let cancelled = false;
    setBillLoading(true);
    setSubmitError(null);
    purchaseService
      .getReturnSourceBills({ billId: selectedBillId }, branchId)
      .then((list) => {
        if (cancelled) return;
        const b = list[0] ?? null;
        setBill(b);
        if (b) {
          const next: Record<string, LineState> = {};
          for (const l of b.lines) {
            next[l.variantId] = { qty: 0, locationId: defaultLocationFor(l) };
          }
          setLineState(next);
          if (pendingAdvance.current) {
            pendingAdvance.current = false;
            setStep(2);
          }
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setSubmitError(e instanceof Error ? e.message : 'Could not load bill');
      })
      .finally(() => {
        if (!cancelled) setBillLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, branchId, selectedBillId]);

  const setQty = useCallback((line: ReturnableBillLine, value: number) => {
    setLineState((prev) => {
      const cur = prev[line.variantId] ?? { qty: 0, locationId: defaultLocationFor(line) };
      return {
        ...prev,
        [line.variantId]: { ...cur, qty: Math.max(0, Math.min(line.returnableQty, value)) },
      };
    });
  }, []);

  const setLocation = useCallback((variantId: string, locationId: string) => {
    setLineState((prev) => ({
      ...prev,
      [variantId]: { ...(prev[variantId] ?? { qty: 0, locationId: '' }), locationId },
    }));
  }, []);

  const selectedLines = useMemo(() => {
    if (!bill) return [];
    return bill.lines
      .map((l) => ({ line: l, state: lineState[l.variantId] }))
      .filter((x) => x.state && x.state.qty > 0);
  }, [bill, lineState]);

  const totalQty = useMemo(() => selectedLines.reduce((s, x) => s + x.state.qty, 0), [selectedLines]);
  const totalAmount = useMemo(
    () => selectedLines.reduce((s, x) => s + x.state.qty * x.line.unitPrice, 0),
    [selectedLines]
  );

  const stockProblems = useMemo(
    () =>
      selectedLines
        .filter((x) => !x.state.locationId || x.state.qty > onHandAt(x.line, x.state.locationId) + 1e-9)
        .map((x) => x.line.variantName || x.line.itemName),
    [selectedLines]
  );

  const creditPreview = useMemo(() => {
    if (!bill) return { applied: 0, overflow: 0 };
    const applied = Math.min(totalAmount, bill.onCreditAmount);
    return { applied, overflow: Math.max(0, totalAmount - applied) };
  }, [bill, totalAmount]);

  const canNext = useMemo(() => {
    if (step === 1) return Boolean(selectedBillId && bill && !billLoading);
    if (step === 2) return selectedLines.length > 0 && stockProblems.length === 0;
    if (step === 3) return Boolean(reason) && (reason !== 'other' || reasonNote.trim().length > 0);
    if (step === 4) return Boolean(settlement);
    return true;
  }, [step, selectedBillId, bill, billLoading, selectedLines, stockProblems, reason, reasonNote, settlement]);

  const dirty = step > 1 || selectedLines.length > 0 || searchQuery.trim().length > 0;

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('Discard this return?')) return;
    onClose();
  }, [dirty, onClose]);

  const submit = useCallback(
    async (post: boolean) => {
      if (!branchId || !bill || !reason || !settlement || selectedLines.length === 0) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const ret = await purchaseService.createReturn(
          {
            billId: bill.billId,
            settlementType: settlement,
            rmaNumber: rmaNumber.trim() || undefined,
            notes: notes.trim() || undefined,
            post,
            lines: selectedLines.map((x) => ({
              variantId: x.line.variantId,
              quantity: x.state.qty,
              fromLocationId: x.state.locationId,
              reason,
              reasonNote: reasonNote.trim() || undefined,
            })),
          },
          branchId
        );
        onSuccess?.(ret);
        onClose();
      } catch (e: unknown) {
        setSubmitError(e instanceof Error ? e.message : 'Could not save return');
      } finally {
        setSubmitting(false);
      }
    },
    [branchId, bill, reason, reasonNote, rmaNumber, notes, settlement, selectedLines, onSuccess, onClose]
  );

  if (!branchId) return null;

  return (
    <Modal
      isOpen={open}
      onClose={requestClose}
      title="New purchase return"
      titleId="new-purchase-return-title"
      size="xl"
      className="pr-wizard-wrap"
    >
      <div className="pr-wizard">
        <nav className="pr-wizard__progress" aria-label="Return steps">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const done = step > n;
            const current = step === n;
            return (
              <button
                key={label}
                type="button"
                className={`pr-wizard__step${done ? ' pr-wizard__step--done' : ''}${current ? ' pr-wizard__step--current' : ''}`}
                disabled={!done}
                onClick={() => done && setStep(n)}
                aria-current={current ? 'step' : undefined}
              >
                <span className="pr-wizard__step-index">{done ? '✓' : n}</span>
                <span className="pr-wizard__step-label">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="pr-wizard__body">
          <div className="pr-wizard__main">
            {submitError ? <div className="pr-wizard__alert">{submitError}</div> : null}

            {step === 1 ? (
              <section aria-label="Find bill">
                <Input
                  label="Search bills (supplier, bill number, invoice)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <p className="pr-wizard__hint">
                  Only bills that still have returnable quantity are shown. Returns are always recorded against the
                  bill the goods arrived on, so stock and money stay traceable.
                </p>
                <div className="pr-wizard__cards" role="list" aria-busy={billsLoading}>
                  {billsLoading ? <LoadingState message="Loading bills…" size="md" /> : null}
                  {!billsLoading && bills.length === 0 ? (
                    <p className="pr-wizard__muted">No bills with returnable items found.</p>
                  ) : null}
                  {!billsLoading
                    ? bills.map((b) => (
                        <button
                          key={b.billId}
                          type="button"
                          role="listitem"
                          className={`pr-wizard__bill-card${selectedBillId === b.billId ? ' pr-wizard__bill-card--active' : ''}`}
                          onClick={() => {
                            pendingAdvance.current = true;
                            setSelectedBillId(b.billId);
                          }}
                        >
                          <div className="pr-wizard__bill-head">
                            <strong>{b.supplierName}</strong>
                            <span>{formatReturnDate(b.receiptDate)}</span>
                          </div>
                          <div className="pr-wizard__bill-meta">
                            <span>{b.billNumber}</span>
                            <span>{formatInr(b.totalAmount)}</span>
                          </div>
                          <div className="pr-wizard__bill-meta pr-wizard__muted">
                            <span>
                              {b.lines.length} item{b.lines.length === 1 ? '' : 's'} · {b.totalReturnableQty} returnable
                            </span>
                            <span>{b.onCreditAmount > 0 ? `${formatInr(b.onCreditAmount)} unpaid` : 'Fully paid'}</span>
                          </div>
                        </button>
                      ))
                    : null}
                </div>
                {billLoading ? <p className="pr-wizard__muted">Loading bill…</p> : null}
              </section>
            ) : null}

            {step === 2 && bill ? (
              <section aria-label="Select items">
                <h3>Select items to return</h3>
                <p className="pr-wizard__hint">
                  Max = billed quantity minus anything already returned. Stock must be on hand at the chosen location —
                  it is issued out of inventory when the return is posted.
                </p>
                <div className="pr-wizard__lines">
                  {bill.lines.map((l) => {
                    const st = lineState[l.variantId] ?? { qty: 0, locationId: defaultLocationFor(l) };
                    const noStock = !l.stockByLocation || l.stockByLocation.length === 0;
                    const disabled = l.returnableQty <= 0 || noStock;
                    const onHand = onHandAt(l, st.locationId);
                    const overStock = st.qty > onHand + 1e-9 && st.qty > 0;
                    return (
                      <div key={l.variantId} className={`pr-wizard__line${disabled ? ' pr-wizard__line--off' : ''}`}>
                        <div className="pr-wizard__line-info">
                          <strong>{l.variantName || l.itemName}</strong>
                          <span className="pr-wizard__muted">
                            Billed {l.billedQty} · Returned {l.alreadyReturnedQty} · Max {l.returnableQty} ·{' '}
                            {formatInr(l.unitPrice)}/unit
                          </span>
                          {disabled ? (
                            <span className="pr-wizard__warn">
                              {l.returnableQty <= 0 ? 'Fully returned already' : 'No stock on hand to return'}
                            </span>
                          ) : null}
                        </div>
                        <div className="pr-wizard__qty">
                          <button type="button" aria-label="Decrease" disabled={disabled || st.qty <= 0} onClick={() => setQty(l, st.qty - 1)}>
                            −
                          </button>
                          <input
                            type="number"
                            aria-label={`Return quantity for ${l.variantName || l.itemName}`}
                            min={0}
                            max={l.returnableQty}
                            value={st.qty}
                            disabled={disabled}
                            onChange={(e) => setQty(l, parseInt(e.target.value, 10) || 0)}
                          />
                          <button type="button" aria-label="Increase" disabled={disabled || st.qty >= l.returnableQty} onClick={() => setQty(l, st.qty + 1)}>
                            +
                          </button>
                          <button type="button" className="pr-wizard__max-btn" disabled={disabled} onClick={() => setQty(l, l.returnableQty)}>
                            Max
                          </button>
                        </div>
                        {!disabled ? (
                          <div className="pr-wizard__line-loc">
                            <Select
                              label="Return from"
                              value={st.locationId}
                              onChange={(e) => setLocation(l.variantId, e.target.value)}
                              options={(l.stockByLocation ?? []).map((s) => ({
                                value: s.locationId,
                                label: `${s.locationName} (${s.onHand} on hand)`,
                              }))}
                            />
                            {overStock ? (
                              <span className="pr-wizard__warn">Only {onHand} on hand at this location</span>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="pr-wizard__line-amt">{st.qty > 0 ? formatInr(st.qty * l.unitPrice) : ''}</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {step === 3 ? (
              <section aria-label="Reason and references">
                <h3>Why are these going back?</h3>
                <div className="pr-wizard__reason-grid">
                  {RETURN_REASONS.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      className={`pr-wizard__reason-card${reason === r.key ? ' pr-wizard__reason-card--on' : ''}`}
                      onClick={() => setReason(r.key)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <Input
                  label={reason === 'other' ? 'Describe the reason (required)' : 'Reason note (optional)'}
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                />
                <Input
                  label="Supplier RMA / authorization number (optional)"
                  value={rmaNumber}
                  onChange={(e) => setRmaNumber(e.target.value)}
                />
                <p className="pr-wizard__hint">
                  Many suppliers want an RMA number before accepting goods back — record it here so the shipment can be
                  matched to their approval.
                </p>
                <Input label="Internal notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </section>
            ) : null}

            {step === 4 && bill ? (
              <section aria-label="Settlement">
                <h3>How will the supplier make this good?</h3>
                <div className="pr-wizard__reason-grid">
                  {SETTLEMENT_OPTIONS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className={`pr-wizard__reason-card pr-wizard__settle-card${settlement === s.key ? ' pr-wizard__reason-card--on' : ''}`}
                      onClick={() => setSettlement(s.key)}
                    >
                      <strong>{s.label}</strong>
                      <span>{s.hint}</span>
                    </button>
                  ))}
                </div>
                {settlement === 'credit' ? (
                  <div className="pr-wizard__settle-preview">
                    Bill unpaid balance: <strong>{formatInr(bill.onCreditAmount)}</strong> · This return:{' '}
                    <strong>{formatInr(totalAmount)}</strong>
                    <br />
                    {formatInr(creditPreview.applied)} will be knocked off the bill
                    {creditPreview.overflow > 0
                      ? `; the remaining ${formatInr(creditPreview.overflow)} becomes a refund due from the supplier (the bill is already partly paid).`
                      : '.'}
                  </div>
                ) : null}
                {settlement === 'refund' ? (
                  <div className="pr-wizard__settle-preview">
                    {formatInr(totalAmount)} will be tracked as money the supplier owes you. Record it when it arrives.
                  </div>
                ) : null}
                {settlement === 'replacement' ? (
                  <div className="pr-wizard__settle-preview">
                    No money moves. When replacement goods arrive, receive them via Receipts and mark the replacement
                    received on this return.
                  </div>
                ) : null}
                {settlement === 'write_off' ? (
                  <div className="pr-wizard__settle-preview">
                    Nothing is recovered from the supplier — stock goes out and the loss stands. Use only when chasing
                    the supplier is not worth it.
                  </div>
                ) : null}
              </section>
            ) : null}

            {step === 5 && bill ? (
              <section aria-label="Review">
                <h3>Review</h3>
                <table className="pr-wizard__review">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>From</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLines.map((x) => (
                      <tr key={x.line.variantId}>
                        <td>{x.line.variantName || x.line.itemName}</td>
                        <td>{x.state.qty}</td>
                        <td>
                          {x.line.stockByLocation?.find((s) => s.locationId === x.state.locationId)?.locationName ??
                            '—'}
                        </td>
                        <td>{formatInr(x.state.qty * x.line.unitPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  Supplier <strong>{bill.supplierName}</strong> · Bill <strong>{bill.billNumber}</strong>
                </p>
                <p>
                  Total <strong>{formatInr(totalAmount)}</strong> · Settlement{' '}
                  <strong>{settlement ? settlementLabel(settlement) : '—'}</strong>
                  {reason ? (
                    <>
                      {' '}
                      · Reason <strong>{RETURN_REASONS.find((r) => r.key === reason)?.label}</strong>
                    </>
                  ) : null}
                </p>
                {rmaNumber.trim() ? (
                  <p className="pr-wizard__muted">RMA: {rmaNumber.trim()}</p>
                ) : null}
                <p className="pr-wizard__hint">
                  <strong>Post return</strong> immediately issues stock out and applies the settlement.{' '}
                  <strong>Save draft</strong> keeps it editable — nothing moves until you post it.
                </p>
              </section>
            ) : null}
          </div>

          <aside className="pr-wizard__aside" aria-label="Return summary">
            <div className="pr-wizard__card">
              <h4>Live summary</h4>
              <p>
                Bill: <strong>{bill ? bill.billNumber : '—'}</strong>
              </p>
              <p>
                Items: <strong>{selectedLines.length}</strong> · Qty <strong>{totalQty}</strong>
              </p>
              <p>
                Value: <strong>{formatInr(totalAmount)}</strong>
              </p>
              {settlement ? (
                <p>
                  Settlement: <strong>{settlementLabel(settlement)}</strong>
                </p>
              ) : null}
            </div>
            {bill ? (
              <div className="pr-wizard__card">
                <h4>Supplier</h4>
                <p>
                  <strong>{bill.supplierName}</strong>
                </p>
                <p className="pr-wizard__muted">{bill.supplierId}</p>
                <p className="pr-wizard__muted">
                  Bill unpaid: {formatInr(bill.onCreditAmount)}
                </p>
              </div>
            ) : null}
          </aside>
        </div>

        <footer className="pr-wizard__footer">
          <Button
            type="button"
            variant="secondary"
            onClick={step === 1 ? requestClose : () => setStep((s) => Math.max(1, s - 1))}
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step < 5 ? (
            <Button type="button" variant="primary" disabled={!canNext} onClick={() => canNext && setStep((s) => s + 1)}>
              Next
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" disabled={submitting} onClick={() => void submit(false)}>
                {submitting ? 'Saving…' : 'Save draft'}
              </Button>
              <Button type="button" variant="primary" disabled={submitting} onClick={() => void submit(true)}>
                {submitting ? 'Posting…' : 'Post return'}
              </Button>
            </>
          )}
        </footer>
      </div>
    </Modal>
  );
};
