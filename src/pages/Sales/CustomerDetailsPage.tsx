/**
 * Customer Details — full CRM view for Sales
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Input, Select, Skeleton, Textarea } from '@/shared/components/ui';
import { EmptyState } from '@/shared/components/data-display';
import { Modal } from '@/shared/components/modals/Modal';
import { useSalesBranchId } from '@/features/sales/hooks/useSalesBranchId';
import { docId, entityId, idStr } from '@/features/sales/utils/ids';
import {
  salesService,
  type CustomerDetailPayload,
  type SalesCustomer,
  type SalesQuotation,
  type SalesQuotationLine,
} from '@/services/sales.service';
import {
  mapQuotationLinesForCreateApi,
  quotationLineGrossInr,
} from '@/features/sales/utils/mapLinesForCreateOrder';
import { SalesLineMeta } from '@/features/sales/components/shared/SalesLineMeta';
import { OrderPaymentsBreakdown } from '@/features/sales/components/shared/OrderPaymentsBreakdown';
import {
  normalizeOrderPayments,
  paymentMethodChip as orderPaymentMethodChip,
  resolveOrderPaymentSummary,
  type SalesOrderPaymentLine,
} from '@/features/sales/utils/orderPayments';
import { extractErrorMessage } from '@/utils/error';
import { orderSaleTimestampMs } from '@/utils/commercialDates';
import { authStore } from '@/store/authStore';
import './CustomerDetailsPage.css';

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'payments', label: 'Payments' },
  { id: 'quotations', label: 'Quotations' },
  { id: 'returns', label: 'Returns and Refunds' },
  { id: 'notes', label: 'Notes and Activity' },
  { id: 'profile', label: 'Profile' },
] as const;

type DetailTabId = (typeof DETAIL_TABS)[number]['id'];

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

function formatInr(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysSinceLabel(iso: string | null | undefined): { text: string; tone: 'ok' | 'amber' | 'red' | 'neutral' } {
  if (!iso) return { text: 'No orders yet', tone: 'neutral' };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 0) return { text: 'Today', tone: 'ok' };
  const text = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
  if (days > 90) return { text, tone: 'red' };
  if (days > 45) return { text, tone: 'amber' };
  return { text, tone: 'ok' };
}

function paymentMethodChip(method: string): { label: string; cls: string } {
  const c = orderPaymentMethodChip(method);
  if (c.cls.includes('--cash')) return { label: c.label, cls: 'cd-chip cd-chip--cash' };
  if (c.cls.includes('--upi')) return { label: c.label, cls: 'cd-chip cd-chip--upi' };
  if (c.cls.includes('--card')) return { label: c.label, cls: 'cd-chip cd-chip--card' };
  if (c.cls.includes('--bank')) return { label: c.label, cls: 'cd-chip cd-chip--bank' };
  return { label: c.label, cls: 'cd-chip cd-chip--pos' };
}

function activityDot(type: string): string {
  if (type === 'order') return 'cd-tl-dot cd-tl-dot--order';
  if (type === 'quotation') return 'cd-tl-dot cd-tl-dot--quotation';
  if (type === 'return') return 'cd-tl-dot cd-tl-dot--return';
  if (type === 'payment') return 'cd-tl-dot cd-tl-dot--payment';
  return 'cd-tl-dot cd-tl-dot--profile';
}

function auditDot(type: string): string {
  if (type === 'order') return 'cd-audit-dot cd-audit-dot--order';
  if (type === 'payment') return 'cd-audit-dot cd-audit-dot--payment';
  if (type === 'quotation') return 'cd-audit-dot cd-audit-dot--quotation';
  if (type === 'return') return 'cd-audit-dot cd-audit-dot--return';
  return 'cd-audit-dot cd-audit-dot--profile';
}

function segmentLabel(seg: string): string {
  const s = String(seg || 'regular');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortLedgerId(id: string): string {
  if (id.length <= 16) return id;
  return `…${id.slice(-8)}`;
}

/** B2B draft = quotation-from-cart workflow; not payable / not part of outstanding. */
function isQuotationWorkflowDraftOrder(o: { mode?: string; status?: string }): boolean {
  return String(o.mode || '').toLowerCase() === 'b2b' && String(o.status || '').toLowerCase() === 'draft';
}

type CustomerOrderRow = {
  _id?: string;
  orderNumber?: string;
  status?: string;
  mode?: string;
  total?: number;
  invoiceDate?: string;
  createdAt?: string;
  paymentPending?: boolean;
  paymentPendingAmount?: number;
  payments?: SalesOrderPaymentLine[];
  lines?: Array<Record<string, unknown>>;
};

function orderStatusBadgeProps(st: string, paymentPending: boolean): { label: string; variant: 'success' | 'warning' | 'neutral' } {
  if (st === 'completed' && !paymentPending) return { label: 'Completed', variant: 'success' };
  if (st === 'completed' && paymentPending) return { label: 'On account', variant: 'warning' };
  if (st === 'confirmed' || st === 'fulfilling') return { label: st, variant: 'warning' };
  if (st === 'draft') return { label: 'Draft', variant: 'neutral' };
  if (st === 'cancelled') return { label: 'Cancelled', variant: 'neutral' };
  return { label: st || '—', variant: 'neutral' };
}

type PaymentLedgerFilter = 'all' | 'due' | 'completed';

type PaymentOrderGroup = {
  id: string;
  orderNumber: string;
  status: string;
  paymentPending?: boolean;
  mode: string;
  createdAt: string;
  saleDateMs: number;
  orderTotal: number;
  isDue: boolean;
  isCompleted: boolean;
  lines: CustomerDetailPayload['paymentLedger'];
  paidRecorded: number;
  refundTotal: number;
  balanceDue: number;
  posPayments: SalesOrderPaymentLine[];
};

function isB2bProfile(p: SalesCustomer): boolean {
  if (p.companyName?.trim()) return true;
  if (p.segment === 'corporate' || p.segment === 'wholesale' || p.segment === 'government') return true;
  return false;
}

function noteAuthorName(note: { createdBy?: string | { name?: string } }): string {
  const c = note.createdBy;
  if (c && typeof c === 'object' && 'name' in c) return String((c as { name?: string }).name || 'Staff');
  return 'Staff';
}

export const CustomerDetailsPage: React.FC = () => {
  /** Resolve id without a parent <Route> (Sales shell renders this by match, not nested Routes). */
  const detailMatch = useMatch({ path: '/sales/customers/:customerId', end: true });
  const customerId = detailMatch?.params.customerId;
  const branchId = useSalesBranchId();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = authStore((s) => s.user);

  const tabParam = searchParams.get('ctab') || 'overview';
  const activeTab: DetailTabId = DETAIL_TABS.some((t) => t.id === tabParam) ? (tabParam as DetailTabId) : 'overview';

  const [data, setData] = useState<CustomerDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [convertingQuotationId, setConvertingQuotationId] = useState<string | null>(null);
  const [expandedQuotationId, setExpandedQuotationId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [ordersTabFilter, setOrdersTabFilter] = useState<'all' | 'open' | 'completed'>('completed');

  const [tagInput, setTagInput] = useState('');
  const [tagBusy, setTagBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const [orderPage, setOrderPage] = useState(1);
  const orderPageSize = 8;

  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payRecording, setPayRecording] = useState(false);
  const [payModalCtx, setPayModalCtx] = useState<{ orderId?: string; amount?: number; customerName?: string } | null>(
    null
  );
  const [payOrderSearch, setPayOrderSearch] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');

  const [noteDraft, setNoteDraft] = useState('');
  const [noteAdding, setNoteAdding] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');

  const [profileBasic, setProfileBasic] = useState({
    name: '',
    email: '',
    phone: '',
    companyName: '',
    gstNumber: '',
    billingAddress: '',
    shippingAddress: '',
    stateUt: '',
    paymentTerms: '' as string,
  });
  const [profilePrefs, setProfilePrefs] = useState({
    preferredContactMethod: '' as string,
    defaultDiscountPercent: '',
    creditLimit: '',
    notes: '',
  });
  const [profileSaving, setProfileSaving] = useState(false);

  const load = useCallback(async () => {
    if (!branchId || !customerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const d = await salesService.customerDetail(customerId, branchId);
      setData(d);
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'Failed to load customer'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [branchId, customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data?.profile) return;
    const p = data.profile;
    setProfileBasic({
      name: p.name || '',
      email: p.email || '',
      phone: p.phone || '',
      companyName: p.companyName || '',
      gstNumber: p.gstNumber || '',
      billingAddress: p.billingAddress || '',
      shippingAddress: p.shippingAddress || '',
      stateUt: p.stateUt || '',
      paymentTerms: p.paymentTerms || '',
    });
    setProfilePrefs({
      preferredContactMethod: p.preferredContactMethod || '',
      defaultDiscountPercent:
        p.defaultDiscountPercent != null ? String(p.defaultDiscountPercent) : '',
      creditLimit: p.creditLimit != null ? String(p.creditLimit) : '',
      notes: p.notes || '',
    });
  }, [data?.profile]);

  const setTab = (id: DetailTabId) => {
    const p = new URLSearchParams(searchParams);
    p.set('ctab', id);
    setSearchParams(p, { replace: true });
  };

  const salesBaseQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (branchId) p.set('branchId', branchId);
    return p.toString();
  }, [branchId]);

  const goSales = (extra: Record<string, string>) => {
    const p = new URLSearchParams(salesBaseQuery);
    Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    navigate(`/sales?${p.toString()}`);
  };

  const p = data?.profile;

  const returnRateHigh = (data?.summary?.returnRatePct ?? 0) > 15;

  const customerOrdersVisible = useMemo(
    () =>
      (data?.orders || []).filter((o) => {
        if (String((o as { status?: string }).status) === 'cancelled') return false;
        if (isQuotationWorkflowDraftOrder(o as { mode?: string; status?: string })) return false;
        return true;
      }),
    [data?.orders]
  );

  const ordersTabFiltered = useMemo(() => {
    const list = customerOrdersVisible.filter((o) => {
      const st = String((o as { status?: string }).status);
      const pend = Boolean((o as { paymentPending?: boolean }).paymentPending);
      if (ordersTabFilter === 'completed') return st === 'completed' && !pend;
      if (ordersTabFilter === 'open') {
        return ['draft', 'confirmed', 'fulfilling'].includes(st) || (st === 'completed' && pend);
      }
      return true;
    });
    return [...list].sort(
      (a, b) =>
        orderSaleTimestampMs(b as CustomerOrderRow) - orderSaleTimestampMs(a as CustomerOrderRow)
    );
  }, [customerOrdersVisible, ordersTabFilter]);

  const pagedOrders = useMemo(() => {
    const start = (orderPage - 1) * orderPageSize;
    return ordersTabFiltered.slice(start, start + orderPageSize);
  }, [ordersTabFiltered, orderPage]);

  useEffect(() => {
    setOrderPage(1);
    setExpandedOrderId(null);
  }, [customerId, ordersTabFilter]);

  const orderPages = Math.max(1, Math.ceil(ordersTabFiltered.length / orderPageSize));

  const unpaidOrders = useMemo(() => {
    return (data?.orders || []).filter((o) => {
      if (isQuotationWorkflowDraftOrder(o as { mode?: string; status?: string })) return false;
      const st = String((o as { status?: string }).status);
      const pend = Boolean((o as { paymentPending?: boolean }).paymentPending);
      return ['draft', 'confirmed', 'fulfilling'].includes(st) || (st === 'completed' && pend);
    });
  }, [data?.orders]);

  const filteredPayOrders = useMemo(() => {
    const q = payOrderSearch.trim().toLowerCase();
    if (!q) return unpaidOrders;
    return unpaidOrders.filter((o) => {
      const num = String((o as { orderNumber?: string }).orderNumber || '').toLowerCase();
      return num.includes(q);
    });
  }, [unpaidOrders, payOrderSearch]);

  const [paymentLedgerFilter, setPaymentLedgerFilter] = useState<PaymentLedgerFilter>('all');

  const paymentOrderGroups = useMemo((): PaymentOrderGroup[] => {
    if (!data) return [];
    const ledger = data.paymentLedger || [];
    const byOrder = new Map<string, CustomerDetailPayload['paymentLedger']>();
    for (const row of ledger) {
      const oid = row.orderId;
      if (!oid) continue;
      if (!byOrder.has(oid)) byOrder.set(oid, []);
      byOrder.get(oid)!.push(row);
    }
    const orders = (data.orders || []).filter((o) => {
      if (String((o as { status?: string }).status) === 'cancelled') return false;
      return !isQuotationWorkflowDraftOrder(o as { mode?: string; status?: string });
    });
    const sorted = [...orders].sort(
      (a, b) =>
        orderSaleTimestampMs(b as CustomerOrderRow) - orderSaleTimestampMs(a as CustomerOrderRow)
    );
    return sorted.map((raw) => {
      const id = docId(raw as { _id?: string; id?: string });
      const st = String((raw as { status?: string }).status || '');
      const lines = (id && byOrder.get(id)) || [];
      const paidRecorded = lines.filter((r) => !r.isRefund).reduce((s, r) => s + Number(r.amount || 0), 0);
      const refundTotal = lines.filter((r) => r.isRefund).reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
      const orderTotal = Number((raw as { total?: number }).total || 0);
      const paymentPending = Boolean((raw as { paymentPending?: boolean }).paymentPending);
      const pendingAmt = (raw as { paymentPendingAmount?: number }).paymentPendingAmount;
      const isOpen = ['draft', 'confirmed', 'fulfilling'].includes(st);
      const isDue = isOpen || (st === 'completed' && paymentPending);
      const isCompleted = st === 'completed' && !paymentPending;
      const balanceDue = isDue
        ? st === 'completed' && paymentPending
          ? pendingAmt != null && Number.isFinite(Number(pendingAmt))
            ? Math.max(0, Math.round(Number(pendingAmt) * 100) / 100)
            : Math.max(0, Math.round(orderTotal * 100) / 100)
          : Math.max(0, Math.round((orderTotal - paidRecorded + refundTotal) * 100) / 100)
        : 0;
      return {
        id: id || '',
        orderNumber: String((raw as { orderNumber?: string }).orderNumber || ''),
        status: st,
        paymentPending,
        mode: String((raw as { mode?: string }).mode || ''),
        createdAt: String((raw as { createdAt?: string }).createdAt || ''),
        saleDateMs: orderSaleTimestampMs(raw as CustomerOrderRow),
        orderTotal,
        isDue,
        isCompleted,
        lines: [...lines].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
        paidRecorded,
        refundTotal,
        balanceDue,
        posPayments: normalizeOrderPayments((raw as { payments?: unknown }).payments),
      };
    });
  }, [data]);

  const filteredPaymentGroups = useMemo(() => {
    if (paymentLedgerFilter === 'due') return paymentOrderGroups.filter((g) => g.isDue);
    if (paymentLedgerFilter === 'completed') return paymentOrderGroups.filter((g) => g.isCompleted);
    return paymentOrderGroups;
  }, [paymentOrderGroups, paymentLedgerFilter]);

  const navigateToOrder = useCallback(
    (orderId: string) => {
      if (!customerId || !orderId) return;
      const q = new URLSearchParams(searchParams);
      q.set('tab', 'customers');
      q.set('returnCustomer', customerId);
      q.set('returnCtab', activeTab);
      navigate({ pathname: `/sales/orders/${orderId}`, search: `?${q.toString()}` });
    },
    [customerId, navigate, searchParams, activeTab]
  );

  const openCollectModal = (opts?: { orderId?: string; amount?: number }) => {
    setPayModalCtx({
      orderId: opts?.orderId,
      amount: opts?.amount,
      customerName: p?.name,
    });
    setPayAmount(opts?.amount != null ? String(opts.amount) : '');
    setPayModalOpen(true);
  };

  const handleSetCustomerActive = async (nextActive: boolean) => {
    if (!branchId || !customerId || !p) return;
    if (nextActive === p.isActive) return;
    const msg = nextActive
      ? `Restore customer “${p.name}” to active? They can receive sales and orders again.`
      : `Archive customer “${p.name}”? They will be marked inactive.`;
    if (!window.confirm(msg)) return;
    setArchiveBusy(true);
    setError(null);
    try {
      await salesService.patchCustomer(customerId, { isActive: nextActive }, branchId);
      await load();
    } catch (e: unknown) {
      setError(extractErrorMessage(e, nextActive ? 'Could not reactivate customer' : 'Could not archive customer'));
    } finally {
      setArchiveBusy(false);
    }
  };

  const addTag = async () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || !branchId || !customerId || !p) return;
    if ((p.tags || []).includes(t)) {
      setTagInput('');
      return;
    }
    setTagBusy(true);
    try {
      await salesService.patchCustomer(customerId, { tags: [...(p.tags || []), t] }, branchId);
      setTagInput('');
      await load();
    } finally {
      setTagBusy(false);
    }
  };

  const removeTag = async (tag: string) => {
    if (!branchId || !customerId || !p) return;
    setTagBusy(true);
    try {
      await salesService.patchCustomer(
        customerId,
        { tags: (p.tags || []).filter((x) => x !== tag) },
        branchId
      );
      await load();
    } finally {
      setTagBusy(false);
    }
  };

  const saveProfile = async (which: 'basic' | 'prefs') => {
    if (!branchId || !customerId) return;
    setProfileSaving(true);
    try {
      if (which === 'basic') {
        await salesService.patchCustomer(
          customerId,
          {
            name: profileBasic.name.trim(),
            email: profileBasic.email.trim() || undefined,
            phone: profileBasic.phone.trim() || undefined,
            companyName: profileBasic.companyName.trim() || undefined,
            gstNumber: profileBasic.gstNumber.trim().toUpperCase() || undefined,
            billingAddress: profileBasic.billingAddress.trim() || undefined,
            shippingAddress: profileBasic.shippingAddress.trim() || undefined,
            stateUt: profileBasic.stateUt.trim() || undefined,
            paymentTerms: (profileBasic.paymentTerms || undefined) as SalesCustomer['paymentTerms'],
          },
          branchId
        );
      } else {
        const d = parseFloat(profilePrefs.defaultDiscountPercent);
        const c = parseFloat(profilePrefs.creditLimit);
        await salesService.patchCustomer(
          customerId,
          {
            preferredContactMethod: (profilePrefs.preferredContactMethod || undefined) as SalesCustomer['preferredContactMethod'],
            defaultDiscountPercent: Number.isFinite(d) ? d : undefined,
            creditLimit: Number.isFinite(c) ? c : undefined,
            notes: profilePrefs.notes.trim() || undefined,
          },
          branchId
        );
      }
      await load();
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'Save failed'));
    } finally {
      setProfileSaving(false);
    }
  };

  const cancelProfile = () => {
    if (!data?.profile) return;
    const pr = data.profile;
    setProfileBasic({
      name: pr.name || '',
      email: pr.email || '',
      phone: pr.phone || '',
      companyName: pr.companyName || '',
      gstNumber: pr.gstNumber || '',
      billingAddress: pr.billingAddress || '',
      shippingAddress: pr.shippingAddress || '',
      stateUt: pr.stateUt || '',
      paymentTerms: pr.paymentTerms || '',
    });
    setProfilePrefs({
      preferredContactMethod: pr.preferredContactMethod || '',
      defaultDiscountPercent: pr.defaultDiscountPercent != null ? String(pr.defaultDiscountPercent) : '',
      creditLimit: pr.creditLimit != null ? String(pr.creditLimit) : '',
      notes: pr.notes || '',
    });
  };

  const addNote = async () => {
    const t = noteDraft.trim();
    if (!t || !branchId || !customerId) return;
    setNoteAdding(true);
    try {
      await salesService.addCustomerNote(customerId, t, branchId);
      setNoteDraft('');
      await load();
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'Could not add note'));
    } finally {
      setNoteAdding(false);
    }
  };

  const saveNoteEdit = async () => {
    if (!editingNoteId || !branchId || !customerId) return;
    try {
      await salesService.updateCustomerNote(customerId, editingNoteId, editingNoteText, branchId);
      setEditingNoteId(null);
      await load();
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'Could not update note'));
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!branchId || !customerId) return;
    if (!window.confirm('Delete this note?')) return;
    try {
      await salesService.deleteCustomerNote(customerId, noteId, branchId);
      await load();
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'Could not delete note'));
    }
  };

  const digitsOnly = (phone: string) => phone.replace(/\D/g, '');

  /** wa.me expects country code + national number (no +). */
  const whatsappHrefFor = (phone: string | undefined, name: string | undefined): string | null => {
    let d = digitsOnly(phone || '');
    if (!d) return null;
    d = d.replace(/^0+/, '');
    if (!d.startsWith('91')) d = `91${d}`;
    const msg = encodeURIComponent(`Hi ${name?.trim() || 'there'}, trust you're doing well.`);
    return `https://wa.me/${d}?text=${msg}`;
  };

  const mailtoHrefFor = (email: string | undefined, name: string | undefined): string | null => {
    const addr = (email || '').trim();
    if (!addr) return null;
    const sub = encodeURIComponent(`Hello${name?.trim() ? ` ${name.trim()}` : ''}`);
    return `mailto:${addr}?subject=${sub}`;
  };

  const telHrefFor = (phone: string | undefined): string | null => {
    const d = digitsOnly(phone || '');
    if (!d) return null;
    return `tel:${d}`;
  };

  const openExternalUrl = (href: string | null | undefined) => {
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const heroClass =
    p?.segment === 'vip' ? 'cd-avatar cd-avatar--vip' : p?.segment === 'corporate' ? 'cd-avatar cd-avatar--corp' : 'cd-avatar';

  const segBadgeVariant =
    p?.segment === 'vip' || p?.segment === 'corporate'
      ? 'cd-seg-badge--gold'
      : p?.segment === 'wholesale'
        ? 'cd-seg-badge--purple'
        : '';

  if (!branchId) {
    return (
      <div className="cd-page cd-page--embedded">
        <EmptyState title="Branch required" message="Open Sales from a branch context or add ?branchId= to the URL." />
      </div>
    );
  }

  if (!customerId) {
    return (
      <div className="cd-page cd-page--embedded">
        <EmptyState title="Customer not found" message="This link is missing a customer id." />
        <Button variant="secondary" onClick={() => navigate(`/sales?tab=customers&${salesBaseQuery}`)}>
          Back to customers
        </Button>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="cd-page cd-page--embedded">
        <div className="cd-topbar">
          <Skeleton height={36} width={200} />
          <Skeleton height={36} width={280} />
        </div>
        <div className="cd-skel-hero cd-panel">
          <Skeleton variant="circular" width={72} height={72} />
          <div style={{ flex: 1 }}>
            <Skeleton height={28} width="50%" />
            <Skeleton height={16} width="30%" />
            <Skeleton height={16} width="70%" />
          </div>
        </div>
        <div className="cd-kpis">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="cd-kpi">
              <Skeleton height={12} width="60%" />
              <Skeleton height={24} width="40%" />
              <Skeleton height={14} width="80%" />
            </div>
          ))}
        </div>
        <Skeleton height={400} width="100%" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="cd-page cd-page--embedded">
        <EmptyState title="Could not load customer" message={error} />
        <Button variant="secondary" onClick={() => navigate(`/sales?tab=customers&${salesBaseQuery}`)}>
          Back to customers
        </Button>
      </div>
    );
  }

  if (!data || !p || !data.summary) return null;

  const s = data.summary;

  const lastMeta = daysSinceLabel(s.lastOrderDate ?? p.lastOrderDate);
  const balanceTone =
    (s?.outstandingAmount ?? 0) <= 0 ? 'cd-kpi--balance-ok' : 'cd-kpi--balance-bad';
  const lastCls =
    lastMeta.tone === 'amber' ? 'cd-kpi--last-amber' : lastMeta.tone === 'red' ? 'cd-kpi--last-red' : '';

  const maxSpark = Math.max(1, ...(data.monthlyOrderVolume || []).map((m) => m.count));

  const repeatPattern =
    (data.repeatReturnVariantIds?.length ?? 0) > 0
      ? 'Repeated returns detected for one or more products. Review quality or fit issues with this account.'
      : null;

  return (
    <div className="cd-page cd-page--embedded">
      {s && s.overdueAmount > 0 ? (
        <div className="cd-overdue-banner">
          <span>
            <strong>Overdue balance:</strong> {formatInr(s.overdueAmount)} — follow up on open invoices.
          </span>
          <Button type="button" variant="primary" onClick={() => setTab('payments')}>
            Collect now
          </Button>
        </div>
      ) : null}

      <header className="cd-hero">
        <div className="cd-hero-main">
          <div className={heroClass} aria-hidden>
            {initials(p.name)}
          </div>
          <div className="cd-hero-text">
            <h1>{p.name}</h1>
            <div className="cd-mono">{p.customerCode}</div>
            <div className="cd-hero-badges">
              <Badge variant={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
              <Badge variant="primary" className={segBadgeVariant || undefined}>
                {segmentLabel(p.segment)}
              </Badge>
              <Badge variant="neutral">{isB2bProfile(p) ? 'B2B' : 'B2C'}</Badge>
            </div>
            <div className="cd-tags-row">
              {(p.tags || []).map((tag) => (
                <span key={tag} className="cd-tag">
                  {tag}
                  <button type="button" aria-label={`Remove ${tag}`} onClick={() => void removeTag(tag)} disabled={tagBusy}>
                    ×
                  </button>
                </span>
              ))}
              <span className="cd-tag-add">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Add tag"
                  onKeyDown={(e) => e.key === 'Enter' && void addTag()}
                />
                <Button type="button" size="sm" variant="secondary" onClick={() => void addTag()} disabled={tagBusy}>
                  Add tag
                </Button>
              </span>
            </div>
          </div>
        </div>
        <div className="cd-hero-actions">
          {telHrefFor(p.phone) ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => openExternalUrl(telHrefFor(p.phone))}
            >
              Call
            </Button>
          ) : (
            <Button type="button" variant="secondary" disabled title="No phone">
              Call
            </Button>
          )}
          {mailtoHrefFor(p.email, p.name) ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => openExternalUrl(mailtoHrefFor(p.email, p.name))}
            >
              Email
            </Button>
          ) : (
            <Button type="button" variant="secondary" disabled title="No email">
              Email
            </Button>
          )}
          {whatsappHrefFor(p.phone, p.name) ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => openExternalUrl(whatsappHrefFor(p.phone, p.name))}
            >
              WhatsApp
            </Button>
          ) : (
            <Button type="button" variant="secondary" disabled title="No valid phone for WhatsApp">
              WhatsApp
            </Button>
          )}
          {p.isActive ? (
            <Button
              type="button"
              variant="secondary"
              disabled={archiveBusy}
              onClick={() => void handleSetCustomerActive(false)}
            >
              {archiveBusy ? '…' : 'Archive'}
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={archiveBusy}
              onClick={() => void handleSetCustomerActive(true)}
            >
              {archiveBusy ? '…' : 'Unarchive'}
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            disabled={!p.isActive}
            title={!p.isActive ? 'Reactivate this customer to start a new order.' : undefined}
            onClick={() => {
              const disc = p.defaultDiscountPercent != null && p.defaultDiscountPercent > 0 ? String(p.defaultDiscountPercent) : '';
              const q = new URLSearchParams(salesBaseQuery);
              q.set('tab', 'orders');
              q.set('customerId', customerId!);
              q.set('posOrderForCustomer', '1');
              if (disc) q.set('orderDiscount', disc);
              navigate(`/sales?${q.toString()}`);
            }}
          >
            New order
          </Button>
        </div>
      </header>

      {error ? <div className="sales-panel-error">{error}</div> : null}

      <section className="cd-kpis" aria-label="Key metrics">
        <div className="cd-kpi">
          <label>Lifetime value</label>
          <strong>{formatInr(s.lifetimeValue)}</strong>
          <em>Top {s.ltvTopPercentOfCustomers}% of customers</em>
        </div>
        <div className="cd-kpi">
          <label>Total orders</label>
          <strong>{s.orderCount}</strong>
          <em>{s.avgOrdersPerMonth.toFixed(1)} avg / month</em>
        </div>
        <div className="cd-kpi">
          <label>Average order value</label>
          <strong>{formatInr(s.avgOrderValue)}</strong>
          <em>
            {s.aovVsPrevQuarterPct == null
              ? 'No prior quarter data'
              : `${s.aovVsPrevQuarterPct >= 0 ? '+' : ''}${s.aovVsPrevQuarterPct}% vs prior quarter`}
          </em>
        </div>
        <div className={`cd-kpi ${balanceTone}`}>
          <label>Outstanding balance</label>
          <strong>{formatInr(s.outstandingAmount)}</strong>
          <em>{s.outstandingAmount <= 0 ? 'All clear' : 'Open orders / credit'}</em>
        </div>
        <div className={`cd-kpi ${lastCls}`}>
          <label>Last order</label>
          <strong>{lastMeta.text}</strong>
          <em>
            {s.lastOrderDate || p.lastOrderDate
              ? new Date(s.lastOrderDate || p.lastOrderDate || '').toLocaleDateString('en-IN')
              : '—'}
          </em>
        </div>
      </section>

      <nav className="cd-tabs" role="tablist" aria-label="Customer sections">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={`cd-tab ${activeTab === t.id ? 'active' : ''} ${t.id === 'returns' && returnRateHigh ? 'cd-tab-warn' : ''}`}
            aria-selected={activeTab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <Skeleton height={320} width="100%" />
      ) : (
        <>
          {activeTab === 'overview' && (
            <div className="cd-grid-2">
              <div>
                <div className="cd-panel">
                  <div className="cd-panel__head">
                    <h3>Contact information</h3>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setTab('profile')}>
                      Edit
                    </Button>
                  </div>
                  <dl className="cd-dl">
                    <dt>Phone</dt>
                    <dd>{p.phone || '—'}</dd>
                    <dt>Email</dt>
                    <dd>{p.email || '—'}</dd>
                    <dt>Company</dt>
                    <dd>{p.companyName || '—'}</dd>
                    <dt>GST</dt>
                    <dd className="cd-mono">{p.gstNumber || '—'}</dd>
                    <dt>Billing</dt>
                    <dd>{p.billingAddress || p.address || '—'}</dd>
                    <dt>Shipping</dt>
                    <dd>{p.shippingAddress || '—'}</dd>
                    <dt>State / UT</dt>
                    <dd>{p.stateUt || '—'}</dd>
                    <dt>Payment terms</dt>
                    <dd>{p.paymentTerms || '—'}</dd>
                  </dl>
                </div>
                <div className="cd-panel">
                  <h3>Recent activity</h3>
                  <ul className="cd-timeline">
                    {(data.activity || []).map((ev, i) => (
                      <li key={`${ev.ts}-${i}`}>
                        <span className={activityDot(ev.type)} />
                        <div>
                          <div className="cd-tl-title">{ev.title}</div>
                          <div className="cd-tl-meta">
                            {new Date(ev.ts).toLocaleString('en-IN')} · {ev.actor} · {ev.channel}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div>
                <div className="cd-panel">
                  <h3>Purchase behaviour</h3>
                  <div className="cd-progress">
                    <div className="cd-progress-top">
                      <span>Monthly order consistency</span>
                      <span>{s.orderConsistencyPct}%</span>
                    </div>
                    <div className="cd-progress-bar">
                      <div className="cd-progress-fill" style={{ width: `${s.orderConsistencyPct}%` }} />
                    </div>
                  </div>
                  <div className="cd-progress">
                    <div className="cd-progress-top">
                      <span>Payment reliability</span>
                      <span>{s.paymentReliabilityPct}%</span>
                    </div>
                    <div className="cd-progress-bar">
                      <div className="cd-progress-fill" style={{ width: `${s.paymentReliabilityPct}%` }} />
                    </div>
                  </div>
                  <div className="cd-progress">
                    <div className="cd-progress-top">
                      <span>Return rate</span>
                      <span>{s.returnRatePct}%</span>
                    </div>
                    <div className="cd-progress-bar">
                      <div
                        className="cd-progress-fill"
                        style={{
                          width: `${Math.min(100, s.returnRatePct)}%`,
                          background: s.returnRatePct > 15 ? 'linear-gradient(90deg,#f97316,#ef4444)' : undefined,
                        }}
                      />
                    </div>
                  </div>
                  <div className="cd-spark" aria-label="Monthly order volume">
                    {(data.monthlyOrderVolume || []).map((m) => (
                      <div key={m.month} className="cd-spark-col">
                        <div
                          className="cd-spark-bar"
                          style={{ height: `${Math.max(8, (m.count / maxSpark) * 56)}px` }}
                          title={`${m.count} orders`}
                        />
                        <span className="cd-spark-label">{m.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="cd-panel">
                  <h3>Top products purchased</h3>
                  <div className="cd-table-wrap">
                    <table className="cd-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Orders</th>
                          <th>Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.topProducts || []).length === 0 ? (
                          <tr>
                            <td colSpan={3}>No purchase history yet.</td>
                          </tr>
                        ) : (
                          (data.topProducts || []).map((r) => (
                            <tr key={r.variantKey}>
                              <td>{r.name}</td>
                              <td>{r.orderCount}</td>
                              <td>{formatInr(r.revenue)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="cd-panel">
              <div className="cd-orders-tab-head">
                <div>
                  <h3 style={{ margin: 0 }}>Orders</h3>
                  <p className="cd-orders-tab-hint">
                    {ordersTabFiltered.length} order{ordersTabFiltered.length === 1 ? '' : 's'}
                    {ordersTabFilter !== 'all' ? ` · ${ordersTabFilter}` : ''}
                    {customerOrdersVisible.length > 0
                      ? ' · Line detail: HSN, GST, notes (expand)'
                      : ''}
                  </p>
                </div>
                <div className="cd-orders-tab-actions">
                  <div className="cd-orders-filters" role="tablist" aria-label="Filter orders">
                    {(
                      [
                        { id: 'all' as const, label: 'All' },
                        { id: 'open' as const, label: 'Open' },
                        { id: 'completed' as const, label: 'Completed' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={ordersTabFilter === opt.id}
                        className={`cd-payment-filter ${ordersTabFilter === opt.id ? 'cd-payment-filter--active' : ''}`}
                        onClick={() => setOrdersTabFilter(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!p.isActive}
                    title={!p.isActive ? 'Reactivate this customer to start a new order.' : undefined}
                    onClick={() => {
                      const q = new URLSearchParams(salesBaseQuery);
                      q.set('tab', 'orders');
                      q.set('customerId', customerId!);
                      q.set('posOrderForCustomer', '1');
                      navigate(`/sales?${q.toString()}`);
                    }}
                  >
                    New order
                  </Button>
                </div>
              </div>
              {ordersTabFiltered.length === 0 ? (
                <div className="cd-empty-illus">
                  <svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="10" y="20" width="100" height="70" rx="8" stroke="currentColor" strokeWidth="2" />
                    <path d="M35 45h50M35 58h35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  {customerOrdersVisible.length === 0 ? (
                    (data?.orders || []).length === 0 ? (
                      <>
                        <p>No orders for this customer yet.</p>
                        <Button
                          type="button"
                          variant="primary"
                          disabled={!p.isActive}
                          title={!p.isActive ? 'Reactivate this customer to start a new order.' : undefined}
                          onClick={() => {
                            const q = new URLSearchParams(salesBaseQuery);
                            q.set('tab', 'orders');
                            q.set('customerId', customerId!);
                            q.set('posOrderForCustomer', '1');
                            navigate(`/sales?${q.toString()}`);
                          }}
                        >
                          Create first order
                        </Button>
                      </>
                    ) : (
                      <>
                        <p>No orders in this list. Cancelled orders and quotation drafts are hidden here.</p>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => goSales({ tab: 'orders', customerId: customerId! })}
                        >
                          Open sales workspace
                        </Button>
                      </>
                    )
                  ) : (
                    <>
                      <p>No orders match this filter. Try <strong>All</strong> or <strong>Open</strong>.</p>
                      <Button type="button" variant="secondary" onClick={() => setOrdersTabFilter('all')}>
                        Show all orders
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="cd-table-wrap">
                    <table className="cd-table">
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Status</th>
                          <th>Mode</th>
                          <th>Lines</th>
                          <th>Amount</th>
                          <th>Sale date</th>
                          <th>Payment</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedOrders.map((row) => {
                          const o = row as CustomerOrderRow;
                          const oid = docId(row as { _id?: string }) || '';
                          const st = String(o.status || '');
                          const pend = Boolean(o.paymentPending);
                          const badge = orderStatusBadgeProps(st, pend);
                          const lines = o.lines || [];
                          const payInfo = resolveOrderPaymentSummary(o);
                          const payCell =
                            st === 'completed' && !pend ? (
                              payInfo.payments.length > 0 ? (
                                <span title={payInfo.summary}>
                                  Paid · {payInfo.summary}
                                </span>
                              ) : (
                                <span>Paid</span>
                              )
                            ) : st === 'completed' && pend ? (
                              <span>
                                Owes{' '}
                                <strong>
                                  {formatInr(
                                    o.paymentPendingAmount != null && Number.isFinite(Number(o.paymentPendingAmount))
                                      ? Number(o.paymentPendingAmount)
                                      : Number(o.total || 0)
                                  )}
                                </strong>
                              </span>
                            ) : (
                              <span className="cd-order-pay-open">Not settled</span>
                            );
                          return (
                            <React.Fragment key={oid || o.orderNumber}>
                              <tr>
                                <td>
                                  <button
                                    type="button"
                                    className="cd-mono-link"
                                    onClick={() =>
                                      oid ? navigateToOrder(oid) : goSales({ tab: 'orders', customerId: customerId! })
                                    }
                                  >
                                    {o.orderNumber}
                                  </button>
                                </td>
                                <td>
                                  <Badge variant={badge.variant}>{badge.label}</Badge>
                                </td>
                                <td>
                                  <span className="cd-mode-chip">{String(o.mode || '—').toUpperCase()}</span>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="cd-quot-expand"
                                    onClick={() =>
                                      setExpandedOrderId(expandedOrderId === oid ? null : oid || null)
                                    }
                                    disabled={lines.length === 0}
                                    title={lines.length === 0 ? 'No line items' : 'Show line items'}
                                  >
                                    {lines.length} line{lines.length === 1 ? '' : 's'}
                                    {lines.length > 0 ? (
                                      <span className="cd-quot-expand__chev" aria-hidden>
                                        {expandedOrderId === oid ? ' ▲' : ' ▼'}
                                      </span>
                                    ) : null}
                                  </button>
                                </td>
                                <td>{formatInr(Number(o.total || 0))}</td>
                                <td
                                  title={
                                    o.createdAt
                                      ? `Entered: ${new Date(o.createdAt).toLocaleString('en-IN')}`
                                      : undefined
                                  }
                                >
                                  {orderSaleTimestampMs(o) > 0
                                    ? new Date(orderSaleTimestampMs(o)).toLocaleDateString('en-IN')
                                    : '—'}
                                </td>
                                <td>{payCell}</td>
                                <td>
                                  <div className="cd-row-actions">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      onClick={() =>
                                        oid ? navigateToOrder(oid) : goSales({ tab: 'orders', customerId: customerId! })
                                      }
                                    >
                                      View
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => goSales({ tab: 'history', customerId: customerId! })}
                                    >
                                      Invoice
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                              {expandedOrderId === oid && lines.length > 0 ? (
                                <tr className="cd-quot-lines-row">
                                  <td colSpan={8}>
                                    <div className="cd-quot-lines">
                                      <table className="cd-table cd-table--nested">
                                        <thead>
                                          <tr>
                                            <th>Product</th>
                                            <th>Qty</th>
                                            <th>Unit</th>
                                            <th>Discount</th>
                                            <th>Line total</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lines.map((ln, li) => {
                                            const l = ln as Record<string, unknown>;
                                            const qty = Number(l.quantity ?? 0);
                                            const unit = Number(l.unitPrice ?? 0);
                                            const lt = Number(l.lineTotal ?? 0);
                                            const listU =
                                              l.posListUnitPrice != null && Number.isFinite(Number(l.posListUnitPrice))
                                                ? Number(l.posListUnitPrice)
                                                : unit;
                                            const explicitDisc = Number(l.posLineDiscountAmount ?? 0);
                                            const lineDisc =
                                              explicitDisc > 0 ? explicitDisc : Math.max(0, listU * qty - lt);
                                            return (
                                              <tr key={`${oid}-ln-${li}`}>
                                                <td>
                                                  <div style={{ fontWeight: 600 }}>
                                                    {String(l.variantName || 'Item')}
                                                  </div>
                                                  <div className="cd-mono" style={{ fontSize: 12, color: '#64748b' }}>
                                                    {String(l.variantCode || '—')}
                                                  </div>
                                                  <SalesLineMeta line={l} />
                                                </td>
                                                <td>{qty}</td>
                                                <td>{formatInr(unit)}</td>
                                                <td style={{ color: lineDisc > 0 ? '#16a34a' : '#94a3b8' }}>
                                                  {lineDisc > 0 ? `−${formatInr(lineDisc)}` : '—'}
                                                </td>
                                                <td>{formatInr(lt)}</td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="cd-pagination">
                    <Button variant="secondary" size="sm" disabled={orderPage <= 1} onClick={() => setOrderPage((x) => x - 1)}>
                      Prev
                    </Button>
                    <span>
                      Page {orderPage} / {orderPages}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={orderPage >= orderPages}
                      onClick={() => setOrderPage((x) => x + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'payments' && (
            <div>
              <div className="cd-panel">
                <div className="cd-payment-ledger-head">
                </div>

                <div className="cd-payment-filters" role="tablist" aria-label="Filter payments by order status">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {(
                      [
                        { id: 'all' as const, label: 'All orders' },
                        { id: 'due' as const, label: 'Due' },
                        { id: 'completed' as const, label: 'Completed' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={paymentLedgerFilter === opt.id}
                        className={`cd-payment-filter ${paymentLedgerFilter === opt.id ? 'cd-payment-filter--active' : ''}`}
                        onClick={() => setPaymentLedgerFilter(opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <Button type="button" variant="primary" onClick={() => openCollectModal()}>
                    Record payment
                  </Button>
                </div>
                <p className="cd-payment-filter-hint">
                  {paymentLedgerFilter === 'all' && `${paymentOrderGroups.length} order(s) · Full ledger`}
                  {paymentLedgerFilter === 'due' &&
                    `${filteredPaymentGroups.length} open order(s) with an amount due · Match “Outstanding balance” above`}
                  {paymentLedgerFilter === 'completed' && `${filteredPaymentGroups.length} completed sale(s) with recorded payments`}
                </p>

                {filteredPaymentGroups.length === 0 ? (
                  <div className="cd-payment-empty">
                    {paymentOrderGroups.length === 0
                      ? 'No orders yet — nothing to show in the payment ledger.'
                      : 'No orders match this filter.'}
                  </div>
                ) : (
                  <div className="cd-payment-groups">
                    {filteredPaymentGroups.map((g) => (
                      <div key={g.id || g.orderNumber} className="cd-payment-group">
                        <div className="cd-payment-group__head">
                          <button
                            type="button"
                            className="cd-payment-group__title"
                            onClick={() => g.id && navigateToOrder(g.id)}
                            title="Open order details"
                          >
                            <span className="cd-payment-group__order-num">{g.orderNumber || g.id.slice(-8)}</span>
                            {g.mode === 'b2b' ? (
                              <Badge variant="neutral">B2B</Badge>
                            ) : (
                              <Badge variant="neutral">POS</Badge>
                            )}
                            {g.isDue ? (
                              g.paymentPending && g.status === 'completed' ? (
                                <Badge variant="warning">
                                  {g.posPayments.length > 0 ? 'Partially paid' : 'On account'}
                                </Badge>
                              ) : (
                                <Badge variant="warning">Due</Badge>
                              )
                            ) : g.isCompleted ? (
                              <Badge variant="success">Paid</Badge>
                            ) : (
                              <Badge variant="neutral">{g.status}</Badge>
                            )}
                            <span
                              className="cd-payment-group__date"
                              title={
                                g.createdAt
                                  ? `Entered: ${new Date(g.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`
                                  : undefined
                              }
                            >
                              {g.saleDateMs > 0
                                ? new Date(g.saleDateMs).toLocaleDateString('en-IN', { dateStyle: 'medium' })
                                : '—'}
                            </span>
                          </button>
                          <div className="cd-payment-group__amounts">
                            <span>
                              Order <strong>{formatInr(g.orderTotal)}</strong>
                            </span>
                            {g.refundTotal > 0 ? (
                              <span className="cd-payment-refund-pill">Refunds {formatInr(g.refundTotal)}</span>
                            ) : null}
                            {g.isDue ? (
                              <span className="cd-payment-due-pill">Due {formatInr(g.balanceDue)}</span>
                            ) : (
                              <span className="cd-payment-paid-pill">Recorded {formatInr(g.paidRecorded)}</span>
                            )}
                          </div>
                          <div className="cd-payment-group__actions">
                            {g.isDue ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => openCollectModal({ orderId: g.id, amount: g.balanceDue })}
                              >
                                Record payment
                              </Button>
                            ) : null}
                            <Button type="button" size="sm" variant="primary" disabled={!g.id} onClick={() => g.id && navigateToOrder(g.id)}>
                              View order
                            </Button>
                          </div>
                        </div>
                        {g.posPayments.length > 0 ? (
                          <div className="cd-pos-payments-readonly">
                            <p className="cd-payment-ledger-sub">Collected at checkout / settlement</p>
                            <OrderPaymentsBreakdown payments={g.posPayments} compact />
                          </div>
                        ) : null}
                        {g.lines.length === 0 ? (
                          <div className="cd-payment-group__empty-lines">
                            {g.isDue
                              ? 'No payment lines yet — balance is unpaid until you record a payment or complete the sale in POS.'
                              : g.posPayments.length > 0
                                ? 'Customer ledger has no separate entries — payment was recorded at POS checkout above.'
                                : 'No ledger lines for this order.'}
                          </div>
                        ) : (
                          <div className="cd-table-wrap cd-table-wrap--nested">
                            <table className="cd-table cd-table--compact">
                              <thead>
                                <tr>
                                  <th>Entry</th>
                                  <th>Amount</th>
                                  <th>Method</th>
                                  <th>Date</th>
                                  <th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.lines.map((row) => {
                                  const chip = paymentMethodChip(row.method);
                                  return (
                                    <tr key={row.id}>
                                      <td className="cd-mono" title={row.id}>
                                        {shortLedgerId(row.id)}
                                      </td>
                                      <td style={{ color: row.isRefund ? '#b91c1c' : undefined, fontWeight: 600 }}>
                                        {row.isRefund ? '−' : ''}
                                        {formatInr(Math.abs(row.amount))}
                                      </td>
                                      <td>
                                        <span className={chip.cls}>{chip.label}</span>
                                      </td>
                                      <td>{row.date ? new Date(row.date).toLocaleString('en-IN') : '—'}</td>
                                      <td>
                                        {row.isRefund ? (
                                          <Badge variant="warning">Refunded</Badge>
                                        ) : (
                                          <Badge variant="success">{row.status}</Badge>
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
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'quotations' && (
            <div className="cd-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>Quotations</h3>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!p.isActive}
                    title={!p.isActive ? 'Reactivate this customer to create a quotation.' : undefined}
                    onClick={() => {
                      const q = new URLSearchParams(salesBaseQuery);
                      q.set('tab', 'orders');
                      q.set('customerId', customerId!);
                      q.set('startQuotation', '1');
                      navigate(`/sales?${q.toString()}`);
                    }}
                  >
                    Create quotation
                  </Button>
                </div>
              <div className="cd-table-wrap">
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th>Quotation ID</th>
                      <th>Amount</th>
                      <th>Lines</th>
                      <th>Created</th>
                      <th>Expiry</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.quotations || []).length === 0 ? (
                      <tr>
                        <td colSpan={7}>No quotations yet.</td>
                      </tr>
                    ) : (
                      (data.quotations || []).map((q) => {
                        const qu = q as SalesQuotation;
                        const exp = qu.validUntil ? new Date(qu.validUntil) : null;
                        const nowT = Date.now();
                        const expired = exp && exp.getTime() < nowT;
                        const soon = exp && !expired && exp.getTime() - nowT < 3 * 86400000;
                        const canConvertQuotation =
                          qu.status !== 'converted' &&
                          qu.status !== 'rejected' &&
                          qu.status !== 'cancelled' &&
                          qu.status !== 'expired';
                        return (
                          <React.Fragment key={qu._id}>
                          <tr>
                            <td className="cd-mono">{qu.quoteNumber}</td>
                            <td>{formatInr(qu.total)}</td>
                            <td>
                              <button
                                type="button"
                                className="cd-quot-expand"
                                onClick={() =>
                                  setExpandedQuotationId(expandedQuotationId === qu._id ? null : qu._id)
                                }
                              >
                                {qu.lines.length} line{qu.lines.length === 1 ? '' : 's'}
                                <span className="cd-quot-expand__chev" aria-hidden>
                                  {expandedQuotationId === qu._id ? ' ▲' : ' ▼'}
                                </span>
                              </button>
                            </td>
                            <td>{qu.createdAt ? new Date(qu.createdAt).toLocaleDateString('en-IN') : '—'}</td>
                            <td className={expired ? 'cd-date-muted' : soon ? 'cd-date-amber' : ''}>
                              {exp ? exp.toLocaleDateString('en-IN') : '—'}
                            </td>
                            <td>
                              <Badge variant={qu.status === 'accepted' ? 'success' : 'neutral'}>{qu.status}</Badge>
                            </td>
                            <td>
                              <div className="cd-row-actions">
                                <Button type="button" size="sm" variant="secondary" onClick={() => goSales({ tab: 'orders', customerId: customerId! })}>
                                  View
                                </Button>
                                {canConvertQuotation ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={!p.isActive || convertingQuotationId === qu._id}
                                    title={!p.isActive ? 'Reactivate this customer to convert quotations.' : undefined}
                                    onClick={async () => {
                                      if (!branchId) return;
                                      setConvertingQuotationId(qu._id);
                                      setError(null);
                                      try {
                                        const { order } = await salesService.convertQuotation(qu._id, branchId);
                                        if (!order) {
                                          setError(
                                            'No order was returned after conversion. If this was already converted, open it from History.'
                                          );
                                          return;
                                        }
                                        const oid = entityId(order);
                                        const sp =
                                          idStr((order as { salesPointId?: unknown }).salesPointId) ||
                                          (typeof qu.salesPointId === 'string' ? qu.salesPointId : '');
                                        goSales({
                                          tab: 'orders',
                                          customerId: customerId!,
                                          ...(sp ? { salesPointId: sp } : {}),
                                          posLoadOrderId: oid,
                                        });
                                      } catch (e: unknown) {
                                        setError(extractErrorMessage(e, 'Convert failed'));
                                      } finally {
                                        setConvertingQuotationId(null);
                                      }
                                    }}
                                  >
                                    {convertingQuotationId === qu._id ? 'Converting…' : 'Convert to order'}
                                  </Button>
                                ) : null}
                                {qu.status !== 'converted' ? (
                                  <>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => goSales({ tab: 'orders', customerId: customerId! })}
                                    >
                                      Resend
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      disabled={!p.isActive}
                                      title={!p.isActive ? 'Reactivate this customer to duplicate into a new order.' : undefined}
                                      onClick={async () => {
                                        if (!branchId) return;
                                        try {
                                          const sps = await salesService.listSalesPoints(branchId);
                                          const sp0 = sps[0] as { _id?: string } | undefined;
                                          const spId = sp0?._id ? String(sp0._id) : '';
                                          if (!spId) throw new Error('No sales point');
                                          await salesService.createOrder(
                                            {
                                              mode: 'b2b',
                                              salesPointId: spId,
                                              customerId: customerId!,
                                              lines: mapQuotationLinesForCreateApi(qu.lines as SalesQuotationLine[]),
                                              discountAmount: qu.discountAmount > 0 ? qu.discountAmount : undefined,
                                            },
                                            branchId
                                          );
                                          goSales({ tab: 'orders', customerId: customerId! });
                                        } catch (e: unknown) {
                                          setError(extractErrorMessage(e, 'Duplicate failed'));
                                        }
                                      }}
                                    >
                                      Duplicate
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                          {expandedQuotationId === qu._id ? (
                            <tr className="cd-quot-lines-row">
                              <td colSpan={7}>
                                <div className="cd-quot-lines">
                                  <table className="cd-table cd-table--nested">
                                    <thead>
                                      <tr>
                                        <th>Product</th>
                                        <th>Qty</th>
                                        <th>List / unit</th>
                                        <th>Line total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(qu.lines || []).map((ln, li) => {
                                        const l = ln as SalesQuotationLine;
                                        const qn = Number(l.quantity ?? 0);
                                        const taxableLine = Number(l.lineTotal ?? 0);
                                        const eff =
                                          qn > 0
                                            ? Math.round((taxableLine / qn) * 10000) / 10000
                                            : l.unitPrice;
                                        const lineGross = quotationLineGrossInr(l);
                                        return (
                                          <tr key={`${qu._id}-ln-${li}`}>
                                            <td>
                                              <div style={{ fontWeight: 600 }}>{l.variantName || 'Item'}</div>
                                              <div className="cd-mono" style={{ fontSize: 12, color: '#64748b' }}>
                                                {l.variantCode || '—'}
                                              </div>
                                              <SalesLineMeta
                                                line={
                                                  {
                                                    ...l,
                                                    posListUnitPrice: l.unitPrice,
                                                    unitPrice: eff,
                                                    posGstInclusive:
                                                      l.priceIncludesGst === false ? false : undefined,
                                                    posGstRatePercent: l.taxRatePercent,
                                                    posLineDiscountAmount: l.discountAmount,
                                                    posLineNotes: l.lineNotes,
                                                    posHsn: l.hsn,
                                                  } as Record<string, unknown>
                                                }
                                              />
                                            </td>
                                            <td>{l.quantity}</td>
                                            <td>{formatInr(l.unitPrice)}</td>
                                            <td>{formatInr(lineGross)}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'returns' && (
            <div className="cd-panel">
              <div className="cd-kpis" style={{ marginBottom: 16 }}>
                <div className="cd-kpi">
                  <label>Total returns</label>
                  <strong>{(data.returns || []).length}</strong>
                  <em>{s.returnRatePct}% return rate</em>
                </div>
                <div className="cd-kpi">
                  <label>Amount refunded (est.)</label>
                  <strong>{formatInr(s.totalRefundsIssued)}</strong>
                </div>
              </div>
              {repeatPattern ? <div className="cd-banner-warn">{repeatPattern}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Returns</h3>
                <Button type="button" variant="primary" onClick={() => goSales({ tab: 'returns', customerId: customerId! })}>
                  New return
                </Button>
              </div>
              <div className="cd-table-wrap">
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th>Return ID</th>
                      <th>Order</th>
                      <th>Item</th>
                      <th>Reason</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.returns || []).length === 0 ? (
                      <tr>
                        <td colSpan={6}>No returns.</td>
                      </tr>
                    ) : (
                      (data.returns || []).map((r) => {
                        const ret = r as {
                          _id?: string;
                          returnNumber?: string;
                          originalOrderId?: string;
                          status?: string;
                          lines?: Array<{ reason?: string; quantity?: number; variantName?: string }>;
                        };
                        const desc = (ret.lines || []).map((l) => `${l.variantName || 'Item'} ×${l.quantity || 0}`).join('; ');
                        const reasons = [...new Set((ret.lines || []).map((l) => l.reason).filter(Boolean))].join('; ');
                        return (
                          <tr key={String(ret._id)}>
                            <td className="cd-mono">{ret.returnNumber}</td>
                            <td className="cd-mono">{String(ret.originalOrderId || '').slice(-8)}</td>
                            <td>{desc || '—'}</td>
                            <td>{reasons || '—'}</td>
                            <td style={{ color: '#dc2626' }}>—</td>
                            <td>
                              <Badge variant="neutral">{ret.status}</Badge>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="cd-grid-2">
              <div className="cd-panel">
                <h3>Notes</h3>
                <div style={{ marginBottom: 12 }}>
                  <Textarea
                    rows={3}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Add a note for your team…"
                  />
                  <Button type="button" variant="primary" style={{ marginTop: 8 }} onClick={() => void addNote()} disabled={noteAdding}>
                    Add note
                  </Button>
                </div>
                <ul className="cd-timeline">
                  {(p.teamNotes || []).map((n) => (
                    <li key={n._id} style={{ gridTemplateColumns: '1fr' }}>
                      <div>
                        {editingNoteId === n._id ? (
                          <>
                            <Textarea rows={3} value={editingNoteText} onChange={(e) => setEditingNoteText(e.target.value)} />
                            <div className="cd-form-actions">
                              <Button type="button" size="sm" variant="primary" onClick={() => void saveNoteEdit()}>
                                Save
                              </Button>
                              <Button type="button" size="sm" variant="secondary" onClick={() => setEditingNoteId(null)}>
                                Cancel
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="cd-tl-title">{n.text}</div>
                            <div className="cd-tl-meta">
                              {noteAuthorName(n)} · {new Date(n.createdAt).toLocaleString('en-IN')}
                            </div>
                            {user &&
                              (() => {
                                const c = n.createdBy;
                                const aid =
                                  c && typeof c === 'object' && c !== null && '_id' in c
                                    ? String((c as { _id?: string })._id)
                                    : String(c || '');
                                return aid === user.id;
                              })() ? (
                              <div className="cd-form-actions">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => {
                                    setEditingNoteId(n._id);
                                    setEditingNoteText(n.text);
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button type="button" size="sm" variant="danger" onClick={() => void deleteNote(n._id)}>
                                  Delete
                                </Button>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="cd-panel">
                <h3>Activity log</h3>
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 0 }}>Immutable record of changes and commerce events.</p>
                <ul className="cd-audit-list">
                  {(data.auditLog || []).map((ev, i) => (
                    <li key={`${ev.ts}-${i}`}>
                      <span className={auditDot(ev.type)} />
                      <div>
                        <div>{ev.title}</div>
                        <div className="cd-tl-meta">
                          {new Date(ev.ts).toLocaleString('en-IN')} · {ev.actor} · {ev.channel}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="cd-grid-2">
              <div className="cd-panel">
                <h3>Basic information</h3>
                <Input label="Full name *" value={profileBasic.name} onChange={(e) => setProfileBasic((x) => ({ ...x, name: e.target.value }))} />
                <Input label="Email" value={profileBasic.email} onChange={(e) => setProfileBasic((x) => ({ ...x, email: e.target.value }))} />
                <Input label="Phone" value={profileBasic.phone} onChange={(e) => setProfileBasic((x) => ({ ...x, phone: e.target.value }))} />
                <Input
                  label="Company name"
                  value={profileBasic.companyName}
                  onChange={(e) => setProfileBasic((x) => ({ ...x, companyName: e.target.value }))}
                />
                <Input label="GST number" value={profileBasic.gstNumber} onChange={(e) => setProfileBasic((x) => ({ ...x, gstNumber: e.target.value }))} />
                <Textarea
                  label="Billing address"
                  rows={2}
                  value={profileBasic.billingAddress}
                  onChange={(e) => setProfileBasic((x) => ({ ...x, billingAddress: e.target.value }))}
                />
                <Textarea
                  label="Shipping address"
                  rows={2}
                  value={profileBasic.shippingAddress}
                  onChange={(e) => setProfileBasic((x) => ({ ...x, shippingAddress: e.target.value }))}
                />
                <Input label="State / UT" value={profileBasic.stateUt} onChange={(e) => setProfileBasic((x) => ({ ...x, stateUt: e.target.value }))} />
                <Select
                  label="Payment terms"
                  value={profileBasic.paymentTerms}
                  onChange={(e) => setProfileBasic((x) => ({ ...x, paymentTerms: e.target.value }))}
                  options={[
                    { value: '', label: '—' },
                    { value: 'immediate', label: 'Immediate' },
                    { value: 'net15', label: 'Net 15' },
                    { value: 'net30', label: 'Net 30' },
                    { value: 'net45', label: 'Net 45' },
                    { value: 'net60', label: 'Net 60' },
                  ]}
                />
                <div className="cd-form-actions">
                  <Button type="button" variant="primary" onClick={() => void saveProfile('basic')} disabled={profileSaving}>
                    Save changes
                  </Button>
                  <Button type="button" variant="secondary" onClick={cancelProfile}>
                    Cancel
                  </Button>
                </div>
              </div>
              <div className="cd-panel">
                <h3>Preferences &amp; settings</h3>
                <Select
                  label="Preferred contact method"
                  value={profilePrefs.preferredContactMethod}
                  onChange={(e) => setProfilePrefs((x) => ({ ...x, preferredContactMethod: e.target.value }))}
                  options={[
                    { value: '', label: '—' },
                    { value: 'whatsapp', label: 'WhatsApp' },
                    { value: 'phone', label: 'Phone' },
                    { value: 'email', label: 'Email' },
                  ]}
                />
                <Input
                  label="Default discount %"
                  type="number"
                  value={profilePrefs.defaultDiscountPercent}
                  onChange={(e) => setProfilePrefs((x) => ({ ...x, defaultDiscountPercent: e.target.value }))}
                />
                <Input
                  label="Credit limit (₹)"
                  type="number"
                  value={profilePrefs.creditLimit}
                  onChange={(e) => setProfilePrefs((x) => ({ ...x, creditLimit: e.target.value }))}
                />
                <Textarea
                  label="Internal notes"
                  rows={4}
                  value={profilePrefs.notes}
                  onChange={(e) => setProfilePrefs((x) => ({ ...x, notes: e.target.value }))}
                />
                <div className="cd-form-actions">
                  <Button type="button" variant="primary" onClick={() => void saveProfile('prefs')} disabled={profileSaving}>
                    Save changes
                  </Button>
                  <Button type="button" variant="secondary" onClick={cancelProfile}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <Modal
        isOpen={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        title="Record payment"
        size="lg"
      >
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
          {payModalCtx?.customerName ? <>Customer: <strong>{payModalCtx.customerName}</strong></> : null}
        </p>
        <p style={{ fontSize: 13, color: '#6b7280' }}>
          For on-account POS sales, select the order and confirm to mark payment received — this clears the amount from outstanding
          balance. Other orders still use reconciliation notes until workflows are extended.
        </p>
        <Input label="Search unpaid orders" value={payOrderSearch} onChange={(e) => setPayOrderSearch(e.target.value)} placeholder="Order number" />
        <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid #eee', borderRadius: 8, marginBottom: 12 }}>
          {filteredPayOrders.map((o) => {
            const ord = o as { _id?: string; orderNumber?: string; total?: number };
            const sel = payModalCtx?.orderId === String(ord._id);
            return (
              <button
                key={String(ord._id)}
                type="button"
                onClick={() => {
                  setPayModalCtx((c) => ({ ...c, orderId: String(ord._id), amount: Number(ord.total || 0) }));
                  setPayAmount(String(ord.total ?? ''));
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  border: 'none',
                  borderBottom: '1px solid #f3f4f6',
                  background: sel ? '#eff6ff' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <span className="cd-mono">{ord.orderNumber}</span> · {formatInr(Number(ord.total || 0))}
              </button>
            );
          })}
          {filteredPayOrders.length === 0 ? <div style={{ padding: 12, color: '#9ca3af' }}>No unpaid orders</div> : null}
        </div>
        <Input label="Amount (₹)" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
        <Select
          label="Payment method"
          value={payMethod}
          onChange={(e) => setPayMethod(e.target.value)}
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'upi', label: 'UPI' },
            { value: 'card', label: 'Card' },
            { value: 'bank', label: 'Bank transfer' },
          ]}
        />
        <div className="cd-form-actions">
          <Button type="button" variant="secondary" onClick={() => setPayModalOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={payRecording}
            onClick={() => {
              void (async () => {
                const oid = payModalCtx?.orderId;
                if (!branchId || !oid) {
                  window.alert('Select an order to settle.');
                  return;
                }
                const ord = unpaidOrders.find((o) => String((o as { _id?: string })._id) === oid) as
                  | { status?: string; paymentPending?: boolean }
                  | undefined;
                const st = String(ord?.status || '');
                const pend = Boolean(ord?.paymentPending);
                if (st === 'completed' && pend) {
                  const amt = parseFloat(payAmount) || 0;
                  if (amt <= 0) {
                    window.alert('Enter a payment amount greater than zero.');
                    return;
                  }
                  setPayRecording(true);
                  setError(null);
                  try {
                    const updated = await salesService.collectOrderPayment(
                      oid,
                      { amount: amt, methodCode: payMethod },
                      branchId
                    );
                    await load();
                    setPayModalOpen(false);
                    const stillDue = Boolean((updated as { paymentPending?: boolean })?.paymentPending);
                    window.alert(
                      stillDue
                        ? `Payment recorded — ${formatInr(amt)} via ${payMethod}. Balance still due on this order.`
                        : `Payment recorded — ${formatInr(amt)} via ${payMethod}. Order fully settled.`
                    );
                  } catch (e: unknown) {
                    setError(extractErrorMessage(e, 'Could not record payment'));
                  } finally {
                    setPayRecording(false);
                  }
                  return;
                }
                window.alert(
                  `Recorded ${formatInr(parseFloat(payAmount) || 0)} via ${payMethod} (reference only).` +
                    ' For open orders, complete or collect payment from the Orders workspace.'
                );
                setPayModalOpen(false);
              })();
            }}
          >
            {payRecording ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </Modal>
    </div>
  );
};
