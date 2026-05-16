/**
 * Pending remote attendance approvals — manager / admin inbox
 */

import React, { useCallback, useEffect, useState } from 'react';
import { attendanceService } from '@/services/attendance.service';
import { socketService } from '@/services/socket.service';
import { PendingApprovalRow, AttendanceApprovalLeg, AttendanceMarkingFrom } from '@/types';
import { ConfirmDialog } from '@/shared/components/modals';
import { Button } from '@/shared/components/ui';
import { LoadingState, ErrorState } from '@/shared/components/data-display';
import './AttendanceApprovalsPanel.css';

const LEG_LABEL: Record<AttendanceApprovalLeg, string> = {
  check_in: 'Check-in',
  check_out: 'Check-out',
};

const FROM_LABEL: Record<AttendanceMarkingFrom, string> = {
  [AttendanceMarkingFrom.HOME]: 'Home',
  [AttendanceMarkingFrom.CLIENT_SITE]: 'Client site',
  [AttendanceMarkingFrom.TRAVEL]: 'Travel',
  [AttendanceMarkingFrom.OTHER]: 'Other',
};

function rowKey(row: Pick<PendingApprovalRow, 'attendanceId' | 'leg'>): string {
  return `${row.attendanceId}-${row.leg}`;
}

export const AttendanceApprovalsPanel: React.FC = () => {
  const [rows, setRows] = useState<PendingApprovalRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PendingApprovalRow | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (silent) {
      setRefreshing(true);
    } else {
      setInitialLoading(true);
    }
    setError(null);
    try {
      const data = await attendanceService.getPendingApprovals({ limit: 50 });
      setRows(data.rows ?? []);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load pending approvals');
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setInitialLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    socketService.connect();
    const refresh = () => {
      void load({ silent: true });
    };
    socketService.onAttendanceUpdate(refresh);
    socketService.onDashboardRefresh(refresh);

    return () => {
      socketService.offAttendanceUpdate();
      socketService.offDashboardRefresh();
    };
  }, [load]);

  const removeRow = useCallback((row: PendingApprovalRow) => {
    const key = rowKey(row);
    setRows((prev) => prev.filter((r) => rowKey(r) !== key));
  }, []);

  const handleApprove = async (row: PendingApprovalRow) => {
    setActionLoading(true);
    setError(null);
    removeRow(row);
    try {
      await attendanceService.approveAttendance(row.attendanceId, row.leg);
      await load({ silent: true });
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Approve failed');
      await load({ silent: true });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (reason: string) => {
    if (!rejectTarget) return;
    const target = rejectTarget;
    setActionLoading(true);
    setError(null);
    removeRow(target);
    try {
      await attendanceService.rejectAttendance(target.attendanceId, target.leg, reason);
      setRejectTarget(null);
      await load({ silent: true });
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Reject failed');
      await load({ silent: true });
    } finally {
      setActionLoading(false);
    }
  };

  if (initialLoading) return <LoadingState message="Loading pending approvals…" />;
  if (error && rows.length === 0) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <div className="attendance-approvals-panel">
      <div className="attendance-approvals-header">
        <h2>Attendance approvals</h2>
        <div className="attendance-approvals-header-actions">
          {refreshing && (
            <span className="attendance-approvals-refreshing" aria-live="polite">
              Updating…
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => void load({ silent: true })}
            disabled={actionLoading || refreshing}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && <div className="attendance-approvals-error">{error}</div>}

      {rows.length === 0 ? (
        <p className="attendance-approvals-empty">No pending attendance requests.</p>
      ) : (
        <div className="attendance-approvals-table-wrap">
          <table className="attendance-approvals-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Action</th>
                <th>Submitted</th>
                <th>Note</th>
                <th>From</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)}>
                  <td>
                    <div className="attendance-approvals-emp">{row.employeeName}</div>
                    {row.department && (
                      <span className="attendance-approvals-dept">{row.department}</span>
                    )}
                  </td>
                  <td>{row.date}</td>
                  <td>{LEG_LABEL[row.leg]}</td>
                  <td>
                    {row.submittedAt ? new Date(row.submittedAt).toLocaleString() : '—'}
                  </td>
                  <td className="attendance-approvals-note">{row.remoteNote || '—'}</td>
                  <td>
                    {row.markingFrom
                      ? row.markingFrom === AttendanceMarkingFrom.OTHER
                        ? row.markingFromOther || 'Other'
                        : FROM_LABEL[row.markingFrom]
                      : '—'}
                  </td>
                  <td className="attendance-approvals-actions">
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => void handleApprove(row)}
                      disabled={actionLoading}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setRejectTarget(row)}
                      disabled={actionLoading}
                    >
                      Reject
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!rejectTarget}
        onCancel={() => setRejectTarget(null)}
        onConfirm={(reason) => {
          if (reason) void handleReject(reason);
        }}
        title="Reject attendance"
        message={`Reject ${rejectTarget ? LEG_LABEL[rejectTarget.leg].toLowerCase() : ''} for ${rejectTarget?.employeeName}?`}
        requiresReason
        confirmLabel="Reject"
        variant="danger"
      />
    </div>
  );
};
