/**
 * Variant Management Component - Manage product variants for an item
 */

import React, { useState, useEffect, useMemo, useId, useRef } from 'react';
import {
  inventoryService,
  InventoryVariant,
  CreateVariantRequest,
  CreateVariantResponse,
  UpdateVariantRequest,
} from '@/services/inventory.service';
import { Button, Input, Tooltip, Spinner } from '@/shared/components/ui';
import { DataTable, ColumnDef, FilterConfig } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { ConfirmDialog, SideDrawer } from '@/shared/components/modals';
import './VariantManagement.css';

/** Inline trash icon for delete-variant control (no extra icon package). */
function VariantTrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface VariantManagementProps {
  itemId: string;
  itemName: string;
  /** Product default unit of measure; used when variant has no UoM override. */
  itemDefaultUnitOfMeasure: string;
  selectedVariantId?: string;
  onVariantChange?: () => void;
  onVariantCreated?: (
    variant: InventoryVariant,
    migration?: { ledgerModified: number; serialModified: number }
  ) => void;
  onVariantSelect?: (variantId: string) => void;
}

type ValidationResult =
  | { valid: true }
  | { valid: false; fieldErrors: Record<string, string> };

const HSN_PATTERN = /^\d{4}(\d{2}){0,2}$/;

function validateVariantForm(formData: CreateVariantRequest): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  const name = formData.name?.trim() ?? '';
  if (!name) fieldErrors.name = 'Variant name is required';
  else if (formData.name.length > 500) fieldErrors.name = 'Variant name must be 500 characters or less';
  if (formData.barcode && formData.barcode.length > 100) fieldErrors.barcode = 'Barcode must be 100 characters or less';
  const hsnTrim = formData.hsn?.trim() ?? '';
  if (hsnTrim && !HSN_PATTERN.test(hsnTrim)) {
    fieldErrors.hsn = 'HSN must be 4, 6, or 8 digits (GST India).';
  }
  if (Object.keys(fieldErrors).length > 0) return { valid: false, fieldErrors };
  return { valid: true };
}

export const VariantManagement: React.FC<VariantManagementProps> = ({
  itemId,
  itemName,
  itemDefaultUnitOfMeasure,
  selectedVariantId,
  onVariantChange,
  onVariantCreated,
  onVariantSelect,
}) => {
  const [variants, setVariants] = useState<InventoryVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [variantToDelete, setVariantToDelete] = useState<string | null>(null);
  const [deleteVariantStockOnHand, setDeleteVariantStockOnHand] = useState<number | null>(null);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [variantToDisable, setVariantToDisable] = useState<{ id: string; isActive: boolean } | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [newlyCreatedVariantId, setNewlyCreatedVariantId] = useState<string | null>(null);

  const drawerMessagesId = useId();
  const firstFormFieldRef = useRef<HTMLInputElement | null>(null);
  const variantNameInputRef = useRef<HTMLInputElement | null>(null);
  const addVariantButtonRef = useRef<HTMLButtonElement | null>(null);
  const addFirstVariantRef = useRef<HTMLButtonElement | null>(null);
  const emptyStateHintId = useId();
  const [formData, setFormData] = useState<CreateVariantRequest>({
    itemId,
    name: '',
    isDefault: false,
    barcode: '',
    hsn: '',
    unitOfMeasureOverride: '',
    serviceable: false,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (itemId) {
      loadVariants();
    }
  }, [itemId]);

  /** When there are no variants, focus the empty-state CTA for keyboard users (Enter activates). */
  useEffect(() => {
    if (loading || variants.length > 0 || showDrawer) return;
    const id = window.requestAnimationFrame(() => {
      addFirstVariantRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [loading, variants.length, showDrawer]);

  useEffect(() => {
    if (!showDeleteConfirm || !variantToDelete || !itemId) {
      if (!showDeleteConfirm) setDeleteVariantStockOnHand(null);
      return;
    }
    let cancelled = false;
    setDeleteVariantStockOnHand(null);
    inventoryService
      .getStockByItem(itemId)
      .then((rows) => {
        if (cancelled) return;
        const total = rows
          .filter((s) => s.variantId === variantToDelete)
          .reduce((sum, s) => sum + s.onHandQuantity, 0);
        setDeleteVariantStockOnHand(total);
      })
      .catch(() => {
        if (!cancelled) setDeleteVariantStockOnHand(-1);
      });
    return () => {
      cancelled = true;
    };
  }, [showDeleteConfirm, variantToDelete, itemId]);

  useEffect(() => {
    if (!showDrawer) return;
    const id = setTimeout(() => {
      if (editingVariantId) {
        variantNameInputRef.current?.focus();
      } else {
        firstFormFieldRef.current?.focus();
      }
    }, 0);
    return () => clearTimeout(id);
  }, [showDrawer, editingVariantId]);

  const loadVariants = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getVariantsByItem(itemId);
      setVariants(data);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load variants');
      setError(message);
      logger.error('[VariantManagement] Failed to load variants', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const result = validateVariantForm(formData);
    if (!result.valid) {
      setFieldErrors(result.fieldErrors);
      setError('Please fix the errors below.');
      return;
    }
    setFieldErrors({});
    setError(null);
    setLoading(true);
    try {
      const payload = {
        ...formData,
        name: formData.name.trim(),
        barcode: formData.barcode?.trim() || undefined,
        hsn: formData.hsn?.trim() || undefined,
        unitOfMeasureOverride: formData.unitOfMeasureOverride?.trim() || undefined,
        isDefault: variants.length === 0 ? true : formData.isDefault,
      };
      const createdVariant: CreateVariantResponse = await inventoryService.createVariant(payload);
      setSuccess(
        createdVariant.migration
          ? 'Variant created. Existing product-level stock has been assigned to this default variant.'
          : 'Variant created successfully'
      );
      setTimeout(() => setSuccess(null), 3000);
      setShowDrawer(false);
      resetForm();
      await loadVariants();
      setNewlyCreatedVariantId(createdVariant.id);
      setTimeout(() => setNewlyCreatedVariantId(null), 2000);
      onVariantCreated?.(createdVariant, createdVariant.migration);
      onVariantChange?.();
      setTimeout(() => addVariantButtonRef.current?.focus(), 50);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to create variant');
      setError(message);
      logger.error('[VariantManagement] Failed to create variant', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingVariantId) {
      setError('No variant selected');
      return;
    }
    const result = validateVariantForm(formData);
    if (!result.valid) {
      setFieldErrors(result.fieldErrors);
      setError('Please fix the errors below.');
      return;
    }
    setFieldErrors({});
    setError(null);
    setLoading(true);
    try {
      const updateData: UpdateVariantRequest = {
        name: formData.name.trim(),
        isDefault: formData.isDefault,
        barcode: formData.barcode?.trim() || undefined,
        hsn: formData.hsn?.trim() || '',
        unitOfMeasureOverride: formData.unitOfMeasureOverride?.trim() || undefined,
        serviceable: formData.serviceable,
      };

      await inventoryService.updateVariant(editingVariantId, updateData);
      setSuccess('Variant updated successfully');
      setTimeout(() => setSuccess(null), 3000);
      setShowDrawer(false);
      resetForm();
      loadVariants();
      onVariantChange?.();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to update variant');
      setError(message);
      logger.error('[VariantManagement] Failed to update variant', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!variantToDelete) return;

    setLoading(true);
    setError(null);
    try {
      await inventoryService.deleteVariant(variantToDelete);
      setSuccess('Variant deleted successfully');
      setTimeout(() => setSuccess(null), 3000);
      setShowDeleteConfirm(false);
      setVariantToDelete(null);
      loadVariants();
      onVariantChange?.();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to delete variant');
      setError(message);
      logger.error('[VariantManagement] Failed to delete variant', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!variantToDisable) return;

    setLoading(true);
    setError(null);
    try {
      // Check if variant is default and there are other variants
      const variant = variants.find((v) => v.id === variantToDisable.id);
      if (variant?.isDefault && variants.length > 1) {
        // Find another variant to set as default
        const otherVariant = variants.find((v) => !v.isDefault);
        if (otherVariant) {
          await inventoryService.updateVariant(otherVariant.id, { isDefault: true });
        }
      }

      await inventoryService.updateVariant(variantToDisable.id, { isActive: !variantToDisable.isActive });
      setSuccess(`Variant ${variantToDisable.isActive ? 'disabled' : 'enabled'} successfully`);
      setTimeout(() => setSuccess(null), 3000);
      setShowDisableConfirm(false);
      setVariantToDisable(null);
      loadVariants();
      onVariantChange?.();
    } catch (err: any) {
      const message = extractErrorMessage(err, `Failed to ${variantToDisable.isActive ? 'disable' : 'enable'} variant`);
      setError(message);
      logger.error('[VariantManagement] Failed to disable/enable variant', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSetDefault = async (variantId: string) => {
    const variant = variants.find((v) => v.id === variantId);
    if (!variant || variant.isDefault) return;

    setLoading(true);
    setError(null);
    try {
      // Unset current default
      const currentDefault = variants.find((v) => v.isDefault);
      if (currentDefault) {
        await inventoryService.updateVariant(currentDefault.id, { isDefault: false });
      }

      // Set new default
      await inventoryService.updateVariant(variantId, { isDefault: true });
      setSuccess('Default variant updated');
      loadVariants();
      onVariantChange?.();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to set default variant');
      setError(message);
      logger.error('[VariantManagement] Failed to set default variant', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (variant: InventoryVariant) => {
    setEditingVariantId(variant.id);
    setFormData({
      itemId,
      name: variant.name,
      isDefault: variant.isDefault,
      barcode: variant.barcode || '',
      hsn: variant.hsn || '',
      unitOfMeasureOverride: variant.unitOfMeasureOverride || '',
      serviceable: variant.serviceable ?? false,
    });
    setShowDrawer(true);
    setError(null);
  };

  const handleAddVariant = () => {
    setFormData({
      itemId,
      name: '',
      isDefault: variants.length === 0,
      barcode: '',
      hsn: '',
      unitOfMeasureOverride: '',
      serviceable: false,
    });
    setEditingVariantId(null);
    setFieldErrors({});
    setShowDrawer(true);
    setError(null);
  };

  const handleCloseDrawer = () => {
    setShowDrawer(false);
    resetForm();
    setError(null);
    setFieldErrors({});
  };

  const resetForm = () => {
    setFormData({
      itemId,
      name: '',
      isDefault: false,
      barcode: '',
      hsn: '',
      unitOfMeasureOverride: '',
      serviceable: false,
    });
    setEditingVariantId(null);
    setFieldErrors({});
  };

  const resolveEffectiveUnit = (variant: InventoryVariant): string => {
    const o = variant.unitOfMeasureOverride?.trim();
    if (o) return o;
    return itemDefaultUnitOfMeasure?.trim() || '—';
  };

  const requestToggleVariantStatus = (variant: InventoryVariant) => {
    if (variant.isDefault && variants.length > 1) {
      setError('Cannot disable the default variant. Set another variant as default first.');
      return;
    }
    setVariantToDisable({ id: variant.id, isActive: variant.isActive });
    setShowDisableConfirm(true);
  };

  // Filter variants based on status (search is handled by DataTable)
  const filteredVariants = useMemo(() => {
    if (statusFilter === 'all') {
      return variants;
    }
    return variants.filter(v => 
      statusFilter === 'active' ? v.isActive : !v.isActive
    );
  }, [variants, statusFilter]);

  // Column definitions
  const columns: ColumnDef<InventoryVariant>[] = [
    {
      id: 'hsn',
      header: 'HSN Code',
      width: 130,
      accessor: (variant) => (
        <span className="variant-hsn-cell">{variant.hsn?.trim() || '—'}</span>
      ),
    },
    {
      id: 'name',
      header: 'Name',
      minWidth: 140,
      accessor: (variant) => {
        const metaKeys = variant.metadata ? Object.keys(variant.metadata) : [];
        const nameCell = <span className="variant-name-cell">{variant.name}</span>;
        if (metaKeys.length === 0) return nameCell;
        return (
          <Tooltip
            content={
              <div className="variant-metadata-tooltip">
                {metaKeys.map((k) => (
                  <div key={k}>
                    {k}: {String(variant.metadata?.[k])}
                  </div>
                ))}
              </div>
            }
          >
            <span className="variant-name-cell variant-name-cell--has-meta">{variant.name}</span>
          </Tooltip>
        );
      },
    },
    {
      id: 'barcode',
      header: 'Barcode',
      width: 130,
      accessor: (variant) => (
        <span className="variant-barcode-cell">{variant.barcode?.trim() || '—'}</span>
      ),
    },
    {
      id: 'hsn',
      header: 'HSN',
      width: 96,
      accessor: (variant) => (
        <span className="variant-hsn-cell">{variant.hsn?.trim() || '—'}</span>
      ),
    },
    {
      id: 'unit',
      header: 'Unit',
      width: 88,
      accessor: (variant) => (
        <span className="variant-unit-cell" title={variant.unitOfMeasureOverride ? 'Variant override' : 'Product default'}>
          {resolveEffectiveUnit(variant)}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 168,
      accessor: (variant) => {
        const disableBlocked = variant.isDefault && variants.length > 1;
        return (
          <div className="variant-status-cell">
            <span className={`variant-status ${variant.isActive ? 'variant-status--active' : 'variant-status--inactive'}`}>
              <span className="variant-status-dot">{variant.isActive ? '●' : '○'}</span>
              <span>{variant.isActive ? 'Active' : 'Disabled'}</span>
            </span>
            <Tooltip
              content={
                disableBlocked && variant.isActive
                  ? 'Set another variant as default before disabling this one.'
                  : variant.isActive
                    ? 'Disable this variant'
                    : 'Enable this variant'
              }
            >
              <button
                type="button"
                className="variant-status-toggle"
                disabled={disableBlocked && variant.isActive}
                onClick={(e) => {
                  e.stopPropagation();
                  requestToggleVariantStatus(variant);
                }}
              >
                {variant.isActive ? 'Disable' : 'Enable'}
              </button>
            </Tooltip>
          </div>
        );
      },
    },
    {
      id: 'serviceable',
      header: 'Serviceable',
      width: 96,
      align: 'center',
      accessor: (variant) => (
        <Tooltip content={variant.serviceable ? 'Can be booked for service/repair' : 'Not serviceable'}>
          <span className={`variant-status ${variant.serviceable ? 'variant-status--active' : 'variant-status--inactive'}`}>
            <span className="variant-status-dot">{variant.serviceable ? '●' : '○'}</span>
            <span>{variant.serviceable ? 'Yes' : 'No'}</span>
          </span>
        </Tooltip>
      ),
    },
    {
      id: 'default',
      header: 'Default',
      width: 60,
      align: 'center',
      accessor: (variant) => (
        <Tooltip content={variant.isDefault ? 'Default variant' : 'Set as default'}>
          <button
            className="variant-default-star"
            onClick={(e) => {
              e.stopPropagation();
              if (!variant.isDefault) {
                handleSetDefault(variant.id);
              }
            }}
            disabled={variant.isDefault}
            aria-label={variant.isDefault ? 'Default variant' : 'Set as default'}
          >
            {variant.isDefault ? '⭐' : '☆'}
          </button>
        </Tooltip>
      ),
    },
    {
      id: 'delete',
      header: '',
      width: 48,
      align: 'center',
      accessor: (variant) => (
        <Tooltip content={variant.isDefault ? 'Cannot delete the default variant' : 'Delete variant'}>
          <button
            type="button"
            className="variant-row-delete"
            disabled={variant.isDefault}
            aria-label={variant.isDefault ? 'Cannot delete default variant' : 'Delete variant'}
            onClick={(e) => {
              e.stopPropagation();
              if (variant.isDefault) return;
              setVariantToDelete(variant.id);
              setShowDeleteConfirm(true);
            }}
          >
            <VariantTrashIcon />
          </button>
        </Tooltip>
      ),
    },
  ];

  // Status filter config
  const statusFilterConfig: FilterConfig = useMemo(() => {
    const activeCount = variants.filter(v => v.isActive).length;
    const inactiveCount = variants.filter(v => !v.isActive).length;

    return {
      id: 'status',
      label: 'Status',
      value: statusFilter,
      onChange: setStatusFilter,
      options: [
        { value: 'all', label: `All (${variants.length})` },
        { value: 'active', label: `Active (${activeCount})` },
        { value: 'inactive', label: `Disabled (${inactiveCount})` },
      ],
    };
  }, [statusFilter, variants]);

  // Scroll to newly created or selected variant
  useEffect(() => {
    const targetId = newlyCreatedVariantId || selectedVariantId;
    if (targetId) {
      setTimeout(() => {
        const rowElement = document.querySelector(`[data-row-id="${targetId}"]`);
        if (rowElement) {
          rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    }
  }, [newlyCreatedVariantId, selectedVariantId]);

  const renderList = () => (
    <section
      className="variant-management-section"
      aria-label={itemName ? `Variants for ${itemName}` : 'Product variants'}
    >
      <div className="variant-management-section-intro">
        <h2 className="variant-management-section-title">Variants</h2>
        {itemName ? (
          <p className="variant-management-section-product" title={itemName}>
            {itemName}
          </p>
        ) : null}
        <p id={emptyStateHintId} className="variant-management-section-lead">
          Each variant is a sellable SKU under this product. Stock and barcodes are tracked per variant.
        </p>
      </div>

      <div className="variant-management-toolbar">
        <div className="variant-toolbar-actions">
          <Button ref={addVariantButtonRef} variant="primary" onClick={handleAddVariant}>
            Add variant
          </Button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="variant-management-table-region">
        <DataTable<InventoryVariant>
          data={filteredVariants}
          columns={columns}
          searchable={true}
          searchPlaceholder="Search by name, barcode, or HSN…"
          searchFields={(variant) => [
            variant.name,
            variant.barcode || '',
            variant.hsn || '',
            variant.unitOfMeasureOverride || '',
            resolveEffectiveUnit(variant),
          ]}
          filters={[statusFilterConfig]}
          onRowClick={(variant) => onVariantSelect?.(variant.id)}
          onRowDoubleClick={handleEdit}
          selectedRowId={newlyCreatedVariantId || selectedVariantId || undefined}
          emptyTitle="No variants yet"
          emptyMessage="Add the first variant to sell and track stock at SKU level. The first variant becomes the default."
          emptyAction={
            <Button
              ref={addFirstVariantRef}
              type="button"
              variant="primary"
              onClick={handleAddVariant}
              aria-describedby={emptyStateHintId}
            >
              Add first variant
            </Button>
          }
          filteredEmptyMessage="No variants match your search or status filter."
          filteredEmptyTitle="No matches"
          loading={loading}
          getRowId={(variant) => variant.id}
          className="variant-management-data-table"
          rowSourceCount={variants.length}
        />
      </div>
    </section>
  );

  const drawerTitle = editingVariantId
    ? `Edit Variant${itemName ? ` – ${itemName}` : ''}`
    : `Add Variant${itemName ? ` – ${itemName}` : ''}`;

  const renderForm = () => (
    <div className="variant-form">
      <div id={drawerMessagesId} aria-live="polite" aria-atomic="true">
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
      </div>
      {!editingVariantId && variants.length === 0 && (
        <div className="variant-form-first-info" role="status">
          Creating the first variant will make it the default and assign any existing product-level stock to it.
        </div>
      )}

      <div className="form-group">
        <label>Variant Name *</label>
        <Input
          ref={variantNameInputRef}
          value={formData.name}
          onChange={(e) => {
            setFormData({ ...formData, name: e.target.value });
            setFieldErrors((prev) => ({ ...prev, name: '' }));
          }}
          placeholder="Red - 32GB"
          error={fieldErrors.name || undefined}
          aria-invalid={!!fieldErrors.name}
        />
      </div>

      <div className="form-group">
        <label>Barcode</label>
        <Input
          value={formData.barcode}
          onChange={(e) => {
            setFormData({ ...formData, barcode: e.target.value });
            setFieldErrors((prev) => ({ ...prev, barcode: '' }));
          }}
          placeholder="Optional barcode"
          error={fieldErrors.barcode || undefined}
          aria-invalid={!!fieldErrors.barcode}
        />
      </div>

      <div className="form-group">
        <label>HSN</label>
        <Input
          inputMode="numeric"
          maxLength={8}
          value={formData.hsn ?? ''}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
            setFormData({ ...formData, hsn: digits });
            setFieldErrors((prev) => ({ ...prev, hsn: '' }));
          }}
          placeholder="4, 6, or 8 digits"
          error={fieldErrors.hsn || undefined}
          aria-invalid={!!fieldErrors.hsn}
          aria-label="HSN code for this variant"
        />
        <p className="variant-form-field-hint">GST India — optional per variant.</p>
      </div>

      <div className="form-group">
        <label>Unit of measure override</label>
        <Input
          value={formData.unitOfMeasureOverride ?? ''}
          onChange={(e) => setFormData({ ...formData, unitOfMeasureOverride: e.target.value })}
          placeholder="e.g. BOX, CTN"
        />
        <p className="variant-form-field-hint">Overrides the product default when set. Leave blank to use product UoM.</p>
      </div>

      <div className="form-group">
        <label>
          <input
            type="checkbox"
            checked={variants.length === 0 && !editingVariantId ? true : formData.isDefault}
            disabled={variants.length === 0 && !editingVariantId}
            onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
          />
          Set as default variant
          {variants.length === 0 && !editingVariantId && (
            <span className="variant-form-default-note">(The first variant is always the default.)</span>
          )}
        </label>
      </div>

      <div className="form-group">
        <label>
          <input
            type="checkbox"
            checked={formData.serviceable ?? false}
            onChange={(e) => setFormData({ ...formData, serviceable: e.target.checked })}
          />
          Serviceable
          <span className="variant-form-default-note">(Can be booked for after-sales service/repair.)</span>
        </label>
      </div>

      <div className="form-actions">
        <Button variant="secondary" onClick={handleCloseDrawer} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={editingVariantId ? handleUpdate : handleCreate}
          disabled={loading}
        >
          {loading ? (
            <>
              <Spinner size="sm" className="variant-form-btn-spinner" />
              {editingVariantId ? 'Updating…' : 'Creating…'}
            </>
          ) : (
            editingVariantId ? 'Update' : 'Create'
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="variant-management variant-management--root">
      {renderList()}

      <SideDrawer
        isOpen={showDrawer}
        onClose={handleCloseDrawer}
        title={drawerTitle}
        width="480px"
        ariaDescribedBy={drawerMessagesId}
      >
        {renderForm()}
      </SideDrawer>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Variant"
        message={
          deleteVariantStockOnHand === null
            ? 'Are you sure you want to delete this variant? This action cannot be undone. Checking stock…'
            : deleteVariantStockOnHand > 0
              ? `This variant has ${deleteVariantStockOnHand} unit${deleteVariantStockOnHand === 1 ? '' : 's'} on hand. Deleting will remove the variant from the product. Move or adjust stock first if you need to preserve it. Are you sure you want to delete?`
              : 'Are you sure you want to delete this variant? This action cannot be undone. Make sure there is no stock associated with this variant.'
        }
        onConfirm={handleDelete}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setVariantToDelete(null);
          setDeleteVariantStockOnHand(null);
        }}
        variant="danger"
      />

      <ConfirmDialog
        isOpen={showDisableConfirm}
        title={variantToDisable?.isActive ? 'Disable Variant' : 'Enable Variant'}
        message={`Are you sure you want to ${variantToDisable?.isActive ? 'disable' : 'enable'} this variant?`}
        onConfirm={handleDisable}
        onCancel={() => {
          setShowDisableConfirm(false);
          setVariantToDisable(null);
        }}
        variant="warning"
      />
    </div>
  );
};
