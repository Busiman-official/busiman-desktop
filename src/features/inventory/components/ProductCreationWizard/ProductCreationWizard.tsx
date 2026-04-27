/**
 * Product Creation Wizard - Guided 2-step flow
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Card, Input, ImageUpload, Tooltip, Select, Checkbox, Badge } from '@/shared/components/ui';
import {
  inventoryService,
  IndustryType,
  ItemType,
  ProductType,
  IndustryFlags,
  UnitConversion,
  UnitConfig,
  CreateInventoryItemRequest,
} from '@/services/inventory.service';
import {
  CATEGORY_OPTIONS,
  getPresetForCategory,
  PRODUCT_TYPE_OPTIONS,
  resolveInventoryBehavior,
} from '@/features/inventory/constants/productCatalog';
import {
  createEmptyVariantRow,
  normalizeVariantRows,
  type WizardVariantRow,
} from './variantGridModel';
import {
  VARIANT_UNIT_OPTIONS,
  buildVariantUnitOptions,
  resolveVariantUnit,
} from './variantGridUnits';
import { validateAllVariantRows } from './variantGridValidation';
import { computeVariantSuffixes } from './variantSuffix';
import { VariantSpreadsheetGrid, type VariantSpreadsheetGridHandle } from './VariantSpreadsheetGrid';
import {
  ProductVariantDetailsDrawer,
  type ProductVariantDetailsDrawerApplyPayload,
} from './productVariantDetails';
import { ConfirmDialog } from '@/shared/components/modals';
import './ProductCreationWizard.css';

const WIZARD_STEPS = [
  { id: 1, label: 'Product', key: 'master' },
  { id: 2, label: 'Variants & SKU', key: 'variants' },
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
  alternateUnits: Array<{
    unitCode: string;
    factorToBase: string;
    isDefaultPurchase?: boolean;
    isDefaultSales?: boolean;
    isActive?: boolean;
  }>;
  dimensionLength: string;
  dimensionWidth: string;
  dimensionHeight: string;
  dimensionUnit: string;
  weightValue: string;
  weightUnit: string;
  isMisc: boolean;
  itemType: ItemType;
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
  productType: ProductType;
}

const defaultIndustryFlags: IndustryFlags = {
  isPerishable: false,
  requiresBatchTracking: false,
  requiresSerialTracking: false,
  hasExpiryDate: false,
  isHighValue: false,
  industryType: IndustryType.FMCG,
};

const DEFAULT_CATEGORY = 'general';

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
  alternateUnits: [],
  dimensionLength: '',
  dimensionWidth: '',
  dimensionHeight: '',
  dimensionUnit: 'cm',
  weightValue: '',
  weightUnit: 'kg',
  isMisc: false,
  itemType: ItemType.STOCK,
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
  productType: ProductType.STOCK_ITEM,
});

export interface ProductCreationWizardProps {
  onSuccess: (createdItemId?: string, saveAndNew?: boolean) => void;
  onCancel: () => void;
}

export type { WizardVariantRow };

const DRAFT_KEY = 'busiman-product-draft';
const DRAFT_VERSION = 1 as const;
/** Persist soon after edits; 10s-only saves caused data loss when leaving quickly. */
const DRAFT_SAVE_DEBOUNCE_MS = 450;
const VARIANT_CODE_DEBOUNCE_MS = 350;

type ProductDraftEnvelopeV1 = {
  v: typeof DRAFT_VERSION;
  step: number;
  form: Partial<WizardFormState> & { sku?: string };
};

function mergeParsedFormIntoState(parsedRest: Partial<WizardFormState> & { sku?: string }): WizardFormState {
  const { sku, ...rest } = parsedRest;
  void sku;
  const base = getInitialFormState();
  const draftUnit =
    typeof rest.unitOfMeasure === 'string' && rest.unitOfMeasure.trim()
      ? rest.unitOfMeasure.trim()
      : base.unitOfMeasure;
  const merged: WizardFormState = {
    ...base,
    ...rest,
    productType: rest.productType ?? base.productType,
    variantRows: rest.variantRows?.length
      ? normalizeVariantRows(rest.variantRows, draftUnit)
      : base.variantRows,
  };
  normalizeExclusiveTrackingFlags(merged);
  normalizeDraftCategory(merged);
  return merged;
}

function parseProductDraftFromStorage(): { step: number; form: WizardFormState } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const o = parsed as Record<string, unknown>;

    let step = 1;
    let formPartial: Partial<WizardFormState> & { sku?: string };

    if (o.v === DRAFT_VERSION && o.form && typeof o.form === 'object') {
      formPartial = o.form as Partial<WizardFormState> & { sku?: string };
      const s = o.step;
      if (typeof s === 'number' && s >= 1 && s <= WIZARD_STEPS.length) {
        step = Math.floor(s);
      }
    } else {
      formPartial = parsed as Partial<WizardFormState> & { sku?: string };
      step = 1;
    }

    const form = mergeParsedFormIntoState(formPartial);
    return { step, form };
  } catch {
    return null;
  }
}

function serializeProductDraft(step: number, form: WizardFormState): string {
  const envelope: ProductDraftEnvelopeV1 = {
    v: DRAFT_VERSION,
    step,
    form,
  };
  return JSON.stringify(envelope);
}

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

/** True when the wizard has no meaningful content (same idea as discard-prompt checks). */
function isWizardFormEmpty(f: WizardFormState): boolean {
  const hasVariantDraft = f.variantRows.some(
    (r) =>
      r.value.trim() ||
      r.name.trim() ||
      (r.barcode || '').trim() ||
      (r.hsn || '').trim() ||
      (r.supplierSku || '').trim() ||
      (r.images?.length ?? 0) > 0 ||
      r.costPriceOverride != null ||
      r.sellingPriceOverride != null ||
      r.mrpOverride != null ||
      r.taxOverride != null
  );
  const hasMasterDraft =
    f.name.trim() ||
    f.description.trim() ||
    f.images.length > 0 ||
    f.tags.length > 0 ||
    Boolean(
      f.costPrice ||
        f.sellingPrice ||
        f.mrp ||
        f.gstPercent ||
        f.minSellingPrice ||
        f.secondaryUnit ||
        f.conversionFactor ||
        f.dimensionLength ||
        f.dimensionWidth ||
        f.dimensionHeight ||
        f.weightValue ||
        f.shelfLifeDays ||
        f.batchFormatExample ||
        f.serialFormatPattern
    );
  return !hasMasterDraft && !hasVariantDraft;
}

export const ProductCreationWizard: React.FC<ProductCreationWizardProps> = ({
  onSuccess,
  onCancel,
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<WizardFormState>(getInitialFormState());
  const [draftPromptOpen, setDraftPromptOpen] = useState(false);
  const [draftDecisionResolved, setDraftDecisionResolved] = useState(false);
  const pendingDraftRef = useRef<{ step: number; form: WizardFormState } | null>(null);
  const [loading, setLoading] = useState(false);
  const [categoryOptionsFromApi, setCategoryOptionsFromApi] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const categorySelectOptions = useMemo(() => {
    const set = new Set<string>([
      ...CATEGORY_OPTIONS.map((o) => o.value),
      ...categoryOptionsFromApi,
    ]);
    const cur = formData.category.trim();
    if (cur) set.add(cur);
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [categoryOptionsFromApi, formData.category]);

  const resolvedBehavior = useMemo(
    () =>
      resolveInventoryBehavior({
        productType: formData.productType,
        isMisc: formData.isMisc,
        itemType: formData.itemType,
      }),
    [formData.productType, formData.isMisc, formData.itemType]
  );

  const categoryOptionLabel = useCallback((value: string) => {
    const o = CATEGORY_OPTIONS.find((x) => x.value === value);
    return o?.label ?? value;
  }, []);

  const onCategoryChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const preset = getPresetForCategory(value);
    setFormData((prev) => {
      const next: WizardFormState = {
        ...prev,
        ...preset,
        category: preset.category ?? value.trim(),
      };
      normalizeExclusiveTrackingFlags(next);
      return next;
    });
  }, []);

  const onProductTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const pt = e.target.value as ProductType;
    setFormData((prev) => {
      const next: WizardFormState = { ...prev, productType: pt };
      if (pt === ProductType.ASSET) {
        next.isHighValue = true;
        next.requiresBatchTracking = false;
        next.requiresSerialTracking = false;
        next.hasExpiryDate = false;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const draft = parseProductDraftFromStorage();
    if (draft) {
      pendingDraftRef.current = draft;
      setDraftPromptOpen(true);
      setDraftDecisionResolved(false);
      return;
    }
    setDraftDecisionResolved(true);
  }, []);

  const handleRestoreDraft = useCallback(() => {
    const pending = pendingDraftRef.current;
    if (!pending) {
      setDraftPromptOpen(false);
      setDraftDecisionResolved(true);
      return;
    }
    suppressBlankDraftPersistRef.current = false;
    setCurrentStep(pending.step);
    setFormData(pending.form);
    setDraftPromptOpen(false);
    pendingDraftRef.current = null;
    setDraftDecisionResolved(true);
  }, []);

  const handleStartFreshDraft = useCallback(() => {
    skipPersistOnUnmountRef.current = true;
    localStorage.removeItem(DRAFT_KEY);
    suppressBlankDraftPersistRef.current = true;
    setCurrentStep(1);
    setFormData(getInitialFormState());
    setFieldErrors({});
    setVariantRowErrors({});
    setVariantCodeApiByRow({});
    setDraftPromptOpen(false);
    pendingDraftRef.current = null;
    setDraftDecisionResolved(true);
    skipPersistOnUnmountRef.current = false;
  }, []);

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [variantRowErrors, setVariantRowErrors] = useState<
    Record<number, { hsn?: string; value?: string; name?: string; barcode?: string }>
  >({});
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [detailsDrawerRowIndex, setDetailsDrawerRowIndex] = useState<number | null>(null);
  const [submitProgressLabel, setSubmitProgressLabel] = useState<string>('');
  const stepContentRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const variantGridRef = useRef<VariantSpreadsheetGridHandle>(null);
  const addFirstVariantRef = useRef<HTMLButtonElement>(null);
  const prevStepForFocusRef = useRef(currentStep);
  const prevVariantRowCountRef = useRef(formData.variantRows.length);
  /** Latest step for window/visibility focus handlers (avoid stale closures). */
  const currentStepRef = useRef(currentStep);
  /** Latest form for synchronous draft flush (beforeunload / tab hide). */
  const formDataRef = useRef(formData);
  /** When true, unmount must not write localStorage (draft cleared or product created). */
  const skipPersistOnUnmountRef = useRef(false);
  /**
   * After "Start fresh", do not re-create localStorage until the user enters something meaningful.
   * Otherwise the debounced save immediately writes an empty envelope again.
   */
  const suppressBlankDraftPersistRef = useRef(false);

  const [variantCodeApiByRow, setVariantCodeApiByRow] = useState<
    Record<number, 'idle' | 'checking' | 'available' | 'taken'>
  >({});
  const variantCodeCheckAbortRef = useRef<AbortController | null>(null);

  const progressPercent = Math.round((currentStep / WIZARD_STEPS.length) * 100);

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

  const detailsDrawerSkuPreview = useMemo(() => {
    if (detailsDrawerRowIndex === null || !detailsDrawerVariantRow) return '—';
    const suf = computeVariantSuffixes([detailsDrawerVariantRow])[0] ?? '';
    return suf || '—';
  }, [detailsDrawerRowIndex, detailsDrawerVariantRow]);

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
    formDataRef.current = formData;
  }, [formData]);

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

  const unitOptions = useMemo(
    () =>
      buildVariantUnitOptions({
        baseUnit: formData.unitOfMeasure,
        alternateUnits: formData.alternateUnits.map((u) => ({
          unitCode: u.unitCode,
          isActive: u.isActive !== false,
        })),
      }),
    [formData.unitOfMeasure, formData.alternateUnits]
  );

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

  const setResolvedConfig = useCallback((nextFields: Partial<WizardFormState>) => {
    setFormData((prev) => ({
      ...prev,
      ...nextFields,
      ...(resolveInventoryBehavior({
        productType: nextFields.productType ?? prev.productType,
        isMisc: nextFields.isMisc ?? prev.isMisc,
        itemType: nextFields.itemType ?? prev.itemType,
      }).trackingAllowed
        ? {}
        : {
          requiresBatchTracking: false,
          requiresSerialTracking: false,
          hasExpiryDate: false,
        }),
    }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.requiresBatchTracking;
      delete next.requiresSerialTracking;
      delete next.hasExpiryDate;
      return next;
    });
  }, []);

  const setIsMisc = useCallback((value: boolean) => {
    setResolvedConfig({
      isMisc: value,
    });
  }, [setResolvedConfig]);

  useEffect(() => {
    if (currentStep !== 2) {
      variantCodeCheckAbortRef.current?.abort();
      return;
    }
    variantCodeCheckAbortRef.current?.abort();
    const ac = new AbortController();
    variantCodeCheckAbortRef.current = ac;
    const timer = window.setTimeout(() => {
      const rows = formData.variantRows;
      const suffixes = computeVariantSuffixes(rows);
      void Promise.all(
        rows.map(async (_r, i) => {
          const full = (suffixes[i] || '').toUpperCase();
          if (!full) return { i, st: 'idle' as const };
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
  }, [currentStep, formData.variantRows]);

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
    const mrp = formData.mrp ? parseFloat(formData.mrp) : undefined;
    const tax = formData.gstPercent ? parseFloat(formData.gstPercent) : undefined;
    let requiresBatch = formData.requiresBatchTracking;
    let requiresSerial = formData.requiresSerialTracking;
    if (requiresBatch && requiresSerial) {
      requiresSerial = false;
    }
    const behavior = resolveInventoryBehavior({
      productType: formData.productType,
      isMisc: formData.isMisc,
      itemType: formData.itemType,
    });
    const masterUom = formData.unitOfMeasure.trim() || 'pcs';
    const unitConfig: UnitConfig = {
      baseUnit: masterUom,
      alternateUnits: formData.alternateUnits
        .map((alt) => ({
          unitCode: alt.unitCode.trim().toLowerCase(),
          factorToBase: parseFloat(alt.factorToBase),
          isDefaultPurchase: !!alt.isDefaultPurchase,
          isDefaultSales: !!alt.isDefaultSales,
          isActive: alt.isActive !== false,
        }))
        .filter((alt) => alt.unitCode && alt.factorToBase > 0),
      allowCustomUnits: true,
    };
    const skus = computeVariantSuffixes(formData.variantRows);
    const variantLines = formData.variantRows
      .map((row, i) => ({
        row,
        sku: (skus[i] || '').toUpperCase(),
        originalIndex: i,
      }))
      .filter((x) => x.row.name.trim() && x.sku);

    const variants = variantLines.map(({ row, sku }, vi) => {
      const effectiveUnit = resolveVariantUnit(row.unitOfMeasure, masterUom);
      return {
        sku,
        name: row.name.trim(),
        isDefault: vi === 0,
        barcode: row.barcode?.trim() || undefined,
        hsn: row.hsn?.trim() || undefined,
        unitOfMeasure: effectiveUnit,
        costPrice: row.costPriceOverride ?? costPrice,
        sellingPrice: row.sellingPriceOverride ?? sellingPrice,
        mrp: row.mrpOverride ?? mrp,
        tax: row.taxOverride ?? tax,
        reorderLevel: row.reorderLevel,
        minStock: row.minStock,
        maxStock: row.maxStock,
        allowBackorder: row.allowBackorder,
        trackSerialOverride: row.trackSerialOverride ?? (behavior.trackingAllowed ? requiresSerial : undefined),
        trackBatchOverride: row.trackBatchOverride ?? (behavior.trackingAllowed ? requiresBatch : undefined),
        weightOverride: row.weightOverride,
        dimensionsOverride: row.dimensionsOverride,
        packSize: row.packSize,
        unitsPerBox: row.unitsPerBox,
        shelfLifeDaysOverride: row.shelfLifeDaysOverride,
        images: row.images?.length ? row.images : undefined,
      };
    });

    return {
      name: formData.name.trim(),
      variants,
      description: formData.description.trim() || undefined,
      category: formData.category.trim() || undefined,
      productType: behavior.productType,
      isMisc: behavior.isMisc,
      unitOfMeasure: masterUom,
      unitConversions: unitConversions.length ? unitConversions : undefined,
      unitConfig,
      itemType: behavior.itemType,
      industryFlags: {
        ...defaultIndustryFlags,
        industryType: formData.industryType,
        isPerishable: formData.isPerishable,
        requiresBatchTracking: behavior.trackingAllowed ? requiresBatch : false,
        requiresSerialTracking: behavior.trackingAllowed ? requiresSerial : false,
        hasExpiryDate: behavior.trackingAllowed ? formData.hasExpiryDate : false,
        isHighValue: formData.isHighValue,
      },
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

  const validateStep = useCallback(
    (step: number): boolean => {
      if (step === 1) {
        const err: Record<string, string> = {};
        if (!formData.name.trim()) err.name = 'Item name is required';
        setFieldErrors((prev) => {
          const next = { ...prev };
          if (err.name) next.name = err.name;
          else delete next.name;
          return next;
        });
        return !err.name;
      }
      if (step === 2) {
        const rowErrors = validateAllVariantRows(formData.variantRows);
        const suffixes = computeVariantSuffixes(formData.variantRows);
        formData.variantRows.forEach((r, i) => {
          if (!r.name.trim()) return;
          if (suffixes[i] && variantCodeApiByRow[i] === 'taken') {
            const cur = rowErrors[i] || {};
            rowErrors[i] = {
              ...cur,
              ...(cur.name
                ? {}
                : {
                    name: 'This variant code is already used. Change the variant name or open Details to set a unique code suffix.',
                  }),
            };
          }
        });
        setVariantRowErrors(rowErrors);
        if (
          formData.variantRows.length === 0 ||
          formData.variantRows.every((r) => !r.name.trim())
        ) {
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
    [formData.name, formData.variantRows, variantCodeApiByRow]
  );

  const handleSave = useCallback(
    async (saveAndNew: boolean) => {
      if (!validateStep(1) || !validateStep(2)) {
        setCurrentStep((prev) => (prev === 1 ? 1 : 2));
        return;
      }
      setLoading(true);
      setError(null);
      setSubmitProgressLabel('Creating product and variants...');
      try {
        const payload = buildCreatePayload();
        if (!payload.variants?.length) {
          setError('Add at least one variant with a name and SKU.');
          setCurrentStep(2);
          return;
        }
        const item = await inventoryService.createItem(payload);
        const itemId = item.id;
        skipPersistOnUnmountRef.current = true;
        localStorage.removeItem(DRAFT_KEY);
        onSuccess(itemId, saveAndNew);
        if (saveAndNew) {
          setFormData(getInitialFormState());
          setCurrentStep(1);
          setFieldErrors({});
          setVariantCodeApiByRow({});
          skipPersistOnUnmountRef.current = false;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to create item';
        setError(message);
      } finally {
        setSubmitProgressLabel('');
        setLoading(false);
      }
    },
    [formData, buildCreatePayload, validateStep, onSuccess]
  );

  const handleCancel = useCallback(() => {
    const f = formData;
    const hasVariantDraft = f.variantRows.some(
      (r) =>
        r.value.trim() ||
        r.name.trim() ||
        (r.barcode || '').trim() ||
        (r.hsn || '').trim() ||
        (r.supplierSku || '').trim() ||
        (r.images?.length ?? 0) > 0 ||
        r.costPriceOverride != null ||
        r.sellingPriceOverride != null ||
        r.mrpOverride != null ||
        r.taxOverride != null
    );
    const hasMasterDraft =
      f.name.trim() ||
      f.description.trim() ||
      f.images.length > 0 ||
      f.tags.length > 0 ||
      Boolean(
        f.costPrice ||
          f.sellingPrice ||
          f.mrp ||
          f.gstPercent ||
          f.minSellingPrice ||
          f.secondaryUnit ||
          f.conversionFactor ||
          f.dimensionLength ||
          f.dimensionWidth ||
          f.dimensionHeight ||
          f.weightValue ||
          f.shelfLifeDays ||
          f.batchFormatExample ||
          f.serialFormatPattern
      );
    if (hasMasterDraft || hasVariantDraft) {
      if (window.confirm('Discard draft and close?')) {
        skipPersistOnUnmountRef.current = true;
        localStorage.removeItem(DRAFT_KEY);
        onCancel();
      }
    } else {
      onCancel();
    }
  }, [formData, onCancel]);

  const flushDraftToStorage = useCallback(() => {
    if (!draftDecisionResolved) return;
    const fd = formDataRef.current;
    if (suppressBlankDraftPersistRef.current && isWizardFormEmpty(fd)) {
      return;
    }
    if (!isWizardFormEmpty(fd)) {
      suppressBlankDraftPersistRef.current = false;
    }
    try {
      localStorage.setItem(
        DRAFT_KEY,
        serializeProductDraft(currentStepRef.current, fd)
      );
    } catch {
      /* quota / private mode */
    }
  }, [draftDecisionResolved]);

  useEffect(() => {
    if (!draftDecisionResolved) return;
    const id = window.setTimeout(flushDraftToStorage, DRAFT_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [formData, currentStep, flushDraftToStorage, draftDecisionResolved]);

  useEffect(() => {
    if (!draftDecisionResolved) return;
    const sync = () => {
      try {
        const fd = formDataRef.current;
        if (suppressBlankDraftPersistRef.current && isWizardFormEmpty(fd)) {
          return;
        }
        if (!isWizardFormEmpty(fd)) {
          suppressBlankDraftPersistRef.current = false;
        }
        localStorage.setItem(
          DRAFT_KEY,
          serializeProductDraft(currentStepRef.current, fd)
        );
      } catch {
        /* ignore */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', sync);
    window.addEventListener('beforeunload', sync);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', sync);
      window.removeEventListener('beforeunload', sync);
    };
  }, [draftDecisionResolved]);

  /** SPA navigation: persist when leaving the wizard without a full page unload. */
  useEffect(() => {
    if (!draftDecisionResolved) return;
    return () => {
      if (skipPersistOnUnmountRef.current) {
        skipPersistOnUnmountRef.current = false;
        return;
      }
      try {
        const fd = formDataRef.current;
        if (suppressBlankDraftPersistRef.current && isWizardFormEmpty(fd)) {
          return;
        }
        if (!isWizardFormEmpty(fd)) {
          suppressBlankDraftPersistRef.current = false;
        }
        localStorage.setItem(
          DRAFT_KEY,
          serializeProductDraft(currentStepRef.current, fd)
        );
      } catch {
        /* ignore */
      }
    };
  }, [draftDecisionResolved]);

  const handleNextStep = useCallback(async () => {
    if (!validateStep(currentStep)) return;
    if (currentStep < WIZARD_STEPS.length) {
      setCurrentStep((s) => s + 1);
    } else {
      handleSave(false);
    }
  }, [currentStep, handleSave, validateStep]);

  const handlePrevStep = useCallback(() => {
    if (currentStep > 1) {
      if (currentStep === 2) {
        setVariantCodeApiByRow({});
      }
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const goToWizardStep = useCallback(
    (stepId: number) => {
      if (currentStep === 2 && stepId === 1) {
        setVariantCodeApiByRow({});
      }
      setCurrentStep(stepId);
    },
    [currentStep]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (draftPromptOpen) return;
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
  }, [handleNextStep, handlePrevStep, handleCancel, detailsDrawerOpen, closeDetailsDrawer, goToWizardStep, draftPromptOpen]);

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
            disabled={loading}
            title={currentStep === WIZARD_STEPS.length ? 'Create product' : 'Next step (Ctrl+Enter)'}
            className="wizard-header-next-btn"
          >
            {loading
              ? submitProgressLabel || 'Submitting...'
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
                  <div className="wizard-form-group wizard-form-group--grow" style={{ marginTop: 16 }}>
                    <label htmlFor="wizard-description">Description</label>
                    <textarea
                      id="wizard-description"
                      rows={4}
                      value={formData.description}
                      onChange={(e) => setField('description', e.target.value)}
                      placeholder="Ingredients, storage, shelf life, or anything staff should know when picking or selling."
                      maxLength={1000}
                      className="input wizard-master-description"
                      aria-describedby="wizard-desc-count"
                    />
                    <span id="wizard-desc-count" className="wizard-summary-label" style={{ fontSize: 11 }}>
                      {formData.description.length} / 2000
                    </span>
                  </div>
                </div>
                <div className="wizard-master-fields">
                  <div className="wizard-master-name-sku-row">
                    <div className="wizard-form-group wizard-master-name-col">
                      <label htmlFor="wizard-name" className="required">Product name</label>
                      <Input
                        ref={nameInputRef}
                        id="wizard-name"
                        value={formData.name}
                        onChange={(e) => setField('name', e.target.value)}
                        placeholder="e.g. Organic whole milk"
                        className={fieldErrors.name ? 'input--error' : ''}
                        aria-invalid={!!fieldErrors.name}
                        aria-describedby={fieldErrors.name ? 'wizard-name-err' : undefined}
                      />
                      {fieldErrors.name && <div id="wizard-name-err" className="wizard-field-error" role="alert">{fieldErrors.name}</div>}
                    </div>
                  </div>
                  <div className='wizard-form-group-row'>
                    <div className="wizard-form-group" style={{ flex: 1 }}>
                      <label htmlFor="wizard-category">Catalog category</label>
                      <Select
                        id="wizard-category"
                        value={formData.category}
                        onChange={onCategoryChange}
                        aria-label="Category"
                        disabled={loading}
                      >
                        {categorySelectOptions.map((c) => (
                          <option key={c} value={c}>
                            {categoryOptionLabel(c)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="wizard-form-group" style={{ flex: 1 }}>
                      <label htmlFor="wizard-product-type">Product type</label>
                      <Select
                        id="wizard-product-type"
                        value={formData.productType}
                        onChange={onProductTypeChange}
                        aria-label="Product type"
                        disabled={loading}
                      >
                        {PRODUCT_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  <div className="wizard-form-group" style={{ flex: 1 }}>
                    <label htmlFor="wizard-unit">Base unit</label>
                    <Select
                      id="wizard-unit"
                      value={formData.unitOfMeasure}
                      onChange={(e) => setField('unitOfMeasure', e.target.value)}
                    >
                      {VARIANT_UNIT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  </div>
                  <div className="wizard-form-group" style={{ gridColumn: '1 / -1' }}>
                    <label>Alternate units</label>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {formData.alternateUnits.map((alt, idx) => (
                        <div key={`alt-${idx}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                          <Input
                            placeholder="Unit (e.g. box)"
                            value={alt.unitCode}
                            onChange={(e) =>
                              setField(
                                'alternateUnits',
                                formData.alternateUnits.map((u, i) =>
                                  i === idx ? { ...u, unitCode: e.target.value } : u
                                )
                              )
                            }
                          />
                          <Input
                            type="number"
                            min={0.0001}
                            step={0.0001}
                            placeholder={`1 ${alt.unitCode || 'alt'} = X ${formData.unitOfMeasure}`}
                            value={alt.factorToBase}
                            onChange={(e) =>
                              setField(
                                'alternateUnits',
                                formData.alternateUnits.map((u, i) =>
                                  i === idx ? { ...u, factorToBase: e.target.value } : u
                                )
                              )
                            }
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              setField(
                                'alternateUnits',
                                formData.alternateUnits.filter((_, i) => i !== idx)
                              )
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            setField('alternateUnits', [
                              ...formData.alternateUnits,
                              { unitCode: '', factorToBase: '', isActive: true },
                            ])
                          }
                        >
                          Add alternate unit
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="wizard-form-group" style={{ gridColumn: '1 / -1' }}>
                    <p className="wizard-summary-label" style={{ margin: '6px 0 0', fontSize: 12, color: '#0f766e', fontWeight: 600 }}>
                      {resolvedBehavior.helperText}
                    </p>
                    <span className="wizard-summary-label" style={{ display: 'block', margin: '12px 0 6px' }}>
                      Tracking & Handling
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 20px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                        <Checkbox
                          checked={formData.requiresBatchTracking}
                          disabled={!resolvedBehavior.trackingAllowed}
                          onChange={(e) => setRequiresBatchTracking(e.target.checked)}
                          aria-label="Track batch number"
                        />
                        Track batch number
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                        <Checkbox
                          checked={formData.requiresSerialTracking}
                          disabled={!resolvedBehavior.trackingAllowed}
                          onChange={(e) => setRequiresSerialTracking(e.target.checked)}
                          aria-label="Track serial number"
                        />
                        Track serial number
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                        <Checkbox
                          checked={formData.hasExpiryDate}
                          disabled={!resolvedBehavior.trackingAllowed}
                          onChange={(e) => setField('hasExpiryDate', e.target.checked)}
                          aria-label="Has expiry date"
                        />
                        Has expiry date
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12}}>
                        <Checkbox
                          checked={formData.isMisc}
                          onChange={(e) => setIsMisc(e.target.checked)}
                          aria-label="Mark as Misc"
                        />
                        Mark as Misc
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
                      disabled={!resolvedBehavior.trackingAllowed}
                      onChange={(e) => setRequiresBatchTracking(e.target.checked)}
                      aria-label="Track batch number"
                    />
                    Track batch number
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                    <Checkbox
                      checked={formData.requiresSerialTracking}
                      disabled={!resolvedBehavior.trackingAllowed}
                      onChange={(e) => setRequiresSerialTracking(e.target.checked)}
                      aria-label="Track serial number"
                    />
                    Track serial number
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                    <Checkbox
                      checked={formData.hasExpiryDate}
                      disabled={!resolvedBehavior.trackingAllowed}
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
                    unitOptions={unitOptions}
                    emptyTitle="No variants yet"
                    emptyMessage="Add at least one row with a variant name (required). Variant code is built from the name unless you set a custom suffix in Details. HSN is optional. The first saved row is the default variant."
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
                {formData.variantRows.filter((r) => r.name.trim()).length}
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

      <ConfirmDialog
        isOpen={draftPromptOpen}
        title="Restore saved draft?"
        message="A previous product draft is available. Do you want to continue from that draft or start with a clean form?"
        confirmLabel="Restore draft"
        cancelLabel="Start fresh"
        variant="info"
        showVariantNotice={false}
        closeOnOverlayClick={false}
        closeOnEscape={false}
        showCloseButton={false}
        onConfirm={handleRestoreDraft}
        onCancel={handleStartFreshDraft}
      />

      <ProductVariantDetailsDrawer
        key={`pvd-${detailsDrawerRowIndex ?? 'x'}-${detailsDrawerOpen}`}
        isOpen={detailsDrawerOpen}
        onClose={closeDetailsDrawer}
        initialVariantRow={detailsDrawerVariantRow}
        productDefaultUnit={formData.unitOfMeasure}
        unitOptions={unitOptions}
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
