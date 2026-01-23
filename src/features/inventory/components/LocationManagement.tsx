/**
 * Location Management Component - Manage location hierarchy
 * 
 * Top-level structure:
 * - Workspace (List/Tree + Location Detail)
 * - Settings (Location rules, capacity units, temperature definitions)
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
} from '@/services/inventory.service';
import { getDefaultReason } from '../constants/movementReasonMapping';
import { Button, Input, Card, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState, ErrorState } from '@/shared/components/data-display';
import { DataTable, ColumnDef } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { ConfirmDialog, SideDrawer } from '@/shared/components/modals';
import './LocationManagement.css';

type TopSection = 'workspace' | 'settings';
type WorkspaceMode = 'list' | 'tree';
type LocationSubTab = 'overview' | 'stock' | 'children' | 'capacity' | 'history';
type CreateWizardStep = 1 | 2 | 3 | 4;

interface LocationManagementProps {
  locationId?: string; // From URL for deep linking
}

export const LocationManagement: React.FC<LocationManagementProps> = ({ locationId: initialLocationId }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // Top-level section
  const [topSection, setTopSection] = useState<TopSection>('workspace');
  
  // Workspace mode
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('tree');
  
  // Location data
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(initialLocationId || null);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [locationPath, setLocationPath] = useState<Location[]>([]);
  
  // Tree state
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [childCounts, setChildCounts] = useState<Record<string, number>>({});
  const [loadedChildren, setLoadedChildren] = useState<Record<string, Location[]>>({});
  
  // List state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<LocationType | ''>('');
  const [filterWarehouse, setFilterWarehouse] = useState<string>('');
  const [filterTemperatureZone, setFilterTemperatureZone] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Detail state
  const [locationSubTab, setLocationSubTab] = useState<LocationSubTab>('overview');
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
  const [collapsedOverviewSections, setCollapsedOverviewSections] = useState<Set<string>>(new Set());
  const [locationCapacityMap, setLocationCapacityMap] = useState<Record<string, {
    usedWeight: number;
    usedVolume: number;
    usedItems: number;
    maxWeight?: number;
    maxVolume?: number;
    maxItems?: number;
  }>>({});
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState<string | null>(null);
  
  // Refs to prevent concurrent loading
  const loadingStockRef = useRef(false);
  const loadingDetailsRef = useRef(false);
  const loadingLocationsRef = useRef(false);
  const loadingRootLocationsRef = useRef(false);
  const lastLoadedRef = useRef<{ locationId: string | null; subTab: LocationSubTab | null }>({ locationId: null, subTab: null });
  const lastLocationsLoadRef = useRef<string>('');
  const loadedChildrenRef = useRef<Set<string>>(new Set());
  
  // Load functions - defined before useEffects to avoid TDZ errors
  const loadLocations = useCallback(async () => {
    if (loadingLocationsRef.current) return; // Prevent concurrent calls
    loadingLocationsRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const filters: any = {};
      if (filterType) filters.type = filterType;
      if (filterWarehouse === 'root') {
        // For root filter, get warehouses (no parent)
        filters.parentLocationId = null;
      } else if (filterWarehouse) {
        filters.parentLocationId = filterWarehouse;
      }
      if (filterStatus) filters.isActive = filterStatus === 'active';
      
      // Note: temperatureZone filter not supported in getAllLocations API
      // We'll filter client-side if needed
      let data = await inventoryService.getAllLocations(filters);
      
      // Client-side filter for temperature zone
      if (filterTemperatureZone) {
        data = data.filter(loc => loc.temperatureZone === filterTemperatureZone);
      }
      
      setLocations(data);
      
      // Load capacity usage for all locations in parallel (for List mode)
      if (workspaceMode === 'list') {
        const capacityPromises = data.map(async (loc) => {
          try {
            const usage = await inventoryService.getLocationCapacityUsage(loc.id);
            return { locationId: loc.id, usage };
          } catch (err) {
            return { locationId: loc.id, usage: null };
          }
        });
        
        const capacityResults = await Promise.all(capacityPromises);
        const capacityMap: Record<string, any> = {};
        capacityResults.forEach(({ locationId, usage }) => {
          if (usage) {
            capacityMap[locationId] = usage;
          }
        });
        setLocationCapacityMap(capacityMap);
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load locations');
      setError(message);
      logger.error('[LocationManagement] Failed to load locations', err);
    } finally {
      setLoading(false);
      loadingLocationsRef.current = false;
    }
  }, [filterType, filterWarehouse, filterStatus, filterTemperatureZone, workspaceMode]);

  const loadRootLocations = useCallback(async () => {
    if (loadingRootLocationsRef.current) return; // Prevent concurrent calls
    loadingRootLocationsRef.current = true;
    setLoading(true);
    setError(null);
    try {
      // Get warehouses (no parent) - use undefined instead of null to avoid 400 errors
      const data = await inventoryService.getAllLocations({ parentLocationId: null });
      setLocations(data);
      setLoadedChildren({ root: data });
      
      // Load child counts for roots
      const counts: Record<string, number> = {};
      for (const loc of data) {
        try {
          const countResult = await inventoryService.getLocationChildCount(loc.id);
          counts[loc.id] = countResult.count;
        } catch (err) {
          counts[loc.id] = 0;
        }
      }
      setChildCounts(counts);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load root locations');
      setError(message);
      logger.error('[LocationManagement] Failed to load root locations', err);
    } finally {
      setLoading(false);
      loadingRootLocationsRef.current = false;
    }
  }, []);

  const loadLocationChildren = useCallback(async (parentId: string) => {
    // Use ref to check if already loaded (avoids dependency on loadedChildren state)
    if (loadedChildrenRef.current.has(parentId)) return; // Already loaded
    
    // Mark as loading immediately
    loadedChildrenRef.current.add(parentId);
    
    try {
      const children = await inventoryService.getAllLocations({ parentLocationId: parentId });
      setLoadedChildren(prev => ({ ...prev, [parentId]: children }));
      
      // Load child counts
      const counts: Record<string, number> = {};
      for (const child of children) {
        try {
          const countResult = await inventoryService.getLocationChildCount(child.id);
          counts[child.id] = countResult.count;
        } catch (err) {
          counts[child.id] = 0;
        }
      }
      setChildCounts(prev => ({ ...prev, ...counts }));
    } catch (err: any) {
      logger.error('[LocationManagement] Failed to load children', err);
      // Remove from ref on error so it can be retried
      loadedChildrenRef.current.delete(parentId);
    }
  }, []);

  const loadLocationDetails = useCallback(async () => {
    if (!selectedLocationId || loadingDetailsRef.current) return;
    loadingDetailsRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getLocationById(selectedLocationId);
      setSelectedLocation(data);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load location details');
      setError(message);
      logger.error('[LocationManagement] Failed to load location details', err);
    } finally {
      setLoading(false);
      loadingDetailsRef.current = false;
    }
  }, [selectedLocationId]);

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
    setLoading(true);
    try {
      const data = await inventoryService.getStockByLocation(selectedLocationId);
      setStockData(data);
    } catch (err: any) {
      logger.error('[LocationManagement] Failed to load stock data', err);
    } finally {
      setLoading(false);
      loadingStockRef.current = false;
    }
  }, [selectedLocationId]);

  const loadChildrenData = useCallback(async () => {
    if (!selectedLocationId) return;
    setLoading(true);
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
      setLoading(false);
    }
  }, [selectedLocationId]);

  const loadCapacityUsage = useCallback(async () => {
    if (!selectedLocationId) return;
    try {
      const usage = await inventoryService.getLocationCapacityUsage(selectedLocationId);
      setCapacityUsage(usage);
    } catch (err: any) {
      logger.error('[LocationManagement] Failed to load capacity usage', err);
    }
  }, [selectedLocationId]);

  const loadMovementHistory = useCallback(async () => {
    if (!selectedLocationId) return;
    setLoading(true);
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
      
      const movements = await inventoryService.getAllMovements(filters);
      setMovementHistory(movements);
    } catch (err: any) {
      logger.error('[LocationManagement] Failed to load movement history', err);
    } finally {
      setLoading(false);
    }
  }, [selectedLocationId, movementFilters]);
  
  // Load initial data
  useEffect(() => {
    if (topSection === 'workspace') {
      // Create a key for this load combination
      const loadKey = `${workspaceMode}-${filterType}-${filterWarehouse}-${filterTemperatureZone}-${filterStatus}`;
      if (loadKey === lastLocationsLoadRef.current) return; // Already loaded this combination
      
      if (workspaceMode === 'list') {
        loadLocations();
      } else {
        loadRootLocations();
      }
      lastLocationsLoadRef.current = loadKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topSection, workspaceMode, filterType, filterWarehouse, filterTemperatureZone, filterStatus, loadLocations, loadRootLocations]);
  
  // Load all locations when create wizard opens (for parent selection)
  useEffect(() => {
    if (showCreateWizard && createStep === 1) {
      // Load all locations if not already loaded (for parent selection)
      if (locations.length === 0 || workspaceMode === 'tree') {
        inventoryService.getAllLocations({}).then(data => {
          setLocations(data);
        }).catch(err => {
          logger.error('[LocationManagement] Failed to load locations for wizard', err);
        });
      }
    }
  }, [showCreateWizard, createStep]);
  
  // Handle deep linking from URL or prop
  useEffect(() => {
    const urlLocationId = searchParams.get('locationId') || initialLocationId;
    const hasLocationIdInUrl = !!searchParams.get('locationId');
    
    if (urlLocationId && urlLocationId !== selectedLocationId) {
      setSelectedLocationId(urlLocationId);
      setWorkspaceMode('tree');
      setTopSection('workspace');
      // If coming from Item Master (locationId in URL), open Stock tab
      if (hasLocationIdInUrl) {
        setLocationSubTab('stock');
      }
      
      // Load location path to expand tree
      inventoryService.getLocationPath(urlLocationId).then(path => {
        // Expand all parent nodes
        const parentIds = path.slice(0, -1).map(loc => loc.id);
        setExpandedNodes(prev => {
          const next = new Set(prev);
          parentIds.forEach(id => next.add(id));
          return next;
        });
        
        // Load children for each parent
        parentIds.forEach(parentId => {
          loadLocationChildren(parentId);
        });
      }).catch(err => {
        logger.error('[LocationManagement] Failed to load location path for deep link', err);
      });
    }
    // Note: loadLocationChildren is stable useCallback, searchParams is from useSearchParams hook
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString(), initialLocationId, selectedLocationId]);
  
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
    try {
      const created = await inventoryService.createLocation(createFormData);
      setSuccess('Location created successfully');
      setShowCreateWizard(false);
      resetCreateForm();
      
      // Switch to Tree mode and open new location
      setWorkspaceMode('tree');
      await loadRootLocations();
      
      // Load location path to expand tree
      try {
        const path = await inventoryService.getLocationPath(created.id);
        const parentIds = path.slice(0, -1).map(loc => loc.id);
        setExpandedNodes(prev => {
          const next = new Set(prev);
          parentIds.forEach(id => next.add(id));
          return next;
        });
        
        // Load children for each parent
        for (const parentId of parentIds) {
          await loadLocationChildren(parentId);
        }
      } catch (err) {
        logger.error('[LocationManagement] Failed to load path for new location', err);
      }
      
      // Select and load the new location
      setSelectedLocationId(created.id);
      setSearchParams({ locationId: created.id }, { replace: true });
      await loadLocationDetails();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to create location');
      setError(message);
      logger.error('[LocationManagement] Failed to create location', err);
    }
  };
  
  const handleUpdate = async () => {
    if (!selectedLocationId) return;
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.updateLocation(selectedLocationId, editFormData);
      setSuccess('Location updated successfully');
      setShowEditDrawer(false);
      resetEditForm();
      await loadLocationDetails();
      
      // Clear children cache for parent location to force reload on next expand
      if (selectedLocation?.parentLocationId) {
        loadedChildrenRef.current.delete(selectedLocation.parentLocationId);
        setLoadedChildren(prev => {
          const next = { ...prev };
          delete next[selectedLocation.parentLocationId!];
          return next;
        });
      }
      
      if (workspaceMode === 'tree') {
        await loadRootLocations();
      } else {
        await loadLocations();
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to update location');
      setError(message);
      logger.error('[LocationManagement] Failed to update location', err);
    }
  };
  
  const handleDelete = async () => {
    if (!locationToDelete) return;
    setError(null);
    setSuccess(null);
    
    // Get parent ID before deletion
    let parentId: string | null = null;
    try {
      const locationToDeleteData = await inventoryService.getLocationById(locationToDelete);
      parentId = locationToDeleteData.parentLocationId || null;
    } catch (err) {
      // If we can't get the location, continue with deletion
    }
    
    try {
      await inventoryService.deleteLocation(locationToDelete);
      setSuccess('Location deleted successfully');
      setShowDeleteConfirm(false);
      setLocationToDelete(null);
      if (selectedLocationId === locationToDelete) {
        setSelectedLocationId(null);
        setSelectedLocation(null);
      }
      
      // Clear children cache for parent location to force reload on next expand
      if (parentId) {
        loadedChildrenRef.current.delete(parentId);
        setLoadedChildren(prev => {
          const next = { ...prev };
          delete next[parentId!];
          return next;
        });
      }
      
      if (workspaceMode === 'tree') {
        await loadRootLocations();
      } else {
        await loadLocations();
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to delete location');
      setError(message);
      logger.error('[LocationManagement] Failed to delete location', err);
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
  
  const resetEditForm = () => {
    setEditFormData({});
  };
  
  const handleTreeExpand = (locationId: string) => {
    if (expandedNodes.has(locationId)) {
      setExpandedNodes(prev => {
        const next = new Set(prev);
        next.delete(locationId);
        return next;
      });
    } else {
      setExpandedNodes(prev => new Set(prev).add(locationId));
      // Clear cache for this parent to force reload on expand
      loadedChildrenRef.current.delete(locationId);
      setLoadedChildren(prev => {
        const next = { ...prev };
        delete next[locationId];
        return next;
      });
      loadLocationChildren(locationId);
    }
  };
  
  const handleLocationSelect = (id: string) => {
    setSelectedLocationId(id);
    setLocationSubTab('overview');
    setSearchParams({ locationId: id }, { replace: true });
    
    // Auto-expand if location has children and is not already expanded
    const hasChildren = childCounts[id] > 0;
    const isExpanded = expandedNodes.has(id);
    
    if (hasChildren && !isExpanded) {
      // Expand the node
      setExpandedNodes(prev => new Set(prev).add(id));
      
      // Clear cache to force reload (ensures fresh data)
      loadedChildrenRef.current.delete(id);
      setLoadedChildren(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      
      // Load children
      loadLocationChildren(id);
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
  
  // Filtered and sorted locations for list
  const filteredLocations = useMemo(() => {
    let result = locations;
    
    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(loc =>
        loc.code.toLowerCase().includes(term) ||
        loc.name.toLowerCase().includes(term)
      );
    }
    
    // Sort
    if (sortColumn) {
      result = [...result].sort((a, b) => {
        let aVal: any, bVal: any;
        if (sortColumn === 'code') {
          aVal = a.code;
          bVal = b.code;
        } else if (sortColumn === 'name') {
          aVal = a.name;
          bVal = b.name;
        } else if (sortColumn === 'type') {
          aVal = a.type;
          bVal = b.type;
        } else {
          return 0;
        }
        
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return result;
  }, [locations, searchTerm, sortColumn, sortDirection]);
  
  const paginatedLocations = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredLocations.slice(start, start + itemsPerPage);
  }, [filteredLocations, currentPage, itemsPerPage]);
  
  // Render List Mode
  const renderListMode = () => {
    const warehouses = locations.filter(loc => loc.type === LocationType.WAREHOUSE);
    
    const listColumns: ColumnDef<Location>[] = [
      {
        id: 'select',
        header: (
          <input
            type="checkbox"
            checked={selectedItems.size > 0 && selectedItems.size === paginatedLocations.length}
            onChange={(e) => {
              if (e.target.checked) {
                setSelectedItems(new Set(paginatedLocations.map(loc => loc.id)));
              } else {
                setSelectedItems(new Set());
              }
            }}
            title="Select all"
          />
        ),
        width: 40,
        accessor: (loc) => (
          <input
            type="checkbox"
            checked={selectedItems.has(loc.id)}
            onChange={(e) => {
              e.stopPropagation();
              setSelectedItems(prev => {
                const next = new Set(prev);
                if (e.target.checked) {
                  next.add(loc.id);
                } else {
                  next.delete(loc.id);
                }
                return next;
              });
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      },
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
        width: 120,
        accessor: (loc) => loc.type,
      },
      {
        id: 'parent',
        header: 'Parent',
        minWidth: 150,
        accessor: (loc) => loc.parentLocation?.name || '-',
      },
      {
        id: 'temperature',
        header: 'Temperature Zone',
        width: 140,
        accessor: (loc) => loc.temperatureZone || '-',
      },
      {
        id: 'capacity',
        header: 'Capacity Used / Max',
        width: 150,
        accessor: (loc) => {
          const usage = locationCapacityMap[loc.id];
          if (!usage) return '—';
          
          const parts: string[] = [];
          if (usage.maxItems !== undefined) {
            parts.push(`Items: ${usage.usedItems}/${usage.maxItems}`);
          }
          if (usage.maxWeight !== undefined) {
            parts.push(`Weight: ${usage.usedWeight.toFixed(1)}/${usage.maxWeight}kg`);
          }
          if (usage.maxVolume !== undefined) {
            parts.push(`Vol: ${usage.usedVolume.toFixed(2)}/${usage.maxVolume}m³`);
          }
          
          if (parts.length === 0) return '—';
          return parts[0]; // Show first capacity metric
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
        width: 150,
        accessor: (loc) => (
          <div className="list-row-actions" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleLocationSelect(loc.id)}
            >
              View
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                if (!confirm(`Delete location ${loc.code}? This action cannot be undone.`)) return;
                setLoading(true);
                try {
                  await inventoryService.deleteLocation(loc.id);
                  setSuccess('Location deleted successfully');
                  await loadLocations();
                } catch (err: any) {
                  setError(extractErrorMessage(err, 'Failed to delete location'));
                } finally {
                  setLoading(false);
                }
              }}
            >
              Delete
            </Button>
          </div>
        ),
      },
    ];
    
    return (
      <div className="location-list-mode">
        <div className="list-split-container">
          <div className="list-panel">
            <div className="list-toolbar">
              <div className="list-search-filters">
                <Input
                  placeholder="Search by code or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ width: '300px' }}
                />
                <Select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as LocationType | '')}
                  style={{ width: '150px' }}
                >
                  <option value="">All Types</option>
                  {Object.values(LocationType).map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </Select>
                <Select
                  value={filterWarehouse}
                  onChange={(e) => setFilterWarehouse(e.target.value)}
                  style={{ width: '200px' }}
                >
                  <option value="">All Warehouses</option>
                  <option value="root">Root (Warehouses)</option>
                  {warehouses.map(wh => (
                    <option key={wh.id} value={wh.id}>{wh.code} - {wh.name}</option>
                  ))}
                </Select>
                <Select
                  value={filterTemperatureZone}
                  onChange={(e) => setFilterTemperatureZone(e.target.value)}
                  style={{ width: '150px' }}
                >
                  <option value="">All Zones</option>
                  <option value="frozen">Frozen</option>
                  <option value="cold">Cold</option>
                  <option value="ambient">Ambient</option>
                </Select>
                <Select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  style={{ width: '120px' }}
                >
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
              {selectedItems.size > 0 && (
                <div className="bulk-actions">
                  <span>{selectedItems.size} selected</span>
                  <Button variant="secondary" size="sm" onClick={async () => {
                    setLoading(true);
                    setError(null);
                    try {
                      await Promise.all(Array.from(selectedItems).map(id => 
                        inventoryService.updateLocation(id, { isActive: true })
                      ));
                      setSuccess(`${selectedItems.size} location(s) activated`);
                      setSelectedItems(new Set());
                      await loadLocations();
                    } catch (err: any) {
                      setError(extractErrorMessage(err, 'Failed to activate locations'));
                    } finally {
                      setLoading(false);
                    }
                  }}>
                    Activate
                  </Button>
                  <Button variant="secondary" size="sm" onClick={async () => {
                    setLoading(true);
                    setError(null);
                    try {
                      await Promise.all(Array.from(selectedItems).map(id => 
                        inventoryService.updateLocation(id, { isActive: false })
                      ));
                      setSuccess(`${selectedItems.size} location(s) deactivated`);
                      setSelectedItems(new Set());
                      await loadLocations();
                    } catch (err: any) {
                      setError(extractErrorMessage(err, 'Failed to deactivate locations'));
                    } finally {
                      setLoading(false);
                    }
                  }}>
                    Deactivate
                  </Button>
                  <Button variant="danger" size="sm" onClick={async () => {
                    if (!confirm(`Delete ${selectedItems.size} location(s)? This action cannot be undone.`)) return;
                    setLoading(true);
                    setError(null);
                    try {
                      const results = await Promise.allSettled(
                        Array.from(selectedItems).map(id => inventoryService.deleteLocation(id))
                      );
                      const failed = results.filter(r => r.status === 'rejected').length;
                      if (failed === 0) {
                        setSuccess(`${selectedItems.size} location(s) deleted`);
                      } else {
                        setError(`${failed} location(s) could not be deleted (may have children or stock)`);
                      }
                      setSelectedItems(new Set());
                      await loadLocations();
                    } catch (err: any) {
                      setError(extractErrorMessage(err, 'Failed to delete locations'));
                    } finally {
                      setLoading(false);
                    }
                  }}>
                    Delete
                  </Button>
                </div>
              )}
            </div>
            
            {loading ? (
              <LoadingState message="Loading locations..." />
            ) : filteredLocations.length === 0 ? (
              <EmptyState message="No locations found" />
            ) : (
              <>
                <div className="list-table-container">
                  <DataTable
                    data={paginatedLocations}
                    columns={listColumns}
                    onRowClick={(loc) => handleLocationSelect(loc.id)}
                    selectedRowId={selectedLocationId || undefined}
                    getRowId={(loc) => loc.id}
                  />
                </div>
                <div className="list-pagination">
                  <span>
                    Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredLocations.length)} of {filteredLocations.length}
                  </span>
                  <div className="pagination-controls">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <span>Page {currentPage} of {Math.ceil(filteredLocations.length / itemsPerPage)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.min(Math.ceil(filteredLocations.length / itemsPerPage), prev + 1))}
                      disabled={currentPage >= Math.ceil(filteredLocations.length / itemsPerPage)}
                    >
                      Next
                    </Button>
                    <Select
                      value={itemsPerPage}
                      onChange={(e) => {
                        setItemsPerPage(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      style={{ width: '100px' }}
                    >
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </Select>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="detail-panel">
            {selectedLocationId && selectedLocation ? (
              renderLocationDetail()
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
  
  // Render Tree Node
  const renderTreeNode = (location: Location, level: number = 0): React.ReactNode => {
    const isExpanded = expandedNodes.has(location.id);
    const hasChildren = childCounts[location.id] > 0;
    const children = loadedChildren[location.id] || [];
    const isSelected = selectedLocationId === location.id;
    
    return (
      <div key={location.id} className={`tree-node ${isSelected ? 'selected' : ''} ${!location.isActive ? 'inactive' : ''}`}>
        <div
          className={`tree-node-content ${!location.isActive ? 'tree-node-inactive' : ''}`}
          onClick={() => handleLocationSelect(location.id)}
          style={{ paddingLeft: `${level * 20 + 8}px`, opacity: location.isActive ? 1 : 0.6 }}
        >
          {hasChildren && (
            <button
              className="tree-expand-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleTreeExpand(location.id);
              }}
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
            <span className="tree-node-badge">({childCounts[location.id]})</span>
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
  
  // Render Tree Mode
  const renderTreeMode = () => {
    const rootLocations = loadedChildren.root || [];
    
    return (
      <div className="location-tree-mode">
        <div className="tree-split-container">
          <div className="tree-panel">
            <div className="tree-header">
              <h3>Location Hierarchy</h3>
            </div>
            <div className="tree-content">
              {loading ? (
                <LoadingState message="Loading locations..." />
              ) : rootLocations.length === 0 ? (
                <EmptyState message="No locations found" />
              ) : (
                <div className="tree-nodes">
                  {rootLocations.map(loc => renderTreeNode(loc, 0))}
                </div>
              )}
            </div>
          </div>
          <div className="detail-panel">
            {selectedLocationId && selectedLocation ? (
              renderLocationDetail()
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
    
    const canDelete = !childCounts[selectedLocation.id] && stockData.length === 0;
    
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
                
                // Clear children cache for parent location to force reload on next expand
                if (selectedLocation.parentLocationId) {
                  loadedChildrenRef.current.delete(selectedLocation.parentLocationId);
                  setLoadedChildren(prev => {
                    const next = { ...prev };
                    delete next[selectedLocation.parentLocationId!];
                    return next;
                  });
                }
              }}
            >
              {selectedLocation.isActive ? 'Deactivate' : 'Activate'}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setLocationToDelete(selectedLocation.id);
                setShowDeleteConfirm(true);
              }}
              disabled={!canDelete}
              title={!canDelete ? 'Cannot delete location with children or stock' : 'Delete location'}
            >
              Delete
            </Button>
          </div>
        </div>
        
        {/* Sub-tabs */}
        <div className="location-sub-tabs">
          <button
            className={`location-sub-tab ${locationSubTab === 'overview' ? 'active' : ''}`}
            onClick={() => setLocationSubTab('overview')}
          >
            Overview
          </button>
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
          {locationSubTab === 'overview' && renderOverviewTab()}
          {locationSubTab === 'stock' && renderStockTab()}
          {locationSubTab === 'children' && renderChildrenTab()}
          {locationSubTab === 'capacity' && renderCapacityTab()}
          {locationSubTab === 'history' && renderHistoryTab()}
        </div>
      </div>
    );
  };
  
  // Render Overview Tab
  const renderOverviewTab = () => {
    if (!selectedLocation) return null;
    
    const toggleSection = (sectionId: string) => {
      setCollapsedOverviewSections(prev => {
        const next = new Set(prev);
        if (next.has(sectionId)) {
          next.delete(sectionId);
        } else {
          next.add(sectionId);
        }
        return next;
      });
    };
    
    const isBasicInfoCollapsed = collapsedOverviewSections.has('basic-info');
    const isPhysicalInfoCollapsed = collapsedOverviewSections.has('physical-info');
    const isClassificationCollapsed = collapsedOverviewSections.has('classification');
    const isRulesCollapsed = collapsedOverviewSections.has('rules');
    
    return (
      <div className="overview-tab">
        {/* Basic Info Section */}
        <div className="overview-section collapsible-section">
          <div className="collapsible-section-header" onClick={() => toggleSection('basic-info')}>
            <h3>Basic Information</h3>
            <span className="collapsible-section-icon">
              {isBasicInfoCollapsed ? '▶' : '▼'}
            </span>
          </div>
          {!isBasicInfoCollapsed && (
            <div className="overview-grid">
              <div>
                <label>Code</label>
                <div>{selectedLocation.code}</div>
              </div>
              <div>
                <label>Name</label>
                <div>{selectedLocation.name}</div>
              </div>
              <div>
                <label>Type</label>
                <div>{selectedLocation.type}</div>
              </div>
              <div>
                <label>Parent Location</label>
                <div>
                  {selectedLocation.parentLocation ? (
                    <button
                      className="link-button"
                      onClick={() => handleLocationSelect(selectedLocation.parentLocation!.id)}
                    >
                      {selectedLocation.parentLocation.name}
                    </button>
                  ) : (
                    '-'
                  )}
                </div>
              </div>
              <div>
                <label>Status</label>
                <div>
                  <span className={selectedLocation.isActive ? 'status-active' : 'status-inactive'}>
                    {selectedLocation.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Physical Info Section */}
        {(selectedLocation.address || selectedLocation.notes) && (
          <div className="overview-section collapsible-section">
            <div className="collapsible-section-header" onClick={() => toggleSection('physical-info')}>
              <h3>Physical Information</h3>
              <span className="collapsible-section-icon">
                {isPhysicalInfoCollapsed ? '▶' : '▼'}
              </span>
            </div>
            {!isPhysicalInfoCollapsed && (
              <>
                {selectedLocation.address && (
                  <div>
                    <label>Address</label>
                    <div>{selectedLocation.address}</div>
                  </div>
                )}
                {selectedLocation.notes && (
                  <div>
                    <label>Notes</label>
                    <div>{selectedLocation.notes}</div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        
        {/* Classification Section */}
        <div className="overview-section collapsible-section">
          <div className="collapsible-section-header" onClick={() => toggleSection('classification')}>
            <h3>Classification</h3>
            <span className="collapsible-section-icon">
              {isClassificationCollapsed ? '▶' : '▼'}
            </span>
          </div>
          {!isClassificationCollapsed && (
            <div className="overview-grid">
              <div>
                <label>Temperature Zone</label>
                <div>{selectedLocation.temperatureZone || '-'}</div>
              </div>
            </div>
          )}
        </div>
        
        {/* Rules Section */}
        <div className="overview-section collapsible-section">
          <div className="collapsible-section-header" onClick={() => toggleSection('rules')}>
            <h3>Rules</h3>
            <span className="collapsible-section-icon">
              {isRulesCollapsed ? '▶' : '▼'}
            </span>
          </div>
          {!isRulesCollapsed && (
            <div className="overview-grid">
              <div>
                <label>Allow Stock</label>
                <div>{selectedLocation.allowStock !== false ? 'Yes' : 'No'}</div>
              </div>
              <div>
                <label>Allow Picking</label>
                <div>{selectedLocation.allowPicking !== false ? 'Yes' : 'No'}</div>
              </div>
              <div>
                <label>Allow Receiving</label>
                <div>{selectedLocation.allowReceiving !== false ? 'Yes' : 'No'}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };
  
  // Render Stock Tab
  const renderStockTab = () => {
    const stockColumns: ColumnDef<StockByLocation>[] = [
      {
        id: 'sku',
        header: 'SKU',
        width: 120,
        accessor: (stock) => stock.item.sku,
      },
      {
        id: 'name',
        header: 'Product Name',
        minWidth: 200,
        accessor: (stock) => stock.item.name,
      },
      {
        id: 'variant',
        header: 'Variant',
        width: 150,
        accessor: (stock) => stock.variant ? `${stock.variant.code} - ${stock.variant.name}` : '-',
      },
      {
        id: 'onHand',
        header: 'On Hand',
        width: 100,
        accessor: (stock) => stock.onHandQuantity,
      },
      {
        id: 'reserved',
        header: 'Reserved',
        width: 100,
        accessor: (stock) => stock.reservedQuantity,
      },
      {
        id: 'blocked',
        header: 'Blocked',
        width: 100,
        accessor: (stock) => stock.blockedQuantity,
      },
      {
        id: 'damaged',
        header: 'Damaged',
        width: 100,
        accessor: (stock) => stock.damagedQuantity,
      },
      {
        id: 'available',
        header: 'Available',
        width: 100,
        accessor: (stock) => stock.availableQuantity,
      },
      {
        id: 'actions',
        header: 'Actions',
        width: 200,
        accessor: (stock) => {
          const itemId = stock.item?.id || stock.itemId;
          if (!itemId || !selectedLocationId) return null;
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
                  if (stock.variantId) { p.set('variantId', stock.variantId); p.set('variantLocked', '1'); }
                  p.set('toLocationId', selectedLocationId);
                  p.set('reasonCode', getDefaultReason('RECEIPT', 'location').defaultCode);
                  p.set('returnTab', 'locations');
                  p.set('returnLocationId', selectedLocationId);
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
                  if (stock.variantId) { p.set('variantId', stock.variantId); p.set('variantLocked', '1'); }
                  p.set('fromLocationId', selectedLocationId);
                  p.set('reasonCode', getDefaultReason('ISSUE', 'location').defaultCode);
                  p.set('returnTab', 'locations');
                  p.set('returnLocationId', selectedLocationId);
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
                  if (stock.variantId) { p.set('variantId', stock.variantId); p.set('variantLocked', '1'); }
                  p.set('fromLocationId', selectedLocationId);
                  p.set('reasonCode', getDefaultReason('TRANSFER', 'location_from').defaultCode);
                  p.set('returnTab', 'locations');
                  p.set('returnLocationId', selectedLocationId);
                  p.set('returnSubTab', 'stock');
                  setSearchParams(p);
                }}
              >
                Transfer
              </Button>
            </div>
          );
        },
      },
    ];

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
        </div>
        {loading ? (
          <LoadingState message="Loading stock data..." />
        ) : filteredStockData.length === 0 ? (
          <EmptyState message={stockData.length === 0 ? "No stock found at this location" : "No stock matches the filter"} />
        ) : (
          <DataTable
            data={filteredStockData}
            columns={stockColumns}
            searchable={true}
            searchPlaceholder="Search by SKU or product name..."
            searchFields={(stock) => [stock.item.sku, stock.item.name, stock.variant?.code || '', stock.variant?.name || '']}
            onRowClick={(stock) => {
              // Use item.id as primary source, fallback to itemId if item is populated
              const itemId = stock.item?.id || stock.itemId;
              
              if (!itemId) {
                console.error('[LocationManagement] No itemId found in stock data', stock);
                return;
              }
              
              // Build URL params for navigation to Item Master
              const newParams = new URLSearchParams();
              newParams.set('tab', 'items');
              newParams.set('itemId', itemId);
              
              // If variant exists, navigate to variants tab and highlight that variant
              if (stock.variantId) {
                newParams.set('itemSubTab', 'variants');
                newParams.set('variantId', stock.variantId);
              } else {
                // If no variant, navigate to stock tab with location filter
                newParams.set('itemSubTab', 'stock');
                if (selectedLocationId) {
                  newParams.set('locationId', selectedLocationId);
                }
              }
              
              navigate(`/inventory?${newParams.toString()}`);
            }}
            getRowId={(stock) => `${stock.itemId}-${stock.variantId || 'none'}-${stock.batchNumber || 'none'}`}
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
        width: 150,
        accessor: (loc) => (
          <div className="cell-actions">
            <Button variant="ghost" size="sm" onClick={() => handleLocationSelect(loc.id)}>
              View
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLocationToDelete(loc.id);
                setShowDeleteConfirm(true);
              }}
            >
              Delete
            </Button>
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
        {loading ? (
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
        
        {loading ? (
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
  
  // Render Settings Section
  const renderSettings = () => {
    return (
      <div className="location-settings">
        <div className="settings-header">
          <h2>Location Settings</h2>
          <p className="settings-subtitle">Configure location rules, capacity units, and temperature definitions</p>
        </div>
        
        <div className="settings-content">
          {/* Capacity Units */}
          <Card className="settings-card">
            <h3>Capacity Units</h3>
            <div className="settings-grid">
              <div>
                <label>Weight Unit</label>
                <div>kg (Kilograms)</div>
              </div>
              <div>
                <label>Volume Unit</label>
                <div>m³ (Cubic Meters)</div>
              </div>
              <div>
                <label>Items Unit</label>
                <div>pcs (Pieces)</div>
              </div>
            </div>
            <p className="settings-note">Units are standardized across all locations. Changes require admin approval.</p>
          </Card>
          
          {/* Temperature Zones */}
          <Card className="settings-card">
            <h3>Temperature Zone Definitions</h3>
            <div className="temperature-zones">
              <div className="temp-zone-item">
                <h4>Frozen</h4>
                <div className="temp-range">
                  <span>Temperature: &lt; 0°C</span>
                </div>
                <p>For items requiring freezing temperatures</p>
              </div>
              <div className="temp-zone-item">
                <h4>Cold</h4>
                <div className="temp-range">
                  <span>Temperature: 0°C - 8°C</span>
                </div>
                <p>For items requiring refrigeration</p>
              </div>
              <div className="temp-zone-item">
                <h4>Ambient</h4>
                <div className="temp-range">
                  <span>Temperature: Room temperature (15°C - 25°C)</span>
                </div>
                <p>For items stored at room temperature</p>
              </div>
            </div>
          </Card>
          
          {/* Default Rules */}
          <Card className="settings-card">
            <h3>Default Rules for New Locations</h3>
            <div className="settings-grid">
              <div>
                <label>Allow Stock</label>
                <div>Yes (Default)</div>
              </div>
              <div>
                <label>Allow Picking</label>
                <div>Yes (Default)</div>
              </div>
              <div>
                <label>Allow Receiving</label>
                <div>Yes (Default)</div>
              </div>
            </div>
            <p className="settings-note">These defaults apply when creating new locations. Can be changed per location.</p>
          </Card>
        </div>
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
              <Button variant="primary" onClick={handleCreate} disabled={loading}>
                {loading ? 'Creating...' : 'Create Location'}
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
            <Button variant="primary" onClick={handleUpdate} disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
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
      {/* Top-level tabs: Workspace | Settings */}
      <div className="location-management-top-tabs">
        <button
          className={`location-top-tab ${topSection === 'workspace' ? 'active' : ''}`}
          onClick={() => setTopSection('workspace')}
        >
          Workspace
        </button>
        <button
          className={`location-top-tab ${topSection === 'settings' ? 'active' : ''}`}
          onClick={() => setTopSection('settings')}
        >
          Settings
        </button>
      </div>
      
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      
      {topSection === 'workspace' && (
        <div className="location-workspace">
          {/* Workspace mode toggle: List | Tree */}
          <div className="workspace-mode-toggle">
            <button
              className={`mode-toggle-btn ${workspaceMode === 'list' ? 'active' : ''}`}
              onClick={() => setWorkspaceMode('list')}
            >
              List
            </button>
            <button
              className={`mode-toggle-btn ${workspaceMode === 'tree' ? 'active' : ''}`}
              onClick={() => setWorkspaceMode('tree')}
            >
              Tree
            </button>
            <div className="workspace-actions">
              <Button variant="primary" onClick={() => {
                resetCreateForm();
                setShowCreateWizard(true);
              }}>
                Add Location
              </Button>
            </div>
          </div>
          
          {workspaceMode === 'list' ? renderListMode() : renderTreeMode()}
        </div>
      )}
      
      {topSection === 'settings' && renderSettings()}
      
      {/* Create Wizard */}
      {showCreateWizard && renderCreateWizard()}
      
      {/* Edit Drawer */}
      {showEditDrawer && renderEditDrawer()}
      
      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Location"
        message="Are you sure you want to delete this location? This action cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setLocationToDelete(null);
        }}
        variant="danger"
      />
    </div>
  );
};
