/**
 * Product Creation Wizard - Compact desktop-first 6-step wizard for Busiman inventory
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Card, Input, ImageUpload, CollapsibleSection, Tooltip, Select, Checkbox, Badge, Switch } from '@/shared/components/ui';
import {
  inventoryService,
  IndustryType,
  IndustryFlags,
  UnitConversion,
  CreateInventoryItemRequest,
  CreateVariantRequest,
} from '@/services/inventory.service';
import './ProductCreationWizard.css';

const WIZARD_STEPS = [
  { id: 1, label: 'Basic Info', key: 'basic' },
  { id: 2, label: 'Pricing & Tax', key: 'pricing' },
  { id: 3, label: 'Units & Dimensions', key: 'unitsDimensions' },
  { id: 4, label: 'Industry Logic', key: 'industry' },
  { id: 5, label: 'Variants', key: 'variants' },
  { id: 6, label: 'Tags', key: 'tags' },
] as const;

const INDUSTRY_OPTIONS: { value: IndustryType; label: string }[] = [
  { value: IndustryType.DAIRY, label: 'Dairy' },
  { value: IndustryType.SWEETS, label: 'Sweets' },
  { value: IndustryType.ELECTRONICS, label: 'Electronics' },
  { value: IndustryType.FMCG, label: 'FMCG' },
  { value: IndustryType.PHARMA, label: 'Pharma' },
  { value: IndustryType.MANUFACTURING, label: 'Manufacturing' },
  { value: IndustryType.WAREHOUSE, label: 'Warehouse' },
];

const UNIT_OPTIONS = [
  { value: 'pcs', label: 'pcs (Pieces)' },
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'l', label: 'l' },
  { value: 'ml', label: 'ml' },
  { value: 'm', label: 'm' },
  { value: 'cm', label: 'cm' },
  { value: 'box', label: 'box' },
  { value: 'pack', label: 'pack' },
  { value: 'carton', label: 'carton' },
];

export interface WizardFormState {
  sku: string;
  barcode: string;
  name: string;
  description: string;
  category: string;
  images: Array<{ url: string; publicId: string; isPrimary: boolean }>;
  costPrice: string;
  sellingPrice: string;
  mrp: string;
  gstPercent: string;
  minSellingPrice: string;
  unitOfMeasure: string;
  secondaryUnit: string;
  conversionFrom: string;
  conversionTo: string;
  conversionFactor: string;
  dimensionLength: string;
  dimensionWidth: string;
  dimensionHeight: string;
  dimensionUnit: string;
  weightValue: string;
  weightUnit: string;
  industryType: IndustryType;
  isPerishable: boolean;
  requiresBatchTracking: boolean;
  requiresSerialTracking: boolean;
  hasExpiryDate: boolean;
  isHighValue: boolean;
  shelfLifeDays: string;
  batchFormatExample: string;
  serialFormatPattern: string;
  variantsEnabled: boolean;
  variantType: string;
  variantRows: Array<{ value: string; name: string }>;
  tags: string[];
  tagInputValue: string;
}

const defaultIndustryFlags: IndustryFlags = {
  isPerishable: false,
  requiresBatchTracking: false,
  requiresSerialTracking: false,
  hasExpiryDate: false,
  isHighValue: false,
  industryType: IndustryType.FMCG,
};

export const getInitialFormState = (): WizardFormState => ({
  sku: '',
  barcode: '',
  name: '',
  description: '',
  category: '',
  images: [],
  costPrice: '',
  sellingPrice: '',
  mrp: '',
  gstPercent: '',
  minSellingPrice: '',
  unitOfMeasure: 'pcs',
  secondaryUnit: '',
  conversionFrom: '',
  conversionTo: '',
  conversionFactor: '',
  dimensionLength: '',
  dimensionWidth: '',
  dimensionHeight: '',
  dimensionUnit: 'cm',
  weightValue: '',
  weightUnit: 'kg',
  industryType: IndustryType.FMCG,
  isPerishable: false,
  requiresBatchTracking: false,
  requiresSerialTracking: false,
  hasExpiryDate: false,
  isHighValue: false,
  shelfLifeDays: '',
  batchFormatExample: '',
  serialFormatPattern: '',
  variantsEnabled: false,
  variantType: 'Size',
  variantRows: [],
  tags: [],
  tagInputValue: '',
});

export interface ProductCreationWizardProps {
  onSuccess: (createdItemId?: string, saveAndNew?: boolean) => void;
  onCancel: () => void;
}

const DRAFT_KEY = 'busiman-product-draft';
const DRAFT_SAVE_INTERVAL_MS = 10000;
const TOAST_DURATION_MS = 2000;

export const ProductCreationWizard: React.FC<ProductCreationWizardProps> = ({
  onSuccess,
  onCancel,
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<WizardFormState>(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WizardFormState>;
        return { ...getInitialFormState(), ...parsed };
      }
    } catch {
      /* ignore */
    }
    return getInitialFormState();
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [imageSectionCollapsed, setImageSectionCollapsed] = useState(true);
  const [skuChecking, setSkuChecking] = useState(false);
  const stepContentRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skuCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const progressPercent = Math.round((currentStep / 6) * 100);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (skuCheckTimeoutRef.current) clearTimeout(skuCheckTimeoutRef.current);
    };
  }, []);

  const checkSkuAvailability = useCallback((sku: string) => {
    const trimmed = sku.trim().toUpperCase();
    if (!trimmed) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.skuDuplicate;
        return next;
      });
      return;
    }
    if (skuCheckTimeoutRef.current) clearTimeout(skuCheckTimeoutRef.current);
    skuCheckTimeoutRef.current = setTimeout(async () => {
      setSkuChecking(true);
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.skuDuplicate;
        return next;
      });
      try {
        const { available } = await inventoryService.checkSkuAvailable(trimmed);
        if (!available) {
          setFieldErrors((prev) => ({ ...prev, skuDuplicate: 'SKU already exists' }));
        }
      } catch {
        /* ignore */
      } finally {
        setSkuChecking(false);
      }
      skuCheckTimeoutRef.current = null;
    }, 400);
  }, []);

  const setField = useCallback(<K extends keyof WizardFormState>(
    key: K,
    value: WizardFormState[K]
  ) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, [fieldErrors]);

  const buildCreatePayload = useCallback((): CreateInventoryItemRequest => {
    const unitConversions: UnitConversion[] = [];
    if (
      formData.secondaryUnit &&
      formData.conversionFactor &&
      parseFloat(formData.conversionFactor) > 0
    ) {
      unitConversions.push({
        fromUnit: formData.secondaryUnit,
        toUnit: formData.unitOfMeasure,
        conversionFactor: parseFloat(formData.conversionFactor) || 1,
      });
    }
    const costPrice = formData.costPrice ? parseFloat(formData.costPrice) : undefined;
    const sellingPrice = formData.sellingPrice ? parseFloat(formData.sellingPrice) : undefined;
    let margin: number | undefined;
    if (costPrice != null && sellingPrice != null && costPrice > 0) {
      margin = ((sellingPrice - costPrice) / costPrice) * 100;
    }
    return {
      sku: formData.sku.trim().toUpperCase(),
      name: formData.name.trim(),
      description: formData.description.trim() || undefined,
      category: formData.category.trim() || undefined,
      barcode: formData.barcode.trim() || undefined,
      unitOfMeasure: formData.unitOfMeasure,
      unitConversions: unitConversions.length ? unitConversions : undefined,
      industryFlags: {
        ...defaultIndustryFlags,
        industryType: formData.industryType,
        isPerishable: formData.isPerishable,
        requiresBatchTracking: formData.requiresBatchTracking,
        requiresSerialTracking: formData.requiresSerialTracking,
        hasExpiryDate: formData.hasExpiryDate,
        isHighValue: formData.isHighValue,
      },
      costPrice,
      sellingPrice,
      margin,
      images: formData.images.length ? formData.images.map((img, i) => ({
        url: img.url,
        publicId: img.publicId,
        isPrimary: i === 0,
      })) : undefined,
      dimensions:
        formData.dimensionLength || formData.dimensionWidth || formData.dimensionHeight
          ? {
              length: parseFloat(formData.dimensionLength) || 0,
              width: parseFloat(formData.dimensionWidth) || 0,
              height: parseFloat(formData.dimensionHeight) || 0,
              unit: formData.dimensionUnit || 'cm',
            }
          : undefined,
      weight:
        formData.weightValue && parseFloat(formData.weightValue) > 0
          ? {
              value: parseFloat(formData.weightValue),
              unit: formData.weightUnit || 'kg',
            }
          : undefined,
      tags: formData.tags.length ? formData.tags : undefined,
    };
  }, [formData]);

  const validateStep = useCallback((step: number): boolean => {
    if (step === 1) {
      const err: Record<string, string> = {};
      if (!formData.sku.trim()) err.sku = 'SKU is required';
      if (!formData.name.trim()) err.name = 'Item name is required';
      setFieldErrors((prev) => ({ ...prev, ...err }));
      return !err.sku && !err.name && !fieldErrors.skuDuplicate;
    }
    return true;
  }, [formData.sku, formData.name, fieldErrors.skuDuplicate]);

  const handleSave = useCallback(
    async (saveAndNew: boolean) => {
      if (!validateStep(currentStep)) return;
      setLoading(true);
      setError(null);
      try {
        const payload = buildCreatePayload();
        const hasVariants = formData.variantsEnabled && formData.variantRows.length > 0;
        const item = await inventoryService.createItem(payload);
        const itemId = item.id;
        const baseSku = formData.sku.trim().toUpperCase();
        if (hasVariants && itemId && formData.variantRows.length > 0) {
          for (const row of formData.variantRows) {
            const code = row.value.trim() ? `${baseSku}-${row.value.trim().toUpperCase()}` : '';
            if (code && row.name.trim()) {
              await inventoryService.createVariant({
                itemId,
                code,
                name: row.name.trim(),
                isDefault: false,
              } as CreateVariantRequest);
            }
          }
        }
        localStorage.removeItem(DRAFT_KEY);
        onSuccess(itemId, saveAndNew);
        if (saveAndNew) {
          setFormData(getInitialFormState());
          setCurrentStep(1);
          setFieldErrors({});
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to create item';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [currentStep, formData, buildCreatePayload, validateStep, onSuccess]
  );

  const handleCancel = useCallback(() => {
    if (formData.sku || formData.name || formData.images.length > 0) {
      if (window.confirm('Discard draft and close?')) {
        localStorage.removeItem(DRAFT_KEY);
        onCancel();
      }
    } else {
      onCancel();
    }
  }, [formData, onCancel]);

  useEffect(() => {
    const t = setInterval(() => {
      try {
        const payload = JSON.stringify(formData);
        localStorage.setItem(DRAFT_KEY, payload);
        showToast('Draft Saved');
      } catch {
        /* ignore */
      }
    }, DRAFT_SAVE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [formData, showToast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault();
          handleSave(false);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSave(true);
          return;
        }
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 6) {
          e.preventDefault();
          setCurrentStep(num);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, handleCancel]);

  const marginPercent =
    formData.costPrice && formData.sellingPrice && parseFloat(formData.costPrice) > 0
      ? ((parseFloat(formData.sellingPrice) - parseFloat(formData.costPrice)) /
          parseFloat(formData.costPrice)) *
        100
      : null;

  return (
    <div className="product-creation-wizard" role="application" aria-label="Product Creation Wizard">
      {/* Sticky header */}
      <header className="wizard-header">
        <h2>Create Product – Busiman</h2>
        <div className="wizard-progress-text" aria-live="polite">
          Step {currentStep} of 6 – {progressPercent}% Complete
        </div>
        <div className="wizard-progress-bar" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
          <div className="wizard-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="wizard-steps-tabs" role="tablist" aria-label="Wizard steps">
          {WIZARD_STEPS.map((step) => (
            <button
              key={step.id}
              type="button"
              role="tab"
              aria-selected={currentStep === step.id}
              aria-controls={`step-panel-${step.id}`}
              id={`step-tab-${step.id}`}
              className="wizard-step-tab"
              onClick={() => setCurrentStep(step.id)}
            >
              {step.label}
            </button>
          ))}
        </div>
      </header>

      <div className="wizard-main">
        <div className="wizard-content" ref={stepContentRef}>
          {error && (
            <div className="wizard-field-error" role="alert" style={{ marginBottom: 8 }}>
              {error}
            </div>
          )}
          <div
            id="step-panel-1"
            role="tabpanel"
            aria-labelledby="step-tab-1"
            hidden={currentStep !== 1}
          >
            <div className="wizard-step-content">
              <div className="wizard-form-group">
                <label htmlFor="wizard-sku" className="required">SKU</label>
                <Input
                  id="wizard-sku"
                  value={formData.sku}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase();
                    setField('sku', v);
                    checkSkuAvailability(v);
                  }}
                  onBlur={() => checkSkuAvailability(formData.sku)}
                  placeholder="ITEM-001"
                  className={fieldErrors.sku || fieldErrors.skuDuplicate ? 'input--error' : ''}
                  aria-invalid={!!(fieldErrors.sku || fieldErrors.skuDuplicate)}
                  aria-describedby={fieldErrors.sku ? 'wizard-sku-err' : fieldErrors.skuDuplicate ? 'wizard-sku-dup' : undefined}
                  disabled={loading}
                />
                {fieldErrors.sku && <div id="wizard-sku-err" className="wizard-field-error" role="alert">{fieldErrors.sku}</div>}
                {fieldErrors.skuDuplicate && !fieldErrors.sku && (
                  <div id="wizard-sku-dup" className="wizard-field-error" role="alert">{fieldErrors.skuDuplicate}</div>
                )}
                {skuChecking && <span className="wizard-summary-label" style={{ fontSize: 11 }}>Checking…</span>}
              </div>
              <div className="wizard-form-group">
                <label htmlFor="wizard-barcode">Barcode</label>
                <Input
                  id="wizard-barcode"
                  value={formData.barcode}
                  onChange={(e) => setField('barcode', e.target.value)}
                  placeholder="1234567890123"
                  aria-invalid={!!fieldErrors.barcode}
                />
              </div>
              <div className="wizard-form-group" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="wizard-name" className="required">Item Name</label>
                <Input
                  id="wizard-name"
                  value={formData.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="Item name"
                  className={fieldErrors.name ? 'input--error' : ''}
                  aria-invalid={!!fieldErrors.name}
                  aria-describedby={fieldErrors.name ? 'wizard-name-err' : undefined}
                />
                {fieldErrors.name && <div id="wizard-name-err" className="wizard-field-error" role="alert">{fieldErrors.name}</div>}
              </div>
              <div className="wizard-form-group" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="wizard-description">Description</label>
                <textarea
                  id="wizard-description"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="Optional description"
                  maxLength={2000}
                  className="input"
                  style={{ resize: 'vertical', minHeight: 60 }}
                  aria-describedby="wizard-desc-count"
                />
                <span id="wizard-desc-count" className="wizard-summary-label" style={{ fontSize: 11 }}>
                  {formData.description.length} / 2000
                </span>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
              <CollapsibleSection
                title="Image upload"
                isExpanded={!imageSectionCollapsed}
                onToggle={() => setImageSectionCollapsed(!imageSectionCollapsed)}
              >
                <ImageUpload
                  images={formData.images}
                  onChange={(images) => setField('images', images)}
                  maxImages={10}
                  folder="inventory"
                  disabled={loading}
                />
              </CollapsibleSection>
              </div>
            </div>
          </div>
          <div
            id="step-panel-2"
            role="tabpanel"
            aria-labelledby="step-tab-2"
            hidden={currentStep !== 2}
          >
            <div className="wizard-step-content">
              <div className="wizard-form-group">
                <Tooltip content="Cost at which the item is purchased" position="top">
                  <label htmlFor="wizard-cost">Purchase Price</label>
                </Tooltip>
                <Input
                  id="wizard-cost"
                  type="number"
                  min={0}
                  step={0.01}
                  value={formData.costPrice}
                  onChange={(e) => setField('costPrice', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      const n = parseFloat(formData.costPrice) || 0;
                      setField('costPrice', String(n + (e.altKey ? 10 : 1)));
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const n = parseFloat(formData.costPrice) || 0;
                      setField('costPrice', String(Math.max(0, n - (e.altKey ? 10 : 1))));
                    }
                  }}
                  placeholder="0.00"
                  aria-label="Purchase price"
                />
              </div>
              <div className="wizard-form-group">
                <Tooltip content="Price at which the item is sold" position="top">
                  <label htmlFor="wizard-selling">Selling Price</label>
                </Tooltip>
                <Input
                  id="wizard-selling"
                  type="number"
                  min={0}
                  step={0.01}
                  value={formData.sellingPrice}
                  onChange={(e) => setField('sellingPrice', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      const n = parseFloat(formData.sellingPrice) || 0;
                      setField('sellingPrice', String(n + (e.altKey ? 10 : 1)));
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const n = parseFloat(formData.sellingPrice) || 0;
                      setField('sellingPrice', String(Math.max(0, n - (e.altKey ? 10 : 1))));
                    }
                  }}
                  placeholder="0.00"
                  aria-label="Selling price"
                />
              </div>
              <div className="wizard-form-group">
                <Tooltip content="Maximum retail price" position="top">
                  <label htmlFor="wizard-mrp">MRP</label>
                </Tooltip>
                <Input
                  id="wizard-mrp"
                  type="number"
                  min={0}
                  step={0.01}
                  value={formData.mrp}
                  onChange={(e) => setField('mrp', e.target.value)}
                  placeholder="0.00"
                  aria-label="MRP"
                />
              </div>
              <div className="wizard-form-group">
                <Tooltip content="Goods and Services Tax percentage" position="top">
                  <label htmlFor="wizard-gst">GST %</label>
                </Tooltip>
                <Input
                  id="wizard-gst"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={formData.gstPercent}
                  onChange={(e) => setField('gstPercent', e.target.value)}
                  placeholder="0"
                  aria-label="GST percentage"
                />
              </div>
              <div className="wizard-form-group">
                <Tooltip content="Auto-calculated from purchase and selling price" position="top">
                  <label htmlFor="wizard-margin">Margin %</label>
                </Tooltip>
                <div id="wizard-margin" style={{ padding: '6px 0', fontSize: 13 }}>
                  {marginPercent != null ? (
                    <span
                      className={
                        marginPercent > 20
                          ? 'margin-good'
                          : marginPercent >= 10
                            ? 'margin-warn'
                            : 'margin-low'
                      }
                      aria-live="polite"
                    >
                      {marginPercent.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="wizard-summary-label">—</span>
                  )}
                </div>
              </div>
              <div className="wizard-form-group">
                <Tooltip content="Minimum allowed selling price (optional)" position="top">
                  <label htmlFor="wizard-minprice">Minimum Selling Price</label>
                </Tooltip>
                <Input
                  id="wizard-minprice"
                  type="number"
                  min={0}
                  step={0.01}
                  value={formData.minSellingPrice}
                  onChange={(e) => setField('minSellingPrice', e.target.value)}
                  placeholder="Optional"
                  aria-label="Minimum selling price"
                />
              </div>
            </div>
          </div>
          <div
            id="step-panel-3"
            role="tabpanel"
            aria-labelledby="step-tab-3"
            hidden={currentStep !== 3}
          >
            <div className="wizard-step-content">
              <div className="wizard-form-group">
                <label htmlFor="wizard-unit" className="required">Primary Unit</label>
                <Select
                  id="wizard-unit"
                  value={formData.unitOfMeasure}
                  onChange={(e) => {
                    setField('unitOfMeasure', e.target.value);
                    if (!formData.conversionFrom) setField('conversionFrom', e.target.value);
                  }}
                  aria-label="Primary unit of measure"
                >
                  {UNIT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </div>
              <div className="wizard-form-group">
                <label htmlFor="wizard-secondary-unit">Secondary Unit</label>
                <Select
                  id="wizard-secondary-unit"
                  value={formData.secondaryUnit}
                  onChange={(e) => {
                    setField('secondaryUnit', e.target.value);
                    if (!formData.conversionTo) setField('conversionTo', e.target.value);
                  }}
                  aria-label="Secondary unit (optional)"
                >
                  <option value="">None</option>
                  {UNIT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </div>
              {formData.secondaryUnit && (
                <div className="wizard-form-group wizard-conditional-section">
                  <label htmlFor="wizard-conversion">Conversion (e.g. 1 secondary = X primary)</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12 }}>1</span>
                    <Input
                      id="wizard-conversion"
                      type="number"
                      min={0.001}
                      step={0.1}
                      value={formData.conversionFactor}
                      onChange={(e) => setField('conversionFactor', e.target.value)}
                      placeholder="1"
                      style={{ width: 80 }}
                      aria-label="Conversion factor"
                    />
                    <span style={{ fontSize: 12 }}>{formData.unitOfMeasure} = 1 {formData.secondaryUnit}</span>
                  </div>
                  {formData.conversionFactor && parseFloat(formData.conversionFactor) > 0 && (
                    <p style={{ margin: '4px 0 0', fontSize: 11, color: '#666' }}>
                      1 {formData.secondaryUnit} = {formData.conversionFactor} {formData.unitOfMeasure}
                    </p>
                  )}
                </div>
              )}
              <div className="wizard-form-group" style={{ gridColumn: '1 / -1' }}>
                <span className="wizard-summary-label" style={{ display: 'block', marginBottom: 4 }}>Dimensions</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8 }}>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={formData.dimensionLength}
                    onChange={(e) => setField('dimensionLength', e.target.value)}
                    placeholder="Length"
                    aria-label="Length"
                  />
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={formData.dimensionWidth}
                    onChange={(e) => setField('dimensionWidth', e.target.value)}
                    placeholder="Width"
                    aria-label="Width"
                  />
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={formData.dimensionHeight}
                    onChange={(e) => setField('dimensionHeight', e.target.value)}
                    placeholder="Height"
                    aria-label="Height"
                  />
                  <Select
                    value={formData.dimensionUnit}
                    onChange={(e) => setField('dimensionUnit', e.target.value)}
                    aria-label="Dimension unit"
                    style={{ minWidth: 70 }}
                  >
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                    <option value="inches">in</option>
                    <option value="ft">ft</option>
                  </Select>
                </div>
                {(() => {
                  const l = parseFloat(formData.dimensionLength) || 0;
                  const w = parseFloat(formData.dimensionWidth) || 0;
                  const h = parseFloat(formData.dimensionHeight) || 0;
                  const vol = l * w * h;
                  return vol > 0 ? (
                    <p style={{ margin: '6px 0 0', fontSize: 11, color: '#666' }}>
                      Estimated volume: {vol.toFixed(2)} cubic {formData.dimensionUnit}
                    </p>
                  ) : null;
                })()}
              </div>
              <div className="wizard-form-group">
                <label htmlFor="wizard-weight">Weight</label>
                <Input
                  id="wizard-weight"
                  type="number"
                  min={0}
                  step={0.01}
                  value={formData.weightValue}
                  onChange={(e) => setField('weightValue', e.target.value)}
                  placeholder="0"
                  aria-label="Weight"
                />
              </div>
              <div className="wizard-form-group">
                <label htmlFor="wizard-weight-unit">Weight Unit</label>
                <Select
                  id="wizard-weight-unit"
                  value={formData.weightUnit}
                  onChange={(e) => setField('weightUnit', e.target.value)}
                  aria-label="Weight unit"
                >
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                  <option value="lbs">lbs</option>
                  <option value="oz">oz</option>
                </Select>
              </div>
            </div>
          </div>
          <div
            id="step-panel-4"
            role="tabpanel"
            aria-labelledby="step-tab-4"
            hidden={currentStep !== 4}
          >
            <div className="wizard-step-content">
              <div className="wizard-form-group" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="wizard-industry" className="required">Industry Type</label>
                <Select
                  id="wizard-industry"
                  value={formData.industryType}
                  onChange={(e) => setField('industryType', e.target.value as IndustryType)}
                  aria-label="Industry type"
                >
                  {INDUSTRY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </div>
              <div className="wizard-form-group" style={{ gridColumn: '1 / -1' }}>
                <span className="wizard-summary-label" style={{ display: 'block', marginBottom: 6 }}>Flags</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                    <Checkbox
                      checked={formData.isPerishable}
                      onChange={(e) => setField('isPerishable', e.target.checked)}
                      aria-label="Perishable"
                    />
                    Perishable
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                    <Checkbox
                      checked={formData.requiresBatchTracking}
                      onChange={(e) => setField('requiresBatchTracking', e.target.checked)}
                      aria-label="Requires batch tracking"
                    />
                    Requires Batch Tracking
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                    <Checkbox
                      checked={formData.requiresSerialTracking}
                      onChange={(e) => setField('requiresSerialTracking', e.target.checked)}
                      aria-label="Requires serial tracking"
                    />
                    Requires Serial Tracking
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                    <Checkbox
                      checked={formData.hasExpiryDate}
                      onChange={(e) => setField('hasExpiryDate', e.target.checked)}
                      aria-label="Has expiry date"
                    />
                    Has Expiry Date
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                    <Checkbox
                      checked={formData.isHighValue}
                      onChange={(e) => setField('isHighValue', e.target.checked)}
                      aria-label="High value item"
                    />
                    High Value Item
                  </label>
                </div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {formData.isPerishable && <Badge variant="neutral">Perishable</Badge>}
                  {formData.requiresBatchTracking && <Badge variant="neutral">Batch</Badge>}
                  {formData.requiresSerialTracking && <Badge variant="neutral">Serial</Badge>}
                  {formData.hasExpiryDate && <Badge variant="neutral">Expiry</Badge>}
                  {formData.isHighValue && <Badge variant="neutral">High Value</Badge>}
                </div>
              </div>
              {formData.isPerishable && (
                <div className="wizard-form-group wizard-conditional-section" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="wizard-shelflife">Shelf Life (days)</label>
                  <Input
                    id="wizard-shelflife"
                    type="number"
                    min={1}
                    value={formData.shelfLifeDays}
                    onChange={(e) => setField('shelfLifeDays', e.target.value)}
                    placeholder="e.g. 7"
                    aria-label="Shelf life in days"
                  />
                </div>
              )}
              {formData.requiresBatchTracking && (
                <div className="wizard-form-group wizard-conditional-section" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="wizard-batch-format">Batch format example</label>
                  <Input
                    id="wizard-batch-format"
                    value={formData.batchFormatExample}
                    onChange={(e) => setField('batchFormatExample', e.target.value)}
                    placeholder="e.g. BATCH-YYYYMMDD-001"
                    aria-label="Batch format example"
                  />
                </div>
              )}
              {formData.requiresSerialTracking && (
                <div className="wizard-form-group wizard-conditional-section" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="wizard-serial-format">Serial format pattern</label>
                  <Input
                    id="wizard-serial-format"
                    value={formData.serialFormatPattern}
                    onChange={(e) => setField('serialFormatPattern', e.target.value)}
                    placeholder="e.g. SN-XXXXX"
                    aria-label="Serial format pattern"
                  />
                </div>
              )}
              {formData.hasExpiryDate && (
                <div className="wizard-form-group wizard-conditional-section" style={{ gridColumn: '1 / -1' }}>
                  <span className="wizard-summary-label" style={{ display: 'block' }}>Expiry logic</span>
                  <p style={{ margin: 0, fontSize: 11, color: '#666' }}>Expiry date will be tracked per batch/serial when applicable.</p>
                </div>
              )}
            </div>
          </div>
          <div
            id="step-panel-5"
            role="tabpanel"
            aria-labelledby="step-tab-5"
            hidden={currentStep !== 5}
          >
            <div className="wizard-step-content full-width">
              <div className="wizard-form-group" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Switch
                  id="wizard-variants-toggle"
                  checked={formData.variantsEnabled}
                  onChange={(e) => setField('variantsEnabled', e.target.checked)}
                  aria-label="Enable variants"
                />
                <label htmlFor="wizard-variants-toggle" style={{ fontSize: 12, cursor: 'pointer' }}>Enable Variants</label>
              </div>
              {formData.variantsEnabled && (
                <>
                  <div className="wizard-form-group">
                    <label htmlFor="wizard-variant-type">Variant Type</label>
                    <Select
                      id="wizard-variant-type"
                      value={formData.variantType}
                      onChange={(e) => setField('variantType', e.target.value)}
                      aria-label="Variant type"
                    >
                      <option value="Size">Size</option>
                      <option value="Color">Color</option>
                      <option value="Model">Model</option>
                      <option value="Custom">Custom</option>
                    </Select>
                  </div>
                  <div className="wizard-form-group" style={{ marginTop: 8 }}>
                    <span className="wizard-summary-label" style={{ display: 'block', marginBottom: 4 }}>Variant values</span>
                    <table className="wizard-variant-table" role="grid" aria-label="Variant values">
                      <thead>
                        <tr>
                          <th scope="col">Value (code suffix)</th>
                          <th scope="col">Name</th>
                          <th scope="col" style={{ width: 40 }} aria-hidden></th>
                        </tr>
                      </thead>
                      <tbody>
                        {formData.variantRows.map((row, idx) => (
                          <tr key={idx}>
                            <td>
                              <Input
                                value={row.value}
                                onChange={(e) => {
                                  const next = [...formData.variantRows];
                                  next[idx] = { ...next[idx], value: e.target.value };
                                  setField('variantRows', next);
                                }}
                                placeholder="e.g. S"
                                aria-label={`Variant ${idx + 1} value`}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const next = [...formData.variantRows];
                                    next[idx] = { ...next[idx], value: (e.target as HTMLInputElement).value };
                                    setField('variantRows', next);
                                    (e.target as HTMLInputElement).form?.querySelector<HTMLInputElement>('input[aria-label*="Variant"][aria-label*="name"]')?.focus();
                                  }
                                  if (e.key === 'Delete' && formData.variantRows.length > 0) {
                                    e.preventDefault();
                                    const next = formData.variantRows.filter((_, i) => i !== idx);
                                    setField('variantRows', next);
                                  }
                                }}
                              />
                            </td>
                            <td>
                              <Input
                                value={row.name}
                                onChange={(e) => {
                                  const next = [...formData.variantRows];
                                  next[idx] = { ...next[idx], name: e.target.value };
                                  setField('variantRows', next);
                                }}
                                placeholder="e.g. Small"
                                aria-label={`Variant ${idx + 1} name`}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    setField('variantRows', [...formData.variantRows, { value: '', name: '' }]);
                                  }
                                  if (e.key === 'Delete' && formData.variantRows.length > 0) {
                                    e.preventDefault();
                                    const next = formData.variantRows.filter((_, i) => i !== idx);
                                    setField('variantRows', next);
                                  }
                                }}
                              />
                            </td>
                            <td>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setField('variantRows', formData.variantRows.filter((_, i) => i !== idx))}
                                aria-label={`Remove variant ${idx + 1}`}
                              >
                                Remove
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 6 }}>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setField('variantRows', [...formData.variantRows, { value: '', name: '' }])}
                      >
                        Add row
                      </Button>
                    </div>
                    {formData.variantRows.length > 0 && formData.sku && (
                      <p style={{ margin: '6px 0 0', fontSize: 11, color: '#666' }}>
                        Codes: {formData.variantRows.slice(0, 3).map((r, i) => `${formData.sku.trim().toUpperCase()}-${(r.value || '?').toUpperCase()}`).join(', ')}
                        {formData.variantRows.length > 3 ? '…' : ''}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div
            id="step-panel-6"
            role="tabpanel"
            aria-labelledby="step-tab-6"
            hidden={currentStep !== 6}
          >
            <div className="wizard-step-content full-width">
              <div className="wizard-form-group">
                <label htmlFor="wizard-tag-input">Tags</label>
                <div
                  className="wizard-tag-input-wrap"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    alignItems: 'center',
                    padding: '6px 10px',
                    border: '1px solid #e5e5e5',
                    borderRadius: 6,
                    minHeight: 38,
                  }}
                >
                  {formData.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="wizard-tag-chip"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 8px',
                        background: '#f0f0f0',
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => setField('tags', formData.tags.filter((_, i) => i !== idx))}
                        aria-label={`Remove tag ${tag}`}
                        style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    id="wizard-tag-input"
                    type="text"
                    value={formData.tagInputValue}
                    onChange={(e) => setField('tagInputValue', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const v = (e.target as HTMLInputElement).value.trim();
                        if (v && !formData.tags.includes(v)) {
                          setField('tags', [...formData.tags, v]);
                          setField('tagInputValue', '');
                        }
                      }
                      if (e.key === 'Backspace' && (e.target as HTMLInputElement).value === '' && formData.tags.length > 0) {
                        setField('tags', formData.tags.slice(0, -1));
                      }
                    }}
                    placeholder="Type and press Enter to add"
                    aria-label="Add tag"
                    style={{ flex: 1, minWidth: 120, border: 'none', outline: 'none', fontSize: 13 }}
                  />
                </div>
                <span className="wizard-summary-label" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                  Enter to add, Backspace to remove last
                </span>
              </div>
            </div>
          </div>
        </div>

        <aside className="wizard-summary-panel" aria-label="Live summary">
          <Card className="wizard-summary-card" variant="bordered" padding="sm">
            <h3>Summary</h3>
            <div className="wizard-summary-row">
              <span className="wizard-summary-label">SKU</span>
              <span className="wizard-summary-value">{formData.sku || '—'}</span>
            </div>
            <div className="wizard-summary-row">
              <span className="wizard-summary-label">Item Name</span>
              <span className="wizard-summary-value">{formData.name || '—'}</span>
            </div>
            <div className="wizard-summary-row">
              <span className="wizard-summary-label">Industry</span>
              <span className="wizard-summary-value">
                {INDUSTRY_OPTIONS.find((o) => o.value === formData.industryType)?.label ?? '—'}
              </span>
            </div>
            <div className="wizard-summary-row">
              <span className="wizard-summary-label">Margin %</span>
              <span className="wizard-summary-value">
                {marginPercent != null ? `${marginPercent.toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="wizard-summary-row">
              <span className="wizard-summary-label">Unit</span>
              <span className="wizard-summary-value">{formData.unitOfMeasure || '—'}</span>
            </div>
            <div className="wizard-summary-row">
              <span className="wizard-summary-label">Variants</span>
              <span className="wizard-summary-value">
                {formData.variantsEnabled ? formData.variantRows.length : '0'}
              </span>
            </div>
            <div className="wizard-summary-row">
              <span className="wizard-summary-label">Active flags</span>
              <span className="wizard-summary-value">
                {[
                  formData.isPerishable && 'Perishable',
                  formData.requiresBatchTracking && 'Batch',
                  formData.requiresSerialTracking && 'Serial',
                  formData.hasExpiryDate && 'Expiry',
                  formData.isHighValue && 'High value',
                ]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </span>
            </div>
          </Card>
        </aside>
      </div>

      <footer className="wizard-footer">
        <Button type="button" variant="ghost" onClick={handleCancel}>
          Cancel (Esc)
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => handleSave(true)}
          disabled={loading}
          title="Save and create another (Ctrl+Enter)"
        >
          Save & New (Ctrl+Enter)
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => handleSave(false)}
          disabled={loading}
          title="Save and close (Ctrl+S)"
        >
          Save (Ctrl+S)
        </Button>
      </footer>

      {toast && (
        <div className="wizard-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
};
