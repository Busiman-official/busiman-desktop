/**
 * Sales workspace — URL-driven tabs (?tab=&salesPointId=&customerId=&branchId=)
 * Unified sticky module header (Orders, Customers, Sales points, History, Returns, Settings).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Select } from '@/shared/components/ui';
import { Branch, UserRole } from '@/types';
import { authStore } from '@/store/authStore';
import { branchService } from '@/services/branch.service';
import { useSalesBranchId } from '@/features/sales/hooks/useSalesBranchId';
import { SalesModuleHeader } from '@/features/sales/components/SalesModuleHeader';
import {
  SalesOrdersPanel,
  SalesCustomersPanel,
  SalesSalesPointsPanel,
  type SalesSalesPointsPanelHandle,
  SalesHistoryPanel,
  type SalesHistoryPanelHandle,
  SalesReturnsPanel,
  SalesSettingsPanel,
} from '@/features/sales/components/panels';
import { docId } from '@/features/sales/utils/ids';
import { salesService } from '@/services/sales.service';
import { CustomerDetailsPage } from './CustomerDetailsPage';
import { OrderDetailPage, OrderDetailHeaderActions } from './OrderDetailPage';
import './SalesPage.css';

const TAB_DEFS = [
  { id: 'orders', label: 'Orders' },
  { id: 'customers', label: 'Customers' },
  { id: 'salesPoints', label: 'Sales points' },
  { id: 'history', label: 'History' },
  { id: 'returns', label: 'Returns' },
  { id: 'settings', label: 'Settings' },
] as const;

type SalesTabId = (typeof TAB_DEFS)[number]['id'];
const VALID_TABS = new Set<string>(TAB_DEFS.map((t) => t.id));

const PAGE_TITLES: Record<SalesTabId, string> = {
  orders: 'Orders',
  customers: 'Customers',
  salesPoints: 'Sales points',
  history: 'History',
  returns: 'Returns',
  settings: 'Settings',
};

/** Aligns with server default-branch logic: DEFAULT code, then default name, else first by name. */
function pickDefaultBranchId(branches: Branch[]): string | null {
  if (branches.length === 0) return null;
  const byCode = branches.find((b) => b.code?.toUpperCase() === 'DEFAULT');
  if (byCode) return byCode.id;
  const byName = branches.find((b) => /^default/i.test(String(b.name || '')));
  if (byName) return byName.id;
  const sorted = [...branches].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
  );
  return sorted[0]?.id ?? null;
}

export const SalesPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const customerDetailMatch = useMatch({ path: '/sales/customers/:customerId', end: true });
  const isCustomerDetail = Boolean(customerDetailMatch);
  const orderDetailMatch = useMatch({ path: '/sales/orders/:orderId', end: true });
  const isOrderDetail = Boolean(orderDetailMatch);
  const orderDetailId = orderDetailMatch?.params.orderId;
  const branchId = useSalesBranchId();
  const user = authStore((s) => s.user);
  const isAdmin = user?.role === UserRole.ADMIN;
  const adminBranchLockedRef = useRef(!!searchParams.get('branchId'));

  const [branches, setBranches] = useState<Branch[]>([]);
  const [salesPoints, setSalesPoints] = useState<Record<string, unknown>[]>([]);
  const [customers, setCustomers] = useState<Record<string, unknown>[]>([]);

  const rawTab = searchParams.get('tab') || 'orders';
  const activeTab: SalesTabId = VALID_TABS.has(rawTab) ? (rawTab as SalesTabId) : 'orders';
  const isOrdersTab = activeTab === 'orders';
  const isCustomersTab = activeTab === 'customers';
  const isCustomersTabUi = isCustomersTab || isCustomerDetail;
  const isSalesPointsTab = activeTab === 'salesPoints';
  const isHistoryTab = activeTab === 'history';
  const isReturnsTab = activeTab === 'returns';

  const salesPointsPanelRef = useRef<SalesSalesPointsPanelHandle>(null);
  const historyPanelRef = useRef<SalesHistoryPanelHandle>(null);
  const [customerTopSearch, setCustomerTopSearch] = useState('');
  const [customerFilterSeq, setCustomerFilterSeq] = useState(0);
  const [customerAddSeq, setCustomerAddSeq] = useState(0);
  const [returnsNewSeq, setReturnsNewSeq] = useState(0);

  const salesPointId = searchParams.get('salesPointId');
  const customerId = searchParams.get('customerId');

  useEffect(() => {
    if (!searchParams.get('mode')) return;
    const p = new URLSearchParams(searchParams);
    p.delete('mode');
    setSearchParams(p, { replace: true });
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    if (!isAdmin) return;
    branchService.getBranches({ isActive: true }).then(setBranches).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    if (searchParams.get('branchId')) {
      adminBranchLockedRef.current = true;
      return;
    }
    if (branches.length === 0 || adminBranchLockedRef.current) return;
    const id = pickDefaultBranchId(branches);
    if (!id) return;
    adminBranchLockedRef.current = true;
    const p = new URLSearchParams(searchParams);
    p.set('branchId', id);
    setSearchParams(p, { replace: true });
  }, [isAdmin, branches, searchParams, setSearchParams]);

  useEffect(() => {
    if (!branchId) return;
    salesService.listSalesPoints(branchId).then(setSalesPoints).catch(() => {});
    salesService
      .listCustomers(branchId)
      .then((res) => setCustomers(Array.isArray((res as any)?.rows) ? (res as any).rows : []))
      .catch(() => setCustomers([]));
  }, [branchId]);

  useEffect(() => {
    if (!branchId || salesPoints.length === 0 || salesPointId) return;
    const first = docId(salesPoints[0] as { _id?: string; id?: string });
    if (first) {
      const p = new URLSearchParams(searchParams);
      p.set('salesPointId', first);
      setSearchParams(p, { replace: true });
    }
  }, [branchId, salesPoints, salesPointId, searchParams, setSearchParams]);

  const setTab = useCallback(
    (id: SalesTabId) => {
      const p = new URLSearchParams(searchParams);
      p.set('tab', id);
      if (id === 'orders') {
        p.delete('customerId');
        p.delete('posOrderForCustomer');
      }
      if (isCustomerDetail || isOrderDetail) {
        navigate(`/sales?${p.toString()}`);
      } else {
        setSearchParams(p, { replace: true });
      }
    },
    [isCustomerDetail, isOrderDetail, navigate, searchParams, setSearchParams]
  );

  const setSalesPointId = useCallback(
    (id: string) => {
      const p = new URLSearchParams(searchParams);
      if (id) p.set('salesPointId', id);
      else p.delete('salesPointId');
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const goToOrdersForSalesPoint = useCallback(
    (id: string) => {
      if (!id) return;
      const p = new URLSearchParams(searchParams);
      p.set('tab', 'orders');
      p.set('salesPointId', id);
      p.delete('customerId');
      p.delete('posOrderForCustomer');
      if (isCustomerDetail || isOrderDetail) {
        navigate(`/sales?${p.toString()}`);
      } else {
        setSearchParams(p, { replace: true });
      }
    },
    [isCustomerDetail, isOrderDetail, navigate, searchParams, setSearchParams]
  );

  const setBranchQueryId = useCallback(
    (id: string) => {
      const p = new URLSearchParams(searchParams);
      if (id) p.set('branchId', id);
      else p.delete('branchId');
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const branchSelectOptions = useMemo(() => {
    const fromApi = branches.map((b) => ({
      value: b.id,
      label: `${b.name} (${b.code})`,
    }));
    const q = searchParams.get('branchId')?.trim();
    if (q && !fromApi.some((o) => o.value === q)) {
      fromApi.unshift({ value: q, label: `${q.slice(0, 10)}…` });
    }
    return [{ value: '', label: '— Select branch —' }, ...fromApi];
  }, [branches, searchParams]);

  const showBranchInHeader = isAdmin && !isCustomersTabUi;
  const branchSlot = showBranchInHeader ? (
    <Select
      value={searchParams.get('branchId') || ''}
      onChange={(e) => setBranchQueryId(e.target.value)}
      options={branchSelectOptions}
    />
  ) : !isCustomersTabUi ? (
    <span className="sales-module-header__branch-label">Your branch</span>
  ) : null;

  const spOptions = useMemo(
    () =>
      salesPoints.map((s) => ({
        value: docId(s as { _id?: string; id?: string }) || '',
        label: String((s as { name?: string }).name || ''),
      })),
    [salesPoints]
  );

  const salesPointContext =
    isOrdersTab && !isCustomerDetail && !isOrderDetail ? (
      <Select
        value={salesPointId || ''}
        onChange={(e) => setSalesPointId(e.target.value)}
        options={spOptions}
        placeholder="Sales point"
      />
    ) : null;

  const goNewOrder = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', 'orders');
    setSearchParams(p, { replace: true });
  }, [searchParams, setSearchParams]);

  const headerTrailing = isOrderDetail && orderDetailId ? (
    <OrderDetailHeaderActions orderId={orderDetailId} />
  ) : isCustomerDetail ? (
    <>
      <Input
        value={customerTopSearch}
        onChange={(e) => setCustomerTopSearch(e.target.value)}
        placeholder="Search customers by name, email, phone"
      />
      <Button type="button" variant="secondary" onClick={() => setCustomerFilterSeq((n) => n + 1)}>
        <span className="sales-filter-btn__icon" aria-hidden="true" />
        Filter
      </Button>
      <Button type="button" variant="primary" onClick={() => setCustomerAddSeq((n) => n + 1)}>
        + Add customer
      </Button>
    </>
  ) : isCustomersTab ? (
    <>
      <Input
        value={customerTopSearch}
        onChange={(e) => setCustomerTopSearch(e.target.value)}
        placeholder="Search customers by name, email, phone"
      />
      <Button type="button" variant="secondary" onClick={() => setCustomerFilterSeq((n) => n + 1)}>
        <span className="sales-filter-btn__icon" aria-hidden="true" />
        Filter
      </Button>
      <Button type="button" variant="primary" onClick={() => setCustomerAddSeq((n) => n + 1)}>
        + Add customer
      </Button>
    </>
  ) : isSalesPointsTab ? (
    <Button type="button" variant="primary" disabled={!branchId} onClick={() => salesPointsPanelRef.current?.openCreate()}>
      + Create sales point
    </Button>
  ) : isHistoryTab ? (
    <>
      <Button type="button" variant="secondary" onClick={() => historyPanelRef.current?.exportCsv()}>
        Export CSV
      </Button>
      <Button type="button" variant="primary" onClick={goNewOrder}>
        New order
      </Button>
    </>
  ) : isReturnsTab ? (
    <Button type="button" variant="primary" onClick={() => setReturnsNewSeq((n) => n + 1)}>
      + New return
    </Button>
  ) : null;

  const pageTitle = isOrderDetail ? 'Order' : isCustomerDetail ? PAGE_TITLES.customers : PAGE_TITLES[activeTab];

  const tabActiveOverride = useCallback(
    (tabId: string) => {
      if (tabId === 'customers' && isCustomerDetail) return true;
      if (tabId === 'history' && isOrderDetail) return true;
      return activeTab === tabId;
    },
    [activeTab, isCustomerDetail, isOrderDetail]
  );

  const ordersPanel = (
    <SalesOrdersPanel
      branchId={branchId}
      salesPointId={salesPointId}
      customerId={customerId}
      salesPoints={salesPoints}
      customers={customers}
    />
  );

  const pageContentMain = (
    <>
      {activeTab === 'orders' && ordersPanel}
      {activeTab === 'customers' && (
        <SalesCustomersPanel
          branchId={branchId}
          topSearchQuery={customerTopSearch}
          topFilterSeq={customerFilterSeq}
          topAddSeq={customerAddSeq}
        />
      )}
      {activeTab === 'salesPoints' && (
        <SalesSalesPointsPanel
          ref={salesPointsPanelRef}
          branchId={branchId}
          onGoToOrdersForSalesPoint={goToOrdersForSalesPoint}
        />
      )}
      {activeTab === 'history' && <SalesHistoryPanel ref={historyPanelRef} branchId={branchId} customers={customers} />}
      {activeTab === 'returns' && (
        <SalesReturnsPanel branchId={branchId} newReturnSeq={returnsNewSeq} />
      )}
      {activeTab === 'settings' && <SalesSettingsPanel branchId={branchId} />}
    </>
  );

  return (
    <div className="sales-page sales-page--unified">
      <SalesModuleHeader
        title={pageTitle}
        tabs={TAB_DEFS}
        activeTab={activeTab}
        onTabChange={(id) => setTab(id as SalesTabId)}
        tabActiveOverride={tabActiveOverride}
        branchSlot={branchSlot}
        contextSlot={salesPointContext}
        trailing={headerTrailing}
      />
      <div
        className={`sales-page-scroll${
          isCustomerDetail ? ' sales-page-scroll--customer-detail' : ''
        }${isOrderDetail ? ' sales-page-scroll--order-detail' : ''}`}
      >
        {isOrderDetail ? (
          <OrderDetailPage branches={branches} salesPoints={salesPoints} />
        ) : isCustomerDetail ? (
          <CustomerDetailsPage />
        ) : (
          pageContentMain
        )}
      </div>
    </div>
  );
};
