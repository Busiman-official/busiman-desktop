import { UserRole } from '@/types';

export function branchHasModule(
  slug: string,
  departments: string[] | undefined,
  role: UserRole | undefined
): boolean {
  if (role === UserRole.ADMIN) return true;
  const normalized = slug.trim().toLowerCase();
  return (departments ?? []).some((d) => String(d).toLowerCase() === normalized);
}

export function branchHasAttendance(
  departments: string[] | undefined,
  role: UserRole | undefined
): boolean {
  return branchHasModule('attendance', departments, role);
}
