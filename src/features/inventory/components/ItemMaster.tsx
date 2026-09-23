/**
 * Item Master Component - Manage inventory items
 *
 * UI GOVERNANCE RULES:
 * - Maximum 3 sub-tabs in item details (FIXED - no additions allowed)
 * - Maximum 6 wizard steps
 * - Maximum 3 sub-views per tab
 * - No operational data (stock levels, pricing, suppliers)
 *
 * Before adding features, review: ITEM_MASTER_UI_GOVERNANCE.md
 * Developer checklist: ITEM_MASTER_DEVELOPER_CHECKLIST.md
 * Code review guide: CODE_REVIEW_GUIDELINES_ITEM_MASTER.md
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import ExcelJS from "exceljs";
import {
  inventoryService,
  InventoryItem,
  InventoryVariant,
  IndustryFlags,
  IndustryType,
  ItemType,
  ProductType,
  MovementType,
  SerialResponse,
  UpdateVariantRequest,
  CreateVariantRequest,
  VariantStockReport,
  CountType,
  CountStatus,
  type Location,
} from "@/services/inventory.service";
import { getDefaultReason, getMovementTypeLabel } from "../constants/movementReasonMapping";
import {
  Button,
  Input,
  Card,
  Select,
} from "@/shared/components/ui";
import { LoadingState, EmptyState } from "@/shared/components/data-display";
import { extractErrorMessage } from "@/utils/error";
import { movementTransactionIso } from "@/utils/commercialDates";
import { logger } from "@/shared/utils/logger";
import { ConfirmDialog, Modal } from "@/shared/components/modals";
import { ResizableSplitPane } from "@/shared/components/layout";
import { SerialGrid } from "./SerialGrid";
import { SerialDetailPanel } from "./SerialDetailPanel";
import { ProductCreationWizard } from "./ProductCreationWizard/ProductCreationWizard";
import { CATEGORY_OPTIONS } from "@/features/inventory/constants/productCatalog";
import {
  ItemSubTab,
  ITEM_MASTER_SUB_TAB_VALUES,
  validateSubViews,
} from "../constants/ui-governance.constants";
import type { WizardVariantRow } from "./ProductCreationWizard/variantGridModel";
import {
  ProductVariantDetailsDrawer,
  type ProductVariantDetailsDrawerApplyPayload,
} from "./ProductCreationWizard/productVariantDetails";
import { buildVariantUnitOptions } from "./ProductCreationWizard/variantGridUnits";
import { computeVariantSuffixForName } from "./ProductCreationWizard/variantSuffix";
import { EditMasterDrawer } from "./EditMasterDrawer";
import { resolveInventoryBehavior } from "../constants/productCatalog";
import { buildProductsWorkbook, downloadProductsWorkbook, isVariantSerialTracked } from "../utils/exportProductsExcel";
import {
  parseProductsWorkbook,
  buildImportPlan,
  type ProductImportResult,
} from "../utils/importProductsExcel";
import { parseStockReconcileWorkbook } from "../utils/buildCountFromExcel";
import { authStore } from "@/store/authStore";
import { UserRole } from "@/types";
import "./ItemMaster.css";
import "./ProductCreationWizard/ProductCreationWizard.css";

type ViewMode = "list" | "details" | "add";

/** Query keys that keep the item details split-view / deep link open — must be cleared when closing the panel or the URL will re-select the row. */
const ITEM_MASTER_SELECTION_SEARCH_KEYS = [
  "itemId",
  "variantId",
  "itemSubTab",
  "serialNumber",
  "edit",
] as const;

function stripItemMasterSelectionFromParams(
  prev: URLSearchParams,
): URLSearchParams {
  const p = new URLSearchParams(prev);
  for (const key of ITEM_MASTER_SELECTION_SEARCH_KEYS) {
    p.delete(key);
  }
  return p;
}

/** Runs `fn` over `items` with at most `concurrency` in flight at once, calling `onProgress` after
 * each one finishes (in completion order, not input order) — the throughput of Promise.all without
 * flooding the server with hundreds of simultaneous requests for a large catalog, and with real
 * per-item progress instead of an opaque wait. Order of `results` matches `items`. */
/** True for an axios request rejected by an AbortController (see handleRunReconcile's Stop
 * button) — every per-item try/catch in that flow must re-throw this specific case instead of
 * silently treating a deliberate stop as "this one item just failed, keep going", or Stop would
 * quietly do nothing while the run raced ahead on empty/default data instead of actually halting. */
function isAbortError(err: unknown): boolean {
  const e = err as { code?: string; name?: string } | null | undefined;
  return e?.code === "ERR_CANCELED" || e?.name === "CanceledError" || e?.name === "AbortError";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;
  const total = items.length;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
      completed += 1;
      onProgress?.(completed, total);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function rowIndustryType(item: InventoryItem): string {
  return (
    item.industryClassification?.industryType ??
    item.industryFlags?.industryType ??
    ""
  );
}

function rowSku(item: InventoryItem): string {
  return item.displaySku ?? item.sku ?? "—";
}

function detailIndustryFlags(item: InventoryItem): IndustryFlags {
  const ic = item.industryClassification;
  const base: IndustryFlags = item.industryFlags ?? {
    industryType: ic?.industryType ?? IndustryType.FMCG,
    isHighValue: ic?.isHighValue ?? false,
    isPerishable: false,
    requiresBatchTracking: false,
    requiresSerialTracking: false,
    serialOptional: false,
    hasExpiryDate: false,
  };
  // item.industryFlags.requires* is the product's own honest default now — the
  // `|| item.variantTracking?.*` fallback only matters for older items saved before that was
  // true, whose master flags may still read false while their real state lives on variants.
  return {
    ...base,
    requiresBatchTracking: Boolean(
      base.requiresBatchTracking || item.variantTracking?.batch,
    ),
    requiresSerialTracking: Boolean(
      base.requiresSerialTracking || item.variantTracking?.serial,
    ),
  };
}

type VariantStockRow = {
  variantId: string;
  totalOnHand: number;
  locations: Array<{
    locationId: string;
    locationCode: string;
    locationName: string;
    quantity: number;
  }>;
};

function pickDefaultVariantId(
  variantList: Array<{ id: string; isDefault?: boolean; isActive?: boolean }>,
): string | null {
  if (!variantList?.length) return null;
  const activeFirst = variantList.filter((v) => v.isActive !== false);
  const pool = activeFirst.length > 0 ? activeFirst : variantList;
  const def = pool.find((v) => v.isDefault);
  return def?.id ?? pool[0]?.id ?? null;
}

function variantIdsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return String(a) === String(b);
}

type BulkVariantEditContext = {
  item: InventoryItem;
  apiVariant: InventoryVariant;
  wizardRow: WizardVariantRow;
};

function inventoryVariantToWizardRow(v: InventoryVariant): WizardVariantRow {
  const supplierSku =
    typeof v.metadata?.supplierSku === "string"
      ? v.metadata.supplierSku
      : undefined;
  const images = v.images?.map(({ url, publicId, isPrimary }) => ({
    url,
    publicId,
    isPrimary,
  }));
  return {
    id: v.id,
    value: v.code,
    name: v.name,
    barcode: v.barcode,
    unitOfMeasure: v.unitOfMeasureOverride,
    ...(images?.length ? { images } : {}),
    ...(supplierSku ? { supplierSku } : {}),
    ...(v.hsn ? { hsn: v.hsn } : {}),
    ...(v.metadata && Object.keys(v.metadata).length > 0
      ? { metadata: { ...v.metadata } }
      : {}),
    costPriceOverride: v.costPriceOverride,
    sellingPriceOverride: v.sellingPriceOverride,
    mrpOverride: v.mrpOverride,
    taxOverride: v.taxOverride,
    reorderLevel: v.reorderLevel,
    minStock: v.minStock,
    maxStock: v.maxStock,
    allowBackorder: v.allowBackorder,
    trackSerialOverride: v.trackSerialOverride,
    trackBatchOverride: v.trackBatchOverride,
    serialOptionalOverride: v.serialOptionalOverride,
    isActive: v.isActive,
    isDiscontinued: v.isDiscontinued,
    serviceable: v.serviceable,
    weightOverride: v.weightOverride,
    dimensionsOverride: v.dimensionsOverride,
    packSize: v.packSize,
    unitsPerBox: v.unitsPerBox,
    shelfLifeDaysOverride: v.shelfLifeDaysOverride,
  };
}

function variantPatchToUpdateRequest(
  patch: ProductVariantDetailsDrawerApplyPayload["variantPatch"],
  existingMetadata: Record<string, unknown> | undefined,
): UpdateVariantRequest {
  const meta = {
    ...(existingMetadata && typeof existingMetadata === "object"
      ? (existingMetadata as Record<string, unknown>)
      : {}),
  } as Record<string, unknown>;
  if (patch.supplierSku !== undefined) {
    if (patch.supplierSku) meta.supplierSku = patch.supplierSku;
    else delete meta.supplierSku;
  }
  const out: UpdateVariantRequest = {
    name: patch.name,
    barcode: patch.barcode,
    hsn: patch.hsn,
    unitOfMeasureOverride: patch.unitOfMeasure,
    images: patch.images,
    costPriceOverride: patch.costPriceOverride,
    sellingPriceOverride: patch.sellingPriceOverride,
    mrpOverride: patch.mrpOverride,
    taxOverride: patch.taxOverride,
    reorderLevel: patch.reorderLevel,
    minStock: patch.minStock,
    maxStock: patch.maxStock,
    allowBackorder: patch.allowBackorder,
    trackSerialOverride: patch.trackSerialOverride,
    trackBatchOverride: patch.trackBatchOverride,
    serialOptionalOverride: patch.serialOptionalOverride,
    isActive: patch.isActive,
    isDiscontinued: patch.isDiscontinued,
    serviceable: patch.serviceable,
    weightOverride: patch.weightOverride,
    dimensionsOverride: patch.dimensionsOverride,
    packSize: patch.packSize,
    unitsPerBox: patch.unitsPerBox,
    shelfLifeDaysOverride: patch.shelfLifeDaysOverride,
  };
  if (Object.keys(meta).length > 0) out.metadata = meta;
  return out;
}

function inventoryVariantsToWizardRows(
  itemVariants: InventoryVariant[],
): WizardVariantRow[] {
  return itemVariants.map((v) => ({
    id: v.id,
    value: v.code || "",
    name: v.name || "",
    hsn: v.hsn,
    serviceable: v.serviceable,
  }));
}

function variantPatchToCreateRequest(
  itemId: string,
  patch: ProductVariantDetailsDrawerApplyPayload["variantPatch"],
  existingItemVariants: InventoryVariant[] = [],
): CreateVariantRequest {
  const name = (patch.name ?? "").trim();
  if (!name) {
    throw new Error("Variant name is required");
  }
  const explicitCode = (patch.value ?? "").trim().toUpperCase();
  const code =
    explicitCode ||
    computeVariantSuffixForName(name, inventoryVariantsToWizardRows(existingItemVariants));
  const meta: Record<string, unknown> = {};
  if (patch.supplierSku?.trim()) {
    meta.supplierSku = patch.supplierSku.trim();
  }
  return {
    itemId,
    code,
    name,
    barcode: patch.barcode?.trim() || undefined,
    hsn: patch.hsn?.trim() || undefined,
    unitOfMeasureOverride: patch.unitOfMeasure,
    metadata: Object.keys(meta).length > 0 ? meta : undefined,
    costPriceOverride: patch.costPriceOverride,
    sellingPriceOverride: patch.sellingPriceOverride,
    mrpOverride: patch.mrpOverride,
    taxOverride: patch.taxOverride,
    reorderLevel: patch.reorderLevel,
    minStock: patch.minStock,
    maxStock: patch.maxStock,
    allowBackorder: patch.allowBackorder,
    trackSerialOverride: patch.trackSerialOverride,
    trackBatchOverride: patch.trackBatchOverride,
    serialOptionalOverride: patch.serialOptionalOverride,
    isActive: patch.isActive ?? true,
    isDiscontinued: patch.isDiscontinued,
    serviceable: patch.serviceable,
    weightOverride: patch.weightOverride,
    dimensionsOverride: patch.dimensionsOverride,
    packSize: patch.packSize,
    unitsPerBox: patch.unitsPerBox,
    shelfLifeDaysOverride: patch.shelfLifeDaysOverride,
    images: patch.images?.map((i) => ({
      url: i.url,
      publicId: i.publicId,
      isPrimary: i.isPrimary,
    })),
  };
}

export const ItemMaster: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null,
  );
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);
  const [totalItems, setTotalItems] = useState(0);
  const [exportingProducts, setExportingProducts] = useState(false);
  const [importingProducts, setImportingProducts] = useState(false);
  const [importSummary, setImportSummary] = useState<ProductImportResult | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  // Reconcile stock/serials from an exported (and edited) .xlsx — see buildCountFromExcel.ts.
  // Two-step: pick a file, then pick which location the edited numbers apply to, before anything
  // is actually built — nothing is written until the user reviews the resulting Stock Count.
  const reconcileFileInputRef = useRef<HTMLInputElement | null>(null);
  const [reconcilePendingFile, setReconcilePendingFile] = useState<File | null>(null);
  const [reconcileLocations, setReconcileLocations] = useState<Location[]>([]);
  const [reconcileLocationId, setReconcileLocationId] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [reconcileProgress, setReconcileProgress] = useState<{ phase: string; current: number; total: number } | null>(null);
  // Every call in the reconcile flow now runs with no client-side timeout (see handleRunReconcile) —
  // this is the only way left for the user to actually get out of a run that's genuinely stuck
  // (dead connection, not just slow), rather than the modal being unresponsive until the app restarts.
  const reconcileAbortRef = useRef<AbortController | null>(null);
  // Reconcile now creates products and auto-approves stock/serial changes with no manual review
  // step — restricted to admins only, same bar as who can self-approve a Stock Count server-side.
  const isAdmin = authStore((s) => s.user)?.role === UserRole.ADMIN;
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropTargetItemId, setDropTargetItemId] = useState<string | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const listRowMenuRef = useRef<HTMLDivElement>(null);
  const [listRowMenu, setListRowMenu] = useState<
    | { kind: "item"; item: InventoryItem; x: number; y: number }
    | {
        kind: "variant";
        item: InventoryItem;
        variant: InventoryVariant;
        x: number;
        y: number;
      }
    | null
  >(null);

  const [editMasterDrawerOpen, setEditMasterDrawerOpen] = useState(false);
  const [editMasterDrawerItem, setEditMasterDrawerItem] = useState<InventoryItem | null>(null);
  const [variantDeleteTarget, setVariantDeleteTarget] = useState<{
    itemId: string;
    variantId: string;
    label: string;
  } | null>(null);
  const [itemSubTab, setItemSubTab] = useState<ItemSubTab>("stock");
  const [trackingSubView, setTrackingSubView] = useState<
    "batches" | "serials" | "expiry"
  >("batches");

  // Auto-set tracking sub-view when item changes
  useEffect(() => {
    if (selectedItem && itemSubTab === "tracking") {
      const f = detailIndustryFlags(selectedItem);
      if (f.requiresBatchTracking) {
        setTrackingSubView("batches");
      } else if (f.requiresSerialTracking) {
        setTrackingSubView("serials");
      } else if (f.hasExpiryDate) {
        setTrackingSubView("expiry");
      }
    }
  }, [selectedItem, itemSubTab]);
  const [stockData, setStockData] = useState<
    Array<{
      locationId: string;
      location: {
        id: string;
        code: string;
        name: string;
        type: string;
      };
      variantId?: string;
      batchNumber?: string;
      serialNumber?: string;
      onHandQuantity: number;
      reservedQuantity: number;
      blockedQuantity: number;
      damagedQuantity: number;
      availableQuantity: number;
      expiryDate?: string;
    }>
  >([]);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [historyFilters, setHistoryFilters] = useState({
    dateFrom: "",
    dateTo: "",
    movementType: "",
    locationId: "",
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<
    (() => void) | null
  >(null);
  const [variants, setVariants] = useState<any[]>([]);
  const [variantStockByItem, setVariantStockByItem] = useState<
    Record<string, VariantStockRow[]>
  >({});
  // Batch management state
  const [batches, setBatches] = useState<any[]>([]);
  const [_nearExpiryBatches, _setNearExpiryBatches] = useState<any[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchViewMode, setBatchViewMode] = useState<
    "list" | "create" | "fefo"
  >("list");
  const [batchForm, setBatchForm] = useState({
    batchNumber: "",
    manufacturingDate: new Date().toISOString().split("T")[0],
    expiryDate: "",
  });
  const [fefoForm, setFefoForm] = useState({
    locationId: "",
    quantity: 0,
  });
  const [fefoResult, setFefoResult] = useState<any[]>([]);
  const [showBatchDisposeDialog, setShowBatchDisposeDialog] = useState(false);
  const [batchToDispose, setBatchToDispose] = useState<{
    batchNumber: string;
    itemId: string;
  } | null>(null);
  const [disposeReason, setDisposeReason] = useState("");

  // Serial lookup state
  const [serials, setSerials] = useState<SerialResponse[]>([]);
  const [serialLoading, setSerialLoading] = useState(false);
  const [serialSortColumn, setSerialSortColumn] = useState<string | null>(null);
  const [serialSortDirection, setSerialSortDirection] = useState<
    "asc" | "desc"
  >("asc");
  const [serialFilters, setSerialFilters] = useState<{
    status?: string;
    locationId?: string;
  }>({});
  const [selectedSerialIds, setSelectedSerialIds] = useState<Set<string>>(
    new Set(),
  );

  // Expiry monitoring state
  const [expiryAlerts, setExpiryAlerts] = useState<any[]>([]);
  const [expiryDaysAhead, setExpiryDaysAhead] = useState(30);
  const [expiryLoading, setExpiryLoading] = useState(false);

  // Locations for batch operations
  const [locations, _setLocations] = useState<
    Array<{ id: string; code: string; name: string }>
  >([]);

  const [successTimeout, setSuccessTimeout] = useState<NodeJS.Timeout | null>(
    null,
  );

  const [bulkVariantEditContext, setBulkVariantEditContext] =
    useState<BulkVariantEditContext | null>(null);
  const [bulkVariantEditLoading, setBulkVariantEditLoading] = useState(false);
  const [addVariantContext, setAddVariantContext] = useState<{
    item: InventoryItem;
  } | null>(null);

  // Ref to track if we've processed the edit param
  const editParamProcessed = useRef(false);

  const categoryOptionLabel = useCallback((value: string) => {
    const o = CATEGORY_OPTIONS.find((x) => x.value === value);
    return o?.label ?? value;
  }, []);

  const variantDrawerUnitOptions = useMemo(() => {
    const item = addVariantContext?.item ?? bulkVariantEditContext?.item;
    if (!item) {
      return buildVariantUnitOptions({ baseUnit: "pcs" });
    }
    const uc = item.unitConfig;
    const base =
      (item.unitOfMeasure || uc?.baseUnit || "pcs").trim().toLowerCase() ||
      "pcs";
    return buildVariantUnitOptions({
      baseUnit: base,
      alternateUnits: uc?.alternateUnits?.map((u) => ({
        unitCode: u.unitCode,
        isActive: u.isActive,
      })),
    });
  }, [addVariantContext?.item, bulkVariantEditContext?.item]);

  /** When a variant is selected on a variant item, Stock + History use the same ledger slice (variantId must match). */
  const showVariantScopedStock = useMemo(() => {
    if (!selectedItem) return false;
    const itemVariants = variants.filter(
      (v: { itemId?: string }) => v.itemId === selectedItem.id,
    );
    return (
      !!selectedItem.hasVariants &&
      !!selectedVariantId &&
      itemVariants.some((v: { id: string }) => v.id === selectedVariantId)
    );
  }, [selectedItem, selectedVariantId, variants]);

  const scopedStockLedgerRows = useMemo(() => {
    if (!showVariantScopedStock) return stockData;
    return stockData.filter(
      (s) => s.variantId?.toString() === selectedVariantId,
    );
  }, [showVariantScopedStock, stockData, selectedVariantId]);

  const scopedMovementHistory = useMemo(() => {
    if (!showVariantScopedStock) return historyData;
    return historyData.filter(
      (m: { variantId?: string }) =>
        m.variantId != null &&
        String(m.variantId) === String(selectedVariantId),
    );
  }, [showVariantScopedStock, historyData, selectedVariantId]);

  // Ref to prevent duplicate loads for same itemId/subTab combination
  const lastLoadedRef = useRef<{
    itemId: string | null;
    subTab: ItemSubTab | null;
  }>({ itemId: null, subTab: null });
  const loadingStockRef = useRef(false);
  const loadingItemsRef = useRef(false);
  const lastItemsLoadRef = useRef<string>("");

  // Initial load on mount
  useEffect(() => {
    loadItems();

    // Cleanup success timeout on unmount
    return () => {
      if (successTimeout) {
        clearTimeout(successTimeout);
      }
    };
  }, []); // Only run on mount

  // Handle edit param from URL - check after items are loaded
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (editId && !editParamProcessed.current && items.length > 0) {
      const itemToEdit = items.find((i) => i.id === editId);
      if (itemToEdit) {
        editParamProcessed.current = true;
        setSelectedItemId(editId);
        setViewMode("details");
        setItemSubTab("stock");
        setSearchParams({}, { replace: true });
      }
    }

    // Reset the ref when searchParams change (new edit param)
    if (!searchParams.get("edit")) {
      editParamProcessed.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString(), items.length]); // Only check when searchParams or items length changes

  // Handle itemId, variantId, and itemSubTab from URL for deep linking
  useEffect(() => {
    const itemId = searchParams.get("itemId");
    const variantId = searchParams.get("variantId");
    const subTabParam = searchParams.get("itemSubTab");

    if (itemId) {
      // Do not clobber the add-product wizard if the URL still has itemId (e.g. Ctrl+N after a stale link).
      if (viewMode === "add") {
        return;
      }
      // Always set view mode to details and selectedItemId when itemId is in URL
      // This ensures deep linking works correctly even if items haven't loaded yet
      setSelectedItemId(itemId);
      setViewMode("details");

      // Check for serialNumber param - if present, switch to tracking tab
      const serialNumber = searchParams.get("serialNumber");
      if (serialNumber) {
        setItemSubTab("tracking");
        setTrackingSubView("serials");
      } else {
        // Set sub-tab and variant ID (legacy `overview` URLs open Stock)
        const normalizedSubTab: ItemSubTab | null =
          subTabParam === "overview" ||
          subTabParam === "variants" ||
          subTabParam === "edit"
            ? "stock"
            : subTabParam &&
                ITEM_MASTER_SUB_TAB_VALUES.includes(subTabParam as ItemSubTab)
              ? (subTabParam as ItemSubTab)
              : null;

        if (normalizedSubTab) {
          setItemSubTab(normalizedSubTab);
        } else {
          setItemSubTab("stock");
        }
      }

      setSelectedVariantId(variantId || null);
    } else {
      // If no itemId in URL, clear selection and return to list view
      setSelectedItemId(null);
      // Keep create-wizard mode stable when opened via ?addProduct=1.
      if (viewMode !== "add") {
        setViewMode("list");
      }
      // Still apply itemSubTab from URL so deep links open with the correct sub-tab
      if (
        subTabParam === "overview" ||
        subTabParam === "variants" ||
        subTabParam === "edit"
      ) {
        setItemSubTab("stock");
      } else if (
        subTabParam &&
        ITEM_MASTER_SUB_TAB_VALUES.includes(subTabParam as ItemSubTab)
      ) {
        setItemSubTab(subTabParam as ItemSubTab);
      }
    }
  }, [searchParams, viewMode]);

  /** Deep links (global search, shared URLs): expand the master row accordion once the item is loaded. */
  useEffect(() => {
    const urlItemId = searchParams.get("itemId");
    if (!urlItemId || viewMode !== "details") return;
    if (!selectedItem || selectedItem.id !== urlItemId || !selectedItem.hasVariants) return;
    setExpandedRows(new Set([urlItemId]));
    // Note: selectedItem is checked but not in deps to avoid loops when object reference changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, viewMode, selectedItem?.id, selectedItem?.hasVariants]);

  // Resolve selected variant from URL / defaults when item variants load; keep URL in sync on Stock tab
  useEffect(() => {
    if (searchParams.get("serialNumber")) return;
    if (!selectedItemId || !selectedItem) return;
    // The URL-read effect (above) hasn't caught selectedItemId up to a fresh URL navigation
    // yet (e.g. Global Search selecting a different item) — operating on selectedItemId here
    // would read/write against the WRONG item and fight that effect for the itemId param,
    // causing an infinite URL ping-pong ("Maximum update depth exceeded").
    if (searchParams.get("itemId") !== selectedItemId) return;

    if (!selectedItem.hasVariants) {
      if (selectedVariantId !== null) {
        setSelectedVariantId(null);
      }
      if (searchParams.get("variantId")) {
        setSearchParams((prev) => {
          const p = new URLSearchParams(prev);
          p.delete("variantId");
          return p;
        }, { replace: true });
      }
      return;
    }

    const itemVariants = variants.filter(
      (v: { itemId?: string }) => String(v.itemId) === String(selectedItemId),
    );

    const urlVariant = searchParams.get("variantId")?.trim() || null;
    let nextId: string | null = null;

    if (urlVariant) {
      const urlMatch = itemVariants.find((v: { id: string }) =>
        variantIdsEqual(v.id, urlVariant),
      );
      if (urlMatch) {
        nextId = urlMatch.id;
      } else if (itemVariants.length === 0) {
        // Variants still loading — honor URL (global search / deep link), don't fall back to prior selection
        if (!variantIdsEqual(selectedVariantId, urlVariant)) {
          setSelectedVariantId(urlVariant);
        }
        return;
      } else {
        // Stale or unknown variant in URL
        nextId = pickDefaultVariantId(itemVariants);
      }
    } else if (itemVariants.length > 0) {
      nextId =
        selectedVariantId &&
        itemVariants.some((v: { id: string }) => variantIdsEqual(v.id, selectedVariantId))
          ? selectedVariantId
          : pickDefaultVariantId(itemVariants);
    }

    if (nextId && !variantIdsEqual(nextId, selectedVariantId)) {
      setSelectedVariantId(nextId);
    }

    if (viewMode !== "details" || !nextId) return;

    if (itemSubTab === "stock") {
      const urlV = searchParams.get("variantId");
      if (!variantIdsEqual(urlV, nextId)) {
        setSearchParams(
          (prev) => {
            // Do not touch "itemId" here — it's already confirmed in sync with selectedItemId
            // by the guard above; writing it from state was the source of the URL ping-pong.
            const p = new URLSearchParams(prev);
            p.set("variantId", nextId!);
            return p;
          },
          { replace: true },
        );
      }
    }
  }, [
    searchParams,
    selectedItemId,
    selectedItem?.hasVariants,
    selectedItem?.id,
    variants,
    selectedVariantId,
    itemSubTab,
    viewMode,
    setSearchParams,
  ]);

  // Open add-product flow from Inventory page tabs (?addProduct=1)
  useEffect(() => {
    if (searchParams.get("addProduct") !== "1") return;
    setViewMode("add");
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("addProduct");
        return p;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  const closeItemDetailsPanel = useCallback(() => {
    setSelectedItemId(null);
    setSelectedVariantId(null);
    setViewMode("list");
    setSearchParams(
      (prev) => stripItemMasterSelectionFromParams(prev),
      { replace: true },
    );
  }, [setSearchParams]);

  // Keyboard shortcuts and navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputField =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT";
      const isContentEditable = target.isContentEditable;

      // Don't trigger global shortcuts when typing in inputs/textarea
      if (isInputField || isContentEditable) {
        return;
      }

      // Ctrl/Cmd + N: New item (only in list view)
      if ((e.ctrlKey || e.metaKey) && e.key === "n" && viewMode === "list") {
        e.preventDefault();
        setViewMode("add");
      }

      if (e.key === "Escape") {
        if (viewMode === "add") {
          if (hasUnsavedChanges) {
            setPendingNavigation(() => () => {
              setViewMode("list");
              setSearchParams(
                (prev) => stripItemMasterSelectionFromParams(prev),
                { replace: true },
              );
            });
            setShowUnsavedDialog(true);
          } else {
            setViewMode("list");
            setSearchParams(
              (prev) => stripItemMasterSelectionFromParams(prev),
              { replace: true },
            );
          }
        } else if (viewMode === "details" && selectedItemId) {
          closeItemDetailsPanel();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    viewMode,
    selectedItemId,
    hasUnsavedChanges,
    closeItemDetailsPanel,
    setSearchParams,
  ]);

  // Define loadItems before useEffect that uses it
  const loadItems = useCallback(async () => {
    if (loadingItemsRef.current) return; // Prevent concurrent calls
    loadingItemsRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const sortBy =
        sortColumn === "name"
          ? "name"
          : sortColumn === "category"
            ? "category"
            : sortColumn === "unit"
              ? "unit"
              : sortColumn === "industry"
                ? "industry"
                : "createdAt";
      const result = await inventoryService.getItemsPage({
        page: currentPage,
        limit: itemsPerPage,
        sortBy,
        sortDir: sortDirection,
      });
      setItems(result.items);
      setTotalItems(result.total);
    } catch (err: any) {
      const message = extractErrorMessage(err, "Failed to load items");
      setError(message);
      logger.error("[ItemMaster] Failed to load items", err);
    } finally {
      setLoading(false);
      loadingItemsRef.current = false;
    }
  }, [sortColumn, sortDirection, currentPage, itemsPerPage]);

  const handleExportProducts = useCallback(async () => {
    setExportingProducts(true);
    setError(null);
    try {
      const allItems = await inventoryService.getAllItems();
      const variantsByItemId = new Map<string, InventoryVariant[]>();
      // Sequential, not Promise.all — a few hundred products means a few hundred requests;
      // running them all at once would hammer the API and risk rate-limiting mid-export.
      for (const item of allItems) {
        try {
          const itemVariants = await inventoryService.getVariantsByItem(item.id, true);
          variantsByItemId.set(item.id, itemVariants);
        } catch {
          variantsByItemId.set(item.id, []);
        }
      }

      // One call covers stock for every variant company-wide — unlike variants above, there's no
      // per-item report to loop.
      let variantStockByVariantId = new Map<string, VariantStockReport>();
      try {
        const stockReport = await inventoryService.getVariantStockReport();
        variantStockByVariantId = new Map(stockReport.map((r) => [r.variantId, r]));
      } catch {
        // Export still proceeds without stock figures rather than failing the whole thing.
      }

      // Serials are still fetched per item (no bulk endpoint), but only for items that actually
      // have a serial-tracked variant — most of the catalog never touches this loop at all.
      const serialsByItemId = new Map<string, SerialResponse[]>();
      for (const item of allItems) {
        const itemVariants = variantsByItemId.get(item.id) ?? [];
        const hasSerialTrackedVariant = itemVariants.some((v) => isVariantSerialTracked(item, v));
        if (!hasSerialTrackedVariant) continue;
        try {
          const all: SerialResponse[] = [];
          let page = 1;
          // The server caps `limit` at 500 regardless of what's requested — loop pages so an
          // item with more serials than that still gets every one of them, not just the first 500.
          for (;;) {
            const batch = await inventoryService.getSerialsByItem(item.id, undefined, undefined, undefined, page, 500);
            all.push(...batch);
            if (batch.length < 500) break;
            page += 1;
          }
          serialsByItemId.set(item.id, all);
        } catch {
          serialsByItemId.set(item.id, []);
        }
      }

      const workbook = await buildProductsWorkbook(allItems, variantsByItemId, variantStockByVariantId, serialsByItemId);
      await downloadProductsWorkbook(workbook);
      const totalSerials = Array.from(serialsByItemId.values()).reduce((n, s) => n + s.length, 0);
      setSuccess(
        `Exported ${allItems.length} products (${Array.from(variantsByItemId.values()).reduce((n, v) => n + v.length, 0)} variants, ${totalSerials} serial numbers).`,
      );
    } catch (err: any) {
      setError(extractErrorMessage(err, "Failed to export products"));
      logger.error("[ItemMaster] Failed to export products", err);
    } finally {
      setExportingProducts(false);
    }
  }, []);

  const handleImportFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-selecting the same file later
      if (!file) return;

      setImportingProducts(true);
      setError(null);
      setImportSummary(null);
      try {
        const buffer = await file.arrayBuffer();
        const parsed = await parseProductsWorkbook(buffer);

        const allItems = await inventoryService.getAllItems();
        const existingVariantsByItemId = new Map<string, InventoryVariant[]>();
        for (const item of allItems) {
          const itemVariants = await inventoryService.getVariantsByItem(item.id, true).catch(() => []);
          existingVariantsByItemId.set(item.id, itemVariants);
        }

        const { plans, errors: planErrors } = buildImportPlan(parsed, allItems, existingVariantsByItemId);

        const result: ProductImportResult = {
          productsCreated: 0,
          productsUpdated: 0,
          variantsCreated: 0,
          variantsUpdated: 0,
          errors: [...planErrors],
        };

        for (const plan of plans) {
          try {
            if (plan.action === "create") {
              await inventoryService.createItem(plan.request);
              result.productsCreated += 1;
              result.variantsCreated += plan.request.variants.length;
              continue;
            }

            await inventoryService.updateItem(plan.itemId, plan.itemUpdate);
            result.productsUpdated += 1;
            for (const vu of plan.variantUpdates) {
              try {
                await inventoryService.updateVariant(vu.variantId, vu.update);
                result.variantsUpdated += 1;
              } catch (err: any) {
                result.errors.push({
                  row: plan.row,
                  productName: plan.productName,
                  message: `Variant "${vu.sku}": ${extractErrorMessage(err, "Failed to update variant")}`,
                });
              }
            }
            for (const vc of plan.variantCreates) {
              try {
                await inventoryService.createVariant(vc.request);
                result.variantsCreated += 1;
              } catch (err: any) {
                result.errors.push({
                  row: plan.row,
                  productName: plan.productName,
                  message: `Variant "${vc.sku}": ${extractErrorMessage(err, "Failed to add variant")}`,
                });
              }
            }
          } catch (err: any) {
            result.errors.push({
              row: plan.row,
              productName: plan.productName,
              message: extractErrorMessage(err, plan.action === "create" ? "Failed to create product" : "Failed to update product"),
            });
          }
        }

        setImportSummary(result);
        const totalTouched = result.productsCreated + result.productsUpdated;
        if (totalTouched > 0) {
          setSuccess(
            `${result.productsCreated} product${result.productsCreated === 1 ? "" : "s"} created, ` +
              `${result.productsUpdated} updated ` +
              `(${result.variantsCreated} variant${result.variantsCreated === 1 ? "" : "s"} added, ${result.variantsUpdated} updated)` +
              (result.errors.length > 0 ? ` — ${result.errors.length} row(s) had issues, see details below.` : "."),
          );
        } else if (result.errors.length > 0) {
          setError(`No products imported — ${result.errors.length} row(s) had errors, see details below.`);
        }
        await loadItems();
      } catch (err: any) {
        setError(extractErrorMessage(err, "Failed to read/import file"));
        logger.error("[ItemMaster] Failed to import products", err);
      } finally {
        setImportingProducts(false);
      }
    },
    [loadItems],
  );

  // ── Reconcile stock/serials from file ──────────────────────────────────────────────
  // Step 1: pick the file, then fetch locations so the modal below can ask which one the edited
  // numbers apply to (the exported "Stock (On Hand)" is a company-wide total — see
  // buildCountFromExcel.ts for why this can't be inferred).
  const handleReconcileFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReconcilePendingFile(file);
    setReconcileLocationId("");
    try {
      const locs = await inventoryService.getAllLocations();
      setReconcileLocations(locs);
    } catch {
      setReconcileLocations([]);
    }
  }, []);

  // Step 2: location confirmed — resolve the file's SKUs against the live catalog (only items the
  // file actually mentions), pull each one's current on-hand at the chosen location plus its
  // existing serials, then build a draft Stock Count with the differences. Nothing is applied to
  // real stock here — the count still needs the normal Submit → Approve review.
  const handleRunReconcile = useCallback(async () => {
    if (!reconcilePendingFile || !reconcileLocationId) return;
    setReconciling(true);
    setError(null);
    setSuccess(null);
    setReconcileProgress({ phase: "Loading catalog", current: 0, total: 1 });
    const controller = new AbortController();
    reconcileAbortRef.current = controller;
    const signal = controller.signal;
    try {
      const buffer = await reconcilePendingFile.arrayBuffer();

      const skusInFile = new Set<string>();
      const preloadWb = new ExcelJS.Workbook();
      await preloadWb.xlsx.load(buffer);
      for (const sheetName of ["Variants", "Serial Numbers"]) {
        const sheet = preloadWb.getWorksheet(sheetName);
        if (!sheet) continue;
        const headerRow = sheet.getRow(1);
        let skuCol = -1;
        headerRow.eachCell((cell, colNumber) => {
          if (String(cell.value ?? "").trim() === "Variant SKU") skuCol = colNumber;
        });
        if (skuCol === -1) continue;
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const sku = String(row.getCell(skuCol).value ?? "").trim().toUpperCase();
          if (sku && sku !== "(NO VARIANTS)") skusInFile.add(sku);
        });
      }

      if (skusInFile.size === 0) {
        setError("No Variant SKU rows with Stock or Serial Number data found in this file.");
        return;
      }

      // ── PHASE A — validate everything, write nothing ──────────────────────────────
      // Every check below runs against reads/parsed data only. Nothing is created, converted,
      // counted, submitted, or approved until every row in the file passes — a partial failure
      // used to leave newly-created products behind with no stock applied; this can't happen
      // anymore because no writes happen until the whole file is known-good.

      // Resolve those SKUs against the live catalog. A large catalog's own load easily clears the
      // API client's default 30s timeout on this one bulk call, so it gets a generous override
      // here — the progress bar below is what makes that wait tolerable, not a shorter deadline.
      const allItems = await inventoryService.getAllItems(undefined, { timeout: 0, signal });

      const skuToItemVariant = new Map<string, { item: InventoryItem; variant: InventoryVariant }>();
      const relevantItemIds = new Set<string>();
      const nonStockMatches = new Map<string, { item: InventoryItem; variants: Map<string, InventoryVariant> }>(); // itemId -> item + its matched SKU->variant
      const convertedItemIds = new Set<string>();
      const matchedSkus = new Set<string>(); // every SKU found on SOME existing item, stock-managed or not
      const existingVariantsByItemId = new Map<string, InventoryVariant[]>(); // reused below to create brand-new products safely

      // A Stock Count only ever exists for physical, stock-managed inventory — a matching SKU
      // whose master item is currently marked service/non-stock (Service Charge, MISC_NON_STOCK,
      // ASSET, ...) is set aside for a convert-and-include prompt rather than sent to the server.
      // Up to 8 items' variants are fetched at once — real throughput on a large catalog instead
      // of one slow round trip after another — with the progress bar tracking real completions.
      setReconcileProgress({ phase: "Matching products against catalog", current: 0, total: allItems.length });
      await mapWithConcurrency(
        allItems,
        8,
        async (item) => {
          const stockManaged = resolveInventoryBehavior({
            productType: item.productType,
            isMisc: item.isMisc,
            itemType: item.itemType,
          }).stockManaged;
          const itemVariants = await inventoryService
            .getVariantsByItem(item.id, true, { timeout: 0, signal })
            .catch((err) => {
              if (isAbortError(err)) throw err;
              return [];
            });
          existingVariantsByItemId.set(item.id, itemVariants);
          for (const v of itemVariants) {
            const sku = (v.code || v.sku || "").trim().toUpperCase();
            if (!sku || !skusInFile.has(sku)) continue;
            matchedSkus.add(sku);
            if (!stockManaged) {
              const entry = nonStockMatches.get(item.id) ?? { item, variants: new Map<string, InventoryVariant>() };
              entry.variants.set(sku, v);
              nonStockMatches.set(item.id, entry);
              continue;
            }
            skuToItemVariant.set(sku, { item, variant: v });
            relevantItemIds.add(item.id);
          }
        },
        (completed, total) => setReconcileProgress({ phase: "Matching products against catalog", current: completed, total }),
      );

      // Any SKU that matched nothing above — not even a non-stock item — has no product in the
      // catalog at all. Read this same file's "Products" sheet (it's the same export re-uploaded,
      // so the full product master data is right there) and resolve a create-plan for these —
      // exactly what "Upload products" already does for a brand-new row — WITHOUT creating
      // anything yet; that only happens once every row in the file has passed validation.
      const unmatchedSkus = new Set(Array.from(skusInFile).filter((sku) => !matchedSkus.has(sku)));
      type CreatePlan = Extract<Awaited<ReturnType<typeof buildImportPlan>>["plans"][number], { action: "create" }>;
      let createPlans: CreatePlan[] = [];
      const blockingErrors: Array<{ row: number; product: string; sku: string; message: string }> = [];
      if (unmatchedSkus.size > 0 && preloadWb.getWorksheet("Products") && preloadWb.getWorksheet("Variants")) {
        const parsedProducts = await parseProductsWorkbook(buffer);
        for (const e of parsedProducts.errors) {
          blockingErrors.push({ row: e.row, product: e.productName || "(unknown product)", sku: "", message: e.message });
        }
        const { plans: importPlans, errors: planErrors } = buildImportPlan(parsedProducts, allItems, existingVariantsByItemId);
        for (const e of planErrors) {
          blockingErrors.push({ row: e.row, product: e.productName, sku: "", message: e.message });
        }
        createPlans = importPlans.filter(
          (p): p is CreatePlan =>
            p.action === "create" && p.request.variants.some((v) => unmatchedSkus.has(v.sku.trim().toUpperCase())),
        );
      }

      // Per-SKU tracking metadata, gathered from wherever the SKU actually lives (an existing
      // stock-managed item, an existing non-stock item awaiting the convert prompt, or a brand-new
      // product not yet created) — used below to check the file's numbers BEFORE anything is sent
      // to the server, instead of finding out only when Submit rejects it.
      const skuMeta = new Map<
        string,
        { productName: string; isSerialTracked: boolean; isSerialOptional: boolean; isBatchTracked: boolean }
      >();
      for (const [sku, pair] of skuToItemVariant) {
        skuMeta.set(sku, {
          productName: pair.item.name,
          isSerialTracked: isVariantSerialTracked(pair.item, pair.variant),
          isSerialOptional: pair.variant.serialOptionalOverride ?? pair.item.industryFlags?.serialOptional ?? false,
          isBatchTracked: pair.variant.trackBatchOverride ?? pair.item.industryFlags?.requiresBatchTracking ?? false,
        });
      }
      for (const { item, variants } of nonStockMatches.values()) {
        for (const [sku, v] of variants) {
          skuMeta.set(sku, {
            productName: item.name,
            isSerialTracked: isVariantSerialTracked(item, v),
            isSerialOptional: v.serialOptionalOverride ?? item.industryFlags?.serialOptional ?? false,
            isBatchTracked: v.trackBatchOverride ?? item.industryFlags?.requiresBatchTracking ?? false,
          });
        }
      }
      for (const plan of createPlans) {
        for (const v of plan.request.variants) {
          const sku = v.sku.trim().toUpperCase();
          if (!unmatchedSkus.has(sku)) continue;
          skuMeta.set(sku, {
            productName: plan.productName,
            isSerialTracked: v.trackSerialOverride ?? plan.request.industryFlags?.requiresSerialTracking ?? false,
            isSerialOptional: v.serialOptionalOverride ?? plan.request.industryFlags?.serialOptional ?? false,
            isBatchTracked: v.trackBatchOverride ?? plan.request.industryFlags?.requiresBatchTracking ?? false,
          });
        }
      }

      // Current on-hand at the chosen location, and existing serials — for every SKU that already
      // has a real item (stock-managed or not), so a small edited file stays cheap regardless of
      // total catalog size. Brand-new SKUs have no entry here on purpose — parseStockReconcileWorkbook
      // and the validation below both treat "no current quantity known" as "starts at zero".
      const existingItemIdsToCheck = Array.from(new Set<string>([...relevantItemIds, ...nonStockMatches.keys()]));
      const currentQtyBySku = new Map<string, number>();
      const existingSerials = new Set<string>();
      if (existingItemIdsToCheck.length > 0) {
        // One company-wide report (same call handleExportProducts already uses) instead of one
        // request per item — this is what was actually timing out before: getVariantStock(itemId)
        // had no timeout override at all, so any single slow call died at the API client's 30s
        // default. A single bulk call removes that failure mode entirely rather than just widening it.
        setReconcileProgress({ phase: "Fetching current stock levels", current: 0, total: 1 });
        try {
          const stockReport = await inventoryService.getVariantStockReport({ timeout: 0, signal });
          const stockByVariantId = new Map(stockReport.map((r) => [r.variantId, r]));
          for (const itemId of existingItemIdsToCheck) {
            const pairsForItem = [
              ...Array.from(skuToItemVariant.entries()).filter(([, p]) => p.item.id === itemId),
              ...Array.from(nonStockMatches.get(itemId)?.variants.entries() ?? []).map(
                ([sku, variant]) => [sku, { item: nonStockMatches.get(itemId)!.item, variant }] as const,
              ),
            ];
            for (const [sku, pair] of pairsForItem) {
              const row = stockByVariantId.get(pair.variant.id);
              const atLocation = row?.locations.find((l) => l.locationId === reconcileLocationId);
              currentQtyBySku.set(sku, atLocation?.quantity ?? 0);
            }
          }
        } catch (err) {
          if (isAbortError(err)) throw err;
          // Leave unset — treated as "starts at zero" below, same as a brand-new SKU.
        }
        setReconcileProgress({ phase: "Fetching current stock levels", current: 1, total: 1 });

        // No bulk equivalent exists for serials yet, so this still goes item by item — but with an
        // unbounded timeout (the file's still being validated, nothing has been written yet) and
        // 8-way concurrency, so one slow item can't kill the whole run and a small matched set
        // finishes in one round rather than N sequential ones.
        setReconcileProgress({ phase: "Fetching existing serial numbers", current: 0, total: existingItemIdsToCheck.length });
        await mapWithConcurrency(
          existingItemIdsToCheck,
          8,
          async (itemId) => {
            try {
              const all: SerialResponse[] = [];
              let page = 1;
              for (;;) {
                const batch = await inventoryService.getSerialsByItem(itemId, undefined, undefined, undefined, page, 500, { timeout: 0, signal });
                all.push(...batch);
                if (batch.length < 500) break;
                page += 1;
              }
              all.forEach((s) => existingSerials.add(s.serialNumber.toUpperCase()));
            } catch (err) {
              if (isAbortError(err)) throw err;
              // Worst case a genuinely-existing serial gets treated as "new" and validation below
              // (or the server) surfaces the real conflict — never silently dropped.
            }
          },
          (completed, total) => setReconcileProgress({ phase: "Fetching existing serial numbers", current: completed, total }),
        );
      }

      const { lines } = await parseStockReconcileWorkbook(
        buffer,
        (sku) => currentQtyBySku.get(sku.toUpperCase()),
        existingSerials,
      );

      if (lines.length === 0) {
        setSuccess("No stock or serial number changes found in this file — nothing to reconcile.");
        return;
      }

      // Validate every line against the tracking rules its product actually has — a serial-tracked
      // item needs exactly one serial per unit of increase, a batch-tracked item can't be adjusted
      // by this tool at all, negative stock is never valid — so a bad row is caught here, with its
      // exact row/product/SKU, instead of failing the whole Submit with a bare line number.
      for (const l of lines) {
        const skuUpper = l.sku.toUpperCase();
        const meta = skuMeta.get(skuUpper);
        if (!meta) {
          blockingErrors.push({
            row: l.row,
            product: l.productName || "(unknown product)",
            sku: l.sku,
            message: 'No matching product in the catalog, and no row for it on this file\'s "Products" sheet to create one from.',
          });
          continue;
        }
        const currentQty = currentQtyBySku.get(skuUpper) ?? 0;
        const physicalQty = l.physicalQuantity ?? currentQty;
        const variance = physicalQty - currentQty;
        if (physicalQty < 0) {
          blockingErrors.push({ row: l.row, product: meta.productName, sku: l.sku, message: `Stock (On Hand) cannot be negative (got ${physicalQty}).` });
          continue;
        }
        if (variance !== 0 && meta.isBatchTracked) {
          blockingErrors.push({
            row: l.row,
            product: meta.productName,
            sku: l.sku,
            message: 'This product is batch-tracked — this tool can\'t record a batch number, so its stock can\'t be changed here. Adjust it manually via Inventory → Stock Counts.',
          });
          continue;
        }
        if (meta.isSerialTracked && !meta.isSerialOptional) {
          if (variance < 0) {
            blockingErrors.push({
              row: l.row,
              product: meta.productName,
              sku: l.sku,
              message: `Serial-tracked and decreasing by ${Math.abs(variance)} — this tool can only add new serial numbers, not remove specific ones. Adjust it manually via Inventory → Stock Counts.`,
            });
            continue;
          }
          const required = Math.abs(variance);
          if (l.newSerialNumbers.length !== required) {
            blockingErrors.push({
              row: l.row,
              product: meta.productName,
              sku: l.sku,
              message: `Needs exactly ${required} serial number(s) for a stock change of +${variance}, but ${l.newSerialNumbers.length} were listed in "Serial Numbers".`,
            });
            continue;
          }
        } else if (meta.isSerialTracked && meta.isSerialOptional) {
          const cap = Math.abs(variance);
          if (l.newSerialNumbers.length > cap) {
            blockingErrors.push({
              row: l.row,
              product: meta.productName,
              sku: l.sku,
              message: `Lists ${l.newSerialNumbers.length} serial number(s), more than the stock change of ${variance} allows.`,
            });
            continue;
          }
        }
        const dedupedSerials = new Set(l.newSerialNumbers.map((s) => s.toUpperCase()));
        if (dedupedSerials.size !== l.newSerialNumbers.length) {
          blockingErrors.push({ row: l.row, product: meta.productName, sku: l.sku, message: "Duplicate serial numbers listed for this SKU." });
        }
      }

      if (blockingErrors.length > 0) {
        const sorted = [...blockingErrors].sort((a, b) => a.row - b.row);
        const report = sorted.map((e) => `Row ${e.row} — ${e.product}${e.sku ? ` (${e.sku})` : ""}: ${e.message}`).join("\n");
        setError(`${sorted.length} issue(s) found in this file — fix these and re-upload. Nothing was changed.\n${report}`);
        return;
      }

      // ── PHASE B — every row passed; now actually write ────────────────────────────

      // Rather than silently skip a non-stock match (or hard-fail), ask once — the user may have
      // just meant that item to be real stock all along and never noticed the master item was
      // still flagged Non-Stock/Misc. A "yes" fixes the master item's classification right here
      // and folds its variants into this same reconciliation; a "no" proceeds without them.
      if (nonStockMatches.size > 0) {
        const itemNames = Array.from(nonStockMatches.values()).map((e) => e.item.name).join(", ");
        const wantsConvert = window.confirm(
          `${nonStockMatches.size} matching item(s) are currently marked Non-Stock/Service, so they can't carry a physical Stock Count: ${itemNames}.\n\n` +
            `Convert them to regular stock-managed items now and include them in this reconciliation?`,
        );
        if (wantsConvert) {
          const toConvert = Array.from(nonStockMatches.values());
          setReconcileProgress({ phase: "Converting non-stock items", current: 0, total: toConvert.length });
          for (let ci = 0; ci < toConvert.length; ci++) {
            const { item } = toConvert[ci];
            setReconcileProgress({ phase: "Converting non-stock items", current: ci + 1, total: toConvert.length });
            try {
              await inventoryService.updateItem(
                item.id,
                { productType: ProductType.STOCK_ITEM, itemType: ItemType.STOCK, isMisc: false },
                { timeout: 0, signal },
              );
            } catch (err: any) {
              if (isAbortError(err)) throw err;
              setError((prev) => {
                const line = `Could not convert "${item.name}" to stock-managed: ${extractErrorMessage(err, "unknown error")}`;
                return prev ? `${prev}\n${line}` : line;
              });
              continue;
            }
            convertedItemIds.add(item.id);
            const itemVariants = await inventoryService
              .getVariantsByItem(item.id, true, { timeout: 0, signal })
              .catch((err) => {
                if (isAbortError(err)) throw err;
                return [];
              });
            for (const v of itemVariants) {
              const sku = (v.code || v.sku || "").trim().toUpperCase();
              if (sku && skusInFile.has(sku)) {
                skuToItemVariant.set(sku, { item, variant: v });
                relevantItemIds.add(item.id);
              }
            }
          }
        }
      }

      const stillNonStock = Array.from(nonStockMatches.values()).filter((e) => !convertedItemIds.has(e.item.id));

      const createdProductNames: string[] = [];
      const failedToCreateSkus: string[] = [];
      if (createPlans.length > 0) {
        setReconcileProgress({ phase: "Creating new products", current: 0, total: createPlans.length });
      }
      for (let pi = 0; pi < createPlans.length; pi++) {
        const plan = createPlans[pi];
        setReconcileProgress({ phase: "Creating new products", current: pi + 1, total: createPlans.length });
        let created: InventoryItem;
        try {
          created = await inventoryService.createItem(plan.request, { timeout: 0, signal });
        } catch (err: any) {
          if (isAbortError(err)) throw err;
          for (const v of plan.request.variants) failedToCreateSkus.push(v.sku);
          setError((prev) => {
            const line = `Could not create "${plan.productName}": ${extractErrorMessage(err, "unknown error")}`;
            return prev ? `${prev}\n${line}` : line;
          });
          continue;
        }
        createdProductNames.push(plan.productName);
        const newVariants = await inventoryService
          .getVariantsByItem(created.id, true, { timeout: 0, signal })
          .catch((err) => {
            if (isAbortError(err)) throw err;
            return [];
          });
        for (const v of newVariants) {
          const sku = (v.code || v.sku || "").trim().toUpperCase();
          if (sku && unmatchedSkus.has(sku)) {
            skuToItemVariant.set(sku, { item: created, variant: v });
            relevantItemIds.add(created.id);
          }
        }
      }

      // Lines whose item ended up excluded after all (a decline on the convert prompt, or a
      // creation that failed against the live server despite passing file-level validation) are
      // dropped here rather than sent — everything else validated clean, so this is the one place
      // a live write can still fall short of what the file asked for.
      const finalLines = lines.filter((l) => skuToItemVariant.has(l.sku.toUpperCase()));

      if (finalLines.length === 0) {
        const reason =
          stillNonStock.length > 0
            ? `${stillNonStock.length} matching item(s) are service/non-stock, which don't carry a physical stock count — ${stillNonStock.map((e) => e.item.name).join(", ")}.`
            : failedToCreateSkus.length > 0
              ? `Could not create the product(s) for ${failedToCreateSkus.length} unmatched SKU(s) — see error(s) above.`
              : "None of this file's SKUs match a product in the catalog.";
        setError((prev) => (prev ? `${prev}\n${reason}` : reason));
        return;
      }

      setReconcileProgress({ phase: "Applying reconciliation", current: 0, total: 1 });
      const itemIdsForCount = Array.from(
        new Set(
          finalLines
            .map((l) => skuToItemVariant.get(l.sku.toUpperCase())?.item.id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const count = await inventoryService.createCount(
        {
          countType: CountType.CYCLE_COUNT,
          locationId: reconcileLocationId,
          itemIds: itemIdsForCount,
        },
        { timeout: 0, signal },
      );

      const editedLineNos = new Set<number>();
      const editedLineUpdates = finalLines
        .map((l) => {
          const match = skuToItemVariant.get(l.sku.toUpperCase());
          if (!match) return null;
          const countLine = count.lines.find(
            (cl) => cl.itemId === match.item.id && cl.variantId === match.variant.id,
          );
          if (!countLine) return null;
          editedLineNos.add(countLine.lineNo);
          // Submitting requires a reason whenever physical differs from system — since this line
          // only exists because the file's Stock value differed (see parseStockReconcileWorkbook),
          // a real quantity change here always needs one; a serial-only line (no quantity change)
          // doesn't, since its variance is 0.
          return {
            lineNo: countLine.lineNo,
            physicalQuantity: l.physicalQuantity ?? countLine.systemQuantity,
            varianceReason: l.physicalQuantity != null ? "Reconciled from Excel upload" : undefined,
            serialNumbers:
              l.newSerialNumbers.length > 0
                ? [...(countLine.serialNumbers ?? []), ...l.newSerialNumbers]
                : undefined,
          };
        })
        .filter((u): u is NonNullable<typeof u> => u != null);

      // Submitting requires EVERY line on the count to have a physical quantity entered, not just
      // the ones this file touched — a multi-variant item pulls in all its siblings when the count
      // is created. Default every untouched line to its own system quantity (no variance, nothing
      // to explain) so Submit never rejects the whole count over a line the file never mentioned.
      const untouchedLineUpdates = count.lines
        .filter((cl) => !editedLineNos.has(cl.lineNo))
        .map((cl) => ({ lineNo: cl.lineNo, physicalQuantity: cl.systemQuantity }));
      const lineUpdates = [...editedLineUpdates, ...untouchedLineUpdates];

      if (lineUpdates.length > 0) {
        setReconcileProgress({ phase: "Applying reconciliation — writing line updates", current: 0, total: 1 });
        await inventoryService.updateCountLines(count.id, { lines: lineUpdates }, { timeout: 0, signal });
      }

      // Reconcile is an admin-only, file-driven action (see the button's gating below) — rather
      // than leaving a draft for a second manual review pass, submit and approve it right here so
      // the stock/serial changes take effect immediately, same as ticking every box by hand would.
      // submitCount already auto-approves in-policy variances for a role that can approve — only
      // call approveCount ourselves when that didn't already happen, or it 400s on an already-
      // APPROVED count. Every call below is unbounded-timeout, same reasoning as the reads above —
      // this is the step that actually applies stock, so it must not be the one place a network
      // hiccup silently aborts after everything else already succeeded.
      setReconcileProgress({ phase: "Applying reconciliation — submitting count", current: 0, total: 1 });
      const submitted = await inventoryService.submitCount(count.id, { timeout: 0, signal });
      if (submitted.status !== CountStatus.APPROVED) {
        setReconcileProgress({ phase: "Applying reconciliation — approving count", current: 0, total: 1 });
        await inventoryService.approveCount(count.id, { timeout: 0, signal });
      }

      setSuccess(
        `Stock Count ${count.countNumber} created and approved from this file — ${editedLineUpdates.length} line(s) applied to live stock.` +
          (createdProductNames.length > 0
            ? ` (${createdProductNames.length} new product(s) created and included: ${createdProductNames.join(", ")}.)`
            : "") +
          (convertedItemIds.size > 0
            ? ` (${convertedItemIds.size} item(s) were converted to stock-managed and included.)`
            : "") +
          (stillNonStock.length > 0
            ? ` (${stillNonStock.length} service/non-stock item(s) were left as-is and skipped.)`
            : "") +
          (failedToCreateSkus.length > 0
            ? ` (${failedToCreateSkus.length} SKU(s) could not be created — see error above.)`
            : ""),
      );
      setReconcilePendingFile(null);
      setReconcileLocationId("");
    } catch (err: any) {
      if (isAbortError(err)) {
        setError(
          "Reconcile stopped — nothing further ran. Anything already written before you stopped it " +
            "(a product converted or created, or a Stock Count already created) stays exactly as it was — " +
            "check Inventory → Stock Counts if one was created, and re-run the file when ready.",
        );
      } else {
        setError(extractErrorMessage(err, "Failed to reconcile stock/serials from file"));
        logger.error("[ItemMaster] Failed to reconcile stock/serials", err);
      }
    } finally {
      setReconciling(false);
      setReconcileProgress(null);
      reconcileAbortRef.current = null;
    }
  }, [reconcilePendingFile, reconcileLocationId]);

  useEffect(() => {
    if (viewMode === "list") {
      const loadKey = `${sortColumn}-${sortDirection}-${currentPage}`;
      if (loadKey === lastItemsLoadRef.current) return;
      loadItems();
      lastItemsLoadRef.current = loadKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, sortColumn, sortDirection, currentPage, loadItems]);

  // Define loadStockData before useEffect that uses it
  const loadStockData = useCallback(async (itemId: string) => {
    if (loadingStockRef.current) return; // Prevent concurrent calls
    loadingStockRef.current = true;
    setLoading(true); // Set loading state for UI
    try {
      const data = await inventoryService.getStockByItem(itemId);
      setStockData(data);
    } catch (err: any) {
      logger.error("[ItemMaster] Failed to load stock data", err);
      setStockData([]);
    } finally {
      loadingStockRef.current = false;
      setLoading(false); // Clear loading state
    }
  }, []);

  useEffect(() => {
    if (selectedItemId && viewMode === "details") {
      // Reset last loaded ref when item changes to ensure fresh data loads
      lastLoadedRef.current = { itemId: null, subTab: null };
      // Clear stock data when item changes to prevent showing stale data
      setStockData([]);
      loadItemDetails();
    }
  }, [selectedItemId, viewMode]);

  useEffect(() => {
    // Reload data when sub-tab changes for selected item
    // Only run if we have selectedItemId and selectedItem is loaded
    if (!selectedItemId || viewMode !== "details") return;
    if (!selectedItem) return; // Wait for selectedItem to load

    // Prevent duplicate loads for the same itemId/subTab combination
    const key = `${selectedItemId}-${itemSubTab}`;
    const lastKey =
      lastLoadedRef.current.itemId && lastLoadedRef.current.subTab
        ? `${lastLoadedRef.current.itemId}-${lastLoadedRef.current.subTab}`
        : null;

    if (key === lastKey) return; // Already loaded this combination

    if (itemSubTab === "stock" || itemSubTab === "history") {
      loadStockData(selectedItemId);
    }

    // Update last loaded ref
    lastLoadedRef.current = { itemId: selectedItemId, subTab: itemSubTab };
    // Note: selectedItem is checked but not in deps to avoid loops when object reference changes
    // We use selectedItem?.id as a stable dependency instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSubTab, selectedItemId, viewMode, loadStockData, selectedItem?.id]);

  const loadItemDetails = async () => {
    if (!selectedItemId) return;
    setLoading(true);
    setError(null);
    try {
      const [data, vs] = await Promise.all([
        inventoryService.getItemById(selectedItemId),
        inventoryService.getVariantsByItem(selectedItemId).catch(() => []),
      ]);
      let merged: InventoryItem = { ...data };
      if (vs.length > 0) {
        const def = vs.find((v) => v.isDefault) || vs[0];
        merged = {
          ...data,
          displaySku: def?.sku || def?.code || data.sku,
          variantTracking: {
            batch: vs.some((v) => v.trackBatchOverride),
            serial: vs.some((v) => v.trackSerialOverride),
            serialOptional: vs.some((v) => v.serialOptionalOverride),
          },
        };
        setVariants((prev) => {
          const rest = prev.filter((v) => v.itemId !== selectedItemId);
          return [...rest, ...vs];
        });
        await loadVariantStock(selectedItemId);
      } else {
        setVariants((prevVariants) =>
          prevVariants.filter((v) => v.itemId !== selectedItemId),
        );
        setVariantStockByItem((prev) => {
          const next = { ...prev };
          delete next[selectedItemId];
          return next;
        });
      }
      setSelectedItem(merged);

      const loadTrackingFlags = detailIndustryFlags(merged);
      const trackingLoads: Promise<void>[] = [];
      if (loadTrackingFlags.requiresBatchTracking) {
        trackingLoads.push(loadBatches(selectedItemId));
      }
      if (loadTrackingFlags.requiresSerialTracking) {
        trackingLoads.push(loadSerials(selectedItemId));
      }
      if (loadTrackingFlags.hasExpiryDate) {
        trackingLoads.push(loadExpiryAlerts(selectedItemId));
      }
      if (trackingLoads.length > 0) {
        await Promise.all(trackingLoads);
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, "Failed to load item details");
      setError(message);
      logger.error("[ItemMaster] Failed to load item details", err);
    } finally {
      setLoading(false);
    }
  };

  const loadBatches = async (itemId: string) => {
    setBatchLoading(true);
    try {
      const data = await inventoryService.getBatchesByItem(itemId);
      setBatches(data);
    } catch (err: any) {
      logger.error("[ItemMaster] Failed to load batches", err);
      setBatches([]);
    } finally {
      setBatchLoading(false);
    }
  };

  const handleCreateBatch = async () => {
    if (!selectedItemId || !batchForm.batchNumber) {
      setError("Batch number is required");
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.createBatch({
        batchNumber: batchForm.batchNumber,
        itemId: selectedItemId,
        manufacturingDate: batchForm.manufacturingDate,
        expiryDate: batchForm.expiryDate || undefined,
      });
      setSuccess("Batch created successfully");
      setBatchViewMode("list");
      setBatchForm({
        batchNumber: "",
        manufacturingDate: new Date().toISOString().split("T")[0],
        expiryDate: "",
      });
      await loadBatches(selectedItemId);
    } catch (err: any) {
      const message = extractErrorMessage(err, "Failed to create batch");
      setError(message);
      logger.error("[ItemMaster] Failed to create batch", err);
    }
  };

  const handleDisposeBatch = async (reason?: string) => {
    if (!batchToDispose || !reason || !selectedItemId) return;
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.disposeBatch(
        batchToDispose.batchNumber,
        batchToDispose.itemId,
        reason,
      );
      setSuccess("Batch disposed successfully");
      setShowBatchDisposeDialog(false);
      setBatchToDispose(null);
      setDisposeReason("");
      await loadBatches(selectedItemId);
    } catch (err: any) {
      const message = extractErrorMessage(err, "Failed to dispose batch");
      setError(message);
      logger.error("[ItemMaster] Failed to dispose batch", err);
    }
  };

  const handleFEFO = async () => {
    if (!selectedItemId || !fefoForm.locationId || !fefoForm.quantity) {
      setError("Location and quantity are required for FEFO");
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const result = await inventoryService.getFEFOStock(
        selectedItemId,
        fefoForm.locationId,
        fefoForm.quantity,
      );
      setFefoResult(result);
      setSuccess("FEFO allocation calculated successfully");
    } catch (err: any) {
      const message = extractErrorMessage(
        err,
        "Failed to calculate FEFO allocation",
      );
      setError(message);
      logger.error("[ItemMaster] Failed to calculate FEFO", err);
    }
  };

  const loadSerials = async (itemId: string) => {
    setSerialLoading(true);
    try {
      const data = await inventoryService.getSerialsByItem(itemId);
      setSerials(data);
    } catch (err: any) {
      logger.error("[ItemMaster] Failed to load serials", err);
      setSerials([]);
    } finally {
      setSerialLoading(false);
    }
  };

  const loadExpiryAlerts = async (itemId?: string) => {
    setExpiryLoading(true);
    try {
      const alerts = await inventoryService.getExpiryAlerts(expiryDaysAhead, itemId);
      setExpiryAlerts(alerts);
    } catch (err: any) {
      logger.error("[ItemMaster] Failed to load expiry alerts", err);
      setExpiryAlerts([]);
    } finally {
      setExpiryLoading(false);
    }
  };

  useEffect(() => {
    // Reload history when filters change (variant scoping is client-side on historyData)
    if (itemSubTab === "history" && selectedItemId) {
      loadHistoryData(selectedItemId);
    }
  }, [historyFilters, itemSubTab, selectedItemId]);

  // Handle serial click - open detail panel via URL
  const handleSerialClick = useCallback(
    (serial: SerialResponse) => {
      const params = new URLSearchParams(searchParams);
      params.set("serialNumber", serial.serialNumber);
      if (selectedItemId) {
        params.set("itemId", selectedItemId);
      }
      if (selectedVariantId) {
        params.set("variantId", selectedVariantId);
      }
      params.set("itemSubTab", "tracking");
      setSearchParams(params, { replace: false });
    },
    [selectedItemId, selectedVariantId, searchParams, setSearchParams],
  );

  // Handle serial sort
  const handleSerialSort = useCallback(
    (column: string, direction: "asc" | "desc") => {
      setSerialSortColumn(column);
      setSerialSortDirection(direction);
    },
    [],
  );

  // Handle serial filter change
  const handleSerialFilterChange = useCallback(
    (newFilters: { status?: string; locationId?: string }) => {
      setSerialFilters(newFilters);
    },
    [],
  );

  const loadVariants = async (itemId: string) => {
    try {
      const data = await inventoryService.getVariantsByItem(itemId);
      // Merge variants: keep variants from other items, replace variants for this item
      setVariants((prevVariants) => {
        const otherItemVariants = prevVariants.filter(
          (v) => v.itemId !== itemId,
        );
        const merged = [...otherItemVariants, ...data];
        return merged;
      });
    } catch (err: any) {
      logger.error("[ItemMaster] Failed to load variants", err);
      // On error, only remove variants for this item, keep others
      setVariants((prevVariants) =>
        prevVariants.filter((v) => v.itemId !== itemId),
      );
    }
  };

  const loadVariantStock = async (itemId: string) => {
    try {
      const data = await inventoryService.getVariantStock(itemId);
      setVariantStockByItem((prev) => ({ ...prev, [itemId]: data }));
    } catch (err: any) {
      logger.error("[ItemMaster] Failed to load variant stock", err);
      setVariantStockByItem((prev) => ({ ...prev, [itemId]: [] }));
    }
  };

  const toggleRowExpand = async (itemId: string) => {
    const newExpanded = new Set(expandedRows);
    const isCurrentlyExpanded = newExpanded.has(itemId);

    if (isCurrentlyExpanded) {
      newExpanded.delete(itemId);
      setExpandedRows(newExpanded);
    } else {
      // Accordion: only one expanded product row at a time
      setExpandedRows(new Set([itemId]));

      // Always try to load variants when expanding, regardless of hasVariants flag
      // The flag might not be set correctly, but variants could still exist
      const item = items.find((i) => i.id === itemId);

      // Always attempt to load variants - if none exist, API will return empty array
      const [variantsOutcome, stockOutcome] = await Promise.allSettled([
        loadVariants(itemId),
        loadVariantStock(itemId),
      ]);
      if (variantsOutcome.status === "rejected") {
        logger.error(
          "[ItemMaster] Failed to load variants for expanded row",
          variantsOutcome.reason, 
        );
        setVariants((prevVariants) =>
          prevVariants.filter((v) => v.itemId !== itemId),
        );
      }
      if (stockOutcome.status === "rejected") {
        logger.error(
          "[ItemMaster] Failed to load variant stock for expanded row",
          stockOutcome.reason,
        );
      }
    }
  };

  const handleSort = (column: string) => {
    setCurrentPage(1);
    lastItemsLoadRef.current = "";
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

  const clearSuccessMessage = () => {
    if (successTimeout) {
      clearTimeout(successTimeout);
    }
    const timeout = setTimeout(() => {
      setSuccess(null);
    }, 5000);
    setSuccessTimeout(timeout);
  };

  const openVariantEditDrawer = useCallback(
    async (item: InventoryItem, preferredVariantId?: string | null) => {
    setError(null);
    setSuccess(null);
      if (!item.hasVariants) {
        setError("This item has no variants.");
        return;
      }
      setBulkVariantEditLoading(true);
      try {
        const list = await inventoryService.getVariantsByItem(item.id);
        if (!list.length) {
          setError("No variants found for this item.");
          return;
        }
        const apiVariant =
          preferredVariantId &&
          list.some((v) => v.id === preferredVariantId)
            ? list.find((v) => v.id === preferredVariantId)!
            : (list.find((v) => v.isDefault) ?? list[0]);
        setAddVariantContext(null);
        setBulkVariantEditContext({
          item,
          apiVariant,
          wizardRow: inventoryVariantToWizardRow(apiVariant),
        });
      } catch (err: unknown) {
        setError(extractErrorMessage(err, "Failed to load variants"));
    } finally {
        setBulkVariantEditLoading(false);
      }
    },
    [],
  );

  const openAddVariantDrawer = useCallback((item: InventoryItem) => {
    setListRowMenu(null);
    setError(null);
    setBulkVariantEditContext(null);
    setAddVariantContext({ item });
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
    void loadVariants(item.id);
  }, []);

  const loadHistoryData = async (itemId: string) => {
    try {
      const filters: any = { itemId };
      if (historyFilters.dateFrom) filters.dateFrom = historyFilters.dateFrom;
      if (historyFilters.dateTo) filters.dateTo = historyFilters.dateTo;
      if (historyFilters.movementType)
        filters.movementType = historyFilters.movementType;
      if (historyFilters.locationId)
        filters.fromLocationId = historyFilters.locationId;
      const result = await inventoryService.getAllMovements({ ...filters, page: 1, limit: 100 });
      setHistoryData(result.items);
    } catch (err: any) {
      logger.error("[ItemMaster] Failed to load history data", err);
      setHistoryData([]);
    }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.deleteItem(itemToDelete);
      setSuccess("Item deleted successfully");
      setShowDeleteConfirm(false);
      setItemToDelete(null);
      if (selectedItemId === itemToDelete) {
        setViewMode("list");
        setSelectedItemId(null);
        setSelectedVariantId(null);
        setSearchParams(
          (prev) => stripItemMasterSelectionFromParams(prev),
          { replace: true },
        );
      }
      loadItems();
    } catch (err: any) {
      const message = extractErrorMessage(err, "Failed to delete item");
      setError(message);
      logger.error("[ItemMaster] Failed to delete item", err);
    }
  };

  const closeListRowMenu = () => setListRowMenu(null);

  useEffect(() => {
    if (!listRowMenu) return;
    const close = (e: MouseEvent) => {
      if (listRowMenuRef.current?.contains(e.target as Node)) return;
      setListRowMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setListRowMenu(null);
    };
    const t = setTimeout(() => {
      document.addEventListener("mousedown", close);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [listRowMenu]);

  useEffect(() => {
    if (!listRowMenu || !listRowMenuRef.current) return;
    const el = listRowMenuRef.current;
    const rect = el.getBoundingClientRect();
    let x = listRowMenu.x;
    let y = listRowMenu.y;
    if (x + rect.width > window.innerWidth - 8)
      x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight - 8)
      y = window.innerHeight - rect.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [listRowMenu]);

  const openItemDetailsFromList = (item: InventoryItem) => {
    closeListRowMenu();
    setSelectedItemId(item.id);
    setViewMode("details");
    setItemSubTab("stock");
    if (item.hasVariants) {
      setExpandedRows(new Set([item.id]));
      void loadVariants(item.id);
      void loadVariantStock(item.id);
    }
    const iv = variants.filter(
      (v: { itemId?: string }) => v.itemId === item.id,
    );
    const defId = pickDefaultVariantId(iv);
    setSelectedVariantId(defId);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("itemId", item.id);
        p.set("itemSubTab", "stock");
        if (defId) p.set("variantId", defId);
        else p.delete("variantId");
        return p;
      },
      { replace: true },
    );
  };

  const openEditMasterDrawer = (item: InventoryItem) => {
    closeListRowMenu();
    setEditMasterDrawerItem(item);
    setEditMasterDrawerOpen(true);
  };

  const openVariantDetailsFromList = (
    item: InventoryItem,
    variant: InventoryVariant,
  ) => {
    closeListRowMenu();
    setSelectedItemId(item.id);
    setViewMode("details");
    setItemSubTab("stock");
    setSelectedVariantId(variant.id);
    setExpandedRows(new Set([item.id]));
    void loadVariants(item.id);
    void loadVariantStock(item.id);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("itemId", item.id);
        p.set("itemSubTab", "stock");
        p.set("variantId", variant.id);
        return p;
      },
      { replace: true },
    );
  };

  const navigateMovementFromList = (
    itemId: string,
    movementType: MovementType.RECEIPT | MovementType.ISSUE,
    variantId: string | null,
  ) => {
    closeListRowMenu();
    const p = new URLSearchParams(searchParams);
    p.set("tab", "movements");
    p.set("create", "1");
    p.set("movementType", movementType);
    p.set("itemId", itemId);
    if (variantId) {
      p.set("variantId", variantId);
      p.set("variantLocked", "1");
    } else {
      p.delete("variantId");
      p.delete("variantLocked");
    }
    const reasonKey =
      movementType === MovementType.RECEIPT ? "RECEIPT" : "ISSUE";
    p.set(
      "reasonCode",
      getDefaultReason(reasonKey, "item").defaultCode,
    );
    p.set("returnTab", "items");
    p.set("returnItemId", itemId);
    p.set("returnSubTab", itemSubTab);
    setSearchParams(p);
  };

  const toggleItemActiveFromMenu = (item: InventoryItem) => {
    closeListRowMenu();
    const nextActive = !item.isActive;
    const verb = nextActive ? "Activate" : "Deactivate";
    if (
      !window.confirm(
        `${verb} "${item.name}"?`,
      )
    ) {
      return;
    }
    void (async () => {
      setError(null);
      setSuccess(null);
      try {
        await inventoryService.updateItem(item.id, {
          isActive: nextActive,
        });
        setSuccess(
          nextActive ? "Item activated successfully" : "Item deactivated successfully",
        );
        clearSuccessMessage();
        await loadItems();
        if (selectedItemId === item.id) {
          await loadItemDetails();
        }
      } catch (err: unknown) {
        setError(
          extractErrorMessage(
            err,
            nextActive ? "Failed to activate item" : "Failed to deactivate item",
          ),
        );
      }
    })();
  };

  const toggleVariantActiveFromMenu = (
    item: InventoryItem,
    variant: InventoryVariant,
  ) => {
    closeListRowMenu();
    const currentlyActive = variant.isActive !== false;
    const nextActive = !currentlyActive;
    const verb = nextActive ? "Activate" : "Deactivate";
    if (
      !window.confirm(
        `${verb} variant "${variant.name}" (${variant.code})?`,
      )
    ) {
      return;
    }
    void (async () => {
    setError(null);
    setSuccess(null);
      try {
        await inventoryService.updateVariant(variant.id, {
          isActive: nextActive,
        });
        setSuccess(
          nextActive
            ? "Variant activated successfully"
            : "Variant deactivated successfully",
        );
      clearSuccessMessage();
        await loadVariants(item.id);
        await loadVariantStock(item.id);
        await loadItems();
        if (selectedItemId === item.id) {
      await loadItemDetails();
        }
      } catch (err: unknown) {
        setError(
          extractErrorMessage(
            err,
            nextActive
              ? "Failed to activate variant"
              : "Failed to deactivate variant",
          ),
        );
      }
    })();
  };

  const handleConfirmVariantDelete = async () => {
    if (!variantDeleteTarget) return;
    const { itemId, variantId, label } = variantDeleteTarget;
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.deleteVariant(variantId);
      setVariantDeleteTarget(null);
      setSuccess(`Variant deleted: ${label}`);
      clearSuccessMessage();
      await loadVariants(itemId);
      await loadVariantStock(itemId);
      await loadItems();
      const remaining = await inventoryService.getVariantsByItem(itemId);
      const nextVariantId = pickDefaultVariantId(remaining);
      if (selectedItemId === itemId) {
        setSelectedVariantId(nextVariantId);
        setSearchParams(
          (prev) => {
            const p = new URLSearchParams(prev);
            if (nextVariantId) p.set("variantId", nextVariantId);
            else p.delete("variantId");
            return p;
          },
          { replace: true },
        );
        await loadItemDetails();
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to delete variant"));
    }
  };

  const renderList = () => (
    <div className="item-master-list">
      <div className="item-master-list-content">
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            padding: "12px 12px 0",
          }}
        >
          <input
            ref={importFileInputRef}
            type="file"
            accept=".xlsx"
            style={{ display: "none" }}
            onChange={(e) => void handleImportFileSelected(e)}
          />
          <Button
            variant="secondary"
            disabled={importingProducts}
            onClick={() => importFileInputRef.current?.click()}
            title="Upload a .xlsx (Products + Variants sheets) — new product names are created, existing ones are updated by name/SKU"
          >
            {importingProducts ? "⏳ Uploading…" : "⬆️ Upload products"}
          </Button>
          <Button
            variant="secondary"
            disabled={exportingProducts}
            onClick={() => void handleExportProducts()}
            title="Export the full catalog to a formatted .xlsx (Products + Variants sheets)"
          >
            {exportingProducts ? "⏳ Exporting…" : "⬇️ Export to Excel"}
          </Button>
          {isAdmin && (
            <>
              <input
                ref={reconcileFileInputRef}
                type="file"
                accept=".xlsx"
                style={{ display: "none" }}
                onChange={(e) => void handleReconcileFileSelected(e)}
              />
              <Button
                variant="secondary"
                disabled={reconciling}
                onClick={() => reconcileFileInputRef.current?.click()}
                title="Read the Stock (On Hand) column and Serial Numbers sheet from an edited export and apply the differences immediately as an approved Stock Count — admin only, no manual review step"
              >
                🔄 Reconcile stock & serials
              </Button>
            </>
          )}
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
        {importSummary && importSummary.errors.length > 0 && (
          <div className="error-message" style={{ whiteSpace: "pre-wrap" }}>
            {importSummary.errors
              .map((e) => `Row ${e.row} (${e.productName || "—"}): ${e.message}`)
              .join("\n")}
          </div>
        )}

        {loading ? (
          <div className="loading-skeleton" style={{ padding: "20px" }}>
            <div className="skeleton-row"></div>
            <div className="skeleton-row"></div>
            <div className="skeleton-row"></div>
            <div className="skeleton-row"></div>
            <div className="skeleton-row"></div>
          </div>
        ) : items.length === 0 ? (
          <div
            style={{
              padding: "40px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
            }}
          >
            <EmptyState message="No items found" />
          </div>
        ) : (
          <>
            <div className="item-master-table">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "32px" }} aria-label="Reorder">
                      <span className="drag-handle-icon" title="Drag to reorder">⋮⋮</span>
                    </th>
                    <th
                      className="sortable-header item-master-col-name"
                      onClick={() => handleSort("name")}
                      style={{ cursor: "pointer" }}
                    >
                      Name
                      {sortColumn === "name" && (
                        <span className="sort-indicator">
                          {sortDirection === "asc" ? " ↑" : " ↓"}
                        </span>
                      )}
                    </th>
                    <th
                      className="sortable-header"
                      onClick={() => handleSort("category")}
                      style={{ cursor: "pointer" }}
                    >
                      Category
                      {sortColumn === "category" && (
                        <span className="sort-indicator">
                          {sortDirection === "asc" ? " ↑" : " ↓"}
                        </span>
                      )}
                    </th>
                    <th
                      className="sortable-header"
                      onClick={() => handleSort("unit")}
                      style={{ cursor: "pointer" }}
                    >
                      Unit
                      {sortColumn === "unit" && (
                        <span className="sort-indicator">
                          {sortDirection === "asc" ? " ↑" : " ↓"}
                        </span>
                      )}
                    </th>
                    <th
                      className="sortable-header"
                      onClick={() => handleSort("industry")}
                      style={{ cursor: "pointer" }}
                    >
                      Industry
                      {sortColumn === "industry" && (
                        <span className="sort-indicator">
                          {sortDirection === "asc" ? " ↑" : " ↓"}
                        </span>
                      )}
                    </th>
                    <th className="item-master-col-actions" aria-label="Row actions" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                      const isExpanded = expandedRows.has(item.id);
                      const itemVariants = variants.filter(
                        (v) => v.itemId === item.id,
                      );
                      return (
                        <React.Fragment key={item.id}>
                          <tr
                            className={`expandable-row ${selectedItemId === item.id ? "selected-row" : ""} ${draggingItemId === item.id ? "dragging" : ""} ${dropTargetItemId === item.id ? "drop-target" : ""}`}
                            onClick={() => openItemDetailsFromList(item)}
                            onContextMenu={(e) => {
                              if (
                                (e.target as HTMLElement).closest(
                                  "input,.drag-handle-cell,button,a,.item-master-col-actions",
                                )
                              ) {
                                return;
                              }
                              e.preventDefault();
                              setListRowMenu({
                                kind: "item",
                                item,
                                x: e.clientX,
                                y: e.clientY,
                              });
                            }}
                            style={{
                              cursor: "pointer",
                              backgroundColor:
                                selectedItemId === item.id
                                  ? "#f0f7ff"
                                  : "transparent",
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              if (draggingItemId !== item.id) setDropTargetItemId(item.id);
                            }}
                            onDragLeave={() => {
                              setDropTargetItemId((prev) => (prev === item.id ? null : prev));
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const sourceId = e.dataTransfer.getData("text/plain");
                              if (!sourceId || sourceId === item.id) {
                                setDropTargetItemId(null);
                                setDraggingItemId(null);
                                return;
                              }
                              const fromIndex = items.findIndex((i) => i.id === sourceId);
                              const toIndex = items.findIndex((i) => i.id === item.id);
                              if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
                                setDropTargetItemId(null);
                                setDraggingItemId(null);
                                return;
                              }
                              const newItems = [...items];
                              const [removed] = newItems.splice(fromIndex, 1);
                              newItems.splice(toIndex, 0, removed);
                              setItems(newItems);
                              setDropTargetItemId(null);
                              setDraggingItemId(null);
                            }}
                            onDragEnd={() => {
                              if (dragPreviewRef.current?.parentNode) {
                                dragPreviewRef.current.parentNode.removeChild(dragPreviewRef.current);
                                dragPreviewRef.current = null;
                              }
                              setDraggingItemId(null);
                              setDropTargetItemId(null);
                            }}
                          >
                            <td
                              className="drag-handle-cell"
                              draggable
                              onClick={(e) => e.stopPropagation()}
                              onContextMenu={(e) => e.stopPropagation()}
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", item.id);
                                setDraggingItemId(item.id);
                                const tr = (e.currentTarget as HTMLElement).closest("tr");
                                if (tr) {
                                  const rect = tr.getBoundingClientRect();
                                  const table = document.createElement("table");
                                  table.className = "item-master-table";
                                  table.style.width = `${rect.width}px`;
                                  table.style.tableLayout = "fixed";
                                  const tbody = document.createElement("tbody");
                                  tbody.appendChild(tr.cloneNode(true));
                                  table.appendChild(tbody);
                                  const wrapper = document.createElement("div");
                                  wrapper.className = "item-master-drag-preview";
                                  wrapper.style.width = `${rect.width}px`;
                                  wrapper.appendChild(table);
                                  document.body.appendChild(wrapper);
                                  dragPreviewRef.current = wrapper;
                                  const offsetX = e.clientX - rect.left;
                                  const offsetY = e.clientY - rect.top;
                                  e.dataTransfer.setDragImage(wrapper, offsetX, offsetY);
                                }
                              }}
                              role="button"
                              aria-label="Drag to reorder"
                            >
                              <span className="drag-handle-icon" aria-hidden>⋮⋮</span>
                            </td>
                            <td className="item-master-col-name">
                              <div className="expandable-row-header">
                                {item.hasVariants ? (
                                  <span
                                    className={`expand-icon ${isExpanded ? "expanded" : ""}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleRowExpand(item.id);
                                    }}
                                    style={{ cursor: "pointer" }}
                                  >
                                    ▶
                                  </span>
                                ) : (
                                  <span className="expand-icon-placeholder" aria-hidden />
                                )}
                                <div className="item-master-name-cell">
                                  <span className="item-master-name-primary">
                                    {item.name}
                                  </span>
                                  <span className="item-master-name-sku">
                                    {rowSku(item)}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td>{categoryOptionLabel(item.category || "") || "-"}</td>
                            <td>{item.unitOfMeasure}</td>
                            <td>{rowIndustryType(item)}</td>
                            <td
                              className="item-master-col-actions"
                              onClick={(e) => e.stopPropagation()}
                              onContextMenu={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="item-master-row-kebab"
                                aria-label={`Actions for ${item.name}`}
                                aria-haspopup="menu"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const el = e.currentTarget;
                                  const rect = el.getBoundingClientRect();
                                  setListRowMenu({
                                    kind: "item",
                                    item,
                                    x: rect.left,
                                    y: rect.bottom + 4,
                                  });
                                }}
                              >
                                ⋮
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={6} className="expanded-content">
                                <div className="expanded-variants-container">
                                  {/* Variants List - Read-Only Display */}
                                  <div className="expanded-variants-list">
                                    {itemVariants.length > 0 ? (
                                      <table className="variants-table">
                                        <thead>
                                          <tr>
                                            <th className="variants-col-variant-name">
                                              Name
                                            </th>
                                            <th className="variants-col-stock">
                                              Stock
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {itemVariants.map((variant) => {
                                            const stockRows =
                                              variantStockByItem[item.id] ??
                                              [];
                                            const stockInfo = stockRows.find(
                                              (vs) =>
                                                vs.variantId === variant.id,
                                            );
                                            const isVariantSelected =
                                              selectedItemId === item.id &&
                                              selectedVariantId === variant.id;
                                            return (
                                              <tr
                                                key={variant.id}
                                                className={`variant-row clickable-variant-row${isVariantSelected ? " variant-row--selected" : ""}`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  openVariantDetailsFromList(item, variant);
                                                }}
                                                onContextMenu={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  setListRowMenu({
                                                    kind: "variant",
                                                    item,
                                                    variant,
                                                    x: e.clientX,
                                                    y: e.clientY,
                                                  });
                                                }}
                                                style={{ cursor: "pointer" }}
                                              >
                                                <td className="variants-col-variant-name">
                                                  <div className="variant-name-stack">
                                                  <span className="variant-name-text">
                                                    {variant.name}
                                                  </span>
                                                    <span className="variant-meta-inline">
                                                      {variant.hsn?.trim() ||
                                                        variant.code ||
                                                        "—"}
                                                    </span>
                                                  </div>
                                                </td>
                                                <td className="variants-col-stock">
                                                  <span className="variant-stock-text">
                                                    {stockInfo?.totalOnHand ||
                                                      0}
                                                  </span>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    ) : (
                                      <div className="no-variants-message">
                                        <p>
                                          No variants yet. Add them when creating
                                          a product (wizard), or manage them from
                                          the product detail page for this item.
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="pagination-controls">
              <span className="pagination-info">
                {totalItems === 0
                  ? "No items"
                  : `Showing ${(currentPage - 1) * itemsPerPage + 1}–${Math.min(currentPage * itemsPerPage, totalItems)} of ${totalItems}`}
              </span>
              <div className="pagination-buttons">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={currentPage <= 1 || loading}
                  onClick={() => {
                    lastItemsLoadRef.current = "";
                    setCurrentPage((p) => Math.max(1, p - 1));
                  }}
                >
                  Previous
                </Button>
                <span className="pagination-page-info">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={currentPage >= totalPages || loading}
                  onClick={() => {
                    lastItemsLoadRef.current = "";
                    setCurrentPage((p) => Math.min(totalPages, p + 1));
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  const renderDetailHeader = () => {
    if (!selectedItem) return null;

    const detailItemVariants = variants.filter(
      (v: { itemId?: string }) => v.itemId === selectedItem.id,
    );
    const detailSelectedVariant =
      selectedVariantId != null
        ? detailItemVariants.find((v: { id: string }) => v.id === selectedVariantId)
        : detailItemVariants.find((v) => v.isDefault) || detailItemVariants[0];
    const headerMetaLabel =
      selectedItem.hasVariants && detailSelectedVariant?.name
        ? detailSelectedVariant.name
        : rowSku(selectedItem);

    return (
      <div className="item-detail-header">
        <div className="item-detail-header-content">
          <div className="item-detail-header-main">
            <div className="item-detail-header-title-group">
              <h2 className="item-detail-header-title">{selectedItem.name}</h2>
              <span
                className={`item-detail-status-badge ${selectedItem.isActive ? "status-active" : "status-inactive"}`}
              >
                {selectedItem.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="item-detail-header-meta">
              <span className="item-detail-header-sku">{headerMetaLabel}</span>
            </div>
          </div>
          <div className="item-detail-header-actions">
            <Button
              variant="ghost"
              size="sm"
              title="Receive stock for this item"
              onClick={() => {
                const p = new URLSearchParams(searchParams);
                p.set("tab", "movements");
                p.set("create", "1");
                p.set("movementType", MovementType.RECEIPT);
                p.set("itemId", selectedItem.id);
                if (selectedVariantId) {
                  p.set("variantId", selectedVariantId);
                  p.set("variantLocked", "1");
                }
                p.set(
                  "reasonCode",
                  getDefaultReason("RECEIPT", "item").defaultCode,
                );
                p.set("returnTab", "items");
                p.set("returnItemId", selectedItem.id);
                p.set("returnSubTab", itemSubTab);
                setSearchParams(p);
              }}
            >
              Receive
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Issue stock for this item"
              onClick={() => {
                const p = new URLSearchParams(searchParams);
                p.set("tab", "movements");
                p.set("create", "1");
                p.set("movementType", MovementType.ISSUE);
                p.set("itemId", selectedItem.id);
                if (selectedVariantId) {
                  p.set("variantId", selectedVariantId);
                  p.set("variantLocked", "1");
                }
                p.set(
                  "reasonCode",
                  getDefaultReason("ISSUE", "item").defaultCode,
                );
                p.set("returnTab", "items");
                p.set("returnItemId", selectedItem.id);
                p.set("returnSubTab", itemSubTab);
                setSearchParams(p);
              }}
            >
              Issue
            </Button>
            <Button
              variant="secondary"
              size="sm"
              title={
                selectedItem.hasVariants
                  ? "Edit variant (same drawer as Add Product). Uses the variant selected on Stock when applicable."
                  : "No variants on this item"
              }
              disabled={!selectedItem.hasVariants || bulkVariantEditLoading}
              onClick={() =>
                void openVariantEditDrawer(selectedItem, selectedVariantId)
              }
            >
              Edit variant
            </Button>
            <Button
              variant="ghost"
              onClick={closeItemDetailsPanel}
              title="Close Details"
              size="sm"
              className="item-detail-close-btn"
            >
              ✕
            </Button>
          </div>
        </div>
      </div>
    );
  };


  const renderStockView = () => {
    if (!selectedItem) return null;
    if ((selectedItem.itemType ?? ItemType.STOCK) === ItemType.MISC_NON_STOCK) {
      return (
        <div className="stock-view">
          <Card>
            <h3 style={{ marginBottom: 8 }}>MISC / Non-Stock Item</h3>
            <p style={{ margin: 0 }}>
              This item is configured as non-stock. Stock ledger, batch, serial, and quantity
              controls are disabled. Movements for this item are saved as audit-only records.
            </p>
          </Card>
        </div>
      );
    }

    // Show loading state while stock data is being fetched
    if (loading && loadingStockRef.current && stockData.length === 0) {
      return <LoadingState message="Loading stock data..." />;
    }

    const variantLedgerRows = scopedStockLedgerRows;

    const totalOnHand = stockData.reduce((a, s) => a + s.onHandQuantity, 0);
    const totalReserved = stockData.reduce(
      (a, s) => a + s.reservedQuantity,
      0,
    );
    const totalAvailable = stockData.reduce(
      (a, s) => a + s.availableQuantity,
      0,
    );
    const locationCount = new Set(stockData.map((s) => s.locationId)).size;

    const primaryOnHand = showVariantScopedStock
      ? variantLedgerRows.reduce((a, s) => a + s.onHandQuantity, 0)
      : totalOnHand;
    const primaryReserved = showVariantScopedStock
      ? variantLedgerRows.reduce((a, s) => a + s.reservedQuantity, 0)
      : totalReserved;
    const primaryAvailable = showVariantScopedStock
      ? variantLedgerRows.reduce((a, s) => a + s.availableQuantity, 0)
      : totalAvailable;
    const primaryLocationCount = showVariantScopedStock
      ? new Set(variantLedgerRows.map((r) => r.locationId)).size
      : locationCount;
    const locationRows = Object.values(
      variantLedgerRows.reduce(
        (acc, row) => {
          const key = row.locationId;
          if (!acc[key]) {
            acc[key] = {
              locationId: key,
              name: row.location?.name || "Unknown location",
              type: row.location?.type || "OTHER",
              units: 0,
            };
          }
          acc[key].units += row.onHandQuantity;
        return acc;
      },
      {} as Record<
        string,
          { locationId: string; name: string; type: string; units: number }
        >,
      ),
    ).sort((a, b) => {
      if (b.units !== a.units) return b.units - a.units;
      return a.name.localeCompare(b.name);
    });

    const locationTypeTone = (type: string) => {
      const normalized = type.toLowerCase();
      if (normalized.includes("warehouse")) return "warehouse";
      if (normalized.includes("store")) return "store";
      if (normalized.includes("factory")) return "factory";
      return "other";
    };

    return (
      <div className="stock-view">
        <div className="stock-summary-cards stock-summary-cards--solo">
          <div className="stock-summary-card">
            <div className="stock-summary-label">On Hand</div>
            <div className="stock-summary-value">{primaryOnHand}</div>
          </div>
          <div className="stock-summary-card">
            <div className="stock-summary-label">Reserved</div>
            <div className="stock-summary-value">{primaryReserved}</div>
          </div>
          <div className="stock-summary-card">
            <div className="stock-summary-label">Available</div>
            <div className="stock-summary-value">{primaryAvailable}</div>
          </div>
          <div className="stock-summary-card">
            <div className="stock-summary-label">Locations</div>
            <div className="stock-summary-value">{primaryLocationCount}</div>
          </div>
        </div>

        <section className="stock-location-list" aria-label="Stock by location">
          <div className="stock-location-list-header">
            <h4>Stock by location</h4>
          </div>
          {locationRows.length === 0 ? (
            <p className="stock-location-list-empty">No location stock available.</p>
          ) : (
            <div className="stock-location-list-items">
              {locationRows.map((loc) => (
                <article key={loc.locationId} className="stock-location-list-item">
                  <div className="stock-location-list-meta">
                    <span
                      className={`stock-location-type-dot stock-location-type-dot--${locationTypeTone(loc.type)}`}
                      aria-hidden="true"
                    />
                    <div>
                      <div className="stock-location-name">{loc.name}</div>
                      <div className="stock-location-type">{loc.type}</div>
                        </div>
        </div>
                  <div className="stock-location-units">
                    <span className="stock-location-units-value">{loc.units}</span>
                    <span className="stock-location-units-label">units</span>
                    </div>
                </article>
                        ))}
                      </div>
                    )}
        </section>
      </div>
    );
  };

  const renderTrackingView = () => {
    if (!selectedItem) return null;

    const f = detailIndustryFlags(selectedItem);
    const hasBatches = f.requiresBatchTracking;
    const hasSerials = f.requiresSerialTracking;
    const hasExpiry = f.hasExpiryDate;

    // UI Governance: Count active sub-views - Maximum 3 per tab
    const activeSubViews = [hasBatches, hasSerials, hasExpiry].filter(
      Boolean,
    ).length;
    if (process.env.NODE_ENV === "development") {
      validateSubViews(activeSubViews, "Tracking");
    }

    // Set default sub-view based on what's available
    if (!hasBatches && !hasSerials && !hasExpiry) {
      return (
        <EmptyState message="No tracking features enabled for this item" />
      );
    }

    return (
      <div className="tracking-view">
        {/* Segmented buttons for tracking sub-views */}
        {/* UI Governance: Maximum 3 sub-views per tab enforced via TrackingSubView type - DO NOT ADD MORE */}
        <div className="tracking-segments">
          {hasBatches && (
            <button
              className={`tracking-segment ${trackingSubView === "batches" ? "active" : ""}`}
              onClick={() => setTrackingSubView("batches")}
            >
              Batches
            </button>
          )}
          {hasSerials && (
            <button
              className={`tracking-segment ${trackingSubView === "serials" ? "active" : ""}`}
              onClick={() => setTrackingSubView("serials")}
            >
              Serials
            </button>
          )}
          {hasExpiry && (
            <button
              className={`tracking-segment ${trackingSubView === "expiry" ? "active" : ""}`}
              onClick={() => setTrackingSubView("expiry")}
            >
              Expiry
            </button>
          )}
          {/* UI Governance Note: Maximum 3 sub-views reached. Use collapsible sections or modals for additional views. */}
        </div>

        {/* Render sub-view content */}
        {trackingSubView === "batches" && hasBatches && (
          <div className="batches-content">
            {batchViewMode === "create" ? (
              <Card className="batch-create-form">
                <h3>Create Batch</h3>
                {error && <div className="error-message">{error}</div>}
                {success && <div className="success-message">{success}</div>}
                <div className="form-group">
                  <label>Batch Number *</label>
                  <Input
                    value={batchForm.batchNumber}
                    onChange={(e) =>
                      setBatchForm({
                        ...batchForm,
                        batchNumber: e.target.value.toUpperCase(),
                      })
                    }
                    placeholder="BATCH-001"
                  />
                </div>
                <div className="form-group">
                  <label>Manufacturing Date *</label>
                  <Input
                    type="date"
                    value={batchForm.manufacturingDate}
                    onChange={(e) =>
                      setBatchForm({
                        ...batchForm,
                        manufacturingDate: e.target.value,
                      })
                    }
                  />
                </div>
                {detailIndustryFlags(selectedItem).hasExpiryDate && (
                  <div className="form-group">
                    <label>Expiry Date</label>
                    <Input
                      type="date"
                      value={batchForm.expiryDate}
                      onChange={(e) =>
                        setBatchForm({
                          ...batchForm,
                          expiryDate: e.target.value,
                        })
                      }
                    />
                  </div>
                )}
                <div className="form-actions">
                  <Button
                    variant="secondary"
                    onClick={() => setBatchViewMode("list")}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={handleCreateBatch}>
                    Create Batch
                  </Button>
                </div>
              </Card>
            ) : batchViewMode === "fefo" ? (
              <Card className="batch-fefo">
                <h3>FEFO Allocation Calculator</h3>
                {error && <div className="error-message">{error}</div>}
                {success && <div className="success-message">{success}</div>}
                <div className="form-group">
                  <label>Location *</label>
                  <Select
                    value={fefoForm.locationId}
                    onChange={(e) =>
                      setFefoForm({ ...fefoForm, locationId: e.target.value })
                    }
                  >
                    <option value="">Select Location</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.code} - {loc.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="form-group">
                  <label>Quantity Required *</label>
                  <Input
                    type="number"
                    value={fefoForm.quantity || ""}
                    onChange={(e) =>
                      setFefoForm({
                        ...fefoForm,
                        quantity: parseFloat(e.target.value) || 0,
                      })
                    }
                    min="0.01"
                    step="0.01"
                  />
                </div>
                <div className="form-actions">
                  <Button
                    variant="secondary"
                    onClick={() => setBatchViewMode("list")}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={handleFEFO}>
                    Calculate FEFO
                  </Button>
                </div>
                {fefoResult.length > 0 && (
                  <div className="fefo-results" style={{ marginTop: "20px" }}>
                    <h4>FEFO Allocation Results</h4>
                    <table>
                      <thead>
                        <tr>
                          <th>Batch Number</th>
                          <th>Quantity</th>
                          <th>Expiry Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fefoResult.map((allocation: any, index: number) => (
                          <tr key={index}>
                            <td>{allocation.batchNumber}</td>
                            <td>{allocation.quantity}</td>
                            <td>
                              {allocation.expiryDate
                                ? new Date(
                                    allocation.expiryDate,
                                  ).toLocaleDateString()
                                : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            ) : (
              <>
                <div
                  className="batches-toolbar"
                  style={{ marginBottom: "16px", display: "flex", gap: "8px" }}
                >
                  <Button
                    variant="primary"
                    onClick={() => setBatchViewMode("create")}
                  >
                    Create Batch
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setBatchViewMode("fefo")}
                  >
                    FEFO Calculator
                  </Button>
                </div>
                {batchLoading ? (
                  <LoadingState message="Loading batches..." />
                ) : batches.length === 0 ? (
                  <EmptyState message="No batches found for this item" />
                ) : (
                  <div className="batches-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Batch Number</th>
                          <th>Manufacturing Date</th>
                          <th>Expiry Date</th>
                          <th>Total Quantity</th>
                          <th>Expiry Status</th>
                          <th>Is Expired</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batches.map((batch) => (
                          <tr key={batch.id}>
                            <td>{batch.batchNumber}</td>
                            <td>
                              {new Date(
                                batch.manufacturingDate,
                              ).toLocaleDateString()}
                            </td>
                            <td>
                              {batch.expiryDate
                                ? new Date(
                                    batch.expiryDate,
                                  ).toLocaleDateString()
                                : "-"}
                            </td>
                            <td>{batch.totalQuantity}</td>
                            <td>
                              <span
                                className={`expiry-status-${batch.expiryStatus?.toLowerCase() || "unknown"}`}
                              >
                                {batch.expiryStatus || "-"}
                              </span>
                            </td>
                            <td>{batch.isExpired ? "Yes" : "No"}</td>
                            <td>
                              {batch.isExpired && (
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => {
                                    setBatchToDispose({
                                      batchNumber: batch.batchNumber,
                                      itemId:
                                        batch.itemId || selectedItemId || "",
                                    });
                                    setShowBatchDisposeDialog(true);
                                  }}
                                >
                                  Dispose
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {trackingSubView === "serials" && hasSerials && (
          <div className="serials-content">
            <div className="serials-list-section">
              {serialLoading ? (
                <LoadingState message="Loading serials..." />
              ) : serials.length === 0 ? (
                <EmptyState message="No serials found for this item. Use Global Search (Ctrl+K) to find serials." />
              ) : (
                <SerialGrid
                  serials={serials}
                  selectedSerials={selectedSerialIds}
                  onSerialClick={handleSerialClick}
                  onSerialSelect={(serialId, selected) => {
                    const newSelected = new Set(selectedSerialIds);
                    if (selected) {
                      newSelected.add(serialId);
                    } else {
                      newSelected.delete(serialId);
                    }
                    setSelectedSerialIds(newSelected);
                  }}
                  onSelectAll={(selected) => {
                    if (selected) {
                      setSelectedSerialIds(new Set(serials.map((s) => s.id)));
                    } else {
                      setSelectedSerialIds(new Set());
                    }
                  }}
                  sortColumn={serialSortColumn}
                  sortDirection={serialSortDirection}
                  onSort={handleSerialSort}
                  filters={serialFilters}
                  onFilterChange={handleSerialFilterChange}
                  loading={serialLoading}
                  selectedSerialId={searchParams.get("serialNumber") || null}
                />
              )}
            </div>
          </div>
        )}

        {trackingSubView === "expiry" && hasExpiry && (
          <div className="expiry-content">
            <div className="expiry-filters">
              <label>
                Days Ahead:
                <Input
                  type="number"
                  value={expiryDaysAhead}
                  onChange={(e) => {
                    const days = parseInt(e.target.value, 10) || 30;
                    setExpiryDaysAhead(days);
                    loadExpiryAlerts(selectedItemId || "");
                  }}
                  style={{ width: "100px", marginLeft: "10px" }}
                  min="1"
                />
              </label>
            </div>

            {expiryLoading ? (
              <LoadingState message="Loading expiry alerts..." />
            ) : expiryAlerts.length === 0 ? (
              <EmptyState message="No items expiring in the selected period" />
            ) : (
              <div className="expiry-alerts-table">
                <table>
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th>Batch</th>
                      <th>Quantity</th>
                      <th>Expiry Date</th>
                      <th>Days Until Expiry</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiryAlerts.map((alert, index) => (
                      <tr key={index}>
                        <td>{alert.location.code}</td>
                        <td>{alert.batchNumber || "-"}</td>
                        <td>{alert.quantity}</td>
                        <td>
                          {new Date(alert.expiryDate).toLocaleDateString()}
                        </td>
                        <td>
                          <span
                            className={
                              alert.daysUntilExpiry <= 0
                                ? "days-expired"
                                : alert.daysUntilExpiry <= 7
                                  ? "days-critical"
                                  : alert.daysUntilExpiry <= 30
                                    ? "days-warning"
                                    : "days-ok"
                            }
                          >
                            {alert.daysUntilExpiry <= 0
                              ? `Expired ${Math.abs(alert.daysUntilExpiry)} days ago`
                              : `${alert.daysUntilExpiry} days`}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`expiry-status-${alert.expiryStatus?.toLowerCase() || "unknown"}`}
                          >
                            {alert.expiryStatus || "-"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderHistoryView = () => {
    if (!selectedItem) return null;

    // Group stock by location (from Locations tab - now consolidated here)
    const historyLedgerRows = scopedStockLedgerRows;

    const stockByLocation = historyLedgerRows.reduce(
      (acc, stock) => {
        const locId = stock.locationId;
        if (!acc[locId]) {
          acc[locId] = {
            location: stock.location,
            onHand: 0,
            reserved: 0,
            available: 0,
          };
        }
        acc[locId].onHand += stock.onHandQuantity;
        acc[locId].reserved += stock.reservedQuantity;
        acc[locId].available += stock.availableQuantity;
        return acc;
      },
      {} as Record<
        string,
        {
          location: { id: string; code: string; name: string; type: string };
          onHand: number;
          reserved: number;
          available: number;
        }
      >,
    );

    return (
      <div className="history-view">
        {/* Locations Section (consolidated from Locations tab) */}
        <div className="history-section">
          <h4>Item Locations</h4>
          {Object.keys(stockByLocation).length === 0 ? (
            <EmptyState
              message={
                showVariantScopedStock
                  ? "No location stock for this variant."
                  : "No locations found for this item"
              }
            />
          ) : (
            <table className="locations-table">
              <thead>
                <tr>
                  <th>Location Code</th>
                  <th>Location Name</th>
                  <th>Type</th>
                  <th>On Hand</th>
                  <th>Reserved</th>
                  <th>Available</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(stockByLocation).map((locStock) => (
                  <tr key={locStock.location.id}>
                    <td>{locStock.location.code}</td>
                    <td>{locStock.location.name}</td>
                    <td>{locStock.location.type}</td>
                    <td>{locStock.onHand}</td>
                    <td>{locStock.reserved}</td>
                    <td>{locStock.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Movement History Section */}
        <div className="history-section">
          <h4>Movement History</h4>
          <div className="history-filters">
            <div className="filter-group">
              <label>Date From</label>
              <Input
                type="date"
                value={historyFilters.dateFrom}
                onChange={(e) =>
                  setHistoryFilters({
                    ...historyFilters,
                    dateFrom: e.target.value,
                  })
                }
              />
            </div>
            <div className="filter-group">
              <label>Date To</label>
              <Input
                type="date"
                value={historyFilters.dateTo}
                onChange={(e) =>
                  setHistoryFilters({
                    ...historyFilters,
                    dateTo: e.target.value,
                  })
                }
              />
            </div>
            <div className="filter-group">
              <label>Movement Type</label>
              <Select
                value={historyFilters.movementType}
                onChange={(e) =>
                  setHistoryFilters({
                    ...historyFilters,
                    movementType: e.target.value,
                  })
                }
              >
                <option value="">All Types</option>
                <option value="RECEIPT">Receipt</option>
                <option value="ISSUE">Issue</option>
                <option value="TRANSFER">Transfer</option>
                <option value="ADJUSTMENT">Adjustment</option>
                <option value="STOCK_MIGRATION">Stock Migration</option>
              </Select>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setHistoryFilters({
                  dateFrom: "",
                  dateTo: "",
                  movementType: "",
                  locationId: "",
                });
              }}
            >
              Clear Filters
            </Button>
          </div>

          {scopedMovementHistory.length === 0 ? (
            <EmptyState
              message={
                showVariantScopedStock
                  ? "No movement history for this variant."
                  : "No movement history found for this item"
              }
            />
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th>Transaction date</th>
                  <th>Movement Type</th>
                  <th>From Location</th>
                  <th>To Location</th>
                  <th>Quantity</th>
                  <th>Status</th>
                  <th>User</th>
                </tr>
              </thead>
              <tbody>
                {scopedMovementHistory.map((movement) => (
                  <tr key={movement.id}>
                    <td
                      title={
                        movement.postingDate
                          ? `Entered: ${new Date(movement.createdAt).toLocaleString()}`
                          : undefined
                      }
                    >
                      {new Date(movementTransactionIso(movement)).toLocaleDateString()}
                    </td>
                    <td>{getMovementTypeLabel(movement.movementType)}</td>
                    <td>{movement.fromLocation?.code || "-"}</td>
                    <td>{movement.toLocation?.code || "-"}</td>
                    <td>{movement.quantity}</td>
                    <td>
                      <span
                        className={`status-${movement.status.toLowerCase()}`}
                      >
                        {movement.status}
                      </span>
                    </td>
                    <td>
                      {movement.createdBy?.name ||
                        movement.createdBy?.email ||
                        "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderDetails = () => {
    if (!selectedItem) {
      return <LoadingState message="Loading item details..." />;
    }

    const trackingFlags = detailIndustryFlags(selectedItem);
    const showTrackingTab =
      selectedItem.itemType !== ItemType.MISC_NON_STOCK &&
      (trackingFlags.requiresBatchTracking ||
        trackingFlags.requiresSerialTracking ||
        trackingFlags.hasExpiryDate);

    return (
      <div className="item-master-details">
        <div className="item-detail-header-container">
          {renderDetailHeader()}
        </div>

        <div className="item-master-details-content">
          {/* Sub-tabs for item details */}
          {/* UI Governance: Maximum 3 sub-tabs enforced via ItemSubTab / MAX_SUB_TABS — do not add more without governance review */}
          <div className="item-sub-tabs">
            <button
              className={`item-sub-tab ${itemSubTab === "stock" ? "active" : ""}`}
              onClick={() => setItemSubTab("stock")}
            >
              Stock
            </button>
            {showTrackingTab && (
              <button
                className={`item-sub-tab ${itemSubTab === "tracking" ? "active" : ""}`}
                onClick={() => setItemSubTab("tracking")}
              >
                Tracking
              </button>
            )}
            <button
              className={`item-sub-tab ${itemSubTab === "history" ? "active" : ""}`}
              onClick={() => setItemSubTab("history")}
            >
              History
            </button>
            {/* UI Governance Note: If you need to add another tab, you've reached the maximum.
              Use modals, collapsible sections, or separate modules instead. */}
          </div>

          <div className="details-content">
            {/* Sub-tab content */}
            <div className="item-sub-content">
              {itemSubTab === "stock" && renderStockView()}
              {itemSubTab === "tracking" && renderTrackingView()}
              {itemSubTab === "history" && renderHistoryView()}
            </div>
          </div>
        </div>

        {/* Serial Detail Panel - Opens when serialNumber is in URL */}
        <SerialDetailPanel
          isOpen={!!searchParams.get("serialNumber")}
          onClose={() => {
            const params = new URLSearchParams(searchParams);
            params.delete("serialNumber");
            setSearchParams(params, { replace: true });
          }}
          serialNumber={searchParams.get("serialNumber")}
          onStatusUpdate={() => {
            // Refresh serial list when status is updated
            if (selectedItemId) {
              loadSerials(selectedItemId);
            }
          }}
        />
      </div>
    );
  };

  return (
    <div className="item-master">
      {listRowMenu
        ? createPortal(
            <div
              ref={listRowMenuRef}
              className="item-master-row-menu"
              style={{ left: listRowMenu.x, top: listRowMenu.y }}
              role="menu"
            >
              {listRowMenu.kind === "item" ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openEditMasterDrawer(listRowMenu.item)}
                  >
                    Edit Master
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openAddVariantDrawer(listRowMenu.item)}
                  >
                    Add variant
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      navigateMovementFromList(
                        listRowMenu.item.id,
                        MovementType.RECEIPT,
                        null,
                      )
                    }
                  >
                    Receive
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      navigateMovementFromList(
                        listRowMenu.item.id,
                        MovementType.ISSUE,
                        null,
                      )
                    }
                  >
                    Issue
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setListRowMenu(null);
                      setItemToDelete(listRowMenu.item.id);
                      setShowDeleteConfirm(true);
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      toggleItemActiveFromMenu(listRowMenu.item)
                    }
                  >
                    {listRowMenu.item.isActive
                      ? "Deactivate"
                      : "Activate"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      openVariantDetailsFromList(
                        listRowMenu.item,
                        listRowMenu.variant,
                      )
                    }
                  >
                    Open details
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void openVariantEditDrawer(
                        listRowMenu.item,
                        listRowMenu.variant.id,
                      )
                    }
                  >
                    Edit variant
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setListRowMenu(null);
                      setVariantDeleteTarget({
                        itemId: listRowMenu.item.id,
                        variantId: listRowMenu.variant.id,
                        label: `${listRowMenu.variant.name} (${listRowMenu.variant.code})`,
                      });
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      toggleVariantActiveFromMenu(
                        listRowMenu.item,
                        listRowMenu.variant,
                      )
                    }
                  >
                    {listRowMenu.variant.isActive === false
                      ? "Activate"
                      : "Deactivate"}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      navigateMovementFromList(
                        listRowMenu.item.id,
                        MovementType.ISSUE,
                        listRowMenu.variant.id,
                      )
                    }
                  >
                    Issue
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      navigateMovementFromList(
                        listRowMenu.item.id,
                        MovementType.RECEIPT,
                        listRowMenu.variant.id,
                      )
                    }
                  >
                    Receive
                  </button>
                </>
              )}
            </div>,
            document.body,
          )
        : null}

      <EditMasterDrawer
        isOpen={editMasterDrawerOpen}
        item={editMasterDrawerItem}
        onClose={() => {
          setEditMasterDrawerOpen(false);
          setEditMasterDrawerItem(null);
        }}
        onSave={async (itemId, payload) => {
          setError(null);
          setSuccess(null);
          try {
            await inventoryService.updateItem(itemId, payload);
            setSuccess("Master updated successfully");
            clearSuccessMessage();
            await loadItems();
            if (selectedItemId === itemId) {
              await loadItemDetails();
            }
          } catch (err: unknown) {
            setError(extractErrorMessage(err, "Failed to update master product"));
            logger.error(
              "[ItemMaster] Failed to update master product",
              err,
            );
          }
        }}
      />

      {addVariantContext || bulkVariantEditContext ? (
        <ProductVariantDetailsDrawer
          key={
            addVariantContext
              ? `add-variant-${addVariantContext.item.id}`
              : bulkVariantEditContext!.apiVariant.id
          }
          mode={addVariantContext ? "create" : "edit"}
          isOpen
          onClose={() => {
            setAddVariantContext(null);
            setBulkVariantEditContext(null);
          }}
          initialVariantRow={
            addVariantContext
              ? {
                  id: "new",
                  value: "",
                  name: "",
                  isActive: true,
                }
              : bulkVariantEditContext!.wizardRow
          }
          productDefaultUnit={
            (addVariantContext?.item ?? bulkVariantEditContext!.item)
              .unitOfMeasure?.trim() || "pcs"
          }
          unitOptions={variantDrawerUnitOptions}
          defaults={(() => {
            const item =
              addVariantContext?.item ?? bulkVariantEditContext!.item;
            return {
              costPrice: item.costPrice,
              sellingPrice: item.sellingPrice,
              mrp: undefined,
              tax: undefined,
              trackSerial: detailIndustryFlags(item).requiresSerialTracking,
              trackBatch: detailIndustryFlags(item).requiresBatchTracking,
              weight: item.weight?.value,
              dimensions: item.dimensions
                ? {
                    length: item.dimensions.length,
                    width: item.dimensions.width,
                    height: item.dimensions.height,
                  }
                : undefined,
              shelfLifeDays: undefined,
            };
          })()}
          baseSkuPreview={
            addVariantContext ? "" : bulkVariantEditContext!.apiVariant.code
          }
          trackingAllowed={
            resolveInventoryBehavior({
              productType: (addVariantContext?.item ?? bulkVariantEditContext!.item).productType,
              isMisc: (addVariantContext?.item ?? bulkVariantEditContext!.item).isMisc,
            }).trackingAllowed
          }
          existingVariantRows={
            addVariantContext
              ? inventoryVariantsToWizardRows(
                  variants.filter((v) => v.itemId === addVariantContext.item.id),
                )
              : undefined
          }
          onApply={(payload) => {
            if (addVariantContext) {
              const item = addVariantContext.item;
              const existingForItem = variants.filter(
                (v) => v.itemId === item.id,
              );
              try {
                const req = variantPatchToCreateRequest(
                  item.id,
                  payload.variantPatch,
                  existingForItem,
                );
                void inventoryService
                  .createVariant(req)
                  .then(async (created) => {
                    setSuccess(
                      created.migration
                        ? "Variant created; product-level stock assigned where needed."
                        : "Variant created successfully",
                    );
                    clearSuccessMessage();
                    setAddVariantContext(null);
                    await loadVariants(item.id);
                    await loadVariantStock(item.id);
                    if (selectedItemId === item.id) {
                      await loadStockData(item.id);
                    }
                    loadItems();
                  })
                  .catch((err) => {
                    setError(
                      extractErrorMessage(err, "Failed to create variant"),
                    );
                  });
              } catch (e: unknown) {
                setError(
                  e instanceof Error ? e.message : "Invalid variant data",
                );
              }
            } else {
              const ctx = bulkVariantEditContext!;
              const req = variantPatchToUpdateRequest(
                payload.variantPatch,
                ctx.apiVariant.metadata,
              );
              void inventoryService
                .updateVariant(ctx.apiVariant.id, req)
                .then(async () => {
                  setSuccess("Variant updated successfully");
                  clearSuccessMessage();
                  setBulkVariantEditContext(null);
                  await loadVariants(ctx.item.id);
                  await loadVariantStock(ctx.item.id);
                  if (selectedItemId === ctx.item.id) {
                    await loadStockData(ctx.item.id);
                  }
                  loadItems();
                })
                .catch((err) => {
                  setError(
                    extractErrorMessage(err, "Failed to update variant"),
                  );
                });
            }
          }}
        />
      ) : null}
      {viewMode === "add" && (
        <ProductCreationWizard
          onSuccess={(createdItemId, saveAndNew) => {
            if (saveAndNew) {
              loadItems();
            } else {
              if (createdItemId) {
                setSelectedItemId(createdItemId);
                setViewMode("details");
                setSearchParams((p) => {
                  const next = new URLSearchParams(p);
                  next.set("itemId", createdItemId);
                  return next;
                });
              } else {
                setViewMode("list");
              }
              loadItems();
            }
          }}
          onCancel={() => {
            setViewMode("list");
            setSearchParams(
              (prev) => stripItemMasterSelectionFromParams(prev),
              { replace: true },
            );
          }}
        />
      )}
      {(viewMode === "list" || viewMode === "details") && (
        <div
          className={`item-master-container ${selectedItemId && viewMode === "details" ? "split-view" : "full-view"}`}
        >
          {selectedItemId && viewMode === "details" ? (
            <ResizableSplitPane
              left={renderList()}
              right={
                selectedItem ? (
                  renderDetails()
                ) : (
                  <div className="item-details-placeholder">
                    <h3>No Item Selected</h3>
                    <p>Select an item from the list to view details</p>
                  </div>
                )
              }
              leftMin={200}
              leftMaxPercent={60}
              rightMin={400}
              storageKey="item-master-split-ratio"
              defaultLeftPercent={60}
              leftClassName="item-master-list-panel"
              rightClassName="item-master-details-panel"
            />
          ) : (
            <div className="item-master-list-panel">{renderList()}</div>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Item"
        message="Permanently delete this product? This also deletes ALL of its variants, serial numbers, batches, stock, and movement history. This cannot be undone."
        onConfirm={() => handleDelete()}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setItemToDelete(null);
        }}
        variant="danger"
      />
      <ConfirmDialog
        isOpen={!!variantDeleteTarget}
        title="Delete variant"
        message={
          variantDeleteTarget
            ? `Permanently delete variant "${variantDeleteTarget.label}"? This also deletes its serial numbers, stock, and movement history. This cannot be undone.`
            : ""
        }
        onConfirm={() => void handleConfirmVariantDelete()}
        onCancel={() => setVariantDeleteTarget(null)}
        variant="danger"
      />
      <ConfirmDialog
        isOpen={showBatchDisposeDialog}
        title="Dispose Batch"
        message={`Are you sure you want to dispose batch ${batchToDispose?.batchNumber}?`}
        onConfirm={() => {
          if (disposeReason.trim()) {
            handleDisposeBatch(disposeReason);
          } else {
            setError("Please provide a reason for disposal");
          }
        }}
        onCancel={() => {
          setShowBatchDisposeDialog(false);
          setBatchToDispose(null);
          setDisposeReason("");
        }}
        variant="danger"
        employeeName=""
      />
      {showBatchDisposeDialog && (
        <div
          style={{
            marginTop: "12px",
            padding: "12px",
            backgroundColor: "#f9f9f9",
            borderRadius: "8px",
          }}
        >
          <label
            style={{ display: "block", marginBottom: "8px", fontWeight: "500" }}
          >
            Reason for Disposal *
          </label>
          <Input
            value={disposeReason}
            onChange={(e) => setDisposeReason(e.target.value)}
            placeholder="Enter reason for batch disposal"
            style={{ width: "100%" }}
          />
        </div>
      )}

      <ConfirmDialog
        isOpen={showUnsavedDialog}
        title="Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to leave? All unsaved changes will be lost."
        onConfirm={() => {
          setHasUnsavedChanges(false);
          setShowUnsavedDialog(false);
          if (pendingNavigation) {
            pendingNavigation();
            setPendingNavigation(null);
          }
        }}
        onCancel={() => {
          setShowUnsavedDialog(false);
          setPendingNavigation(null);
        }}
        variant="warning"
      />

      <Modal
        isOpen={Boolean(reconcilePendingFile)}
        onClose={() => {
          if (reconciling) return;
          setReconcilePendingFile(null);
          setReconcileLocationId("");
        }}
        title="Reconcile stock & serials"
        size="sm"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ margin: 0, color: "var(--text-secondary, #666)" }}>
            The "Stock (On Hand)" and "Serial Numbers" data in <strong>{reconcilePendingFile?.name}</strong> will
            be checked against one location. A blank Stock cell counts as zero. A SKU with no matching product in
            the catalog is created fresh from this file's "Products" sheet. The resulting Stock Count is submitted
            and approved automatically — changes apply to live stock immediately, with no separate review step.
          </p>
          <Select
            label="Location"
            value={reconcileLocationId}
            onChange={(e) => setReconcileLocationId(e.target.value)}
            disabled={reconciling}
          >
            <option value="">Select a location…</option>
            {reconcileLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name} ({loc.code})
              </option>
            ))}
          </Select>
          {reconciling && reconcileProgress ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "var(--text-secondary, #666)" }}>
                <span>{reconcileProgress.phase}…</span>
                <span>
                  {reconcileProgress.total > 1
                    ? `${reconcileProgress.current} / ${reconcileProgress.total}`
                    : ""}
                </span>
              </div>
              <div style={{ height: "8px", borderRadius: "4px", background: "var(--border-light, #e5e7eb)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    borderRadius: "4px",
                    background: "var(--primary-500, #2563eb)",
                    width: `${Math.min(100, Math.round((reconcileProgress.current / Math.max(1, reconcileProgress.total)) * 100))}%`,
                    transition: "width 150ms ease-out",
                  }}
                />
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <Button
              variant="secondary"
              onClick={() => {
                if (reconciling) {
                  // No client-side timeout runs anymore (see handleRunReconcile) — this is the
                  // only way out of a run that's genuinely stuck, not just slow. Aborting rejects
                  // whatever call is in flight, which the catch block turns into a clear
                  // "stopped, nothing further applied" message rather than a raw cancel error.
                  reconcileAbortRef.current?.abort();
                  return;
                }
                setReconcilePendingFile(null);
                setReconcileLocationId("");
              }}
            >
              {reconciling ? "Stop" : "Cancel"}
            </Button>
            <Button
              variant="primary"
              disabled={reconciling || !reconcileLocationId}
              onClick={() => void handleRunReconcile()}
            >
              {reconciling ? `⏳ ${reconcileProgress?.phase ?? "Reconciling"}…` : "Build Stock Count"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
