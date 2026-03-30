import {
  forwardRef,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Select } from '@/shared/components/ui';
import type { SelectOption } from '@/shared/components/ui';
import { salesService } from '@/services/sales.service';
import { docId, entityId } from '../../utils/ids';
import './SalesHistoryPanel.css';

type StatusFilter = 'all' | 'completed' | 'draft' | 'cancelled';
type ModeFilter = 'all' | 'pos' | 'b2b' | 'online';
type DateFilter = 'any' | 'today' | 'week' | 'month';
type AmountFilter = 'any' | 'high' | 'low';

export interface SalesHistoryPanelHandle {
  exportCsv: () => void;
}

interface SalesHistoryPanelProps {
  branchId: string | null;
  customers: Record<string, unknown>[];
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function parseCreatedAt(v: unknown): number {
  if (!v) return 0;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isDraftBucketStatus(s: string): boolean {
  return s === 'draft' || s === 'confirmed' || s === 'fulfilling';
}

function matchesStatusFilter(status: string, f: StatusFilter): boolean {
  if (f === 'all') return true;
  if (f === 'completed') return status === 'completed';
  if (f === 'cancelled') return status === 'cancelled';
  if (f === 'draft') return isDraftBucketStatus(status);
  return true;
}

function notesLookOnline(row: Record<string, unknown>): boolean {
  const n = String(row.notes || '').toLowerCase();
  return n.includes('online') || n.includes('web') || n.includes('ecom');
}

function matchesModeFilter(row: Record<string, unknown>, f: ModeFilter): boolean {
  const mode = String(row.mode || '').toLowerCase();
  if (f === 'all') return true;
  if (f === 'pos') return mode === 'pos';
  if (f === 'b2b') return mode === 'b2b' && !notesLookOnline(row);
  if (f === 'online') return mode === 'b2b' && notesLookOnline(row);
  return true;
}

function matchesDateFilter(ts: number, f: DateFilter): boolean {
  if (f === 'any' || !ts) return true;
  const now = new Date();
  if (f === 'today') return ts >= startOfDay(now).getTime();
  if (f === 'week') return ts >= startOfWeek(now).getTime();
  if (f === 'month') return ts >= startOfMonth(now).getTime();
  return true;
}

function matchesAmountFilter(total: number, f: AmountFilter): boolean {
  if (f === 'any') return true;
  if (f === 'high') return total > 5000;
  if (f === 'low') return total < 500;
  return true;
}

/** B2B draft orders are the quotation workflow (proposal to customer), not POS cart drafts. */
function isQuotationOrderRow(row: Record<string, unknown>): boolean {
  const mode = String(row.mode || '').toLowerCase();
  const status = String(row.status || '').toLowerCase();
  return mode === 'b2b' && status === 'draft';
}

function statusPill(row: Record<string, unknown>): { label: string; cls: string } {
  const status = String(row.status || '');
  if (status === 'completed' && row?.paymentPending) {
    return { label: 'On account', cls: 'sales-history-pill--onaccount' };
  }
  if (status === 'completed') return { label: 'Completed', cls: 'sales-history-pill--completed' };
  if (status === 'cancelled') return { label: 'Cancelled', cls: 'sales-history-pill--cancelled' };
  if (isQuotationOrderRow(row)) return { label: 'Quotation', cls: 'sales-history-pill--quotation' };
  if (status === 'draft') return { label: 'Draft', cls: 'sales-history-pill--draft' };
  return { label: 'Pending', cls: 'sales-history-pill--draft' };
}

function whatsappHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}`;
}

function customerIdFromRow(row: Record<string, unknown>): string {
  const cid = row.customerId as Record<string, unknown> | string | undefined;
  if (cid && typeof cid === 'object' && cid !== null && !Array.isArray(cid)) {
    return String((cid as { _id?: unknown })._id ?? '');
  }
  if (typeof cid === 'string') return cid;
  return '';
}

function modePill(row: Record<string, unknown>): { label: string; cls: string } {
  const mode = String(row.mode || '').toLowerCase();
  if (mode === 'pos') return { label: 'POS', cls: 'sales-history-pill--pos' };
  if (mode === 'b2b' && notesLookOnline(row)) return { label: 'Online', cls: 'sales-history-pill--online' };
  if (mode === 'b2b') return { label: 'B2B', cls: 'sales-history-pill--b2b' };
  return { label: '—', cls: 'sales-history-pill--online' };
}

function customerCell(
  row: Record<string, unknown>,
  fallbackById: Map<string, { name: string; phone: string }>
): { name: string; phone: string } {
  const cid = row.customerId as Record<string, unknown> | string | undefined;
  if (cid && typeof cid === 'object' && cid !== null && !Array.isArray(cid)) {
    return {
      name: String(cid.name ?? '—'),
      phone: String(cid.phone ?? ''),
    };
  }
  const id =
    typeof cid === 'string'
      ? cid
      : cid && typeof cid === 'object' && (cid as { _id?: unknown })._id
        ? String((cid as { _id?: unknown })._id)
        : '';
  if (id && fallbackById.has(id)) return fallbackById.get(id)!;
  return { name: '—', phone: '' };
}

function downloadCsv(filename: string, header: string[], lines: string[][]) {
  const esc = (c: string) => `"${c.replace(/"/g, '""')}"`;
  const body = [header.map(esc).join(','), ...lines.map((ln) => ln.map(esc).join(','))].join('\r\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const SalesHistoryPanel = forwardRef<SalesHistoryPanelHandle, SalesHistoryPanelProps>(function SalesHistoryPanel(
  { branchId, customers },
  ref
) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('any');
  const [amountFilter, setAmountFilter] = useState<AmountFilter>('any');
  const [dateDesc, setDateDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; row: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    salesService
      .listHistory(branchId)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e: Error) => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const customerFallback = useMemo(() => {
    const m = new Map<string, { name: string; phone: string }>();
    for (const c of customers) {
      const cid = docId(c as { _id?: string; id?: string });
      if (!cid) continue;
      m.set(cid, {
        name: String((c as { name?: string }).name ?? '—'),
        phone: String((c as { phone?: string }).phone ?? ''),
      });
    }
    return m;
  }, [customers]);

  const stats = useMemo(() => {
    const now = new Date();
    const t0 = startOfDay(now).getTime();
    let totalOrders = rows.length;
    let revenueToday = 0;
    let sumCompleted = 0;
    let nCompleted = 0;
    let pendingCount = 0;
    let pendingUnpaid = 0;
    for (const r of rows) {
      const st = String(r.status || '');
      const total = Number(r.total ?? 0);
      const ts = parseCreatedAt(r.createdAt);
      if (st === 'completed') {
        sumCompleted += total;
        nCompleted += 1;
        if (ts >= t0) revenueToday += total;
      }
      if (isDraftBucketStatus(st)) {
        pendingCount += 1;
        pendingUnpaid += total;
      }
    }
    const avgOrder = nCompleted > 0 ? sumCompleted / nCompleted : 0;
    return { totalOrders, revenueToday, avgOrder, pendingCount, pendingUnpaid };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let list = rows.filter((r) => {
      const st = String(r.status || '');
      if (!matchesStatusFilter(st, statusFilter)) return false;
      if (!matchesModeFilter(r, modeFilter)) return false;
      const ts = parseCreatedAt(r.createdAt);
      if (!matchesDateFilter(ts, dateFilter)) return false;
      const total = Number(r.total ?? 0);
      if (!matchesAmountFilter(total, amountFilter)) return false;
      if (q) {
        const id = docId(r as { _id?: string; id?: string });
        const num = String((r as { orderNumber?: string }).orderNumber ?? '');
        const { name, phone } = customerCell(r, customerFallback);
        const hay = `${id} ${num} ${name} ${phone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      const ta = parseCreatedAt(a.createdAt);
      const tb = parseCreatedAt(b.createdAt);
      return dateDesc ? tb - ta : ta - tb;
    });
    return list;
  }, [rows, deferredSearch, statusFilter, modeFilter, dateFilter, amountFilter, dateDesc, customerFallback]);

  const filteredIds = useMemo(
    () =>
      filtered
        .map((r) => docId(r as { _id?: string; id?: string }))
        .filter((x): x is string => Boolean(x)),
    [filtered]
  );

  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredIds));
    }
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', close);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!menu || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [menu]);

  const openMenuAt = (clientX: number, clientY: number, row: Record<string, unknown>) => {
    setMenu({ x: clientX, y: clientY, row });
  };

  const rowActions = (row: Record<string, unknown>) => {
    const id = docId(row as { _id?: string; id?: string });
    const noop = () => {};
    const noopAsync = async () => {};
    if (!branchId || !id) {
      return {
        goView: noop,
        goEdit: noop,
        goDuplicate: noopAsync,
        goRefund: noop,
        goOpenCustomer: noop,
        goDownloadQuotation: noopAsync,
        goConvertQuotation: noopAsync,
        goDownloadInvoice: noop,
        quotationRow: false,
        completedRow: false,
        hasCustomer: false,
      };
    }

    const goView = () => {
      setMenu(null);
      const p = new URLSearchParams(searchParams);
      if (!p.get('tab')) p.set('tab', 'history');
      navigate({ pathname: `/sales/orders/${id}`, search: `?${p.toString()}` });
    };

    const goEdit = () => {
      setMenu(null);
      const p = new URLSearchParams(searchParams);
      p.set('tab', 'orders');
      navigate({ pathname: '/sales', search: `?${p.toString()}` });
    };

    const goDuplicate = async () => {
      setMenu(null);
      setBusy(true);
      try {
        const o = (await salesService.getOrder(id, branchId)) as {
          mode?: string;
          salesPointId?: unknown;
          customerId?: unknown;
          lines?: Array<{ variantId?: unknown; quantity?: number; unitPrice?: number }>;
        };
        const lines = (o.lines || []).map((ln) => ({
          variantId: String(
            ln.variantId && typeof ln.variantId === 'object' && (ln.variantId as { _id?: unknown })._id
              ? (ln.variantId as { _id?: unknown })._id
              : ln.variantId
          ),
          quantity: Number(ln.quantity ?? 0),
          unitPrice: ln.unitPrice != null ? Number(ln.unitPrice) : undefined,
        }));
        const sp = String(
          o.salesPointId && typeof o.salesPointId === 'object' && (o.salesPointId as { _id?: unknown })._id
            ? (o.salesPointId as { _id?: unknown })._id
            : o.salesPointId ?? ''
        );
        const cust = o.customerId
          ? String(
              typeof o.customerId === 'object' && (o.customerId as { _id?: unknown })._id
                ? (o.customerId as { _id?: unknown })._id
                : o.customerId
            )
          : undefined;
        await salesService.createOrder(
          {
            mode: o.mode === 'b2b' ? 'b2b' : 'pos',
            salesPointId: sp,
            customerId: cust,
            lines,
          },
          branchId
        );
        load();
      } catch {
        /* toast optional */
      } finally {
        setBusy(false);
      }
    };

    const goRefund = () => {
      setMenu(null);
      const p = new URLSearchParams(searchParams);
      p.set('tab', 'returns');
      p.set('returnOrderId', id);
      navigate({ pathname: '/sales', search: `?${p.toString()}` });
    };

    const goOpenCustomer = () => {
      setMenu(null);
      const cid = customerIdFromRow(row);
      if (!cid) return;
      const p = new URLSearchParams(searchParams);
      p.set('tab', 'customers');
      navigate({ pathname: `/sales/customers/${cid}`, search: `?${p.toString()}` });
    };

    const goDownloadQuotation = async () => {
      setMenu(null);
      if (!branchId) return;
      setBusy(true);
      try {
        const list = await salesService.listOrderQuotations(id, branchId);
        const sorted = [...(list || [])].sort(
          (a, b) =>
            new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime()
        );
        const q = sorted[0];
        if (!q?._id) {
          window.alert('No quotation PDF yet. Open the order and create a quotation first.');
          return;
        }
        const blob = await salesService.downloadQuotationPdfBlob(q._id, branchId);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${q.quoteNumber || 'quotation'}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e: unknown) {
        window.alert(e instanceof Error ? e.message : 'Could not download quotation');
      } finally {
        setBusy(false);
      }
    };

    const goDownloadInvoice = () => {
      setMenu(null);
      const p = new URLSearchParams(searchParams);
      if (!p.get('tab')) p.set('tab', 'history');
      p.set('print', '1');
      navigate({ pathname: `/sales/orders/${id}`, search: `?${p.toString()}` });
    };

    const goConvertQuotation = async () => {
      setMenu(null);
      if (!branchId) return;
      setBusy(true);
      try {
        const list = await salesService.listOrderQuotations(id, branchId);
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
          const o = (await salesService.getOrder(id, branchId)) as {
            mode?: string;
            status?: string;
            salesPointId?: unknown;
            customerId?: unknown;
            lines?: Array<{ variantId?: unknown; quantity?: number; unitPrice?: number }>;
            discountAmount?: number;
          };
          if (String(o.mode) !== 'b2b' || String(o.status) !== 'draft') {
            window.alert('No open quotation linked to this row. Open the order and create a quotation PDF first.');
            return;
          }
          const lines = (o.lines || []).map((ln) => ({
            variantId: String(
              ln.variantId && typeof ln.variantId === 'object' && (ln.variantId as { _id?: unknown })._id
                ? (ln.variantId as { _id?: unknown })._id
                : ln.variantId
            ),
            quantity: Number(ln.quantity ?? 0),
            unitPrice: ln.unitPrice != null ? Number(ln.unitPrice) : undefined,
          }));
          if (!lines.length) {
            window.alert('This draft has no line items to convert.');
            return;
          }
          const sp = String(
            o.salesPointId && typeof o.salesPointId === 'object' && (o.salesPointId as { _id?: unknown })._id
              ? (o.salesPointId as { _id?: unknown })._id
              : o.salesPointId ?? ''
          );
          const cust =
            (o.customerId
              ? String(
                  typeof o.customerId === 'object' && (o.customerId as { _id?: unknown })._id
                    ? (o.customerId as { _id?: unknown })._id
                    : o.customerId
                )
              : '') || customerIdFromRow(row);
          if (!cust) {
            window.alert('This draft needs a customer. Open the order and assign a customer first.');
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
            await salesService.deleteDraftOrder(id, branchId);
          } catch {
            /* new order already created */
          }
          const oid = entityId(order);
          const p = new URLSearchParams(searchParams);
          p.set('tab', 'orders');
          p.set('customerId', cust);
          if (sp) p.set('salesPointId', sp);
          if (oid) p.set('posLoadOrderId', oid);
          navigate({ pathname: '/sales', search: `?${p.toString()}` });
          load();
          return;
        }
        const { order } = await salesService.convertQuotation(q._id, branchId);
        const oid = entityId(order);
        const p = new URLSearchParams(searchParams);
        p.set('tab', 'orders');
        const cid = customerIdFromRow(row);
        if (cid) p.set('customerId', cid);
        const sp = String(
          row.salesPointId && typeof row.salesPointId === 'object' && (row.salesPointId as { _id?: unknown })._id
            ? (row.salesPointId as { _id?: unknown })._id
            : row.salesPointId ?? ''
        );
        if (sp) p.set('salesPointId', sp);
        if (oid) p.set('posLoadOrderId', oid);
        navigate({ pathname: '/sales', search: `?${p.toString()}` });
        load();
      } catch (e: unknown) {
        window.alert(e instanceof Error ? e.message : 'Convert failed');
      } finally {
        setBusy(false);
      }
    };

    return {
      goView,
      goEdit,
      goDuplicate,
      goRefund,
      goOpenCustomer,
      goDownloadQuotation,
      goConvertQuotation,
      goDownloadInvoice,
      quotationRow: isQuotationOrderRow(row),
      completedRow: String(row.status || '') === 'completed',
      hasCustomer: Boolean(customerIdFromRow(row)),
    };
  };

  const exportRows = useCallback(
    (subset: Record<string, unknown>[]) => {
      const header = ['Order ID', 'Order #', 'Customer', 'Phone', 'Status', 'Mode', 'Total', 'Created'];
      const lines = subset.map((r) => {
        const oid = docId(r as { _id?: string; id?: string });
        const { name, phone } = customerCell(r, customerFallback);
        const mp = modePill(r);
        const st = statusPill(r);
        return [
          String(oid ?? ''),
          String((r as { orderNumber?: string }).orderNumber ?? ''),
          name,
          phone,
          st.label,
          mp.label,
          String(Number(r.total ?? 0)),
          String((r as { createdAt?: string }).createdAt ?? ''),
        ];
      });
      downloadCsv(`orders-${new Date().toISOString().slice(0, 10)}.csv`, header, lines);
    },
    [customerFallback]
  );

  useImperativeHandle(
    ref,
    () => ({
      exportCsv: () => exportRows(filtered),
    }),
    [filtered, exportRows]
  );

  const onBulkComplete = async () => {
    if (!branchId) return;
    setBusy(true);
    try {
      for (const id of selected) {
        const row = rows.find((r) => docId(r as { _id?: string; id?: string }) === id);
        const st = String(row?.status || '');
        try {
          if (st === 'draft') {
            await salesService.confirmOrder(id, branchId);
            await salesService.patchOrder(id, { status: 'completed' }, branchId);
          } else if (st === 'confirmed' || st === 'fulfilling') {
            await salesService.patchOrder(id, { status: 'completed' }, branchId);
          }
        } catch {
          /* skip row */
        }
      }
      setSelected(new Set());
      load();
    } finally {
      setBusy(false);
    }
  };

  const onBulkDelete = async () => {
    if (!branchId) return;
    if (!window.confirm(`Delete ${selected.size} draft order(s)?`)) return;
    setBusy(true);
    try {
      for (const id of selected) {
        const row = rows.find((r) => docId(r as { _id?: string; id?: string }) === id);
        if (String(row?.status || '') !== 'draft') continue;
        try {
          await salesService.deleteDraftOrder(id, branchId);
        } catch {
          /* skip */
        }
      }
      setSelected(new Set());
      load();
    } finally {
      setBusy(false);
    }
  };

  const statCardHandlers = {
    total: () => {
      setStatusFilter('all');
      setDateFilter('any');
      setAmountFilter('any');
    },
    revenue: () => {
      setDateFilter('today');
      setStatusFilter('completed');
      setAmountFilter('any');
    },
    avg: () => {
      setStatusFilter('completed');
      setDateFilter('any');
      setAmountFilter('any');
    },
    pending: () => {
      setStatusFilter('draft');
      setDateFilter('any');
      setAmountFilter('any');
    },
  };

  const statusOpts: SelectOption[] = [
    { value: 'all', label: 'Status: All' },
    { value: 'completed', label: 'Completed' },
    { value: 'draft', label: 'Draft / pending' },
    { value: 'cancelled', label: 'Cancelled' },
  ];
  const modeOpts: SelectOption[] = [
    { value: 'all', label: 'Mode: All' },
    { value: 'pos', label: 'POS' },
    { value: 'b2b', label: 'B2B' },
    { value: 'online', label: 'Online' },
  ];
  const dateOpts: SelectOption[] = [
    { value: 'any', label: 'Date: Any' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
  ];
  const amountOpts: SelectOption[] = [
    { value: 'any', label: 'Amount: Any' },
    { value: 'high', label: 'High (above ₹5000)' },
    { value: 'low', label: 'Under ₹500' },
  ];

  if (!branchId) {
    return (
      <div className="sales-history">
        <p className="sales-muted" style={{ padding: 16 }}>
          Branch required.
        </p>
      </div>
    );
  }

  return (
    <div className="sales-history">
      <div className="sales-history-body">
        {error ? <div className="sales-panel-error">{error}</div> : null}

        <div className="sales-history-stats">
          <button type="button" className="sales-history-stat sales-history-stat--blue" onClick={statCardHandlers.total}>
            <div className="sales-history-stat__label">Total orders</div>
            <div className="sales-history-stat__value">{stats.totalOrders}</div>
            <div className="sales-history-stat__ctx">In this branch (loaded list)</div>
          </button>
          <button type="button" className="sales-history-stat sales-history-stat--green" onClick={statCardHandlers.revenue}>
            <div className="sales-history-stat__label">Revenue today</div>
            <div className="sales-history-stat__value">₹{stats.revenueToday.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
            <div className="sales-history-stat__ctx">Completed orders · today</div>
          </button>
          <button type="button" className="sales-history-stat" onClick={statCardHandlers.avg}>
            <div className="sales-history-stat__label">Average order value</div>
            <div className="sales-history-stat__value">₹{stats.avgOrder.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
            <div className="sales-history-stat__ctx">Among completed orders</div>
          </button>
          <button type="button" className="sales-history-stat sales-history-stat--amber" onClick={statCardHandlers.pending}>
            <div className="sales-history-stat__label">Pending / draft</div>
            <div className="sales-history-stat__value">{stats.pendingCount}</div>
            <div className="sales-history-stat__ctx">
              Unpaid proxy ₹{stats.pendingUnpaid.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
          </button>
        </div>

        {selected.size > 0 ? (
          <div className="sales-history-bulk">
            <div className="sales-history-bulk__left">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && !allFilteredSelected;
                }}
                onChange={toggleSelectAll}
                aria-label="Select all filtered"
              />
              <span className="sales-history-bulk__count">{selected.size} selected</span>
            </div>
            <div className="sales-history-bulk__actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  exportRows(
                    filtered.filter((r) => {
                      const rid = docId(r as { _id?: string; id?: string });
                      return rid ? selected.has(rid) : false;
                    })
                  )
                }
              >
                Export
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void onBulkComplete()}>
                Mark completed
              </Button>
              <Button type="button" variant="secondary" size="sm" className="sales-history-btn-danger" disabled={busy} onClick={() => void onBulkDelete()}>
                Delete
              </Button>
            </div>
            <div className="sales-history-bulk__spacer" />
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="sales-history-toolbar">
            <div className="sales-history-toolbar__filters">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} options={statusOpts} />
              <Select value={modeFilter} onChange={(e) => setModeFilter(e.target.value as ModeFilter)} options={modeOpts} />
              <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)} options={dateOpts} />
              <Select value={amountFilter} onChange={(e) => setAmountFilter(e.target.value as AmountFilter)} options={amountOpts} />
            </div>
            <div className="sales-history-toolbar__spacer" />
            <div className="sales-history-toolbar__right">
              <div className="sales-history-search">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ID, name, phone…"
                  aria-label="Search orders"
                />
              </div>
              <button type="button" className="sales-history-sort" onClick={() => setDateDesc((d) => !d)} aria-label="Toggle date sort">
                Date {dateDesc ? '↓' : '↑'}
              </button>
            </div>
          </div>
        )}

        <div className="sales-history-table-wrap">
          <table className="sales-history-table">
            <colgroup>
              <col style={{ width: 36 }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: 44 }} />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allFilteredSelected && filteredIds.length > 0}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.size > 0 && !allFilteredSelected;
                    }}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Mode</th>
                <th className="sales-history-th-num">Total</th>
                <th>Created</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="sales-history-skel-row">
                      <td>
                        <div className="sales-history-skel" style={{ width: 14 }} />
                      </td>
                      <td>
                        <div className="sales-history-skel" style={{ width: '72%' }} />
                      </td>
                      <td>
                        <div className="sales-history-skel" style={{ width: '88%' }} />
                      </td>
                      <td>
                        <div className="sales-history-skel" style={{ width: '70%' }} />
                      </td>
                      <td>
                        <div className="sales-history-skel" style={{ width: '60%' }} />
                      </td>
                      <td>
                        <div className="sales-history-skel" style={{ width: '56%', marginLeft: 'auto' }} />
                      </td>
                      <td>
                        <div className="sales-history-skel" style={{ width: '80%' }} />
                      </td>
                      <td>
                        <div className="sales-history-skel" style={{ width: 20, margin: '0 auto' }} />
                      </td>
                    </tr>
                  ))
                : null}
              {!loading &&
                filtered.map((r) => {
                  const id = docId(r as { _id?: string; id?: string }) || '';
                  const total = Number(r.total ?? 0);
                  const sp = statusPill(r);
                  const mp = modePill(r);
                  const { name, phone } = customerCell(r, customerFallback);
                  const created = (r as { createdAt?: string }).createdAt;
                  const dateStr = created ? new Date(created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
                  const high = total >= 5000;
                  const sel = Boolean(id && selected.has(id));
                  return (
                    <tr
                      key={id || `row-${String((r as { orderNumber?: string }).orderNumber)}`}
                      className={`${high ? 'sales-history-row--high' : ''} ${sel ? 'sales-history-row--selected' : ''} sales-history-row--nav`}
                      onClick={(e) => {
                        if (!id) return;
                        if ((e.target as HTMLElement).closest('input,button,a')) return;
                        const p = new URLSearchParams(searchParams);
                        if (!p.get('tab')) p.set('tab', 'history');
                        navigate({ pathname: `/sales/orders/${id}`, search: `?${p.toString()}` });
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openMenuAt(e.clientX, e.clientY, r);
                      }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={sel}
                          onChange={() => {
                            if (id) toggleRow(id);
                          }}
                          aria-label="Select row"
                        />
                      </td>
                      <td title={id}>{String((r as { orderNumber?: string }).orderNumber ?? id.slice(-8))}</td>
                      <td title={`${name} ${phone}`}>
                        <div className="sales-history-customer-cell">
                          <div className="sales-history-customer-cell__text">
                            <div style={{ fontWeight: 600 }}>{name}</div>
                            {phone ? <div className="sales-history-muted">{phone}</div> : null}
                          </div>
                          {phone && whatsappHref(phone) ? (
                            <a
                              className="sales-history-wa"
                              href={whatsappHref(phone)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open WhatsApp chat"
                              aria-label={`WhatsApp ${name}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="sales-history-wa__icon" aria-hidden>
                                WA
                              </span>
                            </a>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <span className={`sales-history-pill ${sp.cls}`}>
                          <span className="sales-history-pill__dot" aria-hidden />
                          {sp.label}
                        </span>
                      </td>
                      <td>
                        <span className={`sales-history-pill ${mp.cls}`}>
                          <span className="sales-history-pill__dot" aria-hidden />
                          {mp.label}
                        </span>
                      </td>
                      <td className="sales-history-td-num" style={{ fontWeight: 700 }}>
                        ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td title={String(created ?? '')}>{dateStr}</td>
                      <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="sales-history-actions-btn"
                          aria-label="Order actions"
                          onClick={(e) => openMenuAt(e.clientX, e.clientY, r)}
                        >
                          ⋮
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {!loading && filtered.length === 0 ? <div className="sales-history-empty">No orders match filters.</div> : null}
        </div>
      </div>

      {menu
        ? createPortal(
            <div
              ref={menuRef}
              className="sales-history-menu"
              style={{ left: menu.x, top: menu.y }}
              role="menu"
            >
              {(() => {
                const a = rowActions(menu.row);
                if (a.quotationRow) {
                  return (
                    <>
                      <button type="button" role="menuitem" onClick={a.goView}>
                        View
                      </button>
                      <button type="button" role="menuitem" disabled={busy} onClick={() => void a.goConvertQuotation()}>
                        Convert to order
                      </button>
                      <button type="button" role="menuitem" disabled={!a.hasCustomer} onClick={a.goOpenCustomer}>
                        Open customer
                      </button>
                      <button type="button" role="menuitem" disabled={busy} onClick={() => void a.goDownloadQuotation()}>
                        Download quotation
                      </button>
                    </>
                  );
                }
                if (a.completedRow) {
                  return (
                    <>
                      <button type="button" role="menuitem" onClick={a.goView}>
                        View
                      </button>
                      <button type="button" role="menuitem" onClick={a.goRefund}>
                        Refund
                      </button>
                      <button type="button" role="menuitem" onClick={a.goDownloadInvoice}>
                        Download invoice
                      </button>
                    </>
                  );
                }
                return (
                  <>
                    <button type="button" role="menuitem" onClick={a.goView}>
                      View
                    </button>
                    <button type="button" role="menuitem" onClick={a.goEdit}>
                      Edit
                    </button>
                    <button type="button" role="menuitem" onClick={() => void a.goDuplicate()}>
                      Duplicate
                    </button>
                    <button type="button" role="menuitem" onClick={a.goRefund}>
                      Refund
                    </button>
                  </>
                );
              })()}
            </div>,
            document.body
          )
        : null}

    </div>
  );
});
