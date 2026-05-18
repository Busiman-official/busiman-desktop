/**
 * Attendance module shell — sticky tab navbar on every /attendance/* route.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Outlet, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import { authStore } from '@/store/authStore';
import { UserRole } from '@/types';
import { SalesModuleHeader } from '@/features/sales/components/SalesModuleHeader';
import { IndicatorRipple } from '@/features/sales/components/indicator_ripple';
import { usePendingApprovalsCount } from '../hooks/usePendingApprovalsCount';
import {
  defaultTabForRole,
  TAB_APPROVALS,
  TAB_OVERVIEW,
  tabsForRole,
  VALID_TABS,
  type AttendanceTab,
} from '../attendanceTabs';
import './AttendanceLayout.css';

export const AttendanceLayout: React.FC = () => {
  const { user } = authStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isUpdatingTabRef = useRef(false);
  const employeeDetailMatch = useMatch({
    path: '/attendance/employees/:employeeId',
    end: true,
  });
  const isEmployeeDetail = Boolean(employeeDetailMatch);

  const role = user?.role ?? UserRole.EMPLOYEE;
  const visibleTabs = useMemo(() => tabsForRole(role), [role]);
  const canApprove =
    role === UserRole.MANAGER || role === UserRole.HR || role === UserRole.ADMIN;
  const { hasPending } = usePendingApprovalsCount(canApprove);

  const headerTabs = useMemo(() => {
    if (!hasPending) return visibleTabs;
    return visibleTabs.map((tab) => {
      if (tab.id !== TAB_APPROVALS) return tab;
      return {
        ...tab,
        label: (
          <span className="sales-module-header__tab-label">
            {tab.label}
            <IndicatorRipple
              className="sales-module-header__tab-indicator"
              title="Pending attendance approvals"
            />
          </span>
        ),
      };
    });
  }, [visibleTabs, hasPending]);

  const rawTab = searchParams.get('tab') || defaultTabForRole(role);
  const activeTab: AttendanceTab =
    VALID_TABS.has(rawTab) && visibleTabs.some((t) => t.id === rawTab)
      ? (rawTab as AttendanceTab)
      : defaultTabForRole(role);

  useEffect(() => {
    if (isUpdatingTabRef.current) return;
    const urlTab = searchParams.get('tab');
    if (urlTab === activeTab && visibleTabs.some((t) => t.id === activeTab)) return;
    if (urlTab && VALID_TABS.has(urlTab) && visibleTabs.some((t) => t.id === urlTab)) return;

    isUpdatingTabRef.current = true;
    const next = new URLSearchParams(searchParams);
    next.set('tab', activeTab);
    setSearchParams(next, { replace: true });
    setTimeout(() => {
      isUpdatingTabRef.current = false;
    }, 0);
  }, [activeTab, searchParams, setSearchParams, visibleTabs]);

  const onTabChange = useCallback(
    (id: string) => {
      isUpdatingTabRef.current = true;
      const next = new URLSearchParams(searchParams);
      next.set('tab', id);
      if (isEmployeeDetail) {
        navigate(`/attendance?${next.toString()}`);
      } else {
        setSearchParams(next, { replace: true });
      }
      setTimeout(() => {
        isUpdatingTabRef.current = false;
      }, 0);
    },
    [isEmployeeDetail, navigate, searchParams, setSearchParams]
  );

  const tabActiveOverride = useCallback(
    (tabId: string) => {
      if (tabId === TAB_OVERVIEW && isEmployeeDetail) return true;
      return activeTab === tabId;
    },
    [activeTab, isEmployeeDetail]
  );

  if (!user) {
    return null;
  }

  return (
    <div className="attendance-layout">
      <SalesModuleHeader
        tabs={headerTabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
        tabActiveOverride={tabActiveOverride}
        tabListAriaLabel="Attendance sections"
      />
      <div className="attendance-layout__content">
        <Outlet />
      </div>
    </div>
  );
};
