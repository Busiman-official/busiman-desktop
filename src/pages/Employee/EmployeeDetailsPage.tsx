/**
 * Employee Details Page - Comprehensive employee profile management
 * Single source of truth for employee configuration
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { employeeDetailsService } from '@/services/employee.service';
import { EmployeeDetails, UpdateEmployeeDetailsRequest, UserRole } from '@/types';
import { authStore } from '@/store/authStore';
import { ProfileSummarySection } from './sections/ProfileSummarySection';
import { EmploymentRoleSection } from './sections/EmploymentRoleSection';
import { ShiftAttendanceSection } from './sections/ShiftAttendanceSection';
import { TaskPreferencesSection } from './sections/TaskPreferencesSection';
import { PermissionsSection } from './sections/PermissionsSection';
import { SystemAuditSection } from './sections/SystemAuditSection';
import { ConfirmDialog } from '@/shared/components/modals';
import { LoadingState, ErrorState } from '@/shared/components/data-display';
import './EmployeeDetailsPage.css';

export const EmployeeDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = authStore();
  const [employee, setEmployee] = useState<EmployeeDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{
    request: UpdateEmployeeDetailsRequest;
    confirmRequired: boolean;
  } | null>(null);
  const [sectionsExpanded, setSectionsExpanded] = useState<Record<string, boolean>>({
    profile: true,
    employment: true,
    shift: true,
    task: false,
    permissions: false,
    audit: false,
  });

  useEffect(() => {
    if (id) {
      loadEmployeeDetails();
    }
  }, [id]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [unsavedChanges]);

  const loadEmployeeDetails = async () => {
    if (!id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await employeeDetailsService.getEmployeeDetails(id);
      setEmployee(data);
      setUnsavedChanges(false);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load employee details');
    } finally {
      setLoading(false);
    }
  };

  const handleSectionToggle = (sectionId: string) => {
    setSectionsExpanded((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const requiresConfirmation = (request: UpdateEmployeeDetailsRequest): boolean => {
    // Require confirmation for role changes, shift changes, or permission overrides
    return !!(
      request.role ||
      request.assignedShiftId ||
      request.shiftAssignmentType ||
      request.attendanceOverridePermission !== undefined ||
      request.taskStatusOverridePermission !== undefined ||
      request.overtimeEligibilityOverride !== undefined ||
      request.breakRuleOverride !== undefined ||
      request.holidayWorkingPermission !== undefined ||
      request.canActAsProxy !== undefined
    );
  };

  const handleUpdate = async (request: UpdateEmployeeDetailsRequest) => {
    if (!id || !employee) return;

    const confirmRequired = requiresConfirmation(request);

    if (confirmRequired) {
      setPendingUpdate({ request, confirmRequired: true });
      setShowConfirmModal(true);
      return;
    }

    await performUpdate(request);
  };

  const performUpdate = async (request: UpdateEmployeeDetailsRequest) => {
    if (!id || !employee) return;

    try {
      setError(null);
      const updated = await employeeDetailsService.updateEmployeeDetails(id, request);
      setEmployee(updated);
      setUnsavedChanges(false);
      setShowConfirmModal(false);
      setPendingUpdate(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update employee details');
      setShowConfirmModal(false);
      setPendingUpdate(null);
    }
  };

  const handleConfirmUpdate = async (reason?: string) => {
    if (pendingUpdate) {
      const updateRequest = reason
        ? { ...pendingUpdate.request, reason }
        : pendingUpdate.request;
      await performUpdate(updateRequest);
    }
  };

  const handleCancelUpdate = () => {
    setShowConfirmModal(false);
    setPendingUpdate(null);
  };

  if (loading && !employee) {
    return (
      <div className="employee-details-page">
        <LoadingState message="Loading employee details..." />
      </div>
    );
  }

  if (error && !employee) {
    return (
      <div className="employee-details-page">
        <ErrorState
          title="Error loading employee"
          message={error}
          onRetry={() => navigate(-1)}
          retryLabel="Go Back"
        />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="employee-details-page">
        <ErrorState
          title="Employee not found"
          message="The employee you're looking for doesn't exist or has been deleted."
          onRetry={() => navigate(-1)}
          retryLabel="Go Back"
        />
      </div>
    );
  }

  const canEdit = currentUser?.role === UserRole.HR || currentUser?.role === UserRole.ADMIN;
  const canEditLimited = currentUser?.role === UserRole.MANAGER;

  return (
    <div className="employee-details-page">
      <div className="employee-details-header">
        <div>
          <button className="back-button" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h1>Employee Details</h1>
          <p className="page-subtitle">{employee.name}</p>
        </div>
        {unsavedChanges && (
          <div className="unsaved-indicator">
            You have unsaved changes
          </div>
        )}
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="employee-details-sections">
        {/* Profile Summary Section */}
        <ProfileSummarySection
          employee={employee}
          onUpdate={handleUpdate}
          canEdit={canEdit}
          isExpanded={sectionsExpanded.profile}
          onToggle={() => handleSectionToggle('profile')}
          onUnsavedChange={setUnsavedChanges}
        />

        {/* Employment & Role Section */}
        <EmploymentRoleSection
          employee={employee}
          onUpdate={handleUpdate}
          canEdit={canEdit}
          isExpanded={sectionsExpanded.employment}
          onToggle={() => handleSectionToggle('employment')}
          onUnsavedChange={setUnsavedChanges}
        />

        {/* Shift & Attendance Section */}
        <ShiftAttendanceSection
          employee={employee}
          onUpdate={handleUpdate}
          canEdit={canEdit}
          isExpanded={sectionsExpanded.shift}
          onToggle={() => handleSectionToggle('shift')}
          onUnsavedChange={setUnsavedChanges}
        />

        {/* Task & Work Preferences Section */}
        <TaskPreferencesSection
          employee={employee}
          onUpdate={handleUpdate}
          canEdit={canEdit || canEditLimited}
          isExpanded={sectionsExpanded.task}
          onToggle={() => handleSectionToggle('task')}
          onUnsavedChange={setUnsavedChanges}
        />

        {/* Permissions & Overrides Section */}
        <PermissionsSection
          employee={employee}
          onUpdate={handleUpdate}
          onRefresh={loadEmployeeDetails}
          canEdit={canEdit}
          isExpanded={sectionsExpanded.permissions}
          onToggle={() => handleSectionToggle('permissions')}
          onUnsavedChange={setUnsavedChanges}
        />

        {/* System & Audit Section */}
        <SystemAuditSection
          employee={employee}
          employeeId={id!}
          isExpanded={sectionsExpanded.audit}
          onToggle={() => handleSectionToggle('audit')}
        />
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && pendingUpdate && (
        <ConfirmDialog
          isOpen={showConfirmModal}
          onConfirm={(reason) => handleConfirmUpdate(reason)}
          onCancel={handleCancelUpdate}
          changes={pendingUpdate.request}
          employeeName={employee.name}
          message={`You are about to make changes to ${employee.name}`}
          requiresReason={pendingUpdate.confirmRequired}
          variant="warning"
        />
      )}
    </div>
  );
};

