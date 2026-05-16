/**
 * Shift & Attendance Section - Central control for attendance behavior
 * Uses shift assignment API for managing employee shift assignments
 */

import React, { useState, useEffect } from 'react';
import { EmployeeDetails, UpdateEmployeeDetailsRequest, AttendanceMode } from '@/types';
import { CollapsibleSection, Button } from '@/shared/components/ui';
import { Modal } from '@/shared/components/modals';
import { shiftService } from '@/services/shift.service';
import { employeeService } from '@/services/employee.service';
import { Shift, ShiftAssignment, CreateShiftAssignmentRequest } from '@/types/shift';
import { logger } from '@/shared/utils/logger';
import './ShiftAttendanceSection.css';

interface ShiftAttendanceSectionProps {
  employee: EmployeeDetails;
  onUpdate: (request: UpdateEmployeeDetailsRequest) => Promise<void>;
  canEdit: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onUnsavedChange: (hasChanges: boolean) => void;
}

export const ShiftAttendanceSection: React.FC<ShiftAttendanceSectionProps> = ({
  employee,
  onUpdate,
  canEdit,
  isExpanded,
  onToggle,
  onUnsavedChange,
}) => {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [currentAssignment, setCurrentAssignment] = useState<ShiftAssignment | null>(null);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [loadingAssignment, setLoadingAssignment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideUserOptions, setOverrideUserOptions] = useState<{ id: string; name: string }[]>([]);
  const [selectedOverrideUserIds, setSelectedOverrideUserIds] = useState<string[]>([]);
  const [loadingOverrideUsers, setLoadingOverrideUsers] = useState(false);
  const [savingOverrideUsers, setSavingOverrideUsers] = useState(false);

  useEffect(() => {
    if (isExpanded && canEdit) {
      loadShifts();
      loadCurrentAssignment();
    }
  }, [isExpanded, canEdit, employee.id]);

  const loadShifts = async () => {
    try {
      setLoadingShifts(true);
      const response = await shiftService.listShifts({ status: 'active' });
      setShifts(response.shifts || []);
    } catch (error) {
      logger.error('[ShiftAttendanceSection] Failed to load shifts', error, {
        employeeId: employee.id,
      });
    } finally {
      setLoadingShifts(false);
    }
  };

  const loadCurrentAssignment = async () => {
    try {
      setLoadingAssignment(true);
      const assignment = await shiftService.getEmployeeShift(employee.id);
      setCurrentAssignment(assignment);
    } catch (error) {
      logger.error('[ShiftAttendanceSection] Failed to load current assignment', error, {
        employeeId: employee.id,
      });
      setCurrentAssignment(null);
    } finally {
      setLoadingAssignment(false);
    }
  };

  const handleShiftChange = async (shiftId: string) => {
    setError(null);
    try {
      if (!shiftId) {
        // Remove shift assignment
        if (currentAssignment) {
          await shiftService.cancelAssignment(currentAssignment.id);
          setCurrentAssignment(null);
        }
        // Also clear from user model for backward compatibility
        const update: UpdateEmployeeDetailsRequest = {
          assignedShiftId: undefined,
          shiftAssignmentType: undefined,
        };
        await onUpdate(update);
      } else {
        // Create or update shift assignment
        if (currentAssignment) {
          // Update existing assignment
          await shiftService.updateAssignment(currentAssignment.id, {
            shiftId: shiftId,
            assignmentType: 'permanent',
          });
          // Reload assignment to get updated data
          await loadCurrentAssignment();
        } else {
          // Create new assignment
          const assignmentRequest: CreateShiftAssignmentRequest = {
            assignmentMode: 'individual',
            employeeId: employee.id,
            shiftId: shiftId,
            assignmentType: 'permanent',
            startDate: new Date().toISOString().split('T')[0],
          };
          const result = await shiftService.createAssignment(assignmentRequest);
          // Check for warnings in response
          if ((result as any).warning) {
            setWarning((result as any).warning);
            // Clear warning after 10 seconds
            setTimeout(() => setWarning(null), 10000);
          }
          // Reload assignment to get created data
          await loadCurrentAssignment();
        }
        // Also update user model for backward compatibility
        const update: UpdateEmployeeDetailsRequest = {
          assignedShiftId: shiftId,
          shiftAssignmentType: 'permanent',
        };
        await onUpdate(update);
      }
      onUnsavedChange(false);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to update shift assignment';
      logger.error('[ShiftAttendanceSection] Failed to update shift assignment', err, {
        employeeId: employee.id,
        shiftId,
      });
      setError(errorMessage);
    }
  };

  const handleAssignmentTypeChange = async (type: string) => {
    setError(null);
    try {
      if (currentAssignment) {
        await shiftService.updateAssignment(currentAssignment.id, {
          assignmentType: type as any,
        });
        await loadCurrentAssignment();
      }
      // Also update user model for backward compatibility
      const update: UpdateEmployeeDetailsRequest = {
        shiftAssignmentType: type as any,
      };
      await onUpdate(update);
      onUnsavedChange(false);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to update assignment type';
      logger.error('[ShiftAttendanceSection] Failed to update assignment type', err, {
        employeeId: employee.id,
        assignmentId: currentAssignment?.id,
        type,
      });
      setError(errorMessage);
    }
  };

  const handleDateChange = async (field: string, value: string) => {
    setError(null);
    try {
      if (currentAssignment) {
        const updateData: any = {};
        if (field === 'shiftEffectiveFrom') {
          updateData.startDate = value;
        } else if (field === 'shiftEffectiveTo') {
          updateData.endDate = value || undefined;
        }
        await shiftService.updateAssignment(currentAssignment.id, updateData);
        await loadCurrentAssignment();
      }
      // Also update user model for backward compatibility
      const update: UpdateEmployeeDetailsRequest = {
        [field]: value || undefined,
      };
      await onUpdate(update);
      onUnsavedChange(false);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to update date';
      logger.error('[ShiftAttendanceSection] Failed to update date', err, {
        employeeId: employee.id,
        assignmentId: currentAssignment?.id,
        field,
        value,
      });
      setError(errorMessage);
    }
  };

  const handleAttendanceModeChange = async (mode: string) => {
    const update: UpdateEmployeeDetailsRequest = {
      attendanceMode: mode as AttendanceMode,
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

  const loadOverrideUserOptions = async () => {
    setLoadingOverrideUsers(true);
    try {
      const all = await employeeService.getAllEmployees();
      setOverrideUserOptions(
        all
          .filter((e) => e.isActive !== false && e.id !== employee.id)
          .map((e) => ({ id: e.id, name: e.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (err) {
      logger.error('[ShiftAttendanceSection] Failed to load employees for override modal', err, {
        employeeId: employee.id,
      });
    } finally {
      setLoadingOverrideUsers(false);
    }
  };

  const openOverrideModal = async (initialIds: string[]) => {
    setSelectedOverrideUserIds(initialIds);
    setOverrideModalOpen(true);
    if (overrideUserOptions.length === 0) {
      await loadOverrideUserOptions();
    }
  };

  const handleManualOverrideToggle = async (checked: boolean) => {
    if (checked) {
      await openOverrideModal(employee.manualAttendanceOverrideAllowedUserIds ?? []);
      return;
    }
    await onUpdate({
      allowManualAttendanceOverride: false,
      manualAttendanceOverrideAllowedUserIds: [],
    });
    onUnsavedChange(false);
  };

  const toggleOverrideUser = (userId: string) => {
    setSelectedOverrideUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const saveOverrideUsers = async () => {
    setSavingOverrideUsers(true);
    setError(null);
    try {
      await onUpdate({
        allowManualAttendanceOverride: true,
        manualAttendanceOverrideAllowedUserIds: selectedOverrideUserIds,
      });
      onUnsavedChange(false);
      setOverrideModalOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save manual override settings');
    } finally {
      setSavingOverrideUsers(false);
    }
  };

  // Determine displayed shift info - prefer current assignment, fallback to employee.assignedShift
  const displayShift = currentAssignment?.shiftId 
    ? shifts.find(s => s.id === currentAssignment.shiftId) 
    : employee.assignedShift;
  const displayAssignmentType = currentAssignment?.assignmentType || employee.shiftAssignmentType;
  const displayStartDate = currentAssignment?.startDate || employee.shiftEffectiveFrom;
  const displayEndDate = currentAssignment?.endDate || employee.shiftEffectiveTo;

  return (
    <CollapsibleSection
      title="Shift & Attendance Configuration"
      icon="🕐"
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <div className="shift-attendance-content">
        {error && (
          <div className="shift-attendance-error" style={{ color: 'red', marginBottom: '1rem', padding: '0.5rem', backgroundColor: '#fee', borderRadius: '4px' }}>
            {error}
          </div>
        )}
        {warning && (
          <div className="shift-attendance-warning" style={{ color: '#856404', marginBottom: '1rem', padding: '0.5rem', backgroundColor: '#fff3cd', borderRadius: '4px', borderLeft: '4px solid #ffc107' }}>
            ⚠️ {warning}
          </div>
        )}
        <div className="shift-attendance-grid">
          {canEdit ? (
            <div className="form-field">
              <label className="field-label">Assigned Shift</label>
              <select
                className="form-select"
                value={displayShift?.id || (employee.assignedShift?.id || '')}
                onChange={(e) => handleShiftChange(e.target.value)}
                disabled={!canEdit || loadingShifts || loadingAssignment}
              >
                <option value="">No shift assigned</option>
                {shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name} ({shift.code}) - {shift.startTime} to {shift.endTime}
                  </option>
                ))}
              </select>
              <small className="field-hint">Uses shift assignment API - changes do not retroactively affect attendance</small>
            </div>
          ) : (
            <div className="form-field">
              <label className="field-label">Assigned Shift</label>
              <div className="field-value read-only">
                {displayShift
                  ? `${displayShift.name} (${displayShift.code})`
                  : employee.assignedShift
                  ? `${employee.assignedShift.name} (${employee.assignedShift.code})`
                  : '—'}
              </div>
            </div>
          )}

          {canEdit ? (
            <div className="form-field">
              <label className="field-label">Assignment Type</label>
              <select
                className="form-select"
                value={displayAssignmentType || ''}
                onChange={(e) => handleAssignmentTypeChange(e.target.value)}
                disabled={!canEdit || !currentAssignment || loadingAssignment}
              >
                <option value="">Select type</option>
                <option value="permanent">Permanent</option>
                <option value="temporary">Temporary</option>
                <option value="rotational">Rotational</option>
                <option value="override">Override</option>
              </select>
              {!currentAssignment && (
                <small className="field-hint">Create a shift assignment first to change type</small>
              )}
            </div>
          ) : (
            <div className="form-field">
              <label className="field-label">Assignment Type</label>
              <div className="field-value read-only">
                {displayAssignmentType || '—'}
              </div>
            </div>
          )}

          {(displayAssignmentType === 'temporary' || displayAssignmentType === 'override') && (
            <>
              <div className="form-field">
                <label className="field-label">Effective From</label>
                {canEdit ? (
                  <input
                    type="date"
                    className="form-input"
                    value={displayStartDate ? (typeof displayStartDate === 'string' ? displayStartDate.split('T')[0] : new Date(displayStartDate).toISOString().split('T')[0]) : ''}
                    onChange={(e) => handleDateChange('shiftEffectiveFrom', e.target.value)}
                    disabled={!canEdit || !currentAssignment || loadingAssignment}
                  />
                ) : (
                  <div className="field-value read-only">
                    {displayStartDate
                      ? new Date(displayStartDate).toLocaleDateString()
                      : '—'}
                  </div>
                )}
              </div>

              <div className="form-field">
                <label className="field-label">Effective To</label>
                {canEdit ? (
                  <input
                    type="date"
                    className="form-input"
                    value={displayEndDate ? (typeof displayEndDate === 'string' ? displayEndDate.split('T')[0] : new Date(displayEndDate).toISOString().split('T')[0]) : ''}
                    onChange={(e) => handleDateChange('shiftEffectiveTo', e.target.value)}
                    disabled={!canEdit || !currentAssignment || loadingAssignment}
                  />
                ) : (
                  <div className="field-value read-only">
                    {displayEndDate
                      ? new Date(displayEndDate).toLocaleDateString()
                      : '—'}
                  </div>
                )}
              </div>
            </>
          )}

          {canEdit ? (
            <div className="form-field">
              <label className="field-label">Attendance Mode</label>
              <select
                className="form-select"
                value={employee.attendanceMode || AttendanceMode.STRICT}
                onChange={(e) => handleAttendanceModeChange(e.target.value)}
                disabled={!canEdit}
              >
                <option value={AttendanceMode.STRICT}>Strict</option>
                <option value={AttendanceMode.FLEXIBLE}>Flexible</option>
              </select>
            </div>
          ) : (
            <div className="form-field">
              <label className="field-label">Attendance Mode</label>
              <div className="field-value read-only">
                {employee.attendanceMode || AttendanceMode.STRICT}
              </div>
            </div>
          )}

          <div className="form-field toggle-field manual-override-field">
            <label className="field-label">Allow Manual Attendance Override</label>
            {canEdit ? (
              <div className="manual-override-controls">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={employee.allowManualAttendanceOverride || false}
                    onChange={(e) => handleManualOverrideToggle(e.target.checked)}
                    disabled={!canEdit}
                  />
                  <span className="toggle-slider"></span>
                </label>
                {employee.allowManualAttendanceOverride ? (
                  <button
                    type="button"
                    className="manual-override-edit-link"
                    onClick={() =>
                      openOverrideModal(employee.manualAttendanceOverrideAllowedUserIds ?? [])
                    }
                  >
                    Edit allowed users (
                    {employee.manualAttendanceOverrideAllowedUserIds?.length ?? 0})
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="field-value read-only">
                {employee.allowManualAttendanceOverride
                  ? `Yes (${employee.manualAttendanceOverrideAllowedUserIds?.length ?? 0} users)`
                  : 'No'}
              </div>
            )}
          </div>

          <div className="form-field toggle-field">
            <label className="field-label">Location Restriction Override</label>
            {canEdit ? (
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={employee.locationRestrictionOverride || false}
                  onChange={(e) => handleToggle('locationRestrictionOverride', e.target.checked)}
                  disabled={!canEdit}
                />
                <span className="toggle-slider"></span>
              </label>
            ) : (
              <div className="field-value read-only">
                {employee.locationRestrictionOverride ? 'Yes' : 'No'}
              </div>
            )}
          </div>

          <div className="form-field toggle-field">
            <label className="field-label">Device Restriction Override</label>
            {canEdit ? (
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={employee.deviceRestrictionOverride || false}
                  onChange={(e) => handleToggle('deviceRestrictionOverride', e.target.checked)}
                  disabled={!canEdit}
                />
                <span className="toggle-slider"></span>
              </label>
            ) : (
              <div className="field-value read-only">
                {employee.deviceRestrictionOverride ? 'Yes' : 'No'}
              </div>
            )}
          </div>

          <div className="form-field toggle-field">
            <label className="field-label">Allow check-in without network verification</label>
            {canEdit ? (
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={employee.allowCheckinWithoutWifi || false}
                  onChange={(e) => handleToggle('allowCheckinWithoutWifi', e.target.checked)}
                  disabled={!canEdit}
                />
                <span className="toggle-slider"></span>
              </label>
            ) : (
              <div className="field-value read-only">
                {employee.allowCheckinWithoutWifi ? 'Yes' : 'No'}
              </div>
            )}
          </div>

          <div className="form-field toggle-field">
            <label className="field-label">Allow check-out without network verification</label>
            {canEdit ? (
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={employee.allowCheckoutWithoutWifi || false}
                  onChange={(e) => handleToggle('allowCheckoutWithoutWifi', e.target.checked)}
                  disabled={!canEdit}
                />
                <span className="toggle-slider"></span>
              </label>
            ) : (
              <div className="field-value read-only">
                {employee.allowCheckoutWithoutWifi ? 'Yes' : 'No'}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={overrideModalOpen}
        onClose={() => setOverrideModalOpen(false)}
        title="Who can override attendance?"
        size="md"
      >
        <p className="manual-override-modal-hint">
          Admins can always override. Select additional users allowed to manually update this
          employee&apos;s attendance.
        </p>
        {loadingOverrideUsers ? (
          <p className="manual-override-modal-loading">Loading employees…</p>
        ) : (
          <div className="manual-override-user-list" role="group" aria-label="Allowed users">
            {overrideUserOptions.length === 0 ? (
              <p className="manual-override-modal-empty">No other active employees found.</p>
            ) : (
              overrideUserOptions.map((opt) => (
                <label key={opt.id} className="manual-override-user-item">
                  <input
                    type="checkbox"
                    checked={selectedOverrideUserIds.includes(opt.id)}
                    onChange={() => toggleOverrideUser(opt.id)}
                  />
                  <span>{opt.name}</span>
                </label>
              ))
            )}
          </div>
        )}
        <div className="manual-override-modal-actions">
          <Button variant="secondary" onClick={() => setOverrideModalOpen(false)} disabled={savingOverrideUsers}>
            Cancel
          </Button>
          <Button onClick={saveOverrideUsers} disabled={savingOverrideUsers || loadingOverrideUsers}>
            {savingOverrideUsers ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Modal>
    </CollapsibleSection>
  );
};

