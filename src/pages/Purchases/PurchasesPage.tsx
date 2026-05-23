/**
 * Purchases workspace
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, useMatch } from 'react-router-dom';
import { SalesModuleHeader } from '@/features/sales/components/SalesModuleHeader';
import { purchaseService, type PurchaseOrder, type PurchaseOrderStatus } from '@/services/purchase.service';
import { useSalesBranchId } from '@/features/sales/hooks/useSalesBranchId';
import { PurchaseOrdersListPanel } from '@/features/purchases/components/PurchaseOrdersListPanel';
import { PurchaseOrderCreatePage } from '@/features/purchases/components/PurchaseOrderCreatePage';
import { PurchaseOrderDetailPage } from '@/features/purchases/components/PurchaseOrderDetailPage';
import { PurchasePlaceholderPanel } from '@/features/purchases/components/PurchasePlaceholderPanel';

const TABS = [
  { id: 'orders', label: 'Orders' },
  { id: 'receipts', label: 'Receipts' },
  { id: 'bills', label: 'Bills' },
  { id: 'returns', label: 'Returns' },
  { id: 'settings', label: 'Settings' },
] as const;

type PurchaseTab = (typeof TABS)[number]['id'];

export const PurchasesPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const branchId = useSalesBranchId();
  const detailMatch = useMatch('/purchases/orders/:orderId');
  const activeOrderId = detailMatch?.params.orderId;
  const tabRaw = searchParams.get('tab');
  const tab: PurchaseTab = TABS.some((t) => t.id === tabRaw) ? (tabRaw as PurchaseTab) : 'orders';
  const mode = searchParams.get('mode') === 'create' ? 'create' : 'list';

  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseOrder | null>(null);
  const [filters, setFilters] = useState<{
    search: string;
    status: PurchaseOrderStatus | '';
    supplierId: string;
    dateFrom: string;
    dateTo: string;
  }>({
    search: '',
    status: '',
    supplierId: '',
    dateFrom: '',
    dateTo: '',
  });

  const loadList = useCallback(async () => {
    if (tab !== 'orders' || mode === 'create' || activeOrderId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await purchaseService.listOrders(
        {
          page,
          pageSize,
          search: filters.search || undefined,
          status: filters.status || undefined,
          supplierId: filters.supplierId || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        },
        branchId
      );
      setRows(data.rows);
      setTotal(data.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load purchase orders');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [activeOrderId, branchId, filters.dateFrom, filters.dateTo, filters.search, filters.status, filters.supplierId, mode, page, pageSize, tab]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!activeOrderId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    purchaseService
      .getOrder(activeOrderId, branchId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load order detail');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrderId, branchId]);

  const supplierOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(r.supplierId, r.supplierName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const setTab = (next: PurchaseTab) => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', next);
    p.delete('mode');
    setSearchParams(p, { replace: true });
    if (activeOrderId) navigate(`/purchases?${p.toString()}`, { replace: true });
  };

  const openCreate = () => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', 'orders');
    p.set('mode', 'create');
    setSearchParams(p, { replace: true });
  };

  const onCreated = (order: PurchaseOrder, mode: 'draft' | 'send' | 'confirm') => {
    if (mode === 'confirm') {
      navigate(`/purchases/orders/${order.id}?tab=orders`, { replace: true });
    }
  };

  const cancelDetailOrder = async () => {
    if (!detail) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await purchaseService.cancelOrder(detail.id, branchId);
      setDetail(updated);
      await loadList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not cancel order');
    } finally {
      setLoading(false);
    }
  };

  const headerTitle =
    tab === 'orders' && mode === 'create'
      ? 'Create order'
      : tab === 'orders'
        ? 'Orders'
        : tab.charAt(0).toUpperCase() + tab.slice(1);

  return (
    <main style={{ display: 'grid', gap: 12 }}>
      <SalesModuleHeader
        title={headerTitle}
        tabs={TABS}
        activeTab={tab}
        onTabChange={(id) => setTab(id as PurchaseTab)}
        tabListAriaLabel="Purchases sections"
      />

      {error ? (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: 10 }}>
          {error}
        </div>
      ) : null}

      {tab !== 'orders' ? (
        <PurchasePlaceholderPanel
          title={headerTitle}
          subtitle={`${headerTitle} will be implemented in a dedicated phase. Orders are fully operational.`}
        />
      ) : activeOrderId && detail ? (
        <PurchaseOrderDetailPage
          order={detail}
          loading={loading}
          onBack={() => navigate('/purchases?tab=orders', { replace: true })}
          onCancelOrder={() => void cancelDetailOrder()}
        />
      ) : mode === 'create' ? (
        <PurchaseOrderCreatePage
          branchId={branchId}
          supplierOptions={supplierOptions}
          orderRows={rows}
          onCancel={() => navigate('/purchases?tab=orders', { replace: true })}
          onSaved={onCreated}
        />
      ) : (
        <PurchaseOrdersListPanel
          rows={rows}
          total={total}
          page={page}
          pageSize={pageSize}
          filters={filters}
          supplierOptions={supplierOptions}
          onFiltersChange={(patch) => {
            setFilters((prev) => ({ ...prev, ...patch }));
            setPage(1);
          }}
          onPageChange={setPage}
          onCreate={openCreate}
          onOpenOrder={(id) => navigate(`/purchases/orders/${id}?tab=orders`, { replace: true })}
        />
      )}

      {loading && !activeOrderId ? <p style={{ color: '#64748b', margin: 0 }}>Loading...</p> : null}
    </main>
  );
};
