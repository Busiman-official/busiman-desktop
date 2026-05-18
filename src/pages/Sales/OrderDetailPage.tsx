/**
 * Order detail — opened from History row or /sales/orders/:orderId
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Textarea } from '@/shared/components/ui';
import { QuotationPdfViewerScreen } from '@/features/sales/components/panels/QuotationPdfViewerScreen';
import type { QuotationShareLinkState } from '@/features/sales/components/panels/QuotationShareModal';
import { extractErrorMessage } from '@/utils/error';
import { Branch } from '@/types';
import { useSalesBranchId } from '@/features/sales/hooks/useSalesBranchId';
import { docId, entityId } from '@/features/sales/utils/ids';
import {
  salesService,
  type CustomerDetailPayload,
  type SalesQuotation,
} from '@/services/sales.service';
import {
  mapOrderLinesForCreateApi,
  orderLineGrossWithGst,
} from '@/features/sales/utils/mapLinesForCreateOrder';
import { orderSaleTimestampMs } from '@/utils/commercialDates';
import { SalesLineMeta } from '@/features/sales/components/shared/SalesLineMeta';
import { OrderPaymentsBreakdown } from '@/features/sales/components/shared/OrderPaymentsBreakdown';
import {
  orderCollectedAmount,
  resolveOrderPaymentSummary,
  type SalesOrderPaymentLine,
} from '@/features/sales/utils/orderPayments';
import './OrderDetailPage.css';

type OrderLine = {
  variantId?: unknown;
  variantCode?: string;
  variantName?: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
  posListUnitPrice?: number;
  posLineDiscountAmount?: number;
  posGstRatePercent?: number;
  posLineNotes?: string;
  posHsn?: string;
  posGstInclusive?: boolean;
};

type OrderDoc = {
  _id?: string;
  orderNumber?: string;
  status?: string;
  mode?: string;
  /** When true with completed, sale is on account (matches history “On account”). */
  paymentPending?: boolean;
  /** Remaining on-account amount; when missing, treat as full order total. */
  paymentPendingAmount?: number;
  /** POS split tender (method + amount + optional proof). */
  payments?: SalesOrderPaymentLine[];
  /** Populated from convert flow; holds quote # after getOrder. */
  sourceQuotationId?: { quoteNumber?: string; status?: string } | string;
  total?: number;
  subtotal?: number;
  discountAmount?: number;
  taxAmount?: number;
  customerId?: unknown;
  salesPointId?: unknown;
  branchId?: unknown;
  createdBy?: unknown;
  lines?: OrderLine[];
  /** Business sale / invoice date (UTC calendar day from API). */
  invoiceDate?: string;
  createdAt?: string;
  updatedAt?: string;
  notes?: string;
};

function formatInr(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function initials(name: string): string {
  const p = name.split(/\s+/).filter(Boolean);
  if (p.length === 0) return '?';
  return p
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() || '')
    .join('');
}

function idStr(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && '_id' in (v as object)) return String((v as { _id?: unknown })._id);
  return String(v);
}

/** Sticky actions on the right of Sales module header */
export function OrderDetailHeaderActions({ orderId }: { orderId: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const branchId = useSalesBranchId();
  const [orderCustomerId, setOrderCustomerId] = useState<string | null>(null);
  const [orderSnap, setOrderSnap] = useState<OrderDoc | null>(null);
  const [convertBusy, setConvertBusy] = useState(false);
  const [quotationViewer, setQuotationViewer] = useState<{
    quotation: SalesQuotation;
    customerName: string;
    customerPhone?: string;
    shareLink: QuotationShareLinkState;
    pdfBlobUrl: string;
    pdfBlob: Blob;
  } | null>(null);
  const [printQuotationBusy, setPrintQuotationBusy] = useState(false);
  const quotationPdfUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!branchId || !orderId) {
      setOrderCustomerId(null);
      setOrderSnap(null);
      return;
    }
    let cancelled = false;
    salesService
      .getOrder(orderId, branchId)
      .then((o) => {
        if (cancelled) return;
        const od = o as OrderDoc;
        setOrderSnap(od);
        const cust = od.customerId;
        setOrderCustomerId(cust ? idStr(cust) : null);
      })
      .catch(() => {
        if (!cancelled) {
          setOrderCustomerId(null);
          setOrderSnap(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, branchId]);

  useEffect(() => {
    return () => {
      if (quotationPdfUrlRef.current) {
        URL.revokeObjectURL(quotationPdfUrlRef.current);
        quotationPdfUrlRef.current = null;
      }
    };
  }, []);

  const closeQuotationPdfViewer = useCallback(() => {
    setQuotationViewer(null);
    if (quotationPdfUrlRef.current) {
      URL.revokeObjectURL(quotationPdfUrlRef.current);
      quotationPdfUrlRef.current = null;
    }
  }, []);

  const openPrintQuotationViewer = useCallback(async () => {
    if (!branchId || !orderId) return;
    setPrintQuotationBusy(true);
    try {
      const list = await salesService.listOrderQuotations(orderId, branchId);
      const sorted = [...(list || [])].sort(
        (a, b) =>
          new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime()
      );
      const qOpen = sorted.find(
        (x) =>
          x.status !== 'converted' &&
          x.status !== 'cancelled' &&
          x.status !== 'rejected' &&
          x.status !== 'expired'
      );

      let blob: Blob;
      let quotation: SalesQuotation;
      let shareLink: QuotationShareLinkState = { loading: false, error: null, data: null };

      if (qOpen?._id) {
        quotation = qOpen;
        blob = await salesService.downloadQuotationPdfBlob(qOpen._id, branchId);
        try {
          const data = await salesService.getQuotationShareLink(qOpen._id, branchId);
          shareLink = { loading: false, error: null, data };
        } catch {
          shareLink = { loading: false, error: null, data: null };
        }
      } else {
        if (!orderSnap) {
          window.alert('Order could not be loaded. Try again in a moment.');
          return;
        }
        blob = await salesService.previewQuotationPdfBlob({ orderId }, branchId);
        const o = orderSnap;
        quotation = {
          _id: 'preview',
          quoteNumber: String(o.orderNumber ?? 'Draft'),
          sourceOrderId: orderId,
          customerId: orderCustomerId ?? undefined,
          salesPointId: idStr(o.salesPointId) || '',
          currency: 'INR',
          status: 'draft',
          lines: [],
          subtotal: Number(o.subtotal ?? 0),
          discountAmount: Number(o.discountAmount ?? 0),
          taxAmount: Number(o.taxAmount ?? 0),
          deliveryAmount: 0,
          total: Number(o.total ?? 0),
        };
      }

      const cid =
        (qOpen?.customerId && String(qOpen.customerId)) ||
        orderCustomerId ||
        (orderSnap?.customerId ? idStr(orderSnap.customerId) : '');
      let customerName = 'Customer';
      let customerPhone: string | undefined;
      if (cid && branchId) {
        try {
          const c = await salesService.getCustomer(cid, branchId);
          customerName = c.name?.trim() || customerName;
          customerPhone = c.phone?.trim() || undefined;
        } catch {
          /* keep defaults */
        }
      }

      const url = URL.createObjectURL(blob);
      if (quotationPdfUrlRef.current) {
        URL.revokeObjectURL(quotationPdfUrlRef.current);
      }
      quotationPdfUrlRef.current = url;

      setQuotationViewer({
        quotation,
        customerName,
        customerPhone,
        shareLink,
        pdfBlobUrl: url,
        pdfBlob: blob,
      });
    } catch (e: unknown) {
      window.alert(extractErrorMessage(e, 'Could not open quotation PDF'));
    } finally {
      setPrintQuotationBusy(false);
    }
  }, [branchId, orderId, orderCustomerId, orderSnap]);

  const isQuotationDraft = orderSnap?.mode === 'b2b' && orderSnap?.status === 'draft';
  const isPendingPayment =
    orderSnap?.status === 'completed' && Boolean((orderSnap as OrderDoc).paymentPending);

  const printReceipt = () => window.print();


  const goToReturnsForOrder = () => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', 'returns');
    p.set('returnOrderId', orderId);
    navigate({ pathname: '/sales', search: `?${p.toString()}` });
  };

  const convertQuotationToOrder = async () => {
    if (!branchId || !orderId) return;
    setConvertBusy(true);
    try {
      const list = await salesService.listOrderQuotations(orderId, branchId);
      const sorted = [...(list || [])].sort(
        (a, b) =>
          new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime()
      );
      const q = sorted.find(
        (x) =>
          x.status !== 'converted' &&
          x.status !== 'cancelled' &&
          x.status !== 'rejected' &&
          x.status !== 'expired'
      );
      if (!q?._id) {
        const o = (await salesService.getOrder(orderId, branchId)) as OrderDoc & {
          lines?: OrderLine[];
          discountAmount?: number;
        };
        if (String(o.mode) !== 'b2b' || String(o.status) !== 'draft') {
          window.alert('No open quotation linked to this order. Create a quotation from the order first.');
          return;
        }
        const lines = mapOrderLinesForCreateApi(o.lines || []);
        if (!lines.length) {
          window.alert('This draft has no line items to convert.');
          return;
        }
        const sp = idStr(o.salesPointId);
        const cust =
          (o.customerId
            ? String(
              typeof o.customerId === 'object' && (o.customerId as { _id?: unknown })._id
                ? (o.customerId as { _id?: unknown })._id
                : o.customerId
            )
            : '') || orderCustomerId;
        if (!cust) {
          window.alert('Assign a customer on this draft before converting.');
          return;
        }
        const disc = Number(o.discountAmount ?? 0);
        const { order } = await salesService.createOrder(
          {
            mode: 'b2b',
            salesPointId: sp,
            customerId: cust,
            lines,
            ...(disc > 0 ? { discountAmount: disc } : {}),
          },
          branchId
        );
        try {
          await salesService.deleteDraftOrder(orderId, branchId);
        } catch {
          /* new order already created */
        }
        const cre = order as { customerId?: unknown; salesPointId?: unknown } | null | undefined;
        const oid = entityId(order);
        const custOut = idStr(cre?.customerId) || cust;
        const spOut = idStr(cre?.salesPointId) || sp;
        const p = new URLSearchParams(searchParams);
        p.set('tab', 'orders');
        if (custOut) p.set('customerId', custOut);
        if (spOut) p.set('salesPointId', spOut);
        if (oid) p.set('posLoadOrderId', oid);
        navigate({ pathname: '/sales', search: `?${p.toString()}` });
        return;
      }
      const { order } = await salesService.convertQuotation(q._id, branchId);
      if (!order) {
        window.alert(
          'No order was returned after conversion. If this quotation was already converted, open the order from History.'
        );
        return;
      }
      const ord = order as { customerId?: unknown; salesPointId?: unknown };
      const oid = entityId(order);
      const p = new URLSearchParams(searchParams);
      p.set('tab', 'orders');
      const cid = idStr(ord.customerId) || orderCustomerId;
      if (cid) p.set('customerId', cid);
      const sp = idStr(ord.salesPointId) || (orderSnap ? idStr(orderSnap.salesPointId) : '');
      if (sp) p.set('salesPointId', sp);
      if (oid) p.set('posLoadOrderId', oid);
      navigate({ pathname: '/sales', search: `?${p.toString()}` });
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Convert failed');
    } finally {
      setConvertBusy(false);
    }
  };

  const newOrder = () => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', 'orders');
    if (orderCustomerId) p.set('customerId', orderCustomerId);
    else p.delete('customerId');
    navigate({ pathname: '/sales', search: `?${p.toString()}` });
  };

  return (
    <>
      {isQuotationDraft && (
        <Button
          type="button"
          variant="secondary"
          disabled={printQuotationBusy}
          onClick={() => void openPrintQuotationViewer()}
        >
          {printQuotationBusy ? 'Opening…' : 'Print Quotation'}
        </Button>
      )}
      {!isQuotationDraft && (
        <Button type="button" variant="secondary" onClick={printReceipt}>
          Print Receipt
        </Button>
      )}

      {isQuotationDraft ? (
        <Button
          type="button"
          variant="primary"
          disabled={convertBusy}
          onClick={() => void convertQuotationToOrder()}
        >
          {convertBusy ? 'Converting…' : 'Convert to order'}
        </Button>
      ) : isPendingPayment ? (
        <Button type="button" variant="secondary" className="od-header-btn-refund" onClick={goToReturnsForOrder}>
          Return
        </Button>
      ) : (
        <Button type="button" variant="secondary" className="od-header-btn-refund" onClick={goToReturnsForOrder}>
          Refund
        </Button>
      )}
      {isQuotationDraft ? null : (
        <Button type="button" variant="primary" onClick={newOrder}>
          New order
        </Button>
      )}

      {quotationViewer
        ? createPortal(
            <QuotationPdfViewerScreen
              quotation={quotationViewer.quotation}
              customerName={quotationViewer.customerName}
              customerPhone={quotationViewer.customerPhone}
              shareLink={quotationViewer.shareLink}
              pdfBlobUrl={quotationViewer.pdfBlobUrl}
              pdfBlob={quotationViewer.pdfBlob}
              onBack={closeQuotationPdfViewer}
            />,
            document.body
          )
        : null}
    </>
  );
}

interface OrderDetailPageProps {
  branches: Branch[];
  salesPoints: Record<string, unknown>[];
}

export const OrderDetailPage: React.FC<OrderDetailPageProps> = ({ branches, salesPoints }) => {
  /** Parent route is `/sales/*` — :orderId is not in useParams; resolve from path. */
  const orderMatch = useMatch({ path: '/sales/orders/:orderId', end: true });
  const orderId = orderMatch?.params.orderId ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const branchId = useSalesBranchId();
  const navigate = useNavigate();
  const printOnceRef = useRef(false);

  const [order, setOrder] = useState<OrderDoc | null>(null);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetailPayload | null>(null);
  const [quotations, setQuotations] = useState<SalesQuotation[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<'activity' | 'notes' | 'documents'>('activity');
  const [noteDraft, setNoteDraft] = useState('');
  const [localNotes, setLocalNotes] = useState<Array<{ id: string; text: string; author: string; at: string }>>([]);

  const load = useCallback(async () => {
    if (!orderId) {
      setLoading(false);
      setLoadErr('Invalid order link.');
      setOrder(null);
      setCustomerDetail(null);
      setQuotations([]);
      return;
    }
    setLoadErr(null);
    setLoading(true);
    setOrder(null);
    setCustomerDetail(null);
    setQuotations([]);
    try {
      const o = (await salesService.getOrder(orderId, branchId)) as OrderDoc;
      setOrder(o);
      const cid = idStr(o.customerId);
      if (cid) {
        salesService
          .customerDetail(cid, branchId)
          .then(setCustomerDetail)
          .catch(() => setCustomerDetail(null));
      } else {
        setCustomerDetail(null);
      }
      salesService
        .listOrderQuotations(orderId, branchId)
        .then(setQuotations)
        .catch(() => setQuotations([]));
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load order');
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [orderId, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    printOnceRef.current = false;
  }, [orderId]);

  useEffect(() => {
    if (loading || !order || searchParams.get('print') !== '1' || printOnceRef.current) return;
    printOnceRef.current = true;
    const t = window.setTimeout(() => {
      window.print();
      const p = new URLSearchParams(searchParams);
      p.delete('print');
      setSearchParams(p, { replace: true });
    }, 450);
    return () => clearTimeout(t);
  }, [loading, order, orderId, searchParams, setSearchParams]);

  useEffect(() => {
    const VALID_CTABS = new Set([
      'overview',
      'orders',
      'payments',
      'quotations',
      'returns',
      'notes',
      'profile',
    ]);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      const returnCustomer = searchParams.get('returnCustomer');
      const rawCtab = searchParams.get('returnCtab') || 'overview';
      const returnCtab = VALID_CTABS.has(rawCtab) ? rawCtab : 'overview';
      if (returnCustomer && /^[a-f0-9]{24}$/i.test(returnCustomer)) {
        const p = new URLSearchParams();
        const bid = searchParams.get('branchId');
        if (bid) p.set('branchId', bid);
        p.set('tab', 'customers');
        p.set('ctab', returnCtab);
        navigate(`/sales/customers/${returnCustomer}?${p.toString()}`);
        return;
      }
      const p = new URLSearchParams(searchParams);
      p.set('tab', 'history');
      navigate({ pathname: '/sales', search: `?${p.toString()}` });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, searchParams]);

  const spName = useMemo(() => {
    const sid = idStr(order?.salesPointId);
    if (!sid) return '—';
    const sp = salesPoints.find((s) => docId(s as { _id?: string; id?: string }) === sid);
    return sp ? String((sp as { name?: string }).name || sid) : sid;
  }, [order?.salesPointId, salesPoints]);

  const branchName = useMemo(() => {
    const bid = idStr(order?.branchId);
    if (!bid) return '—';
    const b = branches.find((x) => x.id === bid);
    return b ? `${b.name} (${b.code})` : bid.slice(-8);
  }, [order?.branchId, branches]);

  const sourceQuotationLabel = useMemo(() => {
    const raw = (order as OrderDoc | null)?.sourceQuotationId;
    if (!raw) return '';
    if (typeof raw === 'object' && raw !== null && 'quoteNumber' in raw) {
      return String((raw as { quoteNumber?: string }).quoteNumber || '').trim();
    }
    return '';
  }, [order]);

  const deliveryAmount = 0;
  const paymentPendingFlag = Boolean(order?.paymentPending);
  const amountOwingOnAccount =
    paymentPendingFlag && order?.status === 'completed'
      ? (() => {
        const pa = (order as OrderDoc).paymentPendingAmount;
        if (pa != null && Number.isFinite(Number(pa))) return Number(pa);
        return Number(order?.total ?? 0);
      })()
      : 0;
  const paymentPaid = order?.status === 'completed' && !paymentPendingFlag;
  const collectedAtSale = order ? orderCollectedAmount(order as OrderDoc) : 0;
  const paymentLabel =
    order?.status === 'cancelled'
      ? 'Cancelled'
      : order?.status === 'completed' && paymentPendingFlag
        ? collectedAtSale > 0
          ? 'Partially paid'
          : 'On account'
        : paymentPaid
          ? 'Paid'
          : 'Unpaid';
  const paymentTone =
    paymentPaid ? 'green' : order?.status === 'cancelled' ? 'red' : paymentPendingFlag ? 'amber' : 'red';

  const paymentSummary = useMemo(
    () =>
      order
        ? resolveOrderPaymentSummary(order as OrderDoc)
        : { status: 'unpaid' as const, summary: '—', primaryMethod: null, payments: [] },
    [order]
  );

  const lineItems = order?.lines || [];
  const lineCount = lineItems.length;
  const qtySum = lineItems.reduce((a, l) => a + Number(l.quantity ?? 0), 0);

  const subtotal = Number(order?.subtotal ?? 0);
  const discount = Number(order?.discountAmount ?? 0);
  const tax = Number(order?.taxAmount ?? 0);
  const total = Number(order?.total ?? 0);

  const created = order?.createdAt ? new Date(order.createdAt) : null;
  const updated = order?.updatedAt ? new Date(order.updatedAt) : null;
  const saleMs = order ? orderSaleTimestampMs(order as OrderDoc) : 0;
  const saleInstant = saleMs > 0 ? new Date(saleMs) : null;
  const durationMs =
    saleInstant && updated && order?.status === 'completed'
      ? Math.max(0, updated.getTime() - saleInstant.getTime())
      : null;
  const durationLabel =
    durationMs == null
      ? '—'
      : durationMs < 60000
        ? `${Math.round(durationMs / 1000)}s`
        : durationMs < 3600000
          ? `${Math.round(durationMs / 60000)} min`
          : `${Math.round(durationMs / 3600000)}h ${Math.round((durationMs % 3600000) / 60000)}m`;

  const cashierLabel = useMemo(() => {
    const u = idStr(order?.createdBy);
    return u ? `User …${u.slice(-6)}` : '—';
  }, [order?.createdBy]);

  const timeline = useMemo(() => {
    if (!order) return [];
    const rows: Array<{ key: string; dot: 'grey' | 'amber' | 'green' | 'blue'; title: string; desc: string; ts: string }> =
      [];
    const ca = order.createdAt ? new Date(order.createdAt).toLocaleString() : '';
    const saleTs =
      saleMs > 0
        ? new Date(saleMs).toLocaleDateString(undefined, { dateStyle: 'long' })
        : ca;
    rows.push({
      key: 'sale',
      dot: 'green',
      title: 'Sale (invoice) date',
      desc: 'Business date for this order; used as the date of sale in history and reporting.',
      ts: saleTs,
    });
    rows.push({
      key: 'entry',
      dot: 'grey',
      title: 'Entered in system',
      desc: 'When this order was recorded in the application.',
      ts: ca,
    });
    if (order.status && order.status !== 'draft') {
      rows.push({
        key: 's',
        dot: 'amber',
        title: `Status: ${order.status}`,
        desc: 'Order lifecycle update.',
        ts: order.updatedAt ? new Date(order.updatedAt).toLocaleString() : ca,
      });
    }
    if (order.status === 'completed' && !(order as OrderDoc).paymentPending) {
      rows.push({
        key: 'p',
        dot: 'green',
        title: 'Payment received',
        desc: 'Marked complete — payment recorded for this order.',
        ts: order.updatedAt ? new Date(order.updatedAt).toLocaleString() : ca,
      });
    }
    if (order.status === 'completed' && (order as OrderDoc).paymentPending) {
      rows.push({
        key: 'oa',
        dot: 'amber',
        title: 'Payment on account',
        desc: 'Sale fulfilled — amount is on the customer outstanding balance until settled.',
        ts: order.updatedAt ? new Date(order.updatedAt).toLocaleString() : ca,
      });
    }
    rows.push({
      key: 'i',
      dot: 'blue',
      title: 'System record',
      desc: `Mode ${String(order.mode || '').toUpperCase()} · ${lineCount} line(s).`,
      ts: ca,
    });
    return rows;
  }, [order, lineCount, saleMs]);

  const profile = customerDetail?.profile;
  const summary = customerDetail?.summary;
  const relatedOrders = useMemo(() => {
    const rows = (customerDetail?.orders || []) as OrderDoc[];
    return rows
      .filter((r) => idStr(r._id) !== orderId)
      .slice(0, 3)
      .map((r) => {
        const sm = orderSaleTimestampMs(r as OrderDoc);
        return {
          id: idStr(r._id),
          num: String(r.orderNumber ?? ''),
          date: sm > 0 ? new Date(sm).toLocaleDateString() : '',
          mode: String(r.mode || ''),
          status: String(r.status || ''),
          totalInclGst: Number(r.total ?? 0),
        };
      });
  }, [customerDetail?.orders, orderId]);

  const customerIdForLink = idStr(order?.customerId);

  const saveNote = () => {
    const t = noteDraft.trim();
    if (!t) return;
    setLocalNotes((prev) => [
      ...prev,
      {
        id: `n-${Date.now()}`,
        text: t,
        author: 'You',
        at: new Date().toLocaleString(),
      },
    ]);
    setNoteDraft('');
  };

  if (loadErr) {
    return (
      <div className="order-detail" style={{ padding: 24 }}>
        <p className="order-detail__muted">{loadErr}</p>
        <Button type="button" variant="secondary" onClick={() => navigate(-1)} style={{ marginTop: 12 }}>
          Back
        </Button>
      </div>
    );
  }

  if (loading || !order) {
    return (
      <div className="order-detail" style={{ padding: 24 }}>
        <p className="order-detail__muted">{loading ? 'Loading…' : 'Unable to load order.'}</p>
      </div>
    );
  }

  return (
    <div className="order-detail">
      {paymentPendingFlag ? (
        <div
          className="order-detail__banner-oa"
          role="status"
          style={{
            padding: '10px 16px',
            background: '#fffbeb',
            borderBottom: '1px solid #fde68a',
            color: '#78350f',
            fontSize: 13,
          }}
        >
          <strong>Payment pending</strong>
          {collectedAtSale > 0
            ? ` — ${formatInr(collectedAtSale)} received · ${formatInr(amountOwingOnAccount)} still on account (order total ${formatInr(total)}).`
            : ` — ${formatInr(amountOwingOnAccount)} on account for this order (order total ${formatInr(total)}).`}
          {' '}Record payment in Customers → Payments.
        </div>
      ) : null}
      {/* <div className="order-detail__summary">
        <div className="order-detail__summary-cell">
          <div className="order-detail__summary-label">Order total (incl. GST)</div>
          <div className="order-detail__summary-value order-detail__summary-value--blue">{formatInr(total)}</div>
          <div className="order-detail__summary-sub">
            {tax > 0 ? `GST included: ${formatInr(tax)}` : 'No GST on this order'}
            {deliveryAmount > 0 ? ` · Delivery ${formatInr(deliveryAmount)}` : ''}
          </div>
        </div>
        <div className="order-detail__summary-cell">
          <div className="order-detail__summary-label">Payment status</div>
          <div
            className={`order-detail__summary-value ${
              paymentTone === 'green'
                ? 'order-detail__summary-value--green'
                : paymentTone === 'amber'
                  ? 'order-detail__summary-value--amber'
                  : 'order-detail__summary-value--red'
            }`}
          >
            {paymentLabel}
          </div>
          <div className="order-detail__summary-sub">
            {order.updatedAt ? new Date(order.updatedAt).toLocaleString() : '—'}
          </div>
        </div>
        <div className="order-detail__summary-cell">
          <div className="order-detail__summary-label">Items</div>
          <div className="order-detail__summary-value">{lineCount} lines</div>
          <div className="order-detail__summary-sub">
            {qtySum} units · Returns 0
          </div>
        </div>
        <div className="order-detail__summary-cell">
          <div className="order-detail__summary-label">Sales point</div>
          <div className="order-detail__summary-value" style={{ fontSize: 16 }}>
            {spName}
          </div>
          <div className="order-detail__summary-sub">{cashierLabel}</div>
        </div>
        {sourceQuotationLabel ? (
          <div className="order-detail__summary-cell">
            <div className="order-detail__summary-label">Source quotation</div>
            <div className="order-detail__summary-value" style={{ fontSize: 15 }}>
              {sourceQuotationLabel}
            </div>
            <div className="order-detail__summary-sub">Linked for checkout, hold, and resume</div>
          </div>
        ) : null}
      </div> */}

      <div className="order-detail__main">
        <div className="order-detail__col order-detail__col--left">
          <div className="order-detail__scroll">
            <div className="order-detail__card">
              <div className="order-detail__card-hd">
                <div>
                  <span className="order-detail__card-title">Order items</span>
                  <span className="order-detail__muted" style={{ marginLeft: 8 }}>
                    {lineCount} items
                  </span>
                </div>
                <Button type="button" variant="secondary" size="sm" disabled>
                  Add item
                </Button>
              </div>
              <table className="order-detail__table">
                <thead>
                  <tr>
                    <th style={{ width: 52 }} />
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Discount</th>
                    <th style={{ textAlign: 'right' }}>Total (incl. GST)</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((ln, idx) => {
                    const lt = Number(ln.lineTotal ?? 0);
                    const lineGross = orderLineGrossWithGst(ln);
                    const qty = Number(ln.quantity ?? 0);
                    const unit = Number(ln.unitPrice ?? 0);
                    const listU =
                      ln.posListUnitPrice != null && Number.isFinite(Number(ln.posListUnitPrice))
                        ? Number(ln.posListUnitPrice)
                        : unit;
                    const explicitDisc = Number(ln.posLineDiscountAmount ?? 0);
                    const lineDisc =
                      explicitDisc > 0 ? explicitDisc : Math.max(0, listU * qty - lt);
                    return (
                      <tr key={`${idx}-${ln.variantCode}`}>
                        <td>
                          <div className="order-detail__thumb" aria-hidden />
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{ln.variantName || 'Item'}</div>
                          <div className="order-detail__sku">{ln.variantCode || '—'}</div>
                          <SalesLineMeta line={ln as Record<string, unknown>} />
                        </td>
                        <td>
                          <span className="order-detail__qty-badge">{qty}</span>
                        </td>
                        <td>{formatInr(unit)}</td>
                        <td style={{ color: lineDisc > 0 ? '#16a34a' : '#94a3b8' }}>
                          {lineDisc > 0 ? `−${formatInr(lineDisc)}` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatInr(lineGross)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="order-detail__totals">
                <div className="order-detail__totals-row">
                  <span>Taxable amount (excl. GST)</span>
                  <span>{formatInr(subtotal)}</span>
                </div>
                <div className="order-detail__totals-row">
                  <span>Delivery charges</span>
                  <span>{formatInr(deliveryAmount)}</span>
                </div>
                <div className="order-detail__totals-row order-detail__totals-row--discount">
                  <span>Discount</span>
                  <span>−{formatInr(discount)}</span>
                </div>
                <div className="order-detail__totals-row">
                  <span>GST</span>
                  <span>{formatInr(tax)}</span>
                </div>
                <div className="order-detail__totals-row order-detail__totals-row--total">
                  <span>Total (incl. GST)</span>
                  <span>{formatInr(total)}</span>
                </div>
              </div>
            </div>

            <div className="order-detail__card">
              <div className="order-detail__tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'activity'}
                  onClick={() => setDetailTab('activity')}
                >
                  Activity timeline
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'notes'}
                  onClick={() => setDetailTab('notes')}
                >
                  Notes
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'documents'}
                  onClick={() => setDetailTab('documents')}
                >
                  Documents
                </button>
              </div>
              {detailTab === 'activity' && (
                <div className="order-detail__tab-panel">
                  <div className="order-detail__timeline">
                    {timeline.map((ev) => (
                      <div key={ev.key} className="order-detail__tl-item">
                        <span className={`order-detail__tl-dot order-detail__tl-dot--${ev.dot}`} />
                        <div className="order-detail__tl-title">{ev.title}</div>
                        <div className="order-detail__tl-desc">{ev.desc}</div>
                        <div className="order-detail__tl-ts">{ev.ts}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detailTab === 'notes' && (
                <div className="order-detail__tab-panel">
                  {order.notes ? (
                    <div className="order-detail__note-card">
                      <div className="order-detail__note-meta">Order notes</div>
                      <div>{order.notes}</div>
                    </div>
                  ) : null}
                  {localNotes.map((n) => (
                    <div key={n.id} className="order-detail__note-card">
                      <div className="order-detail__note-meta">
                        {n.author} · {n.at}
                      </div>
                      <div>{n.text}</div>
                    </div>
                  ))}
                  <Textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Add an internal note…"
                    rows={3}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <Button type="button" variant="primary" size="sm" onClick={saveNote}>
                      Save note
                    </Button>
                  </div>
                </div>
              )}
              {detailTab === 'documents' && (
                <div className="order-detail__tab-panel">
                  {quotations.length === 0 ? (
                    <p className="order-detail__muted">No quotation PDFs linked yet.</p>
                  ) : (
                    quotations.map((q) => (
                      <div key={q._id} className="order-detail__doc-row">
                        <span>
                          📄 {q.quoteNumber || 'Quotation'} · {formatInr(q.total)}
                        </span>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            window.open(`#/sales?tab=orders`, '_self');
                          }}
                        >
                          Open
                        </Button>
                      </div>
                    ))
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <Button type="button" variant="secondary" size="sm" disabled>
                      Generate invoice
                    </Button>
                    <Button type="button" variant="secondary" size="sm" disabled>
                      Create quotation PDF
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="order-detail__col order-detail__col--right">
          <div className="order-detail__scroll">
            <div className="order-detail__card">
              <div className="order-detail__card-hd">
                <span className="order-detail__card-title">Customer</span>
                {customerIdForLink ? (
                  <Link to={`/sales/customers/${customerIdForLink}?tab=customers`}>
                    <Button type="button" variant="secondary" size="sm">
                      View profile
                    </Button>
                  </Link>
                ) : null}
              </div>
              <div className="order-detail__card-bd">
                {profile ? (
                  <>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div className="order-detail__customer-avatar">{initials(profile.name)}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{profile.name}</div>
                        <div className="order-detail__muted">ID {profile.customerCode || customerIdForLink.slice(-8)}</div>
                      </div>
                    </div>
                    {profile.phone ? (
                      <div className="order-detail__contact-row">
                        <span aria-hidden>📞</span> {profile.phone}
                      </div>
                    ) : null}
                    {profile.email ? (
                      <div className="order-detail__contact-row">
                        <span aria-hidden>✉️</span> {profile.email}
                      </div>
                    ) : null}
                    {summary ? (
                      <div className="order-detail__stat-grid">
                        <div>
                          <div className="order-detail__stat-cell">Lifetime value</div>
                          <div className="order-detail__stat-val order-detail__stat-val--green">
                            {formatInr(summary.lifetimeValue)}
                          </div>
                        </div>
                        <div>
                          <div className="order-detail__stat-cell">Total orders</div>
                          <div className="order-detail__stat-val">{summary.orderCount}</div>
                        </div>
                        <div>
                          <div className="order-detail__stat-cell">Type</div>
                          <div className="order-detail__stat-val">{profile.segment || '—'}</div>
                        </div>
                        <div>
                          <div className="order-detail__stat-cell">Outstanding</div>
                          <div className="order-detail__stat-val order-detail__stat-val--red">
                            {formatInr(summary.outstandingAmount)}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="order-detail__btn-row">
                      <Button type="button" variant="secondary" size="sm" disabled={!profile.phone}>
                        Call
                      </Button>
                      <Button type="button" variant="secondary" size="sm" disabled={!profile.phone}>
                        WhatsApp
                      </Button>
                      <Button type="button" variant="secondary" size="sm" disabled={!profile.email}>
                        Email
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="order-detail__muted">Walk-in / no customer on file</p>
                )}
              </div>
            </div>

            <div className="order-detail__card">
              <div className="order-detail__card-hd">
                <span className="order-detail__card-title">Payment details</span>
              </div>
              <div className="order-detail__card-bd">
                <div className="order-detail__doc-row">
                  <span>Status</span>
                  <span style={{ fontWeight: 600 }}>{paymentLabel}</span>
                </div>
                {paymentSummary.payments.length > 0 ? (
                  <div className="order-detail__payments-block">
                    <OrderPaymentsBreakdown payments={paymentSummary.payments} />
                  </div>
                ) : paymentPaid ? (
                  <div className="order-detail__doc-row">
                    <span>Method</span>
                    <span style={{ fontWeight: 600 }}>{paymentSummary.summary}</span>
                  </div>
                ) : null}
                <div className="order-detail__doc-row">
                  <span>Amount (incl. GST)</span>
                  <span style={{ fontWeight: 600, color: paymentPaid ? '#16a34a' : '#0f172a' }}>{formatInr(total)}</span>
                </div>
                <div className="order-detail__doc-row">
                  <span>Outstanding</span>
                  <span style={{ fontWeight: 600 }}>
                    {paymentPaid
                      ? formatInr(0)
                      : paymentPendingFlag
                        ? formatInr(amountOwingOnAccount)
                        : formatInr(total)}
                  </span>
                </div>
                <div
                  className="order-detail__doc-row"
                  style={{ borderBottom: paymentSummary.payments.length ? undefined : 'none' }}
                >
                  <span>Last update</span>
                  <span className="order-detail__muted">
                    {order.updatedAt ? new Date(order.updatedAt).toLocaleString() : '—'}
                  </span>
                </div>
              </div>
            </div>

            <div className="order-detail__card">
              <div className="order-detail__card-hd">
                <span className="order-detail__card-title">Order info</span>
              </div>
              <div className="order-detail__card-bd">
                <div className="order-detail__kv-rows">
                  {(
                    [
                      ['Order ID', order.orderNumber || orderId.slice(-8)],
                      ['Mode', String(order.mode || '').toUpperCase()],
                      ['Sales point', spName],
                      ['Cashier', cashierLabel],
                      ['Branch', branchName],
                      [
                        'Sale date',
                        saleInstant ? saleInstant.toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—',
                      ],
                      ['Entered (system)', created ? created.toLocaleString() : '—'],
                      [
                        'Completed',
                        order.status === 'completed' && updated ? updated.toLocaleString() : '—',
                      ],
                      ['Duration', durationLabel],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="order-detail__kv-row">
                      <span>{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="order-detail__card">
              <div className="order-detail__card-hd">
                <span className="order-detail__card-title">Related orders</span>
              </div>
              <div className="order-detail__card-bd">
                {relatedOrders.length === 0 ? (
                  <p className="order-detail__muted">No other orders for this customer.</p>
                ) : (
                  relatedOrders.map((ro) => (
                    <div
                      key={ro.id}
                      className="order-detail__related-row"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')
                          navigate({ pathname: `/sales/orders/${ro.id}`, search: searchParams.toString() });
                      }}
                      onClick={() =>
                        navigate({ pathname: `/sales/orders/${ro.id}`, search: searchParams.toString() })
                      }
                    >
                      <div>
                        <div style={{ color: '#2563eb', fontWeight: 600 }}>{ro.num}</div>
                        <div className="order-detail__muted">
                          {ro.date} · {ro.mode.toUpperCase()} · {formatInr(ro.totalInclGst)} incl. GST
                        </div>
                      </div>
                      <span
                        className={`order-detail__pill ${ro.status === 'completed' ? 'order-detail__pill--ok' : 'order-detail__pill--draft'
                          }`}
                      >
                        {ro.status}
                      </span>
                    </div>
                  ))
                )}
                {customerIdForLink ? (
                  <Button
                    type="button"
                    variant="secondary"
                    fullWidth
                    style={{ marginTop: 8 }}
                    onClick={() => navigate(`/sales/customers/${customerIdForLink}?tab=orders`)}
                  >
                    View all orders by this customer
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
