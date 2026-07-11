/**
 * Role-based permissions for stock count actions (desktop).
 * Matches server constants/count-permissions.
 */

import { UserRole } from '@/types';

const ROLES_CAN_APPROVE: string[] = [
  UserRole.INVENTORY_APPROVER,
  UserRole.MANAGER,
  UserRole.ADMIN,
];

export function canApproveCount(role: string | undefined): boolean {
  return typeof role === 'string' && ROLES_CAN_APPROVE.includes(role);
}

export function canSelfApproveCount(role: string | undefined): boolean {
  return role === UserRole.ADMIN;
}

/**
 * Employee can only delete counts they created. Other approver roles can delete any DRAFT/IN_PROGRESS in scope.
 */
export function canDeleteCount(
  role: string | undefined,
  createdByUserId: string,
  currentUserId: string
): boolean {
  if (createdByUserId === currentUserId) return true;
  if (role === UserRole.EMPLOYEE || typeof role !== 'string') return false;
  return ROLES_CAN_APPROVE.includes(role);
}
