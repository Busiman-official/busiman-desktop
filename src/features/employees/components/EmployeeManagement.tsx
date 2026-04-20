/**
 * Employee management — full-width roster with top toolbar (HR / Admin).
 */

import React, { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { employeeService, CreateEmployeeRequest, ActiveSessionInfo } from '@/services/employee.service';
import { employeeDetailsService } from '@/services/employee.service';
import { shiftService } from '@/services/shift.service';
import { branchService } from '@/services/branch.service';
import { User, UserRole, EmployeeDetails, UpdateEmployeeDetailsRequest, Branch } from '@/types';
import { Shift } from '@/types/shift';
import { Button, Input, Card, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState, ErrorState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { ProfileSummarySection } from '@/pages/Employee/sections/ProfileSummarySection';
import { EmploymentRoleSection } from '@/pages/Employee/sections/EmploymentRoleSection';
import { ShiftAttendanceSection } from '@/pages/Employee/sections/ShiftAttendanceSection';
import { TaskPreferencesSection } from '@/pages/Employee/sections/TaskPreferencesSection';
import { PermissionsSection } from '@/pages/Employee/sections/PermissionsSection';
import { SystemAuditSection } from '@/pages/Employee/sections/SystemAuditSection';
import { ConfirmDialog } from '@/shared/components/modals';
import { authStore } from '@/store/authStore';
import './EmployeeManagement.css';

type ViewMode = 'list' | 'details' | 'add';

export type EmployeeManagementHandle = {
  openAddEmployee: () => void;
};

export const EmployeeManagement = forwardRef<EmployeeManagementHandle>(function EmployeeManagement(_props, ref) {
  const { user: currentUser } = authStore();
  const [employees, setEmployees] = useState<User[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [employeeDetails, setEmployeeDetails] = useState<EmployeeDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
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

  const [formData, setFormData] = useState<CreateEmployeeRequest>({
    email: '',
    name: '',
    password: '',
    role: UserRole.EMPLOYEE,
    department: '',
    branchId: '',
    phoneNumber: '',
    employeeId: '',
    designation: '',
  });
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [, setLoadingBranches] = useState(false);

  useEffect(() => {
    loadEmployees();
    loadActiveSessions();
    loadBranches();
  }, []);

  const loadBranches = async () => {
    try {
      setLoadingBranches(true);
      const data = await branchService.getBranches({ isActive: true });
      setBranches(data);
    } catch (err) {
      logger.error('[EmployeeManagement] Failed to load branches', err);
    } finally {
      setLoadingBranches(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'add') {
      loadShifts();
    }
  }, [viewMode]);

  useEffect(() => {
    if (selectedEmployeeId && viewMode === 'details') {
      loadEmployeeDetails();
    }
  }, [selectedEmployeeId, viewMode]);

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

  const loadEmployees = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await employeeService.getAllEmployees();
      setEmployees(data);
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to load employees'));
    } finally {
      setLoading(false);
    }
  };

  const loadActiveSessions = async () => {
    try {
      const sessions = await employeeService.getActiveSessions();
      setActiveSessions(sessions);
    } catch (err) {
      logger.error('[EmployeeManagement] Failed to load active sessions', err);
    }
  };

  const loadEmployeeDetails = async () => {
    if (!selectedEmployeeId) return;
    
    setLoadingDetails(true);
    setDetailsError(null);
    
    try {
      const data = await employeeDetailsService.getEmployeeDetails(selectedEmployeeId);
      setEmployeeDetails(data);
      setUnsavedChanges(false);
    } catch (err: any) {
      setDetailsError(extractErrorMessage(err, 'Failed to load employee details'));
    } finally {
      setLoadingDetails(false);
    }
  };

  const loadShifts = async () => {
    try {
      setLoadingShifts(true);
      const shiftsData = await shiftService.getActiveShifts();
      setShifts(shiftsData || []);
    } catch (err: any) {
      logger.error('[EmployeeManagement] Failed to load shifts', err);
    } finally {
      setLoadingShifts(false);
    }
  };

  const handleAddEmployee = useCallback(() => {
    setViewMode('add');
    setSelectedEmployeeId(null);
    setEmployeeDetails(null);
    setFormData({
      email: '',
      name: '',
      password: '',
      role: UserRole.EMPLOYEE,
      department: '',
      branchId: '',
      phoneNumber: '',
      employeeId: '',
      designation: '',
    });
    setSelectedShiftId('');
    setError(null);
    setSuccess(null);
  }, []);

  useImperativeHandle(ref, () => ({ openAddEmployee: handleAddEmployee }), [handleAddEmployee]);

  const handleEditEmployee = (employeeId: string) => {
    setSelectedEmployeeId(employeeId);
    setViewMode('details');
    setError(null);
    setSuccess(null);
  };

  const handleBackToList = () => {
    setViewMode('list');
    setSelectedEmployeeId(null);
    setEmployeeDetails(null);
    setUnsavedChanges(false);
    setShowConfirmModal(false);
    setPendingUpdate(null);
  };

  const handleCancelForm = () => {
    handleBackToList();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!formData.email || !formData.name) {
      setError('Email and name are required');
      return;
    }

    if (!formData.password) {
      setError('Password is required for new employees');
      return;
    }

    try {
      setLoading(true);
      // Create employee first
      const newEmployee = await employeeService.createEmployee(formData as CreateEmployeeRequest);
      setSuccess('Employee created successfully');
      
      // If shift is selected, assign it to the employee
      if (selectedShiftId) {
        try {
          await shiftService.createAssignment({
            assignmentMode: 'individual',
            employeeId: newEmployee.id,
            shiftId: selectedShiftId,
            assignmentType: 'permanent',
            startDate: new Date().toISOString().split('T')[0],
          });
          setSuccess('Employee created and shift assigned successfully');
        } catch (shiftErr: any) {
          // Employee created but shift assignment failed - show warning
          logger.error('[EmployeeManagement] Failed to assign shift', shiftErr, {
            employeeId: newEmployee.id,
            shiftId: selectedShiftId,
          });
          setSuccess('Employee created successfully, but shift assignment failed. You can assign a shift later.');
        }
      }
      
      await loadEmployees();
      handleBackToList();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create employee');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (employee: User) => {
    if (!window.confirm(`Are you sure you want to delete ${employee.name}? This action cannot be undone.`)) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);
      
      await employeeService.deleteEmployee(employee.id);
      
      setSuccess('Employee deleted successfully');
      await loadEmployees();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      const errorMessage = extractErrorMessage(err, 'Failed to delete employee');
      logger.error('[EmployeeManagement] Delete error', err, {
        employeeId: employee.id,
        status: err.response?.status,
        data: err.response?.data,
        message: errorMessage,
      });
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoutEmployee = async (employee: User) => {
    if (!window.confirm(`Logout ${employee.name} from all active sessions?`)) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      await employeeService.logoutEmployee(employee.id);
      setSuccess('Employee logged out successfully');

      await loadActiveSessions();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      const errorMessage = extractErrorMessage(err, 'Failed to logout employee');
      logger.error('[EmployeeManagement] Logout employee error', err, {
        employeeId: employee.id,
        message: errorMessage,
      });
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const isEmployeeOnline = (employeeId: string): boolean => {
    return activeSessions.some((session) => session.userId === employeeId);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSectionToggle = (sectionId: string) => {
    setSectionsExpanded((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const requiresConfirmation = (request: UpdateEmployeeDetailsRequest): boolean => {
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
    if (!selectedEmployeeId || !employeeDetails) return;

    const confirmRequired = requiresConfirmation(request);

    if (confirmRequired) {
      setPendingUpdate({ request, confirmRequired: true });
      setShowConfirmModal(true);
      return;
    }

    await performUpdate(request);
  };

  const performUpdate = async (request: UpdateEmployeeDetailsRequest) => {
    if (!selectedEmployeeId || !employeeDetails) return;

    try {
      setDetailsError(null);
      const updated = await employeeDetailsService.updateEmployeeDetails(selectedEmployeeId, request);
      setEmployeeDetails(updated);
      setUnsavedChanges(false);
      setShowConfirmModal(false);
      setPendingUpdate(null);
      await loadEmployees(); // Refresh the list
    } catch (err: any) {
      setDetailsError(err.response?.data?.message || 'Failed to update employee details');
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

  const canEdit = currentUser?.role === UserRole.HR || currentUser?.role === UserRole.ADMIN;
  const canEditLimited = currentUser?.role === UserRole.MANAGER;

  const onlineCount = employees.filter((e) => isEmployeeOnline(e.id)).length;

  if (loading && employees.length === 0) {
    return (
      <div className="employee-management-page">
        <div className="employee-management-content employee-management-content--loading">
          <LoadingState message="Loading employees..." />
        </div>
      </div>
    );
  }

  return (
    <div className="employee-management-page">
      <div className="employee-management-content">
        {viewMode === 'add' && (
          <header className="employee-form-toolbar" aria-label="Add employee">
            <button type="button" className="employee-form-toolbar__back" onClick={handleCancelForm}>
              ← Back to roster
            </button>
            <h2 className="employee-form-toolbar__title">New team member</h2>
          </header>
        )}

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        {viewMode === 'list' && (
          <Card className="employee-list-card" padding="none">
            <table className="employee-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Branch</th>
                    <th>Employee ID</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="employee-table__empty-cell">
                        <EmptyState
                          title="No one on the roster yet"
                          message="Use Add employee (top right on the Employees tab) to invite your first team member."
                        />
                      </td>
                    </tr>
                  ) : (
                    employees.map((employee) => (
                      <tr key={employee.id}>
                        <td>{employee.name}</td>
                        <td>{employee.email}</td>
                        <td>
                          <span className={`role-badge role-badge--${employee.role}`}>{employee.role}</span>
                        </td>
                        <td>{employee.department || '-'}</td>
                        <td>{employee.branchId ? branches.find(b => b.id === employee.branchId)?.name || '-' : '-'}</td>
                      <td>{employee.employeeId || '-'}</td>
                      <td>
                        {isEmployeeOnline(employee.id) ? (
                          <span className="status-badge status-badge--online">
                            <span className="status-dot" /> Online
                          </span>
                        ) : (
                          <span className="status-badge status-badge--offline">
                            <span className="status-dot" /> Offline
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="table-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditEmployee(employee.id)}
                            disabled={loading}
                          >
                            Edit
                          </Button>
                          {isEmployeeOnline(employee.id) && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleLogoutEmployee(employee)}
                              disabled={loading}
                            >
                              Logout
                            </Button>
                          )}
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDelete(employee)}
                            disabled={loading}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          )}

          {viewMode === 'add' && (
            <Card className="employee-form-card" padding="lg">
              <p className="employee-form-lead">
                Account credentials, role, and optional shift—everything needed to get them productive.
              </p>

              <form onSubmit={handleSubmit} className="employee-form">
                <div className="form-row">
                  <Input
                    label="Name *"
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    disabled={loading}
                  />
                  <Input
                    label="Email *"
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    disabled={loading}
                  />
                </div>

                <div className="form-row">
                  <Select
                    label="Role *"
                    name="role"
                    value={formData.role}
                    onChange={handleChange as any}
                    required
                    disabled={loading}
                    options={[
                      { value: UserRole.EMPLOYEE, label: 'Employee' },
                      { value: UserRole.MANAGER, label: 'Manager' },
                      { value: UserRole.HR, label: 'HR' },
                      { value: UserRole.ADMIN, label: 'Admin' },
                    ]}
                  />
                  <Input
                    label="Department"
                    type="text"
                    name="department"
                    value={formData.department}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>

                <div className="form-row">
                  <Input
                    label="Employee ID"
                    type="text"
                    name="employeeId"
                    value={formData.employeeId}
                    onChange={handleChange}
                    disabled={loading}
                  />
                  <Input
                    label="Designation"
                    type="text"
                    name="designation"
                    value={formData.designation}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>

                <div className="form-row">
                  <Input
                    label="Phone Number"
                    type="tel"
                    name="phoneNumber"
                    value={formData.phoneNumber}
                    onChange={handleChange}
                    disabled={loading}
                  />
                  <Input
                    label="Password *"
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    disabled={loading}
                  />
                </div>

                <div className="form-row">
                  <Select
                    label="Assign Shift (Optional)"
                    value={selectedShiftId || ''}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedShiftId(e.target.value)}
                    disabled={loading || loadingShifts}
                    placeholder="-- No Shift --"
                    options={[
                      { value: '', label: '-- No Shift --' },
                      ...shifts.map((shift) => ({
                        value: shift.id,
                        label: `${shift.name} (${shift.startTime} - ${shift.endTime})`,
                      })),
                    ]}
                  />
                  {loadingShifts && <small>Loading shifts...</small>}
                  {!loadingShifts && shifts.length === 0 && (
                    <small style={{ color: '#666' }}>No active shifts available. Create a shift first.</small>
                  )}
                </div>

                <div className="form-actions">
                  <Button type="button" variant="secondary" onClick={handleCancelForm} disabled={loading}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={loading}>
                    {loading ? 'Creating...' : 'Create Employee'}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {viewMode === 'details' && (
            <div className="employee-details-wrapper">
              <div className="employee-details-header">
                <button className="back-button" onClick={handleBackToList}>
                  ← Back to roster
                </button>
                <h2>Employee Details</h2>
                {employeeDetails && <p className="page-subtitle">{employeeDetails.name}</p>}
                {unsavedChanges && (
                  <div className="unsaved-indicator">
                    You have unsaved changes
                  </div>
                )}
              </div>

              {detailsError && (
                <div className="error-message">
                  {detailsError}
                </div>
              )}

              {loadingDetails && !employeeDetails ? (
                <LoadingState message="Loading employee details..." />
              ) : employeeDetails ? (
                <div className="employee-details-sections">
                  <ProfileSummarySection
                    employee={employeeDetails}
                    onUpdate={handleUpdate}
                    canEdit={canEdit}
                    isExpanded={sectionsExpanded.profile}
                    onToggle={() => handleSectionToggle('profile')}
                    onUnsavedChange={setUnsavedChanges}
                  />

                  <EmploymentRoleSection
                    employee={employeeDetails}
                    onUpdate={handleUpdate}
                    canEdit={canEdit}
                    isExpanded={sectionsExpanded.employment}
                    onToggle={() => handleSectionToggle('employment')}
                    onUnsavedChange={setUnsavedChanges}
                  />

                  <ShiftAttendanceSection
                    employee={employeeDetails}
                    onUpdate={handleUpdate}
                    canEdit={canEdit}
                    isExpanded={sectionsExpanded.shift}
                    onToggle={() => handleSectionToggle('shift')}
                    onUnsavedChange={setUnsavedChanges}
                  />

                  <TaskPreferencesSection
                    employee={employeeDetails}
                    onUpdate={handleUpdate}
                    canEdit={canEdit || canEditLimited}
                    isExpanded={sectionsExpanded.task}
                    onToggle={() => handleSectionToggle('task')}
                    onUnsavedChange={setUnsavedChanges}
                  />

                  <PermissionsSection
                    employee={employeeDetails}
                    onUpdate={handleUpdate}
                    canEdit={canEdit}
                    isExpanded={sectionsExpanded.permissions}
                    onToggle={() => handleSectionToggle('permissions')}
                    onUnsavedChange={setUnsavedChanges}
                  />

                  <SystemAuditSection
                    employee={employeeDetails}
                    employeeId={selectedEmployeeId!}
                    isExpanded={sectionsExpanded.audit}
                    onToggle={() => handleSectionToggle('audit')}
                  />
                </div>
              ) : (
                <ErrorState
                  title="Employee not found"
                  message="The employee you're looking for doesn't exist or has been deleted."
                />
              )}
            </div>
          )}
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && pendingUpdate && employeeDetails && (
        <ConfirmDialog
          isOpen={showConfirmModal}
          onConfirm={handleConfirmUpdate}
          onCancel={handleCancelUpdate}
          changes={pendingUpdate.request}
          employeeName={employeeDetails.name}
          message={`You are about to make changes to ${employeeDetails.name}`}
          requiresReason={pendingUpdate.confirmRequired}
          variant="warning"
        />
      )}
    </div>
  );
});

EmployeeManagement.displayName = 'EmployeeManagement';
