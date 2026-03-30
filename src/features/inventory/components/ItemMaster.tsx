/**
 * Item Master Component - Manage inventory items
 *
 * UI GOVERNANCE RULES:
 * - Maximum 6 sub-tabs (FIXED - no additions allowed)
 * - Maximum 6 wizard steps
 * - Maximum 5 collapsible sections in Overview
 * - Maximum 3 sub-views per tab
 * - No operational data (stock levels, pricing, suppliers)
 *
 * Before adding features, review: ITEM_MASTER_UI_GOVERNANCE.md
 * Developer checklist: ITEM_MASTER_DEVELOPER_CHECKLIST.md
 * Code review guide: CODE_REVIEW_GUIDELINES_ITEM_MASTER.md
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  inventoryService,
  InventoryItem,
  CreateInventoryItemRequest,
  UpdateInventoryItemRequest,
  IndustryType,
  MovementType,
  SerialResponse,
} from "@/services/inventory.service";
import { getDefaultReason, getMovementTypeLabel } from "../constants/movementReasonMapping";
import {
  Button,
  Input,
  Card,
  Select,
  ImageUpload,
  Checkbox,
} from "@/shared/components/ui";
import { LoadingState, EmptyState } from "@/shared/components/data-display";
import { extractErrorMessage } from "@/utils/error";
import { logger } from "@/shared/utils/logger";
import { ConfirmDialog } from "@/shared/components/modals";
import { ResizableSplitPane } from "@/shared/components/layout";
import { VariantManagement } from "./VariantManagement";
import { SerialGrid } from "./SerialGrid";
import { SerialDetailPanel } from "./SerialDetailPanel";
import { ProductCreationWizard } from "./ProductCreationWizard/ProductCreationWizard";
import {
  ItemSubTab,
  validateCollapsibleSections,
  validateSubViews,
} from "../constants/ui-governance.constants";
import { VARIANT_UNIT_OPTIONS } from "./ProductCreationWizard/variantGridUnits";
import "./ItemMaster.css";
import "./ProductCreationWizard/ProductCreationWizard.css";

type ViewMode = "list" | "details" | "add";

const DEFAULT_ITEM_CATEGORY = "electronics";

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

export const ItemMaster: React.FC = () => {
  const navigate = useNavigate();
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
  const [categories, setCategories] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterIndustryType, setFilterIndustryType] = useState<string>("");
  const [filterStockStatus, setFilterStockStatus] = useState<string>("");
  const [filterExpiryRisk, setFilterExpiryRisk] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  // Variant management removed from list view - use Product Details → Variants tab instead
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, _setItemsPerPage] = useState(50);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropTargetItemId, setDropTargetItemId] = useState<string | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [itemSubTab, setItemSubTab] = useState<ItemSubTab>("overview");
  const [trackingSubView, setTrackingSubView] = useState<
    "batches" | "serials" | "expiry"
  >("batches");

  // Auto-set tracking sub-view when item changes
  useEffect(() => {
    if (selectedItem && itemSubTab === "tracking") {
      if (selectedItem.industryFlags.requiresBatchTracking) {
        setTrackingSubView("batches");
      } else if (selectedItem.industryFlags.requiresSerialTracking) {
        setTrackingSubView("serials");
      } else if (selectedItem.industryFlags.hasExpiryDate) {
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
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<any>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<
    (() => void) | null
  >(null);
  const [variants, setVariants] = useState<any[]>([]);
  const [variantStockByItem, setVariantStockByItem] = useState<
    Record<string, VariantStockRow[]>
  >({});
  const [optimisticMigration, setOptimisticMigration] = useState<{
    variantId: string;
    ledgerModified: number;
    serialModified: number;
  } | null>(null);
  const [legacyRebalanceLoading, setLegacyRebalanceLoading] = useState(false);
  const optimisticMigrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Stock summary for inline expansion
  const [itemStockSummaries, setItemStockSummaries] = useState<
    Record<
      string,
      {
        totalOnHand: number;
        totalReserved: number;
        totalAvailable: number;
        locationCount: number;
      }
    >
  >({});

  // Expiry alerts for filtering
  const [expiryAlertsMap, setExpiryAlertsMap] = useState<
    Record<
      string,
      {
        daysUntilExpiry: number;
        expiryStatus: string;
      }
    >
  >({});

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [successTimeout, setSuccessTimeout] = useState<NodeJS.Timeout | null>(
    null,
  );

  const [formData, setFormData] = useState<CreateInventoryItemRequest>({
    sku: "",
    name: "",
    description: "",
    category: "",
    barcode: "",
    unitOfMeasure: "pcs",
    unitConversions: [],
    industryFlags: {
      isPerishable: false,
      requiresBatchTracking: false,
      requiresSerialTracking: false,
      hasExpiryDate: false,
      isHighValue: false,
      industryType: IndustryType.WAREHOUSE,
    },
    images: [],
    dimensions: undefined,
    weight: undefined,
    tags: [],
    costPrice: undefined,
    sellingPrice: undefined,
    margin: undefined,
  });

  // Ref to track if we've processed the edit param
  const editParamProcessed = useRef(false);

  const categorySelectOptions = useMemo(() => {
    const set = new Set<string>([DEFAULT_ITEM_CATEGORY, ...categories]);
    const cur = formData.category?.trim();
    if (cur) set.add(cur);
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [categories, formData.category]);

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
    loadCategories();

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
        setSearchParams({}, { replace: true });
      }
    }

    // Reset the ref when searchParams change (new edit param)
    if (!searchParams.get("edit")) {
      editParamProcessed.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString(), items.length]); // Only check when searchParams or items length changes

  // Handle itemId, variantId, itemSubTab, and locationId from URL for deep linking
  const locationIdFromUrl = searchParams.get("locationId");

  useEffect(() => {
    const itemId = searchParams.get("itemId");
    const variantId = searchParams.get("variantId");
    const subTab = searchParams.get("itemSubTab") as ItemSubTab | null;
    const locationId = searchParams.get("locationId");

    if (itemId) {
      // Always set view mode to details and selectedItemId when itemId is in URL
      // This ensures deep linking works correctly even if items haven't loaded yet
      setSelectedItemId(itemId);
      setViewMode("details");

      // Check for serialNumber param - if present, switch to tracking tab
      const serialNumber = searchParams.get("serialNumber");
      if (serialNumber) {
        setItemSubTab("tracking");
        setTrackingSubView("serials");
      }

      // Set sub-tab and variant ID
      if (
        subTab &&
        [
          "overview",
          "edit",
          "variants",
          "stock",
          "tracking",
          "history",
        ].includes(subTab)
      ) {
        setItemSubTab(subTab);
      } else if (variantId) {
        setItemSubTab("variants");
        setSelectedVariantId(variantId);
      } else if (!serialNumber) {
        // Only set to overview if no serialNumber (serialNumber already sets to tracking)
        setItemSubTab("overview");
      }

      if (variantId) {
        setSelectedVariantId(variantId);
      }

      // Store locationId for Stock tab highlighting (we'll use it in renderStockView)
      if (locationId && subTab === "stock") {
        // LocationId will be used in renderStockView to highlight the row
      }
    } else {
      // If no itemId in URL, clear selection and return to list view
      setSelectedItemId(null);
      setViewMode("list");
      // Still apply itemSubTab from URL so "Item Variants" / "Serial Tracking" from global search open with correct sub-tab
      if (
        subTab &&
        ["overview", "edit", "variants", "stock", "tracking", "history"].includes(subTab)
      ) {
        setItemSubTab(subTab);
      }
    }
  }, [searchParams]);

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
        if (e.key === "Escape" && editingField) {
          cancelInlineEdit();
        }
        return;
      }

      // Ctrl/Cmd + F: Focus search
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        const searchInput = document.querySelector(
          'input[placeholder*="Search"]',
        ) as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
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
              setFieldErrors({});
            });
            setShowUnsavedDialog(true);
          } else {
            setViewMode("list");
            setFieldErrors({});
          }
        } else if (viewMode === "details" && selectedItemId) {
          setSelectedItemId(null);
          setViewMode("list");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [viewMode, selectedItemId, editingField, hasUnsavedChanges]);

  // Define loadItems before useEffect that uses it
  const loadItems = useCallback(async () => {
    if (loadingItemsRef.current) return; // Prevent concurrent calls
    loadingItemsRef.current = true;
    setLoading(true);
    setError(null);
    try {
      let data = await inventoryService.getAllItems({
        search: searchTerm || undefined,
        category: filterCategory || undefined,
      });

      let summariesForStockFilter: Record<
        string,
        {
          totalOnHand: number;
          totalReserved: number;
          totalAvailable: number;
          locationCount: number;
        }
      > = {};
      let alertsMapForExpiryFilter: Record<
        string,
        { daysUntilExpiry: number; expiryStatus: string }
      > = {};

      // Load stock summaries and expiry alerts if needed for filtering
      if (filterStockStatus || filterExpiryRisk) {
        const [summariesFromLoad, expiryAlerts] = await Promise.all([
          loadItemStockSummaries(data),
          filterExpiryRisk
            ? loadExpiryAlertsForFiltering()
            : Promise.resolve([]),
        ]);

        if (filterStockStatus) {
          summariesForStockFilter = summariesFromLoad;
        }

        if (filterExpiryRisk) {
          const alertsMap: Record<
            string,
            { daysUntilExpiry: number; expiryStatus: string }
          > = {};
          expiryAlerts.forEach((alert: any) => {
            if (
              !alertsMap[alert.itemId] ||
              alertsMap[alert.itemId].daysUntilExpiry > alert.daysUntilExpiry
            ) {
              alertsMap[alert.itemId] = {
                daysUntilExpiry: alert.daysUntilExpiry,
                expiryStatus: alert.expiryStatus,
              };
            }
          });
          alertsMapForExpiryFilter = alertsMap;
          setExpiryAlertsMap(alertsMap);
        }
      } else {
        // Load stock summaries in background for inline expansion
        loadItemStockSummaries(data).catch((err) => {
          logger.error("[ItemMaster] Failed to load stock summaries", err);
        });
      }

      // Apply client-side filters
      if (filterIndustryType) {
        data = data.filter(
          (item) => item.industryFlags.industryType === filterIndustryType,
        );
      }
      if (filterStockStatus) {
        data = data.filter((item) => {
          const summary = summariesForStockFilter[item.id];
          if (!summary) return false;

          switch (filterStockStatus) {
            case "in-stock":
              return summary.totalOnHand > 0;
            case "low-stock":
              // Low stock filter removed - stock levels are managed in separate modules
              return false;
            case "out-of-stock":
              return summary.totalOnHand === 0;
            default:
              return true;
          }
        });
      }
      if (filterExpiryRisk) {
        data = data.filter((item) => {
          const alert = alertsMapForExpiryFilter[item.id];
          if (!alert) return false;

          switch (filterExpiryRisk) {
            case "expired":
              return alert.daysUntilExpiry < 0;
            case "critical":
              return alert.daysUntilExpiry >= 0 && alert.daysUntilExpiry <= 7;
            case "warning":
              return alert.daysUntilExpiry > 7 && alert.daysUntilExpiry <= 30;
            default:
              return true;
          }
        });
      }

      // Apply sorting
      if (sortColumn) {
        data = [...data].sort((a, b) => {
          let aVal: any;
          let bVal: any;

          switch (sortColumn) {
            case "sku":
              aVal = a.sku.toLowerCase();
              bVal = b.sku.toLowerCase();
              break;
            case "name":
              aVal = a.name.toLowerCase();
              bVal = b.name.toLowerCase();
              break;
            case "category":
              aVal = (a.category || "").toLowerCase();
              bVal = (b.category || "").toLowerCase();
              break;
            case "unit":
              aVal = a.unitOfMeasure.toLowerCase();
              bVal = b.unitOfMeasure.toLowerCase();
              break;
            case "industry":
              aVal = a.industryFlags.industryType.toLowerCase();
              bVal = b.industryFlags.industryType.toLowerCase();
              break;
            case "status":
              aVal = a.isActive ? 1 : 0;
              bVal = b.isActive ? 1 : 0;
              break;
            default:
              return 0;
          }

          if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
          if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
          return 0;
        });
      }

      setItems(data);
      // Reset to first page when filters change
      setCurrentPage(1);
    } catch (err: any) {
      const message = extractErrorMessage(err, "Failed to load items");
      setError(message);
      logger.error("[ItemMaster] Failed to load items", err);
    } finally {
      setLoading(false);
      loadingItemsRef.current = false;
    }
  }, [
    searchTerm,
    filterCategory,
    filterIndustryType,
    filterStockStatus,
    filterExpiryRisk,
    sortColumn,
    sortDirection,
  ]);

  useEffect(() => {
    if (viewMode === "list") {
      // Create a key for this load combination
      const loadKey = `${searchTerm}-${filterCategory}-${filterIndustryType}-${filterStockStatus}-${filterExpiryRisk}-${sortColumn}-${sortDirection}`;
      if (loadKey === lastItemsLoadRef.current) return; // Already loaded this combination
      loadItems();
      lastItemsLoadRef.current = loadKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewMode,
    searchTerm,
    filterCategory,
    filterIndustryType,
    filterStockStatus,
    filterExpiryRisk,
    sortColumn,
    sortDirection,
    loadItems,
  ]);

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

    if (itemSubTab === "edit") {
      // Initialize formData when Edit tab is opened
      setFormData({
        sku: selectedItem.sku,
        name: selectedItem.name,
        description: selectedItem.description || "",
        category: selectedItem.category || "",
        barcode: selectedItem.barcode || "",
        unitOfMeasure: selectedItem.unitOfMeasure,
        unitConversions: selectedItem.unitConversions,
        industryFlags: selectedItem.industryFlags,
        images: selectedItem.images || [],
        dimensions: selectedItem.dimensions,
        weight: selectedItem.weight,
        tags: selectedItem.tags || [],
        costPrice: selectedItem.costPrice,
        sellingPrice: selectedItem.sellingPrice,
        margin: selectedItem.margin,
      });
      setHasUnsavedChanges(false);
    } else if (itemSubTab === "variants") {
      loadVariants(selectedItemId);
      loadVariantStock(selectedItemId);
    } else if (itemSubTab === "stock") {
      loadStockData(selectedItemId);
    }

    // Update last loaded ref
    lastLoadedRef.current = { itemId: selectedItemId, subTab: itemSubTab };
    // Note: selectedItem is checked but not in deps to avoid loops when object reference changes
    // We use selectedItem?.id as a stable dependency instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSubTab, selectedItemId, viewMode, loadStockData, selectedItem?.id]);

  // Clear optimistic migration when server stock data catches up (replica / cache)
  useEffect(() => {
    if (!optimisticMigration) return;
    const total = stockData
      .filter((s) => s.variantId === optimisticMigration.variantId)
      .reduce((sum, s) => sum + s.onHandQuantity, 0);
    if (total >= optimisticMigration.ledgerModified) {
      setOptimisticMigration(null);
    }
  }, [stockData, optimisticMigration]);

  // Safety: clear optimistic migration after 5s to avoid double-counting
  useEffect(() => {
    if (!optimisticMigration) return;
    if (optimisticMigrationTimeoutRef.current) clearTimeout(optimisticMigrationTimeoutRef.current);
    optimisticMigrationTimeoutRef.current = setTimeout(() => {
      setOptimisticMigration(null);
      optimisticMigrationTimeoutRef.current = null;
    }, 5000);
    return () => {
      if (optimisticMigrationTimeoutRef.current) {
        clearTimeout(optimisticMigrationTimeoutRef.current);
        optimisticMigrationTimeoutRef.current = null;
      }
    };
  }, [optimisticMigration]);

  const loadExpiryAlertsForFiltering = async () => {
    try {
      const alerts = await inventoryService.getExpiryAlerts(30);
      return alerts;
    } catch (err: any) {
      logger.error(
        "[ItemMaster] Failed to load expiry alerts for filtering",
        err,
      );
      return [];
    }
  };

  const loadItemDetails = async () => {
    if (!selectedItemId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getItemById(selectedItemId);
      setSelectedItem(data);

      // Load variants and variant stock if item has variants
      if (data.hasVariants) {
        await Promise.all([
          loadVariants(selectedItemId),
          loadVariantStock(selectedItemId),
        ]);
      } else {
        // Only remove variants for this item, keep variants from other items
        setVariants((prevVariants) =>
          prevVariants.filter((v) => v.itemId !== selectedItemId),
        );
        setVariantStockByItem((prev) => {
          const next = { ...prev };
          delete next[selectedItemId];
          return next;
        });
      }

      // Load batches if item requires batch tracking
      if (data.industryFlags.requiresBatchTracking) {
        await loadBatches(selectedItemId);
      }

      // Load serials if item requires serial tracking
      if (data.industryFlags.requiresSerialTracking) {
        await loadSerials(selectedItemId);
      }

      // Load expiry alerts if item has expiry date
      if (data.industryFlags.hasExpiryDate) {
        await loadExpiryAlerts();
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
      const alerts = await inventoryService.getExpiryAlerts(expiryDaysAhead);
      // Filter by itemId if provided
      const filteredAlerts = itemId
        ? alerts.filter((alert) => alert.itemId === itemId)
        : alerts;
      setExpiryAlerts(filteredAlerts);
    } catch (err: any) {
      logger.error("[ItemMaster] Failed to load expiry alerts", err);
      setExpiryAlerts([]);
    } finally {
      setExpiryLoading(false);
    }
  };

  useEffect(() => {
    // Reload history when filters change
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
      logger.info(
        `[ItemMaster] Loaded ${data.length} variants for item ${itemId}`,
        { count: data.length, itemId },
      );
      // Merge variants: keep variants from other items, replace variants for this item
      setVariants((prevVariants) => {
        const otherItemVariants = prevVariants.filter(
          (v) => v.itemId !== itemId,
        );
        const merged = [...otherItemVariants, ...data];
        logger.info(
          `[ItemMaster] Merged variants: ${merged.length} total (${data.length} for item ${itemId})`,
        );
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

  const handleRebalanceLegacyStock = async () => {
    if (!selectedItemId || legacyRebalanceLoading) return;
    setLegacyRebalanceLoading(true);
    setError(null);
    try {
      const result =
        await inventoryService.migrateProductLevelStockToDefaultVariant(
          selectedItemId,
        );
      setOptimisticMigration({
        variantId: result.defaultVariantId,
        ledgerModified: result.ledgerModified || 0,
        serialModified: result.serialModified || 0,
      });
      await Promise.all([
        loadStockData(selectedItemId),
        loadVariantStock(selectedItemId),
        loadVariants(selectedItemId),
      ]);
      setSuccess("Legacy unassigned stock was rebalanced successfully.");
    } catch (err: any) {
      setError(extractErrorMessage(err, "Failed to rebalance legacy stock"));
    } finally {
      setLegacyRebalanceLoading(false);
    }
  };

  const loadItemStockSummaries = async (
    items: InventoryItem[],
  ): Promise<
    Record<
      string,
      {
        totalOnHand: number;
        totalReserved: number;
        totalAvailable: number;
        locationCount: number;
      }
    >
  > => {
    try {
      const summaries: Record<
        string,
        {
          totalOnHand: number;
          totalReserved: number;
          totalAvailable: number;
          locationCount: number;
        }
      > = {};

      const CHUNK_SIZE = 75;
      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (item) => {
            try {
              const stockData = await inventoryService.getStockByItem(item.id);
              const totalOnHand = stockData.reduce(
                (sum, s) => sum + s.onHandQuantity,
                0,
              );
              const totalReserved = stockData.reduce(
                (sum, s) => sum + s.reservedQuantity,
                0,
              );
              const totalAvailable = stockData.reduce(
                (sum, s) => sum + s.availableQuantity,
                0,
              );
              const locationCount = new Set(stockData.map((s) => s.locationId))
                .size;

              summaries[item.id] = {
                totalOnHand,
                totalReserved,
                totalAvailable,
                locationCount,
              };
            } catch (err) {
              summaries[item.id] = {
                totalOnHand: 0,
                totalReserved: 0,
                totalAvailable: 0,
                locationCount: 0,
              };
            }
          }),
        );
      }

      setItemStockSummaries(summaries);
      return summaries;
    } catch (err: any) {
      logger.error("[ItemMaster] Failed to load stock summaries", err);
      return {};
    }
  };

  const toggleRowExpand = async (itemId: string) => {
    const newExpanded = new Set(expandedRows);
    const isCurrentlyExpanded = newExpanded.has(itemId);

    if (isCurrentlyExpanded) {
      newExpanded.delete(itemId);
      setExpandedRows(newExpanded);
    } else {
      newExpanded.add(itemId);
      // Set expanded state immediately so row expands right away
      setExpandedRows(newExpanded);

      // Always try to load variants when expanding, regardless of hasVariants flag
      // The flag might not be set correctly, but variants could still exist
      const item = items.find((i) => i.id === itemId);
      logger.info(
        `[ItemMaster] Expanding row for item ${itemId}, hasVariants: ${item?.hasVariants}`,
      );

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
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const handleSelectItem = (itemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleSelectAll = () => {
    const pageItems = items.slice(
      (currentPage - 1) * itemsPerPage,
      currentPage * itemsPerPage,
    );
    if (selectedItems.size === pageItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(pageItems.map((item) => item.id)));
    }
  };

  const handleBulkAction = async (
    action: "activate" | "deactivate" | "delete",
  ) => {
    if (selectedItems.size === 0) return;

    setBulkActionLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const itemIds = Array.from(selectedItems);

      if (action === "delete") {
        // Show confirmation dialog
        if (
          !window.confirm(
            `Are you sure you want to delete ${itemIds.length} item(s)? This action cannot be undone.`,
          )
        ) {
          setBulkActionLoading(false);
          return;
        }

        await Promise.all(itemIds.map((id) => inventoryService.deleteItem(id)));
        setSuccess(`${itemIds.length} item(s) deleted successfully`);
      } else {
        const isActive = action === "activate";
        await Promise.all(
          itemIds.map((id) => inventoryService.updateItem(id, { isActive })),
        );
        setSuccess(
          `${itemIds.length} item(s) ${action === "activate" ? "activated" : "deactivated"} successfully`,
        );
      }

      clearSuccessMessage();
      setSelectedItems(new Set());
      await loadItems();
      if (selectedItemId && itemIds.includes(selectedItemId)) {
        await loadItemDetails();
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, `Failed to ${action} items`);
      setError(message);
      logger.error("[ItemMaster] Failed to perform bulk action", err);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleExportCSV = () => {
    const csvData = items.map((item) => ({
      SKU: item.sku,
      Name: item.name,
      Category: item.category || "",
      "Unit of Measure": item.unitOfMeasure,
      Industry: item.industryFlags.industryType,
      Status: item.isActive ? "Active" : "Inactive",
    }));

    const headers = Object.keys(csvData[0]);
    const csvContent = [
      headers.join(","),
      ...csvData.map((row) =>
        headers
          .map((header) => {
            const value = row[header as keyof typeof row];
            return typeof value === "string" && value.includes(",")
              ? `"${value}"`
              : value;
          })
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `items_export_${new Date().toISOString().split("T")[0]}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const loadHistoryData = async (itemId: string) => {
    try {
      const filters: any = { itemId };
      if (historyFilters.dateFrom) filters.dateFrom = historyFilters.dateFrom;
      if (historyFilters.dateTo) filters.dateTo = historyFilters.dateTo;
      if (historyFilters.movementType)
        filters.movementType = historyFilters.movementType;
      if (historyFilters.locationId)
        filters.fromLocationId = historyFilters.locationId;
      const data = await inventoryService.getAllMovements(filters);
      setHistoryData(data);
    } catch (err: any) {
      logger.error("[ItemMaster] Failed to load history data", err);
      setHistoryData([]);
    }
  };

  const toggleSectionCollapse = (sectionId: string) => {
    const newCollapsed = new Set(collapsedSections);
    if (newCollapsed.has(sectionId)) {
      newCollapsed.delete(sectionId);
    } else {
      newCollapsed.add(sectionId);
    }
    setCollapsedSections(newCollapsed);
  };

  const loadCategories = async () => {
    try {
      const data = await inventoryService.getCategories();
      setCategories(data);
    } catch (err) {
      logger.error("[ItemMaster] Failed to load categories", err);
    }
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    const newFieldErrors: Record<string, string> = {};

    // SKU: assigned by server on create if omitted; if present, validate format
    if (formData.sku?.trim() && !/^[A-Z0-9-_]+$/.test(formData.sku)) {
      errors.push(
        "SKU must contain only uppercase letters, numbers, hyphens, and underscores",
      );
      newFieldErrors.sku =
        "SKU must contain only uppercase letters, numbers, hyphens, and underscores";
    }

    // Name validation
    if (!formData.name?.trim()) {
      errors.push("Name is required");
      newFieldErrors.name = "Name is required";
    } else if (formData.name.trim().length > 500) {
      errors.push("Name must be 500 characters or less");
      newFieldErrors.name = "Name must be 500 characters or less";
    }

    // Unit of Measure validation
    if (!formData.unitOfMeasure?.trim()) {
      errors.push("Unit of Measure is required");
      newFieldErrors.unitOfMeasure = "Unit of Measure is required";
    }

    // Unit conversions validation
    if (formData.unitConversions && formData.unitConversions.length > 0) {
      formData.unitConversions.forEach((conv, index) => {
        if (!conv.fromUnit?.trim() || !conv.toUnit?.trim()) {
          errors.push(
            `Unit conversion ${index + 1}: From and To units are required`,
          );
          newFieldErrors[`unitConversion_${index}`] =
            "From and To units are required";
        }
        if (conv.conversionFactor <= 0) {
          errors.push(
            `Unit conversion ${index + 1}: Conversion factor must be greater than 0`,
          );
          newFieldErrors[`unitConversion_${index}`] =
            "Conversion factor must be greater than 0";
        }
      });
    }

    // Industry flags validation
    const flags = formData.industryFlags;

    // Rule 1: Serial Tracking + Batch Tracking are mutually exclusive
    if (flags.requiresSerialTracking && flags.requiresBatchTracking) {
      errors.push(
        "Items cannot have both serial tracking and batch tracking enabled. They are mutually exclusive.",
      );
      newFieldErrors["industryFlags.batchSerial"] =
        "Serial tracking and batch tracking cannot both be enabled";
    }

    // Rule 2: Perishable + Batch Tracking → Must have Expiry Date
    if (
      flags.requiresBatchTracking &&
      flags.isPerishable &&
      !flags.hasExpiryDate
    ) {
      errors.push(
        "Perishable items with batch tracking must have expiry date enabled",
      );
      newFieldErrors["industryFlags.perishableExpiry"] =
        "Perishable items with batch tracking must have expiry date enabled";
    }

    setFieldErrors(newFieldErrors);
    return errors;
  };

  const clearSuccessMessage = () => {
    if (successTimeout) {
      clearTimeout(successTimeout);
    }
    const timeout = setTimeout(() => {
      setSuccess(null);
    }, 5000); // Show success message for 5 seconds
    setSuccessTimeout(timeout);
  };

  const handleUpdate = async () => {
    if (!selectedItemId) return;
    setError(null);
    setSuccess(null);
    setFieldErrors({});

    // Validate form before submission
    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setError(validationErrors.join(". "));
      return;
    }

    try {
      const costPrice = formData.costPrice;
      const sellingPrice = formData.sellingPrice;
      const margin =
        costPrice != null && costPrice > 0 && sellingPrice != null
          ? ((sellingPrice - costPrice) / costPrice) * 100
          : formData.margin;
      const updateData: UpdateInventoryItemRequest = {
        name: formData.name,
        description: formData.description,
        category: formData.category,
        barcode: formData.barcode,
        unitOfMeasure: formData.unitOfMeasure,
        unitConversions: formData.unitConversions,
        industryFlags: formData.industryFlags,
        images: formData.images,
        dimensions: formData.dimensions,
        weight: formData.weight,
        tags: formData.tags,
        costPrice: formData.costPrice,
        sellingPrice: formData.sellingPrice,
        margin,
      };
      await inventoryService.updateItem(selectedItemId, updateData);
      setSuccess("Item updated successfully");
      clearSuccessMessage();
      setViewMode("details");
      setItemSubTab("overview");
      setFieldErrors({});
      setHasUnsavedChanges(false);
      await loadItemDetails();
      loadItems();
    } catch (err: any) {
      const message = extractErrorMessage(err, "Failed to update item");
      setError(message);
      logger.error("[ItemMaster] Failed to update item", err);
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
      }
      loadItems();
    } catch (err: any) {
      const message = extractErrorMessage(err, "Failed to delete item");
      setError(message);
      logger.error("[ItemMaster] Failed to delete item", err);
    }
  };

  const startInlineEdit = (field: string, value: string | undefined) => {
    setEditingField(field);
    setEditingValue(value ?? "");
  };

  const cancelInlineEdit = () => {
    setEditingField(null);
    setEditingValue(null);
    setSavingField(null);
  };

  const handleInlineEdit = async (
    field: "name" | "category" | "unitOfMeasure" | "description",
    value: string | undefined,
  ) => {
    if (!selectedItemId || !selectedItem) return;
    const cur = selectedItem[field] as string | undefined;
    const v = value ?? "";
    if (String(cur ?? "") === v) {
      cancelInlineEdit();
      return;
    }
    setSavingField(field);
    try {
      await inventoryService.updateItem(selectedItemId, { [field]: v });
      setSelectedItem(
        (prev) => (prev ? { ...prev, [field]: v } : null) as InventoryItem,
      );
      setSuccess("Updated");
      clearSuccessMessage();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to update"));
    } finally {
      setSavingField(null);
      setEditingField(null);
      setEditingValue(null);
    }
  };

  const renderList = () => (
    <div className="item-master-list">
      {/* Top section: Search and Add Button */}
      <div className="item-master-top-section">
        <div className="item-master-search-section">
          <Input
            placeholder="Search items... (Ctrl+F)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: "300px" }}
            id="item-search-input"
          />
          <Select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{ width: "200px" }}
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Select>
          <Button
            variant="ghost"
            onClick={() => setShowFilters(!showFilters)}
            title="Toggle advanced filters"
          >
            {showFilters ? "Hide Filters" : "More Filters"}
          </Button>
        </div>
        <div className="item-master-actions">
          {selectedItems.size > 0 && (
            <div className="bulk-actions-bar">
              <span className="bulk-selection-count">
                {selectedItems.size} selected
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleBulkAction("activate")}
                disabled={bulkActionLoading}
              >
                Activate
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleBulkAction("deactivate")}
                disabled={bulkActionLoading}
              >
                Deactivate
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleBulkAction("delete")}
                disabled={bulkActionLoading}
              >
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedItems(new Set())}
              >
                Clear
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            onClick={handleExportCSV}
            title="Export to CSV"
          >
            Export CSV
          </Button>
        </div>
        <div className="item-master-add-section">
          <Button
            variant="primary"
            onClick={() => setViewMode("add")}
            title="Add Item (Ctrl+N)"
          >
            Add Item
          </Button>
        </div>
      </div>

      <div className="item-master-list-content">
        {showFilters && (
          <div className="filter-bar-expanded">
            <div className="filter-row">
              <div className="filter-group">
                <label>Industry Type</label>
                <Select
                  value={filterIndustryType}
                  onChange={(e) => setFilterIndustryType(e.target.value)}
                  style={{ width: "200px" }}
                >
                  <option value="">All Industries</option>
                  {Object.values(IndustryType).map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="filter-group">
                <label>Stock Status</label>
                <Select
                  value={filterStockStatus}
                  onChange={(e) => setFilterStockStatus(e.target.value)}
                  style={{ width: "200px" }}
                >
                  <option value="">All Statuses</option>
                  <option value="in-stock">In Stock</option>
                  <option value="low-stock">Low Stock</option>
                  <option value="out-of-stock">Out of Stock</option>
                </Select>
              </div>
              <div className="filter-group">
                <label>Expiry Risk</label>
                <Select
                  value={filterExpiryRisk}
                  onChange={(e) => setFilterExpiryRisk(e.target.value)}
                  style={{ width: "200px" }}
                >
                  <option value="">All</option>
                  <option value="expired">Expired</option>
                  <option value="critical">Critical (0-7 days)</option>
                  <option value="warning">Warning (8-30 days)</option>
                </Select>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setFilterIndustryType("");
                  setFilterStockStatus("");
                  setFilterExpiryRisk("");
                  setFilterCategory("");
                  setSearchTerm("");
                }}
              >
                Clear All Filters
              </Button>
            </div>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

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
                    <th style={{ width: "40px" }}>
                      <input
                        type="checkbox"
                        checked={
                          selectedItems.size > 0 &&
                          selectedItems.size ===
                            items.slice(
                              (currentPage - 1) * itemsPerPage,
                              currentPage * itemsPerPage,
                            ).length
                        }
                        onChange={handleSelectAll}
                        title="Select all"
                      />
                    </th>
                    <th
                      className="sortable-header"
                      onClick={() => handleSort("sku")}
                      style={{ cursor: "pointer" }}
                    >
                      SKU
                      {sortColumn === "sku" && (
                        <span className="sort-indicator">
                          {sortDirection === "asc" ? " ↑" : " ↓"}
                        </span>
                      )}
                    </th>
                    <th
                      className="sortable-header"
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
                    <th
                      className="sortable-header"
                      onClick={() => handleSort("status")}
                      style={{ cursor: "pointer" }}
                    >
                      Status
                      {sortColumn === "status" && (
                        <span className="sort-indicator">
                          {sortDirection === "asc" ? " ↑" : " ↓"}
                        </span>
                      )}
                    </th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items
                    .slice(
                      (currentPage - 1) * itemsPerPage,
                      currentPage * itemsPerPage,
                    )
                    .map((item) => {
                      const isExpanded = expandedRows.has(item.id);
                      const itemVariants = variants.filter(
                        (v) => v.itemId === item.id,
                      );
                      // Debug log when row is expanded
                      if (isExpanded && item.hasVariants) {
                        logger.info(
                          `[ItemMaster] Rendering expanded row for item ${item.id}, variants count: ${itemVariants.length}, total variants in state: ${variants.length}`,
                        );
                      }
                      return (
                        <React.Fragment key={item.id}>
                          <tr
                            className={`expandable-row ${selectedItemId === item.id ? "selected-row" : ""} ${draggingItemId === item.id ? "dragging" : ""} ${dropTargetItemId === item.id ? "drop-target" : ""}`}
                            onClick={() => {
                              setSelectedItemId(item.id);
                              setViewMode("details");
                              setItemSubTab("overview");
                              setSelectedVariantId(null);
                              setSearchParams(
                                { itemId: item.id },
                                { replace: true },
                              );
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
                            <td onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedItems.has(item.id)}
                                onChange={() => handleSelectItem(item.id)}
                              />
                            </td>
                            <td>
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
                                {item.sku}
                              </div>
                            </td>
                            <td>{item.name}</td>
                            <td>{item.category || "-"}</td>
                            <td>{item.unitOfMeasure}</td>
                            <td>{item.industryFlags.industryType}</td>
                            <td>
                              <span
                                className={
                                  item.isActive
                                    ? "status-active"
                                    : "status-inactive"
                                }
                              >
                                {item.isActive ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <div className="row-actions">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedItemId(item.id);
                                    setViewMode("details");
                                  }}
                                  title="View Details"
                                >
                                  View
                                </Button>
                                {item.industryFlags.requiresBatchTracking && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedItemId(item.id);
                                      setViewMode("details");
                                      setItemSubTab("tracking");
                                      setTrackingSubView("batches");
                                    }}
                                    title="View Batches"
                                  >
                                    Batches
                                  </Button>
                                )}
                                {item.industryFlags.requiresSerialTracking && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedItemId(item.id);
                                      setViewMode("details");
                                      setItemSubTab("tracking");
                                      setTrackingSubView("serials");
                                    }}
                                    title="View Serials"
                                  >
                                    Serials
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setItemToDelete(item.id);
                                    setShowDeleteConfirm(true);
                                  }}
                                  title="Delete Item"
                                >
                                  Delete
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={9} className="expanded-content">
                                <div className="expanded-variants-container">
                                  <div className="expanded-variants-header">
                                    <h4>Variants ({itemVariants.length})</h4>
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedItemId(item.id);
                                        setViewMode("details");
                                        setItemSubTab("variants");
                                      }}
                                      title="Manage variants in Product Details"
                                    >
                                      Manage Variants
                                    </Button>
                                  </div>

                                  {/* Variants List - Read-Only Display */}
                                  <div className="expanded-variants-list">
                                    {itemVariants.length > 0 ? (
                                      <table className="variants-table">
                                        <thead>
                                          <tr>
                                            <th style={{ width: "120px" }}>
                                              Code
                                            </th>
                                            <th style={{ width: "200px" }}>
                                              Name
                                            </th>
                                            <th style={{ width: "100px" }}>
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
                                            return (
                                              <tr
                                                key={variant.id}
                                                className="variant-row"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setSelectedItemId(item.id);
                                                  setViewMode("details");
                                                  setItemSubTab("variants");
                                                }}
                                                style={{ cursor: "pointer" }}
                                              >
                                                <td>
                                                  <span className="variant-code-text">
                                                    {variant.code}
                                                  </span>
                                                </td>
                                                <td>
                                                  <span className="variant-name-text">
                                                    {variant.name}
                                                  </span>
                                                </td>
                                                <td>
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
                                          No variants yet. Click "Manage
                                          Variants" to add variants in Product
                                          Details.
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
          </>
        )}
      </div>
    </div>
  );

  const handleToggleActive = async () => {
    if (!selectedItemId || !selectedItem) return;
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.updateItem(selectedItemId, {
        isActive: !selectedItem.isActive,
      });
      setSuccess(
        `Item ${selectedItem.isActive ? "deactivated" : "activated"} successfully`,
      );
      clearSuccessMessage();
      await loadItemDetails();
      loadItems();
    } catch (err: any) {
      const message = extractErrorMessage(
        err,
        `Failed to ${selectedItem.isActive ? "deactivate" : "activate"} item`,
      );
      setError(message);
      logger.error("[ItemMaster] Failed to toggle item active status", err);
    }
  };

  const renderDetailHeader = () => {
    if (!selectedItem) return null;

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
              <span className="item-detail-header-sku">{selectedItem.sku}</span>
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
              variant="ghost"
              size="sm"
              title="Transfer stock for this item"
              onClick={() => {
                const p = new URLSearchParams(searchParams);
                p.set("tab", "movements");
                p.set("create", "1");
                p.set("movementType", MovementType.TRANSFER);
                p.set("itemId", selectedItem.id);
                if (selectedVariantId) {
                  p.set("variantId", selectedVariantId);
                  p.set("variantLocked", "1");
                }
                p.set(
                  "reasonCode",
                  getDefaultReason("TRANSFER", "item").defaultCode,
                );
                p.set("returnTab", "items");
                p.set("returnItemId", selectedItem.id);
                p.set("returnSubTab", itemSubTab);
                setSearchParams(p);
              }}
            >
              Transfer
            </Button>
            <Button
              variant={selectedItem.isActive ? "secondary" : "primary"}
              onClick={handleToggleActive}
              size="sm"
              title={
                selectedItem.isActive ? "Deactivate Item" : "Activate Item"
              }
            >
              {selectedItem.isActive ? "Deactivate" : "Activate"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedItemId(null);
                setViewMode("list");
              }}
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

  const renderOverviewView = () => {
    if (!selectedItem) return null;

    // UI Governance: Define collapsible sections - Maximum 5 sections allowed
    const hasPricing =
      selectedItem.costPrice != null ||
      selectedItem.sellingPrice != null ||
      selectedItem.margin != null;
    const hasDimensionsOrWeight =
      !!selectedItem.dimensions ||
      !!(selectedItem.weight && selectedItem.weight.value);
    const overviewSectionIds = [
      "basic-info",
      ...(hasPricing ? ["pricing"] : []),
      "industry-flags",
      ...(hasDimensionsOrWeight ? ["dimensions-weight"] : []),
      "description-tags-images",
    ];
    if (process.env.NODE_ENV === "development") {
      validateCollapsibleSections(overviewSectionIds.length);
    }

    const isBasicInfoCollapsed = collapsedSections.has("basic-info");
    const isPricingCollapsed = collapsedSections.has("pricing");
    const isIndustryFlagsCollapsed = collapsedSections.has("industry-flags");
    const isDimensionsWeightCollapsed =
      collapsedSections.has("dimensions-weight");
    const isDescriptionTagsImagesCollapsed = collapsedSections.has(
      "description-tags-images",
    );

    return (
      <div className="overview-content">
        {/* Basic Info Section */}
        <div className="collapsible-section">
          <div
            className="collapsible-section-header"
            onClick={() => toggleSectionCollapse("basic-info")}
          >
            <h3>Basic Information</h3>
            <span className="collapsible-section-icon">
              {isBasicInfoCollapsed ? "▶" : "▼"}
            </span>
          </div>
          {!isBasicInfoCollapsed && (
            <div className="collapsible-section-content">
              <div>
                <label>SKU</label>
                <div>{selectedItem.sku}</div>
              </div>
              <div>
                <label>Barcode</label>
                <div>{selectedItem.barcode || "—"}</div>
              </div>
              <div className="inline-edit-field">
                <label>Name</label>
                {editingField === "name" ? (
                  <div className="inline-edit-input-wrapper">
                    <Input
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={() => handleInlineEdit("name", editingValue)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleInlineEdit("name", editingValue);
                        } else if (e.key === "Escape") {
                          cancelInlineEdit();
                        }
                      }}
                      autoFocus
                      disabled={savingField === "name"}
                    />
                    {savingField === "name" && (
                      <span className="saving-indicator">Saving...</span>
                    )}
                  </div>
                ) : (
                  <div
                    className="inline-edit-display"
                    onClick={() => startInlineEdit("name", selectedItem.name)}
                  >
                    <span>{selectedItem.name}</span>
                    <span className="edit-icon" title="Click to edit">
                      ✏️
                    </span>
                  </div>
                )}
              </div>
              <div className="inline-edit-field">
                <label>Category</label>
                {editingField === "category" ? (
                  <div className="inline-edit-input-wrapper">
                    <Input
                      value={editingValue || ""}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={() => handleInlineEdit("category", editingValue)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleInlineEdit("category", editingValue);
                        } else if (e.key === "Escape") {
                          cancelInlineEdit();
                        }
                      }}
                      autoFocus
                      disabled={savingField === "category"}
                    />
                    {savingField === "category" && (
                      <span className="saving-indicator">Saving...</span>
                    )}
                  </div>
                ) : (
                  <div
                    className="inline-edit-display"
                    onClick={() =>
                      startInlineEdit("category", selectedItem.category || "")
                    }
                  >
                    <span>{selectedItem.category || "-"}</span>
                    <span className="edit-icon" title="Click to edit">
                      ✏️
                    </span>
                  </div>
                )}
              </div>
              <div className="inline-edit-field">
                <label>Unit of Measure</label>
                {editingField === "unitOfMeasure" ? (
                  <div className="inline-edit-input-wrapper">
                    <Input
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={() =>
                        handleInlineEdit("unitOfMeasure", editingValue)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleInlineEdit("unitOfMeasure", editingValue);
                        } else if (e.key === "Escape") {
                          cancelInlineEdit();
                        }
                      }}
                      autoFocus
                      disabled={savingField === "unitOfMeasure"}
                    />
                    {savingField === "unitOfMeasure" && (
                      <span className="saving-indicator">Saving...</span>
                    )}
                  </div>
                ) : (
                  <div
                    className="inline-edit-display"
                    onClick={() =>
                      startInlineEdit(
                        "unitOfMeasure",
                        selectedItem.unitOfMeasure,
                      )
                    }
                  >
                    <span>{selectedItem.unitOfMeasure}</span>
                    <span className="edit-icon" title="Click to edit">
                      ✏️
                    </span>
                  </div>
                )}
              </div>
              {selectedItem.unitConversions &&
                selectedItem.unitConversions.length > 0 && (
                  <div>
                    <label>Unit conversions</label>
                    <div>
                      {selectedItem.unitConversions.map((conv, idx) => (
                        <div key={idx} style={{ marginTop: idx > 0 ? 4 : 0 }}>
                          1 {conv.fromUnit} = {conv.conversionFactor}{" "}
                          {conv.toUnit}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>

        {/* Pricing Section */}
        {hasPricing && (
          <div className="collapsible-section">
            <div
              className="collapsible-section-header"
              onClick={() => toggleSectionCollapse("pricing")}
            >
              <h3>Pricing</h3>
              <span className="collapsible-section-icon">
                {isPricingCollapsed ? "▶" : "▼"}
              </span>
            </div>
            {!isPricingCollapsed && (
              <div className="collapsible-section-content">
                {selectedItem.costPrice != null && (
                  <div>
                    <label>Purchase price (cost)</label>
                    <div>
                      {typeof selectedItem.costPrice === "number"
                        ? selectedItem.costPrice.toFixed(2)
                        : selectedItem.costPrice}
                    </div>
                  </div>
                )}
                {selectedItem.sellingPrice != null && (
                  <div>
                    <label>Selling price</label>
                    <div>
                      {typeof selectedItem.sellingPrice === "number"
                        ? selectedItem.sellingPrice.toFixed(2)
                        : selectedItem.sellingPrice}
                    </div>
                  </div>
                )}
                {selectedItem.margin != null && (
                  <div>
                    <label>Margin %</label>
                    <div>
                      {typeof selectedItem.margin === "number"
                        ? `${selectedItem.margin.toFixed(1)}%`
                        : selectedItem.margin}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Industry Flags Section */}
        <div className="collapsible-section">
          <div
            className="collapsible-section-header"
            onClick={() => toggleSectionCollapse("industry-flags")}
          >
            <h3>Industry Flags</h3>
            <span className="collapsible-section-icon">
              {isIndustryFlagsCollapsed ? "▶" : "▼"}
            </span>
          </div>
          {!isIndustryFlagsCollapsed && (
            <div className="collapsible-section-content">
              <div>
                <label>Industry Type</label>
                <div>{selectedItem.industryFlags.industryType}</div>
              </div>
              <div>
                <label>Perishable</label>
                <div>
                  {selectedItem.industryFlags.isPerishable ? "Yes" : "No"}
                </div>
              </div>
              <div>
                <label>Batch Tracking</label>
                <div>
                  {selectedItem.industryFlags.requiresBatchTracking
                    ? "Yes"
                    : "No"}
                </div>
              </div>
              <div>
                <label>Serial Tracking</label>
                <div>
                  {selectedItem.industryFlags.requiresSerialTracking
                    ? "Yes"
                    : "No"}
                </div>
              </div>
              <div>
                <label>Has Expiry Date</label>
                <div>
                  {selectedItem.industryFlags.hasExpiryDate ? "Yes" : "No"}
                </div>
              </div>
              <div>
                <label>High Value Item</label>
                <div>
                  {selectedItem.industryFlags.isHighValue ? "Yes" : "No"}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Dimensions & weight Section */}
        {hasDimensionsOrWeight && (
          <div className="collapsible-section">
            <div
              className="collapsible-section-header"
              onClick={() => toggleSectionCollapse("dimensions-weight")}
            >
              <h3>Dimensions & weight</h3>
              <span className="collapsible-section-icon">
                {isDimensionsWeightCollapsed ? "▶" : "▼"}
              </span>
            </div>
            {!isDimensionsWeightCollapsed && (
              <div className="collapsible-section-content">
                {selectedItem.dimensions && (
                  <>
                    <div>
                      <label>Length</label>
                      <div>
                        {selectedItem.dimensions.length}{" "}
                        {selectedItem.dimensions.unit}
                      </div>
                    </div>
                    <div>
                      <label>Width</label>
                      <div>
                        {selectedItem.dimensions.width}{" "}
                        {selectedItem.dimensions.unit}
                      </div>
                    </div>
                    <div>
                      <label>Height</label>
                      <div>
                        {selectedItem.dimensions.height}{" "}
                        {selectedItem.dimensions.unit}
                      </div>
                    </div>
                    {selectedItem.dimensions.length *
                      selectedItem.dimensions.width *
                      selectedItem.dimensions.height >
                      0 && (
                      <div>
                        <label>Volume</label>
                        <div>
                          {(
                            selectedItem.dimensions.length *
                            selectedItem.dimensions.width *
                            selectedItem.dimensions.height
                          ).toFixed(2)}{" "}
                          cubic {selectedItem.dimensions.unit}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {selectedItem.weight && selectedItem.weight.value > 0 && (
                  <div>
                    <label>Weight</label>
                    <div>
                      {selectedItem.weight.value} {selectedItem.weight.unit}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Description, tags & images Section */}
        <div className="collapsible-section">
          <div
            className="collapsible-section-header"
            onClick={() => toggleSectionCollapse("description-tags-images")}
          >
            <h3>Description, tags & images</h3>
            <span className="collapsible-section-icon">
              {isDescriptionTagsImagesCollapsed ? "▶" : "▼"}
            </span>
          </div>
          {!isDescriptionTagsImagesCollapsed && (
            <div
              className="collapsible-section-content"
              style={{ gridTemplateColumns: "1fr" }}
            >
              <div>
                <label>Description</label>
                {editingField === "description" ? (
                  <div className="inline-edit-input-wrapper">
                    <textarea
                      value={editingValue || ""}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={() =>
                        handleInlineEdit("description", editingValue)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          cancelInlineEdit();
                        }
                      }}
                      rows={3}
                      autoFocus
                      disabled={savingField === "description"}
                      style={{
                        width: "100%",
                        padding: "8px",
                        border: "1px solid #e0e0e0",
                        borderRadius: "4px",
                      }}
                    />
                    <div
                      style={{
                        marginTop: "8px",
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                      }}
                    >
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() =>
                          handleInlineEdit("description", editingValue)
                        }
                        disabled={savingField === "description"}
                      >
                        Save
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={cancelInlineEdit}
                        disabled={savingField === "description"}
                      >
                        Cancel
                      </Button>
                      {savingField === "description" && (
                        <span className="saving-indicator">Saving...</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    className="inline-edit-display"
                    onClick={() =>
                      startInlineEdit(
                        "description",
                        selectedItem.description || "",
                      )
                    }
                  >
                    <p>{selectedItem.description || "—"}</p>
                    <span className="edit-icon" title="Click to edit">
                      ✏️
                    </span>
                  </div>
                )}
              </div>
              <div>
                <label>Tags</label>
                <div>
                  {selectedItem.tags && selectedItem.tags.length > 0
                    ? selectedItem.tags.join(", ")
                    : "—"}
                </div>
              </div>
              <div>
                <label>Images</label>
                {selectedItem.images && selectedItem.images.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    {selectedItem.images.map((img, idx) => (
                      <div
                        key={img.publicId || idx}
                        style={{ flex: "0 0 auto" }}
                      >
                        <img
                          src={img.url}
                          alt={img.isPrimary ? "Primary" : `Image ${idx + 1}`}
                          style={{
                            width: 64,
                            height: 64,
                            objectFit: "cover",
                            borderRadius: 4,
                            border: img.isPrimary
                              ? "2px solid #2563eb"
                              : "1px solid #e0e0e0",
                          }}
                        />
                        {img.isPrimary && (
                          <span
                            style={{
                              fontSize: 10,
                              display: "block",
                              marginTop: 2,
                            }}
                          >
                            Primary
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>—</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderStockView = () => {
    if (!selectedItem) return null;

    // Show loading state while stock data is being fetched
    if (loading && loadingStockRef.current && stockData.length === 0) {
      return <LoadingState message="Loading stock data..." />;
    }

    // Aggregate stock similar to Stock Summary Report logic
    // Group by variantId (null for items without variants)
    const stockByVariant = stockData.reduce(
      (acc, stock) => {
        const variantKey = stock.variantId?.toString() || "none";
        if (!acc[variantKey]) {
          acc[variantKey] = {
            variantId: stock.variantId?.toString(),
            onHand: 0,
            reserved: 0,
            blocked: 0,
            damaged: 0,
            available: 0,
            locations: {} as Record<
              string,
              {
                location: {
                  id: string;
                  code: string;
                  name: string;
                  type: string;
                };
                onHand: number;
                reserved: number;
                blocked: number;
                damaged: number;
                available: number;
              }
            >,
          };
        }
        acc[variantKey].onHand += stock.onHandQuantity;
        acc[variantKey].reserved += stock.reservedQuantity;
        acc[variantKey].blocked += stock.blockedQuantity;
        acc[variantKey].damaged += stock.damagedQuantity;
        acc[variantKey].available += stock.availableQuantity;

        // Group by location within variant
        const locId = stock.locationId;
        if (!acc[variantKey].locations[locId]) {
          acc[variantKey].locations[locId] = {
            location: stock.location,
            onHand: 0,
            reserved: 0,
            blocked: 0,
            damaged: 0,
            available: 0,
          };
        }
        acc[variantKey].locations[locId].onHand += stock.onHandQuantity;
        acc[variantKey].locations[locId].reserved += stock.reservedQuantity;
        acc[variantKey].locations[locId].blocked += stock.blockedQuantity;
        acc[variantKey].locations[locId].damaged += stock.damagedQuantity;
        acc[variantKey].locations[locId].available += stock.availableQuantity;

        return acc;
      },
      {} as Record<
        string,
        {
          variantId?: string;
          onHand: number;
          reserved: number;
          blocked: number;
          damaged: number;
          available: number;
          locations: Record<
            string,
            {
              location: {
                id: string;
                code: string;
                name: string;
                type: string;
              };
              onHand: number;
              reserved: number;
              blocked: number;
              damaged: number;
              available: number;
            }
          >;
        }
      >,
    );

    // Calculate totals across all variants (matching report logic)
    const totalOnHand = Object.values(stockByVariant).reduce(
      (sum, v) => sum + v.onHand,
      0,
    );
    const totalReserved = Object.values(stockByVariant).reduce(
      (sum, v) => sum + v.reserved,
      0,
    );
    const totalAvailable = Object.values(stockByVariant).reduce(
      (sum, v) => sum + v.available,
      0,
    );
    const locationCount = new Set(stockData.map((s) => s.locationId)).size;

    // Build variant stock for summary: only variants for THIS item (state can hold variants from other items)
    const itemVariants = variants.filter(
      (v: { itemId?: string }) => v.itemId === selectedItem.id,
    );
    const defaultVariant =
      selectedItem.hasVariants && itemVariants.length > 0
        ? (itemVariants.find((v: { isDefault?: boolean }) => v.isDefault) ??
          itemVariants[0])
        : null;
    const unassignedStock = stockByVariant["none"] ?? null;
    const variantStockDisplay =
      selectedItem.hasVariants && itemVariants.length > 0
        ? itemVariants.map((v: { id: string }) => {
            const bucket = stockByVariant[v.id] ?? {
              onHand: 0,
              locations: {} as Record<
                string,
                {
                  location: { id: string; code: string; name: string; type: string };
                  onHand: number;
                }
              >,
            };
            let mergedOnHand = bucket.onHand;
            if (optimisticMigration?.variantId === v.id) {
              mergedOnHand += optimisticMigration.ledgerModified;
            }
            return {
              variantId: v.id,
              totalOnHand: mergedOnHand,
              locations: Object.entries(bucket.locations).map(
                ([locationId, loc]) => ({
                  locationId,
                  locationCode: loc.location?.code ?? "",
                  locationName: loc.location?.name ?? "",
                  quantity: loc.onHand,
                }),
              ),
            };
          })
        : [];

    // For location breakdown, aggregate across all variants
    const stockByLocation = stockData.reduce(
      (acc, stock) => {
        const locId = stock.locationId;
        if (!acc[locId]) {
          acc[locId] = {
            location: stock.location,
            onHand: 0,
            reserved: 0,
            blocked: 0,
            damaged: 0,
            available: 0,
          };
        }
        acc[locId].onHand += stock.onHandQuantity;
        acc[locId].reserved += stock.reservedQuantity;
        acc[locId].blocked += stock.blockedQuantity;
        acc[locId].damaged += stock.damagedQuantity;
        acc[locId].available += stock.availableQuantity;
        return acc;
      },
      {} as Record<
        string,
        {
          location: { id: string; code: string; name: string; type: string };
          onHand: number;
          reserved: number;
          blocked: number;
          damaged: number;
          available: number;
        }
      >,
    );

    return (
      <div className="stock-view">
        {/* Summary Cards */}
        <div className="stock-summary-cards">
          <div className="stock-summary-card">
            <div className="stock-summary-label">On Hand</div>
            <div className="stock-summary-value">{totalOnHand}</div>
          </div>
          <div className="stock-summary-card">
            <div className="stock-summary-label">Reserved</div>
            <div className="stock-summary-value">{totalReserved}</div>
          </div>
          <div className="stock-summary-card">
            <div className="stock-summary-label">Available</div>
            <div className="stock-summary-value">{totalAvailable}</div>
          </div>
          <div className="stock-summary-card">
            <div className="stock-summary-label">Locations</div>
            <div className="stock-summary-value">{locationCount}</div>
          </div>
        </div>

        {/* Location Breakdown */}
        <div className="stock-location-breakdown">
          <h4>Location Breakdown</h4>
          {Object.keys(stockByLocation).length === 0 ? (
            <EmptyState message="No stock data available" />
          ) : (
            <table className="stock-location-table">
              <thead>
                <tr>
                  <th>Location Code</th>
                  <th>Location Name</th>
                  <th>On Hand</th>
                  <th>Reserved</th>
                  <th>Blocked</th>
                  <th>Damaged</th>
                  <th>Available</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(stockByLocation).map((locStock) => {
                  const isHighlighted =
                    locationIdFromUrl === locStock.location.id;
                  return (
                    <tr
                      key={locStock.location.id}
                      className={
                        isHighlighted ? "location-row-highlighted" : ""
                      }
                      ref={(el) => {
                        if (isHighlighted && el) {
                          setTimeout(
                            () =>
                              el.scrollIntoView({
                                behavior: "smooth",
                                block: "center",
                              }),
                            100,
                          );
                        }
                      }}
                    >
                      <td>
                        <button
                          className="location-link-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const newParams = new URLSearchParams();
                            newParams.set("tab", "locations");
                            newParams.set("locationId", locStock.location.id);
                            navigate(`/inventory?${newParams.toString()}`);
                          }}
                        >
                          {locStock.location.code}
                        </button>
                      </td>
                      <td>
                        <button
                          className="location-link-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const newParams = new URLSearchParams();
                            newParams.set("tab", "locations");
                            newParams.set("locationId", locStock.location.id);
                            navigate(`/inventory?${newParams.toString()}`);
                          }}
                        >
                          {locStock.location.name}
                        </button>
                      </td>
                      <td>{locStock.onHand}</td>
                      <td>{locStock.reserved}</td>
                      <td>{locStock.blocked}</td>
                      <td>{locStock.damaged}</td>
                      <td>{locStock.available}</td>
                      <td>
                        <div
                          className="stock-row-actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const p = new URLSearchParams(searchParams);
                              p.set("tab", "movements");
                              p.set("create", "1");
                              p.set("movementType", MovementType.RECEIPT);
                              p.set("itemId", selectedItem!.id);
                              if (selectedVariantId) {
                                p.set("variantId", selectedVariantId);
                                p.set("variantLocked", "1");
                              }
                              p.set("toLocationId", locStock.location.id);
                              p.set(
                                "reasonCode",
                                getDefaultReason("RECEIPT", "item").defaultCode,
                              );
                              p.set("returnTab", "items");
                              p.set("returnItemId", selectedItem!.id);
                              p.set("returnSubTab", "stock");
                              setSearchParams(p);
                            }}
                          >
                            Receive
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const p = new URLSearchParams(searchParams);
                              p.set("tab", "movements");
                              p.set("create", "1");
                              p.set("movementType", MovementType.ISSUE);
                              p.set("itemId", selectedItem!.id);
                              if (selectedVariantId) {
                                p.set("variantId", selectedVariantId);
                                p.set("variantLocked", "1");
                              }
                              p.set("fromLocationId", locStock.location.id);
                              p.set(
                                "reasonCode",
                                getDefaultReason("ISSUE", "item").defaultCode,
                              );
                              p.set("returnTab", "items");
                              p.set("returnItemId", selectedItem!.id);
                              p.set("returnSubTab", "stock");
                              setSearchParams(p);
                            }}
                          >
                            Issue
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const p = new URLSearchParams(searchParams);
                              p.set("tab", "movements");
                              p.set("create", "1");
                              p.set("movementType", MovementType.TRANSFER);
                              p.set("itemId", selectedItem!.id);
                              if (selectedVariantId) {
                                p.set("variantId", selectedVariantId);
                                p.set("variantLocked", "1");
                              }
                              p.set("fromLocationId", locStock.location.id);
                              p.set(
                                "reasonCode",
                                getDefaultReason("TRANSFER", "item")
                                  .defaultCode,
                              );
                              p.set("returnTab", "items");
                              p.set("returnItemId", selectedItem!.id);
                              p.set("returnSubTab", "stock");
                              setSearchParams(p);
                            }}
                          >
                            Transfer
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Variant Stock (if item has variants) - use same stockData so totals match summary cards */}
        {selectedItem.hasVariants && variantStockDisplay.length > 0 && (
          <div className="variant-stock-section">
            <h4>Variant Stock Summary</h4>
            <p className="variant-stock-legacy-note" style={{ fontSize: '0.875rem', color: '#6c757d', marginTop: '0.25rem', marginBottom: '0.75rem' }}>
              Variant totals are shown exactly as stored in the ledger. Legacy product-level rows (without variant) are shown separately as Unassigned / Legacy.
            </p>
            <div className="variant-stock-grid">
              {variantStockDisplay.map((stock) => {
                const variant = variants.find((v) => v.id === stock.variantId);
                const isDefaultVariant = defaultVariant?.id === stock.variantId;
                return (
                  <div key={stock.variantId} className="variant-stock-card">
                    <div className="variant-stock-header">
                      <strong>
                        {variant
                          ? `${variant.code} - ${variant.name}`
                          : stock.variantId}
                      </strong>
                      {isDefaultVariant && (
                        <span className="badge badge-primary">Default</span>
                      )}
                    </div>
                    <div className="variant-stock-total">
                      Total: <strong>{stock.totalOnHand}</strong>
                    </div>
                    {stock.locations.length > 0 && (
                      <div className="variant-stock-locations">
                        <div className="locations-header">By Location:</div>
                        {stock.locations.map((loc) => (
                          <div
                            key={loc.locationId}
                            className="location-stock-item"
                          >
                            <span>
                              {loc.locationCode} - {loc.locationName}
                            </span>
                            <span className="location-quantity">
                              {loc.quantity}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {unassignedStock && unassignedStock.onHand > 0 && (
                <div key="unassigned-legacy" className="variant-stock-card">
                  <div className="variant-stock-header">
                    <strong>Unassigned / Legacy</strong>
                    <span className="badge badge-warning">Needs Rebalance</span>
                  </div>
                  <div className="variant-stock-total">
                    Total: <strong>{unassignedStock.onHand}</strong>
                  </div>
                  <div style={{ marginTop: "0.5rem", marginBottom: "0.5rem" }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleRebalanceLegacyStock}
                      disabled={legacyRebalanceLoading}
                    >
                      {legacyRebalanceLoading ? "Rebalancing..." : "Rebalance Legacy Stock"}
                    </Button>
                  </div>
                  {Object.values(unassignedStock.locations ?? {}).length > 0 && (
                    <div className="variant-stock-locations">
                      <div className="locations-header">By Location:</div>
                      {Object.entries(unassignedStock.locations).map(([locationId, loc]) => (
                        <div key={locationId} className="location-stock-item">
                          <span>
                            {loc.location?.code} - {loc.location?.name}
                          </span>
                          <span className="location-quantity">{loc.onHand}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTrackingView = () => {
    if (!selectedItem) return null;

    const hasBatches = selectedItem.industryFlags.requiresBatchTracking;
    const hasSerials = selectedItem.industryFlags.requiresSerialTracking;
    const hasExpiry = selectedItem.industryFlags.hasExpiryDate;

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
                {selectedItem.industryFlags.hasExpiryDate && (
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

  const renderEditView = () => {
    if (!selectedItem) return null;

    const primaryUom = (formData.unitOfMeasure || "pcs").trim();
    const conv0 = formData.unitConversions?.[0];
    const secondaryUnit =
      conv0 && conv0.toUnit === primaryUom ? conv0.fromUnit : "";
    const conversionFactorStr =
      conv0 && conv0.toUnit === primaryUom && conv0.conversionFactor != null
        ? String(conv0.conversionFactor)
        : "";

    const setRequiresBatchTracking = (checked: boolean) => {
      setFormData((prev) => {
        const nf = { ...prev.industryFlags, requiresBatchTracking: checked };
        if (checked) nf.requiresSerialTracking = false;
        if (checked && nf.isPerishable && !nf.hasExpiryDate) nf.hasExpiryDate = true;
        return { ...prev, industryFlags: nf };
      });
      setFieldErrors((er) => {
        const n = { ...er };
        delete n["industryFlags.batchSerial"];
        if (checked) delete n["industryFlags.perishableExpiry"];
        return n;
      });
      setHasUnsavedChanges(true);
    };

    const setRequiresSerialTracking = (checked: boolean) => {
      setFormData((prev) => ({
        ...prev,
        industryFlags: {
          ...prev.industryFlags,
          requiresSerialTracking: checked,
          ...(checked ? { requiresBatchTracking: false } : {}),
        },
      }));
      setFieldErrors((er) => {
        const n = { ...er };
        delete n["industryFlags.batchSerial"];
        return n;
      });
      setHasUnsavedChanges(true);
    };

    const syncUnitConversion = (
      secondary: string,
      factorRaw: string,
      primary: string,
    ) => {
      const sec = secondary.trim();
      const factor = parseFloat(factorRaw);
      const p = primary.trim() || "pcs";
      if (!sec || !factor || factor <= 0 || Number.isNaN(factor)) {
        setFormData((prev) => ({ ...prev, unitConversions: [] }));
      } else {
        setFormData((prev) => ({
          ...prev,
          unitConversions: [
            { fromUnit: sec, toUnit: p, conversionFactor: factor },
          ],
        }));
      }
      setHasUnsavedChanges(true);
    };

    return (
      <div className="edit-view">
        <div className="edit-form-sections">
          <div className="wizard-step-content wizard-step-content--master">
            <div className="wizard-master-split">
              <div className="wizard-master-images">
                <ImageUpload
                  images={formData.images || []}
                  onChange={(images) => {
                    setFormData({ ...formData, images });
                    setHasUnsavedChanges(true);
                  }}
                  maxImages={10}
                  folder="inventory"
                  disabled={loading}
                />
              </div>
              <div className="wizard-master-fields">
                <div className="wizard-form-group">
                  <label>SKU</label>
                  <Input
                    value={selectedItem.sku}
                    disabled
                    style={{ backgroundColor: "#f5f5f5" }}
                  />
                  <span className="wizard-summary-label" style={{ fontSize: 11 }}>
                    SKU cannot be changed after creation
                  </span>
                </div>
                <div className="wizard-form-group">
                  <label htmlFor="item-edit-barcode">Barcode</label>
                  <Input
                    id="item-edit-barcode"
                    value={formData.barcode || ""}
                    onChange={(e) => {
                      setFormData({ ...formData, barcode: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Optional barcode"
                  />
                </div>
                <div className="wizard-form-group">
                  <label htmlFor="item-edit-name" className="required">
                    Item name
                  </label>
                  <Input
                    id="item-edit-name"
                    value={formData.name}
                    onChange={(e) => {
                      setFormData({ ...formData, name: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="e.g. Organic whole milk 1L"
                  />
                </div>
                <div className="wizard-form-group wizard-form-group--grow">
                  <label htmlFor="item-edit-desc">Description</label>
                  <textarea
                    id="item-edit-desc"
                    className="input wizard-master-description"
                    rows={6}
                    value={formData.description}
                    onChange={(e) => {
                      setFormData({ ...formData, description: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Ingredients, storage, shelf life, or anything staff should know."
                    maxLength={2000}
                  />
                  <span className="wizard-summary-label" style={{ fontSize: 11 }}>
                    {formData.description?.length || 0} / 2000
                  </span>
                </div>
                <div className="wizard-form-group">
                  <label htmlFor="item-edit-category">Category</label>
                  <Select
                    id="item-edit-category"
                    value={formData.category ?? ""}
                    onChange={(e) => {
                      setFormData({ ...formData, category: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                  >
                    <option value="">—</option>
                    {categorySelectOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="wizard-form-group">
                  <span
                    className="wizard-summary-label"
                    style={{ display: "block", marginBottom: 6 }}
                  >
                    {"Tracking & handling"}
                  </span>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "12px 20px",
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      <Checkbox
                        checked={formData.industryFlags.requiresBatchTracking}
                        onChange={(e) =>
                          setRequiresBatchTracking(e.target.checked)
                        }
                        aria-label="Track batch number"
                      />
                      Track batch number
                    </label>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      <Checkbox
                        checked={formData.industryFlags.requiresSerialTracking}
                        onChange={(e) =>
                          setRequiresSerialTracking(e.target.checked)
                        }
                        aria-label="Track serial number"
                      />
                      Track serial number
                    </label>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      <Checkbox
                        checked={formData.industryFlags.hasExpiryDate}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            industryFlags: {
                              ...formData.industryFlags,
                              hasExpiryDate: e.target.checked,
                            },
                          });
                          setHasUnsavedChanges(true);
                        }}
                        aria-label="Has expiry date"
                      />
                      Has expiry date
                    </label>
                  </div>
                  <p
                    className="wizard-summary-label"
                    style={{ margin: "6px 0 0", fontSize: 11, color: "#64748b" }}
                  >
                    Batch and serial tracking cannot both be enabled — selecting
                    one turns the other off.
                  </p>
                  {(fieldErrors["industryFlags.batchSerial"] ||
                    fieldErrors["industryFlags.perishableExpiry"]) && (
                    <p className="field-error" role="alert" style={{ marginTop: 8 }}>
                      {fieldErrors["industryFlags.batchSerial"] ||
                        fieldErrors["industryFlags.perishableExpiry"]}
                    </p>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "12px 20px",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    <Checkbox
                      checked={formData.industryFlags.isPerishable}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData((prev) => {
                          const nf = {
                            ...prev.industryFlags,
                            isPerishable: checked,
                          };
                          if (
                            checked &&
                            nf.requiresBatchTracking &&
                            !nf.hasExpiryDate
                          ) {
                            nf.hasExpiryDate = true;
                          }
                          return { ...prev, industryFlags: nf };
                        });
                        setHasUnsavedChanges(true);
                      }}
                      aria-label="Perishable"
                    />
                    Perishable
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    <Checkbox
                      checked={formData.industryFlags.isHighValue}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          industryFlags: {
                            ...formData.industryFlags,
                            isHighValue: e.target.checked,
                          },
                        });
                        setHasUnsavedChanges(true);
                      }}
                      aria-label="High value item"
                    />
                    High value item
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3 className="form-section-title">Units</h3>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="item-edit-uom">Primary unit *</label>
                <Select
                  id="item-edit-uom"
                  value={formData.unitOfMeasure}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormData((prev) => {
                      const c = prev.unitConversions?.[0];
                      const uc =
                        c && prev.unitConversions?.length === 1
                          ? [{ ...c, toUnit: v }]
                          : prev.unitConversions || [];
                      return { ...prev, unitOfMeasure: v, unitConversions: uc };
                    });
                    setHasUnsavedChanges(true);
                  }}
                >
                  {VARIANT_UNIT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="form-group">
                <label htmlFor="item-edit-secondary-uom">Secondary unit</label>
                <Select
                  id="item-edit-secondary-uom"
                  value={secondaryUnit}
                  onChange={(e) => {
                    const v = e.target.value;
                    syncUnitConversion(
                      v,
                      v ? conversionFactorStr || "1" : "",
                      primaryUom,
                    );
                  }}
                >
                  <option value="">None</option>
                  {VARIANT_UNIT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {secondaryUnit ? (
              <div className="form-group wizard-conditional-section">
                <label htmlFor="item-edit-conv-factor">
                  Conversion (1 secondary = X primary)
                </label>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: 12 }}>1</span>
                  <Input
                    id="item-edit-conv-factor"
                    type="number"
                    min={0.001}
                    step={0.1}
                    value={conversionFactorStr}
                    onChange={(e) => {
                      syncUnitConversion(
                        secondaryUnit,
                        e.target.value,
                        primaryUom,
                      );
                    }}
                    placeholder="1"
                    style={{ width: 80 }}
                  />
                  <span style={{ fontSize: 12 }}>
                    {primaryUom} = 1 {secondaryUnit}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="form-section">
            <h3 className="form-section-title">Pricing</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Purchase price (cost)</label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={formData.costPrice ?? ""}
                  onChange={(e) => {
                    const v = e.target.value
                      ? parseFloat(e.target.value)
                      : undefined;
                    setFormData({ ...formData, costPrice: v });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder="0.00"
                />
              </div>
              <div className="form-group">
                <label>Selling price</label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={formData.sellingPrice ?? ""}
                  onChange={(e) => {
                    const v = e.target.value
                      ? parseFloat(e.target.value)
                      : undefined;
                    setFormData({ ...formData, sellingPrice: v });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder="0.00"
                />
              </div>
              <div className="form-group">
                <label>Margin %</label>
                <div style={{ padding: "8px 0", fontSize: 14 }}>
                  {formData.costPrice != null &&
                  formData.costPrice > 0 &&
                  formData.sellingPrice != null
                    ? `${(((formData.sellingPrice - formData.costPrice) / formData.costPrice) * 100).toFixed(1)}%`
                    : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3 className="form-section-title">{"Dimensions & weight"}</h3>
            <div className="dimensions-grid">
              <div className="form-group">
                <label>Length</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.dimensions?.length || ""}
                  onChange={(e) => {
                    const value = e.target.value
                      ? parseFloat(e.target.value)
                      : undefined;
                    setFormData({
                      ...formData,
                      dimensions: {
                        ...formData.dimensions,
                        length: value || 0,
                        width: formData.dimensions?.width || 0,
                        height: formData.dimensions?.height || 0,
                        unit: formData.dimensions?.unit || "cm",
                      } as any,
                    });
                    setHasUnsavedChanges(true);
                  }}
                />
              </div>
              <div className="form-group">
                <label>Width</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.dimensions?.width || ""}
                  onChange={(e) => {
                    const value = e.target.value
                      ? parseFloat(e.target.value)
                      : undefined;
                    setFormData({
                      ...formData,
                      dimensions: {
                        ...formData.dimensions,
                        length: formData.dimensions?.length || 0,
                        width: value || 0,
                        height: formData.dimensions?.height || 0,
                        unit: formData.dimensions?.unit || "cm",
                      } as any,
                    });
                    setHasUnsavedChanges(true);
                  }}
                />
              </div>
              <div className="form-group">
                <label>Height</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.dimensions?.height || ""}
                  onChange={(e) => {
                    const value = e.target.value
                      ? parseFloat(e.target.value)
                      : undefined;
                    setFormData({
                      ...formData,
                      dimensions: {
                        ...formData.dimensions,
                        length: formData.dimensions?.length || 0,
                        width: formData.dimensions?.width || 0,
                        height: value || 0,
                        unit: formData.dimensions?.unit || "cm",
                      } as any,
                    });
                    setHasUnsavedChanges(true);
                  }}
                />
              </div>
              <div className="form-group">
                <label>Unit</label>
                <Select
                  value={formData.dimensions?.unit || "cm"}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      dimensions: {
                        ...formData.dimensions,
                        length: formData.dimensions?.length || 0,
                        width: formData.dimensions?.width || 0,
                        height: formData.dimensions?.height || 0,
                        unit: e.target.value,
                      } as any,
                    });
                    setHasUnsavedChanges(true);
                  }}
                >
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                  <option value="inches">inches</option>
                  <option value="ft">ft</option>
                </Select>
              </div>
              <div className="form-group">
                <label>Weight</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.weight?.value || ""}
                  onChange={(e) => {
                    const value = e.target.value
                      ? parseFloat(e.target.value)
                      : undefined;
                    setFormData({
                      ...formData,
                      weight: {
                        value: value || 0,
                        unit: formData.weight?.unit || "kg",
                      } as any,
                    });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder="0.00"
                />
              </div>
              <div className="form-group">
                <label>Weight unit</label>
                <Select
                  value={formData.weight?.unit || "kg"}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      weight: {
                        value: formData.weight?.value || 0,
                        unit: e.target.value,
                      } as any,
                    });
                    setHasUnsavedChanges(true);
                  }}
                >
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                  <option value="lbs">lbs</option>
                  <option value="oz">oz</option>
                </Select>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3 className="form-section-title">Industry</h3>
            <div className="form-group">
              <label>Industry type *</label>
              <Select
                value={formData.industryFlags.industryType}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    industryFlags: {
                      ...formData.industryFlags,
                      industryType: e.target.value as IndustryType,
                    },
                  });
                  setHasUnsavedChanges(true);
                }}
              >
                {Object.values(IndustryType).map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="form-section">
            <h3 className="form-section-title">Tags</h3>
            <div className="form-group">
              <Input
                value={(formData.tags || []).join(", ")}
                onChange={(e) => {
                  const tags = e.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0);
                  setFormData({ ...formData, tags });
                  setHasUnsavedChanges(true);
                }}
                placeholder="Enter tags separated by commas"
              />
              <div className="tags-hint">Separate tags with commas</div>
              {formData.tags && formData.tags.length > 0 && (
                <div className="tags-display">
                  {formData.tags.map((tag, index) => (
                    <span key={index} className="tag-chip">
                      {tag}
                      <button
                        type="button"
                        onClick={() => {
                          const newTags =
                            formData.tags?.filter((_, i) => i !== index) || [];
                          setFormData({ ...formData, tags: newTags });
                          setHasUnsavedChanges(true);
                        }}
                        className="tag-remove"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="edit-form-actions">
          <Button
            variant="secondary"
            onClick={() => {
              if (hasUnsavedChanges) {
                setPendingNavigation(() => () => {
                  if (selectedItem) {
                    setFormData({
                      sku: selectedItem.sku,
                      name: selectedItem.name,
                      description: selectedItem.description || "",
                      category: selectedItem.category || "",
                      barcode: selectedItem.barcode || "",
                      unitOfMeasure: selectedItem.unitOfMeasure,
                      unitConversions: selectedItem.unitConversions,
                      industryFlags: selectedItem.industryFlags,
                      images: selectedItem.images || [],
                      dimensions: selectedItem.dimensions,
                      weight: selectedItem.weight,
                      tags: selectedItem.tags || [],
                      costPrice: selectedItem.costPrice,
                      sellingPrice: selectedItem.sellingPrice,
                      margin: selectedItem.margin,
                    });
                  }
                  setHasUnsavedChanges(false);
                  setFieldErrors({});
                  setItemSubTab("overview");
                });
                setShowUnsavedDialog(true);
              } else {
                setItemSubTab("overview");
              }
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={handleUpdate} disabled={loading}>
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    );
  };

  const renderHistoryView = () => {
    if (!selectedItem) return null;

    // Group stock by location (from Locations tab - now consolidated here)
    const stockByLocation = stockData.reduce(
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
            <EmptyState message="No locations found for this item" />
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

          {historyData.length === 0 ? (
            <EmptyState message="No movement history found for this item" />
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Movement Type</th>
                  <th>From Location</th>
                  <th>To Location</th>
                  <th>Quantity</th>
                  <th>Status</th>
                  <th>User</th>
                </tr>
              </thead>
              <tbody>
                {historyData.map((movement) => (
                  <tr key={movement.id}>
                    <td>{new Date(movement.createdAt).toLocaleDateString()}</td>
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

    return (
      <div className="item-master-details">
        <div className="item-detail-header-container">
          {renderDetailHeader()}
        </div>

        <div className="item-master-details-content">
          {/* Sub-tabs for item details */}
          {/* UI Governance: Maximum 6 sub-tabs enforced via ItemSubTab type - DO NOT ADD MORE */}
          {/* Current tabs: Overview, Edit, Variants (conditional), Stock, Tracking (conditional), History */}
          {/* If you need to add another tab, you've reached the maximum. Use modals, collapsible sections, or separate modules instead. */}
          <div className="item-sub-tabs">
            <button
              className={`item-sub-tab ${itemSubTab === "overview" ? "active" : ""}`}
              onClick={() => setItemSubTab("overview")}
            >
              Overview
            </button>
            <button
              className={`item-sub-tab ${itemSubTab === "edit" ? "active" : ""}`}
              onClick={() => setItemSubTab("edit")}
            >
              Edit
            </button>
            <button
              className={`item-sub-tab ${itemSubTab === "variants" ? "active" : ""}`}
              onClick={() => setItemSubTab("variants")}
            >
              Variants
            </button>
            <button
              className={`item-sub-tab ${itemSubTab === "stock" ? "active" : ""}`}
              onClick={() => setItemSubTab("stock")}
            >
              Stock
            </button>
            {(selectedItem.industryFlags.requiresBatchTracking ||
              selectedItem.industryFlags.requiresSerialTracking ||
              selectedItem.industryFlags.hasExpiryDate) && (
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
              {itemSubTab === "overview" && renderOverviewView()}
              {itemSubTab === "edit" && renderEditView()}
              {itemSubTab === "variants" && selectedItemId && (
                <VariantManagement
                  itemId={selectedItemId}
                  itemName={selectedItem.name}
                  itemDefaultUnitOfMeasure={selectedItem.unitOfMeasure || "pcs"}
                  selectedVariantId={selectedVariantId || undefined}
                  onVariantCreated={(variant, migration) => {
                    if (migration) {
                      setOptimisticMigration({
                        variantId: variant.id,
                        ledgerModified: migration.ledgerModified,
                        serialModified: migration.serialModified,
                      });
                    }
                  }}
                  onVariantChange={async () => {
                    await loadVariants(selectedItemId);
                    await loadVariantStock(selectedItemId);
                    await loadStockData(selectedItemId);
                  }}
                  onVariantSelect={(variantId) => {
                    setSelectedVariantId(variantId);
                    setSearchParams(
                      { itemId: selectedItemId, variantId },
                      { replace: true },
                    );
                  }}
                />
              )}
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
          onCancel={() => setViewMode("list")}
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
        message="Are you sure you want to delete this item? This action cannot be undone."
        onConfirm={() => handleDelete()}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setItemToDelete(null);
        }}
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
    </div>
  );
};
