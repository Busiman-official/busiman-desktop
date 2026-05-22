/**
 * Attendance List Component
 * Shows attendance records based on role permissions
 * Toggle status column for Admin/HR/Manager to mark attendance
 */

import React, { useState, useEffect, useMemo, useCallback, useDeferredValue } from 'react';
import { useNavigate } from 'react-router-dom';
import { attendanceService } from '@/services/attendance.service';
import { useAttendanceSocket } from '@/features/attendance/hooks/useAttendanceSocket';
import { authStore } from '@/store/authStore';
import {
  AttendanceDashboardData,
  AttendanceSessionStatus,
  AttendanceApprovalStatus,
  UserRole,
} from '@/types';
import { MarkAttendanceDialog } from './MarkAttendanceDialog';
import {
  dashboardRowsToExportRows,
  downloadAttendanceCsvFromRows,
} from '@/features/attendance/utils/exportAttendanceCsv';
import { Button, Input, Select } from '@/shared/components/ui';
import { ModuleHeaderOutlineButton } from '@/shared/components/module-header/ModuleHeaderButton';
import { logger } from '@/shared/utils/logger';
import { canManualOverrideAttendance } from '@/features/attendance/utils/canManualOverrideAttendance';
import { canMarkAttendanceForOthers } from '@/features/attendance/utils/attendanceAccess';
import { localDateISO } from '@/features/attendance/utils/calendarDate';
import './AttendanceList.css';

interface AttendanceListProps {
  role: UserRole;
}

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: AttendanceSessionStatus.CHECKED_IN, label: 'Checked in' },
  { value: AttendanceSessionStatus.CHECKED_OUT, label: 'Checked out' },
  { value: AttendanceSessionStatus.NOT_STARTED, label: 'Not started' },
];

export const AttendanceList: React.FC<AttendanceListProps> = ({ role }) => {
  const navigate = useNavigate();
  const { user } = authStore();
  const [dashboardData, setDashboardData] = useState<AttendanceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(localDateISO());
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearch = useDeferredValue(searchQuery);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<{
    id: string;
    name: string;
    status: AttendanceSessionStatus;
  } | null>(null);

  const canMarkForOthers = canMarkAttendanceForOthers(role, user?.branchDepartments);

  const loadAttendanceList = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const q = deferredSearch.trim();
      const data = await attendanceService.getDashboard({
        date: selectedDate,
        department: role === UserRole.MANAGER ? undefined : departmentFilter || undefined,
        status: statusFilter || undefined,
        search: q || undefined,
        page,
        limit: pageSize,
      });
      setDashboardData(data);
    } catch (err: unknown) {
      const apiMessage =
        err &&
        typeof err === 'object' &&
        'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setError(apiMessage ?? 'Failed to load attendance data');
    } finally {
      setLoading(false);
    }
  }, [
    selectedDate,
    role,
    user?.department,
    departmentFilter,
    statusFilter,
    deferredSearch,
    page,
    pageSize,
  ]);

  useEffect(() => {
    setPage(1);
  }, [selectedDate, departmentFilter, statusFilter, deferredSearch]);

  useEffect(() => {
    void loadAttendanceList();
  }, [loadAttendanceList]);

  useAttendanceSocket({
    onStatus: () => {
      void loadAttendanceList();
    },
    onDashboardRefresh: () => {
      void loadAttendanceList();
    },
  });

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const getStatusBadge = (
    status: AttendanceSessionStatus,
    row?: (typeof rows)[0]
  ): string => {
    if (row?.checkInApprovalStatus === AttendanceApprovalStatus.PENDING) {
      return 'Pending check-in';
    }
    if (row?.checkOutApprovalStatus === AttendanceApprovalStatus.PENDING) {
      return 'Pending check-out';
    }
    switch (status) {
      case AttendanceSessionStatus.CHECKED_IN:
        return row?.isOfficiallyPresent === false ? 'Checked in (pending)' : 'Checked In';
      case AttendanceSessionStatus.CHECKED_OUT:
        return row?.checkOutApprovalStatus === AttendanceApprovalStatus.APPROVED ||
          row?.isOfficiallyPresent
          ? 'Checked Out'
          : 'Checked out (pending)';
      default:
        return 'Not Started';
    }
  };

  const getStatusClass = (status: AttendanceSessionStatus): string => {
    switch (status) {
      case AttendanceSessionStatus.CHECKED_IN:
        return 'status-checked-in';
      case AttendanceSessionStatus.CHECKED_OUT:
        return 'status-checked-out';
      default:
        return 'status-not-started';
    }
  };

  const isValidObjectId = (id: unknown): boolean => {
    if (!id || typeof id !== 'string') return false;
    if (id === 'unknown' || id === 'null') return false;
    return /^[0-9a-fA-F]{24}$/.test(id);
  };

  const rows = useMemo(() => {
    if (!dashboardData || role === UserRole.EMPLOYEE) return [];
    return dashboardData.rows.filter(
      (item) => item.employeeId && isValidObjectId(item.employeeId)
    );
  }, [dashboardData, role]);

  const total = dashboardData?.total ?? 0;
  const pageFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageTo = Math.min(total, page * pageSize);

  const canMarkRow = useCallback(
    (record: (typeof rows)[0]) =>
      !!user &&
      canManualOverrideAttendance({ id: user.id, role: user.role }, record),
    [user]
  );

  const handleStatusToggle = (record: (typeof rows)[0]) => {
    if (!canMarkForOthers || !canMarkRow(record)) return;

    const employeeId = record.employeeId;
    if (!isValidObjectId(employeeId)) {
      logger.warn('[AttendanceList] Invalid employeeId for record', { record });
      setError(
        `Unable to mark attendance for ${record.employeeName || 'this employee'}. Please refresh the page.`
      );
      setTimeout(() => setError(null), 5000);
      return;
    }

    setError(null);
    setSelectedEmployee({
      id: employeeId,
      name: record.employeeName || 'Unknown',
      status: record.status,
    });
    setDialogOpen(true);
  };

  const openEmployeeDetails = (record: (typeof rows)[0]) => {
    if (!isValidObjectId(record.employeeId)) return;
    navigate(`/attendance/employees/${record.employeeId}?date=${selectedDate}`);
  };

  const handleExport = async () => {
    try {
      const data = await attendanceService.getDashboard({
        date: selectedDate,
        department: role === UserRole.MANAGER ? undefined : departmentFilter || undefined,
        status: statusFilter || undefined,
        search: deferredSearch.trim() || undefined,
        page: 1,
        limit: 100,
      });
      if (!data.rows.length) return;
      downloadAttendanceCsvFromRows(dashboardRowsToExportRows(data.rows), selectedDate);
    } catch {
      setError('Export failed. Try again.');
    }
  };

  const getListTitle = (): string => {
    switch (role) {
      case UserRole.MANAGER:
        return 'Team Attendance';
      case UserRole.HR:
        return 'Employee & Manager Attendance';
      case UserRole.ADMIN:
        return 'Attendance Records';
      default:
        return 'Attendance Records';
    }
  };

  const departmentSelectOptions = useMemo(
    () => [
      { value: '', label: 'All departments' },
      ...(dashboardData?.departments ?? []).map((d) => ({ value: d, label: d })),
    ],
    [dashboardData?.departments]
  );

  if (loading && !dashboardData) {
    return (
      <div className="attendance-list">
        <div className="attendance-list-loading">Loading attendance data...</div>
      </div>
    );
  }

  return (
    <div className="attendance-list">
      <div className="attendance-list-header">
        <h2 className="attendance-list-title">{getListTitle()}</h2>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="attendance-list-date-filter"
          aria-label="Attendance date"
        />
      </div>

      <div className="attendance-list-toolbar">
        <Input
          type="search"
          placeholder="Search employees..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="attendance-list-search"
          aria-label="Search employees"
        />
        {role !== UserRole.MANAGER && (
          <Select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            options={departmentSelectOptions}
            className="attendance-list-filter-select"
            aria-label="Filter by department"
          />
        )}
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={STATUS_FILTER_OPTIONS}
          className="attendance-list-filter-select"
          aria-label="Filter by status"
        />
        <ModuleHeaderOutlineButton
          type="button"
          onClick={() => void handleExport()}
          disabled={total === 0}
          title="Export matching attendance (up to 100 rows) to CSV"
        >
          Export
        </ModuleHeaderOutlineButton>
      </div>

      {error && (
        <div className="attendance-list-error-banner" role="alert">
          {error}
          <button
            className="attendance-list-error-close"
            onClick={() => setError(null)}
            aria-label="Close error message"
          >
            ×
          </button>
        </div>
      )}

      {rows.length === 0 && !loading ? (
        <div className="attendance-list-empty">
          No attendance records found for the selected filters.
        </div>
      ) : (
        <div className="attendance-list-table-container">
          <table className="attendance-list-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Status{canMarkForOthers ? ' (Click to Toggle)' : ''}</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => (
                <tr key={record.employeeId}>
                  <td className="name-cell">
                    <button
                      type="button"
                      className="attendance-list-name-link"
                      onClick={() => openEmployeeDetails(record)}
                    >
                      {record.employeeName || 'Unknown'}
                    </button>
                  </td>
                  <td className="role-cell">
                    {record.role
                      ? record.role.charAt(0).toUpperCase() + record.role.slice(1)
                      : '--'}
                  </td>
                  <td className="department-cell">{record.department || '--'}</td>
                  <td>
                    {canMarkForOthers && canMarkRow(record) ? (
                      <button
                        type="button"
                        className={`status-toggle ${getStatusClass(record.status)}`}
                        onClick={() => handleStatusToggle(record)}
                        title="Click to mark attendance"
                      >
                        {getStatusBadge(record.status, record)}
                      </button>
                    ) : (
                      <span className={`status-badge ${getStatusClass(record.status)}`}>
                        {getStatusBadge(record.status, record)}
                      </span>
                    )}
                  </td>
                  <td className="time-cell">
                    {record.checkInTime ? formatTime(record.checkInTime) : '--'}
                  </td>
                  <td className="time-cell">
                    {record.checkOutTime ? formatTime(record.checkOutTime) : '--'}
                  </td>
                  <td className="duration-cell">
                    {record.totalDuration
                      ? formatDuration(record.totalDuration)
                      : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dashboardData ? (
        <>
          <div className="attendance-list-summary">
            <span>
              Page {pageFrom}-{pageTo} of {total}
            </span>
            <span>Checked In: {dashboardData.summary.checkedInCount}</span>
            <span>Checked Out: {dashboardData.summary.checkedOutCount}</span>
            <span>Not Started: {dashboardData.summary.notStartedCount}</span>
          </div>
          <div className="attendance-list-pagination">
            <Select
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              options={[
                { value: '10', label: '10 / page' },
                { value: '25', label: '25 / page' },
                { value: '50', label: '50 / page' },
                { value: '100', label: '100 / page' },
              ]}
              aria-label="Rows per page"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              Prev
            </Button>
            <span className="attendance-list-pagination__page">Page {page}</span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPage((p) => (p * pageSize < total ? p + 1 : p))}
              disabled={page * pageSize >= total || loading}
            >
              Next
            </Button>
          </div>
        </>
      ) : null}

      {selectedEmployee && (
        <MarkAttendanceDialog
          isOpen={dialogOpen}
          onClose={() => {
            setDialogOpen(false);
            setSelectedEmployee(null);
          }}
          employeeId={selectedEmployee.id}
          employeeName={selectedEmployee.name}
          currentStatus={selectedEmployee.status}
          onSuccess={loadAttendanceList}
        />
      )}
    </div>
  );
};
