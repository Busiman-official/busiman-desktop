import { UserRole } from '@/types';

import { branchHasAttendance } from './branchModules';

export function canAccessAttendanceOverview(
  role: UserRole,
  branchDepartments?: string[]
): boolean {
  if (!branchHasAttendance(branchDepartments, role)) return false;
  return role === UserRole.ADMIN || role === UserRole.HR || role === UserRole.MANAGER;
}

export function canApproveAttendance(role: UserRole, branchDepartments?: string[]): boolean {
  return canAccessAttendanceOverview(role, branchDepartments);
}

export function canViewEmployeeAttendanceProfile(
  role: UserRole,
  branchDepartments?: string[]
): boolean {
  return canAccessAttendanceOverview(role, branchDepartments);
}

export function canMarkAttendanceForOthers(
  role: UserRole,
  branchDepartments?: string[]
): boolean {
  if (!branchHasAttendance(branchDepartments, role)) return false;
  return role === UserRole.ADMIN || role === UserRole.HR;
}
