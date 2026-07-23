/**
 * Employee attendance profile — opened from Attendance Overview (name click).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { attendanceService } from '@/services/attendance.service';
import { useAttendanceSocket } from '@/features/attendance/hooks/useAttendanceSocket';
import { employeeDetailsService } from '@/services/employee.service';
import {
  AttendanceRecord,
  AttendanceSessionStatus,
  AttendanceApprovalStatus,
  EmployeeDetails,
  UpdateEmployeeDetailsRequest,
  UserRole,
} from '@/types';
import { authStore } from '@/store/authStore';
import {
  MarkAttendanceDialog,
  type MarkAttendanceDialogDefaults,
} from '@/features/attendance/components/MarkAttendanceDialog';
import { ShiftAttendanceSection } from '@/pages/Employee/sections/ShiftAttendanceSection';
import { LoadingState, ErrorState } from '@/shared/components/data-display';
import { ModuleHeaderOutlineButton } from '@/shared/components/module-header/ModuleHeaderButton';
import { Button, Input, Select } from '@/shared/components/ui';
import { downloadAttendanceCsvFromRows } from '@/features/attendance/utils/exportAttendanceCsv';
import { canManualOverrideAttendance } from '@/features/attendance/utils/canManualOverrideAttendance';
import { canMarkAttendanceForOthers } from '@/features/attendance/utils/attendanceAccess';
import { getHistoryRemoteNoteEntries } from '@/features/attendance/utils/formatHistoryRemoteNotes';
import {
  attendanceDateYmd,
  formatAttendanceDateLabel,
  localDateISO,
} from '@/features/attendance/utils/calendarDate';
import './EmployeeAttendanceDetailsPage.css';

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes?: number): string {
  if (minutes == null || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function statusLabel(status: AttendanceSessionStatus): string {
  switch (status) {
    case AttendanceSessionStatus.CHECKED_IN:
      return 'Checked in';
    case AttendanceSessionStatus.CHECKED_OUT:
      return 'Checked out';
    default:
      return 'Not started';
  }
}

function statusClass(status: AttendanceSessionStatus): string {
  switch (status) {
    case AttendanceSessionStatus.CHECKED_IN:
      return 'ead-status ead-status--in';
    case AttendanceSessionStatus.CHECKED_OUT:
      return 'ead-status ead-status--out';
    default:
      return 'ead-status ead-status--none';
  }
}

export const EmployeeAttendanceDetailsPage: React.FC = () => {
  const { employeeId } = useParams<{ employeeId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: currentUser } = authStore();

  const focusDate = searchParams.get('date') || localDateISO();

  const [employee, setEmployee] = useState<EmployeeDetails | null>(null);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return localDateISO(d);
  });
  const [endDate, setEndDate] = useState(localDateISO());
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(25);
  const [markOpen, setMarkOpen] = useState(false);
  const [markDialogStatus, setMarkDialogStatus] = useState<AttendanceSessionStatus>(
    AttendanceSessionStatus.NOT_STARTED
  );
  const [markDialogDefaults, setMarkDialogDefaults] =
    useState<MarkAttendanceDialogDefaults | null>(null);
  const [shiftExpanded, setShiftExpanded] = useState(false);

  const canMark =
    !!currentUser &&
    !!employee &&
    canMarkAttendanceForOthers(currentUser.role, currentUser.branchDepartments) &&
    canManualOverrideAttendance(
      { id: currentUser.id, role: currentUser.role },
      employee
    );

  const canEditShift =
    currentUser?.role === UserRole.HR || currentUser?.role === UserRole.ADMIN;

  const backUrl = `/attendance?tab=overview${focusDate ? `&date=${focusDate}` : ''}`;

  const loadEmployee = useCallback(async () => {
    if (!employeeId) return;
    const data = await employeeDetailsService.getEmployeeDetails(employeeId);
    setEmployee(data);
}, [employeeId]);

  const loadToday = useCallback(async () => {
    if (!employeeId) return;
    const { records } = await attendanceService.getHistory({
      employeeId,
      startDate: focusDate,
      endDate: focusDate,
      limit: 10,
    });
    const match =
      records.find((r) => attendanceDateYmd(r.date) === focusDate) ?? null;
    setTodayRecord(match);
  }, [employeeId, focusDate]);

  const loadHistory = useCallback(async () => {
    if (!employeeId) return;
    setHistoryLoading(true);
    try {
      const { records, total } = await attendanceService.getHistory({
        employeeId,
        startDate,
        endDate,
        page: historyPage,
        limit: historyPageSize,
      });
      setHistory(records);
      setHistoryTotal(total);
    } finally {
      setHistoryLoading(false);
    }
  }, [employeeId, startDate, endDate, historyPage, historyPageSize]);

  useEffect(() => {
    setHistoryPage(1);
  }, [startDate, endDate]);

  const loadAll = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadEmployee(), loadToday(), loadHistory()]);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setError(msg ?? 'Failed to load employee attendance');
    } finally {
      setLoading(false);
    }
  }, [employeeId, loadEmployee, loadToday, loadHistory]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useAttendanceSocket({
    enabled: !!employeeId,
    employeeIdFilter: employeeId,
    onStatus: () => {
      void loadToday();
      void loadHistory();
    },
    onDashboardRefresh: () => {
      void loadToday();
      void loadHistory();
    },
  });

  useEffect(() => {
    if (!loading && employeeId) {
      loadHistory();
    }
  }, [startDate, endDate, historyPage, historyPageSize, employeeId, loading, loadHistory]);

  const goBackToOverview = useCallback(() => {
    navigate(backUrl);
  }, [navigate, backUrl]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (markOpen) {
        e.preventDefault();
        setMarkOpen(false);
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      goBackToOverview();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [markOpen, goBackToOverview]);

  const handleEmployeeUpdate = async (request: UpdateEmployeeDetailsRequest) => {
    if (!employeeId || !employee) return;
    const updated = await employeeDetailsService.updateEmployeeDetails(employeeId, request);
    setEmployee(updated);
  };

  const todayStatus = todayRecord?.status ?? AttendanceSessionStatus.NOT_STARTED;

  const openMarkDialog = useCallback(
    (
      status: AttendanceSessionStatus,
      defaults?: MarkAttendanceDialogDefaults | null
    ) => {
      if (!canMark) return;
      setMarkDialogStatus(status);
      setMarkDialogDefaults(defaults ?? null);
      setMarkOpen(true);
    },
    [canMark]
  );

  const historyRowDefaults = (row: AttendanceRecord): MarkAttendanceDialogDefaults => ({
    date: attendanceDateYmd(row.date),
    checkInTime: row.checkInTime || undefined,
    checkOutTime: row.checkOutTime || undefined,
  });

  const renderStatusControl = (
    status: AttendanceSessionStatus,
    defaults?: MarkAttendanceDialogDefaults | null
  ) => {
    const label = statusLabel(status);
    if (canMark) {
      return (
        <button
          type="button"
          className={`${statusClass(status)} ead-status--clickable`}
          onClick={() => openMarkDialog(status, defaults)}
          title="Click to mark attendance"
        >
          {label}
        </button>
      );
    }
    return <span className={statusClass(status)}>{label}</span>;
  };

  const historyPageFrom = historyTotal === 0 ? 0 : (historyPage - 1) * historyPageSize + 1;
  const historyPageTo = Math.min(historyTotal, historyPage * historyPageSize);

  const handleExportHistory = async () => {
    if (!employee || !employeeId) return;
    const { records } = await attendanceService.getHistory({
      employeeId,
      startDate,
      endDate,
      page: 1,
      limit: 100,
    });
    if (!records.length) return;
    const rows = records.map((r) => ({
      employeeId: employee.id,
      employeeName: employee.name,
      department: employee.department,
      role: employee.role,
      status: r.status,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
      totalDuration: r.totalDuration,
      checkInApprovalStatus: r.checkInApproval?.status,
      checkOutApprovalStatus: r.checkOutApproval?.status,
      checkInRemoteNote: r.checkInApproval?.remoteNote?.trim() ?? '',
      checkOutRemoteNote: r.checkOutApproval?.remoteNote?.trim() ?? '',
      checkInMarkingFrom: r.checkInApproval?.markingFrom ?? '',
      checkOutMarkingFrom: r.checkOutApproval?.markingFrom ?? '',
      checkInRejectReason: r.checkInApproval?.rejectReason?.trim() ?? '',
      checkOutRejectReason: r.checkOutApproval?.rejectReason?.trim() ?? '',
    }));
    downloadAttendanceCsvFromRows(
      rows,
      `${startDate}_to_${endDate}`,
      `attendance_${employee.name.replace(/\s+/g, '_')}_${startDate}.csv`
    );
  };

  if (loading && !employee) {
    return (
      <div className="employee-attendance-details">
        <LoadingState message="Loading employee..." />
      </div>
    );
  }

  if (error && !employee) {
    return (
      <div className="employee-attendance-details">
        <ErrorState
          title="Could not load employee"
          message={error}
          onRetry={() => navigate(backUrl)}
          retryLabel="Back to attendance"
        />
      </div>
    );
  }

  if (!employee || !employeeId) {
    return (
      <div className="employee-attendance-details">
        <ErrorState
          title="Employee not found"
          message="Invalid or missing employee."
          onRetry={() => navigate(backUrl)}
          retryLabel="Back to attendance"
        />
      </div>
    );
  }

  return (
    <div className="employee-attendance-details">
      <header className="ead-header">

        <div className="ead-hero">
          <div className="ead-hero__avatar" aria-hidden>
            {employee.name
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0]?.toUpperCase())
              .join('') || '?'}
          </div>
          <div className="ead-hero__info">
            <h1 className="ead-hero__name">{employee.name}</h1>
            <p className="ead-hero__meta">
              {[employee.role, employee.department, employee.designation]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="ead-hero__contact">
              {employee.email}
              {employee.employeeId ? ` · ID ${employee.employeeId}` : ''}
            </p>
          </div>
          {renderStatusControl(todayStatus)}
        </div>
      </header>

      <section className="ead-section">
        <h2 className="ead-section__title">
          {focusDate === localDateISO()
            ? "Today's attendance"
            : `Attendance · ${formatAttendanceDateLabel(focusDate)}`}
        </h2>
        <div className="ead-today-grid">
          <div className="ead-stat-card">
            <span className="ead-stat-card__label">Status</span>
            <span className="ead-stat-card__value ead-stat-card__value--status">
              {renderStatusControl(todayStatus)}
            </span>
          </div>
          <div className="ead-stat-card">
            <span className="ead-stat-card__label">Check-in</span>
            <span className="ead-stat-card__value">{formatTime(todayRecord?.checkInTime)}</span>
          </div>
          <div className="ead-stat-card">
            <span className="ead-stat-card__label">Check-out</span>
            <span className="ead-stat-card__value">{formatTime(todayRecord?.checkOutTime)}</span>
          </div>
          <div className="ead-stat-card">
            <span className="ead-stat-card__label">Duration</span>
            <span className="ead-stat-card__value">{formatDuration(todayRecord?.totalDuration)}</span>
          </div>
        </div>
        {employee.assignedShift && (
          <p className="ead-shift-hint">
            Shift: <strong>{employee.assignedShift.name}</strong> ({employee.assignedShift.startTime}{' '}
            – {employee.assignedShift.endTime})
          </p>
        )}
      </section>

      <section className="ead-section">
        <div className="ead-section__head">
          <div className="ead-history-filters">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="From date"
            />
            <span className="ead-history-filters__sep">to</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="To date"
            />
            <ModuleHeaderOutlineButton
              type="button"
              onClick={() => void handleExportHistory()}
              disabled={historyTotal === 0}
            >
              Export
            </ModuleHeaderOutlineButton>
          </div>
        </div>
        {historyLoading ? (
          <p className="ead-muted">Loading history…</p>
        ) : history.length === 0 ? (
          <p className="ead-empty">No attendance records in this date range.</p>
        ) : (
          <>
            <div className="ead-table-wrap">
              <table className="ead-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Check-in</th>
                    <th>Check-out</th>
                    <th>Duration</th>
                    <th>Approval</th>
                    <th>Remote reason</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => {
                    const approvalNote =
                      row.checkInApproval?.status === AttendanceApprovalStatus.REJECTED
                        ? row.checkInApproval.rejectReason
                        : row.checkOutApproval?.status === AttendanceApprovalStatus.REJECTED
                          ? row.checkOutApproval.rejectReason
                          : null;
                    const approvalLabel = [
                      row.checkInApproval?.status &&
                        row.checkInApproval.status !== AttendanceApprovalStatus.NONE &&
                        `CI: ${row.checkInApproval.status}`,
                      row.checkOutApproval?.status &&
                        row.checkOutApproval.status !== AttendanceApprovalStatus.NONE &&
                        `CO: ${row.checkOutApproval.status}`,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    const remoteNotes = getHistoryRemoteNoteEntries(row);
                    return (
                    <tr key={row.id}>
                      <td>{formatAttendanceDateLabel(row.date)}</td>
                      <td>{renderStatusControl(row.status, historyRowDefaults(row))}</td>
                      <td>{formatTime(row.checkInTime)}</td>
                      <td>{formatTime(row.checkOutTime)}</td>
                      <td>
                        {row.isDurationOfficial
                          ? formatDuration(row.totalDuration)
                          : row.checkOutApproval?.status === AttendanceApprovalStatus.PENDING
                            ? 'Pending'
                            : formatDuration(row.totalDuration)}
                      </td>
                      <td className="ead-approval-cell">
                        {approvalLabel || '—'}
                        {approvalNote && (
                          <span className="ead-reject-reason" title={approvalNote}>
                            Rejected: {approvalNote}
                          </span>
                        )}
                      </td>
                      <td className="ead-remote-notes-cell">
                        {remoteNotes.length === 0 ? (
                          '—'
                        ) : (
                          <ul className="ead-remote-notes-list">
                            {remoteNotes.map((entry) => (
                              <li key={`${row.id}-${entry.legLabel}`}>
                                <span className="ead-remote-notes-leg">{entry.legLabel}</span>
                                <span className="ead-remote-notes-text" title={entry.remoteNote}>
                                  {entry.remoteNote}
                                </span>
                                {entry.markingFromLabel ? (
                                  <span className="ead-remote-notes-from">
                                    From {entry.markingFromLabel}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
            <div className="ead-history-pagination">
              <span className="ead-muted">
                {historyPageFrom}-{historyPageTo} of {historyTotal}
              </span>
              <Select
                value={String(historyPageSize)}
                onChange={(e) => {
                  setHistoryPageSize(Number(e.target.value));
                  setHistoryPage(1);
                }}
                options={[
                  { value: '10', label: '10 / page' },
                  { value: '25', label: '25 / page' },
                  { value: '50', label: '50 / page' },
                  { value: '100', label: '100 / page' },
                ]}
                aria-label="History rows per page"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                disabled={historyPage <= 1 || historyLoading}
              >
                Prev
              </Button>
              <span>Page {historyPage}</span>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setHistoryPage((p) => (p * historyPageSize < historyTotal ? p + 1 : p))
                }
                disabled={historyPage * historyPageSize >= historyTotal || historyLoading}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </section>

      <section className="ead-section ead-section--settings">
        <ShiftAttendanceSection
          employee={employee}
          onUpdate={handleEmployeeUpdate}
          canEdit={canEditShift}
          isExpanded={shiftExpanded}
          onToggle={() => setShiftExpanded((v) => !v)}
          onUnsavedChange={() => {}}
        />
      </section>

      {canMark && (
        <MarkAttendanceDialog
          isOpen={markOpen}
          onClose={() => {
            setMarkOpen(false);
            setMarkDialogDefaults(null);
          }}
          employeeId={employeeId}
          employeeName={employee.name}
          currentStatus={markDialogStatus}
          defaults={markDialogDefaults}
          onSuccess={() => {
            setMarkOpen(false);
            setMarkDialogDefaults(null);
            loadToday();
            loadHistory();
          }}
        />
      )}
    </div>
  );
};
