import { AttendanceSessionStatus } from '@/types';

export type AttendanceApprovalLeg = 'check_in' | 'check_out';
export type SocketApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface AttendanceSocketData {
  employeeId: string;
  employeeName?: string;
  department?: string;
  branchId?: string;
  status: AttendanceSessionStatus;
  date: string;
  checkInTime?: string;
  checkOutTime?: string;
  approvalLeg?: AttendanceApprovalLeg;
  approvalStatus?: SocketApprovalStatus;
}

export interface AttendanceSocketEnvelope {
  type: string;
  data: AttendanceSocketData;
  timestamp: string;
}

export interface DashboardRefreshEnvelope {
  type: string;
  date: string;
  timestamp: string;
}
