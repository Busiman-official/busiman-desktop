/**
 * Permissions & Overrides Section - Controlled exceptions without rule breakage
 */

import React, { useState } from 'react';
import { EmployeeDetails, UpdateEmployeeDetailsRequest, UserRole } from '@/types';
import { CollapsibleSection, Button } from '@/shared/components/ui';
import { Modal } from '@/shared/components/modals';
import { employeeService, employeeDetailsService } from '@/services/employee.service';
import { logger } from '@/shared/utils/logger';
import './PermissionsSection.css';

interface PermissionsSectionProps {
  employee: EmployeeDetails;
  onUpdate: (request: UpdateEmployeeDetailsRequest) => Promise<void>;
  /** Re-fetches this employee's details after a change that isn't made through `onUpdate` (the
   * Attendance Officer assignment goes through its own dedicated endpoint, not the general
   * update-details PATCH, so it needs its own refresh hook). */
  onRefresh?: () => Promise<void> | void;
  canEdit: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onUnsavedChange: (hasChanges: boolean) => void;
}

export const PermissionsSection: React.FC<PermissionsSectionProps> = ({
  employee,
  onUpdate,
  onRefresh,
  canEdit,
  isExpanded,
  onToggle,
  onUnsavedChange,
}) => {
  const [officerModalOpen, setOfficerModalOpen] = useState(false);
  const [officerEmployeeOptions, setOfficerEmployeeOptions] = useState<
    { id: string; name: string; label: string }[]
  >([]);
  const [selectedOfficerEmployeeIds, setSelectedOfficerEmployeeIds] = useState<string[]>([]);
  const [loadingOfficerEmployees, setLoadingOfficerEmployees] = useState(false);
  const [savingOfficerEmployees, setSavingOfficerEmployees] = useState(false);
  const [officerError, setOfficerError] = useState<string | null>(null);

  const loadOfficerEmployeeOptions = async () => {
    setLoadingOfficerEmployees(true);
    try {
      const all = await employeeService.getAllEmployees();
      // Admins are never a valid target — they're already top of the hierarchy and manage their
      // own attendance; managers, HR, and plain employees can all have an officer delegated over
      // them, same as they can already have a reporting manager.
      const eligible = all.filter(
        (e) =>
          e.isActive !== false &&
          e.id !== employee.id &&
          e.branchId === employee.branchId &&
          e.role !== UserRole.ADMIN
      );
      const nameCounts = new Map<string, number>();
      for (const e of eligible) {
        nameCounts.set(e.name, (nameCounts.get(e.name) ?? 0) + 1);
      }
      setOfficerEmployeeOptions(
        eligible
          .map((e) => ({
            id: e.id,
            name: e.name,
            // Disambiguate same-name employees (e.g. two people both named "Nishu") with their
            // email, since the plain name alone is otherwise impossible to tell apart in the list.
            label: (nameCounts.get(e.name) ?? 0) > 1 && e.email ? `${e.name} (${e.email})` : e.name,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (err) {
      logger.error('[PermissionsSection] Failed to load employees for attendance officer modal', err, {
        employeeId: employee.id,
      });
    } finally {
      setLoadingOfficerEmployees(false);
    }
  };

  const openOfficerModal = async () => {
    setOfficerError(null);
    setOfficerModalOpen(true);
    setLoadingOfficerEmployees(true);
    try {
      const [currentlyAssigned] = await Promise.all([
        employeeDetailsService.getAttendanceOfficerFor(employee.id),
        officerEmployeeOptions.length === 0 ? loadOfficerEmployeeOptions() : Promise.resolve(),
      ]);
      setSelectedOfficerEmployeeIds(currentlyAssigned);
    } catch (err) {
      logger.error('[PermissionsSection] Failed to load current attendance officer assignment', err, {
        employeeId: employee.id,
      });
    } finally {
      setLoadingOfficerEmployees(false);
    }
  };

  const toggleOfficerEmployee = (employeeId: string) => {
    setSelectedOfficerEmployeeIds((prev) =>
      prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId]
    );
  };

  const saveOfficerEmployees = async () => {
    setSavingOfficerEmployees(true);
    setOfficerError(null);
    try {
      await employeeDetailsService.setAttendanceOfficerFor(employee.id, selectedOfficerEmployeeIds);
      setOfficerModalOpen(false);
      await onRefresh?.();
    } catch (err: any) {
      setOfficerError(err.message || 'Failed to save attendance officer assignment');
    } finally {
      setSavingOfficerEmployees(false);
    }
  };

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

          {employee.visibleDepartments?.includes('service') && employee.role !== UserRole.ADMIN ? (
            <div className="form-field toggle-field">
              <label className="field-label">Skip Outsourcing Approval</label>
              {canEdit ? (
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={employee.featurePermissions?.includes('canSkipOutsourcingApproval') || false}
                    onChange={(e) => handleFeaturePermissionToggle('canSkipOutsourcingApproval', e.target.checked)}
                    disabled={!canEdit}
                  />
                  <span className="toggle-slider"></span>
                </label>
              ) : (
                <div className="field-value read-only">
                  {employee.featurePermissions?.includes('canSkipOutsourcingApproval') ? 'Yes' : 'No'}
                </div>
              )}
              <small className="field-hint">
                This employee's outsourcing sends go out immediately, skipping manager approval.
                Off by default for every role — admins always have this.
              </small>
            </div>
          ) : null}

          {employee.visibleDepartments?.includes('service') && employee.role !== UserRole.ADMIN ? (
            <div className="form-field toggle-field">
              <label className="field-label">Backdate Outsourcing</label>
              {canEdit ? (
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={employee.featurePermissions?.includes('canBackdateOutsourcing') || false}
                    onChange={(e) => handleFeaturePermissionToggle('canBackdateOutsourcing', e.target.checked)}
                    disabled={!canEdit}
                  />
                  <span className="toggle-slider"></span>
                </label>
              ) : (
                <div className="field-value read-only">
                  {employee.featurePermissions?.includes('canBackdateOutsourcing') ? 'Yes' : 'No'}
                </div>
              )}
              <small className="field-hint">
                This employee can register outsourcing orders against a past send date. Off by
                default for every role — admins always have this.
              </small>
            </div>
          ) : null}

          {canEdit ? (
            <div className="form-field attendance-officer-field">
              <label className="field-label">Attendance Officer</label>
              <div>
                <button
                  type="button"
                  className="attendance-officer-edit-link"
                  onClick={() => void openOfficerModal()}
                >
                  Manage employees this person covers
                </button>
              </div>
              <small className="field-hint">
                Delegates full attendance responsibility (mark/clear, approve remote check-ins,
                dashboard visibility) for specific other employees — independent of the org chart
                and this person's own role.
              </small>
            </div>
          ) : null}
        </div>
      </div>

      <Modal
        isOpen={officerModalOpen}
        onClose={() => setOfficerModalOpen(false)}
        title={`Attendance officer for — ${employee.name}`}
        size="md"
      >
        <p className="attendance-officer-modal-hint">
          Select which employees {employee.name} is responsible for attendance-wise: marking/clearing
          their attendance, approving their remote check-ins, and seeing them in the dashboard and
          approvals inbox. Independent of reporting manager.
        </p>
        {officerError ? <p className="attendance-officer-modal-error">{officerError}</p> : null}
        {loadingOfficerEmployees ? (
          <p className="attendance-officer-modal-loading">Loading employees…</p>
        ) : (
          <div className="attendance-officer-user-list" role="group" aria-label="Employees covered">
            {officerEmployeeOptions.length === 0 ? (
              <p className="attendance-officer-modal-empty">
                No other active employees found in this branch.
              </p>
            ) : (
              officerEmployeeOptions.map((opt) => (
                <label key={opt.id} className="attendance-officer-user-item">
                  <input
                    type="checkbox"
                    checked={selectedOfficerEmployeeIds.includes(opt.id)}
                    onChange={() => toggleOfficerEmployee(opt.id)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))
            )}
          </div>
        )}
        <div className="attendance-officer-modal-actions">
          <Button
            variant="secondary"
            onClick={() => setOfficerModalOpen(false)}
            disabled={savingOfficerEmployees}
          >
            Cancel
          </Button>
          <Button onClick={saveOfficerEmployees} disabled={savingOfficerEmployees || loadingOfficerEmployees}>
            {savingOfficerEmployees ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Modal>
    </CollapsibleSection>
  );
};

