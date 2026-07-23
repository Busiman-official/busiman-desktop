/**
 * Purchases workspace
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useMatch } from 'react-router-dom';
import { ReceivingLocationSelect, pickDefaultReceivingLocationId } from '@/features/inventory/components/ReceivingLocationSelect';
import { SalesModuleHeader } from '@/features/sales/components/SalesModuleHeader';
import { purchaseService, type PurchaseOrder, type PurchaseOrderListStats, type PurchaseSupplierDetail, type PurchaseSupplierListStats, type PurchaseSupplierSummary } from '@/services/purchase.service';
import { useSalesBranchId } from '@/features/sales/hooks/useSalesBranchId';
import { inventoryService, type Location } from '@/services/inventory.service';
import { PurchaseOrdersListPanel } from '@/features/purchases/components/PurchaseOrdersListPanel';
import {
  PurchaseOrdersListControls,
} from '@/features/purchases/components/PurchaseOrdersListControls';
import {
  EMPTY_PURCHASE_ORDER_LIST_FILTERS,
  listStatsQueryParams,
  type PurchaseOrderListFilters,
} from '@/features/purchases/utils/purchaseOrderListFilters';
import { usePurchaseOrdersListKeyboard } from '@/features/purchases/hooks/usePurchaseOrdersListKeyboard';
import { usePurchaseSuppliersListKeyboard } from '@/features/purchases/hooks/usePurchaseSuppliersListKeyboard';
import { PurchaseSuppliersListPanel } from '@/features/purchases/components/PurchaseSuppliersListPanel';
import { PurchaseSuppliersListControls } from '@/features/purchases/components/PurchaseSuppliersListControls';
import { PurchaseSupplierDetailPage } from '@/features/purchases/components/PurchaseSupplierDetailPage';
import {
  DEFAULT_SUPPLIER_LIST_FILTERS,
  EMPTY_SUPPLIER_LIST_FILTERS,
  listStatsQueryParams as supplierListStatsQueryParams,
  listSuppliersQueryParams,
  type PurchaseSupplierListFilters,
} from '@/features/purchases/utils/purchaseSupplierListFilters';
import { SupplierFormModal } from '@/features/purchases/components/SupplierFormModal';
import { PurchaseOrderCreatePage } from '@/features/purchases/components/PurchaseOrderCreatePage';
import { PurchaseOrderDetailPage } from '@/features/purchases/components/PurchaseOrderDetailPage';
import { PurchaseReceiptsPanel } from '@/features/purchases/components/PurchaseReceiptsPanel';
import { PurchaseReturnsPanel } from '@/features/purchases/components/PurchaseReturnsPanel';
import { PurchaseReturnsListControls } from '@/features/purchases/components/PurchaseReturnsListControls';
import {
  EMPTY_RETURN_LIST_FILTERS,
  type PurchaseReturnListFilters,
} from '@/features/purchases/utils/purchaseReturnDisplay';
import { LinkPurchaseOrderModal } from '@/features/purchases/components/LinkPurchaseOrderModal';
import { Button } from '@/shared/components/ui';
import '@/pages/Sales/SalesPage.css';
import '@/features/purchases/components/LinkPurchaseOrderModal.css';

const TABS = [
  { id: 'receipts', label: 'Receipts' },
  { id: 'orders', label: 'Orders' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'returns', label: 'Returns' },
] as const;

type PurchaseTab = (typeof TABS)[number]['id'];

const DEFAULT_PURCHASE_TAB: PurchaseTab = 'receipts';

function localDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const PurchasesPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const branchId = useSalesBranchId();
  const detailMatch = useMatch('/purchases/orders/:orderId');
  const activeOrderId = detailMatch?.params.orderId;
  const supplierDetailMatch = useMatch('/purchases/suppliers/:supplierId');
  const activeSupplierId = supplierDetailMatch?.params.supplierId
    ? decodeURIComponent(supplierDetailMatch.params.supplierId)
    : undefined;
  const tabRaw = searchParams.get('tab');
  const tab: PurchaseTab = TABS.some((t) => t.id === tabRaw)
    ? (tabRaw as PurchaseTab)
    : tabRaw === 'bills'
      ? 'suppliers'
      : DEFAULT_PURCHASE_TAB;
  const mode = searchParams.get('mode') === 'create' ? 'create' : 'list';
  const returnSupplierId = searchParams.get('returnSupplier')?.trim() || null;
  const returnBillId = searchParams.get('returnBillId')?.trim() || null;
  const isReceiptsTab = tab === 'receipts';

  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseOrder | null>(null);
  const [createNavbarTrailing, setCreateNavbarTrailing] = useState<React.ReactNode>(null);
  const [detailNavbarTrailing, setDetailNavbarTrailing] = useState<React.ReactNode>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [poPickerOpen, setPoPickerOpen] = useState(false);
  const [linkedPoSummary, setLinkedPoSummary] = useState<{ id: string; poNumber: string } | null>(null);
  const [filters, setFilters] = useState<PurchaseOrderListFilters>(EMPTY_PURCHASE_ORDER_LIST_FILTERS);
  const [stats, setStats] = useState<PurchaseOrderListStats>({
    receivablePoCount: 0,
    pendingUnits: 0,
    pendingValue: 0,
    overduePoCount: 0,
    draftCount: 0,
  });
  const [statsLoading, setStatsLoading] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [highlightedRowIndex, setHighlightedRowIndex] = useState(0);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const ordersListReturnRef = useRef<{ page: number; orderId: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const supplierSearchInputRef = useRef<HTMLInputElement>(null);

  const [supplierRows, setSupplierRows] = useState<PurchaseSupplierSummary[]>([]);
  const [supplierTotal, setSupplierTotal] = useState(0);
  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierPageSize] = useState(20);
  const [supplierLoading, setSupplierLoading] = useState(false);
  const [supplierDetail, setSupplierDetail] = useState<PurchaseSupplierDetail | null>(null);
  const [supplierFilters, setSupplierFilters] = useState<PurchaseSupplierListFilters>(
    DEFAULT_SUPPLIER_LIST_FILTERS
  );
  const [supplierStats, setSupplierStats] = useState<PurchaseSupplierListStats>({
    totalOutstanding: 0,
    suppliersWithPending: 0,
    suppliersWithPartial: 0,
    partiallyPaidBillCount: 0,
  });
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const [supplierStatsLoading, setSupplierStatsLoading] = useState(false);
  const [supplierFilterDrawerOpen, setSupplierFilterDrawerOpen] = useState(false);
  const [supplierHighlightedRowIndex, setSupplierHighlightedRowIndex] = useState(0);
  const [highlightedSupplierId, setHighlightedSupplierId] = useState<string | null>(null);
  const suppliersListReturnRef = useRef<{ page: number; supplierId: string } | null>(null);

  const [returnFilters, setReturnFilters] = useState<PurchaseReturnListFilters>(EMPTY_RETURN_LIST_FILTERS);
  const [returnFilterDrawerOpen, setReturnFilterDrawerOpen] = useState(false);
  const [returnWizardOpen, setReturnWizardOpen] = useState(false);
  const [returnHighlightedIndex, setReturnHighlightedIndex] = useState(0);
  const returnSearchInputRef = useRef<HTMLInputElement>(null);

  const receivingLocationId = searchParams.get('receivingLocationId');
  const purchaseOrderId = searchParams.get('purchaseOrderId')?.trim() || null;

  const receiptDateYmd = useMemo(() => {
    const raw = searchParams.get('receiptDate')?.trim() || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : localDateISO();
  }, [searchParams]);

  const loadList = useCallback(async () => {
    if (tab !== 'orders' || mode === 'create' || activeOrderId) return;
    setLoading(true);
    setStatsLoading(true);
    setError(null);
    try {
      const [data, statsData] = await Promise.all([
        purchaseService.listOrders(
          {
            page,
            pageSize,
            search: filters.search || undefined,
            statuses: filters.statuses,
            overdueOnly: filters.overdueOnly,
            supplierId: filters.supplierId || undefined,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
          },
          branchId
        ),
        purchaseService.getOrderListStats(listStatsQueryParams(filters), branchId),
      ]);
      setRows(data.rows);
      setTotal(data.total);
      setStats(statsData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load purchase orders');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
      setStatsLoading(false);
    }
  }, [
    activeOrderId,
    branchId,
    filters,
    mode,
    page,
    pageSize,
    tab,
  ]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadSuppliersList = useCallback(async () => {
    if (tab !== 'suppliers' || activeSupplierId) return;
    setSupplierLoading(true);
    setSupplierStatsLoading(true);
    setError(null);
    try {
      const [data, statsData] = await Promise.all([
        purchaseService.listSuppliers(
          {
            page: supplierPage,
            pageSize: supplierPageSize,
            ...listSuppliersQueryParams(supplierFilters),
          },
          branchId
        ),
        purchaseService.getSupplierListStats(supplierListStatsQueryParams(supplierFilters), branchId),
      ]);
      setSupplierRows(data.rows);
      setSupplierTotal(data.total);
      setSupplierStats(statsData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load suppliers');
      setSupplierRows([]);
      setSupplierTotal(0);
    } finally {
      setSupplierLoading(false);
      setSupplierStatsLoading(false);
    }
  }, [activeSupplierId, branchId, supplierFilters, supplierPage, supplierPageSize, tab]);

  useEffect(() => {
    void loadSuppliersList();
  }, [loadSuppliersList]);

  useEffect(() => {
    if (!activeSupplierId || tab !== 'suppliers') {
      setSupplierDetail(null);
      return;
    }
    let cancelled = false;
    setSupplierLoading(true);
    setError(null);
    purchaseService
      .getSupplierDetail(activeSupplierId, branchId)
      .then((d) => {
        if (!cancelled) setSupplierDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load supplier detail');
      })
      .finally(() => {
        if (!cancelled) setSupplierLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSupplierId, branchId, tab]);

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

  useEffect(() => {
    if (!branchId || !isReceiptsTab) return;
    inventoryService
      .getAllLocations({ branchId, isActive: true })
      .then((locs) => setLocations(locs.filter((l) => l.isActive !== false)))
      .catch(() => setLocations([]));
  }, [branchId, isReceiptsTab]);

  useEffect(() => {
    if (!isReceiptsTab) return;
    const cur = searchParams.get('receiptDate');
    if (cur && /^\d{4}-\d{2}-\d{2}$/.test(cur)) return;
    const p = new URLSearchParams(searchParams);
    p.set('receiptDate', localDateISO());
    setSearchParams(p, { replace: true });
  }, [isReceiptsTab, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isReceiptsTab || !branchId || locations.length === 0 || receivingLocationId) return;
    const pickId = pickDefaultReceivingLocationId(locations);
    if (!pickId) return;
    const p = new URLSearchParams(searchParams);
    p.set('receivingLocationId', pickId);
    setSearchParams(p, { replace: true });
  }, [branchId, isReceiptsTab, locations, receivingLocationId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isReceiptsTab || !purchaseOrderId || !branchId) {
      setLinkedPoSummary(null);
      return;
    }
    let cancelled = false;
    purchaseService
      .getOrder(purchaseOrderId, branchId)
      .then((po) => {
        if (cancelled) return;
        setLinkedPoSummary({ id: po.id, poNumber: po.poNumber });
        if (!po.deliveryLocationId) return;
        const p = new URLSearchParams(searchParams);
        if (!p.get('receivingLocationId')) {
          p.set('receivingLocationId', po.deliveryLocationId);
          setSearchParams(p, { replace: true });
        }
      })
      .catch(() => {
        if (!cancelled) setLinkedPoSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, isReceiptsTab, purchaseOrderId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isReceiptsTab) {
      setPoPickerOpen(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== 'o') return;
      e.preventDefault();
      e.stopPropagation();
      setPoPickerOpen(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isReceiptsTab]);

  useEffect(() => {
    if (poPickerOpen) document.body.dataset.receiptPoPickerOpen = '1';
    else delete document.body.dataset.receiptPoPickerOpen;
    return () => {
      delete document.body.dataset.receiptPoPickerOpen;
    };
  }, [poPickerOpen]);

  const supplierOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(r.supplierId, r.supplierName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const setReceivingLocationId = useCallback(
    (id: string) => {
      const p = new URLSearchParams(searchParams);
      if (id) p.set('receivingLocationId', id);
      else p.delete('receivingLocationId');
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const setTab = (next: PurchaseTab) => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', next);
    p.delete('mode');
    setSearchParams(p, { replace: true });
    if (activeOrderId) navigate(`/purchases?${p.toString()}`, { replace: true });
    if (activeSupplierId) navigate(`/purchases?${p.toString()}`, { replace: true });
  };

  const linkPurchaseOrder = useCallback(
    (order: PurchaseOrder) => {
      const p = new URLSearchParams(searchParams);
      p.set('purchaseOrderId', order.id);
      if (order.deliveryLocationId) p.set('receivingLocationId', order.deliveryLocationId);
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const clearLinkedPo = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.delete('purchaseOrderId');
    setSearchParams(p, { replace: true });
  }, [searchParams, setSearchParams]);

  const setReceiptDateParam = useCallback(
    (ymd: string) => {
      const p = new URLSearchParams(searchParams);
      if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) p.set('receiptDate', ymd);
      else p.delete('receiptDate');
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const openCreate = () => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', 'orders');
    p.set('mode', 'create');
    p.delete('supplierId');
    setSearchParams(p, { replace: true });
  };

  const openCreatePoForSupplier = useCallback(
    (supplierId: string) => {
      const p = new URLSearchParams();
      p.set('tab', 'orders');
      p.set('mode', 'create');
      p.set('supplierId', supplierId);
      navigate(`/purchases?${p.toString()}`, { replace: true });
    },
    [navigate]
  );

  const createSupplierId = searchParams.get('supplierId')?.trim() || null;

  const isOrdersListView = tab === 'orders' && mode === 'list' && !activeOrderId;
  const isSuppliersListView = tab === 'suppliers' && !activeSupplierId;
  const isReturnsListView = tab === 'returns';
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const supplierPageCount = Math.max(1, Math.ceil(supplierTotal / supplierPageSize));

  const patchListFilters = useCallback((patch: Partial<PurchaseOrderListFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
    setHighlightedOrderId(null);
    ordersListReturnRef.current = null;
  }, []);

  const clearAllListFilters = useCallback(() => {
    setFilters({ ...EMPTY_PURCHASE_ORDER_LIST_FILTERS });
    setPage(1);
    setHighlightedOrderId(null);
    ordersListReturnRef.current = null;
  }, []);

  const patchSupplierFilters = useCallback((patch: Partial<PurchaseSupplierListFilters>) => {
    setSupplierFilters((prev) => ({ ...prev, ...patch }));
    setSupplierPage(1);
    setHighlightedSupplierId(null);
    suppliersListReturnRef.current = null;
  }, []);

  const clearAllSupplierFilters = useCallback(() => {
    setSupplierFilters({ ...EMPTY_SUPPLIER_LIST_FILTERS });
    setSupplierPage(1);
    setHighlightedSupplierId(null);
    suppliersListReturnRef.current = null;
  }, []);

  const patchReturnFilters = useCallback((patch: Partial<PurchaseReturnListFilters>) => {
    setReturnFilters((prev) => ({ ...prev, ...patch }));
    setReturnHighlightedIndex(0);
  }, []);

  const clearAllReturnFilters = useCallback(() => {
    setReturnFilters({ ...EMPTY_RETURN_LIST_FILTERS });
    setReturnHighlightedIndex(0);
  }, []);

  const handleOrdersPageChange = useCallback((nextPage: number) => {
    setHighlightedOrderId(null);
    ordersListReturnRef.current = null;
    setPage(nextPage);
  }, []);

  const handleSupplierPageChange = useCallback((nextPage: number) => {
    setHighlightedSupplierId(null);
    suppliersListReturnRef.current = null;
    setSupplierPage(nextPage);
  }, []);

  useEffect(() => {
    if (!isOrdersListView) {
      setFilterDrawerOpen(false);
      return;
    }

    if (rows.length === 0) {
      setHighlightedRowIndex(0);
      return;
    }

    const returnCtx = ordersListReturnRef.current;
    if (highlightedOrderId && returnCtx?.orderId === highlightedOrderId && returnCtx.page !== page) {
      const idxOnPage = rows.findIndex((row) => row.id === highlightedOrderId);
      if (idxOnPage < 0) {
        setPage(returnCtx.page);
        return;
      }
    }

    if (highlightedOrderId) {
      const idx = rows.findIndex((row) => row.id === highlightedOrderId);
      if (idx >= 0) {
        setHighlightedRowIndex(idx);
        ordersListReturnRef.current = null;
        return;
      }
    }

    setHighlightedRowIndex((prev) => Math.min(prev, rows.length - 1));
  }, [highlightedOrderId, isOrdersListView, page, rows]);

  useEffect(() => {
    if (!isOrdersListView) return;
    setHighlightedRowIndex(0);
    setHighlightedOrderId(null);
    ordersListReturnRef.current = null;
  }, [filters]);

  useEffect(() => {
    if (!isSuppliersListView) {
      setSupplierFilterDrawerOpen(false);
      return;
    }

    if (supplierRows.length === 0) {
      setSupplierHighlightedRowIndex(0);
      return;
    }

    const returnCtx = suppliersListReturnRef.current;
    if (
      highlightedSupplierId &&
      returnCtx?.supplierId === highlightedSupplierId &&
      returnCtx.page !== supplierPage
    ) {
      const idxOnPage = supplierRows.findIndex((row) => row.supplierId === highlightedSupplierId);
      if (idxOnPage < 0) {
        setSupplierPage(returnCtx.page);
        return;
      }
    }

    if (highlightedSupplierId) {
      const idx = supplierRows.findIndex((row) => row.supplierId === highlightedSupplierId);
      if (idx >= 0) {
        setSupplierHighlightedRowIndex(idx);
        suppliersListReturnRef.current = null;
        return;
      }
    }

    setSupplierHighlightedRowIndex((prev) => Math.min(prev, supplierRows.length - 1));
  }, [highlightedSupplierId, isSuppliersListView, supplierPage, supplierRows]);

  useEffect(() => {
    if (!isSuppliersListView) return;
    setSupplierHighlightedRowIndex(0);
    setHighlightedSupplierId(null);
    suppliersListReturnRef.current = null;
  }, [supplierFilters]);

  const receiveFromList = useCallback(
    (order: PurchaseOrder) => {
      const p = new URLSearchParams();
      p.set('tab', 'receipts');
      p.set('purchaseOrderId', order.id);
      if (order.deliveryLocationId) p.set('receivingLocationId', order.deliveryLocationId);
      navigate(`/purchases?${p.toString()}`, { replace: true });
    },
    [navigate]
  );

  const selectOrderRow = useCallback(
    (index: number) => {
      setHighlightedRowIndex(index);
      const row = rows[index];
      if (row) setHighlightedOrderId(row.id);
    },
    [rows]
  );

  const openOrder = useCallback(
    (orderId: string) => {
      setHighlightedOrderId(orderId);
      ordersListReturnRef.current = { page, orderId };
      navigate(`/purchases/orders/${orderId}?tab=orders`, { replace: true });
    },
    [navigate, page]
  );

  usePurchaseOrdersListKeyboard({
    enabled: isOrdersListView,
    rows,
    page,
    pageCount,
    filterDrawerOpen,
    onFilterDrawerOpenChange: setFilterDrawerOpen,
    searchInputRef,
    onCreate: openCreate,
    onFiltersChange: patchListFilters,
    onClearAllFilters: clearAllListFilters,
    onOpenOrder: openOrder,
    onReceiveOrder: receiveFromList,
    onPageChange: handleOrdersPageChange,
    highlightedRowIndex,
    onHighlightedRowIndexChange: selectOrderRow,
  });

  const selectSupplierRow = useCallback(
    (index: number) => {
      setSupplierHighlightedRowIndex(index);
      const row = supplierRows[index];
      if (row) setHighlightedSupplierId(row.supplierId);
    },
    [supplierRows]
  );

  const openSupplier = useCallback(
    (supplierId: string) => {
      setHighlightedSupplierId(supplierId);
      suppliersListReturnRef.current = { page: supplierPage, supplierId };
      navigate(`/purchases/suppliers/${encodeURIComponent(supplierId)}?tab=suppliers`, { replace: true });
    },
    [navigate, supplierPage]
  );

  usePurchaseSuppliersListKeyboard({
    enabled: isSuppliersListView,
    filters: supplierFilters,
    rows: supplierRows,
    page: supplierPage,
    pageCount: supplierPageCount,
    filterDrawerOpen: supplierFilterDrawerOpen,
    onFilterDrawerOpenChange: setSupplierFilterDrawerOpen,
    searchInputRef: supplierSearchInputRef,
    onFiltersChange: patchSupplierFilters,
    onClearAllFilters: clearAllSupplierFilters,
    onOpenSupplier: openSupplier,
    onPageChange: handleSupplierPageChange,
    highlightedRowIndex: supplierHighlightedRowIndex,
    onHighlightedRowIndexChange: selectSupplierRow,
  });

  const refreshSupplierDetail = useCallback(async () => {
    if (!activeSupplierId) return;
    const d = await purchaseService.getSupplierDetail(activeSupplierId, branchId);
    setSupplierDetail(d);
    await loadSuppliersList();
  }, [activeSupplierId, branchId, loadSuppliersList]);

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

  const confirmDetailOrder = async () => {
    if (!detail) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await purchaseService.confirmOrder(detail.id, branchId);
      setDetail(updated);
      await loadList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not confirm order');
    } finally {
      setLoading(false);
    }
  };

  const headerTitle =
    activeOrderId && detail
      ? detail.poNumber
      : activeSupplierId && supplierDetail
        ? supplierDetail.supplierName
        : tab === 'orders' && mode === 'create'
          ? 'Create order'
          : tab === 'orders'
            ? 'Orders'
            : tab === 'suppliers'
              ? 'Suppliers'
              : tab.charAt(0).toUpperCase() + tab.slice(1);

  const navigateBackFromOrderDetail = useCallback(() => {
    if (returnSupplierId) {
      navigate(`/purchases/suppliers/${encodeURIComponent(returnSupplierId)}?tab=suppliers`, {
        replace: true,
      });
      return;
    }
    navigate('/purchases?tab=orders', { replace: true });
  }, [navigate, returnSupplierId]);

  const receiptsHeaderContext = isReceiptsTab ? (
    <div className="sales-module-header__branch-stack">
      <input
        type="date"
        className="sales-module-header__invoice-date"
        value={receiptDateYmd}
        min="2000-01-01"
        max={localDateISO(new Date(Date.now() + 2 * 86400000))}
        onChange={(e) => setReceiptDateParam(e.target.value)}
        aria-label="Receipt date"
        title="Commercial receipt date for goods received"
      />
      {branchId ? (
        <ReceivingLocationSelect
          branchId={branchId}
          appearance="header"
          value={receivingLocationId}
          onChange={(id) => setReceivingLocationId(id)}
          placeholder="Default storage location"
        />
      ) : null}
      {purchaseOrderId && linkedPoSummary ? (
        <span className="link-po-header-chip" title={`Linked to ${linkedPoSummary.poNumber}`}>
          <span className="link-po-header-chip__text">PO {linkedPoSummary.poNumber}</span>
          <button
            type="button"
            className="link-po-header-chip__clear"
            aria-label="Unlink purchase order"
            onClick={clearLinkedPo}
          >
            ×
          </button>
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="link-po-header-btn"
          disabled={!branchId}
          onClick={() => setPoPickerOpen(true)}
          title="Link an open purchase order (Ctrl+Shift+O)"
        >
          Link PO
        </Button>
      )}
    </div>
  ) : null;

  const ordersContent =
    activeOrderId && detail ? (
      <PurchaseOrderDetailPage
        order={detail}
        branchId={branchId}
        loading={loading}
        onBack={navigateBackFromOrderDetail}
        onConfirmOrder={() => void confirmDetailOrder()}
        onCancelOrder={() => void cancelDetailOrder()}
        onReceiveGoods={() => {
          const p = new URLSearchParams();
          p.set('tab', 'receipts');
          p.set('purchaseOrderId', detail.id);
          if (detail.deliveryLocationId) p.set('receivingLocationId', detail.deliveryLocationId);
          navigate(`/purchases?${p.toString()}`, { replace: true });
        }}
        onNavbarTrailingChange={setDetailNavbarTrailing}
      />
    ) : mode === 'create' ? (
      <PurchaseOrderCreatePage
        branchId={branchId}
        supplierOptions={supplierOptions}
        orderRows={rows}
        initialSupplierId={createSupplierId}
        onCancel={() => {
          const p = new URLSearchParams();
          p.set('tab', 'orders');
          navigate(`/purchases?${p.toString()}`, { replace: true });
        }}
        onSaved={onCreated}
        onNavbarTrailingChange={setCreateNavbarTrailing}
      />
    ) : (
      <PurchaseOrdersListPanel
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={loading}
        stats={stats}
        statsLoading={statsLoading}
        filters={filters}
        supplierOptions={supplierOptions}
        onFiltersChange={patchListFilters}
        onPageChange={handleOrdersPageChange}
        onCreate={openCreate}
        onOpenOrder={openOrder}
        onReceiveOrder={receiveFromList}
        highlightedRowIndex={highlightedRowIndex}
        onHighlightedRowIndexChange={selectOrderRow}
      />
    );

  const clearReturnBillParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('returnBillId');
        return p;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const suppliersContent =
    activeSupplierId && supplierDetail ? (
      <PurchaseSupplierDetailPage
        detail={supplierDetail}
        branchId={branchId}
        loading={supplierLoading}
        onBack={() => navigate('/purchases?tab=suppliers', { replace: true })}
        onRefresh={() => void refreshSupplierDetail()}
        onNewPo={openCreatePoForSupplier}
      />
    ) : (
      <PurchaseSuppliersListPanel
        rows={supplierRows}
        total={supplierTotal}
        page={supplierPage}
        pageSize={supplierPageSize}
        loading={supplierLoading}
        stats={supplierStats}
        statsLoading={supplierStatsLoading}
        filters={supplierFilters}
        onFiltersChange={patchSupplierFilters}
        onPageChange={handleSupplierPageChange}
        onOpenSupplier={openSupplier}
        highlightedRowIndex={supplierHighlightedRowIndex}
        onHighlightedRowIndexChange={selectSupplierRow}
      />
    );

  return (
    <div className={`sales-page sales-page--unified${isReceiptsTab ? ' sales-page--pos-focus' : ''}`}>
      <SalesModuleHeader
        title={headerTitle}
        tabs={TABS}
        activeTab={tab}
        onTabChange={(id) => setTab(id as PurchaseTab)}
        tabListAriaLabel="Purchases sections"
        contextSlot={receiptsHeaderContext}
        trailing={
          isOrdersListView ? (
            <PurchaseOrdersListControls
              filters={filters}
              supplierOptions={supplierOptions}
              filterDrawerOpen={filterDrawerOpen}
              onFilterDrawerOpenChange={setFilterDrawerOpen}
              searchInputRef={searchInputRef}
              onFiltersChange={patchListFilters}
              onCreate={openCreate}
            />
          ) : tab === 'orders' && mode === 'create' ? (
            createNavbarTrailing
          ) : activeOrderId && detail ? (
            detailNavbarTrailing
          ) : isSuppliersListView ? (
            <PurchaseSuppliersListControls
              filters={supplierFilters}
              filterDrawerOpen={supplierFilterDrawerOpen}
              onFilterDrawerOpenChange={setSupplierFilterDrawerOpen}
              searchInputRef={supplierSearchInputRef}
              onFiltersChange={patchSupplierFilters}
              onCreateSupplier={() => setCreateSupplierOpen(true)}
            />
          ) : isReturnsListView ? (
            <PurchaseReturnsListControls
              filters={returnFilters}
              filterDrawerOpen={returnFilterDrawerOpen}
              onFilterDrawerOpenChange={setReturnFilterDrawerOpen}
              searchInputRef={returnSearchInputRef}
              onFiltersChange={patchReturnFilters}
              onCreate={() => setReturnWizardOpen(true)}
            />
          ) : undefined
        }
        trailingClassName="sales-module-header__actions--nowrap"
      />

      <div className="sales-page-scroll">
        {error ? (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              borderRadius: 10,
              padding: 10,
              margin: '0 0 12px',
            }}
          >
            {error}
          </div>
        ) : null}

        {tab === 'orders' ? (
          ordersContent
        ) : tab === 'receipts' ? (
          <PurchaseReceiptsPanel
            branchId={branchId}
            locationId={receivingLocationId}
            receiptDateYmd={receiptDateYmd}
            purchaseOrderId={purchaseOrderId}
            onPosted={() => {
              if (purchaseOrderId) {
                const p = new URLSearchParams(searchParams);
                p.delete('purchaseOrderId');
                setSearchParams(p, { replace: true });
              }
            }}
            onUnlinkPo={clearLinkedPo}
          />
        ) : tab === 'suppliers' ? (
          suppliersContent
        ) : tab === 'returns' ? (
          <PurchaseReturnsPanel
            branchId={branchId}
            hideControls
            filters={returnFilters}
            onFiltersChange={patchReturnFilters}
            filterDrawerOpen={returnFilterDrawerOpen}
            onFilterDrawerOpenChange={setReturnFilterDrawerOpen}
            searchInputRef={returnSearchInputRef}
            highlightedRowIndex={returnHighlightedIndex}
            onHighlightedRowIndexChange={setReturnHighlightedIndex}
            wizardOpen={returnWizardOpen}
            onWizardOpenChange={setReturnWizardOpen}
            initialBillId={returnBillId}
            onInitialBillConsumed={clearReturnBillParam}
          />
        ) : null}

      </div>

      <LinkPurchaseOrderModal
        isOpen={poPickerOpen}
        branchId={branchId}
        selectedPurchaseOrderId={purchaseOrderId}
        onClose={() => setPoPickerOpen(false)}
        onLink={linkPurchaseOrder}
        onUnlink={clearLinkedPo}
      />

      <SupplierFormModal
        isOpen={createSupplierOpen}
        branchId={branchId}
        mode="create"
        onClose={() => setCreateSupplierOpen(false)}
        onSaved={(master) => {
          setCreateSupplierOpen(false);
          void loadSuppliersList();
          openSupplier(master.supplierCode);
        }}
      />
    </div>
  );
};
