/**
 * Live pending-approval count for manager / HR / admin tab indicator.
 */

import { useCallback, useEffect, useState } from 'react';
import { attendanceService } from '@/services/attendance.service';
import { useAttendanceSocket } from './useAttendanceSocket';

export function usePendingApprovalsCount(enabled: boolean) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    try {
      const result = await attendanceService.getPendingApprovals({ limit: 1 });
      setCount(result.total ?? 0);
    } catch {
      setCount(0);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useAttendanceSocket({
    enabled,
    onApprovalPending: () => {
      void refresh();
    },
    onDashboardRefresh: () => {
      void refresh();
    },
    onStatus: () => {
      void refresh();
    },
  });

  return { count, hasPending: count > 0, refresh };
}
