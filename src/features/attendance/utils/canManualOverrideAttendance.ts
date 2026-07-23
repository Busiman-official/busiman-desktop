import { EmployeeDetails, UserRole } from '@/types';

type Performer = { id: string; role: UserRole };
type Target = Pick<
  EmployeeDetails,
  'allowManualAttendanceOverride' | 'manualAttendanceOverrideAllowedUserIds'
>;

export function canManualOverrideAttendance(performer: Performer, target: Target): boolean {
  if (performer.role === UserRole.ADMIN) return true;
  if (target.allowManualAttendanceOverride) {
    return (target.manualAttendanceOverrideAllowedUserIds ?? []).includes(performer.id);
  }
  return performer.role === UserRole.HR;
}
