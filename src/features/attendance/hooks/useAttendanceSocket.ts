/**
 * Shared attendance Socket.IO subscriptions with per-handler cleanup.
 */

import { useEffect, useRef } from 'react';
import { socketService } from '@/services/socket.service';
import {
  AttendanceSocketEnvelope,
  DashboardRefreshEnvelope,
} from '../types/attendance-socket';

export interface UseAttendanceSocketOptions {
  enabled?: boolean;
  employeeIdFilter?: string;
  onStatus?: (event: AttendanceSocketEnvelope) => void;
  onDashboardRefresh?: (event: DashboardRefreshEnvelope) => void;
  onApprovalPending?: (event: AttendanceSocketEnvelope) => void;
}

export function useAttendanceSocket(options: UseAttendanceSocketOptions = {}): void {
  const {
    enabled = true,
    employeeIdFilter,
    onStatus,
    onDashboardRefresh,
    onApprovalPending,
  } = options;

  const onStatusRef = useRef(onStatus);
  const onDashboardRef = useRef(onDashboardRefresh);
  const onPendingRef = useRef(onApprovalPending);
  const filterRef = useRef(employeeIdFilter);

  onStatusRef.current = onStatus;
  onDashboardRef.current = onDashboardRefresh;
  onPendingRef.current = onApprovalPending;
  filterRef.current = employeeIdFilter;

  useEffect(() => {
    if (!enabled) return;

    socketService.connect();

    const statusHandler = (event: AttendanceSocketEnvelope) => {
      if (filterRef.current && event.data?.employeeId !== filterRef.current) {
        return;
      }
      onStatusRef.current?.(event);
    };

    const dashboardHandler = (event: DashboardRefreshEnvelope) => {
      onDashboardRef.current?.(event);
    };

    const pendingHandler = (event: AttendanceSocketEnvelope) => {
      onPendingRef.current?.(event);
    };

    if (onStatusRef.current) {
      socketService.onAttendanceUpdate(statusHandler);
    }
    if (onDashboardRef.current) {
      socketService.onDashboardRefresh(dashboardHandler);
    }
    if (onPendingRef.current) {
      socketService.onApprovalPending(pendingHandler);
    }

    return () => {
      if (onStatusRef.current) {
        socketService.offAttendanceUpdate(statusHandler);
      }
      if (onDashboardRef.current) {
        socketService.offDashboardRefresh(dashboardHandler);
      }
      if (onPendingRef.current) {
        socketService.offApprovalPending(pendingHandler);
      }
    };
  }, [enabled, employeeIdFilter]);
}
