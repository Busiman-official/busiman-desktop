import { UserRole } from '@/types';
import type { SalesTabDef } from '@/features/sales/components/SalesModuleHeader';
import { branchHasAttendance } from '@/features/attendance/utils/branchModules';

export type AttendanceTab = 'overview' | 'my-attendance' | 'approvals' | 'setup';

export const TAB_OVERVIEW: AttendanceTab = 'overview';
export const TAB_MY: AttendanceTab = 'my-attendance';
export const TAB_APPROVALS: AttendanceTab = 'approvals';
export const TAB_SETUP: AttendanceTab = 'setup';

export const ALL_TAB_DEFS: readonly SalesTabDef[] = [
  { id: TAB_OVERVIEW, label: 'Overview' },
  { id: TAB_MY, label: 'My attendance' },
  { id: TAB_APPROVALS, label: 'Approvals' },
  { id: TAB_SETUP, label: 'Setup' },
] as const;

export const VALID_TABS = new Set<string>(ALL_TAB_DEFS.map((t) => t.id));

export function tabsForRole(
  role: UserRole,
  branchDepartments?: string[]
): readonly SalesTabDef[] {
  if (!branchHasAttendance(branchDepartments, role)) {
    return role === UserRole.EMPLOYEE ? ALL_TAB_DEFS.filter((t) => t.id === TAB_MY) : [];
  }
  switch (role) {
    case UserRole.EMPLOYEE:
      return ALL_TAB_DEFS.filter((t) => t.id === TAB_MY);
    case UserRole.MANAGER:
      return ALL_TAB_DEFS.filter((t) => t.id !== TAB_SETUP && t.id !== TAB_MY);
    case UserRole.HR:
    case UserRole.ADMIN:
      return ALL_TAB_DEFS.filter((t) => t.id !== TAB_MY || role === UserRole.HR);
    default:
      return [];
  }
}

export function defaultTabForRole(role: UserRole): AttendanceTab {
  if (role === UserRole.EMPLOYEE) return TAB_MY;
  return TAB_OVERVIEW;
}

export function roleShowsOverview(role: UserRole, branchDepartments?: string[]): boolean {
  if (!branchHasAttendance(branchDepartments, role)) return false;
  return role === UserRole.MANAGER || role === UserRole.HR || role === UserRole.ADMIN;
}
