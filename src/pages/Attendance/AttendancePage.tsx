/**
 * Attendance tab panels — module header lives in AttendanceLayout.
 */

import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { authStore } from '@/store/authStore';
import { UserRole } from '@/types';
import { AttendanceList } from '@/features/attendance/components/AttendanceList';
import { AttendanceMyAttendancePanel } from '@/features/attendance/components/panels/AttendanceMyAttendancePanel';
import { AttendanceSetupPanel } from '@/features/attendance/components/panels/AttendanceSetupPanel';
import { AttendanceApprovalsPanel } from '@/features/attendance/components/panels/AttendanceApprovalsPanel';
import {
  defaultTabForRole,
  TAB_MY,
  TAB_OVERVIEW,
  TAB_APPROVALS,
  TAB_SETUP,
  roleShowsOverview,
  VALID_TABS,
  type AttendanceTab,
} from '@/features/attendance/attendanceTabs';
import './AttendancePage.css';

export const AttendancePage: React.FC = () => {
  const { user } = authStore();
  const [searchParams] = useSearchParams();

  const role = user?.role ?? UserRole.EMPLOYEE;
  const rawTab = searchParams.get('tab') || defaultTabForRole(role);
  const activeTab: AttendanceTab = VALID_TABS.has(rawTab)
    ? (rawTab as AttendanceTab)
    : defaultTabForRole(role);

  const showOverview = useMemo(() => roleShowsOverview(role), [role]);

  if (!user) {
    return null;
  }

  return (
    <div className="attendance-page">
      {activeTab === TAB_OVERVIEW && showOverview && <AttendanceList role={role} />}
      {activeTab === TAB_MY && role !== UserRole.ADMIN && <AttendanceMyAttendancePanel />}
      {activeTab === TAB_APPROVALS &&
        (role === UserRole.MANAGER || role === UserRole.HR || role === UserRole.ADMIN) && (
          <AttendanceApprovalsPanel />
        )}
      {activeTab === TAB_SETUP && (role === UserRole.HR || role === UserRole.ADMIN) && (
        <AttendanceSetupPanel />
      )}
    </div>
  );
};
