/**
 * Location Management Component - Manage location hierarchy
 *
 * Hierarchy tree with location detail panel.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  inventoryService,
  Location,
  CreateLocationRequest,
  UpdateLocationRequest,
  LocationType,
  LocationHierarchyResponse,
  StockByLocation,
  StockMovementResponse,
  MovementType,
  CreateMovementBatchRequest,
  MovementLineRequest,
} from '@/services/inventory.service';
import { getDefaultReason } from '../constants/movementReasonMapping';
import {
  collectHierarchyIds,
  countHierarchyNodes,
  filterHierarchyByQuery,
  findAncestorIdsInHierarchy,
  flattenHierarchy,
  resolveTreeFocusAnchor,
} from '../utils/locationHierarchyTree';
import {
  buildHierarchyIndex,
  collectVisibleHierarchyIds,
  resolveTreeKeyboardAction,
  snapFocusToVisibleTree,
} from '../utils/locationTreeKeyboard';
import { Button, Input, Card, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState, ErrorState } from '@/shared/components/data-display';
import { DataTable, ColumnDef } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { ConfirmDialog, Modal, SideDrawer } from '@/shared/components/modals';
import './LocationManagement.css';

type LocationSubTab = 'stock' | 'children' | 'capacity' | 'history';
type CreateWizardStep = 1 | 2 | 3 | 4;

const LOCATION_SUB_TABS: readonly LocationSubTab[] = ['stock', 'children', 'capacity', 'history'];

function parseLocationSubTab(value: string | null): LocationSubTab {
  if (value === 'overview') return 'stock';
  if (value && (LOCATION_SUB_TABS as readonly string[]).includes(value)) {
    return value as LocationSubTab;
  }
  return 'stock';
}

interface LocationManagementProps {
  locationId?: string;
  /** Location search from module header (code / name). */
  searchQuery?: string;
  addLocationRequestSeq?: number;
}

export interface LocationManagementHandle {
  /** Move keyboard focus to the tree (selected row, or first visible). */
  focusTreePanel: () => void;
  /** Highlight first visible row (no detail load). Used when search field receives Enter. */
  focusFirstVisible: () => void;
  /** Move keyboard highlight up/down without loading detail. Works from search or tree. */
  moveTreeFocus: (direction: 'up' | 'down') => void;
}

export const LocationManagement = forwardRef<LocationManagementHandle, LocationManagementProps>(({
  locationId: initialLocationId,
  searchQuery = '',
  addLocationRequestSeq = 0,
}, ref) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [locations, setLocations] = useState<Location[]>([]);
  const [hierarchyRoots, setHierarchyRoots] = useState<LocationHierarchyResponse[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(initialLocationId || null);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [locationPath, setLocationPath] = useState<Location[]>([]);

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  
  // Detail state
  const [locationSubTab, setLocationSubTab] = useState<LocationSubTab>(() =>
    parseLocationSubTab(searchParams.get('locationSubTab'))
  );
  const [stockData, setStockData] = useState<StockByLocation[]>([]);
  const [childrenData, setChildrenData] = useState<Location[]>([]);
  const [capacityUsage, setCapacityUsage] = useState<{
    usedWeight: number;
    usedVolume: number;
    usedItems: number;
    maxWeight?: number;
    maxVolume?: number;
    maxItems?: number;
  } | null>(null);
  const [movementHistory, setMovementHistory] = useState<StockMovementResponse[]>([]);
  const [movementFilters, setMovementFilters] = useState({
    dateFrom: '',
    dateTo: '',
    movementType: '',
    productId: '',
  });
  const [stockStatusFilter, setStockStatusFilter] = useState<string>('');
  const [stockProductSearchQuery, setStockProductSearchQuery] = useState<string>('');
  const [stockLocationSectionsExpanded, setStockLocationSectionsExpanded] = useState<Set<string>>(new Set());
  const [childrenCapacityMap, setChildrenCapacityMap] = useState<Record<string, {
    usedWeight: number;
    usedVolume: number;
    usedItems: number;
    maxWeight?: number;
    maxVolume?: number;
    maxItems?: number;
  }>>({});
  
  // Create wizard state
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [createStep, setCreateStep] = useState<CreateWizardStep>(1);
  const [createFormData, setCreateFormData] = useState<CreateLocationRequest>({
    code: '',
    name: '',
    type: LocationType.WAREHOUSE,
  });
  
  // Edit state
  const [showEditDrawer, setShowEditDrawer] = useState(false);
  const [editFormData, setEditFormData] = useState<UpdateLocationRequest>({});
  
  // General state
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [detailPanelLoading, setDetailPanelLoading] = useState(false);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [focusedLocationId, setFocusedLocationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState<string | null>(null);
  const [showPermanentDeleteConfirm, setShowPermanentDeleteConfirm] = useState(false);
  const [locationToDeletePermanent, setLocationToDeletePermanent] = useState<string | null>(null);
  const [showStockBlockDialog, setShowStockBlockDialog] = useState(false);
  const [stockBlockShiftTargetId, setStockBlockShiftTargetId] = useState<string>('');
  const [showStockBlockShiftStep, setShowStockBlockShiftStep] = useState(false);
  const [showClearStockConfirm, setShowClearStockConfirm] = useState(false);
  const [stockBlockActionLoading, setStockBlockActionLoading] = useState(false);
  const [stockBlockError, setStockBlockError] = useState<string | null>(null);
  const [stockBlockLocationBranchId, setStockBlockLocationBranchId] = useState<string | null>(null);
  const [shiftTargetLocations, setShiftTargetLocations] = useState<Location[]>([]);
  
  // Refs to prevent concurrent loading
  const loadingStockRef = useRef(false);
  const loadingDetailsRef = useRef(false);
  const loadingHierarchyRef = useRef(false);
  const detailLoadingCountRef = useRef(0);

  const startDetailLoading = useCallback(() => {
    detailLoadingCountRef.current += 1;
    setDetailPanelLoading(true);
  }, []);

  const stopDetailLoading = useCallback(() => {
    detailLoadingCountRef.current = Math.max(0, detailLoadingCountRef.current - 1);
    if (detailLoadingCountRef.current === 0) setDetailPanelLoading(false);
  }, []);
  const treeContentRef = useRef<HTMLDivElement>(null);
  const pendingTreePanelFocusRef = useRef(true);
  const lastLoadedRef = useRef<{ locationId: string | null; subTab: LocationSubTab | null }>({ locationId: null, subTab: null });
  const lastHierarchyLoadRef = useRef(false);

  const loadHierarchy = useCallback(async (options?: { showTreeSpinner?: boolean }) => {
    if (loadingHierarchyRef.current) return;
    loadingHierarchyRef.current = true;
    const showTreeSpinner = options?.showTreeSpinner ?? false;
    if (showTreeSpinner) setHierarchyLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getLocationHierarchy();
      setHierarchyRoots(data);
      setLocations(flattenHierarchy(data));
      if (!lastHierarchyLoadRef.current) {
        setExpandedNodes(new Set(collectHierarchyIds(data)));
      }
      lastHierarchyLoadRef.current = true;
    } catch (err: unknown) {
      const message = extractErrorMessage(err, 'Failed to load location hierarchy');
      setError(message);
      logger.error('[LocationManagement] Failed to load location hierarchy', err);
    } finally {
      if (showTreeSpinner) setHierarchyLoading(false);
      loadingHierarchyRef.current = false;
    }
  }, []);

  const filteredHierarchy = useMemo(
    () => filterHierarchyByQuery(hierarchyRoots, searchQuery),
    [hierarchyRoots, searchQuery]
  );

  const visibleHierarchyCount = useMemo(
    () => countHierarchyNodes(filteredHierarchy),
    [filteredHierarchy]
  );

  const hierarchyChildCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    const walk = (nodes: LocationHierarchyResponse[]) => {
      for (const n of nodes) {
        map[n.id] = n.children?.length ?? 0;
        if (n.children?.length) walk(n.children);
      }
    };
    walk(hierarchyRoots);
    return map;
  }, [hierarchyRoots]);

  const hierarchyIndex = useMemo(
    () => buildHierarchyIndex(filteredHierarchy),
    [filteredHierarchy]
  );

  const visibleLocationIds = useMemo(
    () => collectVisibleHierarchyIds(filteredHierarchy, expandedNodes),
    [filteredHierarchy, expandedNodes]
  );

  const expandAncestorsForLocation = useCallback(
    (id: string) => {
      const ancestors = findAncestorIdsInHierarchy(filteredHierarchy, id);
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        ancestors.forEach((aid) => next.add(aid));
        return next;
      });
    },
    [filteredHierarchy]
  );

  const scrollTreeNodeIntoView = useCallback((id: string) => {
    requestAnimationFrame(() => {
      treeContentRef.current
        ?.querySelector(`#location-tree-node-${id}`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  const focusTreeRow = useCallback(
    (id: string) => {
      setFocusedLocationId(id);
      expandAncestorsForLocation(id);
      scrollTreeNodeIntoView(id);
    },
    [expandAncestorsForLocation, scrollTreeNodeIntoView]
  );

  const activateTreeKeyboard = useCallback(() => {
    requestAnimationFrame(() => treeContentRef.current?.focus());
  }, []);

  const focusTreePanel = useCallback(() => {
    if (hierarchyLoading || !visibleLocationIds.length) {
      pendingTreePanelFocusRef.current = true;
      return;
    }
    const id =
      selectedLocationId && visibleLocationIds.includes(selectedLocationId)
        ? selectedLocationId
        : visibleLocationIds[0];
    if (!id) {
      pendingTreePanelFocusRef.current = true;
      return;
    }
    pendingTreePanelFocusRef.current = false;
    focusTreeRow(id);
    activateTreeKeyboard();
  }, [
    hierarchyLoading,
    visibleLocationIds,
    selectedLocationId,
    focusTreeRow,
    activateTreeKeyboard,
  ]);

  useEffect(() => {
    if (focusedLocationId && visibleLocationIds.includes(focusedLocationId)) return;
    const snapped = snapFocusToVisibleTree(focusedLocationId, visibleLocationIds, hierarchyIndex);
    if (snapped !== focusedLocationId) {
      setFocusedLocationId(snapped);
      if (snapped) scrollTreeNodeIntoView(snapped);
    }
  }, [visibleLocationIds, focusedLocationId, hierarchyIndex, scrollTreeNodeIntoView]);

  const expandTreeNode = useCallback((id: string) => {
    setExpandedNodes((prev) => new Set(prev).add(id));
  }, []);

  const collapseTreeNode = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const applyTreeKeyboardAction = useCallback(
    (key: string) => {
      const result = resolveTreeKeyboardAction(key, {
        focusedId: focusedLocationId,
        visibleIds: visibleLocationIds,
        expandedNodes,
        index: hierarchyIndex,
      });
      if (!result) return false;

      if (result.type === 'focus') {
        setFocusedLocationId(result.id);
        expandAncestorsForLocation(result.id);
        scrollTreeNodeIntoView(result.id);
      } else if (result.type === 'expand') {
        expandTreeNode(result.id);
        scrollTreeNodeIntoView(result.id);
      } else if (result.type === 'collapse') {
        collapseTreeNode(result.id);
        scrollTreeNodeIntoView(result.id);
      }
      return true;
    },
    [
      focusedLocationId,
      visibleLocationIds,
      expandedNodes,
      hierarchyIndex,
      expandAncestorsForLocation,
      scrollTreeNodeIntoView,
      expandTreeNode,
      collapseTreeNode,
    ]
  );

  const moveTreeFocus = useCallback(
    (direction: 'up' | 'down') => {
      applyTreeKeyboardAction(direction === 'down' ? 'ArrowDown' : 'ArrowUp');
    },
    [applyTreeKeyboardAction]
  );

  const focusFirstVisible = useCallback(() => {
    const anchor = resolveTreeFocusAnchor(visibleLocationIds, focusedLocationId);
    const id = anchor ?? visibleLocationIds[0];
    if (!id) return;
    focusTreeRow(id);
    activateTreeKeyboard();
  }, [visibleLocationIds, focusedLocationId, focusTreeRow, activateTreeKeyboard]);

  const selectLocation = useCallback(
    (id: string, options?: { subTab?: LocationSubTab }) => {
      setFocusedLocationId(id);
      if (selectedLocationId !== id) {
        setSelectedLocation(null);
        lastLoadedRef.current = { locationId: null, subTab: null };
      }
      setSelectedLocationId(id);
      if (options?.subTab) setLocationSubTab(options.subTab);
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('locationId', id);
          return p;
        },
        { replace: true }
      );
      expandAncestorsForLocation(id);
      scrollTreeNodeIntoView(id);
    },
    [expandAncestorsForLocation, scrollTreeNodeIntoView, selectedLocationId, setSearchParams]
  );

  const commitTreeFocus = useCallback(() => {
    if (!focusedLocationId) return;
    if (focusedLocationId === selectedLocationId) return;
    selectLocation(focusedLocationId);
  }, [focusedLocationId, selectedLocationId, selectLocation]);

  const loadLocationDetails = useCallback(async () => {
    if (!selectedLocationId || loadingDetailsRef.current) return;
    loadingDetailsRef.current = true;
    startDetailLoading();
    setError(null);
    try {
      const data = await inventoryService.getLocationById(selectedLocationId);
      setSelectedLocation(data);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load location details');
      setError(message);
      logger.error('[LocationManagement] Failed to load location details', err);
    } finally {
      stopDetailLoading();
      loadingDetailsRef.current = false;
    }
  }, [selectedLocationId, startDetailLoading, stopDetailLoading]);

  const loadLocationPath = useCallback(async () => {
    if (!selectedLocationId) return;
    try {
      const path = await inventoryService.getLocationPath(selectedLocationId);
      setLocationPath(path);
    } catch (err: any) {
      logger.error('[LocationManagement] Failed to load location path', err);
      setLocationPath([]);
    }
  }, [selectedLocationId]);

  const loadStockData = useCallback(async () => {
    if (!selectedLocationId || loadingStockRef.current) return;
    loadingStockRef.current = true;
    startDetailLoading();
    try {
      const hasChildren = (hierarchyChildCountMap[selectedLocationId] ?? 0) > 0;
      const data = await inventoryService.getStockByLocation(selectedLocationId, {
        includeDescendants: hasChildren,
      });
      setStockData(data);
    } catch (err: any) {
      logger.error('[LocationManagement] Failed to load stock data', err);
    } finally {
      stopDetailLoading();
      loadingStockRef.current = false;
    }
  }, [selectedLocationId, hierarchyChildCountMap, startDetailLoading, stopDetailLoading]);

  const loadChildrenData = useCallback(async () => {
    if (!selectedLocationId) return;
    startDetailLoading();
    try {
      const children = await inventoryService.getAllLocations({ parentLocationId: selectedLocationId });
      setChildrenData(children);
      
      // Load capacity usage for each child
      const usageMap: Record<string, {
        usedWeight: number;
        usedVolume: number;
        usedItems: number;
        maxWeight?: number;
        maxVolume?: number;
        maxItems?: number;
      }> = {};
      for (const child of children) {
        try {
          const usage = await inventoryService.getLocationCapacityUsage(child.id);
          usageMap[child.id] = usage;
        } catch (err) {
          // Ignore errors for capacity usage
        }
      }
      setChildrenCapacityMap(usageMap);
    } catch (err: any) {
      logger.error('[LocationManagement] Failed to load children data', err);
    } finally {
      stopDetailLoading();
    }
  }, [selectedLocationId, startDetailLoading, stopDetailLoading]);

  const loadCapacityUsage = useCallback(async () => {
    if (!selectedLocationId) return;
    startDetailLoading();
    try {
      const usage = await inventoryService.getLocationCapacityUsage(selectedLocationId);
      setCapacityUsage(usage);
    } catch (err: any) {
      logger.error('[LocationManagement] Failed to load capacity usage', err);
    } finally {
      stopDetailLoading();
    }
  }, [selectedLocationId, startDetailLoading, stopDetailLoading]);

  const loadMovementHistory = useCallback(async () => {
    if (!selectedLocationId) return;
    startDetailLoading();
    try {
      const filters: any = { locationId: selectedLocationId };
      if (movementFilters.dateFrom) filters.dateFrom = movementFilters.dateFrom;
      if (movementFilters.dateTo) filters.dateTo = movementFilters.dateTo;
      if (movementFilters.movementType) filters.movementType = movementFilters.movementType;
      // Only use itemId filter if it looks like a MongoDB ID (24 hex chars)
      // Otherwise, client-side filtering will handle SKU/name search
      if (movementFilters.productId && /^[0-9a-fA-F]{24}$/.test(movementFilters.productId)) {
        filters.itemId = movementFilters.productId;
      }
      
      const result = await inventoryService.getAllMovements({ ...filters, page: 1, limit: 100 });
      setMovementHistory(result.items);
    } catch (err: any) {
      logger.error('[LocationManagement] Failed to load movement history', err);
    } finally {
      stopDetailLoading();
    }
  }, [selectedLocationId, movementFilters, startDetailLoading, stopDetailLoading]);
  
  useEffect(() => {
    if (!lastHierarchyLoadRef.current) {
      loadHierarchy({ showTreeSpinner: true });
    }
  }, [loadHierarchy]);

  useEffect(() => {
    if (!hierarchyRoots.length) return;
    if (searchQuery.trim()) {
      setExpandedNodes(new Set(collectHierarchyIds(filteredHierarchy)));
    } else {
      setExpandedNodes(new Set(collectHierarchyIds(hierarchyRoots)));
    }
  }, [searchQuery, filteredHierarchy, hierarchyRoots]);

  useEffect(() => {
    if (showCreateWizard && createStep === 1 && locations.length === 0) {
      inventoryService.getAllLocations({}).then(setLocations).catch((err) => {
        logger.error('[LocationManagement] Failed to load locations for wizard', err);
      });
    }
  }, [showCreateWizard, createStep, locations.length]);
  
  // When stock-block dialog opens, load location branch for target list
  useEffect(() => {
    if (showStockBlockDialog && locationToDeletePermanent) {
      inventoryService.getLocationById(locationToDeletePermanent)
        .then((loc) => setStockBlockLocationBranchId(loc.branchId))
        .catch(() => setStockBlockLocationBranchId(null));
    } else {
      setStockBlockLocationBranchId(null);
    }
  }, [showStockBlockDialog, locationToDeletePermanent]);
  
  // When entering shift step, load all locations for target dropdown (same-branch filter applied in UI)
  useEffect(() => {
    if (showStockBlockShiftStep && locationToDeletePermanent) {
      inventoryService.getAllLocations({}).then(setShiftTargetLocations).catch(() => setShiftTargetLocations([]));
    } else {
      setShiftTargetLocations([]);
    }
  }, [showStockBlockShiftStep, locationToDeletePermanent]);
  
  useEffect(() => {
    if (hierarchyLoading || !visibleLocationIds.length) return;
    const urlLocationId = searchParams.get('locationId');
    if (urlLocationId) return;
    if (selectedLocationId && visibleLocationIds.includes(selectedLocationId)) return;
    selectLocation(visibleLocationIds[0], { subTab: 'stock' });
  }, [hierarchyLoading, visibleLocationIds, searchParams, selectedLocationId, selectLocation]);

  useEffect(() => {
    if (!pendingTreePanelFocusRef.current) return;
    if (hierarchyLoading || !visibleLocationIds.length) return;
    if (!selectedLocationId) return;
    focusTreePanel();
  }, [hierarchyLoading, visibleLocationIds.length, selectedLocationId, focusTreePanel]);

  useEffect(() => {
    const urlLocationId = searchParams.get('locationId') || initialLocationId;
    if (!urlLocationId || urlLocationId === selectedLocationId) return;

    setFocusedLocationId(urlLocationId);
    setSelectedLocationId(urlLocationId);
    setSelectedLocation(null);
    lastLoadedRef.current = { locationId: null, subTab: null };
    const urlSubTab = searchParams.get('locationSubTab');
    setLocationSubTab(parseLocationSubTab(urlSubTab));

    inventoryService.getLocationPath(urlLocationId).then((path) => {
      const parentIds = path.slice(0, -1).map((loc) => loc.id);
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        parentIds.forEach((id) => next.add(id));
        next.add(urlLocationId);
        return next;
      });
    }).catch((err) => {
      logger.error('[LocationManagement] Failed to load location path for deep link', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString(), initialLocationId, selectedLocationId]);

  const treeKeyboardBlocked = useMemo(() => {
    return (
      showCreateWizard ||
      showEditDrawer ||
      showDeleteConfirm ||
      showPermanentDeleteConfirm ||
      showStockBlockDialog ||
      showClearStockConfirm
    );
  }, [
    showCreateWizard,
    showEditDrawer,
    showDeleteConfirm,
    showPermanentDeleteConfirm,
    showStockBlockDialog,
    showClearStockConfirm,
  ]);

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (treeKeyboardBlocked || !visibleLocationIds.length) return;

      const navKeys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (navKeys.includes(e.key)) {
        e.preventDefault();
        applyTreeKeyboardAction(e.key);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTreeFocus();
      }
    },
    [treeKeyboardBlocked, visibleLocationIds.length, applyTreeKeyboardAction, commitTreeFocus]
  );

  useImperativeHandle(
    ref,
    () => ({ focusTreePanel, focusFirstVisible, moveTreeFocus }),
    [focusTreePanel, focusFirstVisible, moveTreeFocus]
  );
  
  // Load selected location details
  useEffect(() => {
    if (!selectedLocationId) return;
    
    // Prevent duplicate loads for the same location/subtab combination
    const key = `${selectedLocationId}-${locationSubTab}`;
    const lastKey = lastLoadedRef.current.locationId && lastLoadedRef.current.subTab
      ? `${lastLoadedRef.current.locationId}-${lastLoadedRef.current.subTab}`
      : null;
    
    if (key === lastKey) return; // Already loaded this combination
    
    // Store old location ID before updating ref
    const previousLocationId = lastLoadedRef.current.locationId;
    
    // Update ref IMMEDIATELY to prevent concurrent calls
    lastLoadedRef.current = { locationId: selectedLocationId, subTab: locationSubTab };
    
    // Always load details and path when location changes
    if (previousLocationId !== selectedLocationId) {
      loadLocationDetails();
      loadLocationPath();
    }
    
    // Load tab-specific data
    if (locationSubTab === 'stock') {
      loadStockData();
    } else if (locationSubTab === 'children') {
      loadChildrenData();
    } else if (locationSubTab === 'capacity') {
      loadCapacityUsage();
    } else if (locationSubTab === 'history') {
      loadMovementHistory();
    }
    // Note: load functions are stable useCallback hooks, so we don't need them in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocationId, locationSubTab]);
  
  // Reload history when filters change
  useEffect(() => {
    if (selectedLocationId && locationSubTab === 'history') {
      // Only reload if filters actually changed (not just object reference)
      const filtersKey = JSON.stringify(movementFilters);
      const lastFiltersKey = (lastLoadedRef.current as any).lastFiltersKey;
      if (filtersKey !== lastFiltersKey) {
        loadMovementHistory();
        (lastLoadedRef.current as any).lastFiltersKey = filtersKey;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movementFilters, selectedLocationId, locationSubTab]);

  // Filtered stock data - computed at top level to avoid hooks in render functions
  const filteredStockData = useMemo(() => {
    let result = stockData;
    
    if (stockStatusFilter) {
      result = result.filter(stock => {
        if (stockStatusFilter === 'empty') return stock.onHandQuantity === 0;
        if (stockStatusFilter === 'low') return stock.onHandQuantity > 0 && stock.onHandQuantity < 10; // Threshold can be configurable
        if (stockStatusFilter === 'blocked') return stock.blockedQuantity > 0;
        if (stockStatusFilter === 'expired') return stock.expiryDate && new Date(stock.expiryDate) < new Date();
        return true;
      });
    }
    
    return result;
  }, [stockData, stockStatusFilter]);

  const stockFilteredByProduct = useMemo(() => {
    if (!stockProductSearchQuery.trim()) return filteredStockData;
    const q = stockProductSearchQuery.trim().toLowerCase();
    return filteredStockData.filter((stock) => {
      const sku = stock.item?.sku?.toLowerCase() ?? '';
      const name = stock.item?.name?.toLowerCase() ?? '';
      const variantCode = stock.variant?.code?.toLowerCase() ?? '';
      const variantName = stock.variant?.name?.toLowerCase() ?? '';
      return (
        sku.includes(q) || name.includes(q) || variantCode.includes(q) || variantName.includes(q)
      );
    });
  }, [filteredStockData, stockProductSearchQuery]);

  const isMultiLocationStock = stockData.some((s) => s.locationId != null);
  const stockGroupedByLocation = useMemo(() => {
    if (!selectedLocationId || !isMultiLocationStock) return null;
    const groups: Record<string, StockByLocation[]> = {};
    for (const row of stockFilteredByProduct) {
      const locId = row.locationId ?? selectedLocationId;
      if (!groups[locId]) groups[locId] = [];
      groups[locId].push(row);
    }
    const otherIds = Object.keys(groups).filter((id) => id !== selectedLocationId);
    otherIds.sort((a, b) => {
      const aCode = groups[a]?.[0]?.location?.code ?? a;
      const bCode = groups[b]?.[0]?.location?.code ?? b;
      return String(aCode).localeCompare(String(bCode));
    });
    const order = [selectedLocationId, ...otherIds];
    return { groups, order };
  }, [stockFilteredByProduct, isMultiLocationStock, selectedLocationId]);

  useEffect(() => {
    if (stockGroupedByLocation?.order?.length) {
      setStockLocationSectionsExpanded(new Set(stockGroupedByLocation.order));
    }
  }, [stockGroupedByLocation?.order?.length]);

  // Filtered movements for History tab - computed at top level to avoid hooks in render functions
  const filteredMovements = useMemo(() => {
    let result = movementHistory;
    
    // Client-side product filter (for SKU/name matching)
    if (movementFilters.productId) {
      const searchTerm = movementFilters.productId.toLowerCase();
      result = result.filter(mov => {
        const itemId = mov.itemId?.toLowerCase() || '';
        const sku = mov.item?.sku?.toLowerCase() || '';
        const name = mov.item?.name?.toLowerCase() || '';
        return itemId.includes(searchTerm) || sku.includes(searchTerm) || name.includes(searchTerm);
      });
    }
    
    return result;
  }, [movementHistory, movementFilters.productId]);

  // Movement summary for History tab - computed at top level to avoid hooks in render functions
  const movementSummary = useMemo(() => {
    const receipts = filteredMovements.filter(m => m.movementType === 'RECEIPT').reduce((sum, m) => sum + Math.abs(m.quantity), 0);
    const issues = filteredMovements.filter(m => m.movementType === 'ISSUE').reduce((sum, m) => sum + Math.abs(m.quantity), 0);
    const transfersIn = filteredMovements.filter(m => m.movementType === 'TRANSFER' && m.toLocationId === selectedLocationId).reduce((sum, m) => sum + Math.abs(m.quantity), 0);
    const transfersOut = filteredMovements.filter(m => m.movementType === 'TRANSFER' && m.fromLocationId === selectedLocationId).reduce((sum, m) => sum + Math.abs(m.quantity), 0);
    const adjustments = filteredMovements.filter(m => m.movementType === 'ADJUSTMENT').reduce((sum, m) => sum + Math.abs(m.quantity), 0);
    
    return { receipts, issues, transfersIn, transfersOut, adjustments };
  }, [filteredMovements, selectedLocationId]);
  
  const handleCreate = async () => {
    setError(null);
    setSuccess(null);
    setFormSubmitting(true);
    try {
      const created = await inventoryService.createLocation(createFormData);
      setSuccess('Location created successfully');
      setShowCreateWizard(false);
      resetCreateForm();
      
      await loadHierarchy();
      selectLocation(created.id);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to create location');
      setError(message);
      logger.error('[LocationManagement] Failed to create location', err);
    } finally {
      setFormSubmitting(false);
    }
  };
  
  const handleUpdate = async () => {
    if (!selectedLocationId) return;
    setError(null);
    setSuccess(null);
    setFormSubmitting(true);
    try {
      await inventoryService.updateLocation(selectedLocationId, editFormData);
      setSuccess('Location updated successfully');
      setShowEditDrawer(false);
      resetEditForm();
      await loadLocationDetails();
      await loadHierarchy();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to update location');
      setError(message);
      logger.error('[LocationManagement] Failed to update location', err);
    } finally {
      setFormSubmitting(false);
    }
  };
  
  const handleDelete = async () => {
    if (!locationToDelete) return;
    setError(null);
    setSuccess(null);
    
    try {
      await inventoryService.deleteLocation(locationToDelete);
      setSuccess('Location deactivated');
      setShowDeleteConfirm(false);
      setLocationToDelete(null);
      if (selectedLocationId === locationToDelete) {
        setSelectedLocationId(null);
        setSelectedLocation(null);
      }
      
      await loadHierarchy();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to delete location');
      setError(message);
      logger.error('[LocationManagement] Failed to delete location', err);
    }
  };
  
  const handleDeletePermanent = async () => {
    if (!locationToDeletePermanent) return;
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.deleteLocationPermanent(locationToDeletePermanent);
      setSuccess('Location permanently deleted');
      setShowPermanentDeleteConfirm(false);
      setLocationToDeletePermanent(null);
      if (selectedLocationId === locationToDeletePermanent) {
        setSelectedLocationId(null);
        setSelectedLocation(null);
      }
      if (selectedLocationId) {
        await loadChildrenData();
      }
      await loadHierarchy();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to permanently delete location');
      if (message.toLowerCase().includes('existing stock')) {
        setShowPermanentDeleteConfirm(false);
        setShowStockBlockDialog(true);
        setStockBlockError(null);
      } else {
        setError(message);
      }
      logger.error('[LocationManagement] Failed to permanently delete location', err);
    }
  };
  
  const handleStockBlockCancel = () => {
    setShowStockBlockDialog(false);
    setShowStockBlockShiftStep(false);
    setStockBlockShiftTargetId('');
    setShowClearStockConfirm(false);
    setLocationToDeletePermanent(null);
    setStockBlockError(null);
    setStockBlockLocationBranchId(null);
  };
  
  const handleShiftStock = async () => {
    if (!locationToDeletePermanent || !stockBlockShiftTargetId) return;
    if (stockBlockShiftTargetId === locationToDeletePermanent) {
      setStockBlockError('Target location must be different from the current location.');
      return;
    }
    setStockBlockError(null);
    setStockBlockActionLoading(true);
    try {
      const stockRows = await inventoryService.getStockByLocation(locationToDeletePermanent);
      if (stockRows.length === 0) {
        setStockBlockError('No stock found at this location. You can retry permanent delete.');
        setStockBlockActionLoading(false);
        return;
      }
      const effectiveItemId = (r: StockByLocation) => r.item?.id ?? r.itemId;
      const itemIds = [...new Set(stockRows.map((r) => effectiveItemId(r)).filter(Boolean))];
      const items = await Promise.all(itemIds.map((id) => inventoryService.getItemById(id)));
      const itemMap = new Map(items.map((i) => [i.id, i]));
      const lines: MovementLineRequest[] = [];
      let skippedSerialCount = 0;
      for (const row of stockRows.filter((r) => r.onHandQuantity > 0)) {
        const itemId = effectiveItemId(row);
        if (!itemId || !/^[0-9a-fA-F]{24}$/.test(itemId)) continue;
        const item = itemMap.get(itemId);
        const requiresSerial = item?.industryFlags?.requiresSerialTracking === true;
        const unitOfMeasure = item?.unitOfMeasure ?? 'EA';
        if (requiresSerial) {
          const serials = await inventoryService.getSerialsByItem(
            itemId,
            locationToDeletePermanent,
            undefined,
            row.variantId
          );
          const serialNumbers = serials
            .filter((s) => s.currentLocationId === locationToDeletePermanent)
            .slice(0, row.onHandQuantity)
            .map((s) => s.serialNumber);
          if (serialNumbers.length === 0) {
            skippedSerialCount += 1;
            continue;
          }
          lines.push({
            itemId,
            variantId: row.variantId,
            fromLocationId: locationToDeletePermanent,
            toLocationId: stockBlockShiftTargetId,
            quantity: serialNumbers.length,
            unitOfMeasure,
            serialNumbers,
          });
        } else {
          lines.push({
            itemId,
            variantId: row.variantId,
            fromLocationId: locationToDeletePermanent,
            toLocationId: stockBlockShiftTargetId,
            quantity: row.onHandQuantity,
            unitOfMeasure,
            batchNumber: row.batchNumber,
          });
        }
      }
      if (lines.length === 0) {
        setStockBlockError(
          skippedSerialCount > 0
            ? `No transferable stock. ${skippedSerialCount} serial-tracked line(s) have no serials at this location or were skipped.`
            : 'No transferable stock lines.'
        );
        setStockBlockActionLoading(false);
        return;
      }
      if (skippedSerialCount > 0) {
        setSuccess(
          `${skippedSerialCount} serial-tracked line(s) skipped (no serials at location). Transferring ${lines.length} line(s).`
        );
      }
      const { defaultCode } = await inventoryService.getReasonCodesForMovementType('TRANSFER');
      const payload: CreateMovementBatchRequest = {
        movementType: MovementType.TRANSFER,
        defaultFromLocationId: locationToDeletePermanent,
        defaultToLocationId: stockBlockShiftTargetId,
        reasonCode: defaultCode,
        reasonDescription: 'Stock moved before location permanent delete',
        allowInactiveFromLocation: true,
        lines,
      };
      await inventoryService.createMovementBatch(payload);
      setSuccess('Stock moved successfully. You can now permanently delete the location.');
      setShowStockBlockDialog(false);
      setShowStockBlockShiftStep(false);
      setStockBlockShiftTargetId('');
      await loadHierarchy();
      if (selectedLocationId === locationToDeletePermanent) {
        setStockData([]);
      }
    } catch (err: any) {
      const msg = extractErrorMessage(err, 'Failed to shift stock');
      setStockBlockError(msg);
      logger.error('[LocationManagement] Shift stock failed', err);
    } finally {
      setStockBlockActionLoading(false);
    }
  };
  
  const handleClearStock = async () => {
    if (!locationToDeletePermanent) return;
    setStockBlockError(null);
    setStockBlockActionLoading(true);
    try {
      const stockRows = await inventoryService.getStockByLocation(locationToDeletePermanent);
      if (stockRows.length === 0) {
        setStockBlockError('No stock found at this location. You can retry permanent delete.');
        setStockBlockActionLoading(false);
        setShowClearStockConfirm(false);
        return;
      }
      const effectiveItemId = (r: StockByLocation) => r.item?.id ?? r.itemId;
      const itemIds = [...new Set(stockRows.map((r) => effectiveItemId(r)).filter(Boolean))];
      const items = await Promise.all(itemIds.map((id) => inventoryService.getItemById(id)));
      const itemMap = new Map(items.map((i) => [i.id, i]));
      const clearLines: MovementLineRequest[] = [];
      let skippedSerialClearCount = 0;
      for (const row of stockRows.filter((r) => r.onHandQuantity > 0)) {
        const itemId = effectiveItemId(row);
        if (!itemId || !/^[0-9a-fA-F]{24}$/.test(itemId)) continue;
        const item = itemMap.get(itemId);
        const requiresSerial = item?.industryFlags?.requiresSerialTracking === true;
        const unitOfMeasure = item?.unitOfMeasure ?? 'EA';
        if (requiresSerial) {
          const serials = await inventoryService.getSerialsByItem(
            itemId,
            locationToDeletePermanent,
            undefined,
            row.variantId
          );
          const serialNumbers = serials
            .filter((s) => s.currentLocationId === locationToDeletePermanent)
            .slice(0, row.onHandQuantity)
            .map((s) => s.serialNumber);
          if (serialNumbers.length === 0) {
            skippedSerialClearCount += 1;
            continue;
          }
          clearLines.push({
            itemId,
            variantId: row.variantId,
            fromLocationId: locationToDeletePermanent,
            quantity: -serialNumbers.length,
            unitOfMeasure,
            serialNumbers,
          });
        } else {
          clearLines.push({
            itemId,
            variantId: row.variantId,
            fromLocationId: locationToDeletePermanent,
            quantity: -row.onHandQuantity,
            unitOfMeasure,
            batchNumber: row.batchNumber,
          });
        }
      }
      if (clearLines.length === 0) {
        setShowClearStockConfirm(false);
        if (skippedSerialClearCount > 0 && locationToDeletePermanent) {
          setStockBlockError(
            'No serials found at this location (stock may already have been moved). Attempting permanent delete…'
          );
          try {
            await inventoryService.deleteLocationPermanent(locationToDeletePermanent);
            setSuccess('Location permanently deleted.');
            setShowStockBlockDialog(false);
            setStockBlockError(null);
            setLocationToDeletePermanent(null);
            if (selectedLocationId === locationToDeletePermanent) {
              setSelectedLocationId(null);
              setSelectedLocation(null);
            }
            if (selectedLocationId) {
              await loadChildrenData();
            }
            await loadHierarchy();
            if (selectedLocationId === locationToDeletePermanent) {
              setStockData([]);
            }
          } catch (permErr: any) {
            const permMsg = extractErrorMessage(permErr, 'Permanent delete failed');
            if (permMsg.toLowerCase().includes('existing stock')) {
              setStockBlockError(
                `Stock ledger still shows stock at this location. ${skippedSerialClearCount} serial-tracked line(s) had no serials here (they may have been moved). Try "Shift stock to another location" again, or move/clear the remaining stock from Stock Movements.`
              );
            } else {
              setStockBlockError(permMsg);
            }
          }
        } else {
          setStockBlockError(
            skippedSerialClearCount > 0
              ? `No stock to clear. ${skippedSerialClearCount} serial-tracked line(s) have no serials at this location or were skipped.`
              : 'No stock lines to clear.'
          );
        }
        setStockBlockActionLoading(false);
        return;
      }
      if (skippedSerialClearCount > 0) {
        setSuccess(
          `${skippedSerialClearCount} serial-tracked line(s) skipped. Clearing ${clearLines.length} line(s).`
        );
      }
      const lines = clearLines;
      const { defaultCode } = await inventoryService.getReasonCodesForMovementType('ADJUSTMENT');
      const payload: CreateMovementBatchRequest = {
        movementType: MovementType.ADJUSTMENT,
        defaultFromLocationId: locationToDeletePermanent,
        reasonCode: defaultCode,
        reasonDescription: 'Stock cleared before location permanent delete',
        lines,
      };
      await inventoryService.createMovementBatch(payload);
      setSuccess('Stock cleared. You can now permanently delete the location.');
      setShowStockBlockDialog(false);
      setShowClearStockConfirm(false);
      await loadHierarchy();
      if (selectedLocationId === locationToDeletePermanent) {
        setStockData([]);
      }
    } catch (err: any) {
      const msg = extractErrorMessage(err, 'Failed to clear stock');
      setStockBlockError(msg);
      logger.error('[LocationManagement] Clear stock failed', err);
    } finally {
      setStockBlockActionLoading(false);
    }
  };
  
  const resetCreateForm = () => {
    setCreateFormData({
      code: '',
      name: '',
      type: LocationType.WAREHOUSE,
    });
    setCreateStep(1);
  };

  useEffect(() => {
    if (addLocationRequestSeq <= 0) return;
    resetCreateForm();
    setShowCreateWizard(true);
  }, [addLocationRequestSeq]);

  const resetEditForm = () => {
    setEditFormData({});
  };
  
  const handleTreeExpand = (locationId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(locationId)) next.delete(locationId);
      else next.add(locationId);
      return next;
    });
  };

  const handleTreeNodeClick = useCallback((id: string) => {
    selectLocation(id);
  }, [selectLocation]);

  const handleLocationSelect = (id: string) => {
    selectLocation(id);
    const hasChildren = (hierarchyChildCountMap[id] ?? 0) > 0;
    if (hasChildren && !expandedNodes.has(id)) {
      setExpandedNodes((prev) => new Set(prev).add(id));
    }
  };
  
  const handleCreateChild = () => {
    if (!selectedLocation) return;
    
    // Determine child type based on parent
    let childType: LocationType;
    if (selectedLocation.type === LocationType.WAREHOUSE) {
      childType = LocationType.ZONE;
    } else if (selectedLocation.type === LocationType.ZONE) {
      childType = LocationType.RACK;
    } else if (selectedLocation.type === LocationType.RACK) {
      childType = LocationType.BIN;
    } else {
      return; // Cannot add child to bin
    }
    
    setCreateFormData({
      code: '',
      name: '',
      type: childType,
      parentLocationId: selectedLocation.id,
    });
    // Skip Step 1 (Parent) since it's pre-filled, start at Step 2 (Basic Info)
    setCreateStep(2);
    setShowCreateWizard(true);
  };
  
  const renderTreeNode = (location: LocationHierarchyResponse, level: number = 0): React.ReactNode => {
    const isExpanded = expandedNodes.has(location.id);
    const children = location.children ?? [];
    const hasChildren = children.length > 0;
    const isSelected = selectedLocationId === location.id;
    const isFocused = focusedLocationId === location.id;
    
    return (
      <div
        key={location.id}
        id={`location-tree-node-${location.id}`}
        className={`tree-node ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''} ${!location.isActive ? 'inactive' : ''}`}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
      >
        <div
          className={`tree-node-content ${!location.isActive ? 'tree-node-inactive' : ''}`}
          onClick={() => handleTreeNodeClick(location.id)}
          style={{ paddingLeft: `${level * 20 + 8}px`, opacity: location.isActive ? 1 : 0.6 }}
        >
          {hasChildren && (
            <button
              type="button"
              className="tree-expand-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleTreeExpand(location.id);
              }}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          {!hasChildren && <span className="tree-spacer" />}
          <span className={`tree-node-icon tree-icon-${location.type.toLowerCase()}`}>
            {location.type === LocationType.WAREHOUSE ? '🏭' :
             location.type === LocationType.ZONE ? '📍' :
             location.type === LocationType.RACK ? '📦' : '📋'}
          </span>
          <span className="tree-node-code">{location.code}</span>
          <span className="tree-node-name">{location.name}</span>
          {hasChildren && (
            <span className="tree-node-badge">({children.length})</span>
          )}
          {!location.isActive && (
            <span className="tree-node-inactive">Inactive</span>
          )}
        </div>
        {isExpanded && hasChildren && children.length > 0 && (
          <div className="tree-node-children">
            {children.map(child => renderTreeNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };
  
  const renderTreeMode = () => {
    const treeTitle = searchQuery.trim()
      ? `Locations (${visibleHierarchyCount} match${visibleHierarchyCount === 1 ? '' : 'es'})`
      : 'Location Hierarchy';

    return (
      <div className="location-tree-mode">
        <div className="tree-split-container">
          <div className="tree-panel">
            <div className="tree-header">
              <h3>{treeTitle}</h3>
            </div>
            <div
              className="tree-content"
              ref={treeContentRef}
              role="tree"
              tabIndex={0}
              aria-label="Location hierarchy"
              aria-activedescendant={
                focusedLocationId ? `location-tree-node-${focusedLocationId}` : undefined
              }
              onKeyDown={handleTreeKeyDown}
              onMouseDown={() => treeContentRef.current?.focus()}
            >
              {hierarchyLoading ? (
                <LoadingState message="Loading locations..." />
              ) : filteredHierarchy.length === 0 ? (
                <EmptyState message={searchQuery.trim() ? 'No locations match your search' : 'No locations found'} />
              ) : (
                <div className="tree-nodes">
                  {filteredHierarchy.map((loc) => renderTreeNode(loc, 0))}
                </div>
              )}
            </div>
          </div>
          <div className="detail-panel">
            {selectedLocationId ? (
              detailPanelLoading && !selectedLocation ? (
                <LoadingState message="Loading location..." />
              ) : selectedLocation ? (
                renderLocationDetail()
              ) : (
                <LoadingState message="Loading location..." />
              )
            ) : (
              <div className="location-detail-placeholder">
                <p>Select a location to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };
  
  // Render Location Detail Workspace
  const renderLocationDetail = () => {
    if (!selectedLocation) return <LoadingState message="Loading location details..." />;
    
    return (
      <div className="location-detail-workspace">
        {/* Header */}
        <div className="location-detail-header">
          <div className="detail-header-main">
            <h2>{selectedLocation.name}</h2>
            <span className={`location-type-badge type-${selectedLocation.type.toLowerCase()}`}>
              {selectedLocation.type}
            </span>
            <span className={`status-badge ${selectedLocation.isActive ? 'status-active' : 'status-inactive'}`}>
              {selectedLocation.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="detail-header-meta">
            <span className="detail-code">{selectedLocation.code}</span>
            {locationPath.length > 0 && (
              <div className="detail-breadcrumb">
                {locationPath.map((loc, idx) => (
                  <span key={loc.id}>
                    {idx > 0 && ' → '}
                    <button
                      className="breadcrumb-link"
                      onClick={() => handleLocationSelect(loc.id)}
                    >
                      {loc.name}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="detail-header-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const p = new URLSearchParams(searchParams);
                p.set('tab', 'movements');
                p.set('create', '1');
                p.set('movementType', MovementType.TRANSFER);
                p.set('fromLocationId', selectedLocation.id);
                p.set('reasonCode', getDefaultReason('TRANSFER', 'location_from').defaultCode);
                p.set('returnTab', 'locations');
                p.set('returnLocationId', selectedLocation.id);
                p.set('returnSubTab', locationSubTab);
                setSearchParams(p);
              }}
              title="Create transfer from this location"
            >
              Transfer From
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const p = new URLSearchParams(searchParams);
                p.set('tab', 'movements');
                p.set('create', '1');
                p.set('movementType', MovementType.RECEIPT);
                p.set('toLocationId', selectedLocation.id);
                p.set('reasonCode', getDefaultReason('RECEIPT', 'location').defaultCode);
                p.set('returnTab', 'locations');
                p.set('returnLocationId', selectedLocation.id);
                p.set('returnSubTab', locationSubTab);
                setSearchParams(p);
              }}
              title="Create receipt into this location"
            >
              Receipt Into
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const p = new URLSearchParams(searchParams);
                p.set('tab', 'movements');
                p.set('create', '1');
                p.set('movementType', MovementType.ISSUE);
                p.set('fromLocationId', selectedLocation.id);
                p.set('reasonCode', getDefaultReason('ISSUE', 'location').defaultCode);
                p.set('returnTab', 'locations');
                p.set('returnLocationId', selectedLocation.id);
                p.set('returnSubTab', locationSubTab);
                setSearchParams(p);
              }}
              title="Create issue from this location"
            >
              Issue From
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditFormData({
                  name: selectedLocation.name,
                  address: selectedLocation.address,
                  notes: selectedLocation.notes,
                  temperatureZone: selectedLocation.temperatureZone,
                  capacity: selectedLocation.capacity,
                  allowStock: selectedLocation.allowStock,
                  allowPicking: selectedLocation.allowPicking,
                  allowReceiving: selectedLocation.allowReceiving,
                  minTemp: selectedLocation.minTemp,
                  maxTemp: selectedLocation.maxTemp,
                });
                setShowEditDrawer(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant={selectedLocation.isActive ? 'secondary' : 'primary'}
              size="sm"
              onClick={async () => {
                await inventoryService.updateLocation(selectedLocation.id, {
                  isActive: !selectedLocation.isActive,
                });
                await loadLocationDetails();
                setSuccess(selectedLocation.isActive ? 'Location deactivated' : 'Location activated');
                await loadHierarchy();
              }}
            >
              {selectedLocation.isActive ? 'Deactivate' : 'Activate'}
            </Button>
            {!selectedLocation.isActive && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setLocationToDeletePermanent(selectedLocation.id);
                  setShowPermanentDeleteConfirm(true);
                }}
                title="Remove from database permanently"
              >
                Delete permanently
              </Button>
            )}
          </div>
        </div>
        
        <div className="location-sub-tabs">
          <button
            className={`location-sub-tab ${locationSubTab === 'stock' ? 'active' : ''}`}
            onClick={() => setLocationSubTab('stock')}
          >
            Stock
          </button>
          <button
            className={`location-sub-tab ${locationSubTab === 'children' ? 'active' : ''}`}
            onClick={() => setLocationSubTab('children')}
          >
            Children
          </button>
          <button
            className={`location-sub-tab ${locationSubTab === 'capacity' ? 'active' : ''}`}
            onClick={() => setLocationSubTab('capacity')}
          >
            Capacity & Conditions
          </button>
          <button
            className={`location-sub-tab ${locationSubTab === 'history' ? 'active' : ''}`}
            onClick={() => setLocationSubTab('history')}
          >
            History
          </button>
        </div>
        
        {/* Sub-tab content */}
        <div className="location-sub-content">
          {locationSubTab === 'stock' && renderStockTab()}
          {locationSubTab === 'children' && renderChildrenTab()}
          {locationSubTab === 'capacity' && renderCapacityTab()}
          {locationSubTab === 'history' && renderHistoryTab()}
        </div>
      </div>
    );
  };
  
  // Render Stock Tab
  const renderStockTab = () => {
    const hasChildren = (hierarchyChildCountMap[selectedLocationId ?? ''] ?? 0) > 0;
    const effectiveLocationId = (stock: StockByLocation) => stock.locationId ?? selectedLocationId ?? '';

    const buildStockColumns = (showLocationColumn: boolean): ColumnDef<StockByLocation>[] => {
      const cols: ColumnDef<StockByLocation>[] = [];
      if (showLocationColumn) {
        cols.push({
          id: 'location',
          header: 'Location',
          width: 140,
          accessor: (stock) =>
            stock.location
              ? `${stock.location.code} ${stock.location.name}`
              : selectedLocation?.code ?? selectedLocation?.name ?? '-',
        });
      }
      cols.push(
        { id: 'sku', header: 'SKU', width: 120, accessor: (stock) => stock.item?.sku ?? '' },
        { id: 'name', header: 'Product Name', minWidth: 200, accessor: (stock) => stock.item?.name ?? '' },
        {
          id: 'variant',
          header: 'Variant',
          width: 150,
          accessor: (stock) => (stock.variant ? `${stock.variant.code} - ${stock.variant.name}` : '-'),
        },
        { id: 'onHand', header: 'On Hand', width: 100, accessor: (stock) => stock.onHandQuantity },
        { id: 'reserved', header: 'Reserved', width: 100, accessor: (stock) => stock.reservedQuantity },
        { id: 'blocked', header: 'Blocked', width: 100, accessor: (stock) => stock.blockedQuantity },
        { id: 'damaged', header: 'Damaged', width: 100, accessor: (stock) => stock.damagedQuantity },
        { id: 'available', header: 'Available', width: 100, accessor: (stock) => stock.availableQuantity },
        {
          id: 'actions',
          header: 'Actions',
          width: 200,
          accessor: (stock) => {
            const itemId = stock.item?.id || stock.itemId;
            const locId = effectiveLocationId(stock);
            if (!itemId || !locId) return null;
            return (
              <div className="stock-row-actions" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const p = new URLSearchParams(searchParams);
                    p.set('tab', 'movements');
                    p.set('create', '1');
                    p.set('movementType', MovementType.RECEIPT);
                    p.set('itemId', itemId);
                    if (stock.variantId) {
                      p.set('variantId', stock.variantId);
                      p.set('variantLocked', '1');
                    }
                    p.set('toLocationId', locId);
                    p.set('reasonCode', getDefaultReason('RECEIPT', 'location').defaultCode);
                    p.set('returnTab', 'locations');
                    p.set('returnLocationId', selectedLocationId ?? '');
                    p.set('returnSubTab', 'stock');
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
                    p.set('tab', 'movements');
                    p.set('create', '1');
                    p.set('movementType', MovementType.ISSUE);
                    p.set('itemId', itemId);
                    if (stock.variantId) {
                      p.set('variantId', stock.variantId);
                      p.set('variantLocked', '1');
                    }
                    p.set('fromLocationId', locId);
                    p.set('reasonCode', getDefaultReason('ISSUE', 'location').defaultCode);
                    p.set('returnTab', 'locations');
                    p.set('returnLocationId', selectedLocationId ?? '');
                    p.set('returnSubTab', 'stock');
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
                    p.set('tab', 'movements');
                    p.set('create', '1');
                    p.set('movementType', MovementType.TRANSFER);
                    p.set('itemId', itemId);
                    if (stock.variantId) {
                      p.set('variantId', stock.variantId);
                      p.set('variantLocked', '1');
                    }
                    p.set('fromLocationId', locId);
                    p.set('reasonCode', getDefaultReason('TRANSFER', 'location_from').defaultCode);
                    p.set('returnTab', 'locations');
                    p.set('returnLocationId', selectedLocationId ?? '');
                    p.set('returnSubTab', 'stock');
                    setSearchParams(p);
                  }}
                >
                  Transfer
                </Button>
              </div>
            );
          },
        }
      );
      return cols;
    };

    const handleStockRowClick = (stock: StockByLocation) => {
      const itemId = stock.item?.id || stock.itemId;
      if (!itemId) return;
      const newParams = new URLSearchParams();
      newParams.set('tab', 'items');
      newParams.set('itemId', itemId);
      if (stock.variantId) {
        newParams.set('itemSubTab', 'stock');
        newParams.set('variantId', stock.variantId);
      } else {
        newParams.set('itemSubTab', 'stock');
        if (selectedLocationId) newParams.set('locationId', selectedLocationId);
      }
      navigate(`/inventory?${newParams.toString()}`);
    };

    const emptyMessage =
      hasChildren
        ? (stockData.length === 0 ? 'No stock at this location or any sub-location' : 'No stock matches the filter')
        : (stockData.length === 0 ? 'No stock found at this location' : 'No stock matches the filter');

    return (
      <div className="stock-tab">
        <div className="stock-tab-toolbar">
          <Select
            value={stockStatusFilter}
            onChange={(e) => setStockStatusFilter(e.target.value)}
            style={{ width: '200px' }}
          >
            <option value="">All Stock</option>
            <option value="empty">Empty</option>
            <option value="low">Low Stock</option>
            <option value="blocked">Blocked</option>
            <option value="expired">Expired</option>
          </Select>
          <Input
            type="text"
            placeholder="Search by SKU or product name..."
            value={stockProductSearchQuery}
            onChange={(e) => setStockProductSearchQuery(e.target.value)}
            className="stock-tab-search-input"
          />
        </div>

        {hasChildren && stockFilteredByProduct.length > 0 && (
          <div className="stock-summary-strip">
            <span className="stock-summary-item">
              <strong>Total on hand:</strong> {stockFilteredByProduct.reduce((s, r) => s + r.onHandQuantity, 0)}
            </span>
            <span className="stock-summary-item">
              <strong>Items:</strong>{' '}
              {new Set(stockFilteredByProduct.map((r) => `${r.itemId}|${r.variantId ?? ''}`)).size}
            </span>
            <span className="stock-summary-item">
              <strong>Locations with stock:</strong>{' '}
              {new Set(stockFilteredByProduct.map((r) => r.locationId ?? selectedLocationId).filter(Boolean)).size}
            </span>
          </div>
        )}

        {detailPanelLoading ? (
          <LoadingState message="Loading stock data..." />
        ) : stockFilteredByProduct.length === 0 ? (
          <EmptyState message={emptyMessage} />
        ) : hasChildren && stockGroupedByLocation && stockGroupedByLocation.order.length > 0 ? (
          <div className="stock-by-location-sections">
            {stockGroupedByLocation.order.map((locId) => {
              const rows = stockGroupedByLocation.groups[locId] ?? [];
              if (rows.length === 0) return null;
              const first = rows[0];
              const loc = first.location ?? (locId === selectedLocationId ? selectedLocation : null);
              const code = loc?.code ?? locId;
              const name = loc?.name ?? '';
              const type = loc?.type ?? '';
              const sumOnHand = rows.reduce((s, r) => s + r.onHandQuantity, 0);
              const isExpanded = stockLocationSectionsExpanded.has(locId);
              return (
                <div key={locId} className="stock-location-section">
                  <button
                    type="button"
                    className="stock-location-section-header"
                    onClick={() =>
                      setStockLocationSectionsExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(locId)) next.delete(locId);
                        else next.add(locId);
                        return next;
                      })
                    }
                  >
                    <span className="stock-section-toggle">{isExpanded ? '▼' : '▶'}</span>
                    <span className="stock-section-location">{code}</span>
                    <span className="stock-section-name">{name}</span>
                    {type && <span className={`location-type-badge type-${(type as string).toLowerCase()}`}>{type}</span>}
                    <span className="stock-section-meta">
                      {rows.length} line(s) · {sumOnHand} on hand
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="stock-location-section-body">
                      <DataTable
                        data={rows}
                        columns={buildStockColumns(false)}
                        searchable={false}
                        onRowClick={handleStockRowClick}
                        getRowId={(stock) => `${stock.locationId ?? locId}-${stock.itemId}-${stock.variantId || 'none'}-${stock.batchNumber || 'none'}`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <DataTable
            data={stockFilteredByProduct}
            columns={buildStockColumns(false)}
            searchable={false}
            onRowClick={handleStockRowClick}
            getRowId={(stock) => `${stock.locationId ?? selectedLocationId ?? ''}-${stock.itemId}-${stock.variantId || 'none'}-${stock.batchNumber || 'none'}`}
          />
        )}
      </div>
    );
  };
  
  // Render Children Tab
  const renderChildrenTab = () => {
    const canAddChild = selectedLocation && 
      (selectedLocation.type === LocationType.WAREHOUSE ||
       selectedLocation.type === LocationType.ZONE ||
       selectedLocation.type === LocationType.RACK);
    
    const childrenColumns: ColumnDef<Location>[] = [
      {
        id: 'code',
        header: 'Code',
        width: 120,
        accessor: (loc) => <strong>{loc.code}</strong>,
      },
      {
        id: 'name',
        header: 'Name',
        minWidth: 200,
        accessor: (loc) => loc.name,
      },
      {
        id: 'type',
        header: 'Type',
        width: 100,
        accessor: (loc) => loc.type,
      },
      {
        id: 'capacity',
        header: 'Capacity Used / Max',
        width: 150,
        accessor: (loc) => {
          const usage = childrenCapacityMap[loc.id];
          if (!usage) return '—';
          
          const parts: string[] = [];
          if (usage.maxItems !== undefined) {
            parts.push(`${usage.usedItems}/${usage.maxItems}`);
          } else if (usage.maxWeight !== undefined) {
            parts.push(`${usage.usedWeight.toFixed(1)}/${usage.maxWeight}kg`);
          } else if (usage.maxVolume !== undefined) {
            parts.push(`${usage.usedVolume.toFixed(2)}/${usage.maxVolume}m³`);
          }
          
          return parts.length > 0 ? parts[0] : '—';
        },
      },
      {
        id: 'status',
        header: 'Status',
        width: 100,
        accessor: (loc) => (
          <span className={loc.isActive ? 'status-active' : 'status-inactive'}>
            {loc.isActive ? 'Active' : 'Inactive'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        width: 220,
        accessor: (loc) => (
          <div className="cell-actions">
            <Button variant="ghost" size="sm" onClick={() => handleLocationSelect(loc.id)}>
              View
            </Button>
            {loc.isActive ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLocationToDelete(loc.id);
                  setShowDeleteConfirm(true);
                }}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLocationToDeletePermanent(loc.id);
                  setShowPermanentDeleteConfirm(true);
                }}
                title="Remove from database permanently"
              >
                Delete permanently
              </Button>
            )}
          </div>
        ),
      },
    ];
    
    return (
      <div className="children-tab">
        <div className="children-tab-header">
          <h3>Child Locations</h3>
          {canAddChild && (
            <Button variant="primary" onClick={handleCreateChild}>
              Add Child Location
            </Button>
          )}
        </div>
        {detailPanelLoading ? (
          <LoadingState message="Loading children..." />
        ) : childrenData.length === 0 ? (
          <EmptyState message={canAddChild ? "No child locations. Click 'Add Child Location' to create one." : "This location cannot have children."} />
        ) : (
          <DataTable
            data={childrenData}
            columns={childrenColumns}
            onRowClick={(loc) => handleLocationSelect(loc.id)}
            getRowId={(loc) => loc.id}
          />
        )}
      </div>
    );
  };
  
  // Render Capacity Tab
  const renderCapacityTab = () => {
    if (!selectedLocation || !capacityUsage) return <LoadingState message="Loading capacity data..." />;
    
    const weightPercent = capacityUsage.maxWeight 
      ? (capacityUsage.usedWeight / capacityUsage.maxWeight) * 100 
      : 0;
    const volumePercent = capacityUsage.maxVolume
      ? (capacityUsage.usedVolume / capacityUsage.maxVolume) * 100
      : 0;
    const itemsPercent = capacityUsage.maxItems
      ? (capacityUsage.usedItems / capacityUsage.maxItems) * 100
      : 0;
    
    return (
      <div className="capacity-tab">
        <div className="capacity-section">
          <h3>Capacity Limits</h3>
          <div className="capacity-grid">
            {selectedLocation.capacity?.maxWeight !== undefined && (
              <div className="capacity-item">
                <div className="capacity-label">
                  <span>Max Weight</span>
                  <span className="capacity-value">
                    {capacityUsage.usedWeight.toFixed(2)} / {capacityUsage.maxWeight} kg
                  </span>
                </div>
                <div className="capacity-progress">
                  <div
                    className={`capacity-progress-bar ${weightPercent > 80 ? 'warning' : ''}`}
                    style={{ width: `${Math.min(100, weightPercent)}%` }}
                  />
                </div>
                {weightPercent > 80 && (
                  <span className="capacity-warning">Warning: Capacity exceeds 80%</span>
                )}
              </div>
            )}
            {selectedLocation.capacity?.maxVolume !== undefined && (
              <div className="capacity-item">
                <div className="capacity-label">
                  <span>Max Volume</span>
                  <span className="capacity-value">
                    {capacityUsage.usedVolume.toFixed(2)} / {capacityUsage.maxVolume} m³
                  </span>
                </div>
                <div className="capacity-progress">
                  <div
                    className={`capacity-progress-bar ${volumePercent > 80 ? 'warning' : ''}`}
                    style={{ width: `${Math.min(100, volumePercent)}%` }}
                  />
                </div>
                {volumePercent > 80 && (
                  <span className="capacity-warning">Warning: Capacity exceeds 80%</span>
                )}
              </div>
            )}
            {selectedLocation.capacity?.maxItems !== undefined && (
              <div className="capacity-item">
                <div className="capacity-label">
                  <span>Max Items</span>
                  <span className="capacity-value">
                    {capacityUsage.usedItems} / {capacityUsage.maxItems}
                  </span>
                </div>
                <div className="capacity-progress">
                  <div
                    className={`capacity-progress-bar ${itemsPercent > 80 ? 'warning' : ''}`}
                    style={{ width: `${Math.min(100, itemsPercent)}%` }}
                  />
                </div>
                {itemsPercent > 80 && (
                  <span className="capacity-warning">Warning: Capacity exceeds 80%</span>
                )}
              </div>
            )}
          </div>
        </div>
        
        <div className="capacity-section">
          <h3>Environmental Conditions</h3>
          <div className="capacity-grid">
            <div>
              <label>Temperature Zone</label>
              <div>{selectedLocation.temperatureZone || '-'}</div>
            </div>
            {(selectedLocation.minTemp !== undefined || selectedLocation.maxTemp !== undefined) && (
              <>
                <div>
                  <label>Min Temperature</label>
                  <div>{selectedLocation.minTemp}°C</div>
                </div>
                <div>
                  <label>Max Temperature</label>
                  <div>{selectedLocation.maxTemp}°C</div>
                </div>
              </>
            )}
          </div>
        </div>
        
        <div className="capacity-section">
          <h3>Enforcement Rules</h3>
          <p className="info-text">These rules define how the system should behave when stock movements occur. Backend enforcement will be implemented in a future phase.</p>
          <div className="capacity-grid">
            <div>
              <label>
                <input type="checkbox" checked={true} disabled />
                Block receiving when capacity exceeded
              </label>
            </div>
            <div>
              <label>
                <input type="checkbox" checked={true} disabled />
                Warn when nearing capacity (80%)
              </label>
            </div>
            <div>
              <label>
                <input type="checkbox" checked={false} disabled />
                Block incompatible item types (Future)
              </label>
            </div>
          </div>
        </div>
      </div>
    );
  };
  
  // Render History Tab
  const renderHistoryTab = () => {
    const historyColumns: ColumnDef<StockMovementResponse>[] = [
      {
        id: 'date',
        header: 'Date',
        width: 120,
        accessor: (mov) => new Date(mov.createdAt).toLocaleDateString(),
      },
      {
        id: 'type',
        header: 'Type',
        width: 120,
        accessor: (mov) => mov.movementType,
      },
      {
        id: 'product',
        header: 'Product',
        minWidth: 150,
        accessor: (mov) => mov.item?.name || '-',
      },
      {
        id: 'variant',
        header: 'Variant',
        width: 120,
        accessor: (mov) => mov.variant?.name || '-',
      },
      {
        id: 'fromTo',
        header: 'From → To',
        minWidth: 200,
        accessor: (mov) => {
          const from = mov.fromLocation?.name || '-';
          const to = mov.toLocation?.name || '-';
          return `${from} → ${to}`;
        },
      },
      {
        id: 'quantity',
        header: 'Quantity',
        width: 100,
        accessor: (mov) => Math.abs(mov.quantity),
      },
      {
        id: 'user',
        header: 'User',
        width: 150,
        accessor: (mov) => mov.createdBy?.name || mov.createdBy?.email || '-',
      },
    ];
    
    return (
      <div className="history-tab">
        <div className="history-summary">
          <h3>Movement Summary</h3>
          <div className="summary-grid">
            <div className="summary-item">
              <label>Total Receipts</label>
              <div>{movementSummary.receipts}</div>
            </div>
            <div className="summary-item">
              <label>Total Issues</label>
              <div>{movementSummary.issues}</div>
            </div>
            <div className="summary-item">
              <label>Transfers In</label>
              <div>{movementSummary.transfersIn}</div>
            </div>
            <div className="summary-item">
              <label>Transfers Out</label>
              <div>{movementSummary.transfersOut}</div>
            </div>
            <div className="summary-item">
              <label>Adjustments</label>
              <div>{movementSummary.adjustments}</div>
            </div>
          </div>
        </div>
        
        <div className="history-filters">
          <Input
            type="date"
            value={movementFilters.dateFrom}
            onChange={(e) => setMovementFilters({ ...movementFilters, dateFrom: e.target.value })}
            placeholder="Date From"
          />
          <Input
            type="date"
            value={movementFilters.dateTo}
            onChange={(e) => setMovementFilters({ ...movementFilters, dateTo: e.target.value })}
            placeholder="Date To"
          />
          <Select
            value={movementFilters.movementType}
            onChange={(e) => setMovementFilters({ ...movementFilters, movementType: e.target.value })}
          >
            <option value="">All Types</option>
            <option value="RECEIPT">Receipt</option>
            <option value="ISSUE">Issue</option>
            <option value="TRANSFER">Transfer</option>
            <option value="ADJUSTMENT">Adjustment</option>
          </Select>
          <Input
            placeholder="Product ID or SKU..."
            value={movementFilters.productId}
            onChange={(e) => setMovementFilters({ ...movementFilters, productId: e.target.value })}
            style={{ width: '200px' }}
          />
          <Button variant="ghost" onClick={() => {
            setMovementFilters({ dateFrom: '', dateTo: '', movementType: '', productId: '' });
          }}>
            Clear Filters
          </Button>
        </div>
        
        {detailPanelLoading ? (
          <LoadingState message="Loading movement history..." />
        ) : filteredMovements.length === 0 ? (
          <EmptyState message={movementHistory.length === 0 ? "No movement history found" : "No movements match the filters"} />
        ) : (
          <DataTable
            data={filteredMovements}
            columns={historyColumns}
            getRowId={(mov) => mov.id}
          />
        )}
      </div>
    );
  };
  
  // Render Create Wizard
  const renderCreateWizard = () => {
    const getNextChildType = (parentType: LocationType): LocationType | null => {
      if (parentType === LocationType.WAREHOUSE) return LocationType.ZONE;
      if (parentType === LocationType.ZONE) return LocationType.RACK;
      if (parentType === LocationType.RACK) return LocationType.BIN;
      return null;
    };
    
    const availableParents = locations.filter(loc => {
      if (createFormData.type === LocationType.WAREHOUSE) return false;
      if (createFormData.type === LocationType.ZONE) return loc.type === LocationType.WAREHOUSE;
      if (createFormData.type === LocationType.RACK) return loc.type === LocationType.ZONE;
      if (createFormData.type === LocationType.BIN) return loc.type === LocationType.RACK;
      return false;
    });
    
    return (
      <SideDrawer
        isOpen={showCreateWizard}
        onClose={() => {
          setShowCreateWizard(false);
          resetCreateForm();
        }}
        title="Create Location"
        width="600px"
      >
        <div className="create-wizard">
          {/* Step Indicator */}
          <div className="wizard-steps">
            {[1, 2, 3, 4].map(step => (
              <div key={step} className={`wizard-step ${createStep === step ? 'active' : createStep > step ? 'completed' : ''}`}>
                <div className="step-number">{createStep > step ? '✓' : step}</div>
                <div className="step-label">
                  {step === 1 && 'Parent'}
                  {step === 2 && 'Basic Info'}
                  {step === 3 && 'Conditions'}
                  {step === 4 && 'Rules'}
                </div>
              </div>
            ))}
          </div>
          
          {error && <div className="error-message">{error}</div>}
          
          {/* Step 1: Select Parent */}
          {createStep === 1 && (
            <div className="wizard-step-content">
              <h3>Select Parent Location</h3>
              {!createFormData.parentLocationId && (
                <div className="form-group">
                  <label>Location Type *</label>
                  <Select
                    value={createFormData.type}
                    onChange={(e) => {
                      const newType = e.target.value as LocationType;
                      setCreateFormData({
                        ...createFormData,
                        type: newType,
                        parentLocationId: newType === LocationType.WAREHOUSE ? undefined : createFormData.parentLocationId,
                      });
                    }}
                  >
                    <option value={LocationType.WAREHOUSE}>Warehouse (Root Location)</option>
                    <option value={LocationType.ZONE}>Zone (Child of Warehouse)</option>
                    <option value={LocationType.RACK}>Rack (Child of Zone)</option>
                    <option value={LocationType.BIN}>Bin (Child of Rack)</option>
                  </Select>
                </div>
              )}
              {createFormData.type === LocationType.WAREHOUSE ? (
                <p className="info-text">Warehouses are root locations and do not have a parent.</p>
              ) : createFormData.parentLocationId ? (
                <>
                  <p className="info-text">Parent location is pre-selected. You can change it below if needed.</p>
                  <div className="form-group">
                    <label>Parent Location *</label>
                    <Select
                      value={createFormData.parentLocationId || ''}
                      onChange={(e) => {
                        const parentId = e.target.value;
                        const parent = locations.find(l => l.id === parentId);
                        if (parent) {
                          const childType = getNextChildType(parent.type);
                          setCreateFormData({
                            ...createFormData,
                            parentLocationId: parentId,
                            type: childType || createFormData.type,
                          });
                        }
                      }}
                    >
                      <option value="">Select Parent...</option>
                      {availableParents.map(parent => (
                        <option key={parent.id} value={parent.id}>
                          {parent.code} - {parent.name} ({parent.type})
                        </option>
                      ))}
                    </Select>
                    {createFormData.parentLocationId && (
                      <div className="field-helper-text">
                        Parent: {locations.find(l => l.id === createFormData.parentLocationId)?.name || createFormData.parentLocationId}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="info-text">Select the parent location. Child type will be auto-selected.</p>
                  <div className="form-group">
                    <label>Parent Location *</label>
                    <Select
                      value={createFormData.parentLocationId || ''}
                      onChange={(e) => {
                        const parentId = e.target.value;
                        const parent = locations.find(l => l.id === parentId);
                        if (parent) {
                          const childType = getNextChildType(parent.type);
                          setCreateFormData({
                            ...createFormData,
                            parentLocationId: parentId,
                            type: childType || createFormData.type,
                          });
                        }
                      }}
                    >
                      <option value="">Select Parent...</option>
                      {availableParents.map(parent => (
                        <option key={parent.id} value={parent.id}>
                          {parent.code} - {parent.name} ({parent.type})
                        </option>
                      ))}
                    </Select>
                  </div>
                </>
              )}
            </div>
          )}
          
          {/* Step 2: Basic Info */}
          {createStep === 2 && (
            <div className="wizard-step-content">
              <h3>Basic Information</h3>
              <div className="form-group">
                <label>Code *</label>
                <Input
                  value={createFormData.code}
                  onChange={(e) => setCreateFormData({ ...createFormData, code: e.target.value.toUpperCase() })}
                  placeholder="LOC-001"
                />
              </div>
              <div className="form-group">
                <label>Name *</label>
                <Input
                  value={createFormData.name}
                  onChange={(e) => setCreateFormData({ ...createFormData, name: e.target.value })}
                  placeholder="Location Name"
                />
              </div>
              <div className="form-group">
                <label>Type</label>
                <Input value={createFormData.type} disabled />
                <div className="field-helper-text">Auto-selected based on parent</div>
              </div>
            </div>
          )}
          
          {/* Step 3: Conditions */}
          {createStep === 3 && (
            <div className="wizard-step-content">
              <h3>Conditions</h3>
              <div className="form-group">
                <label>Temperature Zone</label>
                <Select
                  value={createFormData.temperatureZone || ''}
                  onChange={(e) => setCreateFormData({ ...createFormData, temperatureZone: e.target.value || undefined })}
                >
                  <option value="">None</option>
                  <option value="frozen">Frozen</option>
                  <option value="cold">Cold</option>
                  <option value="ambient">Ambient</option>
                </Select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Max Weight (kg)</label>
                  <Input
                    type="number"
                    value={createFormData.capacity?.maxWeight || ''}
                    onChange={(e) => setCreateFormData({
                      ...createFormData,
                      capacity: { ...createFormData.capacity, maxWeight: e.target.value ? parseFloat(e.target.value) : undefined },
                    })}
                  />
                </div>
                <div className="form-group">
                  <label>Max Volume (m³)</label>
                  <Input
                    type="number"
                    value={createFormData.capacity?.maxVolume || ''}
                    onChange={(e) => setCreateFormData({
                      ...createFormData,
                      capacity: { ...createFormData.capacity, maxVolume: e.target.value ? parseFloat(e.target.value) : undefined },
                    })}
                  />
                </div>
                <div className="form-group">
                  <label>Max Items</label>
                  <Input
                    type="number"
                    value={createFormData.capacity?.maxItems || ''}
                    onChange={(e) => setCreateFormData({
                      ...createFormData,
                      capacity: { ...createFormData.capacity, maxItems: e.target.value ? parseInt(e.target.value, 10) : undefined },
                    })}
                  />
                </div>
              </div>
              {createFormData.type === LocationType.WAREHOUSE && (
                <div className="form-group">
                  <label>Address</label>
                  <textarea
                    value={createFormData.address || ''}
                    onChange={(e) => setCreateFormData({ ...createFormData, address: e.target.value })}
                    rows={3}
                    placeholder="Warehouse address"
                  />
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label>Min Temperature (°C)</label>
                  <Input
                    type="number"
                    value={createFormData.minTemp || ''}
                    onChange={(e) => setCreateFormData({ 
                      ...createFormData, 
                      minTemp: e.target.value ? parseFloat(e.target.value) : undefined 
                    })}
                    placeholder="Optional"
                  />
                </div>
                <div className="form-group">
                  <label>Max Temperature (°C)</label>
                  <Input
                    type="number"
                    value={createFormData.maxTemp || ''}
                    onChange={(e) => setCreateFormData({ 
                      ...createFormData, 
                      maxTemp: e.target.value ? parseFloat(e.target.value) : undefined 
                    })}
                    placeholder="Optional"
                  />
                </div>
              </div>
            </div>
          )}
          
          {/* Step 4: Rules */}
          {createStep === 4 && (
            <div className="wizard-step-content">
              <h3>Rules</h3>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={createFormData.allowStock !== false}
                    onChange={(e) => setCreateFormData({ ...createFormData, allowStock: e.target.checked })}
                  />
                  Allow Stock
                </label>
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={createFormData.allowPicking !== false}
                    onChange={(e) => setCreateFormData({ ...createFormData, allowPicking: e.target.checked })}
                  />
                  Allow Picking
                </label>
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={createFormData.allowReceiving !== false}
                    onChange={(e) => setCreateFormData({ ...createFormData, allowReceiving: e.target.checked })}
                  />
                  Allow Receiving
                </label>
              </div>
            </div>
          )}
          
          {/* Wizard Actions */}
          <div className="wizard-actions">
            {createStep > 1 && (
              <Button variant="secondary" onClick={() => setCreateStep((prev) => (prev - 1) as CreateWizardStep)}>
                Previous
              </Button>
            )}
            {createStep < 4 ? (
              <Button variant="primary" onClick={() => {
                if (createStep === 1 && createFormData.type !== LocationType.WAREHOUSE && !createFormData.parentLocationId) {
                  setError('Please select a parent location');
                  return;
                }
                if (createStep === 2 && (!createFormData.code || !createFormData.name)) {
                  setError('Code and name are required');
                  return;
                }
                setCreateStep((prev) => (prev + 1) as CreateWizardStep);
                setError(null);
              }}>
                Next
              </Button>
            ) : (
              <Button variant="primary" onClick={handleCreate} disabled={formSubmitting}>
                {formSubmitting ? 'Creating...' : 'Create Location'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => {
              setShowCreateWizard(false);
              resetCreateForm();
            }}>
              Cancel
            </Button>
          </div>
        </div>
      </SideDrawer>
    );
  };
  
  // Render Edit Drawer
  const renderEditDrawer = () => {
    return (
      <SideDrawer
        isOpen={showEditDrawer}
        onClose={() => {
          setShowEditDrawer(false);
          resetEditForm();
        }}
        title="Edit Location"
        width="600px"
      >
        <div className="edit-drawer">
          {error && <div className="error-message">{error}</div>}
          
          <div className="form-group">
            <label>Name *</label>
            <Input
              value={editFormData.name || selectedLocation?.name || ''}
              onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
            />
          </div>
          
          {selectedLocation?.type === LocationType.WAREHOUSE && (
            <div className="form-group">
              <label>Address</label>
              <textarea
                value={editFormData.address !== undefined ? editFormData.address : selectedLocation?.address || ''}
                onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                rows={3}
              />
            </div>
          )}
          
          <div className="form-group">
            <label>Notes</label>
            <textarea
              value={editFormData.notes !== undefined ? editFormData.notes : selectedLocation?.notes || ''}
              onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Temperature Zone</label>
            <Select
              value={editFormData.temperatureZone !== undefined ? editFormData.temperatureZone : selectedLocation?.temperatureZone || ''}
              onChange={(e) => setEditFormData({ ...editFormData, temperatureZone: e.target.value || undefined })}
            >
              <option value="">None</option>
              <option value="frozen">Frozen</option>
              <option value="cold">Cold</option>
              <option value="ambient">Ambient</option>
            </Select>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Min Temperature (°C)</label>
              <Input
                type="number"
                value={editFormData.minTemp !== undefined ? editFormData.minTemp : selectedLocation?.minTemp || ''}
                onChange={(e) => setEditFormData({ 
                  ...editFormData, 
                  minTemp: e.target.value ? parseFloat(e.target.value) : undefined 
                })}
                placeholder="Optional"
              />
            </div>
            <div className="form-group">
              <label>Max Temperature (°C)</label>
              <Input
                type="number"
                value={editFormData.maxTemp !== undefined ? editFormData.maxTemp : selectedLocation?.maxTemp || ''}
                onChange={(e) => setEditFormData({ 
                  ...editFormData, 
                  maxTemp: e.target.value ? parseFloat(e.target.value) : undefined 
                })}
                placeholder="Optional"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Max Weight (kg)</label>
              <Input
                type="number"
                value={editFormData.capacity?.maxWeight !== undefined ? editFormData.capacity?.maxWeight : selectedLocation?.capacity?.maxWeight || ''}
                onChange={(e) => setEditFormData({
                  ...editFormData,
                  capacity: {
                    ...editFormData.capacity,
                    ...selectedLocation?.capacity,
                    maxWeight: e.target.value ? parseFloat(e.target.value) : undefined,
                  },
                })}
              />
            </div>
            <div className="form-group">
              <label>Max Volume (m³)</label>
              <Input
                type="number"
                value={editFormData.capacity?.maxVolume !== undefined ? editFormData.capacity?.maxVolume : selectedLocation?.capacity?.maxVolume || ''}
                onChange={(e) => setEditFormData({
                  ...editFormData,
                  capacity: {
                    ...editFormData.capacity,
                    ...selectedLocation?.capacity,
                    maxVolume: e.target.value ? parseFloat(e.target.value) : undefined,
                  },
                })}
              />
            </div>
            <div className="form-group">
              <label>Max Items</label>
              <Input
                type="number"
                value={editFormData.capacity?.maxItems !== undefined ? editFormData.capacity?.maxItems : selectedLocation?.capacity?.maxItems || ''}
                onChange={(e) => setEditFormData({
                  ...editFormData,
                  capacity: {
                    ...editFormData.capacity,
                    ...selectedLocation?.capacity,
                    maxItems: e.target.value ? parseInt(e.target.value, 10) : undefined,
                  },
                })}
              />
            </div>
          </div>
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={editFormData.allowStock !== undefined ? editFormData.allowStock : selectedLocation?.allowStock !== false}
                onChange={(e) => setEditFormData({ ...editFormData, allowStock: e.target.checked })}
              />
              Allow Stock
            </label>
          </div>
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={editFormData.allowPicking !== undefined ? editFormData.allowPicking : selectedLocation?.allowPicking !== false}
                onChange={(e) => setEditFormData({ ...editFormData, allowPicking: e.target.checked })}
              />
              Allow Picking
            </label>
          </div>
          
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={editFormData.allowReceiving !== undefined ? editFormData.allowReceiving : selectedLocation?.allowReceiving !== false}
                onChange={(e) => setEditFormData({ ...editFormData, allowReceiving: e.target.checked })}
              />
              Allow Receiving
            </label>
          </div>
          
          <div className="form-actions">
            <Button variant="primary" onClick={handleUpdate} disabled={formSubmitting}>
              {formSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button variant="secondary" onClick={() => {
              setShowEditDrawer(false);
              resetEditForm();
            }}>
              Cancel
            </Button>
          </div>
        </div>
      </SideDrawer>
    );
  };
  
  return (
    <div className="location-management">
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="location-workspace">
        {renderTreeMode()}
      </div>
      
      {/* Create Wizard */}
      {showCreateWizard && renderCreateWizard()}
      
      {/* Edit Drawer */}
      {showEditDrawer && renderEditDrawer()}
      
      {/* Deactivate (soft delete) Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Deactivate location"
        message="This location will be deactivated and hidden from active lists. You can activate it again later."
        confirmLabel="Deactivate"
        onConfirm={handleDelete}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setLocationToDelete(null);
        }}
        variant="danger"
      />
      
      {/* Permanent delete Confirmation */}
      <ConfirmDialog
        isOpen={showPermanentDeleteConfirm}
        title="Delete permanently"
        message="This will remove the location from the database and cannot be undone. Only do this if you are sure you no longer need this location."
        confirmLabel="Delete permanently"
        onConfirm={handleDeletePermanent}
        onCancel={() => {
          setShowPermanentDeleteConfirm(false);
          setLocationToDeletePermanent(null);
        }}
        variant="danger"
      />
      
      {/* Stock block dialog: location has existing stock */}
      <Modal
        isOpen={showStockBlockDialog}
        onClose={handleStockBlockCancel}
        title="Location has existing stock"
        size="md"
      >
        <div className="stock-block-dialog">
          {!showStockBlockShiftStep ? (
            <>
              <p className="stock-block-message">
                This location cannot be permanently deleted until all stock is moved or cleared.
                Choose an option below.
              </p>
              {stockBlockError && (
                <div className="stock-block-error">{stockBlockError}</div>
              )}
              <div className="stock-block-actions">
                <Button
                  variant="primary"
                  onClick={() => {
                    setStockBlockError(null);
                    setShowStockBlockShiftStep(true);
                  }}
                  disabled={stockBlockActionLoading}
                >
                  Shift stock to another location
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setShowClearStockConfirm(true)}
                  disabled={stockBlockActionLoading}
                >
                  Clear all stock
                </Button>
                <Button variant="secondary" onClick={handleStockBlockCancel}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="stock-block-message">
                Select the target location to move all stock to. Only active locations in the same branch are listed.
              </p>
              {stockBlockError && (
                <div className="stock-block-error">{stockBlockError}</div>
              )}
              <div className="stock-block-shift-form">
                <label>Target location</label>
                <Select
                  value={stockBlockShiftTargetId}
                  onChange={(e) => setStockBlockShiftTargetId(e.target.value)}
                  style={{ width: '100%', marginBottom: 12 }}
                >
                  <option value="">Select location...</option>
                  {shiftTargetLocations
                    .filter(
                      (l) =>
                        l.isActive &&
                        l.id !== locationToDeletePermanent &&
                        (stockBlockLocationBranchId == null || l.branchId === stockBlockLocationBranchId)
                    )
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} – {l.name}
                      </option>
                    ))}
                </Select>
                {stockBlockLocationBranchId != null &&
                  shiftTargetLocations.filter(
                    (l) =>
                      l.isActive &&
                      l.id !== locationToDeletePermanent &&
                      l.branchId === stockBlockLocationBranchId
                  ).length === 0 && (
                    <p className="stock-block-no-targets">
                      No other location in this branch to transfer to. Add a location or clear stock instead.
                    </p>
                  )}
                <div className="stock-block-shift-buttons">
                  <Button
                    variant="primary"
                    onClick={handleShiftStock}
                    disabled={
                      stockBlockActionLoading ||
                      !stockBlockShiftTargetId ||
                      (stockBlockLocationBranchId != null &&
                        shiftTargetLocations.filter(
                          (l) =>
                            l.isActive &&
                            l.id !== locationToDeletePermanent &&
                            l.branchId === stockBlockLocationBranchId
                        ).length === 0)
                    }
                  >
                    {stockBlockActionLoading ? 'Moving...' : 'Create transfer'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowStockBlockShiftStep(false);
                      setStockBlockShiftTargetId('');
                      setStockBlockError(null);
                    }}
                    disabled={stockBlockActionLoading}
                  >
                    Back
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
      
      {/* Clear all stock confirmation */}
      <ConfirmDialog
        isOpen={showClearStockConfirm}
        title="Clear all stock"
        message="This will reduce all stock at this location to zero. Adjustment records will be created for audit. This action cannot be undone for the stock. Reserved or blocked quantities may still need to be released separately."
        confirmLabel="Clear all stock"
        onConfirm={() => {
          setShowClearStockConfirm(false);
          handleClearStock();
        }}
        onCancel={() => setShowClearStockConfirm(false)}
        variant="danger"
      />
    </div>
  );
});

LocationManagement.displayName = 'LocationManagement';
