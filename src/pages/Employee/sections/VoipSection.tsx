/**
 * VoIP Section — FreePBX extension on employee details (view + provision on edit).
 */

import React, { useEffect, useState } from 'react';
import { EmployeeDetails, UpdateEmployeeDetailsRequest } from '@/types';
import { CollapsibleSection, Checkbox, Input, Button } from '@/shared/components/ui';
import { voipService } from '@/services/voip.service';
import './VoipSection.css';

interface VoipSectionProps {
  employee: EmployeeDetails;
  onUpdate: (request: UpdateEmployeeDetailsRequest) => Promise<void>;
  canEdit: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onUnsavedChange: (hasChanges: boolean) => void;
}

export const VoipSection: React.FC<VoipSectionProps> = ({
  employee,
  onUpdate,
  canEdit,
  isExpanded,
  onToggle,
  onUnsavedChange,
}) => {
  const hasExtension = Boolean(employee.sipExtension?.trim());
  const [serverConfigured, setServerConfigured] = useState(false);
  const [rangeHint, setRangeHint] = useState('');
  const [enableVoip, setEnableVoip] = useState(false);
  const [sipExtension, setSipExtension] = useState('');
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (hasExtension || !canEdit || !employee.isActive) return;
    let cancelled = false;
    void (async () => {
      try {
        const [status, next] = await Promise.all([
          voipService.getConfigStatus(),
          voipService.getNextExtension(),
        ]);
        if (cancelled) return;
        setServerConfigured(status.configured);
        if (status.configured && status.extensionRangeStart != null && status.extensionRangeEnd != null) {
          setRangeHint(`${status.extensionRangeStart}–${status.extensionRangeEnd}`);
        }
        if (next.extension) {
          setSipExtension(next.extension);
        }
      } catch {
        if (!cancelled) setServerConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasExtension, canEdit, employee.isActive, employee.id]);

  const handleEnableToggle = (checked: boolean) => {
    setEnableVoip(checked);
    onUnsavedChange(checked);
    setLocalError(null);
  };

  const handleExtensionChange = (value: string) => {
    setSipExtension(value.replace(/\D/g, ''));
    onUnsavedChange(true);
    setLocalError(null);
  };

  const handleResetPassword = async () => {
    setSaving(true);
    setLocalError(null);
    try {
      await onUpdate({ resetVoipPassword: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reset SIP password';
      setLocalError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleProvision = async () => {
    if (!enableVoip) return;
    setSaving(true);
    setLocalError(null);
    try {
      await onUpdate({
        enableVoip: true,
        sipExtension: sipExtension.trim() || undefined,
      });
      setEnableVoip(false);
      onUnsavedChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to provision VoIP extension';
      setLocalError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <CollapsibleSection
      title="App Phone (VoIP)"
      icon="📞"
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <div className="voip-section-content">
        {hasExtension ? (
          <>
            <div className="voip-info-grid">
              <div className="voip-field">
                <label className="field-label">SIP Extension</label>
                <div className="field-value read-only">{employee.sipExtension}</div>
              </div>
              <div className="voip-field">
                <label className="field-label">Status</label>
                <div className="field-value read-only">
                  {employee.voipEnabled && employee.isActive ? 'Active' : 'Inactive'}
                </div>
              </div>
            </div>
            <p className="voip-hint">
              Reset updates FreePBX and applies config automatically (no manual Apply Config in
              FreePBX). If reset fails, ensure the API app has scopes gql:core and gql:framework.
              Employee must logout/login and reopen Phone after reset.
            </p>
            {canEdit && employee.voipEnabled && employee.isActive ? (
              <div className="voip-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => void handleResetPassword()}
                >
                  {saving ? 'Resetting SIP password…' : 'Reset SIP password'}
                </Button>
              </div>
            ) : null}
          </>
        ) : !employee.isActive ? (
          <p className="voip-hint">
            Employee is inactive. Activate them first, then assign a VoIP extension here.
          </p>
        ) : !canEdit ? (
          <p className="voip-hint">No VoIP extension assigned.</p>
        ) : !serverConfigured ? (
          <p className="voip-hint">
            VoIP is not configured on the server. Contact your administrator to enable calling.
          </p>
        ) : (
          <>
            <Checkbox
              label="Create FreePBX extension"
              checked={enableVoip}
              onChange={(e) => handleEnableToggle(e.target.checked)}
              disabled={saving}
            />
            <small className="voip-hint">
              Assigns a SIP extension for app calling on this employee&apos;s phone.
            </small>
            {enableVoip ? (
              <>
                <Input
                  label={`SIP extension${rangeHint ? ` (${rangeHint})` : ''}`}
                  type="text"
                  name="sipExtension"
                  value={sipExtension}
                  onChange={(e) => handleExtensionChange(e.target.value)}
                  disabled={saving}
                />
                <small className="voip-hint">
                  Auto-suggested next free extension. Change only if you need a specific number.
                </small>
                <div className="voip-actions">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void handleProvision()}
                    disabled={saving || !sipExtension.trim()}
                  >
                    {saving ? 'Creating extension...' : 'Create extension'}
                  </Button>
                </div>
              </>
            ) : null}
          </>
        )}

        {localError ? <div className="error-message">{localError}</div> : null}
      </div>
    </CollapsibleSection>
  );
};
