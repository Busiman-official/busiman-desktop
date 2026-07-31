/**
 * Permissions & Overrides Section - Controlled exceptions without rule breakage
 */

import React from 'react';
import { EmployeeDetails, UpdateEmployeeDetailsRequest, UserRole } from '@/types';
import { CollapsibleSection } from '@/shared/components/ui';
import './PermissionsSection.css';

interface PermissionsSectionProps {
  employee: EmployeeDetails;
  onUpdate: (request: UpdateEmployeeDetailsRequest) => Promise<void>;
  canEdit: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onUnsavedChange: (hasChanges: boolean) => void;
}

export const PermissionsSection: React.FC<PermissionsSectionProps> = ({
  employee,
  onUpdate,
  canEdit,
  isExpanded,
  onToggle,
  onUnsavedChange,
}) => {
  const handlePermissionChange = async (field: string, value: string | boolean) => {
    const update: UpdateEmployeeDetailsRequest = {
      [field]: value,
    };
    await onUpdate(update);
    onUnsavedChange(false);
  };

  const handleToggle = async (field: string, value: boolean) => {
    const update: UpdateEmployeeDetailsRequest = {
      [field]: value,
    };
    await onUpdate(update);
    onUnsavedChange(false);
  };

  /** featurePermissions is a single array field shared by several flags — toggling one means
   * replacing the whole array with the flag added/removed, not setting a dedicated column. */
  const handleFeaturePermissionToggle = async (permission: string, enabled: boolean) => {
    const current = employee.featurePermissions ?? [];
    const next = enabled
      ? [...current.filter((p) => p !== permission), permission]
      : current.filter((p) => p !== permission);
    await onUpdate({ featurePermissions: next });
    onUnsavedChange(false);
  };

  return (
    <CollapsibleSection
      title="Permissions & Overrides"
      icon="🔐"
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <div className="permissions-content">
        <div className="permissions-grid">
          {canEdit ? (
            <div className="form-field">
              <label className="field-label">Attendance Override Permission</label>
              <select
                className="form-select"
                value={employee.attendanceOverridePermission || 'none'}
                onChange={(e) => handlePermissionChange('attendanceOverridePermission', e.target.value)}
                disabled={!canEdit}
              >
                <option value="none">None</option>
                <option value="manager">Manager</option>
                <option value="hr_admin">HR/Admin</option>
              </select>
              <small className="field-hint">Who can override attendance for this employee</small>
            </div>
          ) : (
            <div className="form-field">
              <label className="field-label">Attendance Override Permission</label>
              <div className="field-value read-only">
                {employee.attendanceOverridePermission || 'none'}
              </div>
            </div>
          )}

          <div className="form-field toggle-field">
            <label className="field-label">Task Status Override Permission</label>
            {canEdit ? (
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={employee.taskStatusOverridePermission || false}
                  onChange={(e) => handleToggle('taskStatusOverridePermission', e.target.checked)}
                  disabled={!canEdit}
                />
                <span className="toggle-slider"></span>
              </label>
            ) : (
              <div className="field-value read-only">
                {employee.taskStatusOverridePermission ? 'Yes' : 'No'}
              </div>
            )}
          </div>

          <div className="form-field toggle-field">
            <label className="field-label">Overtime Eligibility Override</label>
            {canEdit ? (
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={employee.overtimeEligibilityOverride || false}
                  onChange={(e) => handleToggle('overtimeEligibilityOverride', e.target.checked)}
                  disabled={!canEdit}
                />
                <span className="toggle-slider"></span>
              </label>
            ) : (
              <div className="field-value read-only">
                {employee.overtimeEligibilityOverride ? 'Yes' : 'No'}
              </div>
            )}
          </div>

          <div className="form-field toggle-field">
            <label className="field-label">Break Rule Override</label>
            {canEdit ? (
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={employee.breakRuleOverride || false}
                  onChange={(e) => handleToggle('breakRuleOverride', e.target.checked)}
                  disabled={!canEdit}
                />
                <span className="toggle-slider"></span>
              </label>
            ) : (
              <div className="field-value read-only">
                {employee.breakRuleOverride ? 'Yes' : 'No'}
              </div>
            )}
          </div>

          <div className="form-field toggle-field">
            <label className="field-label">Holiday Working Permission</label>
            {canEdit ? (
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={employee.holidayWorkingPermission || false}
                  onChange={(e) => handleToggle('holidayWorkingPermission', e.target.checked)}
                  disabled={!canEdit}
                />
                <span className="toggle-slider"></span>
              </label>
            ) : (
              <div className="field-value read-only">
                {employee.holidayWorkingPermission ? 'Yes' : 'No'}
              </div>
            )}
          </div>

          <div className="form-field toggle-field">
            <label className="field-label">Can Act as Proxy Server</label>
            {canEdit ? (
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={employee.canActAsProxy || false}
                  onChange={(e) => handleToggle('canActAsProxy', e.target.checked)}
                  disabled={!canEdit}
                />
                <span className="toggle-slider"></span>
              </label>
            ) : (
              <div className="field-value read-only">
                {employee.canActAsProxy ? 'Yes' : 'No'}
              </div>
            )}
            <small className="field-hint">
              Allow this employee to act as a proxy server for attendance requests
            </small>
          </div>

          {employee.visibleDepartments?.includes('sales') && employee.role !== UserRole.ADMIN ? (
            <div className="form-field toggle-field">
              <label className="field-label">Backdate Sales</label>
              {canEdit ? (
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={employee.featurePermissions?.includes('canBackdateSale') || false}
                    onChange={(e) => handleFeaturePermissionToggle('canBackdateSale', e.target.checked)}
                    disabled={!canEdit}
                  />
                  <span className="toggle-slider"></span>
                </label>
              ) : (
                <div className="field-value read-only">
                  {employee.featurePermissions?.includes('canBackdateSale') ? 'Yes' : 'No'}
                </div>
              )}
              <small className="field-hint">
                Register a counter sale against a past date instead of today. Off by default for
                every role — admins always have this.
              </small>
            </div>
          ) : null}

          {employee.visibleDepartments?.includes('expense') && employee.role !== UserRole.ADMIN ? (
            <div className="form-field toggle-field">
              <label className="field-label">Skip Expense Approval</label>
              {canEdit ? (
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={employee.featurePermissions?.includes('canSkipExpenseApproval') || false}
                    onChange={(e) => handleFeaturePermissionToggle('canSkipExpenseApproval', e.target.checked)}
                    disabled={!canEdit}
                  />
                  <span className="toggle-slider"></span>
                </label>
              ) : (
                <div className="field-value read-only">
                  {employee.featurePermissions?.includes('canSkipExpenseApproval') ? 'Yes' : 'No'}
                </div>
              )}
              <small className="field-hint">
                This employee's expenses are approved automatically, skipping the branch's
                manager-approval threshold. Off by default for every role — admins always have this.
              </small>
            </div>
          ) : null}
        </div>
      </div>
    </CollapsibleSection>
  );
};

