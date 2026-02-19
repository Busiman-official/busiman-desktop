/**
 * Reason Code Management - List, filter, CRUD, initialize defaults
 */

import React, { useState, useEffect } from 'react';
import {
  inventoryService,
  ReasonCodeResponse,
  ReasonCodeCategory,
  CreateReasonCodeRequest,
  UpdateReasonCodeRequest,
} from '@/services/inventory.service';
import { Button, Input, Card, Select, Checkbox } from '@/shared/components/ui';
import { LoadingState, EmptyState } from '@/shared/components/data-display';
import { ConfirmDialog } from '@/shared/components/modals';
import { Modal } from '@/shared/components/modals/Modal';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { authStore } from '@/store/authStore';
import { UserRole } from '@/types';
import './ReasonCodeManagement.css';

const CATEGORIES: ReasonCodeCategory[] = ['MOVEMENT', 'ADJUSTMENT', 'DAMAGE', 'WASTE', 'LOSS', 'BLOCK'];

const categoryMovementTypes: Record<ReasonCodeCategory, string> = {
  MOVEMENT: 'Receipt, Issue, Transfer',
  ADJUSTMENT: 'Adjustment, Count, Reversal',
  DAMAGE: 'Damage',
  WASTE: 'Waste',
  LOSS: 'Loss',
  BLOCK: 'Block, Unblock',
};

type FormMode = 'add' | 'edit' | null;

export const ReasonCodeManagement: React.FC = () => {
  const [codes, setCodes] = useState<ReasonCodeResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingCode, setEditingCode] = useState<ReasonCodeResponse | null>(null);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [initLoading, setInitLoading] = useState(false);

  const isAdmin = authStore((s) => s.hasRole?.(UserRole.ADMIN) ?? s.user?.role === 'admin');

  const loadCodes = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = isAdmin
        ? await inventoryService.getAllReasonCodesIncludingInactive()
        : await inventoryService.getReasonCodes();
      setCodes(data);
    } catch (err: unknown) {
      const message = extractErrorMessage(err, 'Failed to load reason codes');
      setError(message);
      logger.error('[ReasonCodeManagement] Failed to load reason codes', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCodes();
  }, [isAdmin]);

  const filteredCodes = categoryFilter
    ? codes.filter((c) => c.category === categoryFilter)
    : codes;

  const handleInitialize = async () => {
    setInitLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.initializeReasonCodes();
      setSuccess('Default reason codes initialized.');
      loadCodes();
    } catch (err: unknown) {
      const message = extractErrorMessage(err, 'Failed to initialize');
      setError(message);
    } finally {
      setInitLoading(false);
    }
  };

  const handleDeactivateConfirm = async () => {
    if (!deactivateId) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.deactivateReasonCode(deactivateId);
      setSuccess('Reason code deactivated.');
      setDeactivateId(null);
      loadCodes();
    } catch (err: unknown) {
      const message = extractErrorMessage(err, 'Failed to deactivate');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="reason-code-management">
      <div className="reason-code-toolbar">
        <h3>Reason Codes</h3>
        <div className="reason-code-actions">
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="reason-code-filter"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Select>
          {isAdmin && (
            <>
              <Button
                variant="secondary"
                onClick={handleInitialize}
                disabled={initLoading}
              >
                {initLoading ? 'Initializing...' : 'Initialize defaults'}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setEditingCode(null);
                  setFormMode('add');
                }}
              >
                Add reason code
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <div className="reason-code-message reason-code-error">{error}</div>}
      {success && <div className="reason-code-message reason-code-success">{success}</div>}

      {loading && !codes.length ? (
        <LoadingState message="Loading reason codes..." />
      ) : filteredCodes.length === 0 ? (
        <EmptyState
          message={
            categoryFilter
              ? `No reason codes in category ${categoryFilter}.`
              : 'No reason codes found. Initialize defaults or add one.'
          }
        />
      ) : (
        <div className="reason-code-table-wrap">
          <table className="reason-code-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Requires approval</th>
                <th>Requires attachment</th>
                <th>Status</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredCodes.map((code) => (
                <tr key={code.id}>
                  <td><code className="reason-code-code">{code.code}</code></td>
                  <td>{code.name}</td>
                  <td>
                    <span title={categoryMovementTypes[code.category] ?? ''}>
                      {code.category}
                    </span>
                  </td>
                  <td>{code.requiresApproval ? 'Yes' : 'No'}</td>
                  <td>{code.requiresAttachment ? 'Yes' : 'No'}</td>
                  <td>
                    <span className={code.isActive ? 'reason-code-status-active' : 'reason-code-status-inactive'}>
                      {code.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="reason-code-row-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingCode(code);
                            setFormMode('edit');
                          }}
                        >
                          Edit
                        </Button>
                        {code.isActive ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeactivateId(code.id)}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              setError(null);
                              try {
                                await inventoryService.updateReasonCode(code.id, { isActive: true });
                                setSuccess('Reason code activated.');
                                loadCodes();
                              } catch (err: unknown) {
                                setError(extractErrorMessage(err, 'Failed to activate'));
                              }
                            }}
                          >
                            Activate
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formMode && (
        <ReasonCodeFormModal
          mode={formMode}
          initial={editingCode ?? undefined}
          onClose={() => {
            setFormMode(null);
            setEditingCode(null);
          }}
          onSuccess={() => {
            setFormMode(null);
            setEditingCode(null);
            loadCodes();
          }}
          setError={setError}
          setSuccess={setSuccess}
        />
      )}

      <ConfirmDialog
        isOpen={!!deactivateId}
        onConfirm={handleDeactivateConfirm}
        onCancel={() => setDeactivateId(null)}
        title="Deactivate reason code"
        message="Are you sure you want to deactivate this reason code? Default system codes cannot be deactivated."
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        variant="warning"
      />
    </div>
  );
};

interface ReasonCodeFormModalProps {
  mode: 'add' | 'edit';
  initial?: ReasonCodeResponse;
  onClose: () => void;
  onSuccess: () => void;
  setError: (s: string | null) => void;
  setSuccess: (s: string | null) => void;
}

const ReasonCodeFormModal: React.FC<ReasonCodeFormModalProps> = ({
  mode,
  initial,
  onClose,
  onSuccess,
  setError,
  setSuccess,
}) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [category, setCategory] = useState<ReasonCodeCategory>(initial?.category ?? 'MOVEMENT');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [requiresApproval, setRequiresApproval] = useState(initial?.requiresApproval ?? false);
  const [requiresAttachment, setRequiresAttachment] = useState(initial?.requiresAttachment ?? false);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      if (mode === 'add') {
        const body: CreateReasonCodeRequest = {
          code: code.trim().toUpperCase(),
          name: name.trim(),
          category,
          description: description.trim() || undefined,
          requiresApproval,
          requiresAttachment,
        };
        await inventoryService.createReasonCode(body);
        setSuccess('Reason code created.');
      } else if (initial) {
        const body: UpdateReasonCodeRequest = {
          name: name.trim(),
          category,
          description: description.trim() || undefined,
          requiresApproval,
          requiresAttachment,
          isActive,
        };
        await inventoryService.updateReasonCode(initial.id, body);
        setSuccess('Reason code updated.');
      }
      onSuccess();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, mode === 'add' ? 'Failed to create' : 'Failed to update'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={mode === 'add' ? 'Add reason code' : 'Edit reason code'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="reason-code-form">
        {mode === 'add' && (
          <div className="form-group">
            <label>Code *</label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
              placeholder="e.g. CUSTOM_DAMAGE"
              required
            />
          </div>
        )}
        {mode === 'edit' && (
          <div className="form-group">
            <label>Code</label>
            <Input value={initial?.code ?? ''} disabled />
          </div>
        )}
        <div className="form-group">
          <label>Name *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            required
          />
        </div>
        <div className="form-group">
          <label>Category *</label>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as ReasonCodeCategory)}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Select>
        </div>
        <div className="form-group">
          <label>Description</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>
        <div className="form-group form-group-checkbox">
          <Checkbox
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
            label="Requires approval"
          />
        </div>
        <div className="form-group form-group-checkbox">
          <Checkbox
            checked={requiresAttachment}
            onChange={(e) => setRequiresAttachment(e.target.checked)}
            label="Requires attachment"
          />
        </div>
        {mode === 'edit' && (
          <div className="form-group form-group-checkbox">
            <Checkbox
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              label="Active"
            />
          </div>
        )}
        <div className="reason-code-form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving...' : mode === 'add' ? 'Create' : 'Update'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
