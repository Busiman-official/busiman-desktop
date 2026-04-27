/**
 * Employment & Role Section - Defines authority and visibility
 */

import React, { useState, useEffect } from 'react';
import { EmployeeDetails, UpdateEmployeeDetailsRequest, UserRole, EmploymentType, User, Branch } from '@/types';
import { CollapsibleSection, InlineEditField, BranchModuleCheckboxGroup } from '@/shared/components/ui';
import { employeeService } from '@/services/employee.service';
import { branchService } from '@/services/branch.service';
import { logger } from '@/shared/utils/logger';
import './EmploymentRoleSection.css';

interface EmploymentRoleSectionProps {
  employee: EmployeeDetails;
  onUpdate: (request: UpdateEmployeeDetailsRequest) => Promise<void>;
  canEdit: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onUnsavedChange: (hasChanges: boolean) => void;
}

export const EmploymentRoleSection: React.FC<EmploymentRoleSectionProps> = ({
  employee,
  onUpdate,
  canEdit,
  isExpanded,
  onToggle,
  onUnsavedChange,
}) => {
  const [managers, setManagers] = useState<User[]>([]);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const branchDepartments = React.useMemo(() => {
    const branch = branches.find((b) => b.id === employee.branchId);
    return branch?.departments ?? [];
  }, [branches, employee.branchId]);

  useEffect(() => {
    if (isExpanded && canEdit) {
      loadManagers();
      loadBranches();
    }
  }, [isExpanded, canEdit]);

  const loadBranches = async () => {
    try {
      setLoadingBranches(true);
      const data = await branchService.getBranches({ isActive: true });
      setBranches(data);
    } catch (error) {
      logger.error('[EmploymentRoleSection] Failed to load branches', error, {
        employeeId: employee.id,
      });
    } finally {
      setLoadingBranches(false);
    }
  };

  const loadManagers = async () => {
    try {
      setLoadingManagers(true);
      const allEmployees = await employeeService.getAllEmployees();
      // Filter for managers, HR, and admins
      const managersList = allEmployees.filter(
        (emp) => emp.role === UserRole.MANAGER || emp.role === UserRole.HR || emp.role === UserRole.ADMIN
      );
      setManagers(managersList);
    } catch (error) {
      logger.error('[EmploymentRoleSection] Failed to load managers', error, {
        employeeId: employee.id,
      });
    } finally {
      setLoadingManagers(false);
    }
  };

  const handleSave = async (field: string, value: string) => {
    const update: UpdateEmployeeDetailsRequest = {
      [field]: value || undefined,
    };
    await onUpdate(update);
    onUnsavedChange(false);
  };

  const handleRoleChange = async (value: string) => {
    const update: UpdateEmployeeDetailsRequest = {
      role: value as UserRole,
    };
    await onUpdate(update);
    onUnsavedChange(false);
  };

  const handleEmploymentTypeChange = async (value: string) => {
    const update: UpdateEmployeeDetailsRequest = {
      employmentType: value as EmploymentType,
    };
    await onUpdate(update);
    onUnsavedChange(false);
  };

  const handleManagerChange = async (value: string) => {
    const update: UpdateEmployeeDetailsRequest = {
      reportingManagerId: value || undefined,
    };
    await onUpdate(update);
    onUnsavedChange(false);
  };

  const handleBranchChange = async (value: string) => {
    const nextDepts = branches.find((b) => b.id === value)?.departments ?? [];
    const prevVis =
      employee.visibleDepartments && employee.visibleDepartments.length > 0
        ? employee.visibleDepartments
        : branchDepartments;
    const intersect = nextDepts.filter((d) => prevVis.includes(d));
    const nextVisible = intersect.length > 0 ? intersect : nextDepts;
    const update: UpdateEmployeeDetailsRequest = {
      branchId: value || undefined,
      visibleDepartments: nextVisible,
      department: nextVisible[0] || undefined,
    };
    await onUpdate(update);
    onUnsavedChange(false);
  };

  const handleModulesChange = async (next: string[]) => {
    const update: UpdateEmployeeDetailsRequest = {
      visibleDepartments: next,
      department: next[0] || undefined,
    };
    await onUpdate(update);
    onUnsavedChange(false);
  };

  const selectedModules =
    employee.visibleDepartments && employee.visibleDepartments.length > 0
      ? employee.visibleDepartments.filter((d) => branchDepartments.includes(d))
      : branchDepartments;

  return (
    <CollapsibleSection
      title="Employment & Role Details"
      icon="💼"
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <div className="employment-role-content">
        <div className="employment-role-grid">
          {canEdit ? (
            <div className="form-field">
              <label className="field-label">Role *</label>
              <select
                className="form-select"
                value={employee.role}
                onChange={(e) => handleRoleChange(e.target.value)}
                disabled={!canEdit}
              >
                <option value={UserRole.EMPLOYEE}>Employee</option>
                <option value={UserRole.MANAGER}>Manager</option>
                <option value={UserRole.HR}>HR</option>
                <option value={UserRole.ADMIN}>Admin</option>
              </select>
              <small className="field-hint">Changing role affects permissions</small>
            </div>
          ) : (
            <div className="form-field">
              <label className="field-label">Role</label>
              <div className="field-value read-only">{employee.role}</div>
            </div>
          )}

          <InlineEditField
            label="Designation / Title"
            value={employee.designation || ''}
            onSave={(value) => handleSave('designation', value)}
            disabled={!canEdit}
            placeholder="Enter designation"
          />

          {canEdit ? (
            <div className="form-field form-field--full-width">
              <BranchModuleCheckboxGroup
                label="Modules"
                options={branchDepartments}
                value={selectedModules}
                onChange={(next) => void handleModulesChange(next)}
                disabled={!canEdit || !employee.branchId}
                hint={
                  employee.branchId
                    ? 'Only selected modules appear for this employee after sign-in.'
                    : 'Assign a branch to configure modules.'
                }
              />
            </div>
          ) : (
            <div className="form-field">
              <label className="field-label">Modules</label>
              <div className="field-value read-only">
                {selectedModules.length
                  ? selectedModules.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')
                  : '—'}
              </div>
            </div>
          )}

          {canEdit ? (
            <div className="form-field">
              <label className="field-label">Branch</label>
              <select
                className="form-select"
                value={employee.branchId || ''}
                onChange={(e) => handleBranchChange(e.target.value)}
                disabled={!canEdit || loadingBranches}
              >
                <option value="">None</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="form-field">
              <label className="field-label">Branch</label>
              <div className="field-value read-only">
                {employee.branchId
                  ? branches.find((b) => b.id === employee.branchId)?.name || '—'
                  : '—'}
              </div>
            </div>
          )}

          {canEdit ? (
            <div className="form-field">
              <label className="field-label">Reporting Manager</label>
              <select
                className="form-select"
                value={employee.reportingManager?.id || ''}
                onChange={(e) => handleManagerChange(e.target.value)}
                disabled={!canEdit || loadingManagers}
              >
                <option value="">None</option>
                {managers.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.name} ({manager.email})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="form-field">
              <label className="field-label">Reporting Manager</label>
              <div className="field-value read-only">
                {employee.reportingManager?.name || '—'}
              </div>
            </div>
          )}

          {canEdit ? (
            <div className="form-field">
              <label className="field-label">Employment Type</label>
              <select
                className="form-select"
                value={employee.employmentType || ''}
                onChange={(e) => handleEmploymentTypeChange(e.target.value)}
                disabled={!canEdit}
              >
                <option value="">Select type</option>
                <option value={EmploymentType.FULL_TIME}>Full-time</option>
                <option value={EmploymentType.PART_TIME}>Part-time</option>
                <option value={EmploymentType.CONTRACT}>Contract</option>
              </select>
            </div>
          ) : (
            <div className="form-field">
              <label className="field-label">Employment Type</label>
              <div className="field-value read-only">
                {employee.employmentType
                  ? employee.employmentType.replace('_', '-').toUpperCase()
                  : '—'}
              </div>
            </div>
          )}

          <InlineEditField
            label="Joining Date"
            value={employee.dateOfJoining ? employee.dateOfJoining.split('T')[0] : ''}
            onSave={(value) => handleSave('dateOfJoining', value)}
            disabled={!canEdit}
            type="date"
            placeholder="Select joining date"
          />
        </div>
      </div>
    </CollapsibleSection>
  );
};

