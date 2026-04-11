/**
 * Branch-aware sales return wizard (client payload → createReturn).
 * Labels grouped for future i18n extraction.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/shared/components/modals/Modal';
import { LoadingState } from '@/shared/components/data-display/LoadingState';
import { Button, Input, Select } from '@/shared/components/ui';
import { inventoryService, type Location } from '@/services/inventory.service';
import { salesService, type CustomerDetailPayload } from '@/services/sales.service';
import { entityId } from '../../utils/ids';
import { SalesLineMeta } from '../shared/SalesLineMeta';
import './NewReturnModal.css';

const L = {
  title: 'New return',
  steps: [
    'Find order',
    'Select items',
    'Reason & location',
    'Refund method',
    'Review & submit',
  ],
  searchPlaceholder: 'Filter orders (optional, min 2 characters)',
  searchHint:
    'Recent orders load automatically (newest first). Type 2+ characters to search by order #, customer, product, serials, notes, or amounts.',
  receiveHelp: 'This is where inventory is received in the system, not the customer address.',
  paymentUnknown: 'Original payment method is not stored on this order.',
  policyFallback: 'Return window defaults to 30 days from order date when variant policy is unavailable.',
  serialReturner: 'Frequent returner',
} as const;

type ReasonKey = 'changed_mind' | 'defective' | 'transit_damage' | 'not_described' | 'size_fit' | 'other';
type ItemCondition = 'sellable' | 'damaged' | 'unsellable';
type RefundMethod = 'cash' | 'store_credit' | 'bank_transfer' | 'exchange_only';

const REASONS: { key: ReasonKey; label: string }[] = [
  { key: 'changed_mind', label: 'Customer changed mind' },
  { key: 'defective', label: 'Defective / wrong item' },
  { key: 'transit_damage', label: 'Damaged in transit' },
  { key: 'not_described', label: 'Not as described' },
  { key: 'size_fit', label: 'Size / fit' },
  { key: 'other', label: 'Other' },
];

const REFUND_OPTS: { key: RefundMethod; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'store_credit', label: 'Store credit' },
  { key: 'bank_transfer', label: 'Bank transfer' },
  { key: 'exchange_only', label: 'Exchange only' },
];

export type NewReturnSuccessPayload = {
  returnId: string;
  originalOrderId: string;
  returnNumber?: string;
};

export interface NewReturnModalProps {
  open: boolean;
  onClose: () => void;
  branchId: string;
  onSuccess?: (payload: NewReturnSuccessPayload) => void;
  initialOrderId?: string;
  defaultLocationId?: string;
  /** Prior returns for this branch (used for per-line already-returned qty). */
  returnsList?: Array<Record<string, unknown> & { originalOrderId?: unknown; lines?: unknown }>;
}

type OrderLine = {
  _id?: unknown;
  quantity?: number;
  fulfilledQty?: number;
  variantName?: string;
  variantCode?: string;
  variantId?: unknown;
  itemId?: unknown;
  lineTotal?: number;
  unitPrice?: number;
  /** When persisted on lines (or future POS capture) */
  serialNumber?: string;
  serialNumbers?: string[];
  batchNumber?: string;
  sku?: string;
  barcode?: string;
  posHsn?: string;
  posLineNotes?: string;
  posGstRatePercent?: number;
  posLineDiscountAmount?: number;
  posListUnitPrice?: number;
};

type OrderDoc = {
  _id?: string;
  orderNumber?: string;
  status?: string;
  mode?: string;
  total?: number;
  customerId?: unknown;
  lines?: OrderLine[];
  createdAt?: string;
};

function returnLineCap(
  ln: { quantity?: number; fulfilledQty?: number },
  mode: string | undefined,
  status: string | undefined
): number {
  const fulfilled = Number(ln.fulfilledQty ?? 0);
  const ordered = Number(ln.quantity ?? 0);
  if (fulfilled > 0) return fulfilled;
  if (mode === 'pos' && status && ['confirmed', 'completed'].includes(status)) return ordered;
  return 0;
}

function formatInr(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseOrderTs(v: unknown): number {
  if (!v) return 0;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : 0;
}

function idStr(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && '_id' in (v as object)) return String((v as { _id?: unknown })._id);
  return String(v);
}

function returnedByLineIndex(
  order: OrderDoc,
  returns: Array<Record<string, unknown> & { originalOrderId?: unknown; lines?: unknown }>,
  orderIdStr: string
): Record<number, number> {
  const out: Record<number, number> = {};
  const lineIdToIdx = new Map<string, number>();
  (order.lines || []).forEach((ln, i) => {
    const lid = idStr((ln as { _id?: unknown })._id);
    if (lid) lineIdToIdx.set(lid, i);
  });
  for (const ret of returns) {
    if (String(ret.originalOrderId) !== orderIdStr) continue;
    const rlines = ret.lines;
    if (!Array.isArray(rlines)) continue;
    for (const rl of rlines as Array<{ originalOrderLineId?: unknown; quantity?: number }>) {
      const lid = idStr(rl.originalOrderLineId);
      const idx = lineIdToIdx.get(lid);
      if (idx === undefined) continue;
      out[idx] = (out[idx] || 0) + Number(rl.quantity ?? 0);
    }
  }
  return out;
}

/** Lowercased blob for client-side matching against listOrders payload */
function buildOrderSearchHaystack(o: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (...xs: unknown[]) => {
    for (const x of xs) {
      if (x == null || x === '') continue;
      if (typeof x === 'object' && !Array.isArray(x)) continue;
      parts.push(String(x));
    }
  };

  push(o.orderNumber, o._id, o.status, o.mode, o.notes);
  push(o.total, o.subtotal, o.taxAmount, o.discountAmount);
  push(o.paymentPending);
  if (o.createdAt) push(new Date(String(o.createdAt)).toISOString());
  if (o.updatedAt) push(new Date(String(o.updatedAt)).toISOString());

  const cust = o.customerId;
  if (cust && typeof cust === 'object') {
    const c = cust as Record<string, unknown>;
    push(c.name, c.phone, c.email, c.customerCode);
  }
  push(o.customerName);

  const lines = o.lines;
  if (Array.isArray(lines)) {
    for (const raw of lines) {
      if (!raw || typeof raw !== 'object') continue;
      const ln = raw as Record<string, unknown>;
      push(ln.variantName, ln.variantCode, ln.quantity, ln.unitPrice, ln.lineTotal, ln.fulfilledQty);
      const knownExtra = [
        'serialNumber',
        'serialNumbers',
        'serials',
        'batchNumber',
        'batchCode',
        'sku',
        'barcode',
        'lineNotes',
        'notes',
      ];
      for (const k of knownExtra) {
        const v = ln[k];
        if (v == null) continue;
        if (Array.isArray(v)) {
          for (const item of v) push(item);
        } else {
          push(v);
        }
      }
      for (const [k, v] of Object.entries(ln)) {
        if (['_id', 'variantId', 'itemId'].includes(k)) {
          push(v);
          continue;
        }
        if (knownExtra.includes(k)) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          push(v);
        }
      }
    }
  }

  return parts.join(' ').toLowerCase();
}

function getCustomerLabel(o: Record<string, unknown>): { name: string; phone: string; email: string } {
  const empty = { name: '', phone: '', email: '' };
  const cust = o.customerId;
  if (cust && typeof cust === 'object') {
    const c = cust as { name?: string; phone?: string; email?: string };
    return {
      name: c.name ? String(c.name) : '',
      phone: c.phone ? String(c.phone) : '',
      email: c.email ? String(c.email) : '',
    };
  }
  if (o.customerName) return { ...empty, name: String(o.customerName) };
  return empty;
}

function daysLeftInWindow(orderDate: string | undefined, policyDays?: number): number | null {
  if (!orderDate) return null;
  const days = policyDays ?? 30;
  const start = new Date(orderDate);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return Math.ceil((end.getTime() - Date.now()) / 864e5);
}

function filterRecvLocations(locations: Location[], condition: ItemCondition): Location[] {
  return locations.filter((l) => {
    if (l.allowReceiving === false) return false;
    if (condition === 'sellable' && l.allowStock === false) return false;
    return true;
  });
}

function suggestLocationId(locations: Location[], condition: ItemCondition): string {
  const list = filterRecvLocations(locations, condition);
  if (list.length === 0) return '';
  if (condition !== 'sellable') {
    const q = list.find((l) => /quarantine|damaged|qc|hold|repair/i.test(l.name || ''));
    if (q) return q.id;
  }
  return list[0].id;
}

export const NewReturnModal: React.FC<NewReturnModalProps> = ({
  open,
  onClose,
  branchId,
  onSuccess,
  initialOrderId,
  defaultLocationId,
  returnsList = [],
}) => {
  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [orderPool, setOrderPool] = useState<Record<string, unknown>[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDoc | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [lineQty, setLineQty] = useState<Record<number, number>>({});
  const [lineLocOverride, setLineLocOverride] = useState<Record<number, string>>({});
  const [defaultRecvLoc, setDefaultRecvLoc] = useState('');
  const [showPerLineLoc, setShowPerLineLoc] = useState(false);
  const [reasonKey, setReasonKey] = useState<ReasonKey | null>(null);
  const [reasonOther, setReasonOther] = useState('');
  const [itemCondition, setItemCondition] = useState<ItemCondition>('sellable');
  const [refundMethod, setRefundMethod] = useState<RefundMethod | null>(null);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetailPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingInitialAdvance = useRef(false);
  /** True after user picks an order card; cleared after auto-advance to step 2 or when returning to step 1 */
  const pendingSelectAdvance = useRef(false);

  const reset = useCallback(() => {
    pendingSelectAdvance.current = false;
    setStep(1);
    setSearchQuery('');
    setSelectedOrderId(null);
    setOrderDetail(null);
    setOrderError(null);
    setLineQty({});
    setLineLocOverride({});
    setReasonKey(null);
    setReasonOther('');
    setItemCondition('sellable');
    setRefundMethod(null);
    setCustomerDetail(null);
    setSubmitError(null);
    setShowPerLineLoc(false);
    setDebouncedSearch('');
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    reset();
    if (initialOrderId?.trim()) {
      setSelectedOrderId(initialOrderId.trim());
    }
  }, [open, initialOrderId, reset]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (!open) {
      pendingInitialAdvance.current = false;
      return;
    }
    pendingInitialAdvance.current = Boolean(initialOrderId?.trim());
  }, [open, initialOrderId]);

  useEffect(() => {
    if (!pendingInitialAdvance.current || !orderDetail || step !== 1) return;
    pendingInitialAdvance.current = false;
    pendingSelectAdvance.current = false;
    setStep(2);
  }, [orderDetail, step]);

  useEffect(() => {
    if (!pendingSelectAdvance.current || step !== 1) return;
    if (orderError) {
      pendingSelectAdvance.current = false;
      return;
    }
    if (orderLoading || !orderDetail || !selectedOrderId) return;
    const oid = idStr((orderDetail as { _id?: unknown })._id);
    if (!oid || oid !== selectedOrderId) return;
    pendingSelectAdvance.current = false;
    setStep(2);
  }, [orderDetail, orderLoading, orderError, selectedOrderId, step]);

  useEffect(() => {
    if (!open || !branchId) return;
    setSearchLoading(true);
    setOrderPool([]);
    salesService
      .listOrders(branchId, 'completed')
      .then((rows) => setOrderPool(Array.isArray(rows) ? rows : []))
      .catch(() => setOrderPool([]))
      .finally(() => setSearchLoading(false));
  }, [open, branchId]);

  useEffect(() => {
    if (!open || !branchId) return;
    inventoryService.getAllLocations({ isActive: true }).then(setLocations).catch(() => { });
  }, [open, branchId]);

  useEffect(() => {
    if (!open || !selectedOrderId || !branchId) {
      if (!selectedOrderId) setOrderDetail(null);
      return;
    }
    setOrderLoading(true);
    setOrderError(null);
    salesService
      .getOrder(selectedOrderId, branchId)
      .then((o) => {
        const ord = o as OrderDoc;
        setOrderDetail(ord);
        const next: Record<number, number> = {};
        ord.lines?.forEach((_, i) => {
          next[i] = 0;
        });
        setLineQty(next);
        setLineLocOverride({});
        const cust = idStr(ord.customerId);
        if (cust) {
          salesService.customerDetail(cust, branchId).then(setCustomerDetail).catch(() => setCustomerDetail(null));
        } else setCustomerDetail(null);
      })
      .catch((e: unknown) => {
        setOrderError(e instanceof Error ? e.message : 'Failed to load order');
        setOrderDetail(null);
      })
      .finally(() => setOrderLoading(false));
  }, [open, selectedOrderId, branchId]);

  useEffect(() => {
    if (!open || !locations.length) return;
    const sug = defaultLocationId && locations.some((l) => l.id === defaultLocationId)
      ? defaultLocationId
      : suggestLocationId(locations, itemCondition);
    setDefaultRecvLoc(sug);
  }, [open, locations, itemCondition, defaultLocationId]);

  const returnedByLine = useMemo(() => {
    if (!orderDetail || !selectedOrderId) return {};
    return returnedByLineIndex(orderDetail, returnsList, selectedOrderId);
  }, [orderDetail, selectedOrderId, returnsList]);

  const maxByLine = useMemo(() => {
    const m: Record<number, number> = {};
    if (!orderDetail?.lines) return m;
    orderDetail.lines.forEach((ln, idx) => {
      const cap = returnLineCap(ln, orderDetail.mode, orderDetail.status);
      const already = returnedByLine[idx] ?? 0;
      m[idx] = Math.max(0, cap - already);
    });
    return m;
  }, [orderDetail, returnedByLine]);

  const orderSearchHaystackById = useMemo(() => {
    const m = new Map<string, string>();
    for (const raw of orderPool) {
      const id = String((raw as { _id?: unknown })._id ?? '');
      if (id) m.set(id, buildOrderSearchHaystack(raw as Record<string, unknown>));
    }
    return m;
  }, [orderPool]);

  const isSearchActive = debouncedSearch.trim().length >= 2;

  const displayOrders = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (q.length >= 2) {
      return orderPool.filter((raw) => {
        const id = String((raw as { _id?: unknown })._id ?? '');
        return id && (orderSearchHaystackById.get(id) ?? '').includes(q);
      });
    }
    const sorted = [...orderPool].sort(
      (a, b) => parseOrderTs((b as { createdAt?: unknown }).createdAt) - parseOrderTs((a as { createdAt?: unknown }).createdAt)
    );
    return sorted.slice(0, 100);
  }, [orderPool, debouncedSearch, orderSearchHaystackById]);

  const refundTotal = useMemo(() => {
    if (!orderDetail?.lines) return 0;
    let t = 0;
    orderDetail.lines.forEach((ln, idx) => {
      const q = lineQty[idx] ?? 0;
      const ordQ = Number(ln.quantity ?? 0);
      const lt = Number(ln.lineTotal ?? 0);
      if (q <= 0 || ordQ <= 0) return;
      t += (lt * q) / ordQ;
    });
    return t;
  }, [orderDetail, lineQty]);

  const locOptions = useMemo(
    () => filterRecvLocations(locations, itemCondition).map((l) => ({ value: l.id, label: l.name || l.id })),
    [locations, itemCondition]
  );

  const dirty = useMemo(() => {
    if (step > 1) return true;
    if (Object.values(lineQty).some((q) => q > 0)) return true;
    if (searchQuery.trim().length > 0) return true;
    return false;
  }, [step, lineQty, searchQuery]);

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('Discard this return?')) return;
    onClose();
  }, [dirty, onClose]);

  const reasonLabel = useMemo(() => {
    if (!reasonKey) return '';
    if (reasonKey === 'other') return reasonOther.trim() || 'Other';
    return REASONS.find((r) => r.key === reasonKey)?.label ?? '';
  }, [reasonKey, reasonOther]);

  const lineReason = useMemo(() => {
    const base = reasonLabel || 'Return';
    return base.slice(0, 500);
  }, [reasonLabel]);

  const canNext = useMemo(() => {
    if (step === 1) return Boolean(selectedOrderId && orderDetail && !orderLoading);
    if (step === 2) return orderDetail?.lines?.some((_, i) => (lineQty[i] ?? 0) > 0);
    if (step === 3) return Boolean(reasonKey && defaultRecvLoc);
    if (step === 4) return Boolean(refundMethod);
    return true;
  }, [step, selectedOrderId, orderDetail, orderLoading, lineQty, reasonKey, defaultRecvLoc, refundMethod]);

  const goNext = () => {
    if (!canNext) return;
    setStep((s) => Math.min(5, s + 1));
  };

  const goBack = () =>
    setStep((s) => {
      const next = Math.max(1, s - 1);
      if (next === 1) pendingSelectAdvance.current = false;
      return next;
    });

  const goToStep = (n: number) => {
    if (n === 1) pendingSelectAdvance.current = false;
    setStep(n);
  };

  const onSubmit = async () => {
    if (!branchId || !selectedOrderId || !orderDetail?.lines) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const lines = orderDetail.lines
        .map((_ln, idx) => {
          const q = Math.min(lineQty[idx] ?? 0, maxByLine[idx] ?? 0);
          const loc = lineLocOverride[idx] || defaultRecvLoc;
          return {
            orderLineIndex: idx,
            quantity: q,
            toLocationId: loc,
            reason: lineReason,
          };
        })
        .filter((l) => l.quantity > 0 && l.toLocationId);

      if (lines.length === 0) {
        setSubmitError('Select at least one line with a return quantity.');
        setSubmitting(false);
        return;
      }

      const notes = JSON.stringify({
        refundMethod,
        itemCondition,
        reasonKey,
        reasonOther: reasonKey === 'other' ? reasonOther : undefined,
      });

      const ret = (await salesService.createReturn(
        { originalOrderId: selectedOrderId, lines, notes },
        branchId
      )) as { _id?: string; returnNumber?: string };

      onSuccess?.({
        returnId: entityId(ret),
        originalOrderId: selectedOrderId,
        returnNumber: ret.returnNumber,
      });
      reset();
      onClose();
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Return failed');
    } finally {
      setSubmitting(false);
    }
  };

  const setQty = (idx: number, v: number) => {
    const max = maxByLine[idx] ?? 0;
    setLineQty((prev) => ({ ...prev, [idx]: Math.max(0, Math.min(max, v)) }));
  };

  const priorReturnCount = customerDetail?.returns?.length ?? 0;
  const serialFlag = priorReturnCount >= 3;

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => contentRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [open, step]);

  if (!branchId) return null;

  return (
    <Modal
      isOpen={open}
      onClose={requestClose}
      title={L.title}
      titleId="new-return-modal-title"
      size="xl"
      className="new-return-modal-wrap"
    >
      <div
        className="new-return-modal"
        ref={contentRef}
        tabIndex={-1}
      >
        <nav className="new-return-modal__progress" aria-label="Return steps">
          {L.steps.map((label, i) => {
            const n = i + 1;
            const done = step > n;
            const current = step === n;
            const canJump = done;
            return (
              <button
                key={label}
                type="button"
                className={`new-return-modal__step ${done ? 'new-return-modal__step--done' : ''} ${current ? 'new-return-modal__step--current' : ''}`}
                disabled={!canJump}
                onClick={() => canJump && goToStep(n)}
                aria-current={current ? 'step' : undefined}
              >
                <span className="new-return-modal__step-index">{done ? '✓' : n}</span>
                <span className="new-return-modal__step-label">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="new-return-modal__body">
          <div className="new-return-modal__main">
            {submitError ? <div className="new-return-modal__alert">{submitError}</div> : null}

            {step === 1 && (
              <section className="new-return-modal__section" aria-label="Find order">
                <Input
                  label={L.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={searchLoading}
                />
                <p className="new-return-modal__hint">{L.searchHint}</p>
                {searchQuery.trim().length > 0 && searchQuery.trim().length < 2 ? (
                  <p className="sales-muted">Type at least 2 characters to filter the list.</p>
                ) : null}
                {!searchLoading ? (
                  <p className="new-return-modal__results-count" aria-live="polite">
                    {isSearchActive ? (
                      <>
                        {displayOrders.length} matching {displayOrders.length === 1 ? 'order' : 'orders'}
                      </>
                    ) : (
                      <>
                        {displayOrders.length} recent {displayOrders.length === 1 ? 'order' : 'orders'}
                        {orderPool.length > displayOrders.length
                          ? ` (showing newest ${displayOrders.length} of ${orderPool.length})`
                          : ''}
                      </>
                    )}
                  </p>
                ) : null}
                <div
                  className={`new-return-modal__cards ${searchLoading ? 'new-return-modal__cards--loading' : ''}`}
                  role="list"
                  aria-label={isSearchActive ? 'Matching orders' : 'Recent orders'}
                  aria-busy={searchLoading}
                >
                  {searchLoading ? (
                    <LoadingState
                      className="new-return-modal__orders-loading"
                      message="Loading recent orders…"
                      size="md"
                    />
                  ) : null}
                  {!searchLoading &&
                  displayOrders.length === 0 &&
                  isSearchActive ? (
                    <p className="sales-muted">
                      No matching orders. Try another keyword, product name, customer phone, or order amount.
                    </p>
                  ) : null}
                  {!searchLoading && displayOrders.length === 0 && !isSearchActive ? (
                    <p className="sales-muted">No orders found for this branch.</p>
                  ) : null}
                  {!searchLoading
                    ? displayOrders.map((raw) => {
                    const o = raw as OrderDoc & { _id?: string; customerName?: string };
                    const oid = String(o._id ?? '');
                    const lines = o.lines ?? [];
                    const preview = lines.slice(0, 4);
                    const cust = getCustomerLabel(raw as Record<string, unknown>);
                    const daysLeft = daysLeftInWindow(String(o.createdAt));
                    return (
                      <button
                        key={oid}
                        type="button"
                        role="listitem"
                        className={`new-return-modal__order-card ${selectedOrderId === oid ? 'new-return-modal__order-card--active' : ''}`}
                        onClick={() => {
                          pendingSelectAdvance.current = true;
                          setSelectedOrderId(oid);
                        }}
                      >
                        <div className="new-return-modal__order-card-header">
                          <div className="new-return-modal__order-card-title">{String(o.orderNumber ?? oid.slice(0, 8))}</div>
                          <span className="new-return-modal__order-card-badge">{String(o.status ?? '')}</span>
                        </div>
                        <div className="new-return-modal__order-meta">
                          {cust.name || cust.phone || cust.email ? (
                            <>
                              {cust.name ? <strong>{cust.name}</strong> : null}
                              {cust.phone ? <span> · {cust.phone}</span> : null}
                              {cust.email ? <span className="new-return-modal__order-email"> · {cust.email}</span> : null}
                            </>
                          ) : (
                            'Customer: —'
                          )}
                        </div>
                        <ul className="new-return-modal__order-lines">
                          {preview.length === 0 ? (
                            <li className="new-return-modal__order-line">No lines</li>
                          ) : (
                            preview.map((ln, i) => {
                              const sn = (ln as OrderLine).serialNumbers;
                              const serial =
                                (ln as OrderLine).serialNumber ||
                                (Array.isArray(sn) && sn.length > 0 ? sn[0] : '') ||
                                '';
                              return (
                                <li key={i} className="new-return-modal__order-line">
                                  <span className="new-return-modal__order-line-name">
                                    {ln.variantName ?? 'Item'} · {ln.variantCode ?? '—'}
                                  </span>
                                  {serial ? (
                                    <span className="new-return-modal__order-serial">Serial: {serial}</span>
                                  ) : null}
                                </li>
                              );
                            })
                          )}
                          {lines.length > preview.length ? (
                            <li className="new-return-modal__order-line new-return-modal__order-line--more">
                              +{lines.length - preview.length} more line{lines.length - preview.length === 1 ? '' : 's'}
                            </li>
                          ) : null}
                        </ul>
                        <div className="new-return-modal__order-meta new-return-modal__order-footer">
                          <span>
                            {o.mode ? `${String(o.mode).toUpperCase()} · ` : ''}
                            {o.createdAt ? new Date(String(o.createdAt)).toLocaleDateString() : '—'}
                          </span>
                          <span>
                            {formatInr(Number(o.total ?? 0))}
                            {daysLeft != null
                              ? ` · ${daysLeft >= 0 ? `${daysLeft}d left in window` : 'Outside window'}`
                              : ''}
                          </span>
                        </div>
                      </button>
                    );
                  })
                    : null}
                </div>
                {orderLoading ? <p className="sales-muted">Loading order…</p> : null}
                {orderError ? <p className="new-return-modal__warn">{orderError}</p> : null}
              </section>
            )}

            {step === 2 && orderDetail && (
              <section className="new-return-modal__section" aria-labelledby="nr-step2">
                <h3 id="nr-step2">Select items</h3>
                <p className="new-return-modal__hint">
                  Max returnable reflects fulfilled qty minus prior returns.
                </p>
                <div className="new-return-modal__lines">
                  {orderDetail.lines?.map((ln, idx) => {
                    const max = maxByLine[idx] ?? 0;
                    const q = lineQty[idx] ?? 0;
                    const ordQ = Number(ln.quantity ?? 0);
                    const lt = Number(ln.lineTotal ?? 0);
                    const rowRefund = ordQ > 0 && q > 0 ? (lt * q) / ordQ : 0;
                    const already = returnedByLine[idx] ?? 0;
                    return (
                      <div key={idx} className="new-return-modal__line">
                        <div>
                          <strong>{ln.variantName ?? 'Item'}</strong>
                          <span className="new-return-modal__code">{ln.variantCode ?? ''}</span>
                          <SalesLineMeta line={ln as Record<string, unknown>} />
                        </div>
                        <div className="new-return-modal__line-grid">
                          <span>Ordered {ordQ}</span>
                          <span>Returned {already}</span>
                          <span className="new-return-modal__max-badge">Max {max}</span>
                        </div>
                        <div className="new-return-modal__qty">
                          <button type="button" aria-label="Decrease" onClick={() => setQty(idx, q - 1)} disabled={q <= 0}>
                            −
                          </button>
                          <input
                            aria-label="Return quantity"
                            type="number"
                            min={0}
                            max={max}
                            value={q}
                            onChange={(e) => setQty(idx, parseInt(e.target.value, 10) || 0)}
                          />
                          <button type="button" aria-label="Increase" onClick={() => setQty(idx, q + 1)} disabled={q >= max}>
                            +
                          </button>
                          <button type="button" className="new-return-modal__max-btn" onClick={() => setQty(idx, max)}>
                            Max
                          </button>
                        </div>
                        <div className="new-return-modal__line-refund">Refund {formatInr(rowRefund)}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="new-return-modal__total-refund">
                  Estimated refund <strong>{formatInr(refundTotal)}</strong>
                </div>
              </section>
            )}

            {step === 3 && (
              <section className="new-return-modal__section" aria-labelledby="nr-step3">
                <h3 id="nr-step3">Reason, condition & location</h3>
                <div className="new-return-modal__reason-grid">
                  {REASONS.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      className={`new-return-modal__reason-card ${reasonKey === r.key ? 'new-return-modal__reason-card--on' : ''}`}
                      onClick={() => setReasonKey(r.key)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {reasonKey === 'other' ? (
                  <Input label="Describe" value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} />
                ) : null}

                <Select
                  label="Item condition"
                  value={itemCondition}
                  onChange={(e) => setItemCondition(e.target.value as ItemCondition)}
                  options={[
                    { value: 'sellable', label: 'Sellable' },
                    { value: 'damaged', label: 'Damaged' },
                    { value: 'unsellable', label: 'Cannot resell' },
                  ]}
                />

                <Select
                  label="Receive returned stock at"
                  value={defaultRecvLoc}
                  onChange={(e) => setDefaultRecvLoc(e.target.value)}
                  options={locOptions}
                  placeholder={locOptions.length === 0 ? 'No receiving locations' : 'Select location'}
                />
                <p className="new-return-modal__hint">{L.receiveHelp}</p>

                <label className="new-return-modal__check">
                  <input type="checkbox" checked={showPerLineLoc} onChange={(e) => setShowPerLineLoc(e.target.checked)} />
                  Per-line receive location
                </label>
                {showPerLineLoc && orderDetail?.lines
                  ? orderDetail.lines.map((ln, idx) => {
                    if ((lineQty[idx] ?? 0) <= 0) return null;
                    return (
                      <Select
                        key={idx}
                        label={`Location · ${ln.variantCode ?? idx}`}
                        value={lineLocOverride[idx] || defaultRecvLoc}
                        onChange={(e) =>
                          setLineLocOverride((prev) => ({ ...prev, [idx]: e.target.value }))
                        }
                        options={locOptions}
                      />
                    );
                  })
                  : null}
              </section>
            )}

            {step === 4 && (
              <section className="new-return-modal__section" aria-labelledby="nr-step4">
                <h3 id="nr-step4">Refund method</h3>
                <div className="new-return-modal__amber">{L.paymentUnknown}</div>
                <div className="new-return-modal__reason-grid">
                  {REFUND_OPTS.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      className={`new-return-modal__reason-card ${refundMethod === r.key ? 'new-return-modal__reason-card--on' : ''}`}
                      onClick={() => setRefundMethod(r.key)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <p className="new-return-modal__hint soft-warn">
                  If store policy restricts refund to original payment type, adjust with your supervisor — inventory receipt still proceeds.
                </p>
              </section>
            )}

            {step === 5 && orderDetail && (
              <section className="new-return-modal__section" aria-labelledby="nr-step5">
                <h3 id="nr-step5">Review</h3>
                <table className="new-return-modal__review">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Receive at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderDetail.lines?.map((ln, idx) => {
                      const q = lineQty[idx] ?? 0;
                      if (q <= 0) return null;
                      const locId = lineLocOverride[idx] || defaultRecvLoc;
                      const locName = locations.find((l) => l.id === locId)?.name ?? locId;
                      return (
                        <tr key={idx}>
                          <td>{ln.variantName ?? ln.variantCode}</td>
                          <td>{q}</td>
                          <td>{locName}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p>
                  Refund <strong>{formatInr(refundTotal)}</strong> · Method{' '}
                  <strong>{REFUND_OPTS.find((x) => x.key === refundMethod)?.label}</strong>
                </p>
                <p>
                  Reason <strong>{reasonLabel}</strong> · Condition <strong>{itemCondition}</strong>
                </p>
              </section>
            )}
          </div>

          <aside className="new-return-modal__aside" aria-label="Return summary">
            <div className="new-return-modal__card">
              <h4>Live summary</h4>
              <p>
                Items:{' '}
                <strong>
                  {orderDetail?.lines?.filter((_, i) => (lineQty[i] ?? 0) > 0).length ?? 0}
                </strong>
              </p>
              <p>
                Refund <strong>{formatInr(refundTotal)}</strong>
              </p>
              <p className="new-return-modal__muted">{L.policyFallback}</p>
            </div>
            <div className="new-return-modal__card">
              <h4>Customer</h4>
              {customerDetail ? (
                <>
                  <p>
                    <strong>{customerDetail.profile.name}</strong>
                  </p>
                  <p>{customerDetail.profile.phone ?? '—'}</p>
                  <p>
                    Prior returns: <strong>{priorReturnCount}</strong>
                    {serialFlag ? ` · ${L.serialReturner}` : ''}
                  </p>
                </>
              ) : (
                <p className="sales-muted">—</p>
              )}
            </div>
          </aside>
        </div>

        <footer className="new-return-modal__footer">
          <Button type="button" variant="secondary" onClick={step === 1 ? requestClose : goBack}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step < 5 ? (
            <Button type="button" variant="primary" onClick={goNext} disabled={!canNext}>
              Next
            </Button>
          ) : (
            <Button type="button" variant="primary" onClick={onSubmit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit return'}
            </Button>
          )}
        </footer>
      </div>
    </Modal>
  );
};
