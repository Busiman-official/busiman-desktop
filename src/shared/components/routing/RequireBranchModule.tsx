/**
 * Redirects away if the current user does not have the given branch module
 * in their effective login list (branch ∩ assignment). Admins always pass.
 */

import React from 'react';
import { Navigate } from 'react-router-dom';
import { authStore } from '@/store/authStore';
import { useBranchContext } from '@/hooks/useBranchContext';
import { UserRole } from '@/types';

type Props = {
  module: string;
  children: React.ReactNode;
};

export const RequireBranchModule: React.FC<Props> = ({ module, children }) => {
  const user = authStore((s) => s.user);
  const { departments } = useBranchContext();
  const slug = module.trim().toLowerCase();

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.role === UserRole.ADMIN) {
    return <>{children}</>;
  }

  const fromStore = departments.map((d) => String(d.name).toLowerCase());
  const fromAuth = (user.branchDepartments ?? []).map((s) => String(s).toLowerCase());
  const effective = fromStore.length > 0 ? fromStore : fromAuth;

  if (!effective.includes(slug)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};
