/**
 * Product Creation Wizard - Guided 2-step flow
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Card, Input, ImageUpload, Tooltip, Select, Checkbox, Badge } from '@/shared/components/ui';
import {
  inventoryService,
  IndustryType,
  IndustryFlags,
  UnitConversion,
  CreateInventoryItemRequest,
} from '@/services/inventory.service';
import {
  createEmptyVariantRow,
  normalizeVariantRows,
  type WizardVariantRow,
} from './variantGridModel';
import { VARIANT_UNIT_OPTIONS, resolveVariantUnit } from './variantGridUnits';
import { validateAllVariantRows } from './variantGridValidation';
import { VariantSpreadsheetGrid, type VariantSpreadsheetGridHandle } from './VariantSpreadsheetGrid';
import {
  ProductVariantDetailsDrawer,
  type ProductVariantDetailsDrawerApplyPayload,
} from './productVariantDetails';
import './ProductCreationWizard.css';

const WIZARD_STEPS = [
  { id: 1, label: 'Master Registration', key: 'master' },
  { id: 2, label: 'Variants', key: 'variants' },
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

export interface WizardFormState {
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
  variantRows: WizardVariantRow[];
  tags: string[];
  tagInputValue: string;
  /** Product SKU (optional). Empty = server auto-generates unless locked base is set at step transition. */
  sku: string;
}

const defaultIndustryFlags: IndustryFlags = {
  isPerishable: false,
  requiresBatchTracking: false,
  requiresSerialTracking: false,
  hasExpiryDate: false,
  isHighValue: false,
  industryType: IndustryType.FMCG,
};

/** Default product category for new items and when none is chosen. */
const DEFAULT_CATEGORY = 'electronics';

export const getInitialFormState = (): WizardFormState => ({
  name: '',
  description: '',
  category: DEFAULT_CATEGORY,
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
  variantRows: [],
  tags: [],
  tagInputValue: '',
  sku: '',
});

export interface ProductCreationWizardProps {
  onSuccess: (createdItemId?: string, saveAndNew?: boolean) => void;
  onCancel: () => void;
}

export type { WizardVariantRow };

const DRAFT_KEY = 'busiman-product-draft';
const DRAFT_SAVE_INTERVAL_MS = 10000;
const TOAST_DURATION_MS = 2000;
const SKU_DEBOUNCE_MS = 350;
const VARIANT_CODE_DEBOUNCE_MS = 350;
/** Matches server inventory validator for SKU / variant code (uppercase). */
const SKU_INPUT_PATTERN = /^[A-Z0-9-_]+$/;

/** Batch vs serial are mutually exclusive on the server; normalize bad drafts. */
function normalizeExclusiveTrackingFlags(data: WizardFormState): void {
  if (data.requiresBatchTracking && data.requiresSerialTracking) {
    data.requiresSerialTracking = false;
  }
}

function normalizeDraftCategory(data: WizardFormState): void {
  if (!data.category?.trim()) {
    data.category = DEFAULT_CATEGORY;
  }
}

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
        const base = getInitialFormState();
        const draftUnit =
          typeof parsed.unitOfMeasure === 'string' && parsed.unitOfMeasure.trim()
            ? parsed.unitOfMeasure.trim()
            : base.unitOfMeasure;
        const merged: WizardFormState = {
          ...base,
          ...parsed,
          variantRows: parsed.variantRows?.length
            ? normalizeVariantRows(parsed.variantRows, draftUnit)
            : base.variantRows,
        };
        normalizeExclusiveTrackingFlags(merged);
        normalizeDraftCategory(merged);
        return merged;
      }
    } catch {
      /* ignore */
    }
    return getInitialFormState();
  });
  const [loading, setLoading] = useState(false);
  const [categoryOptionsFromApi, setCategoryOptionsFromApi] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const categorySelectOptions = useMemo(() => {
    const set = new Set<string>([DEFAULT_CATEGORY, ...categoryOptionsFromApi]);
    const cur = formData.category.trim();
    if (cur) set.add(cur);
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [categoryOptionsFromApi, formData.category]);

  useEffect(() => {
    let cancelled = false;
    void inventoryService
      .getCategories()
      .then((list) => {
        if (!cancelled) setCategoryOptionsFromApi(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setCategoryOptionsFromApi([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [toast, setToast] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [variantRowErrors, setVariantRowErrors] = useState<Record<number, { value?: string; name?: string; barcode?: string }>>({});
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [detailsDrawerRowIndex, setDetailsDrawerRowIndex] = useState<number | null>(null);
  const [submitProgressLabel, setSubmitProgressLabel] = useState<string>('');
  const stepContentRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const variantGridRef = useRef<VariantSpreadsheetGridHandle>(null);
  const addFirstVariantRef = useRef<HTMLButtonElement>(null);
  const prevStepForFocusRef = useRef(currentStep);
  const prevVariantRowCountRef = useRef(formData.variantRows.length);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest step for window/visibility focus handlers (avoid stale closures). */
  const currentStepRef = useRef(currentStep);

  /** Locked when leaving step 1 (typed SKU or server-suggested for auto mode). Used for variant full-code preview and create payload. */
  const [lockedBaseSku, setLockedBaseSku] = useState<string | null>(null);
  const [skuApiStatus, setSkuApiStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [variantCodeApiByRow, setVariantCodeApiByRow] = useState<
    Record<number, 'idle' | 'checking' | 'available' | 'taken'>
  >({});
  const [suggestingSku, setSuggestingSku] = useState(false);
  const [step1NextBusy, setStep1NextBusy] = useState(false);
  const skuCheckAbortRef = useRef<AbortController | null>(null);
  const variantCodeCheckAbortRef = useRef<AbortController | null>(null);

  const progressPercent = Math.round((currentStep / WIZARD_STEPS.length) * 100);

  const effectiveBaseSku = (lockedBaseSku || formData.sku.trim().toUpperCase() || '').trim() || null;

  const openDetailsDrawer = useCallback((rowIndex: number) => {
    setDetailsDrawerRowIndex(rowIndex);
    setDetailsDrawerOpen(true);
  }, []);

  const closeDetailsDrawer = useCallback(() => {
    setDetailsDrawerOpen(false);
  }, []);

  const handleDetailsDrawerApply = useCallback(
    (payload: ProductVariantDetailsDrawerApplyPayload) => {
      if (detailsDrawerRowIndex === null) return;
      const idx = detailsDrawerRowIndex;
      setFormData((prev) => ({
        ...prev,
        variantRows: prev.variantRows.map((r, i) => {
          if (i !== idx) return r;
          return {
            ...r,
            value: payload.variantPatch.value ?? r.value,
            name: payload.variantPatch.name ?? r.name,
            barcode: payload.variantPatch.barcode,
            unitOfMeasure: payload.variantPatch.unitOfMeasure ?? r.unitOfMeasure,
            images: payload.variantPatch.images,
            supplierSku: payload.variantPatch.supplierSku,
            hsn: payload.variantPatch.hsn,
            costPriceOverride: payload.variantPatch.costPriceOverride,
            sellingPriceOverride: payload.variantPatch.sellingPriceOverride,
            mrpOverride: payload.variantPatch.mrpOverride,
            taxOverride: payload.variantPatch.taxOverride,
            reorderLevel: payload.variantPatch.reorderLevel,
            minStock: payload.variantPatch.minStock,
            maxStock: payload.variantPatch.maxStock,
            allowBackorder: payload.variantPatch.allowBackorder,
            trackSerialOverride: payload.variantPatch.trackSerialOverride,
            trackBatchOverride: payload.variantPatch.trackBatchOverride,
            isActive: payload.variantPatch.isActive,
            isDiscontinued: payload.variantPatch.isDiscontinued,
            weightOverride: payload.variantPatch.weightOverride,
            dimensionsOverride: payload.variantPatch.dimensionsOverride,
            packSize: payload.variantPatch.packSize,
            unitsPerBox: payload.variantPatch.unitsPerBox,
            shelfLifeDaysOverride: payload.variantPatch.shelfLifeDaysOverride,
          };
        }),
      }));
    },
    [detailsDrawerRowIndex]
  );

  const detailsDrawerVariantRow =
    detailsDrawerRowIndex !== null ? formData.variantRows[detailsDrawerRowIndex] ?? null : null;

  const detailsDrawerSkuPreview =
    detailsDrawerRowIndex !== null && detailsDrawerVariantRow
      ? detailsDrawerVariantRow.value.trim() && effectiveBaseSku
        ? `${effectiveBaseSku}-${detailsDrawerVariantRow.value.trim().toUpperCase()}`
        : detailsDrawerVariantRow.value.trim()
          ? `…-${detailsDrawerVariantRow.value.trim().toUpperCase()}`
          : '—'
      : '—';

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
    };
  }, []);

  /** Focus item name when master step is shown (initial load or returning from step 2). */
  const focusProductNameField = useCallback(() => {
    const tryFocus = (attempt: number) => {
      const el = nameInputRef.current;
      if (el && document.documentElement.contains(el)) {
        try {
          el.focus({ preventScroll: false });
        } catch {
          /* ignore */
        }
        return;
      }
      if (attempt < 30) {
        requestAnimationFrame(() => tryFocus(attempt + 1));
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => tryFocus(0));
    });
  }, []);

  useEffect(() => {
    currentStepRef.current = currentStep;
  }, [currentStep]);

  useEffect(() => {
    if (currentStep !== 1) return;
    focusProductNameField();
  }, [currentStep, focusProductNameField]);

  /**
   * Electron / browser: programmatic focus often fails while the window is not foreground.
   * Re-run master-step focus when the window or tab becomes active again.
   */
  useEffect(() => {
    const scheduleMasterFocus = () => {
      if (currentStepRef.current !== 1) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => focusProductNameField());
      });
    };

    const onWindowFocus = () => {
      scheduleMasterFocus();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      scheduleMasterFocus();
    };

    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [focusProductNameField]);

  /** Focus variants step: empty CTA or first suffix field when entering step 2 from another step. */
  useEffect(() => {
    const prev = prevStepForFocusRef.current;
    prevStepForFocusRef.current = currentStep;
    if (currentStep !== 2 || prev === 2) return;
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (formData.variantRows.length === 0) {
          addFirstVariantRef.current?.focus();
        } else {
          variantGridRef.current?.focusFirstCode();
        }
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [currentStep, formData.variantRows.length]);

  /** After adding the first variant row from empty, focus the suffix input. */
  useEffect(() => {
    const prev = prevVariantRowCountRef.current;
    prevVariantRowCountRef.current = formData.variantRows.length;
    if (currentStep !== 2 || prev !== 0 || formData.variantRows.length !== 1) return;
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        variantGridRef.current?.focusFirstCode();
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [currentStep, formData.variantRows.length]);

  const addVariantRow = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      variantRows: [...prev.variantRows, createEmptyVariantRow(prev.unitOfMeasure)],
    }));
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

  /** Batch and serial tracking are mutually exclusive (server: validateIndustryFlags). */
  const setRequiresBatchTracking = useCallback((checked: boolean) => {
    setFormData((prev) => ({
      ...prev,
      requiresBatchTracking: checked,
      ...(checked ? { requiresSerialTracking: false } : {}),
    }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.requiresBatchTracking;
      if (checked) delete next.requiresSerialTracking;
      return next;
    });
  }, []);

  const setRequiresSerialTracking = useCallback((checked: boolean) => {
    setFormData((prev) => ({
      ...prev,
      requiresSerialTracking: checked,
      ...(checked ? { requiresBatchTracking: false } : {}),
    }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.requiresSerialTracking;
      if (checked) delete next.requiresBatchTracking;
      return next;
    });
  }, []);

  useEffect(() => {
    const raw = formData.sku.trim();
    if (!raw) {
      setSkuApiStatus('idle');
      skuCheckAbortRef.current?.abort();
      return;
    }
    const upper = raw.toUpperCase();
    if (upper.length > 100 || !SKU_INPUT_PATTERN.test(upper)) {
      setSkuApiStatus('idle');
      return;
    }
    setSkuApiStatus('checking');
    skuCheckAbortRef.current?.abort();
    const ac = new AbortController();
    skuCheckAbortRef.current = ac;
    const timer = window.setTimeout(() => {
      inventoryService
        .checkSkuAvailable(upper, { signal: ac.signal })
        .then(({ available }) => {
          setSkuApiStatus(available ? 'available' : 'taken');
        })
        .catch((err: unknown) => {
          const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : '';
          const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : '';
          if (name === 'CanceledError' || code === 'ERR_CANCELED') return;
          setSkuApiStatus('idle');
        });
    }, SKU_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [formData.sku]);

  useEffect(() => {
    if (currentStep !== 2 || !effectiveBaseSku) {
      variantCodeCheckAbortRef.current?.abort();
      return;
    }
    variantCodeCheckAbortRef.current?.abort();
    const ac = new AbortController();
    variantCodeCheckAbortRef.current = ac;
    const timer = window.setTimeout(() => {
      const rows = formData.variantRows;
      void Promise.all(
        rows.map(async (r, i) => {
          const suf = r.value.trim().toUpperCase();
          if (!suf) return { i, st: 'idle' as const };
          const full = `${effectiveBaseSku}-${suf}`;
          try {
            const { available } = await inventoryService.checkVariantCodeAvailable(full, {
              signal: ac.signal,
            });
            return { i, st: available ? ('available' as const) : ('taken' as const) };
          } catch {
            return { i, st: 'idle' as const };
          }
        })
      ).then((results) => {
        if (ac.signal.aborted) return;
        const map: Record<number, 'idle' | 'checking' | 'available' | 'taken'> = {};
        results.forEach(({ i, st }) => {
          map[i] = st;
        });
        setVariantCodeApiByRow(map);
      });
    }, VARIANT_CODE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [currentStep, effectiveBaseSku, formData.variantRows]);

  useEffect(() => {
    if (currentStep !== 2 || lockedBaseSku) return;
    let cancelled = false;
    void (async () => {
      const manual = formData.sku.trim().toUpperCase();
      if (manual) {
        if (!cancelled) setLockedBaseSku(manual);
        return;
      }
      try {
        const { sku } = await inventoryService.suggestItemSku();
        if (!cancelled) setLockedBaseSku(sku);
      } catch {
        if (!cancelled) {
          setError('Could not reserve a product code. Enter a SKU on step 1 or try again.');
          setCurrentStep(1);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentStep, lockedBaseSku, formData.sku]);

  const handleGenerateSku = useCallback(async () => {
    setSuggestingSku(true);
    setError(null);
    try {
      const { sku } = await inventoryService.suggestItemSku();
      setField('sku', sku);
      setSkuApiStatus('available');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not generate SKU');
    } finally {
      setSuggestingSku(false);
    }
  }, [setField]);

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
    const manualSku = formData.sku.trim().toUpperCase();
    const resolvedSku = manualSku || lockedBaseSku || undefined;
    let requiresBatch = formData.requiresBatchTracking;
    let requiresSerial = formData.requiresSerialTracking;
    if (requiresBatch && requiresSerial) {
      requiresSerial = false;
    }
    return {
      ...(resolvedSku ? { sku: resolvedSku } : {}),
      name: formData.name.trim(),
      description: formData.description.trim() || undefined,
      category: formData.category.trim() || undefined,
      unitOfMeasure: formData.unitOfMeasure,
      unitConversions: unitConversions.length ? unitConversions : undefined,
      industryFlags: {
        ...defaultIndustryFlags,
        industryType: formData.industryType,
        isPerishable: formData.isPerishable,
        requiresBatchTracking: requiresBatch,
        requiresSerialTracking: requiresSerial,
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
  }, [formData, lockedBaseSku]);

  const validateStep = useCallback(
    (step: number): boolean => {
      if (step === 1) {
        const err: Record<string, string> = {};
        if (!formData.name.trim()) err.name = 'Item name is required';
        const skuRaw = formData.sku.trim();
        if (skuRaw) {
          const u = skuRaw.toUpperCase();
          if (u.length > 100 || !SKU_INPUT_PATTERN.test(u)) {
            err.sku = 'Use 1–100 characters: letters, numbers, hyphens, underscores only';
          } else if (skuApiStatus === 'checking') {
            err.sku = 'Checking SKU availability…';
          } else if (skuApiStatus === 'taken') {
            err.sku = 'This SKU or code is already used in your branch';
          }
        }
        setFieldErrors((prev) => {
          const next = { ...prev };
          if (err.name) next.name = err.name;
          else delete next.name;
          if (err.sku) next.sku = err.sku;
          else delete next.sku;
          return next;
        });
        return !err.name && !err.sku;
      }
      if (step === 2) {
        if (!effectiveBaseSku) {
          setError('Product code is not ready. Return to step 1 or wait a moment.');
          return false;
        }
        const rowErrors = validateAllVariantRows(formData.variantRows);
        formData.variantRows.forEach((r, i) => {
          const suf = r.value.trim();
          if (suf && variantCodeApiByRow[i] === 'taken') {
            rowErrors[i] = {
              ...rowErrors[i],
              value: 'This full variant code is already used in your branch',
            };
          }
        });
        setVariantRowErrors(rowErrors);
        if (formData.variantRows.length === 0 || formData.variantRows.every((r) => !r.value.trim() || !r.name.trim())) {
          setError('Add at least one valid variant to continue.');
          return false;
        }
        if (Object.keys(rowErrors).length > 0) {
          setError('Please fix variant row errors.');
          return false;
        }
        return true;
      }
      return true;
    },
    [
      formData.name,
      formData.sku,
      formData.variantRows,
      skuApiStatus,
      variantCodeApiByRow,
      effectiveBaseSku,
    ]
  );

  const handleSave = useCallback(
    async (saveAndNew: boolean) => {
      if (!validateStep(1) || !validateStep(2)) {
        setCurrentStep((prev) => (prev === 1 ? 1 : 2));
        return;
      }
      setLoading(true);
      setError(null);
      setSubmitProgressLabel('Creating product master...');
      try {
        const payload = buildCreatePayload();
        const item = await inventoryService.createItem(payload);
        const itemId = item.id;
        const itemUnit = (item.unitOfMeasure || formData.unitOfMeasure || 'pcs').trim();
        const baseSku = item.sku.trim().toUpperCase();
        const validRows = formData.variantRows.filter((row) => {
          const code = row.value.trim() ? `${baseSku}-${row.value.trim().toUpperCase()}` : '';
          return code && row.name.trim();
        });
        const apiRowErrors: Record<number, { value?: string; name?: string; barcode?: string }> = {};
        for (let index = 0; index < validRows.length; index += 1) {
          const row = validRows[index];
          setSubmitProgressLabel(`Creating variants (${index + 1}/${validRows.length})...`);
          try {
            const effectiveUnit = resolveVariantUnit(row.unitOfMeasure, itemUnit);
            const unitOfMeasureOverride =
              effectiveUnit !== itemUnit ? effectiveUnit : undefined;
            const meta: Record<string, unknown> = { ...(row.metadata ?? {}) };
            if (row.supplierSku?.trim()) {
              meta.supplierSku = row.supplierSku.trim();
            }
            await inventoryService.createVariant({
              itemId,
              code: row.value.trim() ? `${baseSku}-${row.value.trim().toUpperCase()}` : '',
              name: row.name.trim(),
              barcode: row.barcode?.trim() || undefined,
              isDefault: index === 0,
              ...(unitOfMeasureOverride ? { unitOfMeasureOverride } : {}),
              ...(row.images?.length ? { images: row.images } : {}),
              ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
              ...(row.costPriceOverride != null ? { costPriceOverride: row.costPriceOverride } : {}),
              ...(row.sellingPriceOverride != null ? { sellingPriceOverride: row.sellingPriceOverride } : {}),
              ...(row.mrpOverride != null ? { mrpOverride: row.mrpOverride } : {}),
              ...(row.taxOverride != null ? { taxOverride: row.taxOverride } : {}),
              ...(row.reorderLevel != null ? { reorderLevel: row.reorderLevel } : {}),
              ...(row.minStock != null ? { minStock: row.minStock } : {}),
              ...(row.maxStock != null ? { maxStock: row.maxStock } : {}),
              ...(row.allowBackorder != null ? { allowBackorder: row.allowBackorder } : {}),
              ...(row.trackSerialOverride != null ? { trackSerialOverride: row.trackSerialOverride } : {}),
              ...(row.trackBatchOverride != null ? { trackBatchOverride: row.trackBatchOverride } : {}),
              ...(row.isActive != null ? { isActive: row.isActive } : {}),
              ...(row.isDiscontinued != null ? { isDiscontinued: row.isDiscontinued } : {}),
              ...(row.weightOverride != null ? { weightOverride: row.weightOverride } : {}),
              ...(row.dimensionsOverride ? { dimensionsOverride: row.dimensionsOverride } : {}),
              ...(row.packSize != null ? { packSize: row.packSize } : {}),
              ...(row.unitsPerBox != null ? { unitsPerBox: row.unitsPerBox } : {}),
              ...(row.shelfLifeDaysOverride != null ? { shelfLifeDaysOverride: row.shelfLifeDaysOverride } : {}),
              ...(row.hsn?.trim() ? { hsn: row.hsn.trim() } : {}),
            });
          } catch (rowErr: unknown) {
            const message = rowErr instanceof Error ? rowErr.message : 'Failed to create variant';
            const lower = message.toLowerCase();
            apiRowErrors[index] = {
              value: lower.includes('code') ? message : undefined,
              barcode: lower.includes('barcode') ? message : undefined,
              name: !lower.includes('code') && !lower.includes('barcode') ? message : undefined,
            };
          }
        }
        if (Object.keys(apiRowErrors).length > 0) {
          setVariantRowErrors(() => {
            const client = validateAllVariantRows(formData.variantRows);
            const merged: Record<number, { value?: string; name?: string; barcode?: string }> = {
              ...client,
            };
            Object.keys(apiRowErrors).forEach((k) => {
              const i = Number(k);
              merged[i] = { ...merged[i], ...apiRowErrors[i] };
            });
            return merged;
          });
          setCurrentStep(2);
          setError('Product master was created, but some variants failed. Fix errors and retry.');
          return;
        }
        localStorage.removeItem(DRAFT_KEY);
        onSuccess(itemId, saveAndNew);
        if (saveAndNew) {
          setFormData(getInitialFormState());
          setCurrentStep(1);
          setFieldErrors({});
          setLockedBaseSku(null);
          setVariantCodeApiByRow({});
          setSkuApiStatus('idle');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to create item';
        setError(message);
      } finally {
        setSubmitProgressLabel('');
        setLoading(false);
      }
    },
    [formData, buildCreatePayload, validateStep, onSuccess, lockedBaseSku]
  );

  const handleCancel = useCallback(() => {
    const hasVariantDraft = formData.variantRows.some((r) => r.value.trim() || r.name.trim() || (r.barcode || '').trim());
    if (formData.name || formData.sku.trim() || formData.images.length > 0 || hasVariantDraft) {
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

  const handleNextStep = useCallback(async () => {
    if (!validateStep(currentStep)) return;
    if (currentStep === 1) {
      const trimmed = formData.sku.trim().toUpperCase();
      if (trimmed) {
        if (skuApiStatus === 'taken' || skuApiStatus === 'checking') return;
        if (trimmed.length > 100 || !SKU_INPUT_PATTERN.test(trimmed)) return;
        setLockedBaseSku(trimmed);
      } else {
        setStep1NextBusy(true);
        try {
          const { sku } = await inventoryService.suggestItemSku();
          setLockedBaseSku(sku);
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : 'Could not generate a product SKU');
          return;
        } finally {
          setStep1NextBusy(false);
        }
      }
    }
    if (currentStep < WIZARD_STEPS.length) {
      setCurrentStep((s) => s + 1);
    } else {
      handleSave(false);
    }
  }, [
    currentStep,
    formData.sku,
    handleSave,
    skuApiStatus,
    validateStep,
  ]);

  const handlePrevStep = useCallback(() => {
    if (currentStep > 1) {
      if (currentStep === 2) {
        setLockedBaseSku(null);
        setVariantCodeApiByRow({});
      }
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const goToWizardStep = useCallback(
    (stepId: number) => {
      if (currentStep === 2 && stepId === 1) {
        setLockedBaseSku(null);
        setVariantCodeApiByRow({});
      }
      setCurrentStep(stepId);
    },
    [currentStep]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && detailsDrawerOpen) {
        // While variant drawer is open, ESC should only close the drawer.
        e.preventDefault();
        e.stopPropagation();
        closeDetailsDrawer();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleNextStep();
          return;
        }
        if (e.key === 'Backspace') {
          e.preventDefault();
          handlePrevStep();
          return;
        }
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= WIZARD_STEPS.length) {
          e.preventDefault();
          goToWizardStep(num);
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
  }, [handleNextStep, handlePrevStep, handleCancel, detailsDrawerOpen, closeDetailsDrawer, goToWizardStep]);

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
        {/* <h2>Create Product – Busiman</h2> */}
        <div className="wizard-progress-text" aria-live="polite">
          Step {currentStep} of {WIZARD_STEPS.length} – {progressPercent}% Complete
        </div>
        <div className="wizard-progress-bar" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
          <div className="wizard-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="wizard-steps-row">
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
                onClick={() => goToWizardStep(step.id)}
              >
                {step.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={handleNextStep}
            disabled={
              loading ||
              step1NextBusy ||
              (currentStep === 1 &&
                !!formData.sku.trim() &&
                skuApiStatus === 'checking')
            }
            title={currentStep === WIZARD_STEPS.length ? 'Create product' : 'Next step (Ctrl+Enter)'}
            className="wizard-header-next-btn"
          >
            {loading
              ? submitProgressLabel || 'Submitting...'
              : step1NextBusy
                ? 'Reserving code…'
                : currentStep === WIZARD_STEPS.length
                  ? 'Create product'
                  : 'Next: Variants'}
          </Button>
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
            <div className="wizard-step-content wizard-step-content--master">
              <div className="wizard-master-split">
                <div className="wizard-master-images">
                  <ImageUpload
                    images={formData.images}
                    onChange={(images) => setField('images', images)}
                    maxImages={10}
                    folder="inventory"
                    disabled={loading}
                  />
                </div>
                <div className="wizard-master-fields">
                  <div className="wizard-master-name-sku-row">
                    <div className="wizard-form-group wizard-master-sku-col">
                      <label htmlFor="wizard-sku">Product SKU (optional)</label>
                      <div className="wizard-sku-input-row">
                        <Input
                          id="wizard-sku"
                          value={formData.sku}
                          onChange={(e) => setField('sku', e.target.value.toUpperCase())}
                          placeholder="e.g. PRD-A1B2C3D4E5 — leave blank to auto-generate"
                          className={fieldErrors.sku ? 'input--error' : ''}
                          aria-invalid={!!fieldErrors.sku}
                          aria-describedby={fieldErrors.sku ? 'wizard-sku-err' : 'wizard-sku-hint'}
                          autoComplete="off"
                          disabled={loading}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className={`wizard-sku-generate-btn${suggestingSku ? ' wizard-sku-generate-btn--busy' : ''}`}
                          onClick={handleGenerateSku}
                          disabled={loading || suggestingSku}
                          title={suggestingSku ? 'Generating…' : 'Generate a unique PRD-… code'}
                          aria-label={suggestingSku ? 'Generating SKU' : 'Generate unique SKU'}
                          aria-busy={suggestingSku}
                        >
                          <span
                            className={
                              suggestingSku
                                ? 'wizard-sku-generate-icon wizard-sku-generate-icon--spinning'
                                : 'wizard-sku-generate-icon'
                            }
                            aria-hidden
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                              <path d="M21 3v5h-5" />
                              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                              <path d="M8 16H3v5" />
                            </svg>
                          </span>
                        </Button>
                      </div>
                      <p id="wizard-sku-hint" className="wizard-summary-label" style={{ fontSize: 11, color: '#64748b' }}>
                        {formData.sku.trim() && skuApiStatus === 'available' ? ` ✅ Available ` : null}
                        {formData.sku.trim() && skuApiStatus === 'checking' ? ' · Checking…' : null}
                      </p>
                      {fieldErrors.sku && (
                        <div id="wizard-sku-err" className="wizard-field-error" role="alert">
                          {fieldErrors.sku}
                        </div>
                      )}
                    </div>
                    <div className="wizard-form-group wizard-master-name-col">
                      <label htmlFor="wizard-name" className="required">Master</label>
                      <Input
                        ref={nameInputRef}
                        id="wizard-name"
                        value={formData.name}
                        onChange={(e) => setField('name', e.target.value)}
                        placeholder="e.g. Organic whole milk 1L"
                        className={fieldErrors.name ? 'input--error' : ''}
                        aria-invalid={!!fieldErrors.name}
                        aria-describedby={fieldErrors.name ? 'wizard-name-err' : undefined}
                      />
                      {fieldErrors.name && <div id="wizard-name-err" className="wizard-field-error" role="alert">{fieldErrors.name}</div>}
                    </div>
                  </div>
                  <div className="wizard-form-group">
                    <label htmlFor="wizard-category">Category</label>
                    <Select
                      id="wizard-category"
                      value={formData.category}
                      onChange={(e) => setField('category', e.target.value)}
                      aria-label="Category"
                      disabled={loading}
                    >
                      {categorySelectOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="wizard-form-group wizard-form-group--grow">
                    <label htmlFor="wizard-description">Description</label>
                    <textarea
                      id="wizard-description"
                      rows={8}
                      value={formData.description}
                      onChange={(e) => setField('description', e.target.value)}
                      placeholder="Ingredients, storage, shelf life, or anything staff should know when picking or selling."
                      maxLength={2000}
                      className="input wizard-master-description"
                      aria-describedby="wizard-desc-count"
                    />
                    <span id="wizard-desc-count" className="wizard-summary-label" style={{ fontSize: 11 }}>
                      {formData.description.length} / 2000
                    </span>
                  </div>
                  <div className="wizard-form-group" style={{ gridColumn: '1 / -1' }}>
                    <span className="wizard-summary-label" style={{ display: 'block', marginBottom: 6 }}>
                      Tracking & Handling
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 20px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                        <Checkbox
                          checked={formData.requiresBatchTracking}
                          onChange={(e) => setRequiresBatchTracking(e.target.checked)}
                          aria-label="Track batch number"
                        />
                        Track batch number
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                        <Checkbox
                          checked={formData.requiresSerialTracking}
                          onChange={(e) => setRequiresSerialTracking(e.target.checked)}
                          aria-label="Track serial number"
                        />
                        Track serial number
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                        <Checkbox
                          checked={formData.hasExpiryDate}
                          onChange={(e) => setField('hasExpiryDate', e.target.checked)}
                          aria-label="Has expiry date"
                        />
                        Has expiry date
                      </label>
                    </div>
                    <p className="wizard-summary-label" style={{ margin: '6px 0 0', fontSize: 11, color: '#64748b' }}>
                      Batch and serial tracking cannot both be enabled — selecting one turns the other off.
                    </p>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' }}>
                    {formData.requiresBatchTracking && (
                      <div className="wizard-form-group wizard-conditional-section">
                        <label htmlFor="wizard-batch-format-master">Batch format example</label>
                        <Input
                          id="wizard-batch-format-master"
                          value={formData.batchFormatExample}
                          onChange={(e) => setField('batchFormatExample', e.target.value)}
                          placeholder="e.g. BATCH-YYYYMMDD-001"
                          aria-label="Batch format example"
                        />
                      </div>
                    )}
                    {formData.requiresSerialTracking && (
                      <div className="wizard-form-group wizard-conditional-section">
                        <label htmlFor="wizard-serial-format-master">Serial format pattern</label>
                        <Input
                          id="wizard-serial-format-master"
                          value={formData.serialFormatPattern}
                          onChange={(e) => setField('serialFormatPattern', e.target.value)}
                          placeholder="e.g. SN-XXXXX"
                          aria-label="Serial format pattern"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            id="step-panel-legacy-2"
            role="tabpanel"
            aria-labelledby="step-tab-2"
            hidden={true}
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
            hidden={true}
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
                  {VARIANT_UNIT_OPTIONS.map((o) => (
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
                  {VARIANT_UNIT_OPTIONS.map((o) => (
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
            hidden={true}
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
                      onChange={(e) => setRequiresBatchTracking(e.target.checked)}
                      aria-label="Track batch number"
                    />
                    Track batch number
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                    <Checkbox
                      checked={formData.requiresSerialTracking}
                      onChange={(e) => setRequiresSerialTracking(e.target.checked)}
                      aria-label="Track serial number"
                    />
                    Track serial number
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
                <p className="wizard-summary-label" style={{ margin: '6px 0 0', fontSize: 11, color: '#64748b' }}>
                  Batch and serial tracking cannot both be enabled — selecting one turns the other off.
                </p>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {formData.isPerishable && <Badge variant="neutral">Perishable</Badge>}
                  {formData.requiresBatchTracking && <Badge variant="neutral">Batch</Badge>}
                  {formData.requiresSerialTracking && <Badge variant="neutral">Serial</Badge>}
                  {formData.hasExpiryDate && <Badge variant="neutral">Expiry</Badge>}
                  {formData.isHighValue && <Badge variant="neutral">High Value</Badge>}
                </div>
                {(formData.requiresBatchTracking || formData.requiresSerialTracking) && (
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: '#666' }}>
                    Tracking is configured at master level and applies to all variants.
                  </p>
                )}
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
            id="step-panel-2"
            role="tabpanel"
            aria-labelledby="step-tab-2"
            hidden={currentStep !== 2}
          >
            <div className="wizard-step-content full-width">
              <section
                className="wizard-variants-section"
                aria-label={
                  formData.name.trim()
                    ? `Draft variants for ${formData.name.trim()}`
                    : 'Draft product variants'
                }
              >
                <div className="wizard-variants-datatable-wrap">
                  <VariantSpreadsheetGrid
                    ref={variantGridRef}
                    isStepActive={currentStep === 2}
                    rows={formData.variantRows}
                    onRowsChange={(rows) => setFormData((prev) => ({ ...prev, variantRows: rows }))}
                    rowErrors={variantRowErrors}
                    onRowErrorsChange={setVariantRowErrors}
                    unitOfMeasure={formData.unitOfMeasure}
                    emptyTitle="No variants yet"
                    emptyMessage="Add at least one variant to finish. The first row becomes the default variant."
                    emptyAction={
                      <Button
                        ref={addFirstVariantRef}
                        type="button"
                        variant="primary"
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            variantRows: [createEmptyVariantRow(prev.unitOfMeasure)],
                          }))
                        }
                      >
                        Add first variant
                      </Button>
                    }
                    className="wizard-variants-data-table"
                    onOpenDetails={openDetailsDrawer}
                  />
                </div>
                {formData.variantRows.length > 0 && (
                  <div className="wizard-variants-footer-actions">
                    <Button type="button" variant="secondary" size="sm" onClick={addVariantRow}>
                      Add variant
                    </Button>
                    <p className="wizard-variants-suffix-hint" aria-live="polite">
                      {effectiveBaseSku ? (
                        <>
                          Full code preview (base <strong>{effectiveBaseSku}</strong>):{' '}
                          {formData.variantRows
                            .slice(0, 4)
                            .map((r) =>
                              r.value.trim()
                                ? `${effectiveBaseSku}-${r.value.trim().toUpperCase()}`
                                : '…'
                            )
                            .join(', ')}
                          {formData.variantRows.length > 4 ? '…' : ''}
                        </>
                      ) : (
                        <>Loading base SKU for preview…</>
                      )}
                    </p>
                  </div>
                )}
              </section>
            </div>
          </div>
          <div
            id="step-panel-6"
            role="tabpanel"
            aria-labelledby="step-tab-6"
            hidden={true}
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
                {formData.variantRows.filter((r) => r.value.trim() || r.name.trim()).length}
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

      {toast && (
        <div className="wizard-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      <ProductVariantDetailsDrawer
        key={`pvd-${detailsDrawerRowIndex ?? 'x'}-${detailsDrawerOpen}`}
        isOpen={detailsDrawerOpen}
        onClose={closeDetailsDrawer}
        initialVariantRow={detailsDrawerVariantRow}
        productDefaultUnit={formData.unitOfMeasure}
        defaults={{
          costPrice: formData.costPrice ? parseFloat(formData.costPrice) : undefined,
          sellingPrice: formData.sellingPrice ? parseFloat(formData.sellingPrice) : undefined,
          mrp: formData.mrp ? parseFloat(formData.mrp) : undefined,
          tax: formData.gstPercent ? parseFloat(formData.gstPercent) : undefined,
          trackSerial: formData.requiresSerialTracking,
          trackBatch: formData.requiresBatchTracking,
          weight: formData.weightValue ? parseFloat(formData.weightValue) : undefined,
          dimensions: {
            length: formData.dimensionLength ? parseFloat(formData.dimensionLength) : undefined,
            width: formData.dimensionWidth ? parseFloat(formData.dimensionWidth) : undefined,
            height: formData.dimensionHeight ? parseFloat(formData.dimensionHeight) : undefined,
          },
          shelfLifeDays: formData.shelfLifeDays ? parseFloat(formData.shelfLifeDays) : undefined,
        }}
        baseSkuPreview={detailsDrawerSkuPreview}
        onApply={handleDetailsDrawerApply}
      />
    </div>
  );
};
