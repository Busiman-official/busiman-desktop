/**
 * Serial Attribute Template Management Component
 * Manage serial attribute templates for items/variants/branches
 */

import React, { useState, useEffect } from 'react';
import {
  inventoryService,
  SerialAttributeTemplate,
  AttributeField,
  InventoryItem,
  InventoryVariant,
} from '@/services/inventory.service';
import { Button, Input, Card, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState, ErrorState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { ConfirmDialog } from '@/shared/components/modals';
import { movementItemPickerLabel } from '../utils/itemDisplaySku';
import './SerialAttributeTemplateManagement.css';

type ViewMode = 'list' | 'create' | 'edit';
type TemplateScope = 'branch' | 'item' | 'variant';

export const SerialAttributeTemplateManagement: React.FC = () => {
  const [templates, setTemplates] = useState<SerialAttributeTemplate[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [variants, setVariants] = useState<InventoryVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);

  const [scope, setScope] = useState<TemplateScope>('branch');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [fields, setFields] = useState<AttributeField[]>([]);
  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null);

  useEffect(() => {
    loadTemplates();
    loadItems();
  }, []);

  useEffect(() => {
    if (selectedItemId && scope === 'variant') {
      loadVariants();
    } else {
      setVariants([]);
      setSelectedVariantId('');
    }
  }, [selectedItemId, scope]);

  const loadTemplates = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getAllSerialAttributeTemplates();
      setTemplates(data);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load templates');
      setError(message);
      logger.error('[SerialAttributeTemplateManagement] Failed to load templates', err);
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async () => {
    try {
      const data = await inventoryService.getAllItems({});
      setItems(data);
    } catch (err: any) {
      logger.error('[SerialAttributeTemplateManagement] Failed to load items', err);
    }
  };

  const loadVariants = async () => {
    if (!selectedItemId) return;
    try {
      const data = await inventoryService.getVariantsByItem(selectedItemId);
      setVariants(data);
    } catch (err: any) {
      logger.error('[SerialAttributeTemplateManagement] Failed to load variants', err);
    }
  };

  const handleCreate = async () => {
    const errors: string[] = [];
    
    if (fields.length === 0) {
      errors.push('At least one field is required');
    }

    // Validate fields
    const keys = fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      errors.push('Field keys must be unique');
    }
    
    // Validate each field
    fields.forEach((field, index) => {
      if (!field.key || field.key.trim() === '') {
        errors.push(`Field ${index + 1}: Key is required`);
      }
      if (!field.label || field.label.trim() === '') {
        errors.push(`Field ${index + 1}: Label is required`);
      }
      if (field.type === 'select' && (!field.options || field.options.length === 0)) {
        errors.push(`Field "${field.label || `Field ${index + 1}`}": Select fields must have at least one option`);
      }
    });
    
    if (errors.length > 0) {
      setError(errors.join('. '));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const templateData: any = {
        fields,
      };

      if (scope === 'item' && selectedItemId) {
        templateData.itemId = selectedItemId;
      } else if (scope === 'variant' && selectedItemId && selectedVariantId) {
        templateData.itemId = selectedItemId;
        templateData.variantId = selectedVariantId;
      }
      // branch scope doesn't need itemId/variantId

      await inventoryService.saveSerialAttributeTemplate(templateData);
      setSuccess('Template created successfully');
      setViewMode('list');
      resetForm();
      loadTemplates();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to create template');
      setError(message);
      logger.error('[SerialAttributeTemplateManagement] Failed to create template', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedTemplateId || fields.length === 0) {
      setError('At least one field is required');
      return;
    }

    // Validate fields
    const keys = fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      setError('Field keys must be unique');
      return;
    }

    for (const field of fields) {
      if (field.type === 'select' && (!field.options || field.options.length === 0)) {
        setError(`Select field "${field.label}" must have at least one option`);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const templateData: any = {
        fields,
      };

      if (scope === 'item' && selectedItemId) {
        templateData.itemId = selectedItemId;
      } else if (scope === 'variant' && selectedItemId && selectedVariantId) {
        templateData.itemId = selectedItemId;
        templateData.variantId = selectedVariantId;
      }

      await inventoryService.saveSerialAttributeTemplate(templateData);
      setSuccess('Template updated successfully');
      setViewMode('list');
      resetForm();
      loadTemplates();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to update template');
      setError(message);
      logger.error('[SerialAttributeTemplateManagement] Failed to update template', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!templateToDelete) return;

    setLoading(true);
    setError(null);
    try {
      await inventoryService.deleteSerialAttributeTemplate(templateToDelete);
      setSuccess('Template deleted successfully');
      setShowDeleteConfirm(false);
      setTemplateToDelete(null);
      loadTemplates();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to delete template');
      setError(message);
      logger.error('[SerialAttributeTemplateManagement] Failed to delete template', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (template: SerialAttributeTemplate) => {
    setSelectedTemplateId(template.id);
    setFields([...template.fields]);
    
    // Determine scope
    if (template.variantId) {
      setScope('variant');
      setSelectedItemId(template.itemId || '');
      setSelectedVariantId(template.variantId);
    } else if (template.itemId) {
      setScope('item');
      setSelectedItemId(template.itemId);
    } else {
      setScope('branch');
    }
    
    setViewMode('edit');
  };

  const resetForm = () => {
    setScope('branch');
    setSelectedItemId('');
    setSelectedVariantId('');
    setFields([]);
    setEditingFieldIndex(null);
    setSelectedTemplateId(null);
  };

  const addField = () => {
    const newField: AttributeField = {
      key: '',
      label: '',
      type: 'string',
      required: false,
    };
    setFields([...fields, newField]);
    setEditingFieldIndex(fields.length);
  };

  const updateField = (index: number, updates: Partial<AttributeField>) => {
    const updated = [...fields];
    updated[index] = { ...updated[index], ...updates };
    setFields(updated);
  };

  const removeField = (index: number) => {
    const updated = fields.filter((_, i) => i !== index);
    setFields(updated);
    if (editingFieldIndex === index) {
      setEditingFieldIndex(null);
    } else if (editingFieldIndex !== null && editingFieldIndex > index) {
      setEditingFieldIndex(editingFieldIndex - 1);
    }
  };

  const addOptionToField = (index: number, option: string) => {
    const field = fields[index];
    if (field.type === 'select') {
      const options = field.options || [];
      if (!options.includes(option)) {
        updateField(index, { options: [...options, option] });
      }
    }
  };

  const removeOptionFromField = (index: number, optionIndex: number) => {
    const field = fields[index];
    if (field.type === 'select' && field.options) {
      const removedOption = field.options[optionIndex];
      const options = field.options.filter((_, i) => i !== optionIndex);
      const updates: Partial<AttributeField> = { options };
      if (field.defaultValue === removedOption) {
        updates.defaultValue = undefined;
      }
      updateField(index, updates);
    }
  };

  const getScopeLabel = (template: SerialAttributeTemplate): string => {
    if (template.variantId) {
      return 'Variant-specific';
    } else if (template.itemId) {
      return 'Item-specific';
    } else {
      return 'Branch-specific';
    }
  };

  const getTemplateCopyLabel = (template: SerialAttributeTemplate): string => {
    const scope = getScopeLabel(template);
    const target = template.itemId
      ? items.find((i) => i.id === template.itemId)?.name || template.itemId
      : null;
    const fieldCount = `${template.fields.length} field${template.fields.length === 1 ? '' : 's'}`;
    return target ? `${scope} — ${target} (${fieldCount})` : `${scope} (${fieldCount})`;
  };

  const handleCopyFromTemplate = (templateId: string) => {
    const source = templates.find((t) => t.id === templateId);
    if (!source) return;
    if (fields.length > 0) {
      const proceed = window.confirm(
        `Replace the ${fields.length} field${fields.length === 1 ? '' : 's'} already added with the ${source.fields.length} field${source.fields.length === 1 ? '' : 's'} from this template?`
      );
      if (!proceed) return;
    }
    setFields(source.fields.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined })));
    setEditingFieldIndex(null);
  };

  const renderList = () => (
    <div className="template-management-list">
      <div className="template-management-toolbar">
        <h3>Serial Attribute Templates</h3>
        <Button variant="primary" onClick={() => {
          resetForm();
          setViewMode('create');
        }}>
          Create Template
        </Button>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {loading ? (
        <LoadingState message="Loading templates..." />
      ) : templates.length === 0 ? (
        <EmptyState message="No templates found. Create your first template." />
      ) : (
        <div className="template-table">
          <table>
            <thead>
              <tr>
                <th>Scope</th>
                <th>Item</th>
                <th>Variant</th>
                <th>Fields</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td>{getScopeLabel(template)}</td>
                  <td>{template.itemId ? items.find((i) => i.id === template.itemId)?.name || template.itemId : '-'}</td>
                  <td>{template.variantId ? variants.find((v) => v.id === template.variantId)?.name || template.variantId : '-'}</td>
                  <td>
                    <div className="fields-preview">
                      {template.fields.map((field, idx) => (
                        <span key={idx} className="field-badge">
                          {field.label} ({field.type})
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={template.isActive ? 'status-active' : 'status-inactive'}>
                      {template.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="action-buttons">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(template)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setTemplateToDelete(template.id);
                          setShowDeleteConfirm(true);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderForm = () => (
    <Card className="template-form">
      <h3>{viewMode === 'create' ? 'Create Template' : 'Edit Template'}</h3>
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="form-group">
        <label>Template Scope *</label>
        <Select
          value={scope}
          onChange={(e) => {
            const newScope = e.target.value as TemplateScope;
            setScope(newScope);
            if (newScope === 'branch') {
              setSelectedItemId('');
              setSelectedVariantId('');
            } else if (newScope === 'item') {
              setSelectedVariantId('');
            }
          }}
        >
          <option value="branch">Branch-specific (applies to all items)</option>
          <option value="item">Item-specific (applies to one item)</option>
          <option value="variant">Variant-specific (applies to one variant)</option>
        </Select>
      </div>

      {scope === 'item' && (
        <div className="form-group">
          <label>Item *</label>
          <Select
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
          >
            <option value="">Select Item</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {movementItemPickerLabel(item)}
              </option>
            ))}
          </Select>
        </div>
      )}

      {scope === 'variant' && (
        <>
          <div className="form-group">
            <label>Item *</label>
            <Select
              value={selectedItemId}
              onChange={(e) => {
                setSelectedItemId(e.target.value);
                setSelectedVariantId('');
              }}
            >
              <option value="">Select Item</option>
              {items.filter((item) => item.hasVariants).map((item) => (
                <option key={item.id} value={item.id}>
                  {movementItemPickerLabel(item)}
                </option>
              ))}
            </Select>
          </div>
          {selectedItemId && (
            <div className="form-group">
              <label>Variant *</label>
              <Select
                value={selectedVariantId}
                onChange={(e) => setSelectedVariantId(e.target.value)}
              >
                <option value="">Select Variant</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.code} - {variant.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </>
      )}

      <div className="form-group">
        <div className="fields-header">
          <label>Fields *</label>
          <div className="fields-header-actions">
            {templates.length > 0 && (
              <Select
                value=""
                onChange={(e) => {
                  if (e.target.value) handleCopyFromTemplate(e.target.value);
                }}
              >
                <option value="">Copy fields from another template...</option>
                {templates
                  .filter((t) => t.id !== selectedTemplateId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {getTemplateCopyLabel(t)}
                    </option>
                  ))}
              </Select>
            )}
            <Button variant="secondary" size="sm" onClick={addField}>
              Add Field
            </Button>
          </div>
        </div>
        {fields.length === 0 && (
          <div className="empty-fields">No fields added. Click "Add Field" to add one.</div>
        )}
        {fields.map((field, index) => (
          <div key={index} className="field-editor">
            <div className="field-row">
              <div className="field-input">
                <label>Key</label>
                <Input
                  value={field.key}
                  onChange={(e) => updateField(index, { key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                  placeholder="customer_name"
                />
              </div>
              <div className="field-input">
                <label>Label</label>
                <Input
                  value={field.label}
                  onChange={(e) => updateField(index, { label: e.target.value })}
                  placeholder="Customer Name"
                />
              </div>
              <div className="field-input">
                <label>Type</label>
                <Select
                  value={field.type}
                  onChange={(e) => {
                    const type = e.target.value as AttributeField['type'];
                    const updates: Partial<AttributeField> = { type, defaultValue: undefined, defaultToday: undefined };
                    if (type !== 'select') {
                      updates.options = undefined;
                    } else if (!field.options) {
                      updates.options = [];
                    }
                    updateField(index, updates);
                  }}
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="select">Select</option>
                </Select>
              </div>
              <div className="field-input">
                <label>
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateField(index, { required: e.target.checked })}
                  />
                  Required
                </label>
              </div>
              {field.type !== 'select' && field.type !== 'date' && (
                <div className="field-input">
                  <label>Default value</label>
                  <Input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={field.defaultValue || ''}
                    onChange={(e) => updateField(index, { defaultValue: e.target.value || undefined })}
                    placeholder="Pre-filled on the first row"
                  />
                </div>
              )}
              {field.type === 'date' && (
                <div className="field-input">
                  <label>Default value</label>
                  <Input
                    type="date"
                    value={field.defaultValue || ''}
                    disabled={field.defaultToday}
                    onChange={(e) => updateField(index, { defaultValue: e.target.value || undefined })}
                    placeholder="Pre-filled on the first row"
                  />
                  <label className="field-checkbox-inline">
                    <input
                      type="checkbox"
                      checked={!!field.defaultToday}
                      onChange={(e) =>
                        updateField(index, {
                          defaultToday: e.target.checked,
                          defaultValue: e.target.checked ? undefined : field.defaultValue,
                        })
                      }
                    />
                    Always use today&apos;s date
                  </label>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeField(index)}
              >
                Remove
              </Button>
            </div>
            {field.type === 'select' && (
              <div className="select-options">
                <label>Options</label>
                <div className="options-list">
                  {field.options?.map((option, optIdx) => (
                    <div key={optIdx} className="option-item">
                      <span>{option}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeOptionFromField(index, optIdx)}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <div className="add-option">
                    <Input
                      placeholder="Add option..."
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          const input = e.target as HTMLInputElement;
                          if (input.value.trim()) {
                            addOptionToField(index, input.value.trim());
                            input.value = '';
                          }
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="field-input" style={{ marginTop: 8 }}>
                  <label>Default value</label>
                  <Select
                    value={field.defaultValue || ''}
                    onChange={(e) => updateField(index, { defaultValue: e.target.value || undefined })}
                    disabled={!field.options || field.options.length === 0}
                  >
                    <option value="">None</option>
                    {(field.options || []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                  {(!field.options || field.options.length === 0) && (
                    <small className="form-help">Add options above to pick a default.</small>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="form-actions">
        <Button variant="secondary" onClick={() => {
          setViewMode('list');
          resetForm();
        }}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={viewMode === 'create' ? handleCreate : handleUpdate}
          disabled={loading || fields.length === 0}
        >
          {viewMode === 'create' ? 'Create' : 'Update'}
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="template-management">
      {viewMode === 'list' && renderList()}
      {viewMode === 'create' && renderForm()}
      {viewMode === 'edit' && renderForm()}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Template"
        message="Are you sure you want to delete this template? This action cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setTemplateToDelete(null);
        }}
        variant="danger"
      />
    </div>
  );
};
