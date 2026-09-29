import { UserRole } from '@/types';

import { branchHasAttendance } from './branchModules';

export function canAccessAttendanceOverview(
  role: UserRole,
  branchDepartments?: string[],
  isAttendanceOfficer?: boolean
): boolean {
  if (!branchHasAttendance(branchDepartments, role)) return false;
  return (
    role === UserRole.ADMIN ||
    role === UserRole.HR ||
    role === UserRole.MANAGER ||
    Boolean(isAttendanceOfficer)
  );
}

export function canApproveAttendance(
  role: UserRole,
  branchDepartments?: string[],
  isAttendanceOfficer?: boolean
): boolean {
  return canAccessAttendanceOverview(role, branchDepartments, isAttendanceOfficer);
}

export function canViewEmployeeAttendanceProfile(
  role: UserRole,
  branchDepartments?: string[],
  isAttendanceOfficer?: boolean
): boolean {
  return canAccessAttendanceOverview(role, branchDepartments, isAttendanceOfficer);
}

export function canMarkAttendanceForOthers(
  role: UserRole,
  branchDepartments?: string[],
  isAttendanceOfficer?: boolean
): boolean {
  if (!branchHasAttendance(branchDepartments, role)) return false;
  return role === UserRole.ADMIN || role === UserRole.HR || Boolean(isAttendanceOfficer);
}
