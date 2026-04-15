/**
 * Confirm Dialog Component - For confirmation dialogs with optional reason
 */

import React, { useState } from 'react';
import { Modal } from './Modal';
import { Button } from '../ui';
import { Textarea } from '../ui';
import './ConfirmDialog.css';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
  title?: string;
  message: string;
  changes?: Record<string, any>;
  requiresReason?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  employeeName?: string;
  showVariantNotice?: boolean;
  warningMessage?: string;
  dangerMessage?: string;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  title = 'Confirm Changes',
  message,
  changes,
  requiresReason = false,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'warning',
  employeeName,
  showVariantNotice = true,
  warningMessage = 'These changes may affect attendance calculations, permissions, and workflows.',
  dangerMessage = 'This action cannot be undone.',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  showCloseButton = true,
}) => {
  const [reason, setReason] = useState('');

  const handleConfirm = () => {
    if (requiresReason && !reason.trim()) {
      return;
    }
    onConfirm(reason.trim() || undefined);
    setReason(''); // Reset reason on confirm
  };

  const handleCancel = () => {
    setReason(''); // Reset reason on cancel
    onCancel();
  };

  const getChangeDescription = (): string => {
    if (!changes) return '';
    
    const descriptions: string[] = [];
    const changeObj = changes as any;

    if (changeObj.role) {
      descriptions.push(`Role change to ${changeObj.role}`);
    }
    if (changeObj.assignedShiftId) {
      descriptions.push('Shift assignment change');
    }
    if (changeObj.shiftAssignmentType) {
      descriptions.push(`Shift assignment type: ${changeObj.shiftAssignmentType}`);
    }
    if (changeObj.attendanceOverridePermission !== undefined) {
      descriptions.push(`Attendance override permission: ${changeObj.attendanceOverridePermission}`);
    }
    if (changeObj.taskStatusOverridePermission !== undefined) {
      descriptions.push('Task status override permission change');
    }
    if (changeObj.overtimeEligibilityOverride !== undefined) {
      descriptions.push('Overtime eligibility override change');
    }
    if (changeObj.breakRuleOverride !== undefined) {
      descriptions.push('Break rule override change');
    }
    if (changeObj.holidayWorkingPermission !== undefined) {
      descriptions.push('Holiday working permission change');
    }

    return descriptions.join(', ') || 'Profile changes';
  };

  const actualRequiresReason = requiresReason || !!(changes && ((changes as any).role || (changes as any).assignedShiftId || (changes as any).shiftAssignmentType));

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={title}
      size="md"
      closeOnOverlayClick={closeOnOverlayClick}
      closeOnEscape={closeOnEscape}
      showCloseButton={showCloseButton}
    >
      <div className="confirm-dialog">
        <div className="confirm-dialog-message">
          {employeeName ? (
            <>
              You are about to make the following changes to <strong>{employeeName}</strong>:
            </>
          ) : (
            message
          )}
        </div>

        {changes && Object.keys(changes).length > 0 && (
          <div className="confirm-dialog-changes">
            <strong>Changes:</strong> {getChangeDescription()}
          </div>
        )}

        {actualRequiresReason && (
          <div className="confirm-dialog-reason">
            <Textarea
              label="Reason for change *"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Please provide a reason for this change..."
              rows={3}
              required
            />
          </div>
        )}

        {showVariantNotice && variant === 'warning' && (
          <div className="confirm-dialog-warning">
            <strong>⚠️ Warning:</strong> {warningMessage}
          </div>
        )}

        {showVariantNotice && variant === 'danger' && (
          <div className="confirm-dialog-danger">
            <strong>⚠️ Danger:</strong> {dangerMessage}
          </div>
        )}

        <div className="confirm-dialog-actions">
          <Button variant="secondary" onClick={handleCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            disabled={actualRequiresReason && !reason.trim()}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
