import { AttendanceDashboardRow, AttendanceSessionStatus, AttendanceApprovalStatus } from '@/types';

type ExportRow = {
  employeeId: string;
  employeeName: string;
  department?: string;
  role?: string;
  status: AttendanceSessionStatus;
  checkInTime?: string;
  checkOutTime?: string;
  totalDuration?: number;
  checkInApprovalStatus?: AttendanceApprovalStatus;
  checkOutApprovalStatus?: AttendanceApprovalStatus;
  checkInRemoteNote?: string;
  checkOutRemoteNote?: string;
  checkInMarkingFrom?: string;
  checkOutMarkingFrom?: string;
  checkInRejectReason?: string;
  checkOutRejectReason?: string;
};

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadAttendanceCsvFromRows(
  rows: ExportRow[],
  dateLabel: string,
  fileName?: string
): void {
  const headers = [
    'Employee Name',
    'Employee ID',
    'Department',
    'Role',
    'Status',
    'Check-in approval',
    'Check-out approval',
    'Check-in remote reason',
    'Check-out remote reason',
    'Check-in marking from',
    'Check-out marking from',
    'Check-in reject reason',
    'Check-out reject reason',
    'Check-in',
    'Check-out',
    'Duration (minutes)',
    'Date',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        escapeCsvCell(r.employeeName || ''),
        escapeCsvCell(r.employeeId || ''),
        escapeCsvCell(r.department || ''),
        escapeCsvCell(r.role || ''),
        escapeCsvCell(r.status),
        escapeCsvCell(r.checkInApprovalStatus || ''),
        escapeCsvCell(r.checkOutApprovalStatus || ''),
        escapeCsvCell(r.checkInRemoteNote || ''),
        escapeCsvCell(r.checkOutRemoteNote || ''),
        escapeCsvCell(r.checkInMarkingFrom || ''),
        escapeCsvCell(r.checkOutMarkingFrom || ''),
        escapeCsvCell(r.checkInRejectReason || ''),
        escapeCsvCell(r.checkOutRejectReason || ''),
        escapeCsvCell(r.checkInTime ? new Date(r.checkInTime).toLocaleString() : ''),
        escapeCsvCell(r.checkOutTime ? new Date(r.checkOutTime).toLocaleString() : ''),
        escapeCsvCell(r.totalDuration != null ? String(r.totalDuration) : ''),
        escapeCsvCell(dateLabel),
      ].join(',')
    ),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || `attendance_${dateLabel}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function dashboardRowsToExportRows(rows: AttendanceDashboardRow[]): ExportRow[] {
  return rows.map((r) => ({
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    department: r.department,
    role: r.role,
    status: r.status,
    checkInTime: r.checkInTime,
    checkOutTime: r.checkOutTime,
    totalDuration: r.totalDuration,
    checkInApprovalStatus: r.checkInApprovalStatus,
    checkOutApprovalStatus: r.checkOutApprovalStatus,
  }));
}

export function historyRecordToExportRow(
  record: {
    employeeId?: string;
    employeeName?: string;
    department?: string;
    role?: string;
    status: AttendanceSessionStatus;
    checkInTime: string;
    checkOutTime?: string;
    totalDuration?: number;
    checkInApproval?: {
      status?: AttendanceApprovalStatus;
      remoteNote?: string;
      markingFrom?: string;
      rejectReason?: string;
    };
    checkOutApproval?: {
      status?: AttendanceApprovalStatus;
      remoteNote?: string;
      markingFrom?: string;
      rejectReason?: string;
    };
  },
  dateLabel: string
): ExportRow {
  return {
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    department: record.department,
    role: record.role,
    status: record.status,
    checkInTime: record.checkInTime,
    checkOutTime: record.checkOutTime,
    totalDuration: record.totalDuration,
    checkInApprovalStatus: record.checkInApproval?.status,
    checkOutApprovalStatus: record.checkOutApproval?.status,
    checkInRemoteNote: record.checkInApproval?.remoteNote?.trim() ?? '',
    checkOutRemoteNote: record.checkOutApproval?.remoteNote?.trim() ?? '',
    checkInMarkingFrom: record.checkInApproval?.markingFrom ?? '',
    checkOutMarkingFrom: record.checkOutApproval?.markingFrom ?? '',
    checkInRejectReason: record.checkInApproval?.rejectReason?.trim() ?? '',
    checkOutRejectReason: record.checkOutApproval?.rejectReason?.trim() ?? '',
  };
}
