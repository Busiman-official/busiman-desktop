/**
 * Profile Summary Section - Basic employee identification and status
 */

import React from 'react';
import { EmployeeDetails, UpdateEmployeeDetailsRequest } from '@/types';
import { CollapsibleSection } from '@/shared/components/ui';
import { InlineEditField } from '@/shared/components/ui';
import { Input } from '@/shared/components/ui';
import './ProfileSummarySection.css';

interface ProfileSummarySectionProps {
  employee: EmployeeDetails;
  onUpdate: (request: UpdateEmployeeDetailsRequest) => Promise<void>;
  canEdit: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onUnsavedChange: (hasChanges: boolean) => void;
}

export const ProfileSummarySection: React.FC<ProfileSummarySectionProps> = ({
  employee,
  onUpdate,
  canEdit,
  isExpanded,
  onToggle,
  onUnsavedChange,
}) => {
  const handleSave = async (field: string, value: string | boolean) => {
    const update: UpdateEmployeeDetailsRequest = {
      [field]: value,
    };
    await onUpdate(update);
    onUnsavedChange(false);
  };

  const handleStatusToggle = async () => {
    if (employee.isActive) {
      const voipNote = employee.sipExtension
        ? ` Their SIP extension (${employee.sipExtension}) will be removed from FreePBX.`
        : '';
      if (!window.confirm(`Deactivate ${employee.name}?${voipNote}`)) {
        return;
      }
    }
    const update: UpdateEmployeeDetailsRequest = {
      isActive: !employee.isActive,
    };
    await onUpdate(update);
    onUnsavedChange(false);
  };

  return (
    <CollapsibleSection
      title="Profile Summary"
      icon="👤"
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <div className="profile-summary-content">
        <div className="profile-summary-grid">
          <div className="profile-field">
            <label className="field-label">Employee ID</label>
            <div className="field-value read-only">{employee.employeeId || '—'}</div>
          </div>

          <InlineEditField
            label="Full Name"
            value={employee.name || ''}
            onSave={(value) => handleSave('name', value)}
            disabled={!canEdit}
            placeholder="Enter full name"
          />

          <div className="profile-field">
            <label className="field-label">Email</label>
            <div className="field-value read-only">{employee.email}</div>
            <small className="field-hint">Login identifier (cannot be changed)</small>
          </div>

          <InlineEditField
            label="Phone Number"
            value={employee.phoneNumber || ''}
            onSave={(value) => handleSave('phoneNumber', value)}
            disabled={!canEdit}
            type="tel"
            placeholder="Enter phone number"
          />

          <div className="profile-field">
            <label className="field-label">Status</label>
            <div className="field-value">
              <span className={`status-badge ${employee.isActive ? 'active' : 'inactive'}`}>
                {employee.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            {canEdit && (
              <button
                className="status-toggle-button"
                onClick={handleStatusToggle}
              >
                {employee.isActive ? 'Deactivate' : 'Activate'}
              </button>
            )}
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
};

